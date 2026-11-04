import webpush from "npm:web-push@3.6.7";
// TTM Automated Trading Engine, version 1: paper trading only. No exchange keys, no real orders.
// Runs every 5 minutes. Every run manages open positions (stops, targets, trailing stops). When a new candle of the chosen time frame has closed it also asks the TTM agent what to do, checks it against the hard risk rules and records simulated fills.
// Secrets needed: ANTHROPIC_API_KEY, ENGINE_KEY. Keep "Verify JWT" OFF (the function checks ENGINE_KEY or an admin sign-in itself).
import {Candle, Pos, Cfg, HOUR, MIN, TFS, STRATS, stratName, aggregateTime, isDue, snapshot, atr, checkExit, trailStop, pnlOf, validateOpen, parseDecisions, buildSystem, REVIEW_SYSTEM, sanitizeReview, rankMovers, pickTimeframe} from "./logic.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!, KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = {apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json"};
const CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-engine-key", "Access-Control-Allow-Methods": "POST, OPTIONS"};
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o), {status: s, headers: {...CORS, "Content-Type": "application/json"}});
const rest = (p: string, o: any = {}) => fetch(URL_ + "/rest/v1/" + p, {...o, headers: {...H, ...(o.headers || {})}});
const get = async (p: string) => { const r = await rest(p); const j = await r.json(); return Array.isArray(j) ? j : []; };
const num = (x: unknown) => Number(x);
type ReviewCfgT = {risk_pct: number; max_lev: number; strategies: string[]; pairs: string[]};
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
const mapPos = (x: any): Pos => ({...x, entry: num(x.entry), units: num(x.units), notional: num(x.notional), lev: num(x.lev), margin: num(x.margin), sl: num(x.sl), tp: x.tp == null ? null : num(x.tp), risk_usd: num(x.risk_usd), trail_atr: x.trail_atr == null ? null : num(x.trail_atr)});
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
async function ask(model: string, system: string, content: string, maxTokens = 3000): Promise<string> {
  const k = Deno.env.get("ANTHROPIC_API_KEY"); if (!k) throw new Error("ANTHROPIC_API_KEY secret is missing");
  const r = await fetch("https://api.anthropic.com/v1/messages", {method: "POST", headers: {"x-api-key": k, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    body: JSON.stringify({model, max_tokens: maxTokens, system, messages: [{role: "user", content}]})});
  const j = await r.json(); if (!r.ok) throw new Error("Agent: " + (j.error?.message || r.status));
  return (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

async function scanPairs(top: number, pick: number): Promise<string[]> {
  const r = await fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES"), j = await r.json();
  if (j.code !== "00000" || !Array.isArray(j.data)) throw new Error("Bitget tickers: " + (j.msg || r.status));
  return rankMovers(j.data.map((x: any) => ({s: String(x.symbol), vol: num(x.usdtVolume || x.quoteVolume), ch: num(x.change24h), hi: num(x.high24h), lo: num(x.low24h), px: num(x.lastPr)})), top, pick);
}

// Approval mode: TTM presses Approve on the dashboard, and the trade is opened at the current price after the same hard rule checks.
async function approveProposal(cfgRow: any, id: number): Promise<{ok: boolean; error?: string}> {
  const pr = (await get(`ttm_engine_proposals?select=*&id=eq.${id}&status=eq.pending`))[0];
  if (!pr) return {ok: false, error: "That proposal is no longer waiting (it was approved, rejected or expired)."};
  const mark = (status: string, result: string) => rest(`ttm_engine_proposals?id=eq.${id}`, {method: "PATCH", body: JSON.stringify({status, decided_at: new Date().toISOString(), result})});
  if (new Date(pr.expires_at).getTime() < Date.now()) { await mark("expired", "Expired before approval"); return {ok: false, error: "That proposal has expired. The agent will propose again if the setup is still there."}; }
  if (!cfgRow.enabled) return {ok: false, error: "The engine is switched off."};
  const cfg: Cfg = {risk_pct: num(cfgRow.risk_pct), max_open: num(cfgRow.max_open), max_lev: num(cfgRow.max_lev), pairs: cfgRow.pairs || [], strategies: (cfgRow.strategies || []).filter((k: string) => STRATS[k])};
  const open = (await get("ttm_engine_positions?select=*&status=eq.open&order=id.asc")).map(mapPos), closed = await get("ttm_engine_positions?select=pnl&status=eq.closed");
  const last = async (p: string) => { const c = await candles(p, "5m", 30); return c[c.length - 1].c; };
  let price = 0; const pxs: Record<string, number> = {};
  try { price = await last(pr.pair); for (const p of new Set(open.map((x) => x.pair))) pxs[p] = p === pr.pair ? price : await last(p); } catch (e) { return {ok: false, error: "Could not get the current price: " + String(e).slice(0, 120)}; }
  const start = num(cfgRow.start_balance), realised = closed.reduce((t: number, x: any) => t + num(x.pnl || 0), 0), unreal = open.reduce((t, p) => t + pnlOf(p, pxs[p.pair] || p.entry), 0);
  const equity = start + realised + unreal, cash = start + realised - open.reduce((t, p) => t + p.margin, 0), stopDist = Math.abs(num(pr.price) - num(pr.sl)) / num(pr.price), drift = Math.abs(price - num(pr.price)) / num(pr.price);
  if (drift > 0.25 * stopDist) { const m = "Price moved " + (drift * 100).toFixed(2) + "% since the proposal, too far from the planned entry. Not opened."; await mark("rejected", m); return {ok: false, error: m}; }
  const d = {pair: pr.pair, action: pr.side === "long" ? "open_long" : "open_short", sl: num(pr.sl), tp: pr.tp == null ? null : num(pr.tp), lev: pr.lev == null ? 1 : num(pr.lev), strategy: pr.strategy || "", trail_atr: pr.trail_atr == null ? null : num(pr.trail_atr)};
  const v = validateOpen(d, price, equity, cash, open, cfg); if (!v.ok) { await mark("rejected", v.reason); return {ok: false, error: "Not opened: " + v.reason + "."}; }
  const ins = await rest("ttm_engine_positions", {method: "POST", headers: {Prefer: "return=representation"}, body: JSON.stringify({pair: pr.pair, ...v.pos, timeframe: pr.timeframe || null, reason: String(pr.reason || "").slice(0, 600)})});
  if (!(await ins.json())[0]) return {ok: false, error: "Could not save the position."};
  await mark("approved", "Opened at " + price);
  await rest("ttm_engine_decisions", {method: "POST", headers: {Prefer: "return=minimal"}, body: JSON.stringify({pair: pr.pair, action: d.action, price, reason: "Approved by TTM. " + String(pr.reason || "").slice(0, 500), accepted: true, strategy: pr.strategy || null, timeframe: pr.timeframe || null, raw: d})});
  await alertTg(`\u26A1 ${pr.pair.replace("USDT", "")} ${pr.side.toUpperCase()} opened`, `Approved \u00B7 Timeframe: ${pr.timeframe || ""} \u00B7 ${stratName(pr.strategy)}`);
  return {ok: true};
}

// Agent Review: the agent studies its own closed trades and writes a summary plus suggestions. TTM approves or dismisses each one on the dashboard.
async function runReview(cfgRow: any): Promise<{ok: boolean; n?: number; error?: string}> {
  const closed = await get("ttm_engine_positions?select=pair,side,strategy,pnl,risk_usd,close_reason,reason,opened_at,closed_at,lev&status=eq.closed&order=closed_at.desc&limit=100");
  if (closed.length < 3) return {ok: false, error: "Need at least 3 closed trades before a review is useful (have " + closed.length + ")."};
  const grp = (f: (x: any) => string) => { const m: Record<string, any[]> = {}; closed.forEach((x: any) => { (m[f(x)] = m[f(x)] || []).push(x); });
    return Object.keys(m).map((k) => { const a = m[k], w = a.filter((x: any) => num(x.pnl) > 0).length, rs = a.filter((x: any) => num(x.risk_usd) > 0).map((x: any) => num(x.pnl) / num(x.risk_usd));
      return {group: k, trades: a.length, won: w, win_rate_pct: Math.round(w / a.length * 100), total_pnl_usd: +a.reduce((t: number, x: any) => t + num(x.pnl), 0).toFixed(2), avg_R: rs.length ? +(rs.reduce((t: number, x: number) => t + x, 0) / rs.length).toFixed(2) : null}; }); };
  const rejected = await get("ttm_engine_decisions?select=reject_reason&accepted=eq.false&action=neq.hold&order=ts.desc&limit=100"), rc: Record<string, number> = {}; rejected.forEach((x: any) => { const k = String(x.reject_reason || "?"); rc[k] = (rc[k] || 0) + 1; });
  const lessons = await get("ttm_engine_suggestions?select=title&kind=eq.lesson&status=eq.approved&order=decided_at.desc&limit=10");
  const cfg: ReviewCfgT = {risk_pct: num(cfgRow.risk_pct), max_lev: num(cfgRow.max_lev), strategies: (cfgRow.strategies || []).filter((k: string) => STRATS[k]), pairs: cfgRow.pairs || []};
  const content = JSON.stringify({settings: {time_frame: cfgRow.timeframe || "1H", strategies_on: cfg.strategies, pairs: cfg.pairs, risk_per_trade_pct: cfg.risk_pct, max_leverage: cfg.max_lev, start_balance: num(cfgRow.start_balance)},
    by_strategy: grp((x) => x.strategy || "none"), by_pair: grp((x) => x.pair || "?"), how_trades_ended: grp((x) => x.close_reason || "?").map((g) => ({how: g.group, trades: g.trades, total_pnl_usd: g.total_pnl_usd})), rejected_trade_reasons: rc, already_approved_lessons: lessons.map((l: any) => l.title),
    recent_trades: closed.slice(0, 60).map((x: any) => ({pair: x.pair, side: x.side, strategy: x.strategy || null, lev: num(x.lev), pnl_usd: +num(x.pnl).toFixed(2), R: num(x.risk_usd) > 0 ? +(num(x.pnl) / num(x.risk_usd)).toFixed(2) : null, ended: x.close_reason, held_hours: x.opened_at && x.closed_at ? +((new Date(x.closed_at).getTime() - new Date(x.opened_at).getTime()) / 3600000).toFixed(1) : null, why_opened: String(x.reason || "").slice(0, 140)}))});
  let raw = ""; try { raw = await ask(Deno.env.get("REVIEW_MODEL") || cfgRow.model || "claude-sonnet-5-5", REVIEW_SYSTEM, content, 2500); } catch (e) { return {ok: false, error: String(e).slice(0, 300)}; }
  const rv = sanitizeReview(raw, cfg); if (!rv) return {ok: false, error: "The review reply could not be read"};
  const ins = await rest("ttm_engine_reviews", {method: "POST", headers: {Prefer: "return=representation"}, body: JSON.stringify({trades_reviewed: closed.length, summary: rv.summary, model: cfgRow.model || null})});
  const row = (await ins.json())[0]; if (!row) return {ok: false, error: "Could not save the review (run engine3.sql first)"};
  if (rv.suggestions.length) await rest("ttm_engine_suggestions", {method: "POST", headers: {Prefer: "return=minimal"}, body: JSON.stringify(rv.suggestions.map((s) => ({review_id: row.id, title: s.title, detail: s.detail, kind: s.kind, change: s.change})))});
  return {ok: true, n: rv.suggestions.length};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers: CORS});
  const who = await adminCall(req); if (!who) return out({ok: false, reason: "not allowed"}, 401);
  const cfgRow = (await get("ttm_engine_config?select=*&id=eq.1"))[0]; if (!cfgRow) return out({ok: false, reason: "run engine.sql first"}, 500);
  let reqBody: any = {}; try { reqBody = await req.json(); } catch (_) { /* no body */ }
  if (reqBody && reqBody.action === "approve") return out(await approveProposal(cfgRow, num(reqBody.id)));
  if (reqBody && reqBody.action === "review") { const rv = await runReview(cfgRow); return out({ok: rv.ok, error: rv.error, suggestions: rv.n}); }
  if (!cfgRow.enabled) return out({ok: true, skipped: "engine is switched off"});
  const tfKey = TFS[cfgRow.timeframe] ? cfgRow.timeframe : "1H", T = TFS[tfKey];
  const cfg: Cfg = {risk_pct: num(cfgRow.risk_pct), max_open: num(cfgRow.max_open), max_lev: num(cfgRow.max_lev), pairs: cfgRow.pairs || [], strategies: (cfgRow.strategies || []).filter((k: string) => STRATS[k])};
  const log: string[] = []; let err = "", warn = "", asked = false, agentReplied = false;
  const mode = cfgRow.mode === "approval" ? "approval" : "auto";
  const due = who === "admin" || isDue(T.ms, cfgRow.last_agent, Date.now());   // "Check now" always asks the agent
  await rest("ttm_engine_proposals?status=eq.pending&expires_at=lt." + encodeURIComponent(new Date().toISOString()), {method: "PATCH", headers: {Prefer: "return=minimal"}, body: JSON.stringify({status: "expired", decided_at: new Date().toISOString(), result: "Expired before approval"})}).catch(() => {});
  try {
    const open: Pos[] = (await get("ttm_engine_positions?select=*&status=eq.open&order=id.asc")).map(mapPos);
    if (due && cfgRow.pair_mode === "auto") { try { const picked = await scanPairs(Math.min(Math.max(num(cfgRow.scan_top) || 50, 10), 200), Math.min(Math.max(num(cfgRow.scan_pick) || 8, 3), 15)); if (picked.length) { cfg.pairs = picked; log.push("scanned: " + picked.join(",")); } } catch (e) { warn = "Auto scan failed, using your list: " + String(e).slice(0, 120); } }
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
      asked = true; cfg.pairs = tradePairs; const lessons = (await get("ttm_engine_suggestions?select=title,detail&kind=eq.lesson&status=eq.approved&order=decided_at.desc&limit=10")).map((l: any) => l.title + (l.detail ? ": " + l.detail : "")); const now = Date.now(), snaps = cfg.pairs.map((p) => snapshot(p, cs[p], T.ms, now));
      const content = JSON.stringify({time_frame: T.label, strategies_switched_on: cfg.strategies.map((k) => k + " = " + STRATS[k].name), account: {equity: +acc.equity.toFixed(2), free_cash: +acc.cash.toFixed(2), risk_per_trade_pct: cfg.risk_pct, max_open_positions: cfg.max_open, max_leverage: cfg.max_lev},
        open_positions: still.map((p) => ({pair: p.pair, side: p.side, strategy: p.strategy || null, entry: p.entry, sl: p.sl, tp: p.tp, trailing_atr: p.trail_atr || null, unrealised_usd: +pnlOf(p, price(p.pair)).toFixed(2), opened: p.opened_at})),
        recent_closed: closed.slice(0, 5).map((x: any) => ({pair: x.pair, side: x.side, strategy: x.strategy || null, pnl: +num(x.pnl).toFixed(2), how: x.close_reason})), approved_lessons: lessons, market: snaps, time_utc: new Date().toISOString()});
      let raw = ""; try { raw = await ask(cfgRow.model || "claude-sonnet-5-5", buildSystem(cfg.strategies, T.label), content); } catch (e) { err = String(e).slice(0, 300); }
      agentReplied = !!raw; const decisions = parseDecisions(raw); if (raw && !decisions.length) err = "The agent reply could not be read";
      // 4) check each decision against the hard rules, then simulate it
      for (const d of decisions) {
        const pair = String(d.pair || ""), px = cs[pair] ? price(pair) : 0, act = String(d.action || "hold"); let ok = false, why = "";
        if (!cs[pair]) why = "unknown pair";
        else if (act === "hold") ok = true;
        else if (act === "close") { const p = still.find((x) => x.pair === pair); if (p) { await closeIt(p, px, "ai"); still = still.filter((x) => x.id !== p.id); ok = true; closedNow++; } else why = "nothing to close"; }
        else { acc = account(still); const v = validateOpen(d, px, acc.equity, acc.cash, still, cfg);
          if (v.ok && mode === "approval") {
            const dup = (await get(`ttm_engine_proposals?select=id&status=eq.pending&pair=eq.${pair}&side=eq.${v.pos.side}&limit=1`)).length;
            if (dup) why = "already waiting for your approval";
            else { const exp = new Date(Date.now() + Math.min(Math.max(2 * T.ms, 30 * MIN), 48 * HOUR)).toISOString();
              const pi = await rest("ttm_engine_proposals", {method: "POST", headers: {Prefer: "return=minimal"}, body: JSON.stringify({expires_at: exp, pair, side: v.pos.side, strategy: v.pos.strategy, timeframe: T.label, price: px, sl: v.pos.sl, tp: v.pos.tp, lev: v.pos.lev, trail_atr: v.pos.trail_atr, reason: String(d.reason || "").slice(0, 600)})});
              if (pi.ok) { why = "awaiting your approval"; log.push(`proposed ${act} ${pair} (${v.pos.strategy})`); await alertTg("TTM Agent needs approval", `${pair.replace("USDT", "")} ${v.pos.side.toUpperCase()} \u00B7 ${stratName(v.pos.strategy)} \u00B7 ${T.label}. Open the engine to approve or reject.`); } else why = "could not save the proposal (run engine4.sql)"; } }
          else if (v.ok) { const ins = await rest("ttm_engine_positions", {method: "POST", headers: {Prefer: "return=representation"}, body: JSON.stringify({pair, ...v.pos, timeframe: T.label, reason: String(d.reason || "").slice(0, 600)})});
            const row = (await ins.json())[0]; if (row) { still.push({...row, entry: v.pos.entry, units: v.pos.units, notional: v.pos.notional, lev: v.pos.lev, margin: v.pos.margin, sl: v.pos.sl, tp: v.pos.tp, risk_usd: v.pos.risk_usd, trail_atr: v.pos.trail_atr}); ok = true; log.push(`opened ${act} ${pair} (${v.pos.strategy})`); await alertTg(`\u26A1 ${pair.replace("USDT", "")} ${v.pos.side.toUpperCase()} opened`, `Timeframe: ${T.label} \u00B7 ${stratName(v.pos.strategy)}`); } else why = "could not save"; }
          else why = v.reason; }
        await rest("ttm_engine_decisions", {method: "POST", headers: {Prefer: "return=minimal"}, body: JSON.stringify({pair, action: act, price: px || null, reason: String(d.reason || "").slice(0, 600), accepted: ok, reject_reason: ok ? null : why, strategy: d.strategy || null, timeframe: T.label, raw: d})});
      }
    }
    // auto time frame: move to a better one when the current one is clearly not working, and tell TTM
    if (due && !err && cfgRow.auto_tf) { const ct = (await get("ttm_engine_positions?select=timeframe,pnl,risk_usd,closed_at&status=eq.closed&order=closed_at.desc&limit=200")).map((x: any) => ({timeframe: x.timeframe, pnl: num(x.pnl || 0), risk_usd: num(x.risk_usd || 0), closed_at: x.closed_at}));
      const ch = pickTimeframe(tfKey, cfgRow.tf_allowed || [], ct, cfgRow.tf_changed_at, Date.now());
      if (ch) { const nowIso = new Date().toISOString(); await rest("ttm_engine_config?id=eq.1", {method: "PATCH", body: JSON.stringify({timeframe: ch.to, tf_changed_at: nowIso})});
        await rest("ttm_engine_decisions", {method: "POST", headers: {Prefer: "return=minimal"}, body: JSON.stringify({pair: null, action: "timeframe_change", reason: `Switched from ${T.label} to ${TFS[ch.to].label}. ${ch.why}`, accepted: true, timeframe: TFS[ch.to].label, raw: ch})});
        log.push(`time frame ${T.label} -> ${TFS[ch.to].label}`); await alertTg("TTM Agent changed its time frame", `${T.label} to ${TFS[ch.to].label}. ${ch.why}`); } }
    // weekly self review (needs at least 10 closed trades the first time, 5 new ones after that)
    if (due && !err) { const lr = (await get("ttm_engine_reviews?select=ts&order=ts.desc&limit=1"))[0];
      if (!lr || Date.now() - new Date(lr.ts).getTime() > 7 * 86400000) { const since = (await get("ttm_engine_positions?select=id&status=eq.closed" + (lr ? "&closed_at=gt." + encodeURIComponent(lr.ts) : "") + "&limit=10")).length;
        if (since >= (lr ? 5 : 10)) { const rv = await runReview(cfgRow); log.push(rv.ok ? "review written: " + rv.n + " suggestions" : "review skipped: " + rv.error); } } }
    // 5) equity snapshot (when the agent was asked or a trade closed)
    if (due || closedNow) { acc = account(still); await rest("ttm_engine_equity", {method: "POST", headers: {Prefer: "return=minimal"}, body: JSON.stringify({equity: acc.equity, cash: acc.cash, unrealised: unreal(still)})}); }
  } catch (e) { err = String(e).slice(0, 300); }
  const patch: Record<string, unknown> = {last_tick: new Date().toISOString()};
  if (asked || err) patch.last_error = err || warn || null;
  if (asked && (agentReplied || !err)) patch.last_agent = new Date().toISOString();
  await rest("ttm_engine_config?id=eq.1", {method: "PATCH", body: JSON.stringify(patch)});
  return out({ok: !err, error: err || undefined, time_frame: T.label, asked_agent: asked, log});
});
