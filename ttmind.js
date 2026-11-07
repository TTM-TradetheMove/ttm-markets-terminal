/* TTM indicator pack for TTM Charts (BETA). Converted from TTM's TradingView (Pine) indicators.
   Each indicator: {id, name, pane:'overlay'|'sub', calc(rows)->result, under(api), over(api), candleColor, panel(api), subPaint(api)}.
   api = {c, g, X, Y, d, i0, i1, res, S, step, daily(sym), repaint()}.  Session times and weekdays use UTC. */
(function(){
const L = window.TTM_INDICATORS = window.TTM_INDICATORS || [];
const DAY = 864e5, utc = t => { const D = new Date(t); return {dow: D.getUTCDay(), min: D.getUTCHours() * 60 + D.getUTCMinutes()}; };
const emaA = (a, n) => { const k = 2 / (n + 1), o = []; let e = null; a.forEach((v, i) => { if(v == null){ o.push(null); return; } e = e == null ? v : v * k + e * (1 - k); o.push(i >= n - 1 ? e : null); }); return o; };
const smaA = (a, n) => a.map((v, i) => { if(i < n - 1) return null; let s = 0; for(let k = i - n + 1; k <= i; k++){ if(a[k] == null) return null; s += a[k]; } return s / n; });
const rsiA = (a, n) => { const o = a.map(() => null); let g = 0, l = 0; for(let i = 1; i < a.length; i++){ const d = a[i] - a[i - 1]; if(i <= n){ g += Math.max(d, 0); l += Math.max(-d, 0); if(i === n){ g /= n; l /= n; o[i] = 100 - 100 / (1 + (l ? g / l : 1e9)); } } else { g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; o[i] = 100 - 100 / (1 + (l ? g / l : 1e9)); } } return o; };
const atrA = (r, n) => { const o = []; let a = null; r.forEach((x, i) => { const tr = i ? Math.max(x.h - x.l, Math.abs(x.h - r[i - 1].c), Math.abs(x.l - r[i - 1].c)) : x.h - x.l; a = i === 0 ? tr : (a * (n - 1) + tr) / n; o.push(i >= n - 1 ? a : null); }); return o; };
const closes = r => r.map(x => x.c);
function line(a, s, color, w){ const {c, X, Y, i0, i1} = a; c.strokeStyle = color; c.lineWidth = w || 1.5; c.beginPath(); let on = false; for(let i = i0; i <= i1; i++){ const v = s[i]; if(v == null){ on = false; continue; } if(on) c.lineTo(X(i), Y(v)); else { c.moveTo(X(i), Y(v)); on = true; } } c.stroke(); c.lineWidth = 1; }
function tagL(c, x, y, text, bg, fg, up){ c.font = '700 9px system-ui,sans-serif'; const w = c.measureText(text).width + 8, h = 14, yy = up ? y - h - 3 : y + 3; c.fillStyle = bg; c.beginPath(); c.roundRect ? c.roundRect(x - w / 2, yy, w, h, 3) : c.rect(x - w / 2, yy, w, h); c.fill(); c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, yy + h / 2 + .5); c.font = '11px system-ui,sans-serif'; }
function box(a, x1, x2, yT, yB, fill, stroke){ const {c} = a; c.fillStyle = fill; c.fillRect(x1, yT, x2 - x1, yB - yT); if(stroke){ c.strokeStyle = stroke; c.strokeRect(x1 + .5, yT + .5, x2 - x1 - 1, yB - yT - 1); } }
const push = o => { o.ttm = true; L.push(o); };

/* 1. PVSRA candle colours (volume vector candles) */
push({id: 'pvsra', name: 'PVSRA candles (TTM)', pane: 'overlay', calc: r => {
  const hl = r.map(x => x.v * (x.h - x.l)), out = [];
  r.forEach((x, i) => { if(i < 10){ out.push(x.c >= x.o ? '#ffffff' : '#808080'); return; }
    let av = 0, mx = 0; for(let k = i - 10; k < i; k++){ av += r[k].v; mx = Math.max(mx, hl[k]); } av /= 10;
    const va = (x.v >= av * 2 || hl[i] >= mx) ? 200 : x.v >= av * 1.5 ? 150 : 0, bull = x.c > x.o;
    out.push(va === 200 ? (bull ? '#00ff00' : '#ff0000') : va === 150 ? (bull ? '#0000ff' : '#ff00ff') : (bull ? '#ffffff' : '#808080')); });
  return out; }});
L[L.length - 1].candleColor = true;
L[L.length - 1].alerts = [{k: 'b200', name: 'Bullish 200% volume vector candle'}, {k: 's200', name: 'Bearish 200% volume vector candle'}, {k: 'b150', name: 'Bullish 150% vector candle'}, {k: 's150', name: 'Bearish 150% vector candle'}];
L[L.length - 1].alertHits = (r, cols) => { const M = {'#00ff00': 'b200', '#ff0000': 's200', '#0000ff': 'b150', '#ff00ff': 's150'}, o = []; cols.forEach((c, i) => { if(M[c]) o.push({i, k: M[c]}); }); return o; };

/* 2. Session boxes: Asia 01:30-08:00, UK 08:30-14:00, US 14:30-22:00 (UTC), with the % move */
const SESS = [['ASIA', 90, 480, '#ffd600', '#000'], ['UK', 510, 840, '#ff3b30', '#fff'], ['US', 870, 1320, '#2f7bff', '#fff']];
push({id: 'sess', name: 'Session boxes: Asia / UK / US (TTM)', pane: 'overlay', calc: r => {
  const out = []; if(r.length < 2 || r[1].t - r[0].t > 36e5 * 1.01) return out;
  SESS.forEach((s, k) => { let st = null, hi = 0, lo = 1e18; const done = (end) => { if(st != null) out.push({k, a: st, b: end, hi, lo}); st = null; hi = 0; lo = 1e18; };
    r.forEach((x, i) => { const m = utc(x.t).min, inn = m >= s[1] && m < s[2]; if(inn){ if(st == null) st = i; hi = Math.max(hi, x.h); lo = Math.min(lo, x.l); } else done(i - 1); }); done(r.length - 1); });
  return out; },
  under: a => { const {c, g, X, Y, i0, i1} = a, w = g.w; (a.res || []).forEach(b => { if(b.b < i0 || b.a > i1) return; const s = SESS[b.k], col = s[3]; box(a, X(b.a) - w / 2, X(b.b) + w / 2, Y(b.hi), Y(b.lo), col + '33', col); const mv = (b.hi - b.lo) / b.lo * 100; tagL(c, (X(b.a) + X(b.b)) / 2, Y(b.hi), s[0] + ' ' + mv.toFixed(2) + '%', col, s[4], true); }); }});

/* 3. Weekend shading: Saturday orange, Sunday purple */
push({id: 'wknd', name: 'Weekend shading (TTM)', pane: 'overlay', alerts: [{k: 'sat', name: 'Saturday has started'}, {k: 'sun', name: 'Sunday has started'}, {k: 'end', name: 'Weekend has finished'}], alertHits: r => { const o = []; for(let i = Math.max(1, r.length - 6); i < r.length; i++){ const a = utc(r[i - 1].t).dow, b = utc(r[i].t).dow; if(a !== b){ if(b === 6) o.push({i, k: 'sat'}); else if(b === 0) o.push({i, k: 'sun'}); else if(b === 1) o.push({i, k: 'end'}); } } return o; }, calc: () => null, under: a => { const {c, g, X, i0, i1, d} = a, w = g.w; for(let i = i0; i <= i1; i++){ const dw = utc(d[i].t).dow; if(dw !== 6 && dw !== 0) continue; c.fillStyle = dw === 6 ? 'rgba(255,152,0,.14)' : 'rgba(156,39,176,.16)'; c.fillRect(X(i) - w / 2, g.mT, w + .5, g.mB - g.mT); } }});

/* 4. TTM EMA cloud (9/21) + extra MAs (5/13/40) + confirmed (CB/CS) signals (early EL/ES signals removed) */
push({id: 'ttmema', name: 'TTM EMA cloud + signals', pane: 'overlay', calc: r => {
  const cl = closes(r), f = emaA(cl, 9), s = emaA(cl, 21), m1 = emaA(cl, 5), m2 = emaA(cl, 13), m3 = emaA(cl, 40), sig = [];
  r.forEach((x, i) => { if(i < 1 || f[i] == null || f[i - 1] == null || s[i] == null || s[i - 1] == null) return;
    const far = Math.abs(x.c - f[i]) / f[i] > .0005, p = r[i - 1].c;
        if(f[i - 1] <= s[i - 1] && f[i] > s[i]) sig.push({i, k: 'CB'}); if(f[i - 1] >= s[i - 1] && f[i] < s[i]) sig.push({i, k: 'CS'}); });
  return {f, s, m1, m2, m3, sig}; },
  alerts: [{k: 'CB', name: 'Confirmed buy: fast EMA crossed above slow EMA'}, {k: 'CS', name: 'Confirmed sell: fast EMA crossed below slow EMA'}], alertHits: (r, R) => R.sig,
  under: a => { const R = a.res, {c, X, Y, i0, i1} = a; if(!R) return; let seg = []; const flush = (up) => { if(seg.length < 2) { seg = []; return; } c.fillStyle = up ? 'rgba(167,219,129,.30)' : 'rgba(255,82,82,.24)'; c.beginPath(); seg.forEach((p, k) => k ? c.lineTo(X(p.i), Y(p.f)) : c.moveTo(X(p.i), Y(p.f))); for(let k = seg.length - 1; k >= 0; k--) c.lineTo(X(seg[k].i), Y(seg[k].s)); c.closePath(); c.fill(); seg = []; };
    let up = null; for(let i = i0; i <= i1; i++){ if(R.f[i] == null || R.s[i] == null){ flush(up); continue; } const u = R.f[i] > R.s[i]; if(up !== null && u !== up) flush(up); up = u; seg.push({i, f: R.f[i], s: R.s[i]}); } flush(up); },
  over: a => { const R = a.res, {c, X, Y, d} = a; if(!R) return; line(a, R.m1, '#21cdf3', 1.2); line(a, R.m2, '#ff4b3b', 1.2); line(a, R.m3, '#d29314', 1.2); line(a, R.f, '#dd00ff', 1.6); line(a, R.s, '#a0d82e', 1.6);
    R.sig.forEach(s => { if(s.i < a.i0 || s.i > a.i1) return; const x = X(s.i), r = d[s.i], low = s.k === 'EL' || s.k === 'CB'; tagL(c, x, low ? Y(r.l) : Y(r.h), s.k, s.k === 'EL' ? '#2e9e4f' : s.k === 'ES' ? '#d93a35' : s.k === 'CB' ? '#00c853' : '#8b1a1a', '#fff', !low); }); }});

/* 5. CME gap (Friday 21:00 UTC close to Monday open), BTC / ETH / XRP / SOL only. Hidden once filled. */
push({id: 'cme', name: 'CME gap (TTM)', pane: 'overlay', calc: (r, S) => {
  const out = {}; if(!r.length) return out; let fri = null;
  for(let i = 0; i < r.length; i++){ const u = utc(r[i].t); if(u.dow === 5 && u.min <= 21 * 60) fri = {i, c: r[i].c}; else if(u.dow === 1 && fri && i > fri.i && (i === 0 || utc(r[i - 1].t).dow !== 1)){ out.g = {a: fri.i, m: i, close: fri.c, top: Math.max(fri.c, r[i].o), bot: Math.min(fri.c, r[i].o)}; fri = null; } }
  if(fri && !out.g) out.fri = fri; else if(fri && out.g && fri.i > out.g.m) { out.fri = fri; out.g = null; }
  if(out.g){ let h = r[out.g.m].h, l = r[out.g.m].l; out.g.fill = null; for(let i = out.g.m; i < r.length; i++){ h = Math.max(h, r[i].h); l = Math.min(l, r[i].l); if(Math.min(out.g.top, h) - Math.max(out.g.bot, l) >= (out.g.top - out.g.bot) * .9999 && out.g.fill == null) out.g.fill = i; } out.g.pct = Math.min(1, (Math.min(out.g.top, h) - Math.max(out.g.bot, l)) / ((out.g.top - out.g.bot) || 1)); }
  return out; },
  alerts: [{k: 'fill', name: 'CME gap filled'}], alertHits: (r, R) => R && R.g && R.g.fill != null ? [{i: R.g.fill, k: 'fill'}] : [],
  over: a => { const R = a.res, {c, g, X, Y, S} = a; if(!R || !/^(BTC|ETH|XRP|SOL)$/.test(S.sym)) return; const w = g.w;
    if(R.fri){ const y = Y(R.fri.c); c.strokeStyle = '#ffd600'; c.beginPath(); c.moveTo(X(R.fri.i), y); c.lineTo(g.pw, y); c.stroke(); tagL(c, X(R.fri.i), y, 'CME Friday close', '#ffd600', '#000', true); }
    if(R.g && R.g.fill == null){ const gp = R.g, col = gp.pct >= .5 ? '#ff9800' : '#ff3b30', yT = Y(gp.top), yB = Y(gp.bot); box(a, X(gp.a), g.pw, yT, Math.max(yB, yT + 2), col + '30', col); tagL(c, Math.min(g.pw - 40, (X(gp.a) + g.pw) / 2), yT, 'CME GAP ' + Math.round(gp.pct * 100) + '% filled', col, '#fff', true); } }});

/* 6. Monday high / low (current week) */
push({id: 'mon', name: 'Monday high / low (TTM)', pane: 'overlay', calc: r => {
  let st = -1; for(let i = r.length - 1; i >= 0; i--){ if(utc(r[i].t).dow === 1){ st = i; if(i === 0 || utc(r[i - 1].t).dow !== 1){ break; } } else if(st >= 0) break; }
  if(st < 0) return null; let hi = -1, lo = 1e18, hb = st, lb = st; for(let i = st; i < r.length && utc(r[i].t).dow === 1; i++){ if(r[i].h > hi){ hi = r[i].h; hb = i; } if(r[i].l < lo){ lo = r[i].l; lb = i; } } return {hi, lo, hb, lb}; },
  over: a => { const R = a.res, {c, g, X, Y} = a; if(!R) return; c.strokeStyle = '#d4af37'; c.lineWidth = 2; [[R.hi, R.hb, 'MON HIGH', true], [R.lo, R.lb, 'MON LOW', false]].forEach(z => { const y = Y(z[0]); c.beginPath(); c.moveTo(X(z[1]), y); c.lineTo(g.pw, y); c.stroke(); tagL(c, g.pw - 34, y, z[2], '#d4af37', '#000', z[3]); }); c.lineWidth = 1; }});

/* 7. Supply / demand zones with POI and BOS (swing 10, ATR 50, width 2.5, keep 20) */
push({id: 'sd', name: 'Supply / demand zones + BOS (TTM)', pane: 'overlay', calc: r => {
  const N = 10, KEEP = 20, WID = 2.5, atr = atrA(r, 50), Z = [], BOS = []; if(r.length < N * 2 + 2) return {Z, BOS};
  for(let i = 2 * N; i < r.length; i++){ const cI = i - N; let ph = true, pl = true;
    for(let k = i - 2 * N; k <= i; k++){ if(k === cI) continue; if(r[k].h > r[cI].h || (k < cI && r[k].h === r[cI].h)) ph = false; if(r[k].l < r[cI].l || (k < cI && r[k].l === r[cI].l)) pl = false; }
    const a = atr[i] != null ? atr[i] : (r[i].h - r[i].l), buf = a * (WID / 10);
    const add = (type, top, bot) => { const poi = (top + bot) / 2; if(Z.some(z => Math.abs((z.top + z.bot) / 2 - poi) <= a * 2)) return; Z.unshift({type, a: cI, top, bot}); if(Z.length > KEEP) Z.pop(); };
    if(ph) add('s', r[cI].h, r[cI].h - buf); else if(pl) add('d', r[cI].l + buf, r[cI].l);
    for(let k = Z.length - 1; k >= 0; k--){ const z = Z[k]; if((z.type === 's' && r[i].c >= z.top) || (z.type === 'd' && r[i].c <= z.bot)){ BOS.push({a: z.a, b: i, y: (z.top + z.bot) / 2}); Z.splice(k, 1); } } }
  return {Z, BOS: BOS.slice(-8)}; },
  over: a => { const R = a.res, {c, g, X, Y, i0} = a; if(!R) return; R.Z.forEach(z => { const x1 = Math.max(-5, X(z.a) - g.w / 2), yT = Y(z.top), yB = Y(z.bot), sup = z.type === 's';
      box(a, x1, g.pw, yT, yB, sup ? 'rgba(237,237,237,.22)' : 'rgba(0,255,255,.22)', sup ? 'rgba(255,255,255,.35)' : 'rgba(0,255,255,.45)'); const ym = (yT + yB) / 2; c.strokeStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.moveTo(x1, ym); c.lineTo(g.pw, ym); c.stroke(); c.fillStyle = '#fff'; c.font = '700 9px system-ui,sans-serif'; c.textAlign = 'center'; c.fillText(sup ? 'SUPPLY' : 'DEMAND', (Math.max(x1, 0) + g.pw) / 2, ym - 1); c.textAlign = 'left'; c.fillText('POI', Math.max(x1, 0) + 3, ym - 6); c.font = '11px system-ui,sans-serif'; });
    R.BOS.forEach(b => { const x1 = X(b.a), x2 = X(b.b), y = Y(b.y); c.strokeStyle = 'rgba(255,255,255,.8)'; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(x1, y); c.lineTo(x2, y); c.stroke(); c.setLineDash([]); c.fillStyle = '#fff'; c.font = '700 9px system-ui,sans-serif'; c.textAlign = 'center'; c.fillText('BOS', (x1 + x2) / 2, y - 6); c.font = '11px system-ui,sans-serif'; }); }});

/* 8. SMA stack 13 / 21 / 50 / 100 / 200 / 300 with a value legend */
const SMAS = [[300, '#f5f6f7'], [200, '#2296f5'], [100, '#ff3b30'], [50, '#ffbb00'], [21, '#2ecc71'], [13, '#a259ff']];
push({id: 'smastack', name: 'SMA stack 13/21/50/100/200/300 (TTM)', pane: 'overlay', calc: r => { const cl = closes(r); return SMAS.map(s => ({n: s[0], col: s[1], v: smaA(cl, s[0])})); },
  over: a => { (a.res || []).forEach(s => line(a, s.v, s.col, 1.3)); },
  panel: a => ({pos: 'bl', rows: (a.res || []).map(s => { const v = s.v[a.d.length - 1]; return [['SMA ' + s.n, s.col], [v == null ? '—' : a.fx(v), s.col]]; })})});

/* 9. Moon cycle labels (real new-moon reference; New / First quarter / Full / Last quarter) */
const SYN = 29.530588853, REF = Date.UTC(2000, 0, 6, 18, 14), phaseOf = t => { const p = ((t - REF) / DAY / SYN) % 1; return p < 0 ? p + 1 : p; };
const moonId = p => (p < .06 || p > .94) ? 1 : (p > .2 && p < .3) ? 2 : (p > .44 && p < .56) ? 3 : (p > .7 && p < .8) ? 4 : 0;
const MOON = {1: ['🌑', 'New Moon'], 2: ['🌓', 'First Quarter'], 3: ['🌕', 'Full Moon'], 4: ['🌗', 'Last Quarter']};
const moonState = p => { const m = moonId(p); return m ? MOON[m][0] + ' ' + MOON[m][1] : p < .5 ? '🌒 Waxing' : '🌘 Waning'; };
const moonBias = p => { const m = moonId(p); return (m === 1 || m === 3) ? ['⚠️ Reversal zone', '#ff9800'] : p < .5 ? ['🟢 Bull build', '#2ecc71'] : ['🔴 Bear build', '#ff3b30']; };
push({id: 'moon', name: 'Moon cycle (TTM)', pane: 'overlay', calc: r => { const ev = []; let last = 0; r.forEach((x, i) => { const m = moonId(phaseOf(x.t)); if(m && m !== last){ ev.push({i, m}); last = m; } }); return ev; },
  alerts: [{k: '1', name: 'New Moon'}, {k: '2', name: 'First Quarter'}, {k: '3', name: 'Full Moon'}, {k: '4', name: 'Last Quarter'}], alertHits: (r, ev) => ev.map(e => ({i: e.i, k: String(e.m)})),
  over: a => { const {c, X, Y, d, i0, i1} = a; (a.res || []).forEach(e => { if(e.i < i0 || e.i > i1) return; const up = e.m >= 3, r = d[e.i], x = X(e.i), y = up ? Y(r.h) - 16 : Y(r.l) + 22; c.font = '18px system-ui,sans-serif'; c.textAlign = 'center'; c.fillText(MOON[e.m][0], x, y); c.font = '700 9px system-ui,sans-serif'; c.fillStyle = '#e8e8ea'; c.fillText(MOON[e.m][1], x, up ? y - 14 : y + 14); c.font = '11px system-ui,sans-serif'; }); }});

/* 10. TTM dashboard: moon + EMA trend bias */
push({id: 'dash', name: 'TTM dashboard (moon + EMA bias)', pane: 'overlay', calc: r => { const cl = closes(r), f = emaA(cl, 9), s = emaA(cl, 21), i = r.length - 1; return {bias: f[i] == null || s[i] == null ? '⚪ Neutral' : f[i] > s[i] ? '🟢 Bull trend' : f[i] < s[i] ? '🔴 Bear trend' : '⚪ Neutral', col: f[i] > s[i] ? '#2ecc71' : f[i] < s[i] ? '#ff3b30' : '#8b8f9a'}; },
  panel: a => { const p = phaseOf(a.d[a.d.length - 1].t), mb = moonBias(p); return {pos: 'br', title: 'TTM INDICATORS', rows: [[['Moon', '#e8e8ea'], [moonState(p) + '  ' + mb[0], mb[1]]], [['EMA', '#e8e8ea'], [a.res.bias, a.res.col]]]}; }});

/* 11. Altcoin season index (how many of 19 big coins beat BTC over 90 days, from daily candles on the chosen exchange) */
const ALTS = ['ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'POL', 'LINK', 'LTC', 'UNI', 'XLM', 'NEAR', 'APT', 'ATOM', 'S', 'ALGO', 'VET'];
let ALT = {t: 0, key: '', v: null, busy: false};
push({id: 'alts', name: 'Altcoin season index (TTM)', pane: 'overlay', calc: () => null,
  panel: a => { const key = a.S.ex; if((!ALT.v || ALT.key !== key || Date.now() - ALT.t > 6e5) && !ALT.busy){ ALT.busy = true; (async () => { try{ const g = async s => { try{ return await a.daily(s); }catch(e){ return null; } }; const btc = await g('BTC'), res = await Promise.all(ALTS.map(g)); if(btc && btc.length > 91){ const bn = btc[btc.length - 1].c, bo = btc[btc.length - 91].c; let sc = 0, tot = 0; res.forEach(x => { if(x && x.length > 91){ tot++; if((x[x.length - 1].c / bn) / (x[x.length - 91].c / bo) > 1) sc++; } }); ALT = {t: Date.now(), key, v: tot ? {idx: sc / tot * 100, n: tot} : null, busy: false}; } else ALT.busy = false; }catch(e){ ALT.busy = false; } ALT.t = ALT.t || Date.now(); a.repaint(); })(); }
    if(!ALT.v) return {pos: 'tr', scale: 1.4, title: 'Index Season by TTM', rows: [[['Loading…', '#8b8f9a']]]};
    const v = ALT.v.idx, st = v >= 75 ? 'Altcoin Season' : v <= 25 ? 'Bitcoin Season' : 'Neutral', col = v >= 75 ? '#89dc41' : v <= 25 ? '#e7751d' : '#3d9f32';
    return {pos: 'tr', scale: 1.4, title: 'Index Season by TTM', rows: [[[v.toFixed(0) + ' (' + st + ')', col]], [[ALT.v.n + ' coins vs BTC, 90 days', '#8b8f9a']]]}; }});

/* 12. @tradethemove watermark */
push({id: 'wm', name: '@tradethemove watermark', always: true, pane: 'overlay', calc: () => null, under: a => { const {c, g} = a; c.save(); c.font = '800 38px system-ui,sans-serif'; c.fillStyle = 'rgba(219,161,24,.30)'; c.textAlign = 'center'; c.fillText('@tradethemove', g.pw / 2, (g.mT + g.mB) / 2); c.font = '700 16px system-ui,sans-serif'; c.fillText('Master the Market', g.pw / 2, (g.mT + g.mB) / 2 + 26); c.restore(); }});


/* 14. Key levels: opens plus previous high / low / close for the day, week, month, quarter and year (UTC, from daily candles) */
const KL = {};
const KLP = {
  d: {n: 'Daily', c: '#9aa3b5', k: t => Math.floor(t / 864e5), P: 'D'},
  w: {n: 'Weekly', c: '#4aa3ff', k: t => Math.floor((t - 3 * 864e5) / 6048e5), P: 'W'},
  m: {n: 'Monthly', c: '#b18cff', k: t => { const x = new Date(t); return x.getUTCFullYear() * 12 + x.getUTCMonth(); }, P: 'M'},
  q: {n: 'Quarterly', c: '#ff9f43', k: t => { const x = new Date(t); return x.getUTCFullYear() * 4 + Math.floor(x.getUTCMonth() / 3); }, P: 'Q'},
  y: {n: 'Yearly', c: '#dba118', k: t => new Date(t).getUTCFullYear(), P: 'Y'}
};
function klGroups(D, k){ const G = []; D.forEach(x => { const key = k(x.t), g = G[G.length - 1]; if(g && g.key === key){ g.h = Math.max(g.h, x.h); g.l = Math.min(g.l, x.l); g.c = x.c; } else G.push({key, t: x.t, o: x.o, h: x.h, l: x.l, c: x.c}); }); return G; }
Object.keys(KLP).forEach(id => { const L = KLP[id];
  push({id: 'kl_' + id, name: L.n + ' open + previous high / low / close (TTM)', pane: 'overlay', calc: () => null,
    over: a => { const {c, g, X, Y, d, S} = a; if(!d.length) return; const key = S.ex + ':' + S.sym; let e = KL[key];
      if(!e || (Date.now() - e.t > 9e5 && !e.busy)){ if(!e) e = KL[key] = {t: 0, D: null, busy: false}; e.busy = true; a.daily(S.sym, 1000).then(D => { e.D = D; e.t = Date.now(); e.busy = false; a.repaint(); }).catch(() => { e.busy = false; e.t = Date.now(); }); }
      if(!e.D || e.D.length < 3) return; const G = klGroups(e.D, L.k); if(G.length < 2) return; const cur = G[G.length - 1], pv = G[G.length - 2], step = d.length > 1 ? d[1].t - d[0].t : 36e5;
      const x0 = Math.max(0, X((cur.t - d[0].t) / step)); if(x0 > g.pw) return;
      c.save(); c.beginPath(); c.rect(0, g.mT, g.pw, g.mB - g.mT); c.clip(); c.font = '700 10px system-ui,sans-serif'; c.textBaseline = 'bottom'; c.textAlign = 'right';
      [[cur.o, L.P + 'O', 0], [pv.h, 'P' + L.P + 'H', 1], [pv.l, 'P' + L.P + 'L', 1], [pv.c, 'P' + L.P + 'C', 2]].forEach(z => { const y = Y(z[0]); if(y < g.mT - 4 || y > g.mB + 4) return;
        c.strokeStyle = L.c; c.lineWidth = z[2] === 0 ? 1.6 : 1; c.setLineDash(z[2] === 0 ? [] : z[2] === 1 ? [6, 4] : [2, 3]); c.beginPath(); c.moveTo(x0, y); c.lineTo(g.pw, y); c.stroke(); c.setLineDash([]);
        c.fillStyle = L.c; c.fillText(z[1] + ' ' + a.fx(z[0]), g.pw - 4, y - 2); }); c.restore(); c.lineWidth = 1; }});
});


/* 15. Eclipse cycles: vertical lines named Lunar 1-4 (red) and Solar 1-4 (green), same data as the Eclipse screen */
const ECL = (() => { const DAYMS = 864e5;
const LD = '2011-06-15T,2011-12-10T,2012-06-04P,2012-11-28N,2013-04-25P,2013-05-25N,2013-10-18N,2014-04-15T,2014-10-08T,2015-04-04T,2015-09-28T,2016-03-23N,2016-09-16N,2017-02-11N,2017-08-07P,2018-01-31T,2018-07-27T,2019-01-21T,2019-07-16P,2020-01-10N,2020-06-05N,2020-07-05N,2020-11-30N,2021-05-26T,2021-11-19P,2022-05-16T,2022-11-08T,2023-05-05N,2023-10-28P,2024-03-25N,2024-09-18P,2025-03-14T,2025-09-07T,2026-03-03T,2026-08-28P,2027-02-20N,2027-07-18N,2027-08-17N,2028-01-12P,2028-07-06P,2028-12-31T,2029-06-26T,2029-12-20T,2030-06-15P,2030-12-09N,2031-05-07N,2031-06-05N,2031-10-30N,2032-04-25T,2032-10-18T,2033-04-14T,2033-10-08T,2034-04-03N,2034-09-28P,2035-02-22N,2035-08-19P,2036-02-11T,2036-08-07T,2037-01-31T,2037-07-27P,2038-01-21N,2038-06-17N,2038-07-16N,2038-12-11N,2039-06-06P,2039-11-30P,2040-05-26T,2040-11-18T'.split(',');
const SD = '2011-01-04P,2011-06-01P,2011-07-01P,2011-11-25P,2012-05-20A,2012-11-13T,2013-05-10A,2013-11-03H,2014-04-29A,2014-10-23P,2015-03-20T,2015-09-13P,2016-03-09T,2016-09-01A,2017-02-26A,2017-08-21T,2018-02-15P,2018-07-13P,2018-08-11P,2019-01-06P,2019-07-02T,2019-12-26A,2020-06-21A,2020-12-14T,2021-06-10A,2021-12-04T,2022-04-30P,2022-10-25P,2023-04-20H,2023-10-14A,2024-04-08T,2024-10-02A,2025-03-29P,2025-09-21P,2026-02-17A,2026-08-12T,2027-02-06A,2027-08-02T,2028-01-26A,2028-07-22T,2029-01-14P,2029-06-12P,2029-07-11P,2029-12-05P,2030-06-01A,2030-11-25T,2031-05-21A,2031-11-14H,2032-05-09A,2032-11-03P,2033-03-30T,2033-09-23P,2034-03-20T,2034-09-12A,2035-03-09A,2035-09-02T,2036-02-27P,2036-07-23P,2036-08-21P,2037-01-16P,2037-07-13T,2038-01-05A,2038-07-02A,2038-12-26T,2039-06-21A,2039-12-15T,2040-05-11P,2040-11-04P'.split(',');
const PA = a => a.map(s => ({t: Date.parse(s.slice(0, 10) + 'T12:00:00Z'), k: s[10]}));
// Rule: 4 lunar eclipses (penumbral ones skipped) from a total one; the 4th starts the solar cycle, which runs through the next 3 total / annular / hybrid solar eclipses; the next total lunar eclipse starts a new cycle.
function cycles(){
  const L = PA(LD), S = PA(SD), cy = []; let i = L.findIndex(e => e.k === 'T' && e.t >= Date.UTC(2014, 0, 1));
  while(i >= 0){
    const lun = [L[i]]; for(let j = i + 1; j < L.length && lun.length < 4; j++) if(L[j].k !== 'N') lun.push(L[j]);
    const sol = []; if(lun.length === 4) for(const s of S) if(s.t > lun[3].t && s.k !== 'P' && sol.length < 3) sol.push(s);
    const nx = sol.length === 3 ? L.findIndex(e => e.k === 'T' && e.t > sol[2].t) : -1;
    cy.push({lun, sol, end: nx >= 0 ? L[nx].t : null}); i = nx;
  }
  return cy;
}
const CY = cycles().filter(c => c.lun.length === 4 && c.sol.length === 3), EV = [{t: PA(['2013-05-10A'])[0].t, k: 'A', lab: 'Solar 3', c: 'g'}, {t: PA(['2013-11-03H'])[0].t, k: 'H', lab: 'Solar 4', c: 'g'}];
  CY.forEach(c => { c.lun.forEach((e, n) => EV.push({t: e.t, k: e.k, lab: 'Lunar ' + (n + 1) + (n === 3 ? ' · Solar 1' : ''), c: n === 3 ? 'g' : 'r'})); c.sol.forEach((e, n) => EV.push({t: e.t, k: e.k, lab: 'Solar ' + (n + 2), c: 'g'})); });
  return EV.sort((a, b) => a.t - b.t); })();
const ECN = {T: 'Total', P: 'Partial', N: 'Penumbral', A: 'Annular', H: 'Hybrid'};
push({id: 'eclipse', name: 'Eclipse cycles: vertical lines (TTM)', pane: 'overlay', calc: () => null,
  over: a => { const {c, g, X, d, i0, i1} = a; if(d.length < 2) return; const step = d[1].t - d[0].t, ix = t => (t - d[0].t) / step; c.save(); c.beginPath(); c.rect(0, g.mT, g.pw, g.mB - g.mT); c.clip(); c.font = '700 10px system-ui,sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
    ECL.forEach(e => { const i = ix(e.t); if(i < i0 - 2 || i > i1 + 2) return; const x = X(i), col = e.c === 'r' ? '#ff6b61' : '#5fd69a'; c.strokeStyle = col; c.lineWidth = 1.3; c.setLineDash([5, 4]); c.beginPath(); c.moveTo(x, g.mT); c.lineTo(x, g.mB); c.stroke(); c.setLineDash([]);
      const t = e.lab + ' · ' + ECN[e.k] + ' · ' + new Date(e.t).toLocaleDateString('en-AU', {day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC'}); c.save(); c.translate(x + 3, g.mT + 6); c.rotate(Math.PI / 2); c.fillStyle = col; c.fillText(t, 0, -12); c.restore(); }); c.restore(); c.lineWidth = 1; },
  panel: a => { const now = Date.now(), n = ECL.find(e => e.t > now); if(!n) return null; const days = Math.ceil((n.t - now) / 864e5); return {pos: 'bl', title: 'Next eclipse', rows: [[[n.lab + ' · ' + ECN[n.k], n.c === 'r' ? '#ff6b61' : '#5fd69a']], [['In ' + days + ' days (' + new Date(n.t).toLocaleDateString('en-AU', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'}) + ')', '#e8e8ea']]]}; }});


/* 16. Fomo Finder (CRYPTOZ): emotion score -3..+3 from RSI, price move over 5 bars and volume spikes */
const bandPaint = (a, bands, lbl) => { const {c, g, yy, top, bot} = a; bands.forEach(b => { c.fillStyle = b[2]; c.fillRect(0, yy(b[1]), g.pw, yy(b[0]) - yy(b[1])); }); if(lbl){ c.font = '700 9px system-ui,sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle'; lbl.forEach(l => { c.fillStyle = l[2]; c.fillText(l[1], g.pw - 6, yy(l[0])); }); c.font = '11px system-ui,sans-serif'; c.textAlign = 'left'; } };
push({id: 'fomo', name: 'Fomo Finder (TTM)', pane: 'sub', range: [-3.4, 3.4], lines: [-3, -2, -1, 0, 1, 2, 3],
  calc: r => { const cl = closes(r), rsi = rsiA(cl, 14), av = smaA(r.map(x => x.v), 20); return r.map((x, i) => { if(i < 20 || rsi[i] == null || av[i] == null) return null; const pc = (x.c - r[i - 5].c) / r[i - 5].c * 100; let sc = (rsi[i] > 70 ? 1 : 0) + (pc > 5 ? 1 : 0) + (x.v > av[i] * 1.5 ? 1 : 0) + (rsi[i] < 30 ? -1 : 0) + (pc < -5 ? -1 : 0) + (x.v < av[i] / 1.5 ? -1 : 0); return Math.max(-3, Math.min(3, sc)); }); },
  subPaint: a => { const {c, X, yy, i0, i1, res} = a; bandPaint(a, [[2, 3.4, 'rgba(232,39,39,.30)'], [1, 2, 'rgba(255,124,1,.24)'], [0, 1, 'rgba(255,235,59,.18)'], [-1, 0, 'rgba(120,123,134,.12)'], [-2, -1, 'rgba(0,137,123,.22)'], [-3.4, -2, 'rgba(33,149,243,.26)']], [[3, 'FOMO 3', '#ff6b61'], [2, 'Greed 2', '#ff9a4a'], [1, 'Canary Call 1', '#ffeb3b'], [0, 'Balanced 0', '#9aa0a6'], [-1, 'Uncertain -1', '#26a69a'], [-2, 'Panic -2', '#4aa3ff'], [-3, 'Capitulation -3', '#b45bd0']]);
    c.strokeStyle = '#e0dfdf'; c.lineWidth = 2; c.beginPath(); let on = false; for(let i = i0; i <= i1; i++){ const v = res[i]; if(v == null){ on = false; continue; } if(on) c.lineTo(X(i), yy(v)); else { c.moveTo(X(i), yy(v)); on = true; } } c.stroke(); c.lineWidth = 1; }});
/* 17. Smart Money Oscillator: volume spike on a down candle at a 5-bar low = smart buy (90); spike on an up candle at a 5-bar high = smart sell (10); decays to 50 */
push({id: 'smo', name: 'Smart Money Oscillator (TTM)', pane: 'sub', range: [0, 100], lines: [10, 50, 90],
  calc: r => { const av = smaA(r.map(x => x.v), 20); let osc = 50; return r.map((x, i) => { if(av[i] == null) return null; const spike = x.v > 1.5 * av[i]; let lo = Infinity, hi = -Infinity; for(let k = Math.max(0, i - 4); k <= i; k++){ lo = Math.min(lo, r[k].c); hi = Math.max(hi, r[k].c); } const buy = spike && x.c < x.o && x.c === lo, sell = spike && x.c > x.o && x.c === hi; osc = buy ? 90 : sell ? 10 : osc * .95 + 50 * .05; return osc; }); },
  alerts: [{k: 'smb', name: 'Smart money buy (volume spike on a 5-bar low)'}, {k: 'sms', name: 'Smart money sell (volume spike on a 5-bar high)'}], alertHits: (r, o) => { const out = [], i = o.length - 2; if(i > 0 && o[i] != null){ if(o[i] === 90) out.push({i, k: 'smb'}); if(o[i] === 10) out.push({i, k: 'sms'}); } return out; },
  subPaint: a => { const {c, X, yy, i0, i1, res, g} = a; bandPaint(a, [[70, 100, 'rgba(46,204,113,.08)'], [0, 30, 'rgba(224,85,77,.08)']]); c.setLineDash([5, 4]); [[90, '#2ecc71'], [10, '#e0554d'], [50, '#6b6f7a']].forEach(z => { c.strokeStyle = z[1]; c.beginPath(); c.moveTo(0, yy(z[0])); c.lineTo(g.pw, yy(z[0])); c.stroke(); }); c.setLineDash([]);
    c.lineWidth = 2; for(let i = Math.max(1, i0); i <= i1; i++){ const v = res[i], u = res[i - 1]; if(v == null || u == null) continue; c.strokeStyle = v > 70 ? '#00e676' : v < 30 ? '#ff3b30' : '#9aa0a6'; c.beginPath(); c.moveTo(X(i - 1), yy(u)); c.lineTo(X(i), yy(v)); c.stroke(); } c.lineWidth = 1; }});
/* 18. Fear & Greed: your Pine version needs US market data (S&P breadth, VIX futures, put/call, SKEW) which exchanges do not give, so this plots the daily CRYPTO Fear & Greed index (alternative.me) in the same 0-100 zones */
const FGI = {m: null, busy: false, v: 0};
push({id: 'fgi', name: 'Fear & Greed, crypto (TTM)', pane: 'sub', range: [0, 100], lines: [20, 40, 60, 80],
  ver: () => FGI.v,
  calc: r => { if(!FGI.m && !FGI.busy){ FGI.busy = true; fetch('https://api.alternative.me/fng/?limit=0&format=json').then(x => x.json()).then(j => { FGI.m = {}; (j.data || []).forEach(z => { FGI.m[Math.floor(+z.timestamp * 1000 / DAY)] = +z.value; }); FGI.v++; FGI.busy = false; if(window.ttmChartsRepaint) window.ttmChartsRepaint(); }).catch(() => { FGI.busy = false; FGI.m = {}; FGI.v++; }); } return r.map(x => FGI.m ? (FGI.m[Math.floor(x.t / DAY)] != null ? FGI.m[Math.floor(x.t / DAY)] : null) : null); },
  subPaint: a => { const {c, X, yy, i0, i1, res} = a; bandPaint(a, [[0, 20, 'rgba(224,104,104,.28)'], [20, 40, 'rgba(255,153,0,.22)'], [40, 60, 'rgba(255,235,59,.16)'], [60, 80, 'rgba(0,230,188,.18)'], [80, 100, 'rgba(80,149,69,.28)']], [[90, 'Extreme Greed', '#6fd36a'], [70, 'Greed', '#00e6bc'], [50, 'Neutral', '#e0dc0a'], [30, 'Fear', '#ff9900'], [10, 'Extreme Fear', '#e06868']]);
    c.strokeStyle = '#ecebeb'; c.lineWidth = 2; c.beginPath(); let on = false; for(let i = i0; i <= i1; i++){ const v = res[i]; if(v == null){ on = false; continue; } if(on) c.lineTo(X(i), yy(v)); else { c.moveTo(X(i), yy(v)); on = true; } } c.stroke(); c.lineWidth = 1; }});

/* 13. TTM RSI combo (sub pane): smoothed RSI + volume-weighted RSI, exhaustion, divergences, warning dots, reversals */
const piv = (a, n, hi) => a.map((v, i) => { const c = i - n; if(c < n || v == null || a[c] == null) return null; for(let k = c - n; k <= c + n; k++){ if(k === c || a[k] == null) { if(a[k] == null && k !== c) return null; continue; } if(hi ? a[k] > a[c] : a[k] < a[c]) return null; } return {c, v: a[c]}; });
push({id: 'rsic', name: 'Trade with Confluence (TTM)', pane: 'sub', range: [0, 100], lines: [30, 50, 70], calc: r => {
  const n = r.length, osc = emaA(rsiA(closes(r), 14), 5), ov = emaA(rsiA(r.map(x => x.v * x.c), 14), 5);
  const slope = osc.map((v, i) => v != null && i && osc[i - 1] != null ? v - osc[i - 1] : null);
  // PVSRA volume columns
  const hl = r.map(x => x.v * (x.h - x.l)), pc = [], vs = [];
  for(let i = 0; i < n; i++){ let av = 0, mh = 0, k = 0; for(let j = Math.max(0, i - 10); j < i; j++){ av += r[j].v; mh = Math.max(mh, hl[j]); k++; } av = k ? av / k : 0;
    const va = r[i].v >= av * 2 || (k && hl[i] >= mh) ? 200 : r[i].v >= av * 1.5 ? 150 : 100, bu = r[i].c > r[i].o;
    pc[i] = va === 200 ? (bu ? '#00ff00' : '#ff0000') : va === 150 ? (bu ? '#3d7bff' : '#ff00ff') : (bu ? '#e8e8e8' : '#777777');
    let mx = 0; for(let j = Math.max(0, i - 299); j <= i; j++) mx = Math.max(mx, r[j].v); vs[i] = mx > 0 ? r[i].v / mx : 0; }
  // volume pressure (0-100)
  const bf = r.map(x => x.h > x.l ? (x.c - x.l) / (x.h - x.l) : .5), bs = emaA(r.map((x, i) => x.v * bf[i]), 14), es = emaA(r.map((x, i) => x.v * (1 - bf[i])), 14), vp = bs.map((b, i) => b != null && es[i] != null && b + es[i] > 0 ? b / (b + es[i]) * 100 : 50);
  // divergences (price vs src)
  const divFn = (src, kb, ks) => { const lo = piv(src, 5, false), hi = piv(src, 5, true), out = [], evs = []; let pL = null, pH = null;
    for(let i = 0; i < n; i++){ if(lo[i]){ const c = lo[i].c, pr = r[c] ? r[c].l : null; if(pL && pr != null){ const d = c - pL.c; if(d >= 5 && d <= 60 && pr < pL.pr && lo[i].v > pL.v){ out.push({k: 'bull', a: pL.c, b: c, ya: pL.v, yb: lo[i].v, s: kb}); evs.push({i, k: kb}); } } if(pr != null) pL = {v: lo[i].v, c, pr}; }
      if(hi[i]){ const c = hi[i].c, pr = r[c] ? r[c].h : null; if(pH && pr != null){ const d = c - pH.c; if(d >= 5 && d <= 60 && pr > pH.pr && hi[i].v < pH.v){ out.push({k: 'bear', a: pH.c, b: c, ya: pH.v, yb: hi[i].v, s: ks}); evs.push({i, k: ks}); } } if(pr != null) pH = {v: hi[i].v, c, pr}; } }
    return {out, evs}; };
  const rd = divFn(osc, 'dB', 'dS'), vd2 = divFn(vp, 'vB', 'vS'), bullD = {}, bearD = {}; rd.evs.forEach(e => { (e.k === 'dB' ? bullD : bearD)[e.i] = 1; });
  const oh3 = piv(osc, 3, true), ol3 = piv(osc, 3, false), ev = [];
  for(let i = 1; i < n; i++){ const o = osc[i], s = slope[i], sp = slope[i - 1]; if(o == null || s == null) continue;
    if(o > 15 && o < 30 && s < 0) ev.push({i, k: 'exB'}); if(o < 85 && o > 70 && s > 0) ev.push({i, k: 'exS'});
    if(s > 0 && sp != null && s < sp && o > 70 && o < 85 && (bearD[i] || oh3[i])) ev.push({i, k: 'wS'}); if(s < 0 && sp != null && s > sp && o < 30 && o > 15 && (bullD[i] || ol3[i])) ev.push({i, k: 'wB'});
    if(o < 40 && s > 0 && sp != null && sp <= 0) ev.push({i, k: 'rB'}); if(o > 60 && s < 0 && sp != null && sp >= 0) ev.push({i, k: 'rS'});
    const pv = osc[i - 1]; if(pv != null){ if(pv < 70 && o >= 70) ev.push({i, k: 'ob'}); if(pv > 30 && o <= 30) ev.push({i, k: 'os'}); } }
  return {osc, ov, slope, pc, vs, vp, divs: rd.out, vdivs: vd2.out, ev: ev.concat(rd.evs, vd2.evs)}; },
  alerts: [{k: 'rB', name: 'Bullish momentum reversal'}, {k: 'rS', name: 'Bearish momentum reversal'}, {k: 'dB', name: 'Bullish divergence'}, {k: 'dS', name: 'Bearish divergence'}, {k: 'vB', name: 'Bullish volume divergence'}, {k: 'vS', name: 'Bearish volume divergence'}, {k: 'exB', name: 'Oversold exhaustion'}, {k: 'exS', name: 'Overbought exhaustion'}, {k: 'ob', name: 'Overbought (RSI crossed 70)'}, {k: 'os', name: 'Oversold (RSI crossed 30)'}, {k: 'wB', name: 'Bullish exhaustion warning'}, {k: 'wS', name: 'Bearish exhaustion warning'}], alertHits: (r, R) => R.ev,
  subPaint: a => { const R = a.res, {c, g, X, yy, top, bot, i0, i1} = a; if(!R) return;
    for(let i = i0; i <= i1; i++){ const o = R.osc[i]; if(o == null) continue; if(o >= 70 || o <= 30){ c.fillStyle = o >= 70 ? 'rgba(255,60,60,.14)' : 'rgba(60,200,90,.14)'; c.fillRect(X(i) - g.w / 2, top, g.w + .5, bot - top); } }
    const ln = (s, col, w) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); let on = false; for(let i = i0; i <= i1; i++){ const v = s[i]; if(v == null){ on = false; continue; } if(on) c.lineTo(X(i), yy(v)); else { c.moveTo(X(i), yy(v)); on = true; } } c.stroke(); c.lineWidth = 1; };
    ln(R.vp, 'rgba(0,229,255,.8)', 1);
    const glow = (s, w) => { for(let i = Math.max(1, i0); i <= i1; i++){ const v = s[i], u = s[i - 1], sl = R.slope[i]; if(v == null || u == null) continue; const col = sl == null ? '#8b8f9a' : sl > 0 ? '#2ecc71' : sl < 0 ? '#4f8cff' : '#8b8f9a'; [[w + 3, .22], [w + 1.5, .3], [w, 1]].forEach(z => { c.globalAlpha = z[1]; c.strokeStyle = col; c.lineWidth = z[0]; c.beginPath(); c.moveTo(X(i - 1), yy(u)); c.lineTo(X(i), yy(v)); c.stroke(); }); } c.globalAlpha = 1; c.lineWidth = 1; };
    glow(R.ov, 1.2); glow(R.osc, 2);
    const dv = (arr, cb, cs, t1, t2) => arr.forEach(d => { if(d.b < i0 - 50 || d.a > i1) return; const col = d.k === 'bull' ? cb : cs; c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.moveTo(X(d.a), yy(d.ya)); c.lineTo(X(d.b), yy(d.yb)); c.stroke(); c.lineWidth = 1; if(d.b >= i0 && d.b <= i1) tagL(c, X(d.b), yy(d.yb), d.k === 'bull' ? t1 : t2, col, d.k === 'bull' ? '#000' : '#fff', d.k !== 'bull'); });
    dv(R.divs, '#93ff7d', '#ff3b30', 'Bull', 'Bear'); dv(R.vdivs, '#00E5FF', '#FF9100', 'Vol Bull', 'Vol Bear');
    R.ev.forEach(e => { if(e.i < i0 || e.i > i1) return; const x = X(e.i), o = R.osc[e.i];
      if(e.k === 'exB') tagL(c, x, bot - 14, '▲', '#1e6120', '#fff', false); else if(e.k === 'exS') tagL(c, x, top + 14, '▼', '#7d1e1e', '#fff', true);
      else if(e.k === 'wS' || e.k === 'wB'){ c.fillStyle = e.k === 'wS' ? '#9023f5' : '#f9c431'; c.beginPath(); c.moveTo(x, yy(o) - 4); c.lineTo(x + 4, yy(o)); c.lineTo(x, yy(o) + 4); c.lineTo(x - 4, yy(o)); c.fill(); }
      else if(e.k === 'rB' || e.k === 'rS'){ c.fillStyle = e.k === 'rB' ? '#45b02d' : '#d60f0f'; c.beginPath(); c.arc(x, yy(o), 3.5, 0, 6.3); c.fill(); } });
    c.font = '10px system-ui'; c.fillStyle = 'rgba(212,175,55,.8)'; c.textAlign = 'right'; c.fillText('Indicators by TTM', g.pw - 6, bot - 8); c.textAlign = 'left'; }});
})();
