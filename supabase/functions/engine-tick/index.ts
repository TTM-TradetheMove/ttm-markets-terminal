// TTM Automated Trading Engine (paper trading). Single file for the Supabase dashboard editor. Keep Verify JWT OFF.
// Secrets: ANTHROPIC_API_KEY and ENGINE_KEY. Runs every 5 minutes (see engine2.sql).
import webpush from "npm:web-push@3.6.7";
// Pure trading logic for the TTM engine (paper trading). No network, no database. Tested on its own.
type Candle = {t: number; o: number; h: number; l: number; c: number; v?: number};
type Pos = {id: number; pair: string; side: "long" | "short"; entry: number; units: number; notional: number; lev: number; margin: number; sl: number; tp: number | null; risk_usd: number; opened_at: string; strategy?: string | null; trail_atr?: number | null};
type Cfg = {risk_pct: number; max_open: number; max_lev: number; pairs: string[]; strategies: string[]};
type Decision = {strategy?: string; trail_atr?: number | null; pair?: string; action?: string; sl?: number; tp?: number | null; lev?: number; reason?: string};
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
const MIN = 60000;
// time frames you can pick. "gran" is what Bitget serves; 2H and 8H are built from 1H candles ("agg" of them).
const TFS: Record<string, {label: string; ms: number; gran: string; agg: number}> = {
  "5m": {label: "5min", ms: 5 * MIN, gran: "5m", agg: 1}, "15m": {label: "15min", ms: 15 * MIN, gran: "15m", agg: 1}, "30m": {label: "30min", ms: 30 * MIN, gran: "30m", agg: 1},
  "1H": {label: "1hr", ms: HOUR, gran: "1H", agg: 1}, "2H": {label: "2hr", ms: 2 * HOUR, gran: "1H", agg: 2}, "4H": {label: "4hr", ms: 4 * HOUR, gran: "4H", agg: 1},
  "8H": {label: "8hr", ms: 8 * HOUR, gran: "1H", agg: 8}, "12H": {label: "12hr", ms: 12 * HOUR, gran: "12H", agg: 1}, "1D": {label: "daily", ms: 24 * HOUR, gran: "1D", agg: 1},
  "3D": {label: "3day", ms: 72 * HOUR, gran: "3D", agg: 1}, "1W": {label: "weekly", ms: 168 * HOUR, gran: "1W", agg: 1},
};
const STRATS: Record<string, {name: string; text: string}> = {
  trend: {name: "Trend continuation", text: "Trend continuation: find an established bullish or bearish trend (price against the 20 and 50 averages, and the higher time frame direction in htf). Enter on a pullback once it is confirmed. Long in uptrends, short in downtrends. Use the higher time frame direction as a filter: never trade against htf.trend."},
  breakout: {name: "Breakout and retest", text: "Breakout and retest: find important support and resistance (swing_highs, swing_lows, range_high_50, range_low_50). Wait for a confirmed breakout (a close beyond the level, ideally with higher volume), then wait for a retest of that level before entering. Trade both bullish and bearish breakouts."},
  sweep: {name: "Liquidity sweep and reversal", text: "Liquidity sweep and reversal (HIGH PRIORITY, prefer this one when several setups are valid): price moves beyond a significant swing high or low (a sweep), then rejects and closes back inside the range. Confirm with volume, structure and momentum. Enter the reversal and target the move back into the trading range."},
  momentum: {name: "Momentum expansion", text: "Momentum expansion: volume and volatility are increasing (volume_ratio, atr) and price is making strong directional candles. Enter once the momentum is confirmed. Use a trailing exit: include \"trail_atr\" (for example 2 = the stop trails the best price by 2 x ATR) to ride extended moves."},
};
const stratName = (k?: string | null) => (k && STRATS[k] ? STRATS[k].name : "");
// join smaller candles into bigger ones on the clock (used for 2hr and 8hr)
function aggregateTime(c: Candle[], n: number, base: number): Candle[] {
  const per = n * base, m = new Map<number, Candle>();
  for (const x of c) { const k = Math.floor(x.t / per) * per, g = m.get(k);
    if (!g) m.set(k, {t: k, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v || 0}); else { g.h = Math.max(g.h, x.h); g.l = Math.min(g.l, x.l); g.c = x.c; g.v = (g.v || 0) + (x.v || 0); } }
  return [...m.values()].sort((a, b) => a.t - b.t);
}
// groups of n from the newest candle backwards, so the last group always ends on the latest candle (used for the higher time frame)
function aggregateTail(c: Candle[], n: number): Candle[] {
  const out: Candle[] = []; for (let end = c.length; end - n >= 0; end -= n) { const g = c.slice(end - n, end);
    out.unshift({t: g[0].t, o: g[0].o, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)), c: g[g.length - 1].c, v: g.reduce((t, x) => t + (x.v || 0), 0)}); }
  return out;
}
function isDue(ms: number, last: string | null | undefined, now: number): boolean {
  if (!last) return true; const l = new Date(last).getTime(); return !isFinite(l) || Math.floor(now / ms) > Math.floor(l / ms);
}
function swings(c: Candle[], k = 2, look = 120) {
  const hi: {price: number; bars_ago: number}[] = [], lo: {price: number; bars_ago: number}[] = [], n = c.length;
  for (let i = Math.max(k, n - look); i < n - k; i++) {
    let h = true, l = true; for (let j = 1; j <= k; j++) { if (!(c[i].h > c[i - j].h && c[i].h > c[i + j].h)) h = false; if (!(c[i].l < c[i - j].l && c[i].l < c[i + j].l)) l = false; }
    if (h) hi.push({price: c[i].h, bars_ago: n - 1 - i}); if (l) lo.push({price: c[i].l, bars_ago: n - 1 - i});
  }
  return {hi: hi.slice(-3), lo: lo.slice(-3)};
}
const trendOf = (p: number, e20: number | null, e50: number | null) => e20 == null || e50 == null ? null : p > e20 && e20 > e50 ? "up" : p < e20 && e20 < e50 ? "down" : "mixed";
function snapshot(pair: string, c: Candle[], ms = HOUR, now = Date.now()) {
  const cl = c.map((x) => x.c), p = cl[cl.length - 1], at = (n: number) => cl.length > n ? (p / cl[cl.length - 1 - n] - 1) * 100 : null, a = atr(c);
  const sig = (x: number) => x >= 100 ? 2 : x >= 1 ? 4 : 6, last24 = c.slice(-24), last50 = c.slice(-50), vols = c.map((x) => x.v || 0);
  const avgV = (end: number) => { const s = vols.slice(Math.max(0, end - 20), end); return s.length ? s.reduce((t, x) => t + x, 0) / s.length : 0; };
  const e20 = ema(cl.slice(-60), 20), e50 = cl.length >= 50 ? ema(cl.slice(-100), 50) : null;
  const htfC = aggregateTail(c, 4), hc = htfC.map((x) => x.c), hp = hc[hc.length - 1];
  const h20 = hc.length >= 20 ? ema(hc.slice(-60), 20) : null, h50 = hc.length >= 50 ? ema(hc.slice(-100), 50) : null, sw = swings(c);
  const last = c[c.length - 1], prog = Math.max(0, Math.min(100, (now - last.t) / ms * 100));
  return {pair, price: r(p, sig(p)), candle_progress_pct: Math.round(prog), change_1_bars_pct: r(at(1)), change_4_bars_pct: r(at(4)), change_24_bars_pct: r(at(24)),
    rsi14: r(rsi(cl), 1), ema20: r(e20, sig(p)), ema50: r(e50, sig(p)), trend: trendOf(p, e20, e50), atr14: r(a, sig(p)), atr_pct: a == null ? null : r(a / p * 100),
    htf: {note: "4 x the chosen time frame", trend: hc.length ? trendOf(hp, h20, h50) : null, rsi14: r(rsi(hc), 1), ema20: r(h20, sig(p)), ema50: r(h50, sig(p))},
    volume_ratio_prev_closed: avgV(c.length - 1) ? r((vols[vols.length - 2] || 0) / avgV(c.length - 2), 2) : null, volume_ratio_forming: avgV(c.length - 1) ? r(vols[vols.length - 1] / avgV(c.length - 1), 2) : null,
    high_24_bars: r(Math.max(...last24.map((x) => x.h)), sig(p)), low_24_bars: r(Math.min(...last24.map((x) => x.l)), sig(p)), range_high_50: r(Math.max(...last50.map((x) => x.h)), sig(p)), range_low_50: r(Math.min(...last50.map((x) => x.l)), sig(p)),
    swing_highs: sw.hi.map((s) => ({price: r(s.price, sig(p)), bars_ago: s.bars_ago})), swing_lows: sw.lo.map((s) => ({price: r(s.price, sig(p)), bars_ago: s.bars_ago})),
    last_5_candles: c.slice(-5).map((x) => ({o: r(x.o, sig(p)), h: r(x.h, sig(p)), l: r(x.l, sig(p)), c: r(x.c, sig(p)), v: Math.round(x.v || 0)}))};
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
// move the stop of a trailing position toward the best price reached since it opened (never loosens it)
function trailStop(p: Pos, candles: Candle[], a: number | null, period: number): number | null {
  if (!p.trail_atr || !a) return null; const opened = new Date(p.opened_at).getTime(); let best: number | null = null;
  for (const c of candles) { if (c.t + period <= opened) continue; const x = p.side === "long" ? c.h : c.l; best = best == null ? x : p.side === "long" ? Math.max(best, x) : Math.min(best, x); }
  if (best == null) return null; const ns = p.side === "long" ? best - p.trail_atr * a : best + p.trail_atr * a;
  return (p.side === "long" ? ns > p.sl : ns < p.sl) ? ns : null;
}

function validateOpen(d: Decision, price: number, equity: number, cash: number, open: Pos[], cfg: Cfg):
  {ok: true; pos: {strategy: string; trail_atr: number | null; side: "long" | "short"; entry: number; units: number; notional: number; lev: number; margin: number; sl: number; tp: number | null; risk_usd: number}} | {ok: false; reason: string} {
  const side = d.action === "open_long" ? "long" : d.action === "open_short" ? "short" : null; if (!side) return {ok: false, reason: "not an open action"};
  if (!d.pair || !cfg.pairs.includes(d.pair)) return {ok: false, reason: "pair not allowed"};
  const strat = String(d.strategy || ""); if (!strat) return {ok: false, reason: "strategy missing"}; if (!cfg.strategies.includes(strat)) return {ok: false, reason: "strategy not switched on"};
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
  const ta = Number(d.trail_atr), trail = isFinite(ta) && ta > 0 ? Math.min(Math.max(ta, 0.5), 6) : null;
  return {ok: true, pos: {strategy: strat, trail_atr: trail, side, entry: price, units, notional, lev, margin: notional / lev, sl, tp, risk_usd: units * Math.abs(price - sl)}};
}
function parseDecisions(text: string): Decision[] {
  const a = text.indexOf("{"), b = text.lastIndexOf("}"); if (a < 0 || b <= a) return [];
  try { const j = JSON.parse(text.slice(a, b + 1)); return Array.isArray(j.decisions) ? j.decisions.slice(0, 20) : []; } catch (_) { return []; }
}
function buildSystem(strategies: string[], tf: string): string {
  const list = strategies.filter((k) => STRATS[k]).map((k, i) => (i + 1) + ". " + STRATS[k].text).join("\n");
  return `You are the TTM trading agent, the decision module of a paper trading engine for USDT-margined crypto perpetual futures on Bitget. No real money is used yet; the goal is to show careful, rules-based trading.
You are working on the ${tf} time frame. You get a market snapshot per allowed pair (the last candle is still forming: candle_progress_pct says how far through it is, so judge confirmation on the previous closed candles), the open positions and the account. Decide, per pair, one of: open_long, open_short, close, hold.
You may only trade with these strategies (each open must say which one in "strategy", using the key names ${strategies.filter((k) => STRATS[k]).join(", ") || "none"}):
${list || "No strategy is switched on, so do not open anything: reply hold or close only."}
Rules you must follow (the engine rejects anything that breaks them):
- Every open needs a "strategy", a stop loss ("sl") on the correct side, between 0.4% and 12% from the current price. A take profit ("tp") is optional but must be at least 1.2 times the stop distance away.
- Leverage ("lev") between 1 and the stated maximum. The engine sizes the position from the risk limit, so do not give a size. "trail_atr" (0.5 to 6) is optional and makes the stop trail the best price.
- Never open a pair that is already held. Use "close" to exit a held pair early when the idea is no longer valid.
- Most checks the right answer is "hold". Only trade a clear setup that matches a strategy above with a defined invalidation level. Do not chase moves or add to losers.
Reply with JSON only, no other text: {"decisions":[{"pair":"BTCUSDT","action":"hold","reason":"one short sentence"}]}
For an open include "strategy", "sl", "tp" (or null), "lev" and optionally "trail_atr". Keep every reason to one short sentence.`;
}
// TTM Automated Trading Engine, version 1: paper trading only. No exchange keys, no real orders.
// Runs every 5 minutes. Every run manages open positions (stops, targets, trailing stops). When a new candle of the chosen time frame has closed it also asks the TTM agent what to do, checks it against the hard risk rules and records simulated fills.
// Secrets needed: ANTHROPIC_API_KEY, ENGINE_KEY. Keep "Verify JWT" OFF (the function checks ENGINE_KEY or an admin sign-in itself).

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

async function adminCall(req: Request): Promise<"key" | "admin" | null> {
  const secret = Deno.env.get("ENGINE_KEY"); if (secret && req.headers.get("x-engine-key") === secret) return "key";
  const t = (req.headers.get("authorization") || "").replace(/^Bearer /i, ""); if (!t) return null;
  const u = await fetch(URL_ + "/auth/v1/user", {headers: {apikey: KEY, Authorization: "Bearer " + t}}); if (!u.ok) return null;
  const id = (await u.json()).id; const p = await get(`ttm_profiles?select=is_admin&id=eq.${id}`); return p[0] && p[0].is_admin ? "admin" : null;
}
async function candles(pair: string, gran: string, limit: number): Promise<Candle[]> {
  const r = await fetch(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${pair}&productType=USDT-FUTURES&granularity=${gran}&limit=${limit}`);
  const j = await r.json(); if (j.code !== "00000" || !Array.isArray(j.data)) throw new Error("Bitget " + pair + ": " + (j.msg || r.status));
  return j.data.map((x: string[]) => ({t: num(x[0]), o: num(x[1]), h: num(x[2]), l: num(x[3]), c: num(x[4]), v: num(x[5])})).sort((a: Candle, b: Candle) => a.t - b.t);
}
async function ask(model: string, system: string, content: string): Promise<string> {
  const k = Deno.env.get("ANTHROPIC_API_KEY"); if (!k) throw new Error("ANTHROPIC_API_KEY secret is missing");
  const r = await fetch("https://api.anthropic.com/v1/messages", {method: "POST", headers: {"x-api-key": k, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    body: JSON.stringify({model, max_tokens: 3000, system, messages: [{role: "user", content}]})});
  const j = await r.json(); if (!r.ok) throw new Error("Agent: " + (j.error?.message || r.status));
  return (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers: CORS});
  const who = await adminCall(req); if (!who) return out({ok: false, reason: "not allowed"}, 401);
  const cfgRow = (await get("ttm_engine_config?select=*&id=eq.1"))[0]; if (!cfgRow) return out({ok: false, reason: "run engine.sql first"}, 500);
  if (!cfgRow.enabled) return out({ok: true, skipped: "engine is switched off"});
  const tfKey = TFS[cfgRow.timeframe] ? cfgRow.timeframe : "1H", T = TFS[tfKey];
  const cfg: Cfg = {risk_pct: num(cfgRow.risk_pct), max_open: num(cfgRow.max_open), max_lev: num(cfgRow.max_lev), pairs: cfgRow.pairs || [], strategies: (cfgRow.strategies || []).filter((k: string) => STRATS[k])};
  const log: string[] = []; let err = "", warn = "", asked = false, agentReplied = false;
  const due = who === "admin" || isDue(T.ms, cfgRow.last_agent, Date.now());   // "Check now" always asks the agent
  try {
    const open: Pos[] = (await get("ttm_engine_positions?select=*&status=eq.open&order=id.asc")).map((x: any) => ({...x, entry: num(x.entry), units: num(x.units), notional: num(x.notional), lev: num(x.lev), margin: num(x.margin), sl: num(x.sl), tp: x.tp == null ? null : num(x.tp), risk_usd: num(x.risk_usd), trail_atr: x.trail_atr == null ? null : num(x.trail_atr)}));
    const openPairs = [...new Set(open.map((p) => p.pair))], want = due ? [...new Set([...cfg.pairs, ...openPairs])] : openPairs;
    if (!due && !open.length) { await rest("ttm_engine_config?id=eq.1", {method: "PATCH", body: JSON.stringify({last_tick: new Date().toISOString()})}); return out({ok: true, skipped: "waiting for the next " + T.label + " candle"}); }
    // candles on the chosen time frame (2hr and 8hr are built from 1hr), and 5 minute candles for the open positions' stops
    const cs: Record<string, Candle[]> = {}, fc: Record<string, Candle[]> = {}, skipped: string[] = [];
    await Promise.all(want.map(async (p) => { try { const raw = await candles(p, T.gran, T.agg > 1 ? 1000 : 300); cs[p] = T.agg > 1 ? aggregateTime(raw, T.agg, HOUR) : raw; if (cs[p].length < 30) throw new Error("too little data"); } catch (_) { delete cs[p]; skipped.push(p); } }));
    await Promise.all(openPairs.map(async (p) => { if (T.gran === "5m" && T.agg === 1) { if (cs[p]) fc[p] = cs[p]; return; } try { fc[p] = await candles(p, "5m", 300); } catch (_) { /* fall back to the time frame candles */ } }));
    const tradePairs = cfg.pairs.filter((p) => cs[p]); if (due && !tradePairs.length) throw new Error("No pair returned Bitget data. Skipped: " + skipped.join(", "));
    const fskip = skipped.filter((p) => cfg.pairs.includes(p)); if (due && fskip.length) warn = "Skipped (no Bitget futures data): " + fskip.join(", ");
    const price = (p: string): number => { const a = cs[p] || fc[p]; return a && a.length ? a[a.length - 1].c : 0; };
    const closeIt = async (p: Pos, px: number, why: string) => { const pnl = pnlOf(p, px);
      await rest(`ttm_engine_positions?id=eq.${p.id}`, {method: "PATCH", body: JSON.stringify({status: "closed", closed_at: new Date().toISOString(), exit_price: px, pnl, close_reason: why})}); log.push(`closed ${p.pair} ${why} ${pnl.toFixed(2)}`);
      await alertTg(`${pnl >= 0 ? "\u{1F7E2}" : "\u{1F534}"} ${p.pair.replace("USDT", "")} ${p.side.toUpperCase()} closed`, `${sgn(pnl / p.margin * 100)} on margin (${why === "ai" ? "agent exit" : why})`); };
    // 1) stops and targets (5 minute candles first, then the chosen time frame), then trailing stops
    let still: Pos[] = [], closedNow = 0;
    for (const p of open) { const hit = (fc[p.pair] ? checkExit(p, fc[p.pair], 5 * MIN) : null) || (cs[p.pair] ? checkExit(p, cs[p.pair], T.ms) : null); if (hit) { await closeIt(p, hit.price, hit.reason); closedNow++; } else still.push(p); }
    for (const p of still) { if (!p.trail_atr || !cs[p.pair]) continue; const ns = trailStop(p, fc[p.pair] || cs[p.pair], atr(cs[p.pair]), fc[p.pair] ? 5 * MIN : T.ms), px = price(p.pair);
      if (ns != null && px > 0 && (p.side === "long" ? ns < px : ns > px)) { await rest(`ttm_engine_positions?id=eq.${p.id}`, {method: "PATCH", body: JSON.stringify({sl: ns})}); p.sl = ns; log.push(`trailed ${p.pair} stop to ${ns}`); } }
    // 2) account
    const closed = await get("ttm_engine_positions?select=pnl,pair,side,entry,exit_price,close_reason,closed_at,strategy&status=eq.closed&order=closed_at.desc&limit=200");
    const realised = closed.reduce((t: number, x: any) => t + num(x.pnl || 0), 0), start = num(cfgRow.start_balance);
    const unreal = (ps: Pos[]) => ps.reduce((t, p) => t + (price(p.pair) ? pnlOf(p, price(p.pair)) : 0), 0);
    const account = (ps: Pos[]) => { const eq = start + realised + unreal(ps), cash = start + realised - ps.reduce((t, p) => t + p.margin, 0); return {equity: eq, cash}; };
    let acc = account(still);
    if (due) {
      // 3) ask the agent
      asked = true; cfg.pairs = tradePairs; const now = Date.now(), snaps = cfg.pairs.map((p) => snapshot(p, cs[p], T.ms, now));
      const content = JSON.stringify({time_frame: T.label, strategies_switched_on: cfg.strategies.map((k) => k + " = " + STRATS[k].name), account: {equity: +acc.equity.toFixed(2), free_cash: +acc.cash.toFixed(2), risk_per_trade_pct: cfg.risk_pct, max_open_positions: cfg.max_open, max_leverage: cfg.max_lev},
        open_positions: still.map((p) => ({pair: p.pair, side: p.side, strategy: p.strategy || null, entry: p.entry, sl: p.sl, tp: p.tp, trailing_atr: p.trail_atr || null, unrealised_usd: +pnlOf(p, price(p.pair)).toFixed(2), opened: p.opened_at})),
        recent_closed: closed.slice(0, 5).map((x: any) => ({pair: x.pair, side: x.side, strategy: x.strategy || null, pnl: +num(x.pnl).toFixed(2), how: x.close_reason})), market: snaps, time_utc: new Date().toISOString()});
      let raw = ""; try { raw = await ask(cfgRow.model || "claude-sonnet-5-5", buildSystem(cfg.strategies, T.label), content); } catch (e) { err = String(e).slice(0, 300); }
      agentReplied = !!raw; const decisions = parseDecisions(raw); if (raw && !decisions.length) err = "The agent reply could not be read";
      // 4) check each decision against the hard rules, then simulate it
      for (const d of decisions) {
        const pair = String(d.pair || ""), px = cs[pair] ? price(pair) : 0, act = String(d.action || "hold"); let ok = false, why = "";
        if (!cs[pair]) why = "unknown pair";
        else if (act === "hold") ok = true;
        else if (act === "close") { const p = still.find((x) => x.pair === pair); if (p) { await closeIt(p, px, "ai"); still = still.filter((x) => x.id !== p.id); ok = true; closedNow++; } else why = "nothing to close"; }
        else { acc = account(still); const v = validateOpen(d, px, acc.equity, acc.cash, still, cfg);
          if (v.ok) { const ins = await rest("ttm_engine_positions", {method: "POST", headers: {Prefer: "return=representation"}, body: JSON.stringify({pair, ...v.pos, reason: String(d.reason || "").slice(0, 600)})});
            const row = (await ins.json())[0]; if (row) { still.push({...row, entry: v.pos.entry, units: v.pos.units, notional: v.pos.notional, lev: v.pos.lev, margin: v.pos.margin, sl: v.pos.sl, tp: v.pos.tp, risk_usd: v.pos.risk_usd, trail_atr: v.pos.trail_atr}); ok = true; log.push(`opened ${act} ${pair} (${v.pos.strategy})`); await alertTg(`\u26A1 ${pair.replace("USDT", "")} ${v.pos.side.toUpperCase()} opened`, `Timeframe: ${T.label} \u00B7 ${stratName(v.pos.strategy)}`); } else why = "could not save"; }
          else why = v.reason; }
        await rest("ttm_engine_decisions", {method: "POST", headers: {Prefer: "return=minimal"}, body: JSON.stringify({pair, action: act, price: px || null, reason: String(d.reason || "").slice(0, 600), accepted: ok, reject_reason: ok ? null : why, strategy: d.strategy || null, timeframe: T.label, raw: d})});
      }
    }
    // 5) equity snapshot (when the agent was asked or a trade closed)
    if (due || closedNow) { acc = account(still); await rest("ttm_engine_equity", {method: "POST", headers: {Prefer: "return=minimal"}, body: JSON.stringify({equity: acc.equity, cash: acc.cash, unrealised: unreal(still)})}); }
  } catch (e) { err = String(e).slice(0, 300); }
  const patch: Record<string, unknown> = {last_tick: new Date().toISOString()};
  if (asked || err) patch.last_error = err || warn || null;
  if (asked && (agentReplied || !err)) patch.last_agent = new Date().toISOString();
  await rest("ttm_engine_config?id=eq.1", {method: "PATCH", body: JSON.stringify(patch)});
  return out({ok: !err, error: err || undefined, time_frame: T.label, asked_agent: asked, log});
});
