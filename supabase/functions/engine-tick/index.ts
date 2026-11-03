// TTM Automated Trading Engine (paper trading). Single file for the Supabase dashboard editor. Keep Verify JWT OFF.
// Secrets: ANTHROPIC_API_KEY and ENGINE_KEY.
// Pure trading logic for the TTM engine (paper trading). No network, no database. Tested on its own.
import webpush from "npm:web-push@3.6.7";
type Candle = {t: number; o: number; h: number; l: number; c: number};
type Pos = {id: number; pair: string; side: "long" | "short"; entry: number; units: number; notional: number; lev: number; margin: number; sl: number; tp: number | null; risk_usd: number; opened_at: string};
type Cfg = {risk_pct: number; max_open: number; max_lev: number; pairs: string[]};
type Decision = {pair?: string; action?: string; sl?: number; tp?: number | null; lev?: number; reason?: string};
const FEE = 0.0006;           // taker fee per side
const HOUR = 3600000;

function ema(v: number[], n: number): number { const k = 2 / (n + 1); let e = v[0]; for (let i = 1; i < v.length; i++) e = v[i] * k + e * (1 - k); return e; }
function rsi(cl: number[], n = 14): number | null {
  if (cl.length <= n) return null; let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = cl[i] - cl[i - 1]; if (d >= 0) g += d; else l -= d; } g /= n; l /= n;
  for (let i = n + 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function atr(c: Candle[], n = 14): number | null {
  if (c.length <= n) return null; const tr = (i: number) => Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  let a = 0; for (let i = 1; i <= n; i++) a += tr(i); a /= n; for (let i = n + 1; i < c.length; i++) a = (a * (n - 1) + tr(i)) / n; return a;
}
const r = (x: number | null, d = 2) => x == null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d;
function snapshot(pair: string, c: Candle[]) {
  const cl = c.map((x) => x.c), p = cl[cl.length - 1], at = (n: number) => cl.length > n ? (p / cl[cl.length - 1 - n] - 1) * 100 : null, last24 = c.slice(-24), a = atr(c);
  const sig = (x: number) => x >= 100 ? 2 : x >= 1 ? 4 : 6;
  return {pair, price: r(p, sig(p)), change_1h_pct: r(at(1)), change_4h_pct: r(at(4)), change_24h_pct: r(at(24)), rsi14: r(rsi(cl), 1), ema20: r(ema(cl.slice(-60), 20), sig(p)), ema50: r(ema(cl.slice(-100), 50), sig(p)),
    atr14: r(a, sig(p)), atr_pct: a == null ? null : r(a / p * 100), high_24h: r(Math.max(...last24.map((x) => x.h)), sig(p)), low_24h: r(Math.min(...last24.map((x) => x.l)), sig(p)), last_12_closes: cl.slice(-12).map((x) => r(x, sig(p)))};
}
function pnlOf(p: Pos, exit: number): number { const gross = (p.side === "long" ? exit - p.entry : p.entry - exit) * p.units; return gross - (p.notional + exit * p.units) * FEE; }
// did the stop or target trade since the position opened? stop wins when both sit in one candle (the careful assumption)
function checkExit(p: Pos, candles: Candle[], period = HOUR): {price: number; reason: "stop" | "target"} | null {
  const opened = new Date(p.opened_at).getTime();
  for (const c of candles) {
    if (c.t + period <= opened) continue;
    if (p.side === "long") { if (c.l <= p.sl) return {price: Math.min(p.sl, c.o), reason: "stop"}; if (p.tp != null && c.h >= p.tp) return {price: p.tp, reason: "target"}; }
    else { if (c.h >= p.sl) return {price: Math.max(p.sl, c.o), reason: "stop"}; if (p.tp != null && c.l <= p.tp) return {price: p.tp, reason: "target"}; }
  }
  return null;
}
function validateOpen(d: Decision, price: number, equity: number, cash: number, open: Pos[], cfg: Cfg):
  {ok: true; pos: {side: "long" | "short"; entry: number; units: number; notional: number; lev: number; margin: number; sl: number; tp: number | null; risk_usd: number}} | {ok: false; reason: string} {
  const side = d.action === "open_long" ? "long" : d.action === "open_short" ? "short" : null; if (!side) return {ok: false, reason: "not an open action"};
  if (!d.pair || !cfg.pairs.includes(d.pair)) return {ok: false, reason: "pair not allowed"};
  if (!(price > 0)) return {ok: false, reason: "no price"};
  if (open.some((p) => p.pair === d.pair)) return {ok: false, reason: "already holding this pair"};
  if (open.length >= cfg.max_open) return {ok: false, reason: "max open positions reached"};
  const sl = Number(d.sl); if (!isFinite(sl) || sl <= 0) return {ok: false, reason: "stop loss missing"};
  if (side === "long" ? sl >= price : sl <= price) return {ok: false, reason: "stop loss on the wrong side"};
  const dist = Math.abs(price - sl) / price; if (dist < 0.004) return {ok: false, reason: "stop too tight (under 0.4%)"}; if (dist > 0.12) return {ok: false, reason: "stop too wide (over 12%)"};
  let tp: number | null = null;
  if (d.tp != null && d.tp !== (null as unknown)) { tp = Number(d.tp); if (!isFinite(tp) || tp <= 0) return {ok: false, reason: "bad take profit"}; if (side === "long" ? tp <= price : tp >= price) return {ok: false, reason: "take profit on the wrong side"}; if (Math.abs(tp - price) / Math.abs(price - sl) < 1.2) return {ok: false, reason: "reward to risk under 1.2"}; }
  const lev = Math.min(Math.max(Number(d.lev) || 1, 1), cfg.max_lev);
  let units = (equity * cfg.risk_pct / 100) / Math.abs(price - sl);
  units = Math.min(units, equity * lev / price);                 // never bigger than the leverage allows
  units = Math.min(units, Math.max(0, cash) * lev * 0.98 / price); // nor than the free cash
  const notional = units * price; if (notional < 50) return {ok: false, reason: "position too small or no free cash"};
  return {ok: true, pos: {side, entry: price, units, notional, lev, margin: notional / lev, sl, tp, risk_usd: units * Math.abs(price - sl)}};
}
function parseDecisions(text: string): Decision[] {
  const a = text.indexOf("{"), b = text.lastIndexOf("}"); if (a < 0 || b <= a) return [];
  try { const j = JSON.parse(text.slice(a, b + 1)); return Array.isArray(j.decisions) ? j.decisions.slice(0, 10) : []; } catch (_) { return []; }
}
const SYSTEM = `You are the TTM trading agent, the decision module of a paper trading engine for USDT-margined crypto perpetual futures on Bitget. No real money is used yet; the goal is to show careful, rules-based trading.
You get a market snapshot for each allowed pair, the open positions and the account. Decide, per pair, one of: open_long, open_short, close, hold.
Rules you must follow (the engine rejects anything that breaks them):
- Every open needs a stop loss ("sl") on the correct side, between 0.4% and 12% from the current price. A take profit ("tp") is optional but must be at least 1.2 times the stop distance away.
- Leverage ("lev") between 1 and the stated maximum. The engine sizes the position from the risk limit, so do not give a size.
- Never open a pair that is already held. Use "close" to exit a held pair early when the idea is no longer valid.
- Most hours the right answer is "hold". Only trade a clear setup with a defined invalidation level. Do not chase moves or add to losers.
Reply with JSON only, no other text: {"decisions":[{"pair":"BTCUSDT","action":"hold","reason":"one or two plain sentences"}]}
For an open include "sl", "tp" (or null) and "lev". Include a short plain reason for every decision.`;

const URL_ = Deno.env.get("SUPABASE_URL")!, KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = {apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json"};
const CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-engine-key", "Access-Control-Allow-Methods": "POST, OPTIONS"};
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o), {status: s, headers: {...CORS, "Content-Type": "application/json"}});
const rest = (p: string, o: any = {}) => fetch(URL_ + "/rest/v1/" + p, {...o, headers: {...H, ...(o.headers || {})}});
const get = async (p: string) => { const r = await rest(p); const j = await r.json(); return Array.isArray(j) ? j : []; };
const num = (x: unknown) => Number(x);
// Phone alert (web push) to the admin's devices on every open and close. Never lets a failed alert stop the engine.
let vapidOk = false;
async function alertTg(title: string, body: string) {
  try {
    const pub = Deno.env.get("VAPID_PUBLIC"), priv = Deno.env.get("VAPID_PRIVATE"); if (!pub || !priv) return;
    if (!vapidOk) { webpush.setVapidDetails("mailto:" + (Deno.env.get("VAPID_SUBJECT") || "tradethemove@icloud.com"), pub, priv); vapidOk = true; }
    const admins = await get("ttm_profiles?select=id&is_admin=eq.true"); if (!admins.length) return;
    const subs = await get(`ttm_push_subs?select=*&user_id=in.(${admins.map((a: any) => a.id).join(",")})`);
    const payload = JSON.stringify({title, body, tag: "engine-" + Date.now(), url: "./engine/index.html"});
    await Promise.all(subs.map(async (s: any) => {
      try { await webpush.sendNotification({endpoint: s.endpoint, keys: {p256dh: s.p256dh, auth: s.auth}}, payload, {TTL: 3600, urgency: "high"}); }
      catch (e: any) { if (e.statusCode === 404 || e.statusCode === 410) await rest("ttm_push_subs?endpoint=eq." + encodeURIComponent(s.endpoint), {method: "DELETE"}); }
    }));
  } catch (_) { /* ignore */ }
}
const sgn = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(2) + "%";

async function isAdminCall(req: Request): Promise<boolean> {
  const secret = Deno.env.get("ENGINE_KEY"); if (secret && req.headers.get("x-engine-key") === secret) return true;
  const t = (req.headers.get("authorization") || "").replace(/^Bearer /i, ""); if (!t) return false;
  const u = await fetch(URL_ + "/auth/v1/user", {headers: {apikey: KEY, Authorization: "Bearer " + t}}); if (!u.ok) return false;
  const id = (await u.json()).id; const p = await get(`ttm_profiles?select=is_admin&id=eq.${id}`); return !!(p[0] && p[0].is_admin);
}
async function candles(pair: string): Promise<Candle[]> {
  const r = await fetch(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${pair}&productType=USDT-FUTURES&granularity=1H&limit=120`);
  const j = await r.json(); if (j.code !== "00000" || !Array.isArray(j.data)) throw new Error("Bitget " + pair + ": " + (j.msg || r.status));
  return j.data.map((x: string[]) => ({t: num(x[0]), o: num(x[1]), h: num(x[2]), l: num(x[3]), c: num(x[4])})).sort((a: Candle, b: Candle) => a.t - b.t);
}
async function ask(model: string, content: string): Promise<string> {
  const k = Deno.env.get("ANTHROPIC_API_KEY"); if (!k) throw new Error("ANTHROPIC_API_KEY secret is missing");
  const r = await fetch("https://api.anthropic.com/v1/messages", {method: "POST", headers: {"x-api-key": k, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    body: JSON.stringify({model, max_tokens: 1200, system: SYSTEM, messages: [{role: "user", content}]})});
  const j = await r.json(); if (!r.ok) throw new Error("Agent: " + (j.error?.message || r.status));
  return (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers: CORS});
  if (!(await isAdminCall(req))) return out({ok: false, reason: "not allowed"}, 401);
  const cfgRow = (await get("ttm_engine_config?select=*&id=eq.1"))[0]; if (!cfgRow) return out({ok: false, reason: "run engine.sql first"}, 500);
  if (!cfgRow.enabled) return out({ok: true, skipped: "engine is switched off"});
  const cfg: Cfg = {risk_pct: num(cfgRow.risk_pct), max_open: num(cfgRow.max_open), max_lev: num(cfgRow.max_lev), pairs: cfgRow.pairs || []};
  const log: string[] = []; let err = "", warn = "";
  try {
    const cs: Record<string, Candle[]> = {}, skipped: string[] = [];
    for (const p of cfg.pairs) { try { cs[p] = await candles(p); if (cs[p].length < 30) throw new Error("too little data"); } catch (_) { delete cs[p]; skipped.push(p); } }
    cfg.pairs = cfg.pairs.filter((p) => cs[p]); if (!cfg.pairs.length) throw new Error("No pair returned Bitget data. Skipped: " + skipped.join(", "));
    if (skipped.length) warn = "Skipped (no Bitget futures data): " + skipped.join(", ");
    const price = (p: string) => cs[p][cs[p].length - 1].c;
    const open: Pos[] = (await get("ttm_engine_positions?select=*&status=eq.open&order=id.asc")).map((x: any) => ({...x, entry: num(x.entry), units: num(x.units), notional: num(x.notional), lev: num(x.lev), margin: num(x.margin), sl: num(x.sl), tp: x.tp == null ? null : num(x.tp), risk_usd: num(x.risk_usd)}));
    const closeIt = async (p: Pos, px: number, why: string) => { const pnl = pnlOf(p, px);
      await rest(`ttm_engine_positions?id=eq.${p.id}`, {method: "PATCH", body: JSON.stringify({status: "closed", closed_at: new Date().toISOString(), exit_price: px, pnl, close_reason: why})}); log.push(`closed ${p.pair} ${why} ${pnl.toFixed(2)}`);
      await alertTg(`${pnl >= 0 ? "🟢" : "🔴"} ${p.pair.replace("USDT", "")} ${p.side.toUpperCase()} closed`, `${sgn(pnl / p.margin * 100)} on margin (${why === "ai" ? "agent exit" : why})`); };
    // 1) stops and targets
    let still: Pos[] = [];
    for (const p of open) { const hit = cs[p.pair] ? checkExit(p, cs[p.pair]) : null; if (hit) await closeIt(p, hit.price, hit.reason); else still.push(p); }
    // 2) account
    const closed = await get("ttm_engine_positions?select=pnl,pair,side,entry,exit_price,close_reason,closed_at&status=eq.closed&order=closed_at.desc&limit=200");
    const realised = closed.reduce((t: number, x: any) => t + num(x.pnl || 0), 0), start = num(cfgRow.start_balance);
    const unreal = (ps: Pos[]) => ps.reduce((t, p) => t + (cs[p.pair] ? pnlOf(p, price(p.pair)) : 0), 0);
    const account = (ps: Pos[]) => { const eq = start + realised + unreal(ps), cash = start + realised - ps.reduce((t, p) => t + p.margin, 0); return {equity: eq, cash}; };
    // 3) ask the agent
    let acc = account(still);
    const snaps = cfg.pairs.map((p) => snapshot(p, cs[p]));
    const content = JSON.stringify({account: {equity: +acc.equity.toFixed(2), free_cash: +acc.cash.toFixed(2), risk_per_trade_pct: cfg.risk_pct, max_open_positions: cfg.max_open, max_leverage: cfg.max_lev},
      open_positions: still.map((p) => ({pair: p.pair, side: p.side, entry: p.entry, sl: p.sl, tp: p.tp, unrealised_usd: +pnlOf(p, price(p.pair)).toFixed(2), opened: p.opened_at})),
      recent_closed: closed.slice(0, 5).map((x: any) => ({pair: x.pair, side: x.side, pnl: +num(x.pnl).toFixed(2), how: x.close_reason})), market: snaps, time_utc: new Date().toISOString()});
    let raw = ""; try { raw = await ask(cfgRow.model || "claude-sonnet-5-5", content); } catch (e) { err = String(e).slice(0, 300); }
    const decisions = parseDecisions(raw); if (raw && !decisions.length) err = "The agent reply could not be read";
    // 4) check each decision against the hard rules, then simulate it
    for (const d of decisions) {
      const pair = String(d.pair || ""), px = cs[pair] ? price(pair) : 0, act = String(d.action || "hold"); let ok = false, why = "";
      if (!cs[pair]) why = "unknown pair";
      else if (act === "hold") ok = true;
      else if (act === "close") { const p = still.find((x) => x.pair === pair); if (p) { await closeIt(p, px, "ai"); still = still.filter((x) => x.id !== p.id); ok = true; } else why = "nothing to close"; }
      else { acc = account(still); const v = validateOpen(d, px, acc.equity, acc.cash, still, cfg);
        if (v.ok) { const ins = await rest("ttm_engine_positions", {method: "POST", headers: {Prefer: "return=representation"}, body: JSON.stringify({pair, ...v.pos, reason: String(d.reason || "").slice(0, 600)})});
          const row = (await ins.json())[0]; if (row) { still.push({...row, entry: v.pos.entry, units: v.pos.units, notional: v.pos.notional, lev: v.pos.lev, margin: v.pos.margin, sl: v.pos.sl, tp: v.pos.tp, risk_usd: v.pos.risk_usd}); ok = true; log.push(`opened ${act} ${pair}`); await alertTg(`⚡ ${pair.replace("USDT", "")} ${v.pos.side.toUpperCase()} opened`, "Timeframe: 1hr"); } else why = "could not save"; }
        else why = v.reason; }
      await rest("ttm_engine_decisions", {method: "POST", headers: {Prefer: "return=minimal"}, body: JSON.stringify({pair, action: act, price: px || null, reason: String(d.reason || "").slice(0, 600), accepted: ok, reject_reason: ok ? null : why, raw: d})});
    }
    // 5) equity snapshot and status
    acc = account(still); await rest("ttm_engine_equity", {method: "POST", headers: {Prefer: "return=minimal"}, body: JSON.stringify({equity: acc.equity, cash: acc.cash, unrealised: unreal(still)})});
  } catch (e) { err = String(e).slice(0, 300); }
  await rest("ttm_engine_config?id=eq.1", {method: "PATCH", body: JSON.stringify({last_tick: new Date().toISOString(), last_error: err || warn || null})});
  return out({ok: !err, error: err || undefined, log});
});
