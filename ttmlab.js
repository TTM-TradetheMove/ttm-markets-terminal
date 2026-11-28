/* TTM Lab: Cycle Overlay, TTM Risk Metric, Pair Risk, Stablecoins and Dominance, Whale Moves.
   Everything here is TTM's own implementation of public ideas, drawn from the site's own daily history file plus
   public price feeds fetched in the visitor's browser. Educational only, not financial advice. */
(function(){
'use strict';
const $ = id => document.getElementById(id), DAY = 864e5, GOLD = '#e8b038';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dstr = t => { const d = new Date(t); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };
const usd = v => v == null || isNaN(v) ? '-' : v >= 1e12 ? '$' + (v / 1e12).toFixed(2) + 'T' : v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1000 ? '$' + Math.round(v).toLocaleString('en') : v >= 1 ? '$' + v.toFixed(2) : '$' + v.toPrecision(3);
const pct = (v, d) => v == null || isNaN(v) ? '-' : (v >= 0 ? '+' : '') + (v * 100).toFixed(d == null ? 0 : d) + '%';
const cl = v => v >= 0 ? '#3fb97a' : '#e5534b';

/* ---------- styles ---------- */
function css(){ if($('lbCss')) return; const s = document.createElement('style'); s.id = 'lbCss';
  s.textContent = '.lb-card{background:linear-gradient(180deg,#14141a,#0b0b0e);border:1px solid #26262c;border-radius:14px;padding:16px 18px;margin:0 0 14px}.lb-card h3{margin:0 0 4px;font-size:15px;color:#f2f0ea}.lb-card p{margin:0 0 10px;font-size:12.5px;color:#8a8a92}'
  + '.lb-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:0 0 14px}.lb-st{background:#101014;border:1px solid #26262c;border-radius:12px;padding:12px 14px}.lb-st small{display:block;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:#8a8a92;margin-bottom:4px}.lb-st b{font-size:22px;color:#f2f0ea}.lb-st em{display:block;font-style:normal;font-size:11.5px;color:#8a8a92;margin-top:2px}'
  + '.lb-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}.lb-tabs button,.lb-btn{background:#14141a;color:#e8b038;border:1px solid #3a3a42;border-radius:999px;padding:6px 14px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}.lb-tabs button.on,.lb-btn.on{background:#e8b038;color:#111;border-color:#e8b038}'
  + '.lb-card canvas{width:100%;display:block;border-radius:10px;background:#0b0b0d}.lb-tip{min-height:20px;font-size:12.5px;color:#cfd0d6;margin-top:6px}.lb-n{font-size:12px;color:#8a8a92;margin:8px 0 0;line-height:1.5}'
  + '.lb-t{width:100%;border-collapse:collapse;font-size:13px}.lb-t th,.lb-t td{padding:7px 8px;text-align:right;border-bottom:1px solid #26262c}.lb-t th:first-child,.lb-t td:first-child{text-align:left}.lb-t th{color:#8a8a92;font-weight:600;font-size:11.5px}'
  + '.lb-sel{background:#14141a;color:#e8e6e1;border:1px solid #3a3a42;border-radius:10px;padding:7px 10px;font:inherit;font-size:13px}.lb-bar{height:9px;border-radius:5px;background:#1d1d23;overflow:hidden;min-width:70px}.lb-bar i{display:block;height:100%}'
  + '.lb-big{font-size:46px;font-weight:800;line-height:1}.lb-pill{display:inline-block;border:1px solid;border-radius:999px;padding:2px 12px;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.lb-row{display:flex;gap:14px;align-items:center;flex-wrap:wrap}';
  document.head.appendChild(s); }

/* ---------- data ---------- */
let HP = null;
const hist = () => HP || (HP = fetch('../crypto_market_history.json?t=' + Math.floor(Date.now() / 36e5)).then(r => { if(!r.ok) throw new Error('history'); return r.json(); }));
const interp = a => { const xs = a.map(p => Date.parse(p[0])), ys = a.map(p => p[1]); return t => { if(t <= xs[0]) return ys[0]; for(let i = 1; i < xs.length; i++) if(t <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (t - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[ys.length - 1]; }; };
const BSUP = interp([['2010-07-18', 3.4e6], ['2011-01-01', 5.0e6], ['2012-01-01', 8.35e6], ['2012-11-28', 10.5e6], ['2016-07-09', 15.75e6], ['2020-05-11', 18.375e6], ['2024-04-20', 19.6875e6], ['2026-11-27', 20.0e6]]);
const KC = {};
async function kget(sym, st){
  let err = null;
  for(const host of ['https://data-api.binance.vision', 'https://api.binance.com']){
    try{ const r = await fetch(host + '/api/v3/klines?symbol=' + sym + '&interval=1d&limit=1000' + (st != null ? '&startTime=' + st : '')); if(!r.ok) throw new Error('http ' + r.status); return (await r.json()).map(k => ({t: k[0], p: +k[4]})); }catch(e){ err = e; }
  }
  throw err;
}
async function klines(sym, all){
  const key = sym + (all ? '*' : ''); if(KC[key]) return KC[key];
  let out = [];
  if(all){ let st = 0; for(let g = 0; g < 8; g++){ const b = await kget(sym, st); out = out.concat(b); if(b.length < 1000) break; st = b[b.length - 1].t + DAY; } }
  else out = await kget(sym, null);
  return KC[key] = out;
}
/* Bitcoin daily price back to 2011: market cap from the history file divided by the coin supply, with the newest days from Binance */
async function btcLong(){
  if(KC.btcLong) return KC.btcLong;
  const H = await hist(), T = H.s.TOTAL, D = H.s['BTC.D'], out = [], from = Date.parse('2011-06-01');
  for(let i = 0; i < H.n; i++){ const t = H.t0 + i * H.step; if(t < from) continue; const cap = T[i] * D[i] / 100 * 1e9; if(!(cap > 0)) continue; out.push({t, p: cap / BSUP(t)}); }
  try{ const k = await klines('BTCUSDT'), m = new Map(out.map((r, i) => [r.t, i])); k.forEach(c => { if(m.has(c.t)) out[m.get(c.t)].p = c.p; else if(c.t > out[out.length - 1].t) out.push(c); }); }catch(e){}
  out.sort((a, b) => a.t - b.t); return KC.btcLong = out;
}
const histSeries = (H, key, from) => { const a = H.s[key], out = []; for(let i = 0; i < H.n; i++){ const t = H.t0 + i * H.step; if(from && t < Date.parse(from)) continue; const v = a[i]; if(v != null && v > 0) out.push({t, p: v}); } return out; };

/* ---------- risk engine (TTM's own: four readings, each ranked against its own history, averaged) ---------- */
function riskCalc(S, genesis){
  const n = S.length, ps = S.map(r => r.p), lp = ps.map(Math.log), tl = S.map(r => Math.log(Math.max(1, (r.t - genesis) / DAY)));
  let sx = 0, sy = 0, sxx = 0, sxy = 0; for(let i = 0; i < n; i++){ sx += tl[i]; sy += lp[i]; sxx += tl[i] * tl[i]; sxy += tl[i] * lp[i]; }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
  const reg = lp.map((v, i) => v - (a + b * tl[i]));
  const sma = w => { const o = new Array(n).fill(NaN); let s = 0; for(let i = 0; i < n; i++){ s += ps[i]; if(i >= w) s -= ps[i - w]; if(i >= w - 1) o[i] = s / w; } return o; };
  const s350 = sma(350), s200 = sma(200), m350 = lp.map((v, i) => v - Math.log(s350[i])), m200 = lp.map((v, i) => v - Math.log(s200[i]));
  const rsi = new Array(n).fill(NaN); { let up = 0, dn = 0; const al = 1 / 98; for(let i = 1; i < n; i++){ const d = ps[i] - ps[i - 1]; up = up * (1 - al) + Math.max(d, 0) * al; dn = dn * (1 - al) + Math.max(-d, 0) * al; rsi[i] = i >= 98 && dn > 0 ? 100 - 100 / (1 + up / dn) : NaN; } }
  const minN = 380, comps = [reg, m350, m200, rsi], ranked = comps.map(v => {
    const sorted = [], r = new Array(n).fill(NaN);
    for(let i = 0; i < n; i++){ const x = v[i]; if(x == null || isNaN(x)) continue;
      if(i >= minN && sorted.length > 50){ let lo = 0, hi = sorted.length; while(lo < hi){ const m = (lo + hi) >> 1; if(sorted[m] < x) lo = m + 1; else hi = m; } r[i] = lo / sorted.length; }
      let lo = 0, hi = sorted.length; while(lo < hi){ const m = (lo + hi) >> 1; if(sorted[m] < x) lo = m + 1; else hi = m; } sorted.splice(lo, 0, x); }
    return r; });
  const raw = new Array(n).fill(NaN), risk = new Array(n).fill(NaN); let ema = null; const al = 2 / 11;
  for(let i = 0; i < n; i++){ const v = ranked.map(r => r[i]); if(v.some(isNaN)) continue; raw[i] = v.reduce((x, y) => x + y, 0) / 4; ema = ema == null ? raw[i] : ema + al * (raw[i] - ema); risk[i] = ema; }
  return {risk, parts: ranked.map(r => r[n - 1]), ts: S.map(r => r.t), ps};
}
const RSTOPS = [[0, [47, 111, 237]], [.35, [46, 200, 150]], [.55, [240, 200, 60]], [.8, [240, 130, 50]], [1, [225, 70, 60]]];
function rcol(v){ v = Math.max(0, Math.min(1, v)); for(let i = 1; i < RSTOPS.length; i++) if(v <= RSTOPS[i][0]){ const [x0, c0] = RSTOPS[i - 1], [x1, c1] = RSTOPS[i], f = (v - x0) / (x1 - x0); return 'rgb(' + c0.map((c, k) => Math.round(c + (c1[k] - c) * f)).join(',') + ')'; } return 'rgb(225,70,60)'; }
const rlab = v => v < .2 ? 'Very low risk' : v < .4 ? 'Low risk' : v < .6 ? 'Medium risk' : v < .8 ? 'High risk' : 'Very high risk';
function buckets(R, h){
  const E = [0, .2, .4, .6, .8, 1.0001], out = E.slice(1).map((e, k) => ({lo: E[k], hi: e, f: []}));
  for(let i = 0; i + h < R.ps.length; i++){ const r = R.risk[i]; if(isNaN(r)) continue; const k = E.findIndex((e, j) => j > 0 && r < e) - 1; if(k >= 0) out[k].f.push(R.ps[i + h] / R.ps[i] - 1); }
  return out.map(o => { const s = o.f.slice().sort((a, b) => a - b); return {lo: o.lo, hi: Math.min(1, o.hi), n: s.length, med: s.length ? s[s.length >> 1] : null, up: s.length ? s.filter(x => x > 0).length / s.length : null}; });
}

/* ---------- line chart ---------- */
function LC(cv, o){
  const ctx = cv.getContext('2d'), P = {l: 56, r: 12, t: 12, b: 24}; let box = null;
  const ext = () => { let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity; o.series.filter(s => !s.off).forEach(s => s.x.forEach((x, i) => { const y = s.y[i]; if(y == null || isNaN(y) || (o.logY && y <= 0)) return; if(o.xMin != null && x < o.xMin) return; if(o.xMax != null && x > o.xMax) return; if(x < xmin) xmin = x; if(x > xmax) xmax = x; if(y < ymin) ymin = y; if(y > ymax) ymax = y; })); if(o.yMin != null) ymin = o.yMin; if(o.yMax != null) ymax = o.yMax; return {xmin, xmax, ymin, ymax}; };
  function draw(hx){
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 600, H = o.h || 300; cv.style.height = H + 'px'; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const e = ext(); if(!isFinite(e.xmin)){ ctx.fillStyle = '#8a8a92'; ctx.font = '13px system-ui'; ctx.fillText('No data', 20, 30); return; }
    const f = o.logY ? Math.log : (v => v); let y0 = f(e.ymin), y1 = f(e.ymax); const pd = (y1 - y0) * .05 || 1; if(o.yMin == null) y0 -= pd; if(o.yMax == null) y1 += pd;
    const X = x => P.l + (x - e.xmin) / ((e.xmax - e.xmin) || 1) * (W - P.l - P.r), Y = y => P.t + (1 - (f(y) - y0) / (y1 - y0)) * (H - P.t - P.b);
    (o.bands || []).forEach(b => { ctx.fillStyle = b[2]; const ya = Y(b[1]), yb = Y(b[0]); ctx.fillRect(P.l, ya, W - P.l - P.r, yb - ya); });
    ctx.font = '11px system-ui'; ctx.fillStyle = '#8a8a92'; ctx.strokeStyle = '#1d1d22'; ctx.lineWidth = 1; ctx.textAlign = 'right';
    const ticks = []; const lo = o.logY ? Math.exp(y0) : y0, hi = o.logY ? Math.exp(y1) : y1;
    if(o.logY){ for(let k = Math.floor(Math.log10(lo)); k <= Math.ceil(Math.log10(hi)); k++) [1, 2, 5].forEach(m => { const v = m * Math.pow(10, k); if(v >= lo && v <= hi) ticks.push(v); }); }
    else { const step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 5))) * ([1, 2, 5, 10].find(m => (hi - lo) / (m * Math.pow(10, Math.floor(Math.log10((hi - lo) / 5)))) <= 6) || 10); for(let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v); }
    ticks.forEach(v => { const y = Y(v); ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke(); ctx.fillText((o.fmtY || (q => q))(v), P.l - 6, y + 4); });
    ctx.textAlign = 'center';
    if(o.xt === 'date'){ const sp = (e.xmax - e.xmin) / DAY, yrStep = sp > 365 * 12 ? 2 : 1; const y0d = new Date(e.xmin).getUTCFullYear() + 1, y1d = new Date(e.xmax).getUTCFullYear();
      if(sp > 900){ for(let y = y0d; y <= y1d; y += yrStep){ const x = X(Date.UTC(y, 0, 1)); ctx.fillText(y, x, H - 7); ctx.beginPath(); ctx.strokeStyle = '#1d1d22'; ctx.moveTo(x, P.t); ctx.lineTo(x, H - P.b); ctx.stroke(); } }
      else { let d = new Date(e.xmin); d = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); const stepM = sp > 400 ? 3 : 1; let k = 0; for(; d <= e.xmax; k++){ const dd = new Date(d); if(k % stepM === 0) ctx.fillText(MON[dd.getUTCMonth()] + ' ' + String(dd.getUTCFullYear()).slice(2), X(d), H - 7); d = Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth() + 1, 1); } } }
    else { for(let k = 0; k <= 6; k++){ const x = e.xmin + (e.xmax - e.xmin) * k / 6; ctx.fillText((o.fmtX || (q => Math.round(q)))(x), X(x), H - 7); } }
    (o.hl || []).forEach(h => { const y = Y(h.y); ctx.strokeStyle = h.c || '#555'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke(); ctx.setLineDash([]); if(h.t){ ctx.fillStyle = h.c || '#888'; ctx.textAlign = 'left'; ctx.fillText(h.t, P.l + 6, y - 4); ctx.textAlign = 'center'; } });
    o.series.forEach(s => { if(s.off) return; ctx.lineWidth = s.w || 1.6; ctx.setLineDash(s.dash || []); let pen = false, px = 0, py = 0;
      for(let i = 0; i < s.x.length; i++){ const x = s.x[i], y = s.y[i]; if(y == null || isNaN(y) || (o.logY && y <= 0) || (o.xMin != null && x < o.xMin) || (o.xMax != null && x > o.xMax)){ pen = false; continue; } const cx = X(x), cy = Y(y);
        if(s.by){ if(pen){ ctx.strokeStyle = s.by(i); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, cy); ctx.stroke(); } }
        else { if(!pen){ ctx.strokeStyle = s.c || GOLD; ctx.beginPath(); ctx.moveTo(cx, cy); pen = true; } else ctx.lineTo(cx, cy); }
        if(s.by) pen = true; px = cx; py = cy; }
      if(!s.by && pen) ctx.stroke(); ctx.setLineDash([]); });
    box = {X, Y, e};
    if(hx != null){ const x = X(hx); ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, P.t); ctx.lineTo(x, H - P.b); ctx.stroke();
      o.series.forEach(s => { if(s.off) return; const i = near(s.x, hx); if(i < 0 || s.y[i] == null || isNaN(s.y[i])) return; ctx.fillStyle = s.by ? s.by(i) : (s.c || GOLD); ctx.beginPath(); ctx.arc(X(s.x[i]), Y(s.y[i]), 3.5, 0, 6.3); ctx.fill(); }); }
  }
  const near = (xs, v) => { let lo = 0, hi = xs.length - 1; if(!xs.length) return -1; while(lo < hi){ const m = (lo + hi) >> 1; if(xs[m] < v) lo = m + 1; else hi = m; } if(lo > 0 && Math.abs(xs[lo - 1] - v) < Math.abs(xs[lo] - v)) lo--; return lo; };
  function move(ev){ if(!box || !o.tipEl) return; const r = cv.getBoundingClientRect(), t = ev.touches ? ev.touches[0] : ev, px = t.clientX - r.left, hx = box.e.xmin + (px - P.l) / ((cv.clientWidth - P.l - P.r) || 1) * (box.e.xmax - box.e.xmin);
    if(hx < box.e.xmin || hx > box.e.xmax) return; draw(hx);
    const head = (o.fmtX2 || o.fmtX || (q => q))(hx), rows = o.series.filter(s => s.name && !s.off).map(s => { const i = near(s.x, hx), y = s.y[i]; return y == null || isNaN(y) ? '' : '<span style="color:' + (s.c || GOLD) + '">' + esc(s.name) + '</span> <b>' + (s.fmt || o.fmtY || (q => q))(y) + '</b>'; }).filter(Boolean).join(' &nbsp;·&nbsp; ');
    o.tipEl.innerHTML = '<b>' + esc(head) + '</b> &nbsp; ' + rows; }
  cv.addEventListener('mousemove', move); cv.addEventListener('touchstart', move, {passive: true}); cv.addEventListener('touchmove', move, {passive: true}); cv.addEventListener('mouseleave', () => draw());
  window.addEventListener('resize', () => draw()); draw(); return {draw, o};
}
const cvTip = (box, id, h) => { const w = document.createElement('div'); w.className = 'lb-card'; w.innerHTML = '<h3></h3><p></p><canvas id="' + id + '"></canvas><div class="lb-tip" id="' + id + 'T"></div>'; return w; };
function card(box, title, sub, id, o){ const w = document.createElement('div'); w.className = 'lb-card'; w.innerHTML = '<h3>' + esc(title) + '</h3><p>' + sub + '</p><canvas></canvas><div class="lb-tip">Hover or tap the chart to read values.</div>'; box.appendChild(w); o.tipEl = w.querySelector('.lb-tip'); return LC(w.querySelector('canvas'), o); }
const fmtD = x => dstr(x);

/* =====================================================================
   1. CYCLE OVERLAY
   ===================================================================== */
async function renderCycle(box){
  box.innerHTML = '<p class="lb-n">Loading price history…</p>';
  let S; try{ S = await btcLong(); }catch(e){ box.innerHTML = '<p class="lb-n">The price history could not be loaded right now. Try again in a minute.</p>'; return; }
  const ts = S.map(r => r.t), ps = S.map(r => r.p), last = ps.length - 1, at = d => { const t = Date.parse(d); let i = 0; while(i < last && ts[i] < t) i++; return i; };
  const amax = (a, b) => { let m = a; for(let i = a; i <= b; i++) if(ps[i] > ps[m]) m = i; return m; }, amin = (a, b) => { let m = a; for(let i = a; i <= b; i++) if(ps[i] < ps[m]) m = i; return m; };
  const defs = [['2013 top', '2013-09-01', '2014-03-01', '#8b8b94'], ['2017 top', '2017-06-01', '2018-03-01', '#5aa9e6'], ['2021 top', '2021-01-01', '2022-03-01', '#b07cf7'], ['Current cycle', '2024-06-01', null, GOLD]];
  const cy = defs.map(([n, a, b, c]) => { const ia = at(a), ib = b ? at(b) : last, pk = amax(ia, ib), bt = b ? amin(pk, Math.min(last, pk + 500)) : amin(pk, last); return {n, c, pk, bt, done: !!b, days: Math.round((ts[bt] - ts[pk]) / DAY), dd: ps[bt] / ps[pk] - 1}; });
  const cur = cy[3], nowD = Math.round((ts[last] - ts[cur.pk]) / DAY), nowDD = ps[last] / ps[cur.pk] - 1, past = cy.slice(0, 3);
  const dmin = Math.min(...past.map(p => p.days)), dmax = Math.max(...past.map(p => p.days)), davg = Math.round(past.reduce((a, p) => a + p.days, 0) / 3);
  const w1 = ts[cur.pk] + dmin * DAY, w2 = ts[cur.pk] + dmax * DAY;
  box.innerHTML = '';
  const g = document.createElement('div'); g.className = 'lb-g'; g.innerHTML =
    '<div class="lb-st"><small>Days since the cycle top</small><b>' + nowD + '</b><em>Top: ' + dstr(ts[cur.pk]) + ' at ' + usd(ps[cur.pk]) + '</em></div>'
    + '<div class="lb-st"><small>Down from the top</small><b style="color:' + cl(nowDD) + '">' + pct(nowDD) + '</b><em>Bitcoin now ' + usd(ps[last]) + '</em></div>'
    + '<div class="lb-st"><small>Past cycles bottomed</small><b>' + dmin + ' to ' + dmax + ' days</b><em>after the top (average ' + davg + ')</em></div>'
    + '<div class="lb-st"><small>Past drawdowns</small><b>' + past.map(p => pct(p.dd)).join(', ') + '</b><em>top to bottom, 2013, 2017, 2021</em></div>';
  box.appendChild(g);
  const bar = document.createElement('div'); bar.className = 'lb-tabs'; box.appendChild(bar);
  const trace = (c, from, maxD, base) => { const x = [], y = []; for(let i = from; i <= last && (ts[i] - ts[from]) / DAY <= maxD; i++){ x.push((ts[i] - ts[from]) / DAY); y.push(ps[i] / (base || ps[from])); } return {x, y}; };
  const ch1 = card(box, 'This cycle against the last three, from each top', 'Each line starts at its own cycle top (100%) and shows how far price fell and how long it took. The gold line is the current cycle.', 'co1', {h: 340, logY: true, fmtY: v => Math.round(v * 100) + '%', fmtX: v => Math.round(v) + 'd', fmtX2: v => 'Day ' + Math.round(v), xMin: 0, xMax: 1100,
    series: cy.map(c => { const t = trace(c, c.pk, 1100); return {x: t.x, y: t.y, c: c.c, w: c.n === 'Current cycle' ? 2.6 : 1.4, name: c.n}; }), hl: [{y: 1, c: '#555'}, {y: .5, c: '#444', t: '-50%'}, {y: .2, c: '#444', t: '-80%'}]});
  const hv = [['2012 halving', '2012-11-28', '#8b8b94'], ['2016 halving', '2016-07-09', '#5aa9e6'], ['2020 halving', '2020-05-11', '#b07cf7'], ['2024 halving', '2024-04-20', GOLD]];
  const hd = hv.map(([n, d, c]) => { const i = at(d); const x = [], y = []; for(let k = i; k <= last && (ts[k] - ts[i]) / DAY <= 1500; k++){ x.push((ts[k] - ts[i]) / DAY); y.push(ps[k] / ps[i]); } return {n, c, i, x, y}; });
  const ch2 = card(box, 'Return since each halving', 'Price as a multiple of the price on halving day. 1x means back to the halving price.', 'co2', {h: 320, logY: true, fmtY: v => (v >= 10 ? Math.round(v) : v.toFixed(1)) + 'x', fmtX: v => Math.round(v) + 'd', fmtX2: v => 'Day ' + Math.round(v), xMin: 0, xMax: 1500,
    series: hd.map(h => ({x: h.x, y: h.y, c: h.c, w: h.n === '2024 halving' ? 2.6 : 1.4, name: h.n})), hl: [{y: 1, c: '#555', t: '1x'}]});
  bar.innerHTML = '<span style="align-self:center;font-size:12px;color:#8a8a92">Show cycles:</span>';
  cy.forEach((c, k) => { const b = document.createElement('button'); b.className = 'on'; b.innerHTML = '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + c.c + ';margin-right:6px"></span>' + c.n; b.onclick = () => { const off = b.classList.toggle('on') === false; ch1.o.series[k].off = off; ch2.o.series[k].off = off; ch1.draw(); ch2.draw(); }; bar.appendChild(b); });
  const t = document.createElement('div'); t.className = 'lb-card';
  t.innerHTML = '<h3>Cycle tops and bottoms</h3><p>Found from daily closes. The current bottom is the lowest close so far, not a final one.</p><table class="lb-t"><thead><tr><th>Cycle</th><th>Top</th><th>Bottom</th><th>Days top to bottom</th><th>Drop</th></tr></thead><tbody>'
    + cy.map(c => '<tr><td style="color:' + c.c + ';font-weight:700">' + c.n + '</td><td>' + dstr(ts[c.pk]) + '<br><small style="color:#8a8a92">' + usd(ps[c.pk]) + '</small></td><td>' + dstr(ts[c.bt]) + (c.done ? '' : ' (so far)') + '<br><small style="color:#8a8a92">' + usd(ps[c.bt]) + '</small></td><td>' + c.days + '</td><td style="color:#e5534b">' + pct(c.dd) + '</td></tr>').join('')
    + '</tbody></table><p class="lb-n">If this cycle rhymed with the last three, the bottom window would fall between <b>' + dstr(w1) + '</b> and <b>' + dstr(w2) + '</b>. That is a pattern check, not a forecast: three cycles is a very small sample, and each cycle has had a smaller drop than the one before.</p>';
  box.appendChild(t);
  const lv = document.createElement('div'); lv.className = 'lb-card';
  lv.innerHTML = '<h3>Drop levels from the current top, for scale</h3><p>The price at each fall from the top at ' + usd(ps[cur.pk]) + '. Reference levels only, not targets.</p><table class="lb-t"><thead><tr><th>Drop from top</th><th>Price</th><th>From today</th></tr></thead><tbody>'
    + [-.5, -.6, -.7, -.77, -.84].map(d => { const p = ps[cur.pk] * (1 + d); return '<tr><td>' + pct(d) + '</td><td>' + usd(p) + '</td><td style="color:' + cl(p / ps[last] - 1) + '">' + pct(p / ps[last] - 1) + '</td></tr>'; }).join('') + '</tbody></table>';
  box.appendChild(lv);
  const hr = document.createElement('div'); hr.className = 'lb-card';
  hr.innerHTML = '<h3>Halving table</h3><p>Where price was on halving day, where it peaked afterwards, and where the current cycle sits.</p><table class="lb-t"><thead><tr><th>Halving</th><th>Price that day</th><th>Peak after</th><th>Days to peak</th><th>Peak return</th></tr></thead><tbody>'
    + hd.map(h => { const seg = ps.slice(h.i, Math.min(last + 1, h.i + 1100)), mx = Math.max(...seg), k = seg.indexOf(mx), cur2 = h.n === '2024 halving'; return '<tr><td style="color:' + h.c + ';font-weight:700">' + h.n + '</td><td>' + usd(ps[h.i]) + '</td><td>' + usd(mx) + '</td><td>' + k + '</td><td>' + (mx / ps[h.i]).toFixed(1) + 'x' + (cur2 ? '<br><small style="color:#8a8a92">now ' + (ps[last] / ps[h.i]).toFixed(2) + 'x</small>' : '') + '</td></tr>'; }).join('') + '</tbody></table>'
    + '<p class="lb-n">Bitcoin price before the newest days is worked out from total market cap and dominance divided by coin supply, so very early years are approximate. Educational only, not financial advice.</p>';
  box.appendChild(hr);
}

/* =====================================================================
   2. TTM RISK METRIC (Bitcoin free of Pro, Ethereum Pro)
   ===================================================================== */
function riskView(box, R, name, h){
  const n = R.ps.length - 1; let li = n; while(li > 0 && isNaN(R.risk[li])) li--;
  const v = R.risk[li], c = rcol(v), cn = ['Log trend', 'Vs 350-day average', 'Vs 200-day average', 'Long-term RSI'];
  const g = document.createElement('div'); g.className = 'lb-card';
  g.innerHTML = '<div class="lb-row"><div><small style="color:#8a8a92;font-size:11px;letter-spacing:.09em;text-transform:uppercase">' + esc(name) + ' risk, 0 to 1</small><div class="lb-big" style="color:' + c + '">' + v.toFixed(2) + '</div><span class="lb-pill" style="color:' + c + ';border-color:' + c + '">' + rlab(v) + '</span></div>'
    + '<div style="flex:1;min-width:220px">' + R.parts.map((p, i) => '<div style="display:flex;align-items:center;gap:8px;margin:5px 0;font-size:12px;color:#aaa"><span style="width:140px">' + cn[i] + '</span><div class="lb-bar" style="flex:1"><i style="width:' + Math.round((p || 0) * 100) + '%;background:' + rcol(p || 0) + '"></i></div><b style="width:34px;color:#e8e6e1">' + (p == null || isNaN(p) ? '-' : p.toFixed(2)) + '</b></div>').join('') + '</div></div>'
    + '<p class="lb-n">Four readings of how stretched price is: distance from its long-term log trend, from its 350 and 200-day averages, and a long-term RSI. Each is ranked against its own history and the four are averaged and smoothed. Blue is historically low risk, red is historically high risk. This is TTM\'s own measure and is not any other analyst\'s metric.</p>';
  box.appendChild(g);
  const x = R.ts;
  card(box, name + ' price, coloured by risk', 'Log price scale. Blue stretches are where risk was historically low, red where it was high.', 'r1', {h: 330, logY: true, xt: 'date', fmtX: dstr, fmtY: usd, series: [{x, y: R.ps, by: i => isNaN(R.risk[i]) ? '#555' : rcol(R.risk[i]), w: 1.8, name: name, c: GOLD, fmt: usd}, {x, y: R.risk.map(r => isNaN(r) ? null : r), c: '#0000', w: 0.1, name: 'Risk', fmt: q => q.toFixed(2)}]});
  card(box, name + ' risk over time', 'Each swing from low to high has lined up with a market cycle.', 'r2', {h: 220, xt: 'date', fmtX: dstr, fmtY: q => q.toFixed(1), yMin: 0, yMax: 1,
    bands: [[0, .2, 'rgba(47,111,237,.10)'], [.2, .4, 'rgba(46,200,150,.07)'], [.4, .6, 'rgba(240,200,60,.05)'], [.6, .8, 'rgba(240,130,50,.08)'], [.8, 1, 'rgba(225,70,60,.12)']],
    series: [{x, y: R.risk.map(r => isNaN(r) ? null : r), by: i => rcol(R.risk[i]), w: 1.8, name: 'Risk', c: c, fmt: q => q.toFixed(2)}]});
  const bs = buckets(R, h), t = document.createElement('div'); t.className = 'lb-card';
  t.innerHTML = '<h3>What happened next, by risk level</h3><p>For every past day at each risk level, the price change over the following ' + h + ' days. Past results, not a prediction.</p><table class="lb-t"><thead><tr><th>Risk level</th><th>Days</th><th>Median change</th><th>Higher after ' + h + ' days</th></tr></thead><tbody>'
    + bs.map(b => '<tr><td><span style="color:' + rcol((b.lo + b.hi) / 2) + ';font-weight:700">' + b.lo.toFixed(1) + ' to ' + b.hi.toFixed(1) + '</span></td><td>' + b.n + '</td><td style="color:' + (b.med == null ? '#888' : cl(b.med)) + '">' + (b.med == null ? '-' : pct(b.med)) + '</td><td>' + (b.up == null ? '-' : Math.round(b.up * 100) + '%') + '</td></tr>').join('') + '</tbody></table>'
    + '<p class="lb-n">Each risk reading is ranked only against data up to that day, so it does not peek at the future. Even so, a handful of cycles is a small sample and the newest tops have shown lower readings than earlier ones as returns shrink. Educational only, not financial advice.</p>';
  box.appendChild(t);
}
async function renderRisk(box){
  box.innerHTML = '<div class="lb-tabs"><button class="on" data-a="btc">Bitcoin</button><button data-a="eth">Ethereum</button></div><div id="trIn"><p class="lb-n">Loading price history…</p></div>';
  const inn = $('trIn'), canPro = !window.ttmCan || ttmCan('c:riskpro');
  async function show(a){
    inn.innerHTML = '<p class="lb-n">Loading price history…</p>';
    if(a === 'eth' && !canPro){ inn.innerHTML = '<div class="lb-card"><h3>Ethereum risk is part of the Pro plan</h3><p>Bitcoin risk is open to your plan. Upgrade to Pro to add Ethereum risk and the Pair Risk tools.</p>' + (window.ttmUpsell ? '<button class="lb-btn on" id="trUp">See plans</button>' : '') + '</div>'; const b = $('trUp'); if(b) b.onclick = () => { try{ ttmUpsell('pro'); }catch(e){} }; return; }
    try{
      let S, gen, h;
      if(a === 'btc'){ S = await btcLong(); gen = Date.UTC(2009, 0, 3); h = 365; } else { S = await klines('ETHUSDT', true); gen = Date.UTC(2015, 6, 30); h = 365; }
      if(S.length < 600) throw new Error('short');
      inn.innerHTML = ''; riskView(inn, riskCalc(S, gen), a === 'btc' ? 'Bitcoin' : 'Ethereum', h);
    }catch(e){ inn.innerHTML = '<p class="lb-n">' + (a === 'eth' ? 'The Ethereum price feed could not be reached from this browser. Try again later.' : 'The price history could not be loaded right now.') + '</p>'; }
  }
  box.querySelectorAll('.lb-tabs button').forEach(b => b.onclick = () => { box.querySelectorAll('.lb-tabs button').forEach(x => x.classList.toggle('on', x === b)); show(b.dataset.a); });
  show('btc');
}

/* =====================================================================
   3. PAIR RISK (Pro): any coin against the dollar or against Bitcoin, plus a risk board
   ===================================================================== */
const COINS = ['ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'LINK', 'AVAX', 'DOT', 'SUI', 'LTC', 'BCH', 'NEAR', 'AAVE', 'UNI', 'ATOM', 'INJ', 'ARB', 'OP', 'TON', 'TRX', 'FIL', 'APT', 'HBAR'];
async function coinSeries(c, vs){
  const a = await klines(c + 'USDT');
  if(vs === 'USD') return a;
  const b = await klines('BTCUSDT'), m = new Map(b.map(r => [r.t, r.p]));
  return a.filter(r => m.has(r.t)).map(r => ({t: r.t, p: r.p / m.get(r.t)}));
}
async function renderPair(box){
  box.innerHTML = '<div class="lb-card"><div class="lb-row"><select class="lb-sel" id="prC"></select><div class="lb-tabs" style="margin:0" id="prV"><button class="on" data-v="USD">Against the dollar</button><button data-v="BTC">Against Bitcoin</button></div></div><p class="lb-n">Pick a coin. Risk needs at least about two years of daily prices, so newer coins may not have a reading yet. Prices come from Binance, loaded in your browser.</p></div><div id="prIn"></div><div id="prBoard"></div>';
  const sel = $('prC'); sel.innerHTML = '<optgroup label="From the TTM history file"><option value="H:(TOTAL3-USDT)/BTC">Altcoins against Bitcoin (all coins outside BTC, ETH, USDT)</option><option value="H:OTHERSBTC">Smaller altcoins against Bitcoin</option></optgroup><optgroup label="Coins">' + COINS.map(c => '<option value="' + c + '">' + c + '</option>').join('') + '</optgroup>';
  let vs = 'USD'; const inn = $('prIn');
  async function go(){
    const v = sel.value; inn.innerHTML = '<p class="lb-n">Loading…</p>';
    try{
      let S, name, gen;
      if(v.startsWith('H:')){ const H = await hist(); S = histSeries(H, v.slice(2), '2013-06-01'); name = sel.options[sel.selectedIndex].text.split(' (')[0]; gen = S[0].t - 30 * DAY; }
      else { S = await coinSeries(v, vs); name = v + ' / ' + (vs === 'USD' ? 'USD' : 'BTC'); gen = S[0].t - 30 * DAY; }
      if(S.length < 520){ inn.innerHTML = '<div class="lb-card"><h3>' + esc(name) + '</h3><p>Not enough history yet (' + S.length + ' days). A risk reading needs about 520 days of daily prices.</p></div>'; return; }
      inn.innerHTML = ''; riskView(inn, riskCalc(S, gen), name, Math.min(180, Math.floor(S.length / 5)));
    }catch(e){ inn.innerHTML = '<p class="lb-n">That price feed could not be reached from this browser. Try again later or pick another coin.</p>'; }
  }
  sel.onchange = go; $('prV').querySelectorAll('button').forEach(b => b.onclick = () => { vs = b.dataset.v; $('prV').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); if(!sel.value.startsWith('H:')) go(); });
  go();
  const bd = $('prBoard'); bd.innerHTML = '<div class="lb-card"><h3>Risk board</h3><p>Current risk for the main coins against the dollar, from about the last 1,000 days of prices.</p><button class="lb-btn on" id="prRun">Build the board</button><div id="prOut"></div></div>';
  $('prRun').onclick = async () => {
    const out = $('prOut'); out.innerHTML = '<p class="lb-n">Working through the coins, about 20 seconds…</p>'; const rows = []; let k = 0;
    const work = async () => { while(k < COINS.length){ const c = COINS[k++]; try{ const S = await klines(c + 'USDT'); if(S.length < 520) continue; const R = riskCalc(S, S[0].t - 30 * DAY); let i = R.risk.length - 1; while(i > 0 && isNaN(R.risk[i])) i--; if(!isNaN(R.risk[i])) rows.push({c, v: R.risk[i], d30: R.ps[R.ps.length - 1] / R.ps[Math.max(0, R.ps.length - 31)] - 1}); }catch(e){} } };
    await Promise.all([work(), work(), work(), work()]);
    if(!rows.length){ out.innerHTML = '<p class="lb-n">No coin data could be loaded right now.</p>'; return; }
    rows.sort((a, b) => b.v - a.v);
    out.innerHTML = '<table class="lb-t"><thead><tr><th>Coin</th><th>Risk</th><th style="width:40%"></th><th>30 days</th></tr></thead><tbody>' + rows.map(r => '<tr><td><b>' + r.c + '</b></td><td style="color:' + rcol(r.v) + ';font-weight:700">' + r.v.toFixed(2) + '</td><td><div class="lb-bar"><i style="width:' + Math.round(r.v * 100) + '%;background:' + rcol(r.v) + '"></i></div></td><td style="color:' + cl(r.d30) + '">' + pct(r.d30) + '</td></tr>').join('') + '</tbody></table><p class="lb-n">Each coin is ranked against its own recent history, so readings are comparable within a coin, not a strict league table across coins. Educational only, not financial advice.</p>';
  };
}

/* =====================================================================
   4. STABLECOINS AND DOMINANCE (free)
   ===================================================================== */
async function renderStable(box){
  box.innerHTML = '<p class="lb-n">Loading…</p>';
  let H; try{ H = await hist(); }catch(e){ box.innerHTML = '<p class="lb-n">The data could not be loaded right now. Try again in a minute.</p>'; return; }
  const from = '2018-01-01', dom = histSeries(H, 'BTC.D', from), usdt = histSeries(H, 'USDT.D', from), usdc = histSeries(H, 'USDC.D', from), alt = histSeries(H, '(TOTAL3-USDT)/BTC', from);
  const sd = usdt.map((r, i) => ({t: r.t, p: r.p + ((usdc.find(q => q.t === r.t) || {}).p || 0)}));
  const sma = (S, w) => S.map((r, i) => { if(i < w - 1) return null; let s = 0; for(let k = i - w + 1; k <= i; k++) s += S[k].p; return s / w; });
  const dm = sma(dom, 200), lastDom = dom[dom.length - 1].p, d30 = lastDom - dom[dom.length - 31].p, sdl = sd[sd.length - 1].p, sd30 = sdl - sd[sd.length - 31].p, aL = alt[alt.length - 1].p, a200 = sma(alt, 200)[alt.length - 1], a30 = aL / alt[alt.length - 31].p - 1;
  box.innerHTML = '';
  const g = document.createElement('div'); g.className = 'lb-g'; g.innerHTML =
    '<div class="lb-st"><small>Bitcoin dominance</small><b>' + lastDom.toFixed(1) + '%</b><em style="color:' + cl(d30) + '">' + (d30 >= 0 ? '+' : '') + d30.toFixed(1) + ' pts in 30 days</em></div>'
    + '<div class="lb-st"><small>Stablecoin share of the market</small><b>' + sdl.toFixed(1) + '%</b><em style="color:' + cl(-sd30) + '">' + (sd30 >= 0 ? '+' : '') + sd30.toFixed(1) + ' pts in 30 days (USDT and USDC)</em></div>'
    + '<div class="lb-st"><small>Altcoins against Bitcoin</small><b style="color:' + cl(aL - a200) + '">' + (aL >= a200 ? 'Above' : 'Below') + ' 200-day</b><em>' + pct(a30, 1) + ' in 30 days</em></div>'
    + '<div class="lb-st"><small>Reading</small><b style="font-size:15px;line-height:1.3">' + (lastDom >= dm[dm.length - 1] ? 'Money is favouring Bitcoin' : 'Money is rotating to alts') + (sd30 > 0 ? ', and cash is growing' : '') + '</b><em>Dominance against its 200-day average</em></div>';
  box.appendChild(g);
  const x1 = dom.map(r => r.t);
  card(box, 'Bitcoin dominance', 'Bitcoin\'s share of the total crypto market, with its 200-day average. Above the average means money is favouring Bitcoin.', 'sd1', {h: 280, xt: 'date', fmtX: dstr, fmtY: v => v.toFixed(0) + '%', series: [{x: x1, y: dom.map(r => r.p), c: GOLD, w: 1.8, name: 'Dominance', fmt: v => v.toFixed(1) + '%'}, {x: x1, y: dm, c: '#8a8a92', w: 1.2, dash: [5, 4], name: '200-day', fmt: v => v.toFixed(1) + '%'}]});
  card(box, 'Stablecoin share of the market', 'USDT plus USDC as a share of total crypto market cap. It rises when the market falls and people hold cash, and falls when money moves into coins.', 'sd2', {h: 240, xt: 'date', fmtX: dstr, fmtY: v => v.toFixed(0) + '%', series: [{x: sd.map(r => r.t), y: sd.map(r => r.p), c: '#5aa9e6', w: 1.8, name: 'Stablecoins', fmt: v => v.toFixed(1) + '%'}]});
  const ratio = alt.map(r => r.p), am = sma(alt, 200);
  const sdv = alt.map((r, i) => { if(i < 199) return null; const w = ratio.slice(i - 199, i + 1).map(Math.log), mu = w.reduce((a, b) => a + b, 0) / 200, sg = Math.sqrt(w.reduce((a, b) => a + (b - mu) * (b - mu), 0) / 200); return [Math.exp(mu - 1.5 * sg), Math.exp(mu + 1.5 * sg)]; });
  card(box, 'Altcoins against Bitcoin, with bands', 'All coins outside Bitcoin, Ethereum and USDT, divided by Bitcoin\'s market cap. The dashed band is 1.5 standard deviations around the 200-day average. Near the top band alts have run hot against Bitcoin, near the bottom they are cold.', 'sd3', {h: 280, logY: true, xt: 'date', fmtX: dstr, fmtY: v => v.toFixed(2), series: [{x: alt.map(r => r.t), y: ratio, c: GOLD, w: 1.8, name: 'Alts / BTC', fmt: v => v.toFixed(3)}, {x: alt.map(r => r.t), y: am, c: '#8a8a92', w: 1.1, name: '200-day', fmt: v => v.toFixed(3)}, {x: alt.map(r => r.t), y: sdv.map(b => b && b[1]), c: '#e5534b', w: 1, dash: [4, 4]}, {x: alt.map(r => r.t), y: sdv.map(b => b && b[0]), c: '#3fb97a', w: 1, dash: [4, 4]}]});
  const holder = document.createElement('div'); box.appendChild(holder);
  try{ const r = await fetch('https://stablecoins.llama.fi/stablecoincharts/all'); if(!r.ok) throw 0; const j = await r.json(), S = j.map(d => ({t: +d.date * 1000, p: (d.totalCirculatingUSD || d.totalCirculating || {}).peggedUSD})).filter(d => d.p > 0 && d.t >= Date.parse('2019-01-01'));
    if(S.length > 100) card(box, 'Total stablecoin supply', 'Every dollar stablecoin in circulation, from DefiLlama. Growth means new cash is coming into crypto.', 'sd4', {h: 260, xt: 'date', fmtX: dstr, fmtY: v => '$' + Math.round(v / 1e9) + 'B', series: [{x: S.map(r => r.t), y: S.map(r => r.p), c: '#3fb97a', w: 1.8, name: 'Supply', fmt: usd}]});
  }catch(e){ const n = document.createElement('p'); n.className = 'lb-n'; n.textContent = 'The total stablecoin supply chart could not be loaded right now.'; box.appendChild(n); }
  const f = document.createElement('p'); f.className = 'lb-n'; f.textContent = 'Dominance, stablecoin share and altcoin figures come from the TTM history file, updated daily. Educational only, not financial advice.'; box.appendChild(f);
}

/* =====================================================================
   5. WHALE MOVES (Premium): Hyperliquid top traders and large Bitcoin transfers
   ===================================================================== */
const short = a => a.slice(0, 6) + '…' + a.slice(-4);
async function renderWhale(box){
  box.innerHTML = '<div class="lb-card"><h3>Hyperliquid top traders: who is long and who is short</h3><p>The biggest accounts on the Hyperliquid leaderboard and the positions they hold right now. Public on-chain data.</p><div id="wmHL"><p class="lb-n">Loading the leaderboard…</p></div></div><div class="lb-card"><h3>Large Bitcoin transfers, last 24 hours</h3><p>The biggest on-chain Bitcoin transactions. A big transfer is not always a sale: the same coins often move between wallets owned by one holder.</p><div id="wmBTC"><p class="lb-n">Loading…</p></div></div>';
  (async () => {
    const o = $('wmHL');
    try{
      const lr = await fetch('https://stats-data.hyperliquid.xyz/Mainnet/leaderboard'); if(!lr.ok) throw 0; const lj = await lr.json();
      const rows = (lj.leaderboardRows || lj).map(r => ({a: r.ethAddress, v: +r.accountValue, n: r.displayName})).filter(r => r.a && r.v > 0).sort((x, y) => y.v - x.v).slice(0, 20), pos = []; let k = 0;
      const work = async () => { while(k < rows.length){ const r = rows[k++]; try{ const pr = await fetch('https://api.hyperliquid.xyz/info', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({type: 'clearinghouseState', user: r.a})}); const pj = await pr.json(); (pj.assetPositions || []).forEach(p => { const q = p.position, sz = +q.szi; if(!sz) return; pos.push({a: r.a, coin: q.coin, side: sz > 0 ? 'Long' : 'Short', usd: Math.abs(+q.positionValue), entry: +q.entryPx, pnl: +q.unrealizedPnl, lev: q.leverage && q.leverage.value, liq: q.liquidationPx ? +q.liquidationPx : null}); }); }catch(e){} } };
      await Promise.all([work(), work(), work(), work(), work()]);
      if(!pos.length){ o.innerHTML = '<p class="lb-n">No open positions could be read right now.</p>'; return; }
      const by = {}; pos.forEach(p => { const c = by[p.coin] || (by[p.coin] = {coin: p.coin, L: 0, S: 0, n: 0}); if(p.side === 'Long') c.L += p.usd; else c.S += p.usd; c.n++; });
      const list = Object.values(by).sort((a, b) => (b.L + b.S) - (a.L + a.S)).slice(0, 12), tot = pos.reduce((a, p) => a + p.usd, 0), tl = pos.filter(p => p.side === 'Long').reduce((a, p) => a + p.usd, 0);
      o.innerHTML = '<div class="lb-g"><div class="lb-st"><small>Accounts read</small><b>' + rows.length + '</b><em>top by account value</em></div><div class="lb-st"><small>Open exposure</small><b>' + usd(tot) + '</b><em>' + Math.round(tl / tot * 100) + '% long, ' + Math.round((1 - tl / tot) * 100) + '% short</em></div></div>'
        + '<table class="lb-t"><thead><tr><th>Coin</th><th>Long</th><th>Short</th><th style="width:34%">Balance</th></tr></thead><tbody>' + list.map(c => '<tr><td><b>' + esc(c.coin) + '</b></td><td style="color:#3fb97a">' + usd(c.L) + '</td><td style="color:#e5534b">' + usd(c.S) + '</td><td><div class="lb-bar" style="background:#e5534b"><i style="width:' + Math.round(c.L / ((c.L + c.S) || 1) * 100) + '%;background:#3fb97a"></i></div></td></tr>').join('') + '</tbody></table>'
        + '<h3 style="margin:16px 0 6px;font-size:14px">Biggest single positions</h3><table class="lb-t"><thead><tr><th>Account</th><th>Coin</th><th>Side</th><th>Size</th><th>Entry</th><th>Open P&amp;L</th><th>Lev</th></tr></thead><tbody>' + pos.sort((a, b) => b.usd - a.usd).slice(0, 12).map(p => '<tr><td>' + short(p.a) + '</td><td>' + esc(p.coin) + '</td><td style="color:' + (p.side === 'Long' ? '#3fb97a' : '#e5534b') + '">' + p.side + '</td><td>' + usd(p.usd) + '</td><td>' + (p.entry >= 100 ? Math.round(p.entry).toLocaleString('en') : p.entry.toPrecision(4)) + '</td><td style="color:' + cl(p.pnl) + '">' + usd(Math.abs(p.pnl)).replace('$', p.pnl < 0 ? '-$' : '$') + '</td><td>' + (p.lev || '-') + 'x</td></tr>').join('') + '</tbody></table><p class="lb-n">Top accounts can be market makers, funds or hedgers, so a big short is not always a bearish bet. Educational only, not financial advice.</p>';
    }catch(e){ o.innerHTML = '<p class="lb-n">The Hyperliquid data could not be reached from this browser right now. Try again later.</p>'; }
  })();
  (async () => {
    const o = $('wmBTC');
    try{
      const since = new Date(Date.now() - DAY).toISOString().slice(0, 19).replace('T', ' ');
      const r = await fetch('https://api.blockchair.com/bitcoin/transactions?s=output_total(desc)&limit=15&q=' + encodeURIComponent('time(' + since + '..)')); if(!r.ok) throw 0; const j = await r.json(), d = j.data || [];
      if(!d.length) throw 0;
      o.innerHTML = '<table class="lb-t"><thead><tr><th>Time (UTC)</th><th>Value</th><th>BTC</th><th>Inputs / outputs</th><th></th></tr></thead><tbody>' + d.map(t => '<tr><td>' + esc(String(t.time).slice(5, 16)) + '</td><td><b>' + usd(+t.output_total_usd) + '</b></td><td>' + (+t.output_total / 1e8).toFixed(0) + '</td><td>' + t.input_count + ' / ' + t.output_count + '</td><td><a href="https://mempool.space/tx/' + esc(t.hash) + '" target="_blank" rel="noopener" style="color:#e8b038">view</a></td></tr>').join('') + '</tbody></table><p class="lb-n">Data from Blockchair. We cannot tell whether the coins moved to or from an exchange, only that they moved. Educational only, not financial advice.</p>';
    }catch(e){ o.innerHTML = '<p class="lb-n">The transfer feed could not be reached from this browser right now. Try again later.</p>'; }
  })();
}

/* ---------- boot: render a section the first time it is opened ---------- */
const SECS = {cycleoverlay: renderCycle, ttmrisk: renderRisk, pairrisk: renderPair, stabledom: renderStable, whalemoves: renderWhale}, done = {};
function boot(){
  const id = (location.hash || '').slice(1), f = SECS[id], sec = id && $(id); if(!f || !sec || done[id]) return;
  if(window.ttmCan && !ttmCan('c:' + id)) return;
  const body = sec.querySelector('.lb-body'); if(!body) return;
  done[id] = 1; css(); try{ f(body); }catch(e){ body.innerHTML = '<p class="lb-n">Something went wrong loading this page. Refresh and try again.</p>'; }
}
window.addEventListener('hashchange', boot);
let tries = 0; const iv = setInterval(() => { boot(); if(++tries > 40) clearInterval(iv); }, 700);
window.TTM_LAB = {riskCalc, buckets, btcLong};
})();
