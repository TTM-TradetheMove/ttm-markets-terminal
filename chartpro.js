/* TTM chart popup (BETA): candles, limit-order lines, drawing tools, TTM logo, download / post to chat. Usage: ttmChartOpen({sym:'SOL', orders:[150, 140], title:'Limit orders'}) */
(function(){
const NS = 'http://www.w3.org/2000/svg', BASE = (document.currentScript && document.currentScript.src) ? new URL('.', document.currentScript.src).href : './';
const TFS = [['15m', '15m', '15min'], ['1h', '1H', '1H'], ['4h', '4H', '4H'], ['1d', '1D', '1D'], ['1w', '1W', '1W']];
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const fx = v => v >= 1000 ? v.toLocaleString(undefined, {maximumFractionDigits: 1}) : v >= 1 ? v.toFixed(3) : v.toPrecision(3);
const css = `#tcp{position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:10px}
#tcp .bx{background:var(--panel,#16161a);border:1px solid var(--line,#2a2a2e);border-radius:14px;width:min(980px,100%);max-height:96vh;overflow:auto;padding:12px 14px;color:var(--text,#e8e8ea)}
#tcp .hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}#tcp .hd b{font-size:16px}
#tcp .bt{display:inline-block;font-size:9px;font-weight:800;letter-spacing:.06em;background:var(--gold,#dba118);color:#111;border-radius:4px;padding:2px 6px}
#tcp button{background:rgba(255,255,255,.06);border:1px solid var(--line,#2a2a2e);color:inherit;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer}
#tcp button.on{background:var(--gold,#dba118);color:#111;border-color:transparent;font-weight:700}
#tcp .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0}#tcp .sp{flex:1}
#tcp svg{width:100%;height:auto;display:block;background:#0f0f12;border-radius:10px;touch-action:none}
#tcp .nt{font-size:12px;color:var(--mute,#8b8f9a);margin:6px 0 0}#tcp label{font-size:13px;display:inline-flex;gap:4px;align-items:center}`;
function pickTf(px, orders){ if(!orders.length || !px) return '1h'; const d = Math.max.apply(null, orders.map(o => Math.abs(o - px) / px * 100)); return d < 1.5 ? '15m' : d < 4 ? '1h' : d < 10 ? '4h' : d < 30 ? '1d' : '1w'; }
async function gj(u){ const r = await fetch(u); if(!r.ok) throw 0; return r.json(); }
async function candles(sym, tf){
  const bg = {'15m': '15min', '1h': '1H', '4h': '4H', '1d': '1D', '1w': '1W'}[tf];
  try{ const j = await gj(`https://api.bitget.com/api/v2/spot/market/candles?symbol=${sym}USDT&granularity=${bg}&limit=200`); const d = (j.data || []).map(x => ({t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4]})).sort((a, b) => a.t - b.t); if(d.length > 10) return d; }catch(e){}
  try{ const d = (await gj(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=${tf}&limit=200`)).map(x => ({t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4]})); if(d.length > 10) return d; }catch(e){}
  return [];
}
let ST = null;
function close(){ const e = document.getElementById('tcp'); if(e) e.remove(); document.removeEventListener('keydown', onKey); ST = null; }
function onKey(e){ if(e.key === 'Escape') close(); }
const SK = s => 'ttm_chartpro_draw_' + s;
function save(){ try{ localStorage.setItem(SK(ST.sym), JSON.stringify(ST.draw)); }catch(e){} }
async function open(o){
  close(); const sym = String(o.sym || 'BTC').toUpperCase().replace(/USDT$/, ''), orders = (o.orders || []).filter(x => x > 0);
  let draw = []; try{ draw = JSON.parse(localStorage.getItem(SK(sym)) || '[]'); }catch(e){}
  ST = {sym, orders, tf: o.tf || null, tool: null, pts: [], draw, data: [], title: o.title || 'Chart', mv: null};
  if(!document.getElementById('tcpCss')){ const s = document.createElement('style'); s.id = 'tcpCss'; s.textContent = css; document.head.appendChild(s); }
  const m = document.createElement('div'); m.id = 'tcp';
  m.innerHTML = `<div class="bx"><div class="hd"><img src="${BASE}img/logo0.png" alt="TTM" style="height:26px"><b>${esc(sym)}/USDT</b><span class="bt">BETA</span><span class="sp"></span>${TFS.map(t => `<button data-tf="${t[0]}">${t[1]}</button>`).join('')}<button id="tcpX" title="Close">✕</button></div>
  <div class="row" id="tcpTools">${[['tl', 'Trend line'], ['hl', 'Horizontal line'], ['fib', 'Fib retracement'], ['rc', 'Box']].map(t => `<button data-tool="${t[0]}">${t[1]}</button>`).join('')}<button id="tcpUndo">Undo</button><button id="tcpClr">Clear drawings</button><span class="sp"></span><button id="tcpDl">Download image</button><button id="tcpPost">Post in chat…</button></div>
  <svg id="tcpSvg" viewBox="0 0 900 460"></svg><p class="nt" id="tcpNt">Loading candles…</p></div>`;
  document.body.appendChild(m); document.addEventListener('keydown', onKey);
  m.addEventListener('click', e => { if(e.target === m) close(); });
  m.querySelector('#tcpX').onclick = close;
  m.querySelectorAll('[data-tf]').forEach(b => b.onclick = () => setTf(b.dataset.tf));
  m.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { ST.tool = ST.tool === b.dataset.tool ? null : b.dataset.tool; ST.pts = []; tools(); note(); });
  m.querySelector('#tcpUndo').onclick = () => { ST.draw.pop(); save(); paint(); };
  m.querySelector('#tcpClr').onclick = () => { if(ST.draw.length && confirm('Remove all drawings on this chart?')){ ST.draw = []; save(); paint(); } };
  m.querySelector('#tcpDl').onclick = async () => { const b = await png(); if(!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'TTM-' + ST.sym + '-' + ST.tf + '.png'; a.click(); };
  m.querySelector('#tcpPost').onclick = postChat;
  const sv = m.querySelector('#tcpSvg');
  sv.addEventListener('pointerdown', e => { if(!ST.tool) return; const p = pt(e); ST.pts.push(p); if(ST.tool === 'hl' || ST.pts.length === 2){ ST.draw.push({k: ST.tool, a: ST.pts[0], b: ST.pts[1] || ST.pts[0]}); ST.pts = []; ST.mv = null; save(); } paint(); note(); });
  sv.addEventListener('pointermove', e => { if(ST.tool && ST.pts.length === 1){ ST.mv = pt(e); paint(); } });
  tools(); note();
  await setTf(ST.tf || '1h', !ST.tf);
}
function tools(){ document.querySelectorAll('#tcpTools [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === ST.tool)); }
function note(){ const n = document.getElementById('tcpNt'); if(!n || !ST) return; if(ST.tool){ n.textContent = ST.tool === 'hl' ? 'Tap the chart once to place a horizontal line.' : 'Tap two points on the chart (' + (ST.pts.length ? 'second' : 'first') + ' point).'; return; } n.textContent = ST.data.length ? ST.sym + ' · ' + ST.tf.toUpperCase() + ' · dashed gold lines are your limit orders. Pick a tool to draw. Education only, not financial advice.' : n.textContent; }
async function setTf(tf, auto){
  const n = document.getElementById('tcpNt'); if(n) n.textContent = 'Loading candles…';
  let d = await candles(ST.sym, tf); if(!ST) return;
  if(auto){ const t = pickTf(d.length ? d[d.length - 1].c : 0, ST.orders); if(t !== tf){ tf = t; d = await candles(ST.sym, tf); if(!ST) return; } }
  ST.tf = tf; ST.data = d; document.querySelectorAll('#tcp [data-tf]').forEach(b => b.classList.toggle('on', b.dataset.tf === tf));
  if(!d.length){ if(n) n.textContent = 'Could not load candles for ' + ST.sym + ' (Bitget and Binance gave nothing). Try another time frame.'; document.getElementById('tcpSvg').innerHTML = ''; return; }
  paint(); note();
}
const G = {L: 8, R: 78, T: 44, B: 26, W: 900, H: 460};
function scale(){ const d = ST.data, ps = d.flatMap(x => [x.h, x.l]).concat(ST.orders), lo0 = Math.min.apply(null, ps), hi0 = Math.max.apply(null, ps), pad = (hi0 - lo0) * .06 || hi0 * .02, lo = lo0 - pad, hi = hi0 + pad, w = (G.W - G.L - G.R) / d.length; ST.sc = {lo, hi, w};
  ST.x = i => G.L + (i + .5) * w; ST.y = p => G.T + (G.H - G.T - G.B) * (1 - (p - lo) / (hi - lo)); }
function idxOf(t){ const d = ST.data, step = d.length > 1 ? d[1].t - d[0].t : 36e5; if(t <= d[0].t) return (t - d[0].t) / step; if(t >= d[d.length - 1].t) return d.length - 1 + (t - d[d.length - 1].t) / step; let lo = 0, hi = d.length - 1; while(hi - lo > 1){ const m = (lo + hi) >> 1; if(d[m].t <= t) lo = m; else hi = m; } return lo + (t - d[lo].t) / (d[hi].t - d[lo].t); }
function pt(e){ const sv = document.getElementById('tcpSvg'), r = sv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * G.W, y = (e.clientY - r.top) / r.height * G.H, d = ST.data, i = Math.max(0, (x - G.L) / ST.sc.w - .5), step = d.length > 1 ? d[1].t - d[0].t : 36e5, t = i <= d.length - 1 ? d[Math.floor(i)].t + (i - Math.floor(i)) * step : d[d.length - 1].t + (i - (d.length - 1)) * step, p = ST.sc.lo + (1 - (y - G.T) / (G.H - G.T - G.B)) * (ST.sc.hi - ST.sc.lo); return {t, p}; }
function paint(){
  const sv = document.getElementById('tcpSvg'); if(!sv || !ST || !ST.data.length) return; scale(); const d = ST.data, X = ST.x, Y = ST.y; let g = '';
  for(let k = 0; k <= 4; k++){ const p = ST.sc.lo + (ST.sc.hi - ST.sc.lo) * k / 4, y = Y(p); g += `<line x1="${G.L}" x2="${G.W - G.R}" y1="${y}" y2="${y}" stroke="#23232a"/><text x="${G.W - G.R + 6}" y="${y + 4}" fill="#8b8f9a" font-size="11">${fx(p)}</text>`; }
  const bw = Math.max(1, ST.sc.w * .62);
  d.forEach((c, i) => { const up = c.c >= c.o, col = up ? '#3fb47a' : '#e0554d', x = X(i); g += `<line x1="${x}" x2="${x}" y1="${Y(c.h)}" y2="${Y(c.l)}" stroke="${col}"/><rect x="${x - bw / 2}" y="${Math.min(Y(c.o), Y(c.c))}" width="${bw}" height="${Math.max(1, Math.abs(Y(c.o) - Y(c.c)))}" fill="${col}"/>`; });
  const last = d[d.length - 1].c; g += `<line x1="${G.L}" x2="${G.W - G.R}" y1="${Y(last)}" y2="${Y(last)}" stroke="#8ab4ff" stroke-dasharray="2 3"/><rect x="${G.W - G.R}" y="${Y(last) - 9}" width="${G.R - 2}" height="18" rx="3" fill="#8ab4ff"/><text x="${G.W - G.R + 4}" y="${Y(last) + 4}" fill="#111" font-size="11" font-weight="700">${fx(last)}</text>`;
  ST.orders.forEach((p, i) => { const y = Y(p); g += `<line x1="${G.L}" x2="${G.W - G.R}" y1="${y}" y2="${y}" stroke="#dba118" stroke-width="1.5" stroke-dasharray="7 4"/><rect x="${G.L + 4}" y="${y - 17}" width="${86}" height="16" rx="3" fill="#dba118"/><text x="${G.L + 8}" y="${y - 5}" fill="#111" font-size="11" font-weight="700">Limit ${fx(p)}</text><rect x="${G.W - G.R}" y="${y - 9}" width="${G.R - 2}" height="18" rx="3" fill="#dba118"/><text x="${G.W - G.R + 4}" y="${y + 4}" fill="#111" font-size="11" font-weight="700">${fx(p)}</text>`; });
  const shape = (s, live) => { const a = s.a, b = s.b, xa = X(idxOf(a.t)), ya = Y(a.p), xb = X(idxOf(b.t)), yb = Y(b.p), op = live ? .6 : 1; let o = '';
    if(s.k === 'tl'){ o = `<line x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}" stroke="#4fd1c5" stroke-width="2" opacity="${op}"/>`; }
    else if(s.k === 'hl'){ o = `<line x1="${G.L}" x2="${G.W - G.R}" y1="${ya}" y2="${ya}" stroke="#4fd1c5" stroke-width="1.5" opacity="${op}"/><text x="${G.L + 4}" y="${ya - 4}" fill="#4fd1c5" font-size="11">${fx(a.p)}</text>`; }
    else if(s.k === 'rc'){ o = `<rect x="${Math.min(xa, xb)}" y="${Math.min(ya, yb)}" width="${Math.abs(xb - xa)}" height="${Math.abs(yb - ya)}" fill="rgba(79,209,197,.12)" stroke="#4fd1c5" opacity="${op}"/>`; }
    else if(s.k === 'fib'){ const lv = [0, .236, .382, .5, .618, .786, 1], x1 = Math.min(xa, xb), x2 = Math.max(xa, xb) + 40; o = lv.map(f => { const p = a.p + (b.p - a.p) * f, y = Y(p); return `<line x1="${x1}" x2="${Math.max(x2, G.W - G.R)}" y1="${y}" y2="${y}" stroke="#b18cff" opacity="${op * .8}"/><text x="${x1 + 3}" y="${y - 3}" fill="#b18cff" font-size="10">${f} · ${fx(p)}</text>`; }).join('') + `<line x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}" stroke="#b18cff" stroke-dasharray="3 3" opacity="${op}"/>`; }
    return o; };
  ST.draw.forEach(s => { g += shape(s, false); }); if(ST.tool && ST.pts.length === 1 && ST.mv) g += shape({k: ST.tool, a: ST.pts[0], b: ST.mv}, true);
  g += `<image href="${BASE}img/logo0.png" x="12" y="6" height="30" width="70" preserveAspectRatio="xMinYMid meet"/><text x="90" y="26" fill="#e8e8ea" font-size="15" font-weight="800">${esc(ST.sym)}/USDT · ${ST.tf.toUpperCase()}</text><text x="${G.W - G.R}" y="26" fill="#dba118" font-size="10" font-weight="800" text-anchor="end">TTM BETA</text>`;
  sv.innerHTML = g;
}
async function png(){
  const sv = document.getElementById('tcpSvg'); if(!sv) return null;
  let logo = ''; try{ const b = await (await fetch(BASE + 'img/logo0.png')).blob(); logo = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); }catch(e){}
  let x = new XMLSerializer().serializeToString(sv).replace(/href="[^"]*img\/logo0\.png"/, 'href="' + logo + '"');
  if(!/xmlns=/.test(x.slice(0, 200))) x = x.replace('<svg', '<svg xmlns="' + NS + '"');
  x = x.replace(/style="[^"]*"/, ''); const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(x);
  try{ await img.decode(); }catch(e){ return null; }
  const c = document.createElement('canvas'); c.width = 1350; c.height = 690; const k = c.getContext('2d'); k.fillStyle = '#0f0f12'; k.fillRect(0, 0, c.width, c.height); k.drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/png'));
}
async function postChat(){
  if(!window.ttmPostImage){ alert('Chat is not available on this page.'); return; }
  const b = await png(); if(!b) return alert('Could not make the image. Try the Download button instead.');
  const sym = ST.sym, tf = ST.tf; close(); window.ttmPostImage(b, sym + ' ' + tf.toUpperCase() + ' chart');
}
window.ttmChartOpen = open;
})();
