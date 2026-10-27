/* TTM accounts: optional sign-in (Supabase), plans, per-section access, cloud sync, admin. Shared by the landing page, crypto and TradFi terminals. */
(function(){
const $ = id => document.getElementById(id);
const TERM = (document.body && document.body.dataset.terminal) || 'home';
const BASE = (document.currentScript && document.currentScript.src) ? new URL('.', document.currentScript.src).href : './';
const AK = 'ttm_auth_v1', SYNCK = 'ttm_sync_meta_v1', DATAKEYS = ['ttm_rr_saved_v1', 'ttm_rr_bals_v1'];
const PLANS = [['free', 'Free'], ['crypto', 'Crypto'], ['tradfi', 'TradFi'], ['pro', 'Pro']];
const pname = id => (PLANS.find(p => p[0] === id) || [0, id])[1];
// what can be locked: key, label, plans that get it by default (Pro always gets everything)
const CAT = [
  ['c:calendar', 'Crypto · Macro Watch', ['free']], ['c:tradinghours', 'Crypto · Trading Hours', ['free']], ['c:fomo', 'Crypto · FOMO Finder & RSI Chart', ['free']],
  ['c:btcmonthly', 'Crypto · BTC Monthly (with cycle tops)', ['free']], ['c:tokenevents', 'Crypto · Token Events', []], ['c:library', 'Crypto · Reports library', []], ['c:transparency', 'Crypto · Transparency Watch', ['free']],
  ['c:marketpulse', 'Crypto · Market Pulse (liquidations, funding, open interest)', ['crypto']], ['c:rsimap', 'Crypto · RSI Heatmap', ['crypto']], ['c:volume', 'Crypto · Volume Heatmap', ['crypto']], ['c:socialpulse', 'Crypto · Social Pulse', ['crypto']],
  ['c:riskreward', 'Crypto · Risk / Reward calculator', ['crypto']], ['c:tradejournal', 'Crypto · Trade Tracker & win ratio', []], ['c:portfolio', 'Crypto · Portfolio Forecast', []],
  ['t:calendar', 'TradFi · Macro Watch', ['free']], ['t:tradinghours', 'TradFi · Trading Hours', ['free']], ['t:congress', 'TradFi · Congress Watch', []],
  ['t:globalmarkets', 'TradFi · Global Markets', ['tradfi']], ['t:bonds', 'TradFi · Bonds & Rates', ['tradfi']], ['t:macrointel', 'TradFi · Macro Intel', ['tradfi']], ['t:newsrisk', 'TradFi · News & Risk', ['tradfi']], ['t:tfcalc', 'TradFi · Risk / Reward calculator', ['tradfi']],
  ['indicators', 'TTM indicators on TradingView', []], ['sync', 'Cloud sync of trades', []], ['excel', 'Excel export', []], ['alerts', 'Telegram trade alerts', []]
];
// Free means "everyone who is signed in or not"; paid lists add the plan (Crypto items are also in Pro, etc.)
const DEF = {}; CAT.forEach(c => { DEF[c[0]] = c[2].slice(); });
let CFG = {url: '', key: '', tv: [], plans: {}}, USER = null, PROF = null, SYNC = {state: 'off', at: 0};
let SET = {charging: false, wall: false, access: JSON.parse(JSON.stringify(DEF))};
const ls = (k, d) => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } };
const lw = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } };
const e = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const on = () => !!(CFG.url && CFG.key);
const css = document.createElement('style');
css.textContent = `.acct-btn{background:transparent;border:1px solid var(--gold,#dba118);color:var(--gold2,#f2c14e);padding:7px 12px;border-radius:999px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.acct-btn:hover{background:rgba(219,161,24,.12)}
section.locked>.wrap>*:not(.lock-panel){display:none !important}.lock-panel{border:1px solid var(--gold,#dba118);background:rgba(219,161,24,.08);border-radius:14px;padding:26px 22px;max-width:640px;margin:30px auto}.lock-panel h3{margin:0 0 8px;color:var(--gold2,#f2c14e);font-size:20px}.lock-panel p{margin:0 0 14px;color:var(--text,#e8e6e1);font-size:14.5px;line-height:1.55}
a[data-lk]::before{content:'🔒 '}.ttm-btn{background:var(--gold,#dba118);color:#111;border:none;border-radius:8px;padding:10px 16px;font:inherit;font-size:14px;font-weight:700;cursor:pointer}.ttm-btn.ghost{background:transparent;color:var(--gold2,#f2c14e);border:1px solid var(--gold,#dba118)}
#authModal{position:fixed;inset:0;z-index:3000;display:none;background:rgba(0,0,0,.78);overflow:auto;padding:6vh 14px}#authModal.open{display:block}#authBody{max-width:460px;margin:0 auto;background:var(--card,#16161a);border:1px solid var(--gold,#dba118);border-radius:14px;padding:20px 22px;color:var(--text,#e8e6e1)}#authBody h3{margin:0 0 10px;color:var(--gold,#dba118);font-size:14px;letter-spacing:1.2px;text-transform:uppercase}#authBody input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.04);border:1px solid var(--line,#2b2b30);color:inherit;border-radius:8px;padding:10px;font:inherit;margin:4px 0 12px}#authBody .row{display:flex;gap:8px;flex-wrap:wrap}#authBody small{color:var(--mute,#8b8f9a)}
.plan-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}@media (max-width:900px){.plan-grid{grid-template-columns:repeat(2,1fr)}}@media (max-width:520px){.plan-grid{grid-template-columns:1fr}}.plan-card{border:1px solid var(--line,#2b2b30);border-radius:12px;padding:14px;background:rgba(255,255,255,.02)}.plan-card.me{border-color:var(--gold,#dba118)}.plan-card h4{margin:0;color:var(--gold2,#f2c14e);font-size:17px}.plan-card .pr{font-size:13px;color:var(--mute,#8b8f9a);margin:4px 0 8px}.plan-card ul{margin:0;padding-left:18px;font-size:13px;line-height:1.55}`;
document.head.appendChild(css);
const modal = document.createElement('div'); modal.id = 'authModal'; modal.innerHTML = '<div id="authBody"></div>'; document.body.appendChild(modal);

// magic-link return: tokens arrive in the URL fragment
(function(){ const h = location.hash || ''; if(h.indexOf('access_token=') < 0) return; const p = new URLSearchParams(h.slice(1));
  if(p.get('access_token')) lw(AK, {access: p.get('access_token'), refresh: p.get('refresh_token'), exp: Date.now() + (+p.get('expires_in') || 3600) * 1000});
  try{ history.replaceState(null, '', location.pathname + location.search + ''); window.dispatchEvent(new HashChangeEvent('hashchange')); }catch(err){} })();

async function raw(path, opt, token){
  const h = Object.assign({apikey: CFG.key, 'Content-Type': 'application/json'}, (opt && opt.headers) || {}); if(token) h.Authorization = 'Bearer ' + token; else if(CFG.key.indexOf('eyJ') === 0) h.Authorization = 'Bearer ' + CFG.key;
  const r = await fetch(CFG.url.replace(/\/$/, '') + path, Object.assign({}, opt, {headers: h}));
  let j = null; try{ j = await r.json(); }catch(err){} return {ok: r.ok, status: r.status, json: j};
}
async function token(){
  const s = ls(AK, null); if(!s) return null;
  if(s.exp - 60000 > Date.now()) return s.access; if(!s.refresh) return null;
  const r = await raw('/auth/v1/token?grant_type=refresh_token', {method: 'POST', body: JSON.stringify({refresh_token: s.refresh})});
  if(r.ok && r.json && r.json.access_token){ lw(AK, {access: r.json.access_token, refresh: r.json.refresh_token, exp: Date.now() + (r.json.expires_in || 3600) * 1000}); return r.json.access_token; }
  try{ localStorage.removeItem(AK); }catch(err){} return null;
}
async function api(path, opt){ return raw(path, opt, await token()); }


// ---------- anonymous usage tracking (what is opened and clicked, never what is typed). Off for admins, Do Not Track and ?notrack=1.
(function(){ try{ const q = new URLSearchParams(location.search).get('notrack'); if(q === '1') localStorage.setItem('ttm_no_track', '1'); else if(q === '0') localStorage.removeItem('ttm_no_track'); }catch(err){} })();
const TRK = {q: [], ready: false, sec: '', t0: Date.now(), secT: Date.now(), errs: 0, lastClick: '', lastAt: 0};
const trkOff = () => { try{ if(localStorage.getItem('ttm_no_track') === '1') return true; }catch(err){} return navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true; };
const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
const VID = (() => { try{ let v = localStorage.getItem('ttm_vid_v1'); if(!v){ v = rid(); localStorage.setItem('ttm_vid_v1', v); } return v; }catch(err){ return rid(); } })();
const SID = (() => { try{ let s = sessionStorage.getItem('ttm_sid_v1'); if(!s){ s = rid(); sessionStorage.setItem('ttm_sid_v1', s); let n = +localStorage.getItem('ttm_visits_v1') || 0; localStorage.setItem('ttm_visits_v1', String(n + 1)); } return s; }catch(err){ return rid(); } })();
const VISITS = (() => { try{ return +localStorage.getItem('ttm_visits_v1') || 1; }catch(err){ return 1; } })();
const DEV = (() => { const w = Math.min(screen.width || 1024, window.innerWidth || 1024); return w < 700 ? 'mobile' : w < 1100 ? 'tablet' : 'desktop'; })();
function track(ev, tg, p){
  if(!on() || trkOff()) return;
  TRK.q.push({vid: VID, sid: SID, uid: USER ? USER.id : null, pg: TERM, ev, tg: tg == null ? null : String(tg).slice(0, 110), dv: DEV, p: p || {}});
  if(TRK.q.length > 300) TRK.q.shift();
}
window.ttmTrack = (ev, name, p) => track(ev, TERM + '|' + name, p);
async function trkFlush(unload){
  if(!TRK.ready || !TRK.q.length || !on()) return;
  const rows = TRK.q.splice(0, 100); let tk = null;
  try{ if(unload){ const s = ls(AK, null); tk = s && s.exp - 30000 > Date.now() ? s.access : null; } else tk = await token(); }catch(err){}
  rows.forEach(r => { if(!tk) r.uid = null; });
  try{ const r = await fetch(CFG.url.replace(/\/$/, '') + '/rest/v1/ttm_events', {method: 'POST', keepalive: true, headers: {apikey: CFG.key, 'Content-Type': 'application/json', Prefer: 'return=minimal', ...(tk ? {Authorization: 'Bearer ' + tk} : {})}, body: JSON.stringify(rows)}); if(!r.ok && r.status >= 500 && TRK.q.length < 100) TRK.q.unshift(...rows); }catch(err){ if(TRK.q.length < 100) TRK.q.unshift(...rows); }
}
const secNow = () => { const o = new URLSearchParams(location.search).get('only'); const h = (location.hash || '').slice(1); return h.indexOf('access_token') >= 0 ? TRK.sec : (TERM === 'home' ? 'home' : (o || h || 'menu')); };
function trkDwell(){ const s = Math.round((Date.now() - TRK.secT) / 1000); if(TRK.sec && s >= 1 && s < 7200) track('dwell', TERM + '|' + TRK.sec, {s}); TRK.secT = Date.now(); }
function trkSection(){
  const id = secNow(); if(id === TRK.sec) return; trkDwell(); TRK.sec = id; track('view', TERM + '|' + id);
  setTimeout(() => { const el = document.getElementById(id); if(el && el.classList && el.classList.contains('locked')) track('lock', TERM + '|' + id); }, 500);
}
function trkStart(){
  if(TRK.started) return; TRK.started = true;
  TRK.ready = true;
  if(PROF && PROF.is_admin){ try{ localStorage.setItem('ttm_no_track', '1'); }catch(err){} TRK.q.length = 0; return; }
  if(trkOff()){ TRK.q.length = 0; return; }
  let ref = ''; try{ const u = new URL(document.referrer); if(u.host && u.host !== location.host) ref = u.host.replace(/^www\./, ''); }catch(err){}
  let tz = ''; try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch(err){}
  track('start', null, {n: VISITS, ref, tz, lang: (navigator.language || '').slice(0, 8), w: Math.round((window.innerWidth || 0) / 100) * 100});
  trkSection(); trkFlush();
}
window.addEventListener('hashchange', () => { if(TRK.ready) trkSection(); });
document.addEventListener('click', ev => {
  if(!TRK.ready && !on()) return; const t = ev.target && ev.target.closest ? ev.target.closest('button, a, .menu-tile, .filter-chip, summary') : null; if(!t || t.closest('#authBody input')) return;
  let name = '';
  if(t.id) name = t.id;
  else if(t.classList.contains('filter-chip')) name = 'chip:' + ((t.parentElement && t.parentElement.id) || '') + ':' + (t.dataset.v || t.dataset.a || t.textContent.trim().slice(0, 20));
  else if(t.tagName === 'A'){ const h = t.getAttribute('href') || ''; try{ const u = new URL(h, location.href); name = u.host && u.host !== location.host ? 'ext:' + u.host.replace(/^www\./, '') : (h.charAt(0) === '#' ? h : 'link:' + u.pathname.replace(/^.*ttm-markets-terminal\//, '') + u.hash); }catch(err){ name = h.slice(0, 40); } }
  else name = (t.dataset.j || t.dataset.m || t.dataset.d || t.dataset.a || t.textContent.trim().slice(0, 30));
  if(!name) return; const now = Date.now(); if(name === TRK.lastClick && now - TRK.lastAt < 400) return; TRK.lastClick = name; TRK.lastAt = now;
  track('click', TERM + '|' + name);
}, true);
document.addEventListener('change', ev => { const t = ev.target; if(!t || t.tagName !== 'SELECT' || !(t.id || t.name) || t.closest('#admin, #authBody')) return; track('choice', TERM + '|' + (t.id || t.name) + '=' + String(t.value).slice(0, 30)); }, true);
window.addEventListener('error', ev => { if(TRK.errs++ < 5) track('error', String(ev.message || 'error').slice(0, 100), {pg: TERM}); });
const trkEnd = () => { if(!TRK.ready || TRK.ended) return; TRK.ended = true; trkDwell(); track('end', null, {dur: Math.round((Date.now() - TRK.t0) / 1000)}); trkFlush(true); };
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden'){ trkDwell(); trkFlush(true); } else { TRK.secT = Date.now(); } });
window.addEventListener('pagehide', trkEnd);
setInterval(() => { if(!document.hidden) trkFlush(); }, 8000);
document.addEventListener('click', ev => { const t = ev.target; if(t && t.id === 'ttmTrkToggle'){ ev.preventDefault(); try{ if(localStorage.getItem('ttm_no_track') === '1') localStorage.removeItem('ttm_no_track'); else localStorage.setItem('ttm_no_track', '1'); }catch(err){} trkNote(); } });
function trkNote(){ const n = document.getElementById('ttmTrkNote'); if(!n) return; const off = trkOff(); n.innerHTML = 'We count which pages and buttons are used, never what you type, to improve the terminal. Tracking is currently <b>' + (off ? 'off' : 'on') + '</b> for this device. <a href="#" id="ttmTrkToggle" style="color:var(--gold2)">' + (off ? 'Turn on' : 'Turn off') + '</a>'; }

async function boot(){
  try{ const r = await fetch(BASE + 'ttm_config.json?t=' + Date.now(), {cache: 'no-store'}); if(r.ok){ const c = await r.json(); CFG = {url: c.supabase_url || '', key: c.supabase_anon_key || '', tv: c.tradingview || [], plans: c.plans || {}}; } }catch(err){}
  if(on()){
    try{ const r = await raw('/rest/v1/ttm_settings?select=key,value'); if(r.ok && Array.isArray(r.json)) r.json.forEach(x => { if(x.key === 'charging') SET.charging = x.value === true || x.value === 'true'; if(x.key === 'wall') SET.wall = x.value === true || x.value === 'true'; if(x.key === 'access' && x.value && typeof x.value === 'object') Object.keys(x.value).forEach(k => { SET.access[k] = x.value[k]; }); }); }catch(err){}
    const t = await token();
    if(t){ const u = await raw('/auth/v1/user', {}, t); if(u.ok && u.json && u.json.id){ USER = {id: u.json.id, email: u.json.email}; const p = await api(`/rest/v1/ttm_profiles?id=eq.${USER.id}&select=plan,is_admin,email`); PROF = (p.ok && p.json && p.json[0]) || {plan: 'free', is_admin: false}; } }
  }
  ui(); if(USER) syncInit(); trkStart(); trkNote();
}
// access: does the current visitor get this section or feature?
function can(key){
  if(!on() || !SET.charging) return true;
  if(PROF && PROF.is_admin) return true;
  if(SET.wall && !USER) return false;
  const a = SET.access[key]; if(!a) return true;
  const plan = PROF ? PROF.plan : 'free';
  return plan === 'pro' || a.indexOf(plan) >= 0 || a.indexOf('free') >= 0;
}
const needText = key => { const a = (SET.access[key] || []).filter(x => x !== 'pro'); const l = a.length ? a.map(pname) : []; return (l.length ? l.join(' or ') + ' or ' : '') + 'Pro'; };
function upsell(key){
  track('lock', TERM + '|feat:' + key);
  const label = (CAT.find(c => c[0] === key) || [0, key, 0])[1].replace(/^(Crypto|TradFi) · /, '');
  if(SET.wall && !USER){ openAuth('<p>Sign in to continue. It is free and takes a minute.</p>' + signInForm()); return; }
  openAuth(USER ? `<p><b>${e(label)}</b> is included with the <b>${e(needText(key))}</b> plan. You are on <b>${e(pname(PROF.plan))}</b>. Paid plans are not open for self-sign-up yet; ask TTM on Telegram.</p><div class="row"><button class="ttm-btn ghost" id="authClose">Close</button></div>`
    : `<p><b>${e(label)}</b> is included with the <b>${e(needText(key))}</b> plan. Sign in to continue.</p>` + signInForm());
}
window.ttmCan = can; window.ttmUpsell = upsell;

// ---------- sign-in modal
function signInForm(){ return on() ? `<label for="authEmail"><small>Email</small></label><input id="authEmail" type="email" autocomplete="email" placeholder="you@example.com"><div class="row"><button class="ttm-btn" id="authSend">Email me a sign-in link</button><button class="ttm-btn ghost" id="authClose">Cancel</button></div><p id="authNote" style="margin:12px 0 0"><small>No password. We email a one-time link and a code. Creating an account is free.</small></p>` : '<p>Accounts are coming soon. The terminal stays free and open in the meantime.</p><div class="row"><button class="ttm-btn ghost" id="authClose">Close</button></div>'; }
function openAuth(html){ track('auth_open', TERM); $('authBody').innerHTML = '<h3>TTM account</h3>' + (html || signInForm()); modal.classList.add('open'); }
const closeAuth = () => modal.classList.remove('open');
document.addEventListener('click', async ev => {
  const t = ev.target; if(!t || !t.id && !t.closest) return;
  if(t.id === 'acctBtn'){ if(!USER) openAuth(); else if(TERM === 'home'){ const a = $('account'); if(a) a.scrollIntoView({behavior: 'smooth'}); } else location.href = BASE + 'index.html#account'; }
  else if(t.id === 'authClose' || t === modal) closeAuth();
  else if(t.id === 'memSignIn' || t.id === 'lockSignIn' || t.id === 'wallSignIn') openAuth();
  else if(t.id === 'authSend'){ const em = ($('authEmail').value || '').trim(); if(!/^\S+@\S+\.\S+$/.test(em)){ $('authNote').textContent = 'Enter a valid email address.'; return; }
    t.disabled = true; $('authNote').textContent = 'Sending…';
    const r = await raw('/auth/v1/otp?redirect_to=' + encodeURIComponent(location.origin + location.pathname), {method: 'POST', body: JSON.stringify({email: em, create_user: true})}); t.disabled = false;
    if(r.ok) track('auth_sent', TERM);
    if(r.ok) $('authBody').innerHTML = `<h3>Check your email</h3><p>We sent a sign-in link to <b>${e(em)}</b>. Open it on this device, or type the code from the email here:</p><input id="authCode" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code"><div class="row"><button class="ttm-btn" id="authVerify" data-em="${e(em)}">Sign in with code</button><button class="ttm-btn ghost" id="authClose">Close</button></div><p id="authNote" style="margin:12px 0 0"><small>Nothing arrived? Check spam, or try again in a minute.</small></p>`;
    else $('authNote').textContent = 'Could not send the email' + (r.json && (r.json.msg || r.json.error_description) ? ': ' + (r.json.msg || r.json.error_description) : '.'); }
  else if(t.id === 'authVerify'){ const code = ($('authCode').value || '').trim(), em = t.dataset.em; if(!code) return;
    const r = await raw('/auth/v1/verify', {method: 'POST', body: JSON.stringify({type: 'email', email: em, token: code})});
    if(r.ok && r.json && r.json.access_token){ lw(AK, {access: r.json.access_token, refresh: r.json.refresh_token, exp: Date.now() + (r.json.expires_in || 3600) * 1000}); track('auth_ok', TERM); closeAuth(); await boot(); }
    else $('authNote').textContent = 'That code did not work. Check it and try again.'; }
  else if(t.id === 'memSignOut'){ try{ await api('/auth/v1/logout', {method: 'POST'}); }catch(err){} try{ localStorage.removeItem(AK); localStorage.removeItem(SYNCK); }catch(err){} USER = PROF = null; SYNC = {state: 'off', at: 0}; ui(); }
});

// ---------- cloud sync of tracker data (never includes the Telegram token)
const localDoc = () => ({saved: ls(DATAKEYS[0], []), bals: ls(DATAKEYS[1], {})});
const emptyDoc = d => !(d.saved && d.saved.length) && !(d.bals && Object.keys(d.bals).length);
function mergeDocs(a, b){ const rank = x => x.status === 'closed' ? 2 : x.status === 'open' ? 1 : 0, m = {};
  (b.saved || []).concat(a.saved || []).forEach(x => { if(!x) return; const k = x.id || (x.name + '|' + x.t), o = m[k]; if(!o || rank(x) > rank(o)) m[k] = x; });
  return {saved: Object.keys(m).map(k => m[k]).sort((p, q) => (q.t || 0) - (p.t || 0)), bals: Object.assign({}, a.bals || {}, b.bals || {})}; }
function applyDoc(d){ try{ localStorage.setItem(DATAKEYS[0], JSON.stringify(d.saved || [])); localStorage.setItem(DATAKEYS[1], JSON.stringify(d.bals || {})); }catch(err){} if(window.ttmRR) window.ttmRR.refresh(); }
let dirtyT = null, pushing = false;
async function pushNow(){
  if(!USER || !can('sync') || pushing) return; pushing = true; SYNC.state = 'saving'; ui();
  try{ const meta = ls(SYNCK, {}), cur = await api(`/rest/v1/ttm_user_data?user_id=eq.${USER.id}&select=data,updated_at`); let doc = localDoc();
    if(cur.ok && cur.json && cur.json[0] && Date.parse(cur.json[0].updated_at) > (meta.ts || 0) + 1500){ doc = mergeDocs(doc, cur.json[0].data || {}); applyDoc(doc); }
    const now = new Date().toISOString(), r = await api('/rest/v1/ttm_user_data', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates'}, body: JSON.stringify({user_id: USER.id, data: doc, updated_at: now})});
    if(r.ok){ lw(SYNCK, {uid: USER.id, ts: Date.parse(now)}); SYNC = {state: 'ok', at: Date.now()}; } else SYNC.state = 'error';
  }catch(err){ SYNC.state = 'error'; } pushing = false; ui();
}
window.ttmSync = {dirty(){ if(!USER || !can('sync')) return; clearTimeout(dirtyT); dirtyT = setTimeout(() => { dirtyT = null; pushNow(); }, 1500); }};
async function syncInit(){
  if(!can('sync')){ SYNC.state = 'locked'; ui(); return; }
  try{ const meta = ls(SYNCK, {}), cur = await api(`/rest/v1/ttm_user_data?user_id=eq.${USER.id}&select=data,updated_at`), local = localDoc(), row = cur.ok && cur.json && cur.json[0];
    if(!row){ if(!emptyDoc(local)) await pushNow(); else SYNC = {state: 'ok', at: Date.now()}; }
    else if(meta.uid !== USER.id){ if(emptyDoc(local)) applyDoc(row.data || {}); else applyDoc(mergeDocs(local, row.data || {})); await pushNow(); }
    else if(Date.parse(row.updated_at) > (meta.ts || 0) + 1500){ applyDoc(row.data || {}); lw(SYNCK, {uid: USER.id, ts: Date.parse(row.updated_at)}); SYNC = {state: 'ok', at: Date.now()}; }
    else SYNC = {state: 'ok', at: Date.now()};
  }catch(err){ SYNC.state = 'error'; } ui();
}
setInterval(() => { if(USER && !document.hidden && can('sync') && !dirtyT) syncInit(); }, 90000);

// ---------- locking sections, links and tool parts
function applyGates(){
  if(TERM !== 'crypto' && TERM !== 'tradfi') return; const pre = TERM === 'crypto' ? 'c:' : 't:';
  document.querySelectorAll('body > section[id]').forEach(sec => { const key = pre + sec.id; if(!(key in SET.access) && !(key in DEF)) return;
    const lock = !can(key), wrap = sec.querySelector(':scope > .wrap'); if(!wrap) return;
    sec.classList.toggle('locked', lock); let lp = wrap.querySelector(':scope > .lock-panel');
    if(lock){ const title = (sec.querySelector('h2') || {}).textContent || 'This section';
      if(!lp){ lp = document.createElement('div'); lp.className = 'lock-panel'; wrap.insertBefore(lp, wrap.firstChild); }
      lp.innerHTML = SET.wall && !USER ? `<h3>Sign in to continue</h3><p>Create a free TTM account, or sign in, to open the terminal.</p><button class="ttm-btn" id="lockSignIn">Sign in / create free account</button>`
        : `<h3>🔒 ${e(title)}</h3><p>This section is included with the <b>${e(needText(key))}</b> plan.${USER ? ` You are on <b>${e(pname(PROF.plan))}</b>. Paid plans are not open for self-sign-up yet; ask TTM on Telegram.` : ' Sign in to see what your plan includes.'}</p>${USER ? '' : '<button class="ttm-btn" id="lockSignIn">Sign in / create free account</button>'}`; }
    else if(lp) lp.remove();
    document.querySelectorAll(`a[href="#${sec.id}"]`).forEach(a => { if(lock) a.setAttribute('data-lk', '1'); else a.removeAttribute('data-lk'); }); });
  // the crypto calculator without the tracker: hide the parts that need it
  const rr = $('riskreward'); if(rr) rr.classList.toggle('no-tracker', !can('c:tradejournal'));
}

// ---------- local currency (from the device's time zone / language); USDT is treated as 1 USD
const TZC = {'Australia': 'AUD', 'Pacific/Auckland': 'NZD', 'Europe/London': 'GBP', 'Europe/Dublin': 'EUR', 'Asia/Tokyo': 'JPY', 'Asia/Seoul': 'KRW', 'Asia/Singapore': 'SGD', 'Asia/Hong_Kong': 'HKD', 'Asia/Kolkata': 'INR', 'Asia/Calcutta': 'INR', 'Asia/Dubai': 'AED', 'Asia/Manila': 'PHP', 'Asia/Bangkok': 'THB', 'Asia/Jakarta': 'IDR', 'Asia/Kuala_Lumpur': 'MYR', 'Asia/Ho_Chi_Minh': 'VND', 'Asia/Shanghai': 'CNY', 'Asia/Taipei': 'TWD', 'Asia/Istanbul': 'TRY', 'Europe/Istanbul': 'TRY', 'Europe/Zurich': 'CHF', 'Europe/Stockholm': 'SEK', 'Europe/Oslo': 'NOK', 'Europe/Copenhagen': 'DKK', 'Europe/Warsaw': 'PLN', 'Europe/Prague': 'CZK', 'Europe/Moscow': 'RUB', 'America/Toronto': 'CAD', 'America/Vancouver': 'CAD', 'America/Edmonton': 'CAD', 'America/Halifax': 'CAD', 'America/Winnipeg': 'CAD', 'America/Sao_Paulo': 'BRL', 'America/Mexico_City': 'MXN', 'America/Argentina': 'ARS', 'America/Bogota': 'COP', 'America/Santiago': 'CLP', 'Africa/Johannesburg': 'ZAR', 'Africa/Lagos': 'NGN', 'Africa/Nairobi': 'KES', 'Africa/Cairo': 'EGP', 'Asia/Jerusalem': 'ILS'};
const REG = {AU: 'AUD', NZ: 'NZD', GB: 'GBP', US: 'USD', CA: 'CAD', JP: 'JPY', KR: 'KRW', SG: 'SGD', HK: 'HKD', IN: 'INR', AE: 'AED', PH: 'PHP', TH: 'THB', ID: 'IDR', MY: 'MYR', VN: 'VND', CN: 'CNY', TW: 'TWD', TR: 'TRY', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', RU: 'RUB', BR: 'BRL', MX: 'MXN', AR: 'ARS', CO: 'COP', CL: 'CLP', ZA: 'ZAR', NG: 'NGN', KE: 'KES', EG: 'EGP', IL: 'ILS', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', PT: 'EUR', AT: 'EUR', BE: 'EUR', FI: 'EUR', GR: 'EUR'};
function localCur(){
  let tz = ''; try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch(err){}
  if(TZC[tz]) return TZC[tz]; const k = Object.keys(TZC).find(x => tz.indexOf(x + '/') === 0); if(k) return TZC[k];
  if(tz.indexOf('Europe/') === 0) return 'EUR';
  let reg = ''; try{ const m = (navigator.language || '').match(/[-_]([A-Za-z]{2})$/); reg = m ? m[1].toUpperCase() : ''; }catch(err){}
  return REG[reg] || (tz.indexOf('America/') === 0 ? 'USD' : '');
}
let FX = null;
async function fxLoad(){
  const cur = localCur(); if(!cur || cur === 'USD') return;
  const c = ls('ttm_fx_v1', null); if(c && c.cur === cur && Date.now() - c.t < 12 * 36e5){ FX = c; return; }
  let rate = null;
  try{ const r = await fetch('https://open.er-api.com/v6/latest/USD'); const j = await r.json(); if(j && j.rates && j.rates[cur]) rate = j.rates[cur]; }catch(err){}
  if(!rate){ try{ const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=' + cur); const j = await r.json(); if(j && j.rates && j.rates[cur]) rate = j.rates[cur]; }catch(err){} }
  if(rate){ FX = {cur, rate, t: Date.now()}; lw('ttm_fx_v1', FX); } else if(c && c.cur === cur) FX = c;
}
function fxTxt(usd){
  if(!FX || !isFinite(usd)) return '';
  try{ return ` <span style="color:var(--mute)">≈ ${new Intl.NumberFormat(navigator.language || 'en', {style: 'currency', currency: FX.cur, currencyDisplay: 'code', maximumFractionDigits: 0}).format(usd * FX.rate)}</span>`; }catch(err){ return ''; }
}
// ---------- UI
function planBadge(){ return PROF ? `<span class="rr-pill be">${e(pname(PROF.plan))}${PROF.is_admin ? ' · admin' : ''}</span>` : ''; }
function planCards(){
  const inPlan = (k, p) => { const a = SET.access[k] || []; return a.indexOf(p) >= 0; }, free = CAT.filter(c => inPlan(c[0], 'free')), lab = c => c[1].replace(/ \(.*\)$/, '');
  const only = p => CAT.filter(c => inPlan(c[0], p) && !inPlan(c[0], 'free'));
  const pro = CAT.filter(c => !inPlan(c[0], 'free') && !inPlan(c[0], 'crypto') && !inPlan(c[0], 'tradfi'));
  const price = p => { const x = (CFG.plans || {})[p]; if(!(x && (x.monthly || x.annual))) return p === 'free' ? 'Free' : 'Price to be confirmed';
    const one = (v, t) => `<b>${e(v)} USDT</b> / ${t}${fxTxt(+v)}`; return [x.monthly ? one(x.monthly, 'month') : '', x.annual ? one(x.annual, 'year') : ''].filter(Boolean).join('<br>'); };
  const card = (p, head, items) => `<div class="plan-card ${PROF && PROF.plan === p ? 'me' : ''}"><h4>${pname(p)}</h4><div class="pr">${price(p)}${PROF && PROF.plan === p ? ' · <b style="color:var(--gold2)">your plan</b>' : ''}</div><div style="font-size:12px;color:var(--mute);margin-bottom:4px">${head}</div><ul>${items.map(c => `<li>${e(lab(c))}</li>`).join('') || '<li>—</li>'}</ul></div>`;
  return `<div class="plan-grid">${card('free', 'Includes', free)}${card('crypto', 'Everything in Free, plus', only('crypto'))}${card('tradfi', 'Everything in Free, plus', only('tradfi'))}${card('pro', 'Everything in Crypto and TradFi, plus', pro)}</div>`;
}
function ui(){
  const b = $('acctBtn'); if(b){ b.textContent = USER ? (USER.email || 'Account').split('@')[0].slice(0, 14) : 'Sign in'; b.title = USER ? 'Plan: ' + pname(PROF.plan) : 'Sign in or create a free account'; }
  const na = $('navAdmin'); if(na) na.style.display = PROF && PROF.is_admin ? '' : 'none';
  applyGates();
  const lw2 = $('landWall'); if(lw2){ const w = on() && SET.wall && !USER && SET.charging; lw2.style.display = w ? '' : 'none'; document.querySelectorAll('.chooser').forEach(c => { c.style.display = w ? 'none' : ''; }); }
  const m = $('memAcct');
  if(m){
    if(!on()) m.innerHTML = '<h3>Account</h3><p style="margin:0">Free accounts are <b>coming soon</b>: sign in with your email to sync your trades across your phone, iPad and computer, and to unlock your plan. The terminal and every tool stay free and open in the meantime.</p>';
    else if(!USER) m.innerHTML = '<h3>Account</h3><p style="margin:0 0 12px">Create a free account with just your email (no password).</p><div class="rr-acts" style="margin:0"><button class="rr-btn" id="memSignIn">Sign in / create free account</button></div>';
    else m.innerHTML = `<h3>Account <span style="float:right">${planBadge()}</span></h3><p style="margin:0 0 6px"><b>${e(USER.email)}</b> · plan <b>${e(pname(PROF.plan))}</b></p><p class="calendar-note" style="margin:0 0 12px">Cloud sync: ${can('sync') ? ({ok: 'on' + (SYNC.at ? ', last synced ' + new Date(SYNC.at).toLocaleTimeString() : ''), saving: 'saving…', error: 'could not reach the cloud, will retry', off: 'starting…', locked: 'not included in your plan'})[SYNC.state] || 'on' : 'included with the ' + needText('sync') + ' plan'}. Your Telegram bot token is never uploaded.</p><div class="rr-acts" style="margin:0"><button class="rr-btn ghost sm" id="memSignOut">Sign out</button>${PROF.is_admin ? `<a class="rr-btn sm" style="text-decoration:none" href="${BASE}crypto/index.html#admin">Admin</a>` : ''}</div>`;
  }
  const tv = $('memTv');
  if(tv){ const ok = can('indicators'); tv.innerHTML = ok ? (CFG.tv && CFG.tv.length ? CFG.tv : [{name: 'TTM Indicator Suite', desc: 'Trend, momentum and cycle tools built for the TTM method.'}, {name: 'TTM Signals & Alerts', desc: 'Chart overlays that line up with the terminal.'}, {name: 'TTM Risk Tools', desc: 'Position-sizing helpers on the chart.'}]).map(x => `<div class="mem-card"><b>${e(x.name)}</b><p>${e(x.desc || '')}</p>${x.url ? `<a class="rr-btn sm" style="text-decoration:none;display:inline-block" href="${e(x.url)}" target="_blank" rel="noopener noreferrer">Open on TradingView ↗</a>` : '<span class="rr-pill be">Coming soon</span>'}</div>`).join('')
    : `<div class="mem-card" style="grid-column:1/-1"><b>🔒 TTM indicators on TradingView</b><p>The TTM TradingView indicators are included with the <b>${e(needText('indicators'))}</b> plan. They are coming soon.</p></div>`; }
  const pl = $('memPlans'); if(pl) pl.innerHTML = (!on() || !SET.charging ? '<p style="margin:0 0 12px">Everything in the terminal is <b>free right now</b>. These are the planned plans; they will be announced before anything changes.</p>' : '') + planCards();
  adminUi();
}
async function adminUi(){
  const a = $('admBody'); if(!a || !$('admin').classList.contains('active')) return;
  if(!PROF || !PROF.is_admin){ a.innerHTML = '<div class="rr-card"><p style="margin:0">Admins only.</p></div>'; return; }
  const r = await api('/rest/v1/ttm_profiles?select=id,email,plan,is_admin,created_at&order=created_at.desc&limit=500'), users = (r.ok && Array.isArray(r.json)) ? r.json : [];
  const sel = (attr, v) => `<select ${attr} style="background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 9px;font:inherit">${PLANS.map(p => `<option value="${p[0]}" ${p[0] === v ? 'selected' : ''}>${p[1]}</option>`).join('')}</select>`;
  const cell = (k, p) => p === 'pro' ? '<td style="text-align:center">✓</td>' : `<td style="text-align:center"><input type="checkbox" data-ak="${k}" data-ap="${p}" ${(SET.access[k] || []).indexOf(p) >= 0 ? 'checked' : ''}></td>`;
  a.innerHTML = `<div class="rr-card"><h3>Switches</h3>
    <label style="display:flex;gap:10px;align-items:center;font-size:14px;margin-bottom:8px"><input type="checkbox" id="admCharge" ${SET.charging ? 'checked' : ''} style="width:auto"> <span><b>Plans on.</b> When off, every section and feature is open to everyone.</span></label>
    <label style="display:flex;gap:10px;align-items:center;font-size:14px"><input type="checkbox" id="admWall" ${SET.wall ? 'checked' : ''} style="width:auto"> <span><b>Require sign-in.</b> Visitors must sign in before anything opens (only applies when plans are on).</span></label></div>
    <div class="rr-card"><h3>What each plan sees</h3><div class="rr-wrap"><table class="rr-tbl"><thead><tr><th>Section or feature</th>${PLANS.map(p => `<th style="text-align:center">${p[1]}</th>`).join('')}</tr></thead><tbody>${CAT.map(c => `<tr><td>${e(c[1])}</td>${PLANS.map(p => cell(c[0], p[0])).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="rr-acts"><button class="rr-btn sm" id="admSaveSet">Save</button><button class="rr-btn ghost sm" id="admReset">Reset to the planned defaults</button></div><p class="calendar-note" id="admNote" style="margin:8px 0 0">Pro always has everything. Free means open to everyone, signed in or not. Locks work in the browser, so they hide and block what the page shows; the site is static and its code and data files are public, so real protection for paid content needs that content moved behind the backend. Prices are set in ttm_config.json.</p></div>
    <div class="rr-card"><h3>Members (${users.length})</h3><div class="rr-wrap"><table class="rr-tbl"><thead><tr><th>Email</th><th>Joined</th><th>Plan</th></tr></thead><tbody>${users.map(u => `<tr><td>${e(u.email)}${u.is_admin ? ' <span class="rr-pill be">admin</span>' : ''}</td><td>${new Date(u.created_at).toLocaleDateString()}</td><td>${sel('data-uid="' + u.id + '"', u.plan)}</td></tr>`).join('') || '<tr><td colspan="3" style="color:var(--mute)">No members yet.</td></tr>'}</tbody></table></div></div>
    <div id="usageBox"></div>`;
  usageUi();
}

// ---------- Usage dashboard (admin only)
let UR = {range: '30', data: null, busy: false, err: ''};
const BTN = {rrOpen: 'Open trade', rrSave: 'Save as plan', rrXlsx: 'Download Excel', jXlsx: 'Download Excel (tracker)', rrLive: 'Use live price as entry', rrExport: 'Backup JSON', rrImportBtn: 'Restore JSON', tgSave: 'Telegram save', tgTest: 'Telegram test', bhTab: 'Bias history tab', rrConfirm: 'Confirm trade result', acctBtn: 'Sign in / account button', admSaveSet: 'Admin save', rrCopy: 'Copy order ticket'};
function uLabel(tg){
  const i = String(tg).indexOf('|'), pg = i > 0 ? tg.slice(0, i) : '', th = i > 0 ? tg.slice(i + 1) : tg, P = {crypto: 'Crypto', tradfi: 'TradFi', home: 'Home'}[pg] || pg;
  let name = th; const cat = CAT.find(c => c[0] === (pg === 'tradfi' ? 't:' : 'c:') + th); if(cat) name = cat[1].replace(/^(Crypto|TradFi) · /, ''); else if(BTN[th]) name = BTN[th]; else if(th === 'menu') name = 'Terminal menu'; else if(th === 'home') name = 'Front page'; else if(th.indexOf('feat:') === 0){ const c2 = CAT.find(c => c[0] === th.slice(5)); name = 'Locked feature: ' + (c2 ? c2[1] : th.slice(5)); }
  return e(name) + (P ? ` <span style="color:var(--mute);font-size:11px">${e(P)}</span>` : '');
}
function uBars(rows, key, fmt){ const mx = Math.max(1, ...rows.map(r => +r[key] || 0)); return rows.map(r => `<tr><td>${fmt ? fmt(r) : uLabel(r.tg)}</td><td style="width:42%"><div style="background:rgba(219,161,24,.15);border-radius:4px;height:8px"><div style="width:${Math.round((+r[key] || 0) / mx * 100)}%;background:var(--gold);height:8px;border-radius:4px"></div></div></td><td style="text-align:right;white-space:nowrap"><b>${(+r[key] || 0).toLocaleString()}</b>${r.visitors != null ? ` <span style="color:var(--mute);font-size:11px">· ${r.visitors} ${r.visitors === 1 ? 'person' : 'people'}</span>` : ''}${r.avg_s != null ? ` <span style="color:var(--mute);font-size:11px">· ${r.avg_s}s avg</span>` : ''}</td></tr>`).join(''); }
const uTbl = (title, rows, key, fmt, note) => `<div class="rr-card"><h3>${title}</h3>${rows && rows.length ? `<div class="rr-wrap"><table class="rr-tbl"><tbody>${uBars(rows, key, fmt)}</tbody></table></div>` : '<p class="calendar-note" style="margin:0">Nothing yet.</p>'}${note ? `<p class="calendar-note" style="margin:8px 0 0">${note}</p>` : ''}</div>`;
function uDaily(d){
  if(!d.length) return '<p class="calendar-note" style="margin:0">No visits in this range yet.</p>';
  const W = 760, H = 150, pl = 30, n = d.length, bw = Math.max(3, Math.min(26, (W - pl) / n - 3)), mx = Math.max(1, ...d.map(x => x.visitors)), step = (W - pl) / n;
  let g = `<line x1="${pl}" y1="${H - 18}" x2="${W}" y2="${H - 18}" stroke="#2a2a2e"/><text x="2" y="12" font-size="10" fill="#9a978f">${mx}</text>`;
  d.forEach((x, i) => { const h = Math.round(x.visitors / mx * (H - 34)), s = Math.round(x.sessions / mx * (H - 34)), cx = pl + i * step + step / 2;
    g += `<g><title>${x.day}: ${x.visitors} visitors, ${x.sessions} visits, ${x.views} page views</title><rect x="${cx - bw / 2}" y="${H - 18 - h}" width="${bw}" height="${h}" rx="2" fill="#dba118"/><rect x="${cx - bw / 2}" y="${H - 18 - s}" width="${bw}" height="2" fill="#f2c14e"/></g>`;
    if(n <= 14 || i % Math.ceil(n / 10) === 0) g += `<text x="${cx}" y="${H - 4}" font-size="9" text-anchor="middle" fill="#9a978f">${x.day.slice(5)}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${g}</svg>`;
}
function uHours(h){
  const grid = Array.from({length: 7}, () => Array(24).fill(0)); h.forEach(x => { if(x.dow >= 0 && x.dow < 7) grid[x.dow][x.hr] = x.n; }); const mx = Math.max(1, ...h.map(x => x.n)), DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return '<div class="rr-wrap"><table style="border-collapse:separate;border-spacing:2px;font-size:10px;color:var(--mute)"><tr><td></td>' + Array.from({length: 24}, (_, i) => `<td style="text-align:center">${i % 3 === 0 ? i : ''}</td>`).join('') + '</tr>' +
    grid.map((row, d) => `<tr><td style="padding-right:6px">${DN[d]}</td>${row.map((v, hr) => `<td title="${DN[d]} ${hr}:00 · ${v} visits" style="width:18px;height:16px;border-radius:3px;background:${v ? `rgba(219,161,24,${(0.12 + 0.88 * v / mx).toFixed(2)})` : 'rgba(255,255,255,.04)'}"></td>`).join('')}</tr>`).join('') + '</table></div>';
}
function uRender(D){
  const k = D.kpi || {}, f = D.funnel || {}, tile = (l, v, s) => `<div><small>${l}</small><strong>${v}</strong>${s ? `<br><span style="font-size:11px;color:var(--mute)">${s}</span>` : ''}</div>`;
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—', dur = s => s == null ? '—' : s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's';
  let h = `<div class="rr-card"><h3>Overview</h3><div class="rr-out c4">${tile('People (unique browsers)', (k.visitors || 0).toLocaleString())}${tile('Visits', (k.sessions || 0).toLocaleString(), (k.visitors ? (k.sessions / k.visitors).toFixed(1) : 0) + ' per person')}${tile('Page views', (k.views || 0).toLocaleString())}${tile('Average visit', dur(D.avg_dur))}${tile('Came back', pct(D.returning || 0, k.visitors || 0), (D.returning || 0) + ((D.returning || 0) === 1 ? ' person' : ' people') + ' visited more than once')}${tile('Signed-in members active', k.members || 0)}${tile('Actions recorded', (k.events || 0).toLocaleString())}${tile('Data since', k.first ? new Date(k.first).toLocaleDateString() : '—')}</div></div>
  <div class="rr-card"><h3>Visitors per day</h3>${uDaily(D.daily || [])}<p class="calendar-note" style="margin:6px 0 0">Gold bar = people, thin line on top = visits.</p></div>
  <div class="rr-card"><h3>Sign-up funnel (people)</h3><div class="rr-out c5">${tile('Visited', f.visitors || 0)}${tile('Saw a locked item', f.lock_seen || 0, pct(f.lock_seen, f.visitors) + ' of visitors')}${tile('Opened sign-in', f.auth_open || 0, pct(f.auth_open, f.visitors))}${tile('Asked for a link', f.auth_sent || 0, pct(f.auth_sent, f.auth_open) + ' of those')}${tile('Signed in', f.auth_ok || 0, pct(f.auth_ok, f.auth_sent) + ' of those')}</div></div>`;
  h += `<div class="rr-grid" style="align-items:start"><div>${uTbl('Most opened sections', D.sections, 'views')}${uTbl('Most clicked buttons and links', D.clicks, 'n')}${uTbl('Features used', D.features, 'n', null, 'Trades opened and closed, exports, alerts and the History drawer. Only the kind of action is recorded, never amounts or prices.')}</div><div>${uTbl('Wanted but locked (demand for paid sections)', D.locks, 'n', null, 'How often people opened a section or feature their plan does not include. A good guide to what to put in which plan.')}${uTbl('Dropdown choices (account, time frame, exchange, leverage)', D.choices, 'n', r => { const i = r.tg.indexOf('|'), v = r.tg.slice(i + 1).split('='); return e(v[0].replace(/^rr/, '')) + ' = <b>' + e(v[1] || '') + '</b>'; })}${uTbl('Devices', D.devices, 'n', r => e(r.tg))}${uTbl('Where people came from', D.referrers, 'n', r => e(r.tg))}${uTbl('Time zones', D.zones, 'n', r => e(r.tg))}</div></div>`;
  h += `<div class="rr-card"><h3>When people visit (your time zone)</h3>${uHours(D.hours || [])}</div>`;
  h += `<div class="rr-card"><h3>Signed-in members</h3>${(D.members || []).length ? `<div class="rr-wrap"><table class="rr-tbl"><thead><tr><th>Member</th><th>Plan</th><th>Visits</th><th>Actions</th><th>Favourite section</th><th>Last seen</th></tr></thead><tbody>${D.members.map(m => `<tr><td>${e(m.email)}</td><td>${e(pname(m.plan))}</td><td>${m.sessions}</td><td>${m.events}</td><td>${m.top ? uLabel(m.top) : '—'}</td><td>${new Date(m.last).toLocaleString()}</td></tr>`).join('')}</tbody></table></div>` : '<p class="calendar-note" style="margin:0">No signed-in activity yet.</p>'}</div>`;
  if((D.errors || []).length) h += uTbl('Page errors (things to fix)', D.errors, 'n', r => e(r.tg));
  return h;
}
async function usageUi(){
  const box = $('usageBox'); if(!box || UR.busy) return;
  const range = UR.range, since = range === 'all' ? '-infinity' : new Date(Date.now() - (+range) * 864e5).toISOString(); let tz = 'UTC'; try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }catch(err){}
  const head = `<div class="rr-card"><h3>Usage</h3><p class="calendar-note" style="margin:0 0 10px">Anonymous counts of what is opened and clicked, never what is typed. Your own visits are not counted (admins, and any device where tracking is turned off). The data stays until you clear it.</p>
    <div class="rr-acts" style="align-items:center"><select id="usgRange" style="background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 9px;font:inherit">${[['1', 'Last 24 hours'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['all', 'All time']].map(o => `<option value="${o[0]}" ${o[0] === range ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>
    <button class="rr-btn ghost sm" id="usgRefresh">Refresh</button><button class="rr-btn ghost sm" id="usgCsv">Export CSV</button><button class="rr-btn ghost sm" id="usgClearOld">Clear older than 90 days</button><button class="rr-btn ghost sm" id="usgClearAll" style="border-color:#e0554d;color:#e0554d">Clear ALL usage data</button></div><p class="calendar-note" id="usgNote" style="margin:8px 0 0"></p></div>`;
  box.innerHTML = head + '<p class="calendar-note">Loading…</p>'; UR.busy = true;
  try{ const r = await api('/rest/v1/rpc/ttm_usage_summary', {method: 'POST', body: JSON.stringify({p_since: since, p_tz: tz})});
    if(r.ok && r.json) box.innerHTML = head + uRender(r.json);
    else box.innerHTML = head + `<div class="rr-warn y">Usage data is not set up yet. In Supabase, open SQL Editor and run supabase/usage.sql from the repo, then press Refresh.${r.json && r.json.message ? ' (' + e(r.json.message) + ')' : ''}</div>`;
  }catch(err){ box.innerHTML = head + '<div class="rr-warn y">Could not load usage data.</div>'; }
  UR.busy = false;
}
document.addEventListener('change', ev => { if(ev.target.id === 'usgRange'){ UR.range = ev.target.value; usageUi(); } });
document.addEventListener('click', async ev => {
  const id = ev.target.id, note = txt => { const n = $('usgNote'); if(n) n.textContent = txt; };
  if(id === 'usgRefresh') usageUi();
  else if(id === 'usgClearAll' || id === 'usgClearOld'){
    const old = id === 'usgClearOld'; if(!confirm(old ? 'Delete usage data older than 90 days? This cannot be undone.' : 'Delete ALL usage data? This cannot be undone. Export a CSV first if you want a copy.')) return;
    const q = old ? 'ts=lt.' + encodeURIComponent(new Date(Date.now() - 90 * 864e5).toISOString()) : 'id=gt.0';
    const r = await api('/rest/v1/ttm_events?' + q, {method: 'DELETE', headers: {Prefer: 'count=exact,return=minimal'}});
    note(r.ok ? 'Cleared.' : 'Could not clear (are you signed in as admin?).'); if(r.ok) usageUi();
  } else if(id === 'usgCsv'){
    note('Preparing the file…'); let rows = [], from = 0;
    for(let i = 0; i < 200; i++){ const r = await api('/rest/v1/ttm_events?select=*&order=id.asc', {headers: {Range: from + '-' + (from + 999), 'Range-Unit': 'items'}}); if(!r.ok || !Array.isArray(r.json)){ note('Could not export.'); return; } rows = rows.concat(r.json); if(r.json.length < 1000) break; from += 1000; }
    const cols = ['id', 'ts', 'vid', 'sid', 'uid', 'pg', 'ev', 'tg', 'dv', 'p'], esc2 = v => { v = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const csv = cols.join(',') + '\n' + rows.map(r => cols.map(c => esc2(r[c])).join(',')).join('\n'), a2 = document.createElement('a');
    a2.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'})); a2.download = 'ttm-usage-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a2); a2.click(); a2.remove(); note('Exported ' + rows.length.toLocaleString() + ' rows.');
  }
});
document.addEventListener('change', async ev => { const t = ev.target;
  if(t.dataset && t.dataset.uid){ const r = await api(`/rest/v1/ttm_profiles?id=eq.${t.dataset.uid}`, {method: 'PATCH', body: JSON.stringify({plan: t.value})}); t.style.borderColor = r.ok ? '#3fb47a' : '#e0554d'; } });
document.addEventListener('click', async ev => {
  if(ev.target.id === 'admReset'){ SET.access = JSON.parse(JSON.stringify(DEF)); adminUi(); const n = $('admNote'); if(n) n.textContent = 'Defaults restored. Press Save to apply.'; return; }
  if(ev.target.id !== 'admSaveSet') return;
  const acc = {}; CAT.forEach(c => { acc[c[0]] = []; }); document.querySelectorAll('#admBody input[data-ak]').forEach(i => { if(i.checked) acc[i.dataset.ak].push(i.dataset.ap); });
  const ch = $('admCharge').checked, wall = $('admWall').checked;
  const r = await api('/rest/v1/ttm_settings', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates'}, body: JSON.stringify([{key: 'charging', value: ch}, {key: 'wall', value: wall}, {key: 'access', value: acc}])});
  if(r.ok){ SET.charging = ch; SET.wall = wall; SET.access = acc; $('admNote').textContent = 'Saved.'; ui(); } else $('admNote').textContent = 'Could not save (are you an admin?).'; });
window.addEventListener('hashchange', () => { setTimeout(() => { adminUi(); ui(); }, 80); });
fxLoad().then(() => { if(FX) ui(); });
boot();
})();
