// TTM Automated Trading Engine, version 1: paper trading only. No exchange keys, no real orders.
// Each hour: manage open positions (stops and targets), ask the TTM agent what to do, check it against the hard risk rules, record simulated fills.
// Secrets needed: ANTHROPIC_API_KEY, ENGINE_KEY. Keep "Verify JWT" OFF (the function checks ENGINE_KEY or an admin sign-in itself).
import {Candle, Pos, Cfg, HOUR, SYSTEM, snapshot, checkExit, pnlOf, validateOpen, parseDecisions} from "./logic.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!, KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = {apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json"};
const CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-engine-key", "Access-Control-Allow-Methods": "POST, OPTIONS"};
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o), {status: s, headers: {...CORS, "Content-Type": "application/json"}});
const rest = (p: string, o: any = {}) => fetch(URL_ + "/rest/v1/" + p, {...o, headers: {...H, ...(o.headers || {})}});
const get = async (p: string) => { const r = await rest(p); const j = await r.json(); return Array.isArray(j) ? j : []; };
const num = (x: unknown) => Number(x);

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
      await rest(`ttm_engine_positions?id=eq.${p.id}`, {method: "PATCH", body: JSON.stringify({status: "closed", closed_at: new Date().toISOString(), exit_price: px, pnl, close_reason: why})}); log.push(`closed ${p.pair} ${why} ${pnl.toFixed(2)}`); };
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
          const row = (await ins.json())[0]; if (row) { still.push({...row, entry: v.pos.entry, units: v.pos.units, notional: v.pos.notional, lev: v.pos.lev, margin: v.pos.margin, sl: v.pos.sl, tp: v.pos.tp, risk_usd: v.pos.risk_usd}); ok = true; log.push(`opened ${act} ${pair}`); } else why = "could not save"; }
        else why = v.reason; }
      await rest("ttm_engine_decisions", {method: "POST", headers: {Prefer: "return=minimal"}, body: JSON.stringify({pair, action: act, price: px || null, reason: String(d.reason || "").slice(0, 600), accepted: ok, reject_reason: ok ? null : why, raw: d})});
    }
    // 5) equity snapshot and status
    acc = account(still); await rest("ttm_engine_equity", {method: "POST", headers: {Prefer: "return=minimal"}, body: JSON.stringify({equity: acc.equity, cash: acc.cash, unrealised: unreal(still)})});
  } catch (e) { err = String(e).slice(0, 300); }
  await rest("ttm_engine_config?id=eq.1", {method: "PATCH", body: JSON.stringify({last_tick: new Date().toISOString(), last_error: err || warn || null})});
  return out({ok: !err, error: err || undefined, log});
});
