// TTM TradFi order watcher. Runs every 5 minutes (see supabase/tradfi_watch.sql), with nobody signed in.
// For the admin's SPOT orders placed from TTM LENS, TradFi (stocks) and crypto (long only, no leverage):
//   limit order whose price was reached  -> marks it collected and posts "limit order collected" to the member feed
//   take profit / part take profit hit    -> books that share of the position and posts "took partial profit" / "closed"
// Then it republishes the TradFi > TTM Spot holdings (crypto holdings refresh the next time the crypto terminal is open). The feed's normal phone-alert webhook sends the notifications.
// Keep Verify JWT OFF (the function checks the ENGINE_KEY secret, same as engine-tick). Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
const URL_ = Deno.env.get("SUPABASE_URL")!, KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ENGINE_KEY = Deno.env.get("ENGINE_KEY");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const H = {apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json"};
const rest = (path: string, init: any = {}) => fetch(URL_ + "/rest/v1/" + path, {...init, headers: {...H, ...(init.headers || {})}});
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const r1 = (v: number) => Math.round(v * 10) / 10;
const isTf = (x: any) => x && x.snap && x.snap.acc === "tradfi" && x.snap.mkt === "spot" && x.snap.long !== false;

type Candle = {t: number, h: number, l: number};
async function candles(asset: string, mk: string): Promise<Candle[]> {
  const sym = mk === "au" ? asset + ".AX" : asset;
  for (const host of ["query1", "query2"]) {
    try {
      const x = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=5m&includePrePost=false`, {headers: {"User-Agent": UA, Accept: "application/json"}});
      if (!x.ok) continue;
      const j = await x.json(), r = j?.chart?.result?.[0]; if (!r?.timestamp) continue;
      const q = r.indicators?.quote?.[0] || {}, out: Candle[] = [];
      r.timestamp.forEach((t: number, i: number) => { if (q.high?.[i] != null && q.low?.[i] != null) out.push({t: t * 1000, h: q.high[i], l: q.low[i]}); });
      if (out.length) return out;
    } catch (_e) { /* next host */ }
  }
  return [];
}
async function post(row: any) {
  await rest("ttm_spot_feed?on_conflict=ukey", {method: "POST", headers: {Prefer: "resolution=ignore-duplicates,return=minimal"}, body: JSON.stringify(row)});
}
function feedRow(kind: string, x: any, ukey: string, pct?: number) {
  const A = x.snap.asset;
  const T: any = {fill: ["TTM TradFi Spot Long limit order on " + A + " has been collected", ""], part: ["TTM took partial profit on " + A, pct != null ? pct + "% of the position sold" : ""], sell: ["TTM closed its TradFi Spot Long position on " + A, ""]};
  return {ukey, kind, asset: A, title: T[kind][0], body: T[kind][1], pct: null, market: "tradfi"};
}
// Same maths as tfpublish.js (TradFi > TTM Spot holdings, percentages only)
function snapshot(L: any[], start: number) {
  const mine = L.filter((x) => x.snap && x.snap.acc === "tradfi"), open = mine.filter((x) => x.status === "open"), closed = mine.filter((x) => x.status === "closed" && x.res);
  const curPx = (x: any) => x.snap.manualPx > 0 ? x.snap.manualPx : x.snap.E;
  const real = closed.reduce((t, x) => t + x.res.pnl, 0), equity = start + real, locked = open.reduce((t, x) => t + x.snap.margin, 0), cash = Math.max(0, equity - locked);
  const pos: any = {}, pend: any = {}; let unreal = 0, pt = 0;
  open.forEach((x) => { const sn = x.snap;
    if (x.fill === "pending") { const o = pend[sn.asset] || (pend[sn.asset] = {a: sn.asset, m: 0, p: []}); o.m += sn.margin; o.p.push(sn.E); pt += sn.margin; return; }
    const dir0 = sn.long === false ? -1 : 1, val = sn.mkt === "spot" ? sn.units * curPx(x) : sn.margin + sn.units * (curPx(x) - sn.E) * dir0, cost = sn.mkt === "spot" ? sn.units * sn.E : sn.margin;
    const parts = closed.filter((y) => y.name.indexOf(x.name + " (") === 0 && /% closed\)$/.test(y.name)), pc = parts.reduce((t: number, y: any) => t + y.snap.margin, 0), bk = parts.reduce((t: number, y: any) => t + y.res.pnl, 0);
    const o = pos[sn.asset] || (pos[sn.asset] = {a: sn.asset, val: 0, cost: 0, all: 0, bk: 0, since: x.opened || x.t}); o.val += val; o.cost += cost; o.all += cost + pc; o.bk += bk; o.since = Math.min(o.since, x.opened || x.t); unreal += val - cost; });
  const list: any[] = Object.keys(pos).map((k) => pos[k]), pl: any[] = Object.keys(pend).map((k) => pend[k]), tot = list.reduce((t, o) => t + o.val, 0) + cash + pt;
  if (!(tot > 0)) return {items: [], pending: [], sold: [], cash: 100, result: 0};
  return {cash: r1(cash / tot * 100), result: start > 0 ? r1((real + unreal) / start * 100) : 0,
    items: list.sort((a, b) => b.val - a.val).map((o) => ({a: o.a, lev: 0, pct: r1(o.val / tot * 100), chg: o.cost ? r1((o.val / o.cost - 1) * 100) : 0, tot: o.all ? r1((o.val - o.cost + o.bk) / o.all * 100) : 0, since: o.since})),
    pending: pl.sort((a, b) => b.m - a.m).map((o) => ({a: o.a, pct: r1(o.m / tot * 100), p: o.p.slice(0, 5)})),
    sold: closed.map((x) => ({a: x.snap.asset, bought: x.opened || x.t, sold: x.res.closed || x.t, pct: x.snap.margin ? r1(x.res.pnl / x.snap.margin * 100) : 0, part: /% closed\)$/.test(x.name)})).sort((a, b) => b.sold - a.sold).slice(0, 15)};
}

// ---------- TradFi spot (placed from LENS)
async function doTradfi(L: any[]) {
  const W = L.filter((x) => x.status === "open" && isTf(x) && x.s && x.s.mk && (x.fill === "pending" || (x.snap.tps || []).some((t: any) => t && t.P > 0 && !t.hit)));
  const cache: Record<string, Candle[]> = {}; let changed = false, n = 0;
  for (const x of W.slice()) {
    const sn = x.snap, k = x.s.mk + ":" + sn.asset; if (!cache[k]) cache[k] = await candles(sn.asset, x.s.mk); const cs = cache[k]; if (!cs.length) continue;
    if (x.fill === "pending") {
      const t0 = x.t || 0, c = cs.find((c) => c.t > t0 && (x.side === -1 ? c.h >= sn.E : c.l <= sn.E));
      if (!c) continue;
      x.fill = "filled"; x.opened = Math.max(c.t, t0); changed = true; n++; await post(feedRow("fill", x, "tffill:" + x.id));
    }
    const since = x.opened || x.t || 0;
    for (const tp of (sn.tps || []).filter((t: any) => t && t.P > 0 && !t.hit).sort((p: any, q: any) => p.P - q.P)) {
      if (x.status !== "open") break;
      if (!cs.some((c) => c.t > since && c.h >= tp.P)) continue;
      tp.hit = true; changed = true; n++; if (!sn.units0) sn.units0 = sn.units;
      const f = Math.min(1, (+tp.share || 100) / 100 * sn.units0 / sn.units), pnl = sn.units * f * (tp.P - sn.E);
      if (f >= 0.999) { x.status = "closed"; x.res = {pnl: Math.round(pnl * 100) / 100, r: sn.margin ? pnl / sn.margin : 0, how: "Take profit at " + tp.P, closed: Date.now()}; await post(feedRow("sell", x, "tfsell:" + x.id + ":" + x.res.closed)); }
      else {
        const part = JSON.parse(JSON.stringify(x)); part.id = uid(); part.name = x.name + " (" + Math.round(f * 1000) / 10 + "% closed)"; part.status = "closed";
        for (const kk of ["units", "notional", "margin", "riskUsd"]) { part.snap[kk] = sn[kk] * f; sn[kk] = sn[kk] * (1 - f); }
        part.res = {pnl: Math.round(pnl * 100) / 100, r: part.snap.margin ? pnl / part.snap.margin : 0, how: "Part take profit at " + tp.P, closed: Date.now()};
        L.splice(L.indexOf(x) + 1, 0, part); x.booked = Math.round(((x.booked || 0) + pnl) * 100) / 100; await post(feedRow("part", x, "tfpart:" + part.id, Math.round(f * 1000) / 10));
      }
    }
  }
  return {changed, n};
}

// ---------- Crypto SPOT (placed from LENS). Same words and rules as the crypto terminal's own tracker (spotEv in crypto/index.html).
const cryptoMsg = (kind: string, A: string, pct?: number) => ({
  fill: [`TTM Spot Long limit order on ${A} has been collected`, ""],
  tp: [`TTM Spot Long TP hit on ${A}`, pct != null ? `TP hit at ${pct}% of the trade, ${Math.round((100 - pct) * 10) / 10}% remaining${pct < 99.99 ? ", SL to entry" : ""}` : ""],
  sell: [`TTM closed its Spot Long position on ${A}`, ""],
} as any)[kind];
const cPost = (kind: string, A: string, ukey: string, pct?: number) => { const T = cryptoMsg(kind, A, pct); return post({ukey, kind, asset: A, title: T[0], body: T[1], pct: null, market: "crypto"}); };
async function cCandles(a: string, from: number, step: number): Promise<Candle[]> {
  const five = step === 300000;
  const tries: (() => Promise<Candle[]>)[] = [
    async () => { const d = await (await fetch(`https://api.bitget.com/api/v2/spot/market/candles?symbol=${a}USDT&granularity=${five ? "5min" : "1h"}&startTime=${from}&limit=1000`)).json(); return (d.data || []).map((r: any) => ({t: +r[0], h: +r[2], l: +r[3]})); },
    async () => (await (await fetch(`https://api.binance.com/api/v3/klines?symbol=${a}USDT&interval=${five ? "5m" : "1h"}&startTime=${from}&limit=1000`)).json()).map((r: any) => ({t: +r[0], h: +r[2], l: +r[3]})),
    async () => (await (await fetch(`https://api.mexc.com/api/v3/klines?symbol=${a}USDT&interval=${five ? "5m" : "60m"}&startTime=${from}&limit=500`)).json()).map((r: any) => ({t: +r[0], h: +r[2], l: +r[3]})),
  ];
  for (const f of tries) { try { const r = (await f()).filter((c) => isFinite(c.t) && isFinite(c.h) && isFinite(c.l)).sort((p, q) => p.t - q.t); if (r.length) return r; } catch (_e) { /* next */ } }
  return [];
}
function settle(sn: any, hits: boolean[], rest: number) {
  let pnl = 0, usedU = 0; const fee = sn.fee || 0;
  (sn.tps || []).forEach((t: any, i: number) => { if (hits[i]) { const u = sn.units * t.share / 100; pnl += u * Math.abs(t.P - sn.E) - u * fee * (sn.E + t.P); usedU += u; } });
  const ru = Math.max(0, sn.units - usedU), mv = rest - sn.E;
  return pnl + ru * mv - ru * fee * (sn.E + rest);
}
async function doCrypto(L: any[]) {
  const C = L.filter((x) => x.status === "open" && x.snap && x.snap.acc === "spot" && x.snap.mkt === "spot" && x.snap.long !== false && !x.quiet && !x.orders && !x.wkStop && x.snap.asset);
  let changed = false, n = 0; const now = Date.now();
  for (const x of C) {
    const sn = x.snap, A = sn.asset; sn.tps = Array.isArray(sn.tps) ? sn.tps : [];
    const pending = x.fill === "pending", side = x.side || 1;
    let from = x.wkAt || (pending ? x.t : (x.filledAt || x.opened || x.t)); from = Math.max(from || 0, now - 40 * 864e5);
    const step = now - from <= 2.9 * 864e5 ? 300000 : 3600000, cs = await cCandles(A, from, step); if (!cs.length) continue;
    let fillEnd: number | null = pending ? null : (x.filledAt || x.opened || x.t), last = from;
    for (const c of cs) {
      if (c.t < from) continue; const end = c.t + step; if (end > now) break; last = end;
      if (pending && fillEnd == null) { if (side > 0 ? c.l <= sn.E : c.h >= sn.E) { x.fill = "filled"; x.filledAt = end; fillEnd = end; changed = true; n++; await cPost("fill", A, "fill:" + x.id); } continue; }
      if (fillEnd != null && c.t >= fillEnd) {
        if (!sn.noSL && c.l <= sn.SL) { x.wkStop = c.t; changed = true; break; }
        x.hit = x.hit || sn.tps.map(() => false);
        sn.tps.forEach((t: any, i: number) => { if (!x.hit[i] && c.h >= t.P) { x.hit[i] = true; changed = true; } });
      }
    }
    if (x.wkAt !== last) { x.wkAt = last; changed = true; }
    if (x.fill === "pending") continue;
    x.hit = x.hit || sn.tps.map(() => false); x.sent = x.sent || {tp: sn.tps.map(() => false), sl: false};
    for (let i = 0; i < sn.tps.length; i++) if (x.hit[i] && !x.sent.tp[i]) { x.sent.tp[i] = true; changed = true; n++; await cPost("tp", A, "tp:" + x.id + ":" + i, Math.round(sn.tps.reduce((a: number, q: any, k: number) => a + (k <= i && x.hit[k] ? q.share : 0), 0) * 10) / 10); }
    const nHit = x.hit.filter(Boolean).length, sh = sn.tps.reduce((t: number, q: any) => t + q.share, 0);
    const close = async (pnl: number, how: string) => { x.status = "closed"; x.res = {pnl: Math.round(pnl * 100) / 100, r: pnl / (sn.riskUsd || 1), how, closed: x.wkStop || Date.now(), auto: true}; x.slSeen = 0; changed = true; n++; await cPost("sell", A, "sell:" + x.id + ":" + x.res.closed); };
    if (x.wkStop) { x.sent.sl = true; await close(settle(sn, x.hit, sn.SL), nHit ? "TP" + x.hit.map((h: boolean, k: number) => h ? k + 1 : 0).filter(Boolean).join(" + TP") + " hit; rest stopped at the stop (closed automatically)" : "Stopped out at the stop (closed automatically)"); }
    else if (sn.tps.length && nHit === sn.tps.length && sh >= 99.9) await close(settle(sn, x.hit.map(() => true), sn.E), "All " + sn.tps.length + " target" + (sn.tps.length > 1 ? "s" : "") + " hit (closed automatically)");
  }
  return {changed, n};
}

async function run() {
  const adm = await (await rest("ttm_profiles?is_admin=eq.true&select=id")).json();
  const out: any[] = [];
  for (const a of (Array.isArray(adm) ? adm : [])) {
    const row = (await (await rest(`ttm_user_data?user_id=eq.${a.id}&select=data,updated_at`)).json())?.[0]; if (!row?.data) continue;
    const data = row.data, L: any[] = Array.isArray(data.saved) ? data.saved : [];
    const tf = await doTradfi(L), cr = await doCrypto(L);
    if (!tf.changed && !cr.changed) continue;
    data.saved = L;
    await rest(`ttm_user_data?user_id=eq.${a.id}`, {method: "PATCH", headers: {Prefer: "return=minimal"}, body: JSON.stringify({data, updated_at: new Date().toISOString()})});
    if (tf.changed) {
      const bal = data.bals && data.bals.tradfi != null && isFinite(parseFloat(data.bals.tradfi)) ? parseFloat(data.bals.tradfi) : 5000;
      const cur = (await (await rest("ttm_settings?key=eq.holdings&select=value")).json())?.[0]?.value || {};
      await rest("ttm_settings", {method: "POST", headers: {Prefer: "resolution=merge-duplicates,return=minimal"}, body: JSON.stringify([{key: "holdings", value: {...cur, tradfi: snapshot(L, bal), t: Date.now()}}])});
    }
    out.push({user: a.id, tradfi: tf.n, crypto: cr.n});
  }
  return out;
}
Deno.serve(async (req) => {
  if (!ENGINE_KEY || req.headers.get("x-engine-key") !== ENGINE_KEY) return new Response("no", {status: 401});
  try { return new Response(JSON.stringify({ok: true, done: await run()}), {headers: {"Content-Type": "application/json"}}); }
  catch (e) { return new Response(JSON.stringify({ok: false, error: String(e)}), {status: 500}); }
});
