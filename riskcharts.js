/* TTM Risk Charts: shared by the Crypto and TradFi pages. Each page sets window.TTM_RK first. */
(function(){
  var CFG = window.TTM_RK || {}, m = document.getElementById('rkMount'); if(!m) return;
  var st = document.createElement('style'); st.textContent = "\n.rk-chips{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 14px}.rk-chip{background:#111114;border:1px solid #2a2a31;border-radius:12px;padding:8px 12px;cursor:pointer;color:inherit;font:inherit;text-align:left;min-width:120px}.rk-chip b{display:block;font-size:13px}.rk-chip span{font-size:12px;font-weight:700}.rk-chip.on{border-color:var(--gold2,#e8b038);box-shadow:0 0 0 1px var(--gold2,#e8b038) inset}\n.rk-card{background:#111114;border:1px solid #26262c;border-radius:14px;padding:12px 14px}.rk-top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.rk-top h3{margin:0;font-size:16px}.rk-sub{font-size:12.5px;color:#8a8a92;margin-top:3px;max-width:640px}.rk-now{text-align:right}.rk-now b{font-size:24px;display:block;line-height:1.1}.rk-now span{font-size:12px;font-weight:800;border-radius:999px;padding:2px 9px;border:1px solid}\n.rk-ctl{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0 8px}.rk-g{display:flex;align-items:center;gap:4px;background:#0d0d10;border:1px solid #26262c;border-radius:10px;padding:3px 4px}.rk-g span{font-size:11px;color:#8a8a92;padding:0 6px}.rk-g button{background:transparent;color:#c9c9d0;border:0;border-radius:7px;padding:6px 10px;font:inherit;font-size:12px;cursor:pointer;min-height:30px}.rk-g button.on{background:var(--gold2,#e8b038);color:#111;font-weight:800}\n.rk-parts{display:none;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 14px;margin:6px 0 10px}.rk-parts.show{display:grid}.rk-pt{font-size:12px}.rk-pt label{display:flex;justify-content:space-between;color:#c9c9d0}.rk-pt input{width:100%;accent-color:#e8b038}\n.rk-cvw{position:relative}#rkCv{width:100%;height:380px;display:block;touch-action:pan-y}.rk-tip{position:absolute;pointer-events:none;display:none;background:#0b0b0d;border:1px solid #3a3a42;border-radius:8px;padding:6px 9px;font-size:12px;line-height:1.5;z-index:3;white-space:nowrap}\n.rk-leg{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:#c9c9d0;margin:8px 0 2px}.rk-leg i{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}\n.rk-h{margin:14px 0 4px;font-size:13px;color:#f1c75b}.rk-p{margin:0;font-size:13.5px;line-height:1.6;color:#d6d6dc}\n.rk-cyg{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}.rk-cy{background:#0d0d10;border:1px solid #26262c;border-radius:10px;padding:10px 12px}.rk-cyh{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px}.rk-cyh span{font-size:11px;border:1px solid;border-radius:10px;padding:2px 8px}.rk-cyv{display:grid;grid-template-columns:16px 1fr;gap:0 6px;font-size:12.5px;color:#8a8a92;margin:4px 0}.rk-cyv.on{color:#e8e8ec}.rk-cyv i{font-style:normal;color:#5a5a62}.rk-cyv.on i{color:#e8b038}.rk-cyv em{grid-column:2;font-style:normal;font-size:11.5px;color:#6f6f78}\n@media(max-width:600px){#rkCv{height:320px}.rk-now b{font-size:20px}.rk-chip{min-width:calc(50% - 4px);flex:1 1 calc(50% - 4px)}.rk-g button{padding:6px 8px}}\n\n.rk-back{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:0 0 14px;padding:10px 12px;background:#0d0d10;border:1px solid #26262c;border-radius:12px}.rk-back>small{grid-column:1/-1;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#8a8a92}.rk-back>small a{color:var(--gold2,#e8b038);text-decoration:none;float:right;letter-spacing:0;text-transform:none}.rk-bk{display:block;text-decoration:none;color:inherit;background:#111114;border:1px solid #2a2a31;border-radius:10px;padding:7px 10px}.rk-bk b{display:block;font-size:12px;font-weight:600;color:#c9c9d0}.rk-bk span{font-size:13px;font-weight:800}"; document.head.appendChild(st);
  m.insertAdjacentHTML('beforebegin', "<section id=\"riskcharts\">\n  <div class=\"wrap\">\n    <div class=\"section-head\">\n      <span class=\"tag\" id=\"rkTag\">Risk Charts</span>\n      <h2 id=\"rkH2\">Risk charts</h2>\n      <p id=\"rkIntro\">TTM's own 0 to 1 risk scores built from free public data. Low means conditions have been easy or cheap for their own history, high means tight or stretched. They show where we are in a cycle, not what happens next.</p>\n      <p id=\"rkUpdated\" class=\"calendar-note\" style=\"margin-top:8px\">Loading risk charts\u2026</p>\n    </div>\n    <div id=\"rkBack\" class=\"rk-back\" style=\"display:none\"></div>\n    <div id=\"rkChips\" class=\"rk-chips\"></div>\n    <div class=\"rk-card\">\n      <div class=\"rk-top\"><div><h3 id=\"rkTitle\"></h3><div id=\"rkSub\" class=\"rk-sub\"></div></div><div id=\"rkNow\" class=\"rk-now\"></div></div>\n      <div class=\"rk-ctl\">\n        <div class=\"rk-g\"><span>Range</span><button data-r=\"1\">1y</button><button data-r=\"2\">2y</button><button data-r=\"5\">5y</button><button data-r=\"10\">10y</button><button data-r=\"0\" class=\"on\">All</button></div>\n        <div class=\"rk-g\"><span>Smooth</span><button data-m=\"0\" class=\"on\">None</button><button data-m=\"1\">Light</button><button data-m=\"2\">Medium</button><button data-m=\"3\">Strong</button></div>\n        <div class=\"rk-g\" id=\"rkColG\"><span>Line</span><button data-c=\"0\" class=\"on\">Plain</button><button data-c=\"1\">Colour-coded</button></div>\n        <div class=\"rk-g\" id=\"rkOvG\"><button id=\"rkOv\" class=\"on\">Overlay on</button></div>\n        <div class=\"rk-g\" id=\"rkEtfG\" style=\"display:none\"><span>ETF flows</span><button data-e=\"0\" class=\"on\">Off</button><button data-e=\"1\">All ETF tokens</button><button data-e=\"2\">Bitcoin ETFs</button><button data-e=\"3\">Ether ETFs</button></div>\n      </div>\n      <div id=\"rkParts\" class=\"rk-parts\"></div>\n      <div class=\"rk-cvw\"><canvas id=\"rkCv\"></canvas><div id=\"rkTip\" class=\"rk-tip\"></div></div>\n      <div id=\"rkLeg\" class=\"rk-leg\"></div>\n      <div id=\"rkCyc\" style=\"display:none\"></div>\n      <div id=\"rkStale\" class=\"calendar-note\" style=\"display:none;margin:6px 0 0;color:#e0a14d\">This chart could not refresh on the last update, so it shows older data.</div>\n      <h4 class=\"rk-h\">What it shows</h4><p id=\"rkDesc\" class=\"rk-p\"></p>\n      <h4 class=\"rk-h\">How it is built</h4><p id=\"rkHow\" class=\"rk-p\"></p>\n      <p class=\"rk-p\" style=\"color:#8a8a92;font-size:11.5px\">Educational only, not financial advice. Scores are TTM's own and will not match other providers.</p>\n    </div>\n  </div>\n</section>"); m.parentNode.removeChild(m);
  var q = function(i){ return document.getElementById(i); };
  if(CFG.tag && q('rkTag')) q('rkTag').textContent = CFG.tag; if(CFG.title && q('rkH2')) q('rkH2').textContent = CFG.title; if(CFG.intro && q('rkIntro')) q('rkIntro').textContent = CFG.intro;
})();

(function(){
  var sec = document.getElementById('riskcharts'); if(!sec) return;
  var CFG = window.TTM_RK || {}, ALLC = null, D = null, ETF = null, CYC = null, cur = (CFG.ids && CFG.ids[0]) || 'liquidity', st = {rng: 0, ma: 0, col: 0, ov: true, etf: 0, w: {}}, cv = document.getElementById('rkCv'), geo = null, loaded = false;
  var $ = function(i){ return document.getElementById(i); };
  var etfBars = null;
  var BC = ['63,180,122', '140,190,80', '219,161,24', '224,125,60', '224,85,77'];
  var MAP = {monthly: [1, 3, 6, 12], daily: [1, 4, 13, 26]};
  function T(d){ return Date.parse(d + 'T00:00:00Z'); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
  function chart(){ return D && D.charts.filter(function(c){ return c.id === cur; })[0]; }
  function colFor(v){ var h = 130 - 130 * Math.max(0, Math.min(1, v)); return 'hsl(' + h + ',78%,52%)'; }
  function fmtP(v){ return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(0) + 'K' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2); }
  function cut(){ return st.rng ? Date.now() - st.rng * 365.25 * 864e5 : 0; }
  function smooth(arr, n){ if(n <= 1) return arr; return arr.map(function(p, i){ var s = 0, k = 0; for(var j = Math.max(0, i - n + 1); j <= i; j++){ s += arr[j][1]; k++; } return [p[0], s / k]; }); }
  function mainSeries(c){
    var base;
    if(c.parts && c.parts.length){
      var tot = 0; c.parts.forEach(function(p){ tot += (st.w[p.k] == null ? 1 : st.w[p.k]); });
      if(!tot) return [];
      var maps = c.parts.map(function(p){ var m = {}; p.series.forEach(function(x){ m[x[0]] = x[1]; }); return {k: p.k, m: m}; });
      base = c.series.map(function(x){ var s = 0, w = 0; maps.forEach(function(q){ var wt = st.w[q.k] == null ? 1 : st.w[q.k]; if(wt > 0 && q.m[x[0]] != null){ s += wt * q.m[x[0]]; w += wt; } }); return w ? [x[0], s / w] : null; }).filter(Boolean);
    } else base = c.series || [];
    return smooth(base.map(function(x){ return [x[0], x[1]]; }), MAP[c.freq || 'monthly'][st.ma] || 1);
  }
  function rng(arr){ var k = cut(); return arr.filter(function(x){ return T(x[0]) >= k; }); }
  function bandOf(v){ return Math.min(4, Math.max(0, Math.floor(v * 5))); }
  function draw(hT){
    var c = chart(); if(!c) return;
    var W = cv.clientWidth || 640, H = cv.clientHeight || 380, dpr = window.devicePixelRatio || 1; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H); x.font = '11px system-ui,sans-serif';
    var L = 52, R = 44, TP = 10, B = 24, pw = W - L - R, ph = H - TP - B, kind = c.kind;
    var main = kind === 'lines' ? [] : rng(mainSeries(c)), ov = (st.ov && c.overlay) ? rng(c.overlay.series) : [], lines = kind === 'lines' ? c.lines.map(function(l){ return {l: l, s: rng(l.s)}; }) : [];
    var tmin = 1e18, tmax = -1e18; [main, ov].forEach(function(a){ a.forEach(function(p){ var t = T(p[0]); if(t < tmin) tmin = t; if(t > tmax) tmax = t; }); }); lines.forEach(function(o){ o.s.forEach(function(p){ var t = T(p[0]); if(t < tmin) tmin = t; if(t > tmax) tmax = t; }); });
    if(!(tmax > tmin)){ x.fillStyle = '#8a8a92'; x.fillText('No data for this range', L, H / 2); geo = null; return; }
    var X = function(t){ return L + (t - tmin) / (tmax - tmin) * pw; };
    var ly = function(lo, hi){ var a = Math.log(lo), b = Math.log(hi); return function(v){ return TP + (1 - (Math.log(Math.max(v, lo)) - a) / (b - a)) * ph; }; };
    function logTicks(lo, hi){ var o = [], p = Math.pow(10, Math.floor(Math.log10(lo))); for(; p <= hi * 1.001; p *= 10){ [1, 2, 5].forEach(function(m){ var v = p * m; if(v >= lo * 0.999 && v <= hi * 1.001) o.push(v); }); } return o.length > 7 ? o.filter(function(v){ return String(v)[0] === '1'; }) : o; }
    // year ticks
    var y0 = new Date(tmin).getUTCFullYear() + 1, y1 = new Date(tmax).getUTCFullYear(), step = Math.max(1, Math.ceil((y1 - y0 + 1) / (pw < 420 ? 4 : 9)));
    x.strokeStyle = 'rgba(255,255,255,.06)'; x.fillStyle = '#8a8a92'; x.textAlign = 'center';
    for(var yy = y0; yy <= y1; yy += step){ var xx = X(Date.UTC(yy, 0, 1)); if(xx < L || xx > L + pw) continue; x.beginPath(); x.moveTo(xx, TP); x.lineTo(xx, TP + ph); x.stroke(); x.fillText(yy, xx, H - 8); }
    var Ym = null, Yo = null;
    // overlay axis (left, log)
    if(ov.length){ var ovs = ov.map(function(p){ return p[1]; }), lo = Math.min.apply(null, ovs), hi = Math.max.apply(null, ovs); lo = lo * 0.9; hi = hi * 1.1; Yo = ly(lo, hi); x.textAlign = 'right'; logTicks(lo, hi).forEach(function(v){ var yv = Yo(v); x.fillStyle = '#4da3ff'; x.fillText(fmtP(v), L - 6, yv + 3); }); }
    if(kind === 'risk'){
      Ym = function(v){ return TP + (1 - v) * ph; };
      for(var b = 0; b < 5; b++){ x.fillStyle = 'rgba(' + BC[4 - b] + ',.10)'; var t0 = Ym(1 - b * 0.2), t1 = Ym(1 - (b + 1) * 0.2); x.fillRect(L, t0, pw, t1 - t0); x.fillStyle = 'rgba(' + BC[4 - b] + ',.9)'; x.textAlign = 'left'; x.fillText(c.bands[4 - b], L + 6, t0 + 13); }
      x.textAlign = 'left'; x.fillStyle = '#c9c9d0'; for(var g = 0; g <= 5; g++){ x.fillText((g / 5).toFixed(1), L + pw + 6, Ym(g / 5) + 3); }
    } else {
      var vals = kind === 'ratio' ? main.map(function(p){ return p[1]; }) : [].concat.apply([], lines.map(function(o){ return o.s.map(function(p){ return p[1]; }); }));
      var lo2 = Math.max(1e-6, Math.min.apply(null, vals) * 0.85), hi2 = Math.max.apply(null, vals) * 1.15; if(kind === 'ratio'){ lo2 = Math.min(lo2, 0.4); hi2 = Math.max(hi2, 5); } Ym = ly(lo2, hi2);
      if(kind === 'ratio' && c.zones) c.zones.forEach(function(z){ var a = Ym(Math.min(z.hi, hi2)), bb = Ym(Math.max(z.lo, lo2)); x.fillStyle = 'rgba(' + z.c + ',.12)'; x.fillRect(L, a, pw, bb - a); x.fillStyle = 'rgba(' + z.c + ',.95)'; x.textAlign = 'left'; x.fillText(z.label, L + 6, (z.lo === 0 ? bb - 5 : a + 13)); });
      x.textAlign = 'left'; x.fillStyle = '#c9c9d0'; logTicks(lo2, hi2).forEach(function(v){ var yv = Ym(v); x.strokeStyle = 'rgba(255,255,255,.05)'; x.beginPath(); x.moveTo(L, yv); x.lineTo(L + pw, yv); x.stroke(); x.fillText(fmtP(v), L + pw + 6, yv + 3); });
      if(kind === 'lines' && ov.length === 0){ /* price axis is the right axis */ }
    }
    // overlay line
    if(ov.length){ x.strokeStyle = '#4da3ff'; x.lineWidth = 1.2; x.beginPath(); ov.forEach(function(p, i){ var px = X(T(p[0])), py = Yo(p[1]); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke(); }
    x.save(); x.beginPath(); x.rect(L, TP, pw, ph); x.clip();
    if(kind === 'lines'){ lines.forEach(function(o){ x.strokeStyle = o.l.c; x.lineWidth = o.l.w || 1.2; x.setLineDash(o.l.dash ? [5, 4] : []); x.beginPath(); o.s.forEach(function(p, i){ var px = X(T(p[0])), py = Ym(p[1]); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke(); }); x.setLineDash([]); }
    else if(main.length){
      if(kind === 'risk' && st.col){ x.lineWidth = 2; for(var i = 1; i < main.length; i++){ x.strokeStyle = colFor((main[i][1] + main[i - 1][1]) / 2); x.beginPath(); x.moveTo(X(T(main[i - 1][0])), Ym(main[i - 1][1])); x.lineTo(X(T(main[i][0])), Ym(main[i][1])); x.stroke(); } }
      else { x.strokeStyle = '#e8b038'; x.lineWidth = 1.8; x.beginPath(); main.forEach(function(p, i){ var px = X(T(p[0])), py = Ym(p[1]); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke(); }
    }
    if(kind === 'risk' && st.etf && ETF && main.length > 1){
      var ci = st.etf, bars = [], j = 0, prevT = T(main[0][0]) - 7 * 864e5, mx = 0;
      for(var q = 0; q < main.length; q++){ var tq = T(main[q][0]), sm = 0, got = false; while(j < ETF.length && T(ETF[j][0]) <= tq){ if(T(ETF[j][0]) > prevT){ sm += ETF[j][ci]; got = true; } j++; } prevT = tq; if(got){ bars.push([main[q][0], sm]); mx = Math.max(mx, Math.abs(sm)); } }
      if(bars.length && mx > 0){ var zone = ph * 0.24, base = TP + ph - zone / 2 - 2, bw = Math.max(1.5, Math.min(12, pw / main.length * 0.8));
        x.fillStyle = 'rgba(255,255,255,.04)'; x.fillRect(L, TP + ph - zone - 4, pw, zone + 4); x.strokeStyle = 'rgba(255,255,255,.18)'; x.beginPath(); x.moveTo(L, base); x.lineTo(L + pw, base); x.stroke();
        bars.forEach(function(b){ var hh = (Math.abs(b[1]) / mx) * (zone / 2 - 2); x.fillStyle = b[1] >= 0 ? 'rgba(63,185,122,.85)' : 'rgba(224,85,77,.85)'; x.fillRect(X(T(b[0])) - bw / 2, b[1] >= 0 ? base - hh : base, bw, Math.max(1, hh)); });
        x.fillStyle = '#c9c9d0'; x.textAlign = 'left'; x.fillText('ETF net flow per period (up = inflow)', L + 6, TP + ph - zone + 8); }
      etfBars = bars;
    } else etfBars = null;
    x.restore();
    geo = {L: L, R: R, TP: TP, pw: pw, ph: ph, tmin: tmin, tmax: tmax, X: X, Ym: Ym, Yo: Yo, main: main, ov: ov, lines: lines, W: W, H: H};
    if(hT != null) hover(hT, x);
  }
  function near(arr, t){ var lo = 0, hi = arr.length - 1; if(!arr.length) return null; while(hi - lo > 1){ var m = (lo + hi) >> 1; if(T(arr[m][0]) < t) lo = m; else hi = m; } return Math.abs(T(arr[lo][0]) - t) < Math.abs(T(arr[hi][0]) - t) ? arr[lo] : arr[hi]; }
  function hover(t, x){
    var c = chart(), g = geo, tip = $('rkTip'); if(!g) return;
    var ref = c.kind === 'lines' ? (g.lines[0] ? g.lines[0].s : []) : g.main, p = near(ref, t); if(!p){ tip.style.display = 'none'; return; }
    var px = g.X(T(p[0])); x.strokeStyle = 'rgba(255,255,255,.35)'; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(px, g.TP); x.lineTo(px, g.TP + g.ph); x.stroke(); x.setLineDash([]);
    var h = '<b>' + esc(p[0]) + '</b>';
    if(c.kind === 'lines'){ g.lines.forEach(function(o){ var q = near(o.s, T(p[0])); if(q && Math.abs(T(q[0]) - T(p[0])) < 40 * 864e5) h += '<br><span style="color:' + o.l.c + '">' + esc(o.l.n) + ' $' + fmtP(q[1]) + '</span>'; }); }
    else { var py = g.Ym(p[1]); x.fillStyle = '#e8b038'; x.beginPath(); x.arc(px, py, 3.5, 0, 7); x.fill(); h += c.kind === 'risk' ? '<br><span style="color:rgb(' + BC[bandOf(p[1])] + ')">' + esc(c.title.replace(/ Risk$/, '')) + ' ' + p[1].toFixed(3) + ' · ' + esc(c.bands[bandOf(p[1])]) + '</span>' : '<br><span style="color:#e8b038">' + p[1].toFixed(2) + '</span>';
      if(c.extra){ var q = near(c.extra.series, T(p[0])); if(q) h += '<br><span style="color:#c9c9d0">' + esc(c.extra.name) + ' ' + q[1] + '</span>'; }
      if(etfBars){ var eb = null; etfBars.forEach(function(b){ if(b[0] === p[0]) eb = b; }); if(eb) h += '<br><span style="color:' + (eb[1] >= 0 ? '#3fb97a' : '#e0554d') + '">ETF net flow ' + (eb[1] >= 0 ? '+' : '-') + '$' + Math.abs(eb[1]).toFixed(0) + 'M</span>'; }
      if(g.ov.length){ var o = near(g.ov, T(p[0])); if(o) h += '<br><span style="color:#4da3ff">' + esc(c.overlay.name) + ' ' + fmtP(o[1]) + '</span>'; } }
    tip.innerHTML = h; tip.style.display = 'block'; var tw = tip.offsetWidth; tip.style.left = Math.max(4, Math.min(g.W - tw - 4, px + 10)) + 'px'; tip.style.top = (g.TP + 6) + 'px';
  }
  function evT(ev){ var r = cv.getBoundingClientRect(), cx = (ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX) - r.left; if(!geo) return null; if(cx < geo.L || cx > geo.L + geo.pw) return null; return geo.tmin + (cx - geo.L) / geo.pw * (geo.tmax - geo.tmin); }
  ['mousemove', 'touchmove', 'touchstart'].forEach(function(n){ cv.addEventListener(n, function(ev){ var t = evT(ev); if(t == null){ $('rkTip').style.display = 'none'; draw(); return; } draw(t); }, {passive: true}); });
  ['mouseleave', 'touchend'].forEach(function(n){ cv.addEventListener(n, function(){ $('rkTip').style.display = 'none'; draw(); }); });
  function ui(){
    var c = chart(); if(!c) return;
    $('rkTitle').textContent = c.title; $('rkSub').textContent = c.sub || ''; $('rkDesc').textContent = c.desc || ''; $('rkHow').textContent = c.how || ''; var stl = $('rkStale'); stl.textContent = c.lag ? 'The data source for this chart is behind: it runs to ' + c.lag + ' and will catch up when the source does.' : 'This chart could not refresh on the last update, so it shows older data.'; stl.style.display = (c.stale || c.lag) ? 'block' : 'none';
    var l = c.latest; if(c.kind === 'risk' && l){ var bi = bandOf(l[1]); $('rkNow').innerHTML = '<b style="color:rgb(' + BC[bi] + ')">' + l[1].toFixed(2) + '</b><span style="color:rgb(' + BC[bi] + ');border-color:rgb(' + BC[bi] + ')">' + esc(c.bands[bi]) + '</span><div class="rk-sub" style="margin:3px 0 0">as of ' + esc(l[0]) + '</div>'; }
    else if(l){ $('rkNow').innerHTML = '<b>' + (c.kind === 'lines' ? '$' + fmtP(l[1]) : l[1].toFixed(2)) + '</b><div class="rk-sub" style="margin:3px 0 0">as of ' + esc(l[0]) + '</div>'; } else $('rkNow').innerHTML = '';
    $('rkColG').style.display = c.kind === 'risk' ? '' : 'none'; $('rkEtfG').style.display = (ETF && (c.id === 'btcrisk' || c.id === 'totalrisk')) ? '' : 'none'; if(!(c.id === 'btcrisk' || c.id === 'totalrisk')) st.etf = 0; $('rkOvG').style.display = c.overlay ? '' : 'none'; $('rkOv').textContent = (c.overlay ? c.overlay.name : '') + (st.ov ? ' on' : ' off'); $('rkOv').classList.toggle('on', st.ov);
    var pr = $('rkParts'); if(c.parts){ pr.className = 'rk-parts show'; pr.innerHTML = c.parts.map(function(p){ var v = st.w[p.k] == null ? 1 : st.w[p.k]; return '<div class="rk-pt"><label><span>' + esc(p.name) + '</span><b>' + (+v).toFixed(1) + '</b></label><input type="range" min="0" max="1" step="0.1" value="' + v + '" data-k="' + p.k + '"></div>'; }).join(''); } else { pr.className = 'rk-parts'; pr.innerHTML = ''; }
    var leg = []; if(c.kind === 'lines') c.lines.forEach(function(o){ leg.push('<span><i style="background:' + o.c + '"></i>' + esc(o.n) + '</span>'); }); else { leg.push('<span><i style="background:#e8b038"></i>' + esc(c.title) + '</span>'); if(st.etf && ETF) leg.push('<span><i style="background:#3fb97a"></i>ETF inflows / <i style="background:#e0554d;margin-left:6px"></i>outflows (bottom bars)</span>'); if(st.ov && c.overlay) leg.push('<span><i style="background:#4da3ff"></i>' + esc(c.overlay.name) + ' (left, log scale)</span>'); }
    $('rkLeg').innerHTML = leg.join('');
    (function(){ var bx = $('rkCyc'); if(!CYC || ['logreg', 'btcrisk', 'puell'].indexOf(c.id) < 0){ bx.style.display = 'none'; return; }
      function side(t, o, col){ return '<div class="rk-cy"><div class="rk-cyh"><b style="color:' + col + '">' + t + '</b><span style="color:' + col + ';border-color:' + col + '">' + o.n + ' of ' + o.of + ' · ' + (o.pct || 0) + '%' + (o.level !== 'None' ? ' · ' + o.level : '') + '</span></div>' + o.votes.map(function(v){ return '<div class="rk-cyv' + (v.on ? ' on' : '') + '"><i>' + (v.on ? '●' : '○') + '</i><span>' + esc(v.name) + '</span><em>' + esc(v.detail) + '</em></div>'; }).join('') + '</div>'; }
      bx.innerHTML = '<h4 class="rk-h">Bitcoin cycle signals today <span style="font-weight:400;color:#8a8a92">as of ' + esc(CYC.as_of) + '</span></h4><div class="rk-cyg">' + side('Bear-market low zone', CYC.low, '#3fb47a') + side('Cycle-top risk', CYC.top, '#e0554d') + '</div><p class="rk-p" style="color:#8a8a92;font-size:11.5px">Each signal is a simple yes or no. The more that agree, the stronger the signal. The TTM Team gets a phone alert when a new level is reached. Educational only, not financial advice.</p>'; bx.style.display = ''; })();
    sec.querySelectorAll('[data-e]').forEach(function(x){ x.classList.toggle('on', +x.dataset.e === st.etf); });
    document.querySelectorAll('#rkChips .rk-chip').forEach(function(b){ b.classList.toggle('on', b.dataset.id === cur); });
    draw();
  }
  sec.addEventListener('click', function(ev){ var b = ev.target.closest('button'); if(!b) return;
    if(b.dataset.id){ cur = b.dataset.id; ui(); return; } if(b.dataset.r != null){ st.rng = +b.dataset.r; sec.querySelectorAll('[data-r]').forEach(function(x){ x.classList.toggle('on', x === b); }); draw(); return; }
    if(b.dataset.m != null){ st.ma = +b.dataset.m; sec.querySelectorAll('[data-m]').forEach(function(x){ x.classList.toggle('on', x === b); }); draw(); return; }
    if(b.dataset.e != null){ st.etf = +b.dataset.e; sec.querySelectorAll('[data-e]').forEach(function(x){ x.classList.toggle('on', x === b); }); ui(); return; }
    if(b.dataset.c != null){ st.col = +b.dataset.c; sec.querySelectorAll('[data-c]').forEach(function(x){ x.classList.toggle('on', x === b); }); draw(); return; }
    if(b.id === 'rkOv'){ st.ov = !st.ov; ui(); } });
  sec.addEventListener('input', function(ev){ var i = ev.target; if(i.dataset && i.dataset.k){ st.w[i.dataset.k] = +i.value; i.parentNode.querySelector('b').textContent = (+i.value).toFixed(1); draw(); } });
  window.addEventListener('resize', function(){ draw(); });
  function load(){ if(loaded) return; loaded = true;
    fetch('../risk_data.json?' + Date.now().toString(36).slice(0, 6)).then(function(r){ if(!r.ok) throw 0; return r.json(); }).then(function(d){ if(!d.charts || !d.charts.length) throw 0; ALLC = d.charts; if(CFG.ids){ d.charts = CFG.ids.map(function(id){ return ALLC.filter(function(c){ return c.id === id; })[0]; }).filter(Boolean); if(!d.charts.length) throw 0; } D = d;
      (function(){ var bk = $('rkBack'); if(!CFG.backdrop || !bk) return; var cs = CFG.backdrop.ids.map(function(id){ return ALLC.filter(function(c){ return c.id === id; })[0]; }).filter(function(c){ return c && c.latest; }); if(!cs.length) return; bk.innerHTML = '<small>Macro backdrop<a href="' + CFG.backdrop.url + '">All macro risk charts ›</a></small>' + cs.map(function(c){ var bi = bandOf(c.latest[1]), col = 'rgb(' + BC[bi] + ')'; return '<a class="rk-bk" href="' + CFG.backdrop.url + '"><b>' + esc(c.title) + '</b><span style="color:' + col + '">' + c.latest[1].toFixed(2) + ' · ' + esc(c.bands[bi]) + '</span></a>'; }).join(''); bk.style.display = 'grid'; })();
      $('rkChips').innerHTML = d.charts.map(function(c){ var l = c.latest, v = '', col = '#c9c9d0'; if(c.kind === 'risk' && l){ var bi = bandOf(l[1]); v = l[1].toFixed(2) + ' · ' + c.bands[bi]; col = 'rgb(' + BC[bi] + ')'; } return '<button class="rk-chip" data-id="' + c.id + '"><b>' + esc(c.title) + '</b><span style="color:' + col + '">' + esc(v || ' ') + '</span></button>'; }).join('');
      $('rkUpdated').textContent = 'Updated ' + new Date(d.generated_at).toLocaleString([], {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}) + '. Free data from FRED, Coin Metrics and Yahoo Finance.'; if(!chart()) cur = d.charts[0].id; ui();
      if(CFG.cycle !== false) fetch('../cycle_signals.json?' + Date.now().toString(36).slice(0, 6)).then(function(r){ if(!r.ok) throw 0; return r.json(); }).then(function(e){ if(e && e.low && e.top){ CYC = e; ui(); } }).catch(function(){});
      if(CFG.etf !== false) fetch('../etf_flows_total.json').then(function(r){ if(!r.ok) throw 0; return r.json(); }).then(function(e){ if(e && e.rows && e.rows.length){ ETF = e.rows; ui(); } }).catch(function(){});
    }).catch(function(){ loaded = false; $('rkUpdated').textContent = 'Risk charts are not available yet. They appear after the first data update.'; }); }
  var obs = new IntersectionObserver(function(es){ if(es.some(function(e){ return e.isIntersecting; })) load(); }, {rootMargin: '300px'}); obs.observe(sec); if(location.hash === '#riskcharts') load();
  window.addEventListener('hashchange', function(){ if(location.hash === '#riskcharts') load(); });
})();

