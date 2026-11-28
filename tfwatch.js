// TTM LENS spot orders -> member feed. Admin only, TradFi SPOT only (no leverage alerts).
// Buy at market: posts straight away. Limit order: posts only once the price has reached it (collected).
// Take profit / part take profit: posts when the price reaches the TP, and books that share of the position.
// Runs while TTM LENS or TradFi is open (it needs a live price), checked about every 45 seconds.
(function(){
const SK = 'ttm_rr_saved_v1';
const rd = () => { try{ const v = JSON.parse(localStorage.getItem(SK) || '[]'); return Array.isArray(v) ? v : []; }catch(e){ return []; } };
const wr = v => { try{ localStorage.setItem(SK, JSON.stringify(v)); }catch(e){} try{ if(window.ttmSync) ttmSync.dirty(); }catch(e){} };
const admin = () => !!(window.ttmIsAdmin && ttmIsAdmin());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isTf = x => x && x.snap && x.snap.acc === 'tradfi' && x.snap.mkt === 'spot' && x.snap.long !== false;
function ev(kind, x, ukey, pct){ try{ if(!admin() || !window.ttmFeedPost || !isTf(x)) return; const A = x.snap.asset,
  T = {buy: ['TTM opened a TradFi Spot Long position on ' + A, ''], fill: ['TTM TradFi Spot Long limit order on ' + A + ' has been collected', ''], part: ['TTM took partial profit on ' + A, pct != null ? pct + '% of the position sold' : ''], sell: ['TTM closed its TradFi Spot Long position on ' + A, '']}[kind];
  if(T) ttmFeedPost({ukey, kind, asset: A, title: T[0], body: T[1], pct: null, market: 'tradfi'}); }catch(e){} }
let cfg = null; const quotes = {};
async function quote(m){ try{ cfg = cfg || await (await fetch('../ttm_config.json')).json(); const r = await fetch(cfg.supabase_url + '/functions/v1/stock-live?m=' + m, {headers: {apikey: cfg.supabase_anon_key || ''}}); if(!r.ok) return null; const j = await r.json(); return j && j.q ? j.q : null; }catch(e){ return null; } }
let busy = false;
async function check(){ if(busy || document.hidden || !admin()) return; busy = true; try{
  try{ if(window.ttmSync && ttmSync.pull) await ttmSync.pull(); }catch(e){}
  let L = rd(); const W = L.filter(x => x.status === 'open' && isTf(x) && x.s && x.s.mk && (x.fill === 'pending' || (x.snap.tps || []).some(t => t && t.P > 0 && !t.hit)));
  if(!W.length) return; const mk = {}; W.forEach(x => mk[x.s.mk] = 1); for(const m of Object.keys(mk)) quotes[m] = await quote(m);
  let ch = false; L = rd();
  L.slice().forEach(x => { if(x.status !== 'open' || !isTf(x) || !x.s || !x.s.mk) return; const q = quotes[x.s.mk], A = x.snap.asset, r = q && (q[A] || q[A + '.AX']); const p = r && +r[0]; if(!(p > 0)) return; const sn = x.snap;
    if(x.fill === 'pending'){ const hit = (x.side === -1) ? p >= sn.E : p <= sn.E; if(hit){ x.fill = 'filled'; x.opened = Date.now(); ch = true; ev('fill', x, 'tffill:' + x.id); } return; }
    (sn.tps || []).forEach(tp => { if(!tp || !(tp.P > 0) || tp.hit || x.status !== 'open' || p < tp.P) return; tp.hit = true; ch = true;
      if(!sn.units0) sn.units0 = sn.units; const f = Math.min(1, (+tp.share || 100) / 100 * sn.units0 / sn.units), pnl = sn.units * f * (tp.P - sn.E);
      if(f >= 0.999){ x.status = 'closed'; x.res = {pnl: Math.round(pnl * 100) / 100, r: sn.margin ? pnl / sn.margin : 0, how: 'Take profit at ' + tp.P, closed: Date.now()}; ev('sell', x, 'tfsell:' + x.id + ':' + x.res.closed); }
      else { const part = JSON.parse(JSON.stringify(x)); part.id = uid(); part.name = x.name + ' (' + Math.round(f * 1000) / 10 + '% closed)'; part.status = 'closed'; ['units', 'notional', 'margin', 'riskUsd'].forEach(k => { part.snap[k] = sn[k] * f; sn[k] = sn[k] * (1 - f); }); part.res = {pnl: Math.round(pnl * 100) / 100, r: part.snap.margin ? pnl / part.snap.margin : 0, how: 'Part take profit at ' + tp.P, closed: Date.now()}; L.splice(L.indexOf(x) + 1, 0, part); x.booked = Math.round(((x.booked || 0) + pnl) * 100) / 100; ev('part', x, 'tfpart:' + part.id, Math.round(f * 1000) / 10); } }); });
  if(ch){ wr(L); try{ if(window.tfPanelRefresh) tfPanelRefresh(); else if(window.tfPublish) tfPublish(); }catch(e){} try{ if(window.ttmLensRefresh) ttmLensRefresh(); }catch(e){} }
}catch(e){} busy = false; }
window.tfWatch = {check, buy: x => ev('buy', x, 'tfopen:' + x.id)};
setTimeout(check, 9000); setInterval(check, 45000);
})();
