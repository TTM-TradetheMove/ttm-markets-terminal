// TTM TradFi order watcher. Runs every 5 minutes (see supabase/tradfi_watch.sql), with nobody signed in.
// For the admin's TradFi SPOT orders placed from TTM LENS (long only, no leverage):
//   limit order whose price was reached  -> marks it collected and posts "limit order collected" to the member feed
//   take profit / part take profit hit    -> books that share of the position and posts "took partial profit" / "closed"
// Then it republishes the TradFi > TTM Spot holdings. The feed's normal phone-alert webhook sends the notifications.
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

async function run() {
  const adm = await (await rest("ttm_profiles?is_admin=eq.true&select=id")).json();
  const out: any[] = [];
  for (const a of (Array.isArray(adm) ? adm : [])) {
    const row = (await (await rest(`ttm_user_data?user_id=eq.${a.id}&select=data,updated_at`)).json())?.[0]; if (!row?.data) continue;
    const data = row.data, L: any[] = Array.isArray(data.saved) ? data.saved : [];
    const W = L.filter((x) => x.status === "open" && isTf(x) && x.s && x.s.mk && (x.fill === "pending" || (x.snap.tps || []).some((t: any) => t && t.P > 0 && !t.hit)));
    if (!W.length) continue;
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
    if (!changed) continue;
    data.saved = L;
    await rest(`ttm_user_data?user_id=eq.${a.id}`, {method: "PATCH", headers: {Prefer: "return=minimal"}, body: JSON.stringify({data, updated_at: new Date().toISOString()})});
    const bal = data.bals && data.bals.tradfi != null && isFinite(parseFloat(data.bals.tradfi)) ? parseFloat(data.bals.tradfi) : 5000;
    const cur = (await (await rest("ttm_settings?key=eq.holdings&select=value")).json())?.[0]?.value || {};
    await rest("ttm_settings", {method: "POST", headers: {Prefer: "resolution=merge-duplicates,return=minimal"}, body: JSON.stringify([{key: "holdings", value: {...cur, tradfi: snapshot(L, bal), t: Date.now()}}])});
    out.push({user: a.id, events: n});
  }
  return out;
}
Deno.serve(async (req) => {
  if (!ENGINE_KEY || req.headers.get("x-engine-key") !== ENGINE_KEY) return new Response("no", {status: 401});
  try { return new Response(JSON.stringify({ok: true, done: await run()}), {headers: {"Content-Type": "application/json"}}); }
  catch (e) { return new Response(JSON.stringify({ok: false, error: String(e)}), {status: 500}); }
});
