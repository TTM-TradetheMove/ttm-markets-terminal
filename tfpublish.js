// Publishes TTM's TradFi holdings (percentages only) from the saved trades. Same maths as the TradFi page, so a limit order or buy placed from TTM LENS shows in TradFi > TTM Spot straight away. Admin only (ttmPublishHoldings ignores everyone else).
(function(){
const SK = 'ttm_rr_saved_v1', BK = 'ttm_rr_bals_v1', ACC = 'tradfi';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : null; };
const usd = v => window.ttmHid && window.ttmHid() ? '\u2022\u2022\u2022\u2022\u2022' : (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
const px = v => v >= 1000 ? Math.round(v).toLocaleString() : v >= 1 ? v.toFixed(2) : v.toPrecision(3);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const rd = (k, d) => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } };
const wr = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} if(window.ttmSync) ttmSync.dirty(); };
const acc = x => (x.snap && x.snap.acc) || (x.s && x.s.acc) || 'lev';
const mine = () => rd(SK, []).filter(x => x.snap && acc(x) === ACC);
const start = () => { const b = rd(BK, {}); return num(b[ACC]) != null ? num(b[ACC]) : 5000; };
const curPx = x => x.snap.manualPx > 0 ? x.snap.manualPx : x.snap.E;
const r1 = v => Math.round(v * 10) / 10;
function snapshot(){
  const L = mine(), open = L.filter(x => x.status === 'open'), closed = L.filter(x => x.status === 'closed' && x.res);
  const real = closed.reduce((t, x) => t + x.res.pnl, 0), equity = start() + real, locked = open.reduce((t, x) => t + x.snap.margin, 0), cash = Math.max(0, equity - locked);
  const pos = {}, pend = {}; let unreal = 0, pt = 0;
  open.forEach(x => { const sn = x.snap;
    if(x.fill === 'pending'){ const o = pend[sn.asset] || (pend[sn.asset] = {a: sn.asset, m: 0, p: []}); o.m += sn.margin; o.p.push(sn.E); pt += sn.margin; return; }
    const dir0 = sn.long === false ? -1 : 1, val = sn.mkt === 'spot' ? sn.units * curPx(x) : sn.margin + sn.units * (curPx(x) - sn.E) * dir0, cost = sn.mkt === 'spot' ? sn.units * sn.E : sn.margin, parts = closed.filter(y => y.name.indexOf(x.name + ' (') === 0 && /% closed\)$/.test(y.name)), pc = parts.reduce((t, y) => t + y.snap.margin, 0), bk = parts.reduce((t, y) => t + y.res.pnl, 0);
    const o = pos[sn.asset] || (pos[sn.asset] = {a: sn.asset, val: 0, cost: 0, all: 0, bk: 0, since: x.opened || x.t}); o.val += val; o.cost += cost; o.all += cost + pc; o.bk += bk; o.since = Math.min(o.since, x.opened || x.t); unreal += val - cost; });
  const list = Object.keys(pos).map(k => pos[k]), pl = Object.keys(pend).map(k => pend[k]), tot = list.reduce((t, o) => t + o.val, 0) + cash + pt;
  if(!(tot > 0)) return {items: [], pending: [], sold: [], cash: 100, result: 0};
  return {cash: r1(cash / tot * 100), result: start() > 0 ? r1((real + unreal) / start() * 100) : 0,
    items: list.sort((a, b) => b.val - a.val).map(o => ({a: o.a, lev: 0, pct: r1(o.val / tot * 100), chg: o.cost ? r1((o.val / o.cost - 1) * 100) : 0, tot: o.all ? r1((o.val - o.cost + o.bk) / o.all * 100) : 0, since: o.since})),
    pending: pl.sort((a, b) => b.m - a.m).map(o => ({a: o.a, pct: r1(o.m / tot * 100), p: o.p.slice(0, 5)})),
    sold: closed.map(x => ({a: x.snap.asset, bought: x.opened || x.t, sold: x.res.closed || x.t, pct: x.snap.margin ? r1(x.res.pnl / x.snap.margin * 100) : 0, part: /% closed\)$/.test(x.name)})).sort((a, b) => b.sold - a.sold).slice(0, 15)};
}
window.tfPublish = async () => { try{ if(window.ttmPublishHoldings) await ttmPublishHoldings({tradfi: snapshot()}); }catch(e){} };
})();
