/* TTM TradFi extras (Pro): Earnings, Liquidity, Crypto vs TradFi, Commodities. Each reads a JSON written by a GitHub Actions job. */
(function(){
const $ = id => document.getElementById(id), esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const cls = v => v == null ? 'tf-flat' : v > 0 ? 'tf-up' : v < 0 ? 'tf-down' : 'tf-flat', pc = (v, d) => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d == null ? 2 : d) + '%';
const cap = v => v == null ? '—' : v >= 1e12 ? '$' + (v / 1e12).toFixed(2) + 'T' : v >= 1e9 ? '$' + (v / 1e9).toFixed(0) + 'B' : '$' + (v / 1e6).toFixed(0) + 'M';
const age = iso => { const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1.5 ? 'just now' : h < 36 ? Math.round(h) + ' hours ago' : Math.round(h / 24) + ' days ago'; };
const loaders = {};
async function J(f){ const r = await fetch('../' + f + '?t=' + Math.floor(Date.now() / 600000)); if(!r.ok) throw new Error('no data'); return r.json(); }
const dayName = d => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'});
const WHEN = {bmo: 'before open', amc: 'after close', na: 'time n/a'};
/* simple SVG line chart: series = [{name, color, d: [[x(ms), y]], w}], opts = {zero, fmt, h} */
function lineChart(series, o){ o = o || {}; const W = 900, H = o.h || 300, L = 52, R = 14, T = 12, B = 26, all = series.flatMap(s => s.d); if(!all.length) return '<div class="tf-empty">No data yet.</div>';
  const x0 = Math.min.apply(null, all.map(p => p[0])), x1 = Math.max.apply(null, all.map(p => p[0])); let lo = Math.min.apply(null, all.map(p => p[1])), hi = Math.max.apply(null, all.map(p => p[1])); if(o.zero){ lo = Math.min(lo, 0); hi = Math.max(hi, 0); } if(hi === lo){ hi += 1; lo -= 1; } const pad = (hi - lo) * .06; lo -= pad; hi += pad;
  const X = t => L + (t - x0) / ((x1 - x0) || 1) * (W - L - R), Y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo)), fm = o.fmt || (v => Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
  let g = ''; for(let k = 0; k <= 4; k++){ const v = lo + (hi - lo) * k / 4; g += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#23232a"/><text x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" fill="#8b8f9a" font-size="10" text-anchor="end">${esc(fm(v))}</text>`; }
  const ys = new Date(x0).getUTCFullYear(), ye = new Date(x1).getUTCFullYear(), step = Math.max(1, Math.ceil((ye - ys + 1) / 8)); for(let y = ys; y <= ye + 1; y += step){ const t = Date.UTC(y, 0, 1); if(t < x0 || t > x1) continue; g += `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="#1d1d22"/><text x="${X(t).toFixed(1)}" y="${H - 8}" fill="#8b8f9a" font-size="10" text-anchor="middle">${y}</text>`; }
  if(o.zero && lo < 0 && hi > 0) g += `<line x1="${L}" x2="${W - R}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="#6b7280" stroke-dasharray="3 3"/>`;
  series.forEach(s => { if(s.d.length) g += `<polyline fill="none" stroke="${s.color}" stroke-width="${s.w || 1.8}" stroke-linejoin="round" points="${s.d.map(p => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ')}"/>`; });
  const key = series.length > 1 || o.key ? `<div style="display:flex;flex-wrap:wrap;gap:12px;margin:8px 0 0;font-size:12px">${series.map(s => `<span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${s.color};margin-right:5px"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${g}</svg>${key}`; }
window.TFX = {$, esc, cls, pc, cap, age, J, dayName, lineChart, loaders};

/* ---------- Earnings ---------- */
loaders.earnings = async function(){ const box = $('erBody'); let D; try{ D = await J('tradfi_earnings.json'); }catch(e){ box.innerHTML = '<div class="tf-card tf-empty">Earnings data is not available yet. It is built by the "Update earnings" job.</div>'; return; }
  const today = D.today, past = D.days.filter(x => x.date < today), fut = D.days.filter(x => x.date >= today);
  const rep = past.flatMap(x => x.rows.map(r => Object.assign({date: x.date}, r))), withB = rep.filter(r => r.beat != null), beats = withB.filter(r => r.beat > 0).length, mv = rep.filter(r => r.move != null);
  const avg = mv.length ? mv.reduce((a, r) => a + r.move, 0) / mv.length : null, up = mv.filter(r => r.move > 0).length;
  const best = mv.slice().sort((a, b) => b.move - a.move)[0], worst = mv.slice().sort((a, b) => a.move - b.move)[0];
  $('erUpd').textContent = 'Updated ' + age(D.generated_at) + '. Biggest companies by market value each day. Calendar from Nasdaq, share-price moves from Yahoo Finance.';
  const stat = (t, v, s, c) => `<div class="tf-card"><div style="font-size:11px;color:var(--mute);text-transform:uppercase;letter-spacing:1px">${t}</div><div class="${c || ''}" style="font-size:24px;font-weight:700;margin-top:4px">${v}</div><div style="font-size:12px;color:var(--mute);margin-top:2px">${s}</div></div>`;
  let h = `<div class="tf-grid4" style="margin-bottom:6px">${stat('Reported (last 7 days)', rep.length, 'large companies', '')}${stat('Beat estimates', withB.length ? Math.round(beats / withB.length * 100) + '%' : '—', withB.length ? beats + ' of ' + withB.length + ' with a result' : 'results not listed yet', '')}${stat('Average share move', pc(avg), up + ' up, ' + (mv.length - up) + ' down', cls(avg))}${stat('Biggest moves', best ? esc(best.s) + ' ' + pc(best.move, 1) : '—', worst ? 'weakest: ' + esc(worst.s) + ' ' + pc(worst.move, 1) : '', best ? cls(best.move) : '')}</div>`;
  h += '<div class="tf-sub">Just reported</div>';
  const tab = rep.slice().sort((a, b) => b.date.localeCompare(a.date) || b.cap - a.cap).slice(0, 60);
  h += tab.length ? `<div class="tf-card tf-scroll"><table class="tf-table"><thead><tr><th>Date</th><th>Company</th><th>Value</th><th>When</th><th>EPS vs estimate</th><th>Share move</th></tr></thead><tbody>${tab.map(r => `<tr><td>${esc(dayName(r.date))}</td><td><b>${esc(r.s)}</b> <small style="color:var(--mute)">${esc(r.n)}</small></td><td>${cap(r.cap)}</td><td>${WHEN[r.t]}</td><td>${r.eps != null ? `${r.eps.toFixed(2)} vs ${r.epsF != null ? r.epsF.toFixed(2) : '—'} <span class="${r.beat > 0 ? 'tf-up' : r.beat < 0 ? 'tf-down' : 'tf-flat'}">${r.beat > 0 ? 'beat' : r.beat < 0 ? 'miss' : 'in line'}</span>` : '<span style="color:var(--mute)">—</span>'}</td><td class="${cls(r.move)}">${pc(r.move)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="tf-card tf-empty">Nothing in the last 7 days yet.</div>';
  h += '<div class="tf-sub">Coming up</div>' + (fut.some(x => x.rows.length) ? fut.filter(x => x.rows.length).map(x => `<div class="tf-card" style="margin-bottom:10px"><b style="color:var(--gold2)">${esc(dayName(x.date))}</b>${x.date === today ? ' <span class="tf-pill blue">today</span>' : ''}<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${x.rows.slice(0, 18).map(r => `<span class="tf-pill" title="${esc(r.n)} · ${cap(r.cap)} · ${WHEN[r.t]}${r.epsF != null ? ' · est EPS ' + r.epsF.toFixed(2) : ''}">${esc(r.s)} <small style="opacity:.7">${r.t === 'bmo' ? 'AM' : r.t === 'amc' ? 'PM' : ''}</small></span>`).join('')}</div></div>`).join('') : '<div class="tf-card tf-empty">No upcoming reports listed.</div>');
  box.innerHTML = h; };

/* ---------- Liquidity ---------- */
loaders.liquidity = async function(){ const box = $('lqBody'); let D; try{ D = await J('tradfi_liquidity.json'); }catch(e){ box.innerHTML = '<div class="tf-card tf-empty">Liquidity data is not available yet. It is built by the "Update liquidity" job.</div>'; return; }
  const n = D.now, rows = D.rows, WIN = {'1y': 52, '2y': 104, '5y': 260, 'All': 9999}; let win = '2y';
  $('lqUpd').textContent = 'Fed data for the week of ' + dayName(n.date) + ' · refreshed ' + age(D.generated_at) + '. Source: FRED (Federal Reserve), Yahoo Finance.';
  const stat = (t, v, sub, c) => `<div class="tf-card"><div style="font-size:11px;color:var(--mute);text-transform:uppercase;letter-spacing:1px">${t}</div><div class="${c || ''}" style="font-size:24px;font-weight:700;margin-top:4px">${v}</div><div style="font-size:12px;color:var(--mute);margin-top:2px">${sub}</div></div>`;
  const m2 = D.m2_yoy && D.m2_yoy.length ? D.m2_yoy[D.m2_yoy.length - 1] : null;
  const rg = n.regime === 'expanding' ? ['Expanding', 'tf-up'] : n.regime === 'shrinking' ? ['Shrinking', 'tf-down'] : ['Flat', 'tf-flat'];
  const head = `<div class="tf-grid4">${stat('US net liquidity', '$' + (n.net / 1000).toFixed(2) + 'T', 'Fed assets − Treasury cash − reverse repo')}${stat('Last 4 weeks', pc(n.net_4w), 'trend is ' + rg[0].toLowerCase(), rg[1])}${stat('Last 13 weeks', pc(n.net_13w), 'one quarter', cls(n.net_13w))}${stat('M2 money supply', m2 ? pc(m2[1]) : '—', m2 ? 'year on year, ' + m2[0].slice(0, 7) : '', m2 ? cls(m2[1]) : '')}</div>`;
  const sw = a => a.map(x => `<button class="filter-chip ${x === win ? 'active' : ''}" data-w="${x}">${x}</button>`).join('');
  box.innerHTML = head + `<div class="filter-row" style="margin-top:16px" id="lqWin">${sw(Object.keys(WIN))}</div><div class="tf-sub" style="margin-top:14px">Net liquidity vs Bitcoin and the S&amp;P 500 <small style="text-transform:none;letter-spacing:0;color:var(--mute)">(all rebased to 100 at the start)</small></div><div class="tf-card" id="lqC1"></div><div class="tf-grid2" style="margin-top:14px"><div class="tf-card"><b>What drains it: Treasury cash and reverse repo ($B)</b><div id="lqC2" style="margin-top:8px"></div></div><div class="tf-card"><b>Fed assets vs global central banks ($T)</b><div id="lqC3" style="margin-top:8px"></div></div></div><p class="calendar-note" style="margin-top:12px">Net liquidity is a popular way to track how much dollar liquidity is sloshing through markets: when the Fed's balance sheet grows, or the Treasury and reverse-repo pools shrink, more cash is left in the system. Risk assets such as Bitcoin have tended to follow liquidity, but loosely and with lags of weeks to months, and other forces (rates, earnings, flows) often dominate. Global assets add the ECB and Bank of Japan balance sheets, converted to US dollars. Education only, not a forecast and not financial advice.</p>`;
  const t = r => Date.parse(r.d);
  const draw = () => { const R = rows.slice(-WIN[win]), reb = k => { const f = R.find(r => r[k] != null); return f ? R.filter(r => r[k] != null).map(r => [t(r), r[k] / f[k] * 100]) : []; };
    $('lqC1').innerHTML = lineChart([{name: 'US net liquidity', color: '#4f8cff', d: reb('net'), w: 2.4}, {name: 'Bitcoin', color: '#f7931a', d: reb('btc')}, {name: 'S&P 500', color: '#3fb97a', d: reb('spx')}], {h: 340});
    $('lqC2').innerHTML = lineChart([{name: 'Treasury General Account', color: '#e0554d', d: R.map(r => [t(r), r.tga])}, {name: 'Reverse repo', color: '#b18cff', d: R.map(r => [t(r), r.rrp])}], {h: 220});
    $('lqC3').innerHTML = lineChart([{name: 'Fed + ECB + BoJ', color: '#ffb020', d: R.filter(r => r.glob != null).map(r => [t(r), r.glob])}, {name: 'Fed only', color: '#4f8cff', d: R.map(r => [t(r), r.fed / 1000])}], {h: 220, fmt: v => v.toFixed(1)}); };
  $('lqWin').onclick = e => { const b = e.target.closest('[data-w]'); if(!b) return; win = b.dataset.w; document.querySelectorAll('#lqWin .filter-chip').forEach(x => x.classList.toggle('active', x === b)); draw(); };
  draw(); };
/* open a section's loader when its page is shown */
Object.keys(loaders).forEach(k => {});
const SEC = {earnings: 'earnings', liquidity: 'liquidity'}; window.TFX.SEC = SEC;
const run = () => { const id = (location.hash || '').slice(1), o = new URLSearchParams(location.search).get('only'), k = o || id; if(SEC[k] && loaders[SEC[k]] && !loaders[SEC[k]].done){ loaders[SEC[k]].done = 1; loaders[SEC[k]](); } };
window.TFX.run = run; window.addEventListener('hashchange', run); setTimeout(run, 50);
})();
