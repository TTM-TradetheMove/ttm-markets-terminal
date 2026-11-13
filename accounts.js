/* TTM accounts: optional sign-in (Supabase), plans, per-section access, cloud sync, admin. Shared by the landing page, crypto and TradFi terminals. */
(function(){
const $ = id => document.getElementById(id);
const TERM = (document.body && document.body.dataset.terminal) || 'home';
const BASE = (document.currentScript && document.currentScript.src) ? new URL('.', document.currentScript.src).href : './';
const AK = 'ttm_auth_v1', SYNCK = 'ttm_sync_meta_v1', DATAKEYS = ['ttm_rr_saved_v1', 'ttm_rr_bals_v1'];
const PLANS = [['free', 'Free'], ['premium', 'Premium'], ['pro', 'Pro']];
const GRID = PLANS.concat([['beta', 'Beta testers'], ['team', 'Team']]);   // the Admin grid also has a Beta column
const normPlan = p => (p === 'crypto' || p === 'tradfi') ? 'premium' : p;   // older Crypto / TradFi plans are now Premium
const pname = id => id === 'lens' ? 'TTM LENS pass' : (PLANS.find(p => p[0] === id) || [0, id])[1];
// what can be locked: key, label, plans that get it by default (Pro always gets everything)
const CAT = [
  ['c:holdings', 'Crypto · TTM Spot (spot portfolio, % only)', ['free']], ['c:pension', 'Crypto · TTM Pension / Super (long-term portfolio, % only)', ['beta'], 'off'], ['c:ttmcharts', 'Crypto · TTM LENS - Charting Tools (full-screen live charts, drawing tools, indicators, replay)', ['team'], 'off'], ['c:chartpro', 'Crypto · Chart popup with drawing tools and post-to-chat (limit orders list)', ['beta'], 'off'], ['t:propertycycle', 'TradFi · 18-year property cycle (US, AU, UK and more)', ['beta'], 'off'], ['t:rotation', 'TradFi · Sector Rotation (new: 11 US sectors, rotation score and stages)', ['team'], 'off'], ['t:holdings', 'TradFi · TTM Spot (invested, % only)', ['free']],
  ['c:calendar', 'Crypto · Macro Watch', ['free']], ['c:tradinghours', 'Crypto · Trading Hours', ['free']], ['c:fomo', 'Crypto · FOMO Finder & RSI Chart', ['free']],
  ['c:btcmonthly', 'Crypto · BTC Monthly (with cycle tops)', ['free']], ['c:tokenevents', 'Crypto · Token Events', []], ['c:library', 'Crypto · Reports library', []], ['c:transparency', 'Crypto · Transparency Watch', ['free']],
  ['c:marketpulse', 'Crypto · Market Pulse (liquidations, funding, open interest)', ['premium']], ['c:rsimap', 'Crypto · RSI Heatmap', ['premium']], ['c:community', 'Crypto · Community chat rooms (section)', ['free']], ['room:free', 'Chat room · Free (read and write)', ['free', 'premium']], ['room:premium', 'Chat room · Premium (read and write)', ['premium']], ['room:pro', 'Chat room · Pro (read and write)', []],
  ['c:lunacycles', 'Crypto · Eclipse (BTC and the eclipse cycles)', ['beta'], 'off'],  ['c:cryptorotation', 'Crypto · Crypto Rotation (10 sectors vs Bitcoin, rotation score, cycle ladder)', [], 'off'], ['c:painzones', 'Crypto · Pain Zones (any coin: average cost, support / resistance, RSI)', [], 'off'], ['c:maxpain', 'Crypto · Max Pain (options, with RSI confluence)', ['premium']], ['c:volume', 'Crypto · Volume Heatmap', ['premium']], ['c:socialpulse', 'Crypto · Social Pulse', ['premium']],
  ['c:riskreward', 'Crypto · Risk / Reward calculator', ['premium']], ['c:tradejournal', 'Crypto · Trade Tracker & win ratio', []], ['c:pnlcal', 'Crypto · P&L Calendar', []], ['c:portfolio', 'Crypto · Portfolio Forecast', []],
  ['t:calendar', 'TradFi · Macro Watch', ['free']], ['t:tradinghours', 'TradFi · Trading Hours', ['free']], ['t:congress', 'TradFi · Congress Watch', []],
  ['t:globalmarkets', 'TradFi · Global Markets', ['premium']], ['t:bonds', 'TradFi · Bonds & Rates', ['premium']], ['t:macrointel', 'TradFi · Macro Intel', ['premium']], ['t:newsrisk', 'TradFi · News & Risk', ['premium']], ['t:tfcalc', 'TradFi · Risk / Reward calculator', ['premium']],
  ['indicators', 'TTM indicators on TradingView', []], ['sync', 'Cloud sync of trades', []], ['excel', 'Excel export', []]
];
// Free means "everyone who is signed in or not"; paid lists add the plan (Crypto items are also in Pro, etc.)
const DEF = {}; CAT.forEach(c => { DEF[c[0]] = c[2].slice(); if(DEF[c[0]].indexOf('pro') < 0 && c[3] !== 'off') DEF[c[0]].push('pro'); });   // Pro has its own tick boxes; default is everything on
let CFG = {url: '', key: '', tv: [], plans: {}}, USER = null, PROF = null, SYNC = {state: 'off', at: 0};
let SET = {charging: false, wall: false, track: true, access: JSON.parse(JSON.stringify(DEF))};
const ls = (k, d) => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } };
const lw = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } };
const e = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const on = () => !!(CFG.url && CFG.key);
const css = document.createElement('style');
css.textContent = `.acct-btn{background:transparent;border:1px solid var(--gold,#dba118);color:var(--gold2,#f2c14e);padding:7px 12px;border-radius:999px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.acct-btn:hover{background:rgba(219,161,24,.12)}
section.locked>.wrap>*:not(.lock-panel){display:none !important}.lock-panel{border:1px solid var(--gold,#dba118);background:rgba(219,161,24,.08);border-radius:14px;padding:26px 22px;max-width:640px;margin:30px auto}.lock-panel h3{margin:0 0 8px;color:var(--gold2,#f2c14e);font-size:20px}.lock-panel p{margin:0 0 14px;color:var(--text,#e8e6e1);font-size:14.5px;line-height:1.55}
a[data-bt]::after{content:'BETA';margin-left:6px;font-size:9px;font-weight:800;letter-spacing:.06em;background:var(--gold,#dba118);color:#111;border-radius:4px;padding:1px 5px;vertical-align:middle}.beta-badge{display:inline-block;margin-left:8px;font-size:10.5px;font-weight:800;letter-spacing:.08em;background:var(--gold,#dba118);color:#111;border-radius:5px;padding:2px 7px;vertical-align:middle}.beta-fb{border:1px dashed var(--gold,#dba118);background:rgba(219,161,24,.05);border-radius:14px;padding:18px;margin:26px 0 0}.beta-fb h3,#fbAdmin h3{margin:0 0 6px}.fb-list{max-height:320px;overflow:auto;margin-bottom:10px}.fb-m{border:1px solid var(--line,#2b2b30);border-radius:10px;padding:10px 12px;margin:0 0 8px;font-size:14px;line-height:1.45;background:rgba(255,255,255,.02)}.fb-h{font-size:12px;color:var(--mute,#9a978f);margin-bottom:4px}.fb-r{border-left:3px solid var(--gold,#dba118);margin-top:8px;padding:2px 0 2px 10px}.fb-in{width:100%;box-sizing:border-box;background:rgba(255,255,255,.04);border:1px solid var(--line,#2b2b30);color:var(--text,#fff);border-radius:8px;padding:9px 10px;font:inherit}#ttmToasts{position:fixed;right:14px;bottom:70px;z-index:2900;display:flex;flex-direction:column;gap:10px;max-width:340px;width:calc(100vw - 28px)}.ttm-toast{position:relative;background:var(--card,#16161a);border:1px solid var(--gold,#dba118);border-radius:12px;padding:12px 34px 10px 14px;box-shadow:0 8px 30px rgba(0,0,0,.6);animation:ttmIn .35s ease}.ttm-toast button{position:absolute;top:4px;right:8px;background:none;border:0;color:var(--mute,#9a978f);font-size:20px;cursor:pointer}.tt-h{font-weight:800;font-size:14px;margin-bottom:3px}.tt-b{font-size:13px;line-height:1.4}.tt-f{font-size:11px;color:var(--mute,#9a978f);margin-top:6px}@keyframes ttmIn{from{transform:translateY(14px);opacity:0}to{opacity:1}}@keyframes ttmTop{from{transform:translateY(-16px);opacity:0}to{opacity:1}}@media (max-width:760px){#ttmToasts{top:calc(env(safe-area-inset-top,0px) + 8px);bottom:auto;right:10px;left:10px;width:auto;max-width:none;z-index:3500}.ttm-toast{animation:ttmTop .35s ease;padding:12px 38px 10px 14px}.tt-h{font-size:15px}}a[data-lk]::before{content:'🔒 '}a[data-hid]{display:none !important}.ttm-btn{background:var(--gold,#dba118);color:#111;border:none;border-radius:8px;padding:10px 16px;font:inherit;font-size:14px;font-weight:700;cursor:pointer}.ttm-btn.ghost{background:transparent;color:var(--gold2,#f2c14e);border:1px solid var(--gold,#dba118)}
#authModal{position:fixed;inset:0;z-index:3000;display:none;background:rgba(0,0,0,.78);overflow:auto;padding:6vh 14px}#authModal.open{display:block}#authBody{max-width:460px;margin:0 auto;background:var(--card,#16161a);border:1px solid var(--gold,#dba118);border-radius:14px;padding:20px 22px;color:var(--text,#e8e6e1)}#authBody h3{margin:0 0 10px;color:var(--gold,#dba118);font-size:14px;letter-spacing:1.2px;text-transform:uppercase}#authBody input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.04);border:1px solid var(--line,#2b2b30);color:inherit;border-radius:8px;padding:10px;font:inherit;margin:4px 0 12px}#authBody .row{display:flex;gap:8px;flex-wrap:wrap}#authBody small{color:var(--mute,#8b8f9a)}
.plan-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}@media (max-width:760px){.plan-grid{grid-template-columns:1fr}}@media (max-width:520px){.plan-grid{grid-template-columns:1fr}}.plan-card{border:1px solid var(--line,#2b2b30);border-radius:12px;padding:14px;background:rgba(255,255,255,.02)}.plan-card.me{border-color:var(--gold,#dba118)}.plan-card h4{margin:0;color:var(--gold2,#f2c14e);font-size:17px}.plan-card .pr{font-size:13px;color:var(--mute,#8b8f9a);margin:4px 0 8px}.plan-card ul{margin:0;padding-left:18px;font-size:13px;line-height:1.55}`;
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
let REFRESHING = null;
async function token(){
  const s = ls(AK, null); if(!s) return null;
  if(s.exp - 60000 > Date.now()) return s.access; if(!s.refresh) return null;
  if(REFRESHING) return REFRESHING;   // one refresh at a time on this page (a used refresh token cannot be reused)
  REFRESHING = (async () => {
    const doIt = async () => {
      const cur = ls(AK, null); if(cur && cur.exp - 60000 > Date.now()) return cur.access;   // another tab already refreshed
      const r = await raw('/auth/v1/token?grant_type=refresh_token', {method: 'POST', body: JSON.stringify({refresh_token: (cur || s).refresh})});
      if(r.ok && r.json && r.json.access_token){ lw(AK, {access: r.json.access_token, refresh: r.json.refresh_token, exp: Date.now() + (r.json.expires_in || 3600) * 1000}); return r.json.access_token; }
      // only a definite "this session is no longer valid" signs you out; a dropped connection or a server hiccup keeps you signed in
      if(r.status === 400 || r.status === 401 || r.status === 403){ const again = ls(AK, null); if(again && again.refresh !== (cur || s).refresh && again.exp - 60000 > Date.now()) return again.access; try{ localStorage.removeItem(AK); }catch(err){} }
      return null;
    };
    try{ return navigator.locks && navigator.locks.request ? await navigator.locks.request('ttm_refresh', doIt) : await doIt(); }catch(err){ return null; }
  })();
  try{ return await REFRESHING; } finally { REFRESHING = null; }
}
async function api(path, opt){ return raw(path, opt, await token()); }


// ---------- anonymous usage tracking (what is opened and clicked, never what is typed). Off for admins, Do Not Track and ?notrack=1.
(function(){ try{ const q = new URLSearchParams(location.search).get('notrack'); if(q === '1') localStorage.setItem('ttm_no_track', '1'); else if(q === '0') localStorage.removeItem('ttm_no_track'); }catch(err){} })();
const TRACKING = true;   // master switch for anonymous usage tracking
const TRK = {q: [], ready: false, sec: '', t0: Date.now(), secT: Date.now(), errs: 0, lastClick: '', lastAt: 0};
const trkOff = () => { if(!TRACKING) return true; try{ if(localStorage.getItem('ttm_no_track') === '1') return true; }catch(err){} return navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true || navigator.webdriver === true || !SET.track; };
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
// Back button: return to whichever page you opened Insights from (Admin if unknown).
document.addEventListener('click', ev => { const b = ev.target.closest && ev.target.closest('#insBack,#insBack2'); if(!b) return; ev.preventDefault(); const t = INS.from && INS.from !== '#insights' ? INS.from : '#admin'; location.hash = t; window.scrollTo(0, 0); });
window.addEventListener('hashchange', ev => { try{ const o = new URL(ev.oldURL).hash; if(o && o !== '#insights') INS.from = o; }catch(err){} });
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
  try{ const r = await fetch(BASE + 'ttm_config.json?t=' + Date.now(), {cache: 'no-store'}); if(r.ok){ const c = await r.json(); CFG = {url: c.supabase_url || '', key: c.supabase_anon_key || '', tv: c.tradingview || [], plans: c.plans || {}, vapid_public: c.vapid_public || '', giphy_key: c.giphy_key || ''}; } }catch(err){}
  if(on()){
    try{ const r = await raw('/rest/v1/ttm_settings?select=key,value'); if(r.ok && Array.isArray(r.json)) r.json.forEach(x => { if(x.key === 'charging') SET.charging = x.value === true || x.value === 'true'; if(x.key === 'wall') SET.wall = x.value === true || x.value === 'true'; if(x.key === 'track') SET.track = !(x.value === false || x.value === 'false'); if(x.key === 'access' && x.value && typeof x.value === 'object'){ const hasPro = x.value._pro === true; Object.keys(x.value).forEach(k => { if(k === '_pro') return; const a = (x.value[k] || []).map(normPlan); if(!hasPro) a.push('pro'); SET.access[k] = a.filter((v, i) => a.indexOf(v) === i); }); } }); }catch(err){}
    const t = await token();
    if(t){ const u = await raw('/auth/v1/user', {}, t); if(u.ok && u.json && u.json.id){ USER = {id: u.json.id, email: u.json.email}; let p = await api(`/rest/v1/ttm_profiles?id=eq.${USER.id}&select=plan,is_admin,email,plan_until,beta,team,tg_handle,badges`); if(!p.ok) p = await api(`/rest/v1/ttm_profiles?id=eq.${USER.id}&select=plan,is_admin,email,plan_until,beta,tg_handle,badges`); if(!p.ok) p = await api(`/rest/v1/ttm_profiles?id=eq.${USER.id}&select=plan,is_admin,email,plan_until,beta,tg_handle`); if(!p.ok) p = await api(`/rest/v1/ttm_profiles?id=eq.${USER.id}&select=plan,is_admin,email,plan_until,beta`); if(!p.ok) p = await api(`/rest/v1/ttm_profiles?id=eq.${USER.id}&select=plan,is_admin,email,plan_until`); if(!p.ok) p = await api(`/rest/v1/ttm_profiles?id=eq.${USER.id}&select=plan,is_admin,email`); PROF = (p.ok && p.json && p.json[0]) || {plan: 'free', is_admin: false}; PROF.plan = normPlan(PROF.plan); if(PROF.plan_until && !PROF.is_admin && new Date(PROF.plan_until) < new Date()){ PROF.expiredPlan = PROF.plan; PROF.plan = 'free'; PROF.plan_until = null; api('/rest/v1/rpc/ttm_expire_me', {method: 'POST', body: '{}'}).catch(() => {}); } } }
  }
  ui(); billLoad(); if(USER){ lensLoad(); refLoad(); syncInit(); tgInit(); fbLoad(true); prefLoad(); discCheck(); } trkStart(); trkNote();
}
// access: does the current visitor get this section or feature?
let LENSS = null, LENSLOADED = false;
const freeHide = () => !!(USER && PROF && !PROF.is_admin && !PROF.beta && !PROF.team && (PROF.plan || 'free') === 'free');
const rmRO = freeHide;
const lensOK = () => !!(PROF && (PROF.is_admin || (PROF.team && PROF.plan === 'pro'))) || !!(LENSS && LENSS.active);
function can(key){
  if(key === 'c:ttmcharts' && on()) return lensOK();
  if(!on() || !SET.charging) return true;
  if(PROF && PROF.is_admin) return true;
  if(SET.wall && !USER) return false;
  const a = SET.access[key]; if(!a) return true;
  const plan = PROF ? PROF.plan : 'free';
  if(PROF && PROF.beta && a.indexOf('beta') >= 0) return true;
  if(PROF && PROF.team && a.indexOf('team') >= 0) return true;
  return a.indexOf(plan) >= 0 || a.indexOf('free') >= 0;
}
const needText = key => { const a = (SET.access[key] || []).filter(x => x !== 'pro' && x !== 'beta'); const l = a.length ? a.map(pname) : []; return (l.length ? l.join(' or ') + ' or ' : '') + 'Pro'; };
function upsell(key){
  track('lock', TERM + '|feat:' + key);
  const label = (CAT.find(c => c[0] === key) || [0, key, 0])[1].replace(/^(Crypto|TradFi) · /, '');
  if(SET.wall && !USER){ openAuth('<p>Sign in to continue. It is free and takes a minute.</p>' + signInForm()); return; }
  openAuth(USER ? `<p><b>${e(label)}</b> is included with the <b>${e(needText(key))}</b> plan. You are on <b>${e(pname(PROF.plan))}</b>. Paid plans are not open for self-sign-up yet. Send TTM a direct message to ask.</p><div class="row"><button class="ttm-btn" id="lockDm">Direct Message TTM</button><button class="ttm-btn ghost" id="authClose">Close</button></div>`
    : `<p><b>${e(label)}</b> is included with the <b>${e(needText(key))}</b> plan. Sign in to continue.</p>` + signInForm());
}
window.ttmMyPush = async (key, title, body) => { if(!USER) return false; const r = await api('/rest/v1/ttm_my_alerts?on_conflict=user_id,ukey', {method: 'POST', headers: {Prefer: 'resolution=ignore-duplicates,return=minimal'}, body: JSON.stringify({user_id: USER.id, ukey: key, title, body})}); return r.ok; };
window.ttmFeedPost = async row => { if(!(PROF && PROF.is_admin)) return false; const r = await api('/rest/v1/ttm_spot_feed?on_conflict=ukey', {method: 'POST', headers: {Prefer: 'resolution=ignore-duplicates,return=minimal'}, body: JSON.stringify(row)}); if(r.ok){ try{ toast(Object.assign({ts: new Date().toISOString()}, row)); }catch(err){} } return r.ok; };
window.ttmFeedList = async n => { const r = await api('/rest/v1/ttm_spot_feed?select=*&order=ts.desc&limit=' + (n || 30)); return r.ok && Array.isArray(r.json) ? r.json : []; };
// Phone lock-screen alerts (web push) for Pro members
const isPro = () => !!(PROF && (PROF.is_admin || PROF.plan === 'pro'));
const pushOK = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64u = v => { const p = '='.repeat((4 - v.length % 4) % 4), r = atob((v + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };
const abU = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function pushState(){ try{ if(!pushOK()) return 'unsupported'; if(Notification.permission === 'denied') return 'denied'; const reg = await navigator.serviceWorker.getRegistration(BASE + 'sw.js') || await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); return sub ? 'on' : 'off'; }catch(err){ return 'off'; } }
async function pushOn(){
  if(!pushOK()) return 'This browser cannot do phone alerts. On iPhone, add TTM to your Home Screen first, then open it from there.';
  const key = (CFG && CFG.vapid_public) || ''; if(!key) return 'Phone alerts are not set up yet.';
  const perm = await Notification.requestPermission(); if(perm !== 'granted') return 'Alerts were blocked. Allow notifications for TTM in your phone settings.';
  const reg = await navigator.serviceWorker.register(BASE + 'sw.js'); await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64u(key)});
  const j = sub.toJSON();
  const r = await api('/rest/v1/ttm_push_subs?on_conflict=endpoint', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'}, body: JSON.stringify({endpoint: j.endpoint, user_id: USER.id, p256dh: j.keys.p256dh, auth: j.keys.auth})});
  return r.ok ? '' : 'Could not save this phone. Ask TTM to run the push setup.';
}
async function pushOff(){ try{ const reg = await navigator.serviceWorker.getRegistration(BASE + 'sw.js'); const sub = reg && await reg.pushManager.getSubscription(); if(sub){ await api('/rest/v1/ttm_push_subs?endpoint=eq.' + encodeURIComponent(sub.endpoint), {method: 'DELETE'}); await sub.unsubscribe(); } }catch(err){} }
// Pro members: live pop-ups for TTM's spot moves (buys, sells, limit orders, part take-profits)
let FEEDT = null, FEEDBUSY = false; const FEEDSHOWN = new Set();
async function feedPoll(first){
  if(FEEDBUSY) return; FEEDBUSY = true; try{ await feedPoll2(first); }finally{ FEEDBUSY = false; }
}
async function feedPoll2(first){
  if(!USER || !PROF || PROF.plan !== 'pro' || PROF.is_admin || !on()) return;
  let last = Math.max(ls('ttm_feed_seen', 0), +(PREFS && PREFS.feedseen) || 0); if(!last) last = Date.now() - 3 * 3600e3; const done = ls('ttm_feed_ids', []);
  const r = await api('/rest/v1/ttm_spot_feed?select=*&order=ts.asc&limit=20&ts=gt.' + encodeURIComponent(new Date(last).toISOString()));
  if(!r.ok || !Array.isArray(r.json) || !r.json.length){ if(first && !ls('ttm_feed_seen', 0)) lw('ttm_feed_seen', Date.now()); return; }
  r.json.forEach(ev => { if(ev.id != null && (FEEDSHOWN.has(ev.id) || done.indexOf(ev.id) >= 0)) return; FEEDSHOWN.add(ev.id); done.push(ev.id); toast(ev); }); lw('ttm_feed_ids', done.slice(-60)); try{ const mx = Math.max.apply(null, r.json.map(z => new Date(z.ts || 0).getTime()).concat([0])); if(mx > (+PREFS.feedseen || 0)){ PREFS.feedseen = mx; syncPrefs(); } }catch(err){} lw('ttm_feed_seen', Math.max(last, new Date(r.json[r.json.length - 1].ts).getTime() + 2));
}
function toast(ev){
  let box = $('ttmToasts'); if(!box){ box = document.createElement('div'); box.id = 'ttmToasts'; document.body.appendChild(box); }
  const ic = {buy: '🟢', lo: '🕒', fill: '✅', tp: '🎯', sell: '🔴', part: '🟠'}[ev.kind] || '📣', d = document.createElement('div'); d.className = 'ttm-toast';
  d.innerHTML = `<button aria-label="Dismiss">×</button><div class="tt-h">${ic} ${e(ev.title)}</div>${ev.body ? `<div class="tt-b">${e(ev.body)}</div>` : ''}<div class="tt-f">TTM spot move · ${new Date(ev.ts).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div>`;
  d.querySelector('button').onclick = () => d.remove(); box.appendChild(d); setTimeout(() => { if(d.parentNode) d.remove(); }, 90000);
  track('feat', 'feed_toast');
}
setInterval(() => feedPoll(false), 45000); setTimeout(() => feedPoll(true), 4000);
window.ttmApi = api; window.ttmCfg = () => CFG; window.ttmWho = () => ({user: !!USER, id: USER ? USER.id : null, handle: USER ? (PROF && PROF.tg_handle ? '@' + String(PROF.tg_handle).replace(/^@/, '') : String(USER.email || 'member').split('@')[0]) : '', ready: !USER || !!PROF, admin: !!(PROF && PROF.is_admin), lens: lensOK(), lensReady: LENSLOADED || !USER, tester: isTester(), token: token});
window.ttmCan = can; window.ttmUpsell = upsell; window.ttmIsAdmin = () => !!(PROF && PROF.is_admin);
window.ttmHoldings = async () => { const r = await raw('/rest/v1/ttm_settings?key=eq.holdings&select=value'); return r.ok && r.json && r.json[0] ? r.json[0].value : null; };
window.ttmPublishHoldings = async part => { if(!(PROF && PROF.is_admin)) return false; let cur = {}; try{ const g = await api('/rest/v1/ttm_settings?key=eq.holdings&select=value'); if(g.ok && g.json && g.json[0] && g.json[0].value) cur = g.json[0].value; }catch(err){} const v = Object.assign({}, cur, part, {t: Date.now()}); const r = await api('/rest/v1/ttm_settings', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates'}, body: JSON.stringify([{key: 'holdings', value: v}])}); return r.ok; };

// ---------- sign-in modal
function signInForm(){ return on() ? `<label for="authEmail"><small>Email</small></label><input id="authEmail" type="email" autocomplete="email" placeholder="you@example.com"><label for="authTg" style="display:block;margin-top:10px"><small>X (Twitter) name, shown as your name in the terminal. No X? Leave it blank and we create one for you.</small></label><input id="authTg" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="@yourXname"><label for="authRef" style="display:block;margin-top:10px"><small>Referral code (optional)</small></label><input id="authRef" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. K7M2QXB" value="${e(((() => { try{ return localStorage.getItem('ttm_ref') || ''; }catch(err){ return ''; } })()))}"><label for="authPw" style="display:block;margin-top:10px"><small>Password (8 or more characters)</small></label><input id="authPw" type="password" autocomplete="current-password" placeholder="Password"><div class="row"><button class="ttm-btn" id="authPwIn">Sign in</button><button class="ttm-btn ghost" id="authPwUp">Create account</button><button class="ttm-btn ghost" id="authClose">Cancel</button></div><div class="row"><button class="ttm-btn ghost" id="authSend">Email me a sign-in link instead</button><button class="ttm-btn ghost" id="authForgot">Forgot password</button></div><p id="authNote" style="margin:12px 0 0"><small>Creating an account is free. Tip: on a phone Home Screen app, use your password.</small></p>` : '<p>Accounts are coming soon. The terminal stays free and open in the meantime.</p><div class="row"><button class="ttm-btn ghost" id="authClose">Close</button></div>'; }
function openAuth(html){ track('auth_open', TERM); $('authBody').innerHTML = '<h3>TTM account</h3>' + (html || signInForm()); modal.classList.add('open'); }
const closeAuth = () => modal.classList.remove('open');
document.addEventListener('click', async ev => {
  const t = ev.target; if(!t || !t.id && !t.closest) return;
  if(t.id === 'acctBtn'){ if(!USER) openAuth(); else if(TERM === 'home'){ const a = $('account'); if(a) a.scrollIntoView({behavior: 'smooth'}); } else location.href = BASE + 'index.html#account'; }
  else if(t.id === 'lockDm'){ closeAuth(); const cb = $('ttmChatBtn'); if(cb) cb.click(); }
  else if(t.id === 'authClose' || t === modal) closeAuth();
  else if(t.id === 'memSignIn' || t.id === 'lockSignIn' || t.id === 'wallSignIn') openAuth();
  else if(t.id === 'ttmChatBtn' || t.closest && t.closest('#ttmChatBtn')){ chatToggle(!CH.open); }
  else if(t.id === 'chX'){ chatToggle(false); }
  else if(t.id === 'chBack'){ if(CH.pick && !CH.sel){ CH.pick = false; CH.q = ''; } CH.sel = null; chatPaint(); }
  else if(t.id === 'chNew'){ CH.pick = true; CH.q = ''; chatPaint(); if(!CH.members){ const r = await api('/rest/v1/ttm_profiles?select=id,email,tg_handle&order=email.asc&limit=1000'); CH.members = r.ok && Array.isArray(r.json) ? r.json : []; chatPaint(); } }
  else if(t.dataset && t.dataset.chnew){ const m = (CH.members || []).find(z => z.id === t.dataset.chnew); CH.who[t.dataset.chnew] = m ? (m.tg_handle ? '@' + String(m.tg_handle).replace(/^@/, '') : m.email) : 'Member'; CH.pick = false; CH.sel = t.dataset.chnew; chatPaint(); const i = $('chIn'); if(i) i.focus(); }
  else if(t.dataset && t.dataset.chc){ CH.sel = t.dataset.chc; chatPaint(); chatSeen(); }
  else if(t.id === 'chSend'){ chatSend(); }
  else if(t.id === 'chImg'){ const f = $('chFile'); if(f) f.click(); }
  else if(t.id === 'chPrevX'){ CH.pend = null; chPrev(); }
  else if(t.dataset && t.dataset.chdel){ if(!armTap(t)) return; if(await delRow('/rest/v1/ttm_chat?id=eq.' + t.dataset.chdel)) chatLoad(); else alert('Could not delete this message. Run the community update SQL in Supabase, then try again.'); }
  else if(t.id === 'lvAdd'){ lvAdd(); }
  else if(t.id === 'lvCancel'){ lvReset(); const m = $('lvNoteMsg'); if(m) m.textContent = ''; }
  else if(t.id === 'lvDaily' || t.id === 'lvNone'){ document.querySelectorAll('.lvDow').forEach(c => { c.checked = t.id === 'lvDaily'; }); }
  else if(t.dataset && t.dataset.lved){ lvEdit(t.dataset.lved); }
  else if(t.dataset && t.dataset.lvdel){ if(!confirm('Delete this live session?')) return; await api('/rest/v1/ttm_live?id=eq.' + t.dataset.lvdel, {method: 'DELETE'}); lvLoad(); LIVE.rows = LIVE.rows.filter(x => String(x.id) !== t.dataset.lvdel); liveBanner(); }
  else if(t.dataset && t.dataset.rmtab){ rmPick(t.dataset.rmtab); }
  else if(t.id === 'rmSend'){ rmSend(); }
  else if(t.id === 'rmImgBtn'){ const f = $('rmFile'); if(f) f.click(); }
  else if(t.id === 'rmClrImg'){ RM.pend = null; rmPrev(); }
  else if(t.id === 'rmMicBtn'){ rmMic(); }
  else if(t.id === 'rmRecStop'){ rmRecStop(); }
  else if(t.id === 'rmClrVoice'){ rmRecDrop(); }
  else if(t.id === 'rmToAll'){ document.querySelectorAll('.rmToBox').forEach(c => { c.checked = true; }); }
  else if(t.dataset && t.dataset.rmedit){ const box = t.closest('.rm-m'), m = (RM.rows || []).find(x => String(x.id) === t.dataset.rmedit); if(!box || !m || RM.editing) return; RM.editing = m.id; const bd = box.querySelector('.rm-bd'); if(bd) bd.style.display = 'none';
    const ed = document.createElement('div'); ed.className = 'rm-ed'; ed.innerHTML = `<textarea id="rmEdIn" rows="3" maxlength="1000"></textarea><div style="display:flex;gap:8px;margin-top:6px"><button class="rr-btn sm" id="rmEdSave" data-id="${m.id}">Save</button><button class="rr-btn ghost sm" id="rmEdCancel">Cancel</button></div>`; box.insertBefore(ed, bd.nextSibling); const ta = ed.querySelector('textarea'); ta.value = m.body || ''; ta.focus(); }
  else if(t.id === 'rmEdCancel'){ RM.editing = null; rmLoad(true); }
  else if(t.id === 'rmEdSave'){ const ta = $('rmEdIn'), n = $('rmNote'); if(!ta) return; t.disabled = true; const r = await api('/rest/v1/ttm_room_msgs?id=eq.' + t.dataset.id, {method: 'PATCH', headers: {Prefer: 'return=minimal'}, body: JSON.stringify({body: ta.value.trim()})});
    if(r.ok){ RM.editing = null; if(n) n.textContent = ''; rmLoad(true); } else { t.disabled = false; const mm = JSON.stringify(r.json || ''); if(n) n.textContent = /empty/i.test(mm) ? 'A message cannot be empty. Cancel, or delete the message instead.' : /muted|policy|permission/i.test(mm) ? 'You cannot edit this message (muted, or not your message).' : 'Could not save the edit. The chat edit database step may not be set up yet.'; } }
  else if(t.dataset && t.dataset.rmseen){ const box = $('rmSn' + t.dataset.rmseen); if(!box) return; if(box.dataset.open){ box.dataset.open = ''; box.innerHTML = ''; return; } box.dataset.open = '1'; box.innerHTML = '<small style="color:var(--mute)">Loading…</small>';
    const r = await api('/rest/v1/rpc/ttm_seen_by', {method: 'POST', body: JSON.stringify({msg_id: +t.dataset.rmseen})}); const rows = r.ok && Array.isArray(r.json) ? r.json : [];
    box.innerHTML = rows.length ? `<small style="color:var(--mute)">Read by ${rows.length}:</small> ` + rows.map(x => `<span class="rm-sw">${e(x.name)}</span>`).join('') : '<small style="color:var(--mute)">Nobody has read this yet.</small>'; }
  else if(t.dataset && t.dataset.rmreply){ RM.reply = {name: t.dataset.n || 'Member', snip: t.dataset.s || ''}; rmReplyBar(); const i = $('rmIn'); if(i){ const tag = '@' + String(RM.reply.name).replace(/\s+/g, '') + ' '; if(!i.value.includes(tag)) i.value = tag + i.value; i.focus(); } }
  else if(t.id === 'rmReplyX'){ RM.reply = null; rmReplyBar(); }
  else if(t.dataset && t.dataset.rmdel){ if(!armTap(t)) return; if(await delRow('/rest/v1/ttm_room_msgs?id=eq.' + t.dataset.rmdel)) rmLoad(true); else { const n = $('rmNote'); if(n) n.textContent = 'Could not delete this message. Run the community update SQL in Supabase, then try again.'; } }
  else if(t.dataset && t.dataset.rmmute){ if(!armTap(t, 'tap again to mute')) return; await rmMute(t.dataset.rmmute, 'all'); const n = $('rmNote'); if(n) n.textContent = 'Member muted in every room. Unmute them in Admin.'; }
  else if(t.id === 'rmMuteBtn'){ await rmMuteForm(); }
  else if(t.dataset && t.dataset.rmunmute){ await api('/rest/v1/ttm_room_mutes?user_id=eq.' + t.dataset.rmunmute + '&room=eq.' + (t.dataset.rmroom || 'all'), {method: 'DELETE'}); rmMutesLoad(); }
  else if(t.id === 'rmGifBtn'){ const b = $('rmGifBox'); if(!b) return; const open = b.style.display === 'none'; b.style.display = open ? 'block' : 'none'; if(open) gifPanel(); }
  else if(t.dataset && t.dataset.gif){ const i = $('rmIn'); if(i){ i.value = (i.value ? i.value + ' ' : '') + 'https://media.giphy.com/media/' + t.dataset.gif + '/giphy.gif'; i.focus(); $('rmGifBox').style.display = 'none'; } }
  else if(t.id === 'rmPollBtn'){ pollForm(); }
  else if(t.id === 'rmPoAdd'){ const c = $('rmPopts'); if(c && c.children.length < 10){ const i = document.createElement('input'); i.placeholder = 'Option ' + (c.children.length + 1); i.maxLength = 100; i.autocomplete = 'off'; i.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:6px'; c.appendChild(i); } }
  else if(t.id === 'rmPoGo'){ await pollCreate(); }
  else if(t.dataset && t.dataset.vote){ const t2 = t.closest('[data-vote]') || t, [mid, op] = t2.dataset.vote.split('|'), mine = (RM.votes[mid] || []).some(v => v.user_id === USER.id && v.opt === +op);
    if(mine) await api('/rest/v1/ttm_room_votes?msg_id=eq.' + mid + '&user_id=eq.' + USER.id + '&opt=eq.' + op, {method: 'DELETE'});
    else { const r = await api('/rest/v1/ttm_room_votes', {method: 'POST', headers: {Prefer: 'resolution=ignore-duplicates,return=minimal'}, body: JSON.stringify({msg_id: +mid, opt: +op})}); if(!r.ok){ const n = $('rmNote'); if(n) n.textContent = 'You cannot vote here (muted, or the polls step is missing).'; } }
    RM.sig = ''; rmLoad(true); }
  else if(t.dataset && t.dataset.rxopen){ RM.rxpick = +t.dataset.rxopen; RM.sig = ''; rmLoad(true); }
  else if(t.dataset && t.dataset.rx){ const [mid, em] = t.dataset.rx.split('|'), mine = (RM.rx[mid] || []).some(x => x.user_id === USER.id && x.emoji === em); RM.rxpick = null;
    if(mine) await api('/rest/v1/ttm_room_reacts?msg_id=eq.' + mid + '&user_id=eq.' + USER.id + '&emoji=eq.' + encodeURIComponent(em), {method: 'DELETE'});
    else { const r = await api('/rest/v1/ttm_room_reacts', {method: 'POST', headers: {Prefer: 'resolution=ignore-duplicates,return=minimal'}, body: JSON.stringify({msg_id: +mid, emoji: em})}); if(!r.ok){ const n = $('rmNote'); if(n) n.textContent = 'You cannot react here (muted, or the reactions step is missing).'; } }
    RM.sig = ''; rmLoad(true); }
  else if(t.id === 'rmEmoBtn'){ const b = $('rmEmoBox'); if(b) b.style.display = b.style.display === 'none' ? 'flex' : 'none'; }
  else if(t.dataset && t.dataset.emo){ const i = $('rmIn'); if(i && !i.disabled){ i.value += t.dataset.emo; i.focus(); } }
  else if(t.dataset && t.dataset.rmf){ PREFS.rfilter = t.dataset.rmf === 'follow' ? 'follow' : 'all'; RM.sig = ''; rmFiltPaint(); prefSave(); rmLoad(true); }
  else if(t.dataset && t.dataset.rmat){ const i = $('rmIn'); if(i && !i.disabled){ i.value = (i.value + (i.value && !/\s$/.test(i.value) ? ' ' : '') + '@' + t.dataset.rmat.replace(/^@/, '') + ' '); i.focus(); } }
  else if(t.dataset && t.dataset.rmfollow){ const id = t.dataset.rmfollow, f = PREFS.follow || [], i = f.findIndex(x => x.id === id); if(i >= 0) f.splice(i, 1); else f.push({id, n: t.dataset.n || 'Member'}); PREFS.follow = f.slice(0, 50); await prefSave(); RM.sig = ''; rmLoad(true); }
  else if(t.dataset && t.dataset.unfollow){ PREFS.follow = (PREFS.follow || []).filter(x => x.id !== t.dataset.unfollow); await prefSave(); ui(); }
  else if(t.id === 'authPwIn' || t.id === 'authPwUp'){ const em = ($('authEmail').value || '').trim(), pw = ($('authPw').value || ''), up = t.id === 'authPwUp';
    if(!/^\S+@\S+\.\S+$/.test(em)){ $('authNote').textContent = 'Enter a valid email address.'; return; }
    if(pw.length < 8){ $('authNote').textContent = 'Password needs 8 or more characters.'; return; }
    if(up && tgTTM(($('authTg') || {}).value)){ $('authNote').textContent = 'Names with TTM in them are kept for the TTM team. Please choose a different X name above, then press Create account again.'; const i = $('authTg'); if(i){ i.focus(); i.style.borderColor = '#e0554d'; } return; }
    t.disabled = true; $('authNote').textContent = 'Working…'; { const h2 = tgPick(($('authTg') || {}).value); if(h2) lw('ttm_tg_pending', h2); refKeep(); }
    const r = up ? await raw('/auth/v1/signup', {method: 'POST', body: JSON.stringify({email: em, password: pw})}) : await raw('/auth/v1/token?grant_type=password', {method: 'POST', body: JSON.stringify({email: em, password: pw})}); t.disabled = false;
    if(r.ok && r.json && r.json.access_token){ lw(AK, {access: r.json.access_token, refresh: r.json.refresh_token, exp: Date.now() + (r.json.expires_in || 3600) * 1000}); track('auth_ok', TERM); closeAuth(); await boot(); }
    else if(r.ok && up) $('authNote').textContent = 'Account created, but email confirmation is still switched on. Ask TTM to turn it off.';
    else { const m = r.json && (r.json.msg || r.json.error_description || r.json.message) || ''; $('authNote').textContent = up ? (/registered|exists/i.test(m) ? 'That email already has an account. Tap Sign in.' : 'Could not create the account. ' + m) : 'Wrong email or password. If you have never set a password, tap Create account with the same email, or email yourself a link.'; } }
  else if(t.id === 'authForgot'){ const em = ($('authEmail').value || '').trim(); if(!/^\S+@\S+\.\S+$/.test(em)){ $('authNote').textContent = 'Enter your email above first.'; return; }
    const r = await raw('/auth/v1/recover?redirect_to=' + encodeURIComponent(location.origin + location.pathname), {method: 'POST', body: JSON.stringify({email: em})}); $('authNote').textContent = r.ok ? 'We emailed a link. Open it in Safari, then set a new password in your Account card.' : 'Could not send the email.'; }
  else if(t.id === 'memPwSave'){ const pw = ($('memPwIn') || {}).value || '', n = $('memPwNote'); if(pw.length < 8){ n.textContent = '8 or more characters.'; return; } n.textContent = 'Saving…'; const r = await api('/auth/v1/user', {method: 'PUT', body: JSON.stringify({password: pw})}); n.textContent = r.ok ? 'Password saved.' : 'Could not save.'; if(r.ok) $('memPwIn').value = ''; }
  else if(t.id === 'authSend'){ const em = ($('authEmail').value || '').trim(); if(!/^\S+@\S+\.\S+$/.test(em)){ $('authNote').textContent = 'Enter a valid email address.'; return; }
    if(tgTTM(($('authTg') || {}).value)){ $('authNote').textContent = 'Names with TTM in them are kept for the TTM team. Please choose a different X name above, then try again.'; const i = $('authTg'); if(i){ i.focus(); i.style.borderColor = '#e0554d'; } return; }
    t.disabled = true; $('authNote').textContent = 'Sending…'; { const h = tgPick(($('authTg') || {}).value); if(h) lw('ttm_tg_pending', h); refKeep(); }
    const r = await raw('/auth/v1/otp?redirect_to=' + encodeURIComponent(location.origin + location.pathname), {method: 'POST', body: JSON.stringify({email: em, create_user: true})}); t.disabled = false;
    if(r.ok) track('auth_sent', TERM);
    if(r.ok) $('authBody').innerHTML = `<h3>Check your email</h3><p>We sent a sign-in email to <b>${e(em)}</b>. In the TTM app, do not tap the link. Press and hold it, tap <b>Copy Link</b>, then paste it here (or type the code if the email has one):</p><input id="authCode" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" placeholder="Paste link or code"><div class="row"><button class="ttm-btn" id="authVerify" data-em="${e(em)}">Sign in</button><button class="ttm-btn ghost" id="authClose">Close</button></div><p id="authNote" style="margin:12px 0 0"><small>Nothing arrived? Check spam, or try again in a minute.</small></p>`;
    else $('authNote').textContent = 'Could not send the email' + (r.json && (r.json.msg || r.json.error_description) ? ': ' + (r.json.msg || r.json.error_description) : '.'); }
  else if(t.id === 'authVerify'){ const code = ($('authCode').value || '').trim(), em = t.dataset.em; if(!code) return;
    let vb = {type: 'email', email: em, token: code};
    if(/^https?:/i.test(code)){ try{ const u = new URL(code), h = new URLSearchParams(u.hash.replace(/^#/, '')); if(h.get('access_token')){ lw(AK, {access: h.get('access_token'), refresh: h.get('refresh_token'), exp: Date.now() + (+h.get('expires_in') || 3600) * 1000}); track('auth_ok', TERM); closeAuth(); await boot(); return; } const tk = u.searchParams.get('token') || u.searchParams.get('token_hash'); if(!tk){ $('authNote').textContent = 'That link is not a sign-in link. Copy the link from the email.'; return; } vb = {type: u.searchParams.get('type') || 'magiclink', token_hash: tk}; }catch(err){ $('authNote').textContent = 'That link did not paste correctly. Try again.'; return; } }
    const r = await raw('/auth/v1/verify', {method: 'POST', body: JSON.stringify(vb)});
    if(r.ok && r.json && r.json.access_token){ lw(AK, {access: r.json.access_token, refresh: r.json.refresh_token, exp: Date.now() + (r.json.expires_in || 3600) * 1000}); track('auth_ok', TERM); closeAuth(); await boot(); }
    else $('authNote').textContent = 'That did not work. The link or code may have expired. Request a new email and try again.'; }
  else if(t.id === 'memDelete'){
    const ok = prompt('This permanently deletes your account and the trades saved to the cloud. Trades stored in this browser stay on this device. Type DELETE to confirm.'); if(ok !== 'DELETE') return;
    const r = await api('/rest/v1/rpc/ttm_delete_me', {method: 'POST', body: '{}'});
    if(r.ok){ try{ localStorage.removeItem(AK); localStorage.removeItem(SYNCK); }catch(err){} USER = PROF = null; SYNC = {state: 'off', at: 0}; ui(); const m = $('memAcct'); if(m) m.innerHTML = '<h3>Account</h3><p style="margin:0">Your account has been deleted.</p>'; }
    else alert('Could not delete the account: ' + ((r.json && (r.json.message || r.json.hint)) || 'delete-account.sql has not been run in Supabase yet.'));
  }
  else if(t.dataset && t.dataset.delu){
    if(!confirm('Delete ' + t.dataset.em + '? This removes their account and cloud-saved data and cannot be undone.')) return;
    const r = await api('/rest/v1/rpc/ttm_admin_delete_user', {method: 'POST', body: JSON.stringify({p_id: t.dataset.delu})});
    if(r.ok) adminUi(); else alert('Could not delete: ' + ((r.json && (r.json.message || r.json.hint)) || 'delete-account.sql has not been run in Supabase yet.'));
  }
  else if(t.id === 'memSignOut'){ try{ await api('/auth/v1/logout', {method: 'POST'}); }catch(err){} try{ localStorage.removeItem(AK); localStorage.removeItem(SYNCK); }catch(err){} USER = PROF = null; SYNC = {state: 'off', at: 0}; ui(); }
});

// ---------- cloud sync of tracker data (never includes the Telegram token)
const LT = 'ttm_charts__t';
function lensLocal(){ const o = {}; try{ const t = JSON.parse(localStorage.getItem(LT) || '{}'); Object.keys(t).forEach(k => { const v = localStorage.getItem(k); if(v != null) o[k] = {v, t: t[k]}; }); }catch(err){} return o; }
const localDoc = () => ({saved: ls(DATAKEYS[0], []), bals: ls(DATAKEYS[1], {}), lens: lensLocal()});
const emptyDoc = d => !(d.saved && d.saved.length) && !(d.bals && Object.keys(d.bals).length) && !(d.lens && Object.keys(d.lens).length);
function mergeDocs(a, b){ const rank = x => x.status === 'closed' ? 2 : x.status === 'open' ? 1 : 0, m = {};
  (b.saved || []).concat(a.saved || []).forEach(x => { if(!x) return; const k = x.id || (x.name + '|' + x.t), o = m[k]; if(!o || rank(x) > rank(o)) m[k] = x; });
  return {saved: Object.keys(m).map(k => m[k]).sort((p, q) => (q.t || 0) - (p.t || 0)), bals: Object.assign({}, a.bals || {}, b.bals || {}), lens: mergeLens(a.lens, b.lens)}; }
function mergeLens(a, b){ const m = Object.assign({}, a || {}); Object.keys(b || {}).forEach(k => { if(!m[k] || (b[k].t || 0) > (m[k].t || 0)) m[k] = b[k]; }); return m; }
function applyDoc(d){ try{ localStorage.setItem(DATAKEYS[0], JSON.stringify(d.saved || [])); localStorage.setItem(DATAKEYS[1], JSON.stringify(d.bals || {})); }catch(err){}
  let ch = false; try{ const t = JSON.parse(localStorage.getItem(LT) || '{}'); Object.keys(d.lens || {}).forEach(k => { const r = d.lens[k]; if(k.indexOf('ttm_charts_') === 0 && r && typeof r.v === 'string' && (r.t || 0) > (t[k] || 0)){ localStorage.setItem(k, r.v); t[k] = r.t; ch = true; } }); if(ch) localStorage.setItem(LT, JSON.stringify(t)); }catch(err){}
  if(window.ttmRR) window.ttmRR.refresh(); if(ch && window.ttmLensRefresh) window.ttmLensRefresh(); }
let dirtyT = null, pushing = false;
async function pushNow(){
  if(!USER || !can('sync') || pushing) return; pushing = true; SYNC.state = 'saving'; ui();
  try{ const meta = ls(SYNCK, {}), cur = await api(`/rest/v1/ttm_user_data?user_id=eq.${USER.id}&select=data,updated_at`); let doc = localDoc();
    if(cur.ok && cur.json && cur.json[0] && Date.parse(cur.json[0].updated_at) > (meta.ts || 0) + 1500){ doc = mergeDocs(doc, cur.json[0].data || {}); applyDoc(doc); }
    const now = new Date().toISOString(), r = await api('/rest/v1/ttm_user_data', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates'}, body: JSON.stringify({user_id: USER.id, data: doc, updated_at: now})});
    if(r.ok){ lw(SYNCK, {uid: USER.id, ts: Date.parse(now)}); SYNC = {state: 'ok', at: Date.now()}; } else SYNC.state = 'error';
  }catch(err){ SYNC.state = 'error'; } pushing = false; ui();
}
async function pullLens(){ if(!USER || !can('sync') || pushing) return; try{ const meta = ls(SYNCK, {}), cur = await api(`/rest/v1/ttm_user_data?user_id=eq.${USER.id}&select=data,updated_at`), row = cur.ok && cur.json && cur.json[0]; if(row && Date.parse(row.updated_at) > (meta.ts || 0) + 1500){ applyDoc(mergeDocs(localDoc(), row.data || {})); lw(SYNCK, {uid: USER.id, ts: Date.parse(row.updated_at)}); } }catch(err){} }
window.ttmSync = {pull: pullLens, dirty(){ if(!USER || !can('sync')) return; clearTimeout(dirtyT); dirtyT = setTimeout(() => { dirtyT = null; pushNow(); }, 1500); }};
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
        : `<h3>🔒 ${e(title)}</h3><p>This section is included with the <b>${e(needText(key))}</b> plan.${USER ? ` You are on <b>${e(pname(PROF.plan))}</b>. Paid plans are not open for self-sign-up yet.` : ' Sign in to see what your plan includes.'}</p>${USER ? '<button class="ttm-btn" id="lockDm">Direct Message TTM</button>' : '<button class="ttm-btn" id="lockSignIn">Sign in / create free account</button>'}`; }
    else if(lp) lp.remove();
    betaMark(sec, key, wrap, !lock && betaKey(key));
    const offAll = lock && (SET.access[key] || []).filter(x => x !== 'beta').length === 0; document.querySelectorAll(`a[href="#${sec.id}"]`).forEach(a => { if(lock) a.setAttribute('data-lk', '1'); else a.removeAttribute('data-lk'); if(offAll || (lock && freeHide())) a.setAttribute('data-hid', '1'); else a.removeAttribute('data-hid'); });
    if(offAll){ const l2 = wrap.querySelector(':scope > .lock-panel'); if(l2) l2.innerHTML = '<h3>Coming soon</h3><p>This section is not available yet.</p>'; } });
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
function untilTxt(){
  if(PROF && PROF.plan_until && PROF.plan !== 'free'){ const d = new Date(PROF.plan_until), left = Math.max(0, Math.ceil((d - Date.now()) / 864e5)); return ` <span style="color:var(--gold2)">until ${d.toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'})} (${left} ${left === 1 ? 'day' : 'days'} left)</span><br><span class="calendar-note">After that your account returns to Free. Your saved data is kept.</span>`; }
  if(PROF && PROF.expiredPlan) return ` <span class="calendar-note">Your ${e(pname(PROF.expiredPlan))} access has ended and you are back on Free. <a href="#" data-pay="${e(PROF.expiredPlan)}" style="color:var(--gold2)">Renew</a> to get it back.</span>`;
  return '';
}
function planBadge(){ return PROF ? `<span class="rr-pill be">${e(pname(PROF.plan))}${PROF.is_admin ? ' · admin' : ''}</span>` : ''; }
function planCards(){
  const inPlan = (k, p) => { const a = SET.access[k] || []; return a.indexOf(p) >= 0; }, free = CAT.filter(c => inPlan(c[0], 'free')), lab = c => c[1].replace(/ \(.*\)$/, '');
  const only = p => CAT.filter(c => inPlan(c[0], p) && !inPlan(c[0], 'free'));
  const pro = CAT.filter(c => inPlan(c[0], 'pro') && !inPlan(c[0], 'free') && !inPlan(c[0], 'premium'));
  const payBtn = p => (p !== 'free' && BILL && (SET.charging || (PROF && PROF.is_admin))) ? `<button type="button" class="rr-btn sm" data-pay="${p}" style="margin-top:8px">${PROF && PROF.plan === p ? 'Renew' : 'Subscribe'}</button>` : '';
  const price = p => { if(BILL && p !== 'free'){ const one = t => { const x = priceOf(p, t); return x ? `${x.pct ? `<s style="color:var(--mute)">${money(x.list)}</s> ` : ''}<b>${money(x.final)} USDT</b> / ${t === 'year' ? 'year' : 'month'}${fxTxt(x.final)}` : ''; }; return one('month') + '<br>' + one('year') + '<div style="font-size:11px;color:var(--gold2);margin-top:2px">Yearly = 10 months, 2 months free</div>' + capNote() + foundNote(p); }
    const x = (CFG.plans || {})[p]; if(!(x && (x.monthly || x.annual))) return p === 'free' ? 'Free' : 'Price to be confirmed';
    const one = (v, t) => `<b>${e(v)} USDT</b> / ${t}${fxTxt(+v)}`; return [x.monthly ? one(x.monthly, 'month') : '', x.annual ? one(x.annual, 'year') : ''].filter(Boolean).join('<br>'); };
  const card = (p, head, items) => `<div class="plan-card ${PROF && PROF.plan === p ? 'me' : ''}"><h4>${pname(p)}</h4><div class="pr">${price(p)}${PROF && PROF.plan === p ? ' · <b style="color:var(--gold2)">your plan</b>' : ''}${payBtn(p)}</div><div style="font-size:12px;color:var(--mute);margin-bottom:4px">${head}</div><ul>${items.map(c => `<li>${e(lab(c))}</li>`).join('') || '<li>—</li>'}</ul></div>`;
  return `<div class="plan-grid">${card('free', 'Includes', free)}${card('premium', 'Everything in Free, plus (Crypto and TradFi together)', only('premium'))}${card('pro', 'Everything in Premium, plus', pro)}</div>`;
}
function guideLink(){ const f = document.querySelector('footer'); if(!f || f.querySelector('#ttmGuideLink')) return; const p = document.createElement('p'); p.style.cssText = 'text-align:center;margin:10px 0 0'; p.innerHTML = `<a id="ttmShopLink" href="https://ttm-shop.fourthwall.com" target="_blank" rel="noopener" style="color:var(--gold2)">TTM Shop</a> &nbsp;·&nbsp; <a id="ttmGuideLink" href="${BASE}phone-guide.html" target="_blank" rel="noopener" style="color:var(--gold2)">Add TTM to your phone</a><span id="ttmLensGuideSep" style="display:none"> &nbsp;·&nbsp; </span><a id="ttmLensGuideLink" href="${BASE}lens-guide.html" target="_blank" rel="noopener" style="color:var(--gold2);display:none">Add TTM LENS to your phone (Team + Pro)</a>`; f.appendChild(p); try{ tviewInit(); }catch(x){} }
function ui(){ try{ chatUi(); liveBanner(); commBtn(); guideLink(); engineInit(); }catch(err){}
  const b = $('acctBtn'); if(b){ b.textContent = USER ? (PROF && PROF.tg_handle ? '@' + PROF.tg_handle : 'Account') : 'Sign in'; b.title = USER ? (PROF && PROF.tg_handle ? '@' + PROF.tg_handle + ' · ' : '') + 'Plan: ' + pname(PROF.plan) : 'Sign in or create a free account'; }
  const na = $('navAdmin'); if(na) na.style.display = PROF && PROF.is_admin ? '' : 'none';
  applyGates();
  const lw2 = $('landWall'); if(lw2){ const w = on() && SET.wall && !USER && SET.charging; lw2.style.display = w ? '' : 'none'; document.querySelectorAll('.chooser').forEach(c => { c.style.display = w ? 'none' : ''; }); }
  const m = $('memAcct');
  if(m){
    if(!on()) m.innerHTML = '<h3>Account</h3><p style="margin:0">Free accounts are <b>coming soon</b>: sign in with your email to sync your trades across your phone, iPad and computer, and to unlock your plan. The terminal and every tool stay free and open in the meantime.</p>';
    else if(!USER) m.innerHTML = '<h3>Account</h3><p style="margin:0 0 12px">Create a free account with just your email (no password).</p><div class="rr-acts" style="margin:0"><button class="rr-btn" id="memSignIn">Sign in / create free account</button></div>';
    else m.innerHTML = `<h3>Account <span style="float:right">${planBadge()}</span></h3><p style="margin:0 0 6px"><b>Signed in</b> · plan <b>${e(pname(PROF.plan))}</b>${PROF.beta ? ' · <span style="color:var(--gold2)">beta tester</span>' : ''}${untilTxt()}</p>${'tg_handle' in PROF ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px"><small style="color:var(--mute)">X name</small><input id="memTgIn" value="${e(PROF.tg_handle || '')}" placeholder="@yourname" autocapitalize="off" spellcheck="false" style="background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 10px;font:inherit;width:170px"><button class="rr-btn ghost sm" id="memTgSave">Save</button><span id="memTgNote" class="calendar-note"></span></div>` : ''}<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px"><small style="color:var(--mute)">Password</small><input id="memPwIn" type="password" autocomplete="new-password" placeholder="Set or change" style="background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 10px;font:inherit;width:170px"><button class="rr-btn ghost sm" id="memPwSave">Save</button><span id="memPwNote" class="calendar-note"></span></div>${USER ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px"><small style="color:var(--mute)">Phone alerts</small><button class="rr-btn ghost sm" id="memPush">Checking…</button><span id="memPushNote" class="calendar-note"></span></div>` : ''}${USER ? prefsHtml() : ''}<p style="margin:0 0 12px"><a href="https://ttm-shop.fourthwall.com" target="_blank" rel="noopener" style="color:var(--gold2)">TTM Shop: branded items</a></p><p style="margin:0 0 12px"><a href="${BASE}phone-guide.html" target="_blank" rel="noopener" style="color:var(--gold2)">Add TTM to your phone: step-by-step guide</a></p><p class="calendar-note" style="margin:0 0 12px">Cloud sync: ${can('sync') ? ({ok: 'on' + (SYNC.at ? ', last synced ' + new Date(SYNC.at).toLocaleTimeString() : ''), saving: 'saving…', error: 'could not reach the cloud, will retry', off: 'starting…', locked: 'not included in your plan'})[SYNC.state] || 'on' : 'included with the ' + needText('sync') + ' plan'}. Your Telegram bot token is never uploaded.</p><div class="rr-acts" style="margin:0"><button class="rr-btn ghost sm" id="memSignOut">Sign out</button><button class="rr-btn ghost sm" id="memDelete" style="border-color:#e0554d;color:#e0554d">Delete my account</button>${PROF.is_admin ? `<a class="rr-btn sm" style="text-decoration:none" href="${BASE}crypto/index.html#admin">Admin</a>` : ''}</div>`;
  }
  const pb = $('memPush'); if(pb){ pushState().then(v => { pb.textContent = v === 'on' ? 'Turn off' : v === 'off' ? 'Turn on' : 'Not available'; pb.disabled = v === 'unsupported' || v === 'denied'; const n = $('memPushNote'); if(n) n.textContent = v === 'on' ? 'On for this phone.' : v === 'unsupported' ? 'On iPhone, open TTM from your Home Screen.' : v === 'denied' ? 'Blocked in phone settings.' : 'Get live session reminders and TTM updates on your lock screen.'; }); }
  const tv = $('memTv');
  if(tv){ const ok = can('indicators'); tv.innerHTML = ok ? (CFG.tv && CFG.tv.length ? CFG.tv : [{name: 'TTM Indicator Suite', desc: 'Trend, momentum and cycle tools built for the TTM method.'}, {name: 'TTM Signals & Alerts', desc: 'Chart overlays that line up with the terminal.'}, {name: 'TTM Risk Tools', desc: 'Position-sizing helpers on the chart.'}]).map(x => `<div class="mem-card"><b>${e(x.name)}</b><p>${e(x.desc || '')}</p>${x.url ? `<a class="rr-btn sm" style="text-decoration:none;display:inline-block" href="${e(x.url)}" target="_blank" rel="noopener noreferrer">Open on TradingView ↗</a>` : '<span class="rr-pill be">Coming soon</span>'}</div>`).join('')
    : `<div class="mem-card" style="grid-column:1/-1"><b>🔒 TTM indicators on TradingView</b><p>The TTM TradingView indicators are included with the <b>${e(needText('indicators'))}</b> plan. They are coming soon.</p></div>`; }
  const pl = $('memPlans'); if(pl) pl.innerHTML = (!on() || !SET.charging ? '<p style="margin:0 0 12px">Everything in the terminal is <b>free right now</b>. These are the planned plans; they will be announced before anything changes.</p>' : '') + planCards();
  adminUi(); insUi(); try{ refPaint(); }catch(err){}
}

// ---------- USDT payments, renewals and sales
let BILL = null, PAY = null, CAP = null;
const capNote = () => CAP && CAP.full ? '<div style="margin-top:8px;padding:8px 10px;border:1px solid #e0554d;border-radius:8px;font-size:12px"><b>Memberships are full.</b> We cap paid membership at ' + e(CAP.cap) + '. Message TTM on Telegram to join the waiting list.</div>' : '';
const r2 = x => Math.round(x * 100) / 100, money = x => (+x).toFixed(2);
function saleNow(){ const x = BILL && BILL.sale; return x && x.on && (!x.starts || new Date(x.starts) <= new Date()) && (!x.ends || new Date(x.ends) > new Date()) && +x.pct > 0 ? x : null; }
// Founding-member notice. Change FOUND to edit the wording, or set until to '' to hide it.
const FOUND = {limit: 50, rise: 120, until: '2027-02-01'};
function foundNote(p){ try{ if(!FOUND.until || Date.now() >= new Date(FOUND.until + 'T00:00:00+11:00').getTime() || (CAP && CAP.founding_open === false)) return ''; const x = priceOf(p, 'month'), base = x ? x.list : 0; const nu = base ? ' (about ' + (base * (1 + FOUND.rise / 100)).toFixed(2) + ' USDT / month)' : '', left = CAP && CAP.founders != null ? Math.max(0, FOUND.limit - CAP.founders) : null; return `<div style="margin-top:8px;padding:8px 10px;border:1px solid var(--gold,#dba118);border-radius:8px;font-size:12px;line-height:1.45;color:var(--text)"><b style="color:var(--gold2)">⭐ Founding member price, first ${FOUND.limit} members only${left != null ? ' · ' + left + ' left' : ''}.</b> Prices rise ${FOUND.rise}% when the ${FOUND.limit} spots are gone, or on 1 Feb 2027 at the latest${nu}. This price will never be offered again.</div>`; }catch(err){ return ''; } }
function priceOf(plan, term){ if(plan === 'lens' && BILL){ const act = PROF && (PROF.plan === 'premium' || PROF.plan === 'pro') && !(PROF.plan_until && new Date(PROF.plan_until) < new Date()), v = r2(act && PROF.plan === 'pro' ? (+BILL.lens_price_pro || 200) : act ? (+BILL.lens_price_premium || 350) : (+BILL.lens_price || 500)); return {list: v, final: v, pct: 0}; } if(!BILL || BILL[plan] == null) return null; const base = +BILL[plan] * (term === 'year' ? (+BILL.year_months || 10) : 1), sl = saleNow(), pct = sl ? Math.min(90, +sl.pct) : 0; return {list: r2(base), final: r2(base * (1 - pct / 100)), pct}; }
async function billLoad(){ if(!on()) return; const r = await raw('/rest/v1/ttm_billing?id=eq.main&select=cfg'); if(r.ok && Array.isArray(r.json) && r.json[0]) BILL = r.json[0].cfg || null; try{ const cr = await raw('/rest/v1/rpc/ttm_member_cap', {method: 'POST', body: '{}'}); if(cr.ok && cr.json && cr.json.cap) CAP = cr.json; }catch(e3){} try{ saleBanner(); renewBanner(); try{ lensPaint(); }catch(e2){} const pl = $('memPlans'); if(pl && BILL) pl.innerHTML = (!SET.charging ? '<p style="margin:0 0 12px">Everything in the terminal is <b>free right now</b>. These are the planned plans; they will be announced before anything changes.</p>' : '') + planCards(); }catch(err){} }
function saleBanner(){
  let b = $('ttmSale'); const sl = saleNow();
  if(!sl || !SET.charging){ if(b) b.remove(); return; }
  if(!b){ b = document.createElement('div'); b.id = 'ttmSale'; const live = $('ttmLive'); document.body.insertBefore(b, live ? live.nextSibling : document.body.firstChild); }
  const left = sl.ends ? Math.max(0, new Date(sl.ends) - Date.now()) : 0, d = Math.floor(left / 864e5), h = Math.floor(left % 864e5 / 36e5), m = Math.floor(left % 36e5 / 6e4);
  b.innerHTML = `<b>🔥 ${e(sl.name || 'Sale')}: ${e(+sl.pct)}% off every plan</b>${sl.ends ? `<span>ends in ${d ? d + 'd ' : ''}${h}h ${m}m</span>` : ''}<a href="#" data-pay="premium">Get the deal</a>`;
}
function renewBanner(){
  let b = $('ttmRenew'); const show = () => { if(b) b.remove(); };
  if(!USER || !PROF || PROF.is_admin || !SET.charging) return show();
  const until = PROF.plan !== 'free' && PROF.plan_until ? new Date(PROF.plan_until) : null, days = until ? Math.ceil((until - Date.now()) / 864e5) : null;
  let txt = '', key = '';
  if(until && days <= 7 && days >= 0){ txt = `Your <b>${e(pname(PROF.plan))}</b> plan ${days <= 0 ? 'ends today' : days === 1 ? 'ends tomorrow' : 'ends in ' + days + ' days'} (${until.toLocaleDateString(undefined, {day: 'numeric', month: 'short'})}). Renew to keep access.`; key = 'r' + PROF.plan_until + new Date().toDateString(); }
  else if(PROF.expiredPlan){ txt = `Your <b>${e(pname(PROF.expiredPlan))}</b> access has ended. Renew to get it back.`; key = 'x' + PROF.expiredPlan + new Date().toDateString(); }
  if(!txt || ls('ttm_renew_dismiss', '') === key) return show();
  if(!b){ b = document.createElement('div'); b.id = 'ttmRenew'; const a = $('ttmSale') || $('ttmLive'); document.body.insertBefore(b, a ? a.nextSibling : document.body.firstChild); }
  b.innerHTML = `<span>${txt}</span><a href="#" data-pay="${e(PROF.plan !== 'free' ? PROF.plan : (PROF.expiredPlan || 'premium'))}">Renew now</a><button type="button" id="ttmRenewX" aria-label="Dismiss">×</button>`; b.dataset.k = key;
}
function payClose(){ if(PAY && PAY.t) clearInterval(PAY.t); if(PAY && PAY.p) clearInterval(PAY.p); PAY = null; const m = $('ttmPay'); if(m) m.remove(); }
function payOpen(plan, term){
  if(!USER){ openAuth(); return; }
  if(!BILL){ alert('Payments are not set up yet.'); return; }
  payClose(); PAY = {plan: plan === 'pro' ? 'pro' : plan === 'lens' ? 'lens' : 'premium', term: plan === 'lens' ? 'year' : (term || 'month'), order: null, err: ''};
  const m = document.createElement('div'); m.id = 'ttmPay'; document.body.appendChild(m); payPaint();
}
function payPaint(){
  const m = $('ttmPay'); if(!m || !PAY) return; const o = PAY.order;
  const tabs = (key, opts) => `<div class="pay-tabs">${opts.map(x => `<button type="button" class="${PAY[key] === x[0] ? 'on' : ''}" data-ppick="${key}:${x[0]}">${x[1]}</button>`).join('')}</div>`;
  let body = '';
  if(!o){
    const pr = priceOf(PAY.plan, PAY.term), mo = priceOf(PAY.plan, 'month'), yr = priceOf(PAY.plan, 'year'), saved = mo && yr ? r2(mo.final * 12 - yr.final) : 0;
    body = `<h3>${PAY.plan === 'lens' ? 'TTM LENS pass · 12 months' : 'Subscribe'}</h3>${PAY.plan === 'lens' ? '' : tabs('plan', [['premium', 'Premium'], ['pro', 'Pro']]) + tabs('term', [['month', 'Monthly'], ['year', 'Yearly · 2 months free']])}
      <div class="pay-price">${pr.pct ? `<s>${money(pr.list)}</s> ` : ''}<b>${money(pr.final)}</b> USDT <span>/ ${PAY.term === 'year' ? 'year' : 'month'}</span>${fxTxt(pr.final)}</div>
      ${pr.pct ? `<div class="pay-sale">${e((saleNow() || {}).name || 'Sale')}: ${pr.pct}% off</div>` : ''}${PAY.term === 'year' && saved > 0 ? `<div class="pay-sale">You save ${money(saved)} USDT compared with paying monthly.</div>` : ''}
      <ul class="pay-ul"><li>Pay in <b>USDT on the TRON network (TRC20)</b> from any exchange or wallet.</li><li>Your plan switches on by itself, usually within a few minutes of the payment.</li><li>${PAY.term === 'year' ? '12 months of access' : '1 month of access'}, then it ends automatically unless you renew. We remind you 7 days before.</li></ul>
      ${PAY.err ? `<div class="rr-warn y">${e(PAY.err)}</div>` : ''}<div class="pay-acts"><button type="button" class="rr-btn" data-pgo="1">Continue to payment</button><button type="button" class="rr-btn ghost" data-pclose="1">Cancel</button></div>`;
  } else if(o.status === 'paid'){
    body = `<h3>✅ Payment received</h3><p style="margin:6px 0 14px">Thank you. Your <b>${e(pname(o.plan))}</b> plan is now active.</p><div class="pay-acts"><button type="button" class="rr-btn" data-pdone="1">Done</button></div>`;
  } else if(new Date(o.expires_at) < new Date() || o.status === 'expired' || o.status === 'cancelled'){
    body = `<h3>This payment window has ended</h3><p style="margin:6px 0 14px">If you already sent the payment, message TTM on Telegram with the transaction ID and we will switch you on. Otherwise start again.</p><div class="pay-acts"><button type="button" class="rr-btn" data-pagain="1">Start again</button><button type="button" class="rr-btn ghost" data-pclose="1">Close</button></div>`;
  } else {
    const left = Math.max(0, new Date(o.expires_at) - Date.now()), mm = Math.floor(left / 60000), ss = String(Math.floor(left % 60000 / 1000)).padStart(2, '0'), addr = (BILL && BILL.address) || '';
    body = `<h3>Send ${e(pname(o.plan))} · ${o.term === 'year' ? 'yearly' : 'monthly'}</h3>
      <div class="pay-lab">Send exactly</div><div class="pay-big"><b id="payAmt">${money(o.amount)}</b> USDT <button type="button" class="pay-cp" data-pcopy="${money(o.amount)}">Copy</button></div>
      <div class="pay-lab">Network</div><div class="pay-net">TRON (TRC20)</div>
      <div class="pay-lab">To this address</div><div class="pay-addr"><code>${e(addr)}</code> <button type="button" class="pay-cp" data-pcopy="${e(addr)}">Copy</button></div>
      <div class="rr-warn y" style="margin:12px 0"><b>Use TRC20 only.</b> Sending on any other network (ERC20, BEP20…) loses the money. Make sure the amount that <b>arrives</b> is exactly ${money(o.amount)}: some exchanges take their fee out of what you send, so add the fee on top. The exact cents are how we know it is you.</div>
      <div class="pay-wait"><span class="pay-dot"></span> Waiting for your payment… <b id="payLeft">${mm}:${ss}</b> left</div>
      <div class="pay-acts"><button type="button" class="rr-btn ghost" data-pclose="1">Close (we keep watching)</button></div>`;
  }
  m.innerHTML = `<div class="pay-box"><button type="button" class="pay-x" data-pclose="1" aria-label="Close">×</button>${body}</div>`;
}
async function payGo(){
  PAY.err = ''; const r = await api('/rest/v1/rpc/ttm_new_order', {method: 'POST', body: JSON.stringify({p_plan: PAY.plan, p_term: PAY.term})});
  if(!r.ok || !r.json || !r.json.id){ PAY.err = r.json && r.json.message ? r.json.message : 'Could not start the payment. Run supabase/payments.sql first, or try again.'; payPaint(); return; }
  PAY.order = r.json; payPaint();
  PAY.t = setInterval(() => { const o = PAY && PAY.order; if(!o || o.status !== 'open'){ return; } if(new Date(o.expires_at) < new Date()){ payPaint(); return; } const l = $('payLeft'); if(l){ const left = Math.max(0, new Date(o.expires_at) - Date.now()); l.textContent = Math.floor(left / 60000) + ':' + String(Math.floor(left % 60000 / 1000)).padStart(2, '0'); } }, 1000);
  PAY.p = setInterval(async () => { const o = PAY && PAY.order; if(!o || o.status === 'paid') return; const q = await api(`/rest/v1/ttm_orders?id=eq.${o.id}&select=status,expires_at`); if(q.ok && q.json && q.json[0] && q.json[0].status !== o.status){ o.status = q.json[0].status; payPaint(); } }, 8000);
}
document.addEventListener('click', ev => {
  const t = ev.target.closest && ev.target.closest('[data-pay],[data-ppick],[data-pgo],[data-pclose],[data-pdone],[data-pagain],[data-pcopy],#ttmRenewX'); if(!t) return;
  if(t.dataset.pay){ ev.preventDefault(); payOpen(t.dataset.pay); }
  else if(t.dataset.ppick){ const [k, v] = t.dataset.ppick.split(':'); if(PAY && !PAY.order){ PAY[k] = v; payPaint(); } }
  else if(t.dataset.pgo) payGo();
  else if(t.dataset.pclose) payClose();
  else if(t.dataset.pdone){ payClose(); location.reload(); }
  else if(t.dataset.pagain){ const pl = PAY.plan, tm = PAY.term; payClose(); payOpen(pl, tm); }
  else if(t.dataset.pcopy){ try{ navigator.clipboard.writeText(t.dataset.pcopy); const o0 = t.textContent; t.textContent = 'Copied'; setTimeout(() => { t.textContent = o0; }, 1500); }catch(err){} }
  else if(t.id === 'ttmRenewX'){ const b = $('ttmRenew'); if(b){ try{ localStorage.setItem('ttm_renew_dismiss', JSON.stringify(b.dataset.k)); }catch(err){} b.remove(); } }
});
setInterval(() => { try{ saleBanner(); }catch(err){} }, 60000); setInterval(billLoad, 600000);
(function(){ const c = document.createElement('style'); c.textContent = `#ttmSale,#ttmRenew{padding:9px 16px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;font-size:14px;color:var(--text,#eee);text-align:center}#ttmSale{background:linear-gradient(90deg,rgba(229,83,75,.28),rgba(219,161,24,.2));border-bottom:1px solid #e5534b}#ttmRenew{background:linear-gradient(90deg,rgba(142,162,255,.22),rgba(142,162,255,.08));border-bottom:1px solid #8ea2ff}#ttmSale a,#ttmRenew a{background:var(--gold,#dba118);color:#111;border-radius:8px;padding:5px 12px;font-weight:800;text-decoration:none}#ttmRenewX{background:none;border:0;color:inherit;font-size:20px;cursor:pointer;opacity:.7}
#ttmPay{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.72);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 14px}.pay-box{position:relative;background:#141416;border:1px solid var(--line,#333);border-radius:18px;max-width:470px;width:100%;padding:22px 20px;box-shadow:0 20px 60px rgba(0,0,0,.6);margin:auto}.pay-box h3{margin:0 0 12px;font-size:20px}.pay-x{position:absolute;right:12px;top:8px;background:none;border:0;color:var(--mute,#999);font-size:26px;cursor:pointer}.pay-tabs{display:flex;gap:6px;margin:0 0 10px}.pay-tabs button{flex:1;padding:10px 6px;border-radius:10px;border:1px solid var(--line,#333);background:rgba(255,255,255,.04);color:var(--text,#eee);font:inherit;font-weight:700;cursor:pointer}.pay-tabs button.on{background:var(--gold,#dba118);color:#111;border-color:var(--gold,#dba118)}.pay-price{font-size:15px;margin:12px 0 4px}.pay-price b{font-size:34px;letter-spacing:-.02em}.pay-price span{color:var(--mute,#999)}.pay-price s{color:var(--mute,#999)}.pay-sale{color:#3fb97a;font-size:13px;font-weight:700;margin:2px 0}.pay-ul{margin:12px 0;padding-left:18px;font-size:13px;color:var(--mute,#aaa);line-height:1.5}.pay-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.pay-acts .rr-btn{flex:1}.pay-lab{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute,#999);margin:12px 0 4px}.pay-big{font-size:18px}.pay-big b{font-size:40px;letter-spacing:-.02em;color:var(--gold2,#f0b929)}.pay-net{font-weight:800;font-size:16px}.pay-addr{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.pay-addr code{word-break:break-all;font-size:13px;background:rgba(255,255,255,.06);padding:8px 10px;border-radius:8px;flex:1;min-width:200px}.pay-cp{background:rgba(255,255,255,.08);border:1px solid var(--line,#333);color:var(--text,#eee);border-radius:8px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer}.pay-wait{display:flex;gap:8px;align-items:center;font-size:14px;margin-top:6px}.pay-dot{width:10px;height:10px;border-radius:50%;background:#3fb97a;animation:payP 1.2s ease-out infinite}@keyframes payP{0%{box-shadow:0 0 0 0 rgba(63,185,122,.7)}100%{box-shadow:0 0 0 12px transparent}}`; document.head.appendChild(c); })();


// ---------- TTM LENS access: BTCC affiliate check OR a yearly USDT pass
async function lensLoad(){
  if(!on() || !USER){ LENSLOADED = true; return; }
  const r = await api('/rest/v1/rpc/ttm_lens_status', {method: 'POST', body: '{}'});
  LENSS = r.ok && r.json && typeof r.json === 'object' ? r.json : null; LENSLOADED = true;
  try{ lensPaint(); tviewInit(); }catch(err){}
}
function lensPaint(){
  const pl = $('memPlans'); if(!pl || !USER || !on() || !BILL) return;
  let b = $('memLens'); if(!b){ b = document.createElement('div'); b.id = 'memLens'; b.className = 'rr-card'; b.style.marginTop = '14px'; pl.insertAdjacentElement('afterend', b); }
  const L = LENSS || {}, price = money(+BILL.lens_price || 350), mn = +(BILL.lens_min_volume || L.min || 10000), link = BILL.lens_btcc_link || '', adm = PROF && PROF.is_admin;
  const until = L.until ? new Date(L.until) : null, forever = until && until.getFullYear() >= 2090;
  if(L.active && !adm){
    b.innerHTML = `<h3>TTM LENS</h3><div class="rr-warn" style="margin:0 0 10px;border-color:#3fb97a"><b>✅ You have TTM LENS access</b> (${L.via === 'btcc' ? 'BTCC member' : 'LENS pass'}${until && !forever ? ' until ' + e(until.toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'})) : ''}).</div><a class="rr-btn sm" href="${e(new URL('charts/index.html', BASE).href)}" target="_blank" rel="noopener">Open TTM LENS</a>${L.via === 'usdt' ? ` <button type="button" class="rr-btn sm ghost" data-pay="lens">Add 12 more months</button>` : ''}`; return;
  }
  const std = r2(+BILL.lens_price || 500), mine = priceOf('lens', 'year').final, disc = mine < std;
  b.innerHTML = `<h3>TTM LENS</h3><p style="margin:0 0 10px;font-size:14px">TTM's own charting terminal: drawing tools, indicators, paper trading and competitions. One pass gives you <b>12 months</b> of access.</p>
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-size:26px;font-weight:800">${money(mine)} USDT</span><span style="color:var(--mute)">/ year</span>${disc ? `<s style="color:var(--mute)">${money(std)}</s><span style="background:var(--gold,#dba118);color:#111;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:800">${PROF.plan === 'pro' ? 'PRO' : 'PREMIUM'} MEMBER PRICE</span>` : ''}</div>
    <div style="margin-top:12px"><button type="button" class="rr-btn sm" data-pay="lens">Pay with USDT</button></div>`;
}
document.addEventListener('click', async ev => {
  const t = ev.target; if(!t || t.id !== 'lensSend') return;
  const v = ($('lensUid') || {}).value || '', m = $('lensMsg'); if(!v.trim()){ m.textContent = 'Type your BTCC UID first.'; return; }
  t.disabled = true; m.textContent = 'Checking…';
  const r = await api('/rest/v1/rpc/ttm_lens_request', {method: 'POST', body: JSON.stringify({p_uid: v})}); t.disabled = false;
  if(!r.ok){ m.textContent = (r.json && r.json.message) || 'Could not save. Ask TTM to run supabase/payments.sql.'; return; }
  LENSS = r.json; lensPaint(); if(LENSS && LENSS.active) { try{ tviewInit(); }catch(err){} }
});
// ---------- Referrals (only PAID referrals earn the reward)
(function(){ try{ const P = new URLSearchParams(location.search), q = P.get('ref'); if(q) localStorage.setItem('ttm_ref', q.replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toUpperCase()); if(P.get('join') === '1') setTimeout(() => { try{ if(!USER && typeof openAuth === 'function') openAuth(); }catch(err){} }, 2200); }catch(err){} })();
let REF = null;
async function refLoad(){
  if(!USER || !on()) return;
  let c = ''; try{ c = localStorage.getItem('ttm_ref') || ''; }catch(err){}
  if(c){ await api('/rest/v1/rpc/ttm_use_referral', {method: 'POST', body: JSON.stringify({p_code: c})}); try{ localStorage.removeItem('ttm_ref'); }catch(err){} }
  const r = await api('/rest/v1/rpc/ttm_my_referral', {method: 'POST', body: '{}'});
  if(r.ok && r.json && r.json.paid_only){ REF = null; const o = $('memRef'); if(o) o.remove(); } else if(r.ok && r.json && r.json.code){ REF = r.json; refPaint(); try{ const changed = PROF && (REF.plan !== PROF.plan || Math.abs(new Date(REF.plan_until || 0) - new Date(PROF.plan_until || 0)) > 120000); if(changed && !sessionStorage.getItem('ttm_ref_rl')){ sessionStorage.setItem('ttm_ref_rl', '1'); location.reload(); } else if(!changed) sessionStorage.removeItem('ttm_ref_rl'); }catch(err){} }
}
function refPaint(){
  const pl = $('memPlans'); if(!pl || !REF || !USER || !(SET.charging || (PROF && PROF.is_admin))) return;
  let b = $('memRef'); if(!b){ b = document.createElement('div'); b.id = 'memRef'; b.className = 'rr-card'; b.style.marginTop = '14px'; pl.insertAdjacentElement('afterend', b); }
  const link = new URL(BASE, location.href).href.replace(/[#?].*$/, '') + '?ref=' + REF.code;
  const gp = REF.grant_plan, gu = REF.grant_until ? new Date(REF.grant_until).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'}) : '';
  const isPro = ((REF.plan || (PROF && PROF.plan)) === 'pro'), act = Math.min(4, +REF.active || 0), apro = Math.min(4, +REF.active_pro || 0), left = 4 - act, link2 = new URL('invite/', new URL(BASE, location.href)).href + '?ref=' + REF.code;
  const head = gp ? (gp === 'pro' ? 'Pro is unlocked' : 'Premium is unlocked') : left === 4 ? (isPro ? 'Invite 4 Pro members and keep Pro free' : 'Invite 4 paying members and earn free Premium, or free Pro if they all join Pro') : left === 1 ? 'One more paying referral unlocks ' + (isPro ? 'free Pro' : 'free Premium') : left + ' more paying referrals unlock ' + (isPro ? 'free Pro' : 'free Premium');
  const sub = gp ? (gp === 'pro' ? 'All 4 of your referrals are on Pro. Keep them active to keep Pro free.' : 'Keep your qualifying referrals active to maintain your reward.' + (apro < 4 ? ' Get all 4 onto Pro and yours upgrades to Pro.' : '')) : 'Only paying Premium or Pro members count. Keep your qualifying referrals active to maintain your reward.';
  const msg = 'Join me on Trade The Move: crypto and global markets research, tools and a trading community. Free to join: ' + link2;
  b.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h3 style="margin:0;letter-spacing:.06em;font-size:13px;text-transform:uppercase">Your TTM referral progress</h3><span style="background:${gp ? 'rgba(63,185,122,.16);color:#3fb97a;border:1px solid #3fb97a' : 'rgba(219,161,24,.14);color:var(--gold2);border:1px solid var(--gold)'};border-radius:999px;padding:2px 10px;font-size:11px;font-weight:800">${gp ? 'REWARD ACTIVE' : 'IN PROGRESS'}</span></div>
    <div style="font-size:42px;font-weight:800;color:#3fb97a;margin:10px 0 0;line-height:1">${act} <span style="color:var(--mute);font-size:26px">/ 4</span></div>
    <div style="font-size:13px;color:var(--mute);margin:4px 0 10px">Paying members referred</div>
    <div style="display:flex;gap:7px">${[0, 1, 2, 3].map(i => `<div style="flex:1;height:11px;border-radius:99px;background:${i < act ? (i < apro ? 'linear-gradient(90deg,#f0c14b,#dba118)' : 'linear-gradient(90deg,#dba118,#b8860b)') : 'rgba(255,255,255,.08)'};${i < act ? 'box-shadow:0 0 12px rgba(219,161,24,.45)' : ''}"></div>`).join('')}</div>
    <div style="font-size:12px;color:var(--mute);margin-top:6px">Gold = paying. Brighter gold = on Pro (${apro}/4 on Pro).</div>
    <div style="margin:16px 0 0"><div style="font-size:17px;font-weight:700">${e(head)}</div><div style="font-size:13px;color:var(--mute);margin-top:2px">${e(sub)}</div></div>
    <div style="margin:16px 0 0;display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))">${(isPro ? [
        ['YOUR DEAL', 'Pro member · 4 Pro referrals', 'Your <b>Pro stays free</b> while all 4 stay on Pro.', '<b>Monthly</b> referrals: 1 month free · <b>Annual</b> referrals: 12 months free', true],
        ['BONUS', '4 Premium referrals', 'Premium sign-ups still earn you time on Pro.', '<b>Monthly</b>: 1 month free · <b>Annual</b>: 6 months free', false]
      ] : [
        ['YOUR DEAL', 'Premium member · 4 Premium referrals', 'Your <b>Premium is free</b> while all 4 stay.', '<b>Monthly</b> referrals: 1 month free · <b>Annual</b> referrals: 12 months free', true],
        ['UPGRADE', 'All 4 sign up to Pro', 'You are <b>upgraded to Pro</b> for the same period.', '<b>Monthly</b>: 1 month of Pro · <b>Annual</b>: 12 months of Pro', false]
      ]).map(d => `<div style="border:1px solid ${d[4] ? 'var(--gold,#dba118)' : 'var(--line)'};border-radius:12px;padding:12px;background:${d[4] ? 'linear-gradient(180deg,rgba(219,161,24,.14),rgba(255,255,255,.02))' : 'rgba(255,255,255,.02)'}"><span style="font-size:10px;font-weight:800;letter-spacing:.12em;color:${d[4] ? '#111' : 'var(--gold2)'};background:${d[4] ? 'var(--gold,#dba118)' : 'transparent'};border:1px solid var(--gold,#dba118);border-radius:99px;padding:1px 8px">${d[0]}</span><div style="font-weight:800;margin:8px 0 2px">${d[1]}</div><div style="font-size:13px">${d[2]}</div><div style="font-size:12px;color:var(--mute);margin-top:6px">${d[3]}</div></div>`).join('')}</div>
    ${gp ? `<div class="rr-warn" style="margin:12px 0 0;border-color:#3fb97a"><b>🎉 Free ${e(pname(gp))} is active</b> while your paying referrals stay (currently until ${e(gu)}). Your own paid time is paused, never lost.</div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 6px;font-size:13px;color:var(--mute)"><span>Your personal invitation link</span><span style="background:rgba(63,185,122,.14);color:#3fb97a;border-radius:999px;padding:1px 9px;font-size:11px;font-weight:700">Active</span></div>
    <div class="pay-addr"><code>${e(link2)}</code> <button type="button" class="pay-cp" data-pcopy="${e(link2)}">Copy</button></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button type="button" class="rr-btn" data-pcopy="${e(msg)}" style="flex:1;min-width:200px">Copy share message</button>${navigator.share ? `<button type="button" class="rr-btn ghost" data-pshare="${e(link2)}">Share</button>` : ''}<a class="rr-btn ghost" href="${e(link2)}" target="_blank" rel="noopener">Preview invite page</a></div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:14px;font-size:13px;color:var(--mute)"><span>Joined with your link: <b style="color:var(--text)">${+REF.signed || 0}</b></span><span>Paying now: <b style="color:var(--text)">${act}/4</b></span><span>Time bonuses earned: <b style="color:var(--gold2)">${+REF.earned_months || 0} mo</b></span></div>
    <details style="margin-top:12px;font-size:13px;color:var(--mute)"><summary style="cursor:pointer">How the rewards work</summary><p style="margin:8px 0 0">When <b>4 people you refer are paying members</b>, you get <b>Premium free</b> for as long as they stay. If all 4 are on <b>Pro</b>, you get <b>Pro free</b>. If one leaves or drops down, the count falls by 1 and your free plan steps down or ends. A Pro member with 4 Premium referrals gets 1 month free (6 months on yearly). Only paying referrals count.</p></details>
    ${REF.can_enter ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input id="refIn" placeholder="Got a code from a friend?" style="width:210px;background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:8px 10px;font:inherit"><button type="button" class="rr-btn sm" id="refApply">Apply</button><span id="refMsg" class="calendar-note"></span></div>` : ''}`;
}
document.addEventListener('click', async ev => {
  const t = ev.target.closest && ev.target.closest('#refApply,[data-pshare]'); if(!t) return;
  if(t.dataset.pshare){ try{ await navigator.share({title: 'TTM', text: 'Join me on Trade The Move', url: t.dataset.pshare}); }catch(err){} return; }
  const v = ($('refIn').value || '').trim(); if(!v) return;
  const r = await api('/rest/v1/rpc/ttm_use_referral', {method: 'POST', body: JSON.stringify({p_code: v})});
  $('refMsg').textContent = r.ok && r.json === true ? 'Code applied. Thank you!' : 'That code was not accepted (wrong code, your own code, or you joined more than 7 days ago).'; if(r.ok && r.json === true) refLoad();
});

// ---------- Admin: billing (prices, sale, unmatched payments)
async function billAdminLoad(){
  const host = $('admBody'); if(!host || !PROF || !PROF.is_admin) return;
  let box = $('admBill'); if(!box){ box = document.createElement('div'); box.id = 'admBill'; host.insertBefore(box, host.firstChild); }
  const b = await api('/rest/v1/ttm_billing?id=eq.main&select=cfg');
  if(!b.ok || !b.json || !b.json[0]){ box.innerHTML = '<div class="rr-warn y"><b>One database step is missing.</b> In Supabase open SQL Editor, New query, paste the contents of supabase/payments.sql and press Run, then refresh.</div>'; return; }
  const c = b.json[0].cfg || {}, sl = c.sale || {}, inp = (id, v, w) => `<input id="${id}" value="${e(v == null ? '' : v)}" style="width:${w || 110}px;background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 9px;font:inherit">`;
  let refHtml = '';
  try{ const rq = await api('/rest/v1/ttm_profiles?select=id,email,tg_handle,plan,plan_until,plan_note,referred_by,ref_paid,ref_code,ref_grant_plan,ref_grant_until,created_at&or=(referred_by.not.is.null,ref_grant_plan.not.is.null)&limit=1000');
    if(rq.ok && Array.isArray(rq.json)){
      const all = rq.json, ids = [...new Set(all.map(x => x.referred_by).filter(Boolean))], byId = {};
      let ref = []; if(ids.length){ const r2 = await api('/rest/v1/ttm_profiles?select=id,email,tg_handle,plan,plan_until,plan_note,ref_code,ref_grant_plan,ref_grant_until&id=in.(' + ids.join(',') + ')'); ref = r2.ok && Array.isArray(r2.json) ? r2.json : []; }
      ref.forEach(x => { byId[x.id] = x; }); const nm = x => (x.tg_handle ? '@' + String(x.tg_handle).replace(/^@/, '') : '') + (x.email ? (x.tg_handle ? ' · ' : '') + x.email : ''), nowD = Date.now();
      const act = x => x.ref_paid && (x.plan === 'premium' || x.plan === 'pro') && x.plan_until && new Date(x.plan_until) > nowD && /^USDT/.test(x.plan_note || '');
      const groups = ids.map(id => { const kids = all.filter(x => x.referred_by === id).sort((a, b) => (act(b) - act(a)) || (new Date(b.created_at) - new Date(a.created_at))); return {r: byId[id] || {id, email: '(unknown)'}, kids, paying: kids.filter(act).length, pro: kids.filter(x => act(x) && x.plan === 'pro').length}; }).sort((a, b) => b.paying - a.paying || b.kids.length - a.kids.length);
      const tot = all.filter(x => x.referred_by).length, totPay = groups.reduce((q, g) => q + g.paying, 0), rewarded = groups.filter(g => g.r.ref_grant_plan).length;
      const pill = (t, c) => `<span style="background:${c};border-radius:99px;padding:1px 8px;font-size:11px;font-weight:700">${t}</span>`;
      refHtml = `<div class="rr-card"><h3>Referrals: who referred who</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">${[['Referrers', groups.length], ['People referred', tot], ['Paying now', totPay], ['Rewards active', rewarded]].map(t => `<div style="background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:12px;padding:8px 14px;min-width:120px"><small style="color:var(--mute)">${t[0]}</small><div style="font-size:22px;font-weight:800">${t[1]}</div></div>`).join('')}</div>
        ${groups.length ? groups.map(g => `<details style="border:1px solid var(--line);border-radius:12px;margin-bottom:8px;padding:8px 12px"><summary style="cursor:pointer;display:flex;gap:10px;flex-wrap:wrap;align-items:center"><b>${e(nm(g.r))}</b> ${pill(e(g.r.plan || 'free'), 'rgba(255,255,255,.08)')} <span style="color:var(--mute);font-size:12px">code ${e(g.r.ref_code || '–')}</span><span style="margin-left:auto">${g.paying}/4 paying${g.pro ? ' · ' + g.pro + ' on Pro' : ''} · ${g.kids.length} joined</span>${g.r.ref_grant_plan ? pill('FREE ' + e(String(g.r.ref_grant_plan).toUpperCase()) + (g.r.ref_grant_until ? ' until ' + e(new Date(g.r.ref_grant_until).toLocaleDateString()) : ''), 'rgba(63,185,122,.22);color:#3fb97a') : ''}</summary>
          <div class="rr-wrap" style="margin-top:8px"><table class="rr-tbl"><thead><tr><th>Referred member</th><th>Plan</th><th>Paying</th><th>Plan ends</th><th>Joined</th></tr></thead><tbody>${g.kids.map(k => `<tr><td>${e(nm(k))}</td><td>${e(k.plan || 'free')}</td><td>${act(k) ? '✅ yes' : (k.plan === 'free' || !k.plan ? 'no (free)' : /^USDT/.test(k.plan_note || '') ? 'lapsed' : 'gifted, not counted')}</td><td>${k.plan_until ? e(new Date(k.plan_until).toLocaleDateString()) : '–'}</td><td>${e(new Date(k.created_at).toLocaleDateString())}</td></tr>`).join('')}</tbody></table></div></details>`).join('') : '<p class="calendar-note" style="margin:0">Nobody has joined through a referral link yet.</p>'}</div>`;
    } }catch(err){}
  const [pay, ord] = await Promise.all([api('/rest/v1/ttm_payments?select=*&order=seen_at.desc&limit=30'), api('/rest/v1/ttm_orders?select=id,user_id,plan,term,amount,status,created_at,paid_at&order=created_at.desc&limit=15')]);
  const un = (pay.json || []).filter(x => x.status === 'unmatched'), done = (pay.json || []).filter(x => x.status !== 'unmatched').slice(0, 8);
  const ends = sl.ends ? new Date(sl.ends) : null, loc = ends ? new Date(ends - ends.getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '', st = sl.starts ? new Date(sl.starts) : null, locS = st ? new Date(st - st.getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '', nowD = new Date(), sstat = !sl.on ? 'Off' : st && st > nowD ? 'Scheduled: starts ' + st.toLocaleString() : ends && ends < nowD ? 'Ended' : 'Live now';
  box.innerHTML = `<div class="rr-card"><h3>Billing</h3>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <label style="font-size:12px;color:var(--mute)">Premium / month (USDT)<br>${inp('bPrem', c.premium)}</label><label style="font-size:12px;color:var(--mute)">Pro / month (USDT)<br>${inp('bPro', c.pro)}</label><label style="font-size:12px;color:var(--mute)">Yearly = monthly ×<br>${inp('bYm', c.year_months, 70)}</label><label style="font-size:12px;color:var(--mute)">Order window (min)<br>${inp('bMin', c.order_minutes, 70)}</label></div>
    <label style="font-size:12px;color:var(--mute)">USDT (TRC20) deposit address<br>${inp('bAddr', c.address, 380)}</label>
    <h3 style="margin:16px 0 8px;font-size:15px">TTM LENS access</h3>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end"><label style="font-size:12px;color:var(--mute)">Standard / year (USDT)<br>${inp('bLPrice', c.lens_price == null ? 500 : c.lens_price, 90)}</label><label style="font-size:12px;color:var(--mute)">Premium members / year<br>${inp('bLPrem', c.lens_price_premium == null ? 350 : c.lens_price_premium, 90)}</label><label style="font-size:12px;color:var(--mute)">Pro members / year<br>${inp('bLPro', c.lens_price_pro == null ? 200 : c.lens_price_pro, 90)}</label></div><p class="calendar-note" style="margin:6px 0 0">Members who buy a LENS pass get LENS for 12 months. Premium and Pro members see their own lower price; Free members only see the standard price.</p>
    <h3 style="margin:16px 0 8px;font-size:15px">Sale <span style="font-size:12px;font-weight:600;color:var(--gold2);margin-left:6px">${e(sstat)}</span></h3>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end"><label style="font-size:12px;color:var(--mute)">Name (shown on the banner)<br>${inp('bSName', sl.name, 190)}</label><label style="font-size:12px;color:var(--mute)">% off<br>${inp('bSPct', sl.pct, 60)}</label><label style="font-size:12px;color:var(--mute)">Starts (your time, leave empty = now)<br><input id="bSStart" type="datetime-local" value="${locS}" style="background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 9px;font:inherit"></label><label style="font-size:12px;color:var(--mute)">Ends (your time)<br><input id="bSEnd" type="datetime-local" value="${loc}" style="background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 9px;font:inherit"></label><label style="display:flex;gap:6px;align-items:center;font-size:14px"><input type="checkbox" id="bSOn" ${sl.on ? 'checked' : ''} style="width:auto"> <b>Sale is on</b></label></div>
    <div class="rr-acts" style="margin-top:14px"><button class="rr-btn" id="bSave">Save billing</button><span id="bMsg" class="calendar-note"></span></div>
    <div class="calendar-note" style="margin-top:8px">Tick Sale is on and set a start to schedule it in advance: nothing shows until the start time, then the banner and prices switch on by themselves, and switch off at the end. Sale prices apply to monthly and yearly. Members always pay the sale price shown on the Pay screen minus a few cents (that is how we tell payments apart), never more.</div></div>
    ${refHtml}
    <div class="rr-card"><h3>Unmatched USDT payments (${un.length})</h3>${un.length ? `<div class="rr-wrap"><table class="rr-tbl"><thead><tr><th>When</th><th>Amount</th><th>From</th><th>Give to member</th><th></th></tr></thead><tbody>${un.map(x => `<tr><td>${e(new Date(x.tx_time).toLocaleString())}</td><td><b>${money(x.amount)}</b></td><td style="font-size:11px;word-break:break-all">${e(String(x.from_addr || '').slice(0, 12))}…</td><td><input data-ae="${e(x.txid)}" placeholder="member email" style="width:170px;background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:6px 8px;font:inherit"> <select data-ap2="${e(x.txid)}"><option value="premium">Premium</option><option value="pro">Pro</option></select> <select data-at2="${e(x.txid)}"><option value="month">Monthly</option><option value="year">Yearly</option></select></td><td><button class="rr-btn sm" data-aas="${e(x.txid)}">Give access</button> <button class="rr-btn sm ghost" data-aig="${e(x.txid)}">Ignore</button></td></tr>`).join('')}</tbody></table></div>` : '<p style="margin:0;color:var(--mute)">None. Every deposit so far matched an order.</p>'}</div>
    <div class="rr-card"><h3>Recent orders and deposits</h3><div class="rr-wrap"><table class="rr-tbl"><thead><tr><th>Created</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead><tbody>${(ord.json || []).map(x => `<tr><td>${e(new Date(x.created_at).toLocaleString())}</td><td>${e(pname(x.plan))} · ${x.term === 'year' ? 'yearly' : 'monthly'}</td><td>${money(x.amount)}</td><td>${e(x.status)}</td></tr>`).join('') || '<tr><td colspan="4" style="color:var(--mute)">No orders yet.</td></tr>'}</tbody></table></div>${done.length ? `<div class="calendar-note" style="margin-top:8px">Latest deposits: ${done.map(x => `${money(x.amount)} (${e(x.status)})`).join(' · ')}</div>` : ''}</div>`;
}
document.addEventListener('click', async ev => {
  const t = ev.target.closest && ev.target.closest('#bSave,[data-aas],[data-aig],#lensImp,[data-lens]'); if(!t) return;
  if(t.id === 'lensImp'){ const rows = ($('lensCsv').value || '').split(/\r?\n/).map(l => l.split(/[,;\t]/).map(z => z.trim())).filter(a => a[0] && /\d/.test(a[0])).map(a => ({uid: a[0], volume: parseFloat(String(a[1] || '0').replace(/[^0-9.\-]/g, '')) || 0})); if(!rows.length){ $('lensImpMsg').textContent = 'Nothing to import.'; return; } t.disabled = true; const r = await api('/rest/v1/rpc/ttm_lens_import', {method: 'POST', body: JSON.stringify({p_rows: rows})}); t.disabled = false; $('lensImpMsg').textContent = r.ok ? 'Imported ' + r.json.imported + ' rows. Newly switched on: ' + r.json.approved + '.' : ((r.json && r.json.message) || 'Could not import. Run supabase/payments.sql first.'); if(r.ok) setTimeout(billAdminLoad, 1500); return; }
  if(t.dataset.lens){ const [a, id] = t.dataset.lens.split(':'); const r = await api('/rest/v1/rpc/ttm_lens_admin', {method: 'POST', body: JSON.stringify({p_user: id, p_action: a})}); if(r.ok) billAdminLoad(); else alert((r.json && r.json.message) || 'Could not update.'); return; }
  if(t.id === 'bSave'){
    const v = id => $(id).value.trim(), num = (id, d) => { const n = parseFloat(v(id)); return isFinite(n) ? n : d; };
    const cfg = Object.assign({}, BILL || {}, {lens_price: num('bLPrice', 500), lens_price_premium: num('bLPrem', 350), lens_price_pro: num('bLPro', 200)}, {premium: num('bPrem', 19.95), pro: num('bPro', 65), year_months: num('bYm', 10), order_minutes: Math.max(15, Math.round(num('bMin', 60))), address: v('bAddr'), sale: {on: $('bSOn').checked, name: v('bSName'), pct: Math.min(90, Math.max(0, num('bSPct', 0))), starts: $('bSStart').value ? new Date($('bSStart').value).toISOString() : null, ends: $('bSEnd').value ? new Date($('bSEnd').value).toISOString() : null}});
    if(cfg.sale.starts && cfg.sale.ends && new Date(cfg.sale.ends) <= new Date(cfg.sale.starts)){ $('bMsg').textContent = 'The end must be after the start.'; return; }
    if(!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(cfg.address)){ $('bMsg').textContent = 'That does not look like a TRON address (starts with T, 34 characters).'; return; }
    const r = await api('/rest/v1/ttm_billing?id=eq.main', {method: 'PATCH', body: JSON.stringify({cfg, updated_at: new Date().toISOString()})}); $('bMsg').textContent = r.ok ? 'Saved.' : 'Could not save.'; if(r.ok){ BILL = cfg; try{ saleBanner(); }catch(err){} }
  } else if(t.dataset.aas){
    const id = t.dataset.aas, em = document.querySelector(`[data-ae="${id}"]`).value.trim(); if(!em){ alert('Type the member email first.'); return; }
    const r = await api('/rest/v1/rpc/ttm_admin_assign_payment', {method: 'POST', body: JSON.stringify({p_txid: id, p_email: em, p_plan: document.querySelector(`[data-ap2="${id}"]`).value, p_term: document.querySelector(`[data-at2="${id}"]`).value})});
    if(!r.ok){ alert((r.json && r.json.message) || 'Could not assign.'); return; } billAdminLoad();
  } else if(t.dataset.aig){ const r = await api('/rest/v1/rpc/ttm_admin_ignore_payment', {method: 'POST', body: JSON.stringify({p_txid: t.dataset.aig})}); if(r.ok) billAdminLoad(); }
});

// ---------- X name (stored in the tg_handle column)
const FBSQL = `-- TTM: Telegram name on accounts + beta tester feedback. Safe to run more than once.

-- 1. Telegram name on each profile (people set it through a function, never directly)
alter table public.ttm_profiles add column if not exists tg_handle text;

create or replace function public.ttm_set_tg(p_handle text) returns void
language sql security definer set search_path = public as $$
  update public.ttm_profiles
     set tg_handle = nullif(left(regexp_replace(coalesce(p_handle,''), '[^A-Za-z0-9_]', '', 'g'), 32), '')
   where id = auth.uid();
$$;
grant execute on function public.ttm_set_tg(text) to authenticated;

-- 2. Beta testers (profiles with beta = true) and admins
alter table public.ttm_profiles add column if not exists beta boolean not null default false;

create or replace function public.ttm_is_tester() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select beta or is_admin from public.ttm_profiles where id = auth.uid()), false)
$$;
grant execute on function public.ttm_is_tester() to authenticated;

-- 3. Feedback from beta sections: message, read tick and reply from you
create table if not exists public.ttm_feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  section     text not null,
  who         text,
  message     text not null check (char_length(message) between 1 and 4000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  reply       text,
  replied_at  timestamptz
);
create index if not exists ttm_feedback_section_idx on public.ttm_feedback (section, created_at);
alter table public.ttm_feedback enable row level security;

drop policy if exists p_fb_sel on public.ttm_feedback;
create policy p_fb_sel on public.ttm_feedback for select
  using (user_id = auth.uid() or public.ttm_is_tester());
drop policy if exists p_fb_ins on public.ttm_feedback;
create policy p_fb_ins on public.ttm_feedback for insert
  with check (user_id = auth.uid() and public.ttm_is_tester());
drop policy if exists p_fb_upd on public.ttm_feedback;
create policy p_fb_upd on public.ttm_feedback for update
  using (public.ttm_is_admin()) with check (public.ttm_is_admin());
drop policy if exists p_fb_del on public.ttm_feedback;
create policy p_fb_del on public.ttm_feedback for delete
  using (public.ttm_is_admin());

grant select, insert, update, delete on public.ttm_feedback to authenticated;
`;
const tgGen = () => { const A = ['Swift','Bold','Lucky','Calm','Sharp','Quiet','Steady','Brave','Clever','Rapid'], B = ['Bull','Falcon','Whale','Wolf','Hawk','Tiger','Otter','Fox','Eagle','Shark']; return A[Math.floor(Math.random() * A.length)] + B[Math.floor(Math.random() * B.length)] + (100 + Math.floor(Math.random() * 900)); };
const tgPick = v => { const h = tgClean(v); return h || tgGen(); };
const tgTTM = v => /ttm/.test(String(v || '').toLowerCase().replace(/[^a-z]/g, ''));
const refKeep = () => { try{ const v = String(($('authRef') || {}).value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); if(v) localStorage.setItem('ttm_ref', v); }catch(err){} };
const tgClean = v => String(v || '').trim().replace(/^@+/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 32);
let TGERR = '';
async function tgSave(h){ TGERR = ''; if(h && tgTTM(h) && !(PROF && PROF.is_admin) && !(USER && /^gro-coaching@outlook\.com$/i.test(USER.email || ''))){ TGERR = 'Names with TTM in them are kept for the TTM team. Please pick another name.'; return false; } const r = await api('/rest/v1/rpc/ttm_set_tg', {method: 'POST', body: JSON.stringify({p_handle: h})}); if(r.ok && PROF) PROF.tg_handle = h || null;
  if(!r.ok){ const m = JSON.stringify(r.json || ''); TGERR = /name_ttm/.test(m) ? 'Names with TTM in them are kept for the TTM team. Please pick another name.' : /name_taken/.test(m) ? 'That name is already taken. Please pick another one.' : ''; }
  return r.ok; }
async function tgInit(){
  if(!USER || !PROF || !('tg_handle' in PROF) || PROF.tg_handle) return;
  const pend = ls('ttm_tg_pending', ''); if(pend){ const okp = await tgSave(pend); if(okp){ try{ localStorage.removeItem('ttm_tg_pending'); }catch(err){} ui(); return; } if(!TGERR) return; try{ localStorage.removeItem('ttm_tg_pending'); }catch(err){}
    openAuth(`<p style="margin:0 0 10px"><b>${e(TGERR)}</b></p><input id="authTgIn" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="@yourXname"><div class="row"><button class="ttm-btn" id="tgSaveBtn">Save</button><button class="ttm-btn ghost" id="tgGenBtn">Create one for me</button><button class="ttm-btn ghost" id="tgSkipBtn">Not now</button></div><p id="authNote" style="margin:12px 0 0"></p>`); return; }
  if(ls('ttm_tg_skip', 0) || PROF.is_admin) return;
  openAuth(`<p style="margin:0 0 10px">Add your <b>X name</b> so we know who you are (no X? press Create one for me). It shows at the top right instead of "Account". Your email stays private.</p><input id="authTgIn" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="@yourXname"><div class="row"><button class="ttm-btn" id="tgSaveBtn">Save</button><button class="ttm-btn ghost" id="tgGenBtn">Create one for me</button><button class="ttm-btn ghost" id="tgSkipBtn">Not now</button></div><p id="authNote" style="margin:12px 0 0"><small>You can change it any time in your Account card.</small></p>`);
}
document.addEventListener('click', async ev => { const t = ev.target; if(!t || !t.id) return;
  if(t.id === 'tgGenBtn'){ const i = $('authTgIn'); if(i) i.value = tgGen(); }
  else if(t.id === 'tgSkipBtn'){ lw('ttm_tg_skip', Date.now()); closeAuth(); }
  else if(t.id === 'tgSaveBtn'){ const h = tgClean(($('authTgIn') || {}).value); if(!h){ $('authNote').textContent = 'Type your X name, press Create one for me, or press Not now.'; return; } t.disabled = true; if(await tgSave(h)){ closeAuth(); ui(); } else { t.disabled = false; $('authNote').textContent = TGERR || 'Could not save it yet. The database step is missing; ask TTM.'; } }
  else if(t.id === 'memPush'){ const n = $('memPushNote'); t.disabled = true; n.textContent = 'Working…'; const was = t.textContent === 'Turn off'; let er = ''; try{ if(was) await pushOff(); else er = await pushOn(); }catch(err){ er = 'Could not set up alerts on this device.'; } t.disabled = false; if(er){ n.textContent = er; } else { t.textContent = was ? 'Turn on' : 'Turn off'; n.textContent = was ? 'Off.' : 'On for this phone.'; } }
  else if(t.id === 'memTgSave'){ const h = tgClean(($('memTgIn') || {}).value), n = $('memTgNote'); n.textContent = 'Saving…'; if(await tgSave(h)){ n.textContent = 'Saved.'; ui(); } else n.textContent = TGERR || 'Could not save.'; }
});

// ---------- beta sections: badge for testers, feedback thread, admin inbox
let FB = {rows: [], at: 0, err: false};
const FBL = k => { const c = CAT.find(x => x[0] === k); return c ? c[1] : k; };
const isTester = () => !!(USER && PROF && (PROF.beta || PROF.team || PROF.is_admin));
const betaKey = key => { const a = SET.access[key]; if(!(on() && SET.charging && a && a.indexOf('beta') >= 0)) return false; if(PROF && PROF.is_admin) return true; return !!(PROF && PROF.beta && a.indexOf(PROF.plan) < 0 && a.indexOf('free') < 0); };
async function fbLoad(force){
  if(!isTester() || !on()) return; if(!force && Date.now() - FB.at < 20000) return; FB.at = Date.now();
  const r = await api('/rest/v1/ttm_feedback?select=*&order=created_at.asc&limit=1000');
  if(r.ok && Array.isArray(r.json)){ FB.rows = r.json; FB.err = false; } else FB.err = PROF && PROF.is_admin;
  fbPaint();
}
const fbDate = d => new Date(d).toLocaleString([], {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
function fbThread(key){
  const rows = FB.rows.filter(r => r.section === key);
  return rows.length ? rows.map(r => `<div class="fb-m"><div class="fb-h"><b>${e(r.who || 'Tester')}</b> · ${fbDate(r.created_at)}${USER && r.user_id === USER.id ? ' · <span style="color:var(--gold2)">you</span>' : ''}${r.read_at ? ' · <span style="color:#3fb47a">✓ read by TTM</span>' : ''}</div><div>${e(r.message)}</div>${r.reply ? `<div class="fb-r"><div class="fb-h"><b style="color:var(--gold2)">TTM replied</b> · ${fbDate(r.replied_at || r.created_at)}</div><div>${e(r.reply)}</div></div>` : ''}</div>`).join('') : '<p class="calendar-note" style="margin:0 0 10px">No feedback yet. Be the first.</p>';
}
function fbPaint(){
  document.querySelectorAll('.beta-fb').forEach(b => { const key = b.dataset.fbk, box = b.querySelector('.fb-list'); if(box){ box.innerHTML = fbThread(key); box.scrollTop = box.scrollHeight; } });
  const ad = $('fbAdmin'); if(ad && !Array.from(ad.querySelectorAll('[data-fbrt]')).some(i => i.value)) ad.outerHTML = fbAdminHtml();
}
function betaMark(sec, key, wrap, show){
  let bd = sec.querySelector('.beta-badge'), pn = wrap.querySelector(':scope > .beta-fb');
  document.querySelectorAll(`a[href="#${sec.id}"]`).forEach(a => { if(show) a.setAttribute('data-bt', '1'); else a.removeAttribute('data-bt'); });
  if(!show){ if(bd) bd.remove(); if(pn) pn.remove(); return; }
  if(!bd){ const tg = sec.querySelector('.tag'); if(tg){ bd = document.createElement('span'); bd.className = 'beta-badge'; bd.textContent = 'BETA'; tg.insertAdjacentElement('afterend', bd); } }
  if(!pn){ pn = document.createElement('div'); pn.className = 'beta-fb'; pn.dataset.fbk = key; const title = (sec.querySelector('.tag') || sec.querySelector('h2') || {}).textContent || 'This section';
    pn.innerHTML = `<h3>Beta feedback</h3><p class="calendar-note" style="margin:0 0 10px">${e(title)} is in beta testing. Tell TTM what works, what breaks and what you would change. Everyone testing this section can see this thread, and TTM's replies show here.</p><div class="fb-list"></div><textarea class="fb-in" rows="3" maxlength="4000" placeholder="Your feedback…"></textarea><div class="rr-acts" style="margin:8px 0 0;align-items:center"><button class="rr-btn sm" data-fbsend="${e(key)}">Send feedback</button><span class="calendar-note fb-note"></span></div>`; wrap.appendChild(pn); fbPaint(); fbLoad(false); }
}
function fbAdminHtml(){
  const rows = FB.rows.slice().reverse(), un = rows.filter(r => !r.read_at).length;
  return `<div class="rr-card" id="fbAdmin"><h3>Beta feedback ${un ? `<span class="rr-pill open">${un} unread</span>` : ''}</h3>${FB.err ? '<p class="calendar-note" style="margin:0">Feedback is not set up yet; run the database step below.</p>' : !rows.length ? '<p class="calendar-note" style="margin:0">Nothing yet. When a beta tester sends feedback from a beta section it appears here.</p>' : rows.map(r => `<div class="fb-m"><div class="fb-h"><b>${e(r.who || 'Tester')}</b> · ${e(FBL(r.section))} · ${fbDate(r.created_at)} <label style="margin-left:8px;cursor:pointer"><input type="checkbox" data-fbread="${r.id}" ${r.read_at ? 'checked' : ''} style="width:auto"> read</label> <button class="rr-btn ghost sm" data-fbdel="${r.id}" style="padding:2px 8px;border-color:#e0554d;color:#e0554d">Delete</button></div><div>${e(r.message)}</div>${r.reply ? `<div class="fb-r"><div class="fb-h"><b style="color:var(--gold2)">Your reply</b> · ${fbDate(r.replied_at || r.created_at)}</div><div>${e(r.reply)}</div></div>` : ''}<div style="display:flex;gap:8px;margin-top:8px"><input data-fbrt="${r.id}" placeholder="${r.reply ? 'Change your reply…' : 'Reply to this tester…'}" style="flex:1;background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 10px;font:inherit"><button class="rr-btn sm" data-fbreply="${r.id}">Reply</button></div></div>`).join('')}</div>`;
}
document.addEventListener('click', async ev => { const t = ev.target.closest ? ev.target.closest('button') : null; if(!t || !t.dataset) return;
  if(t.dataset.fbsend){ const box = t.closest('.beta-fb'), ta = box.querySelector('.fb-in'), n = box.querySelector('.fb-note'), msg = ta.value.trim(); if(!msg){ n.textContent = 'Write something first.'; return; }
    t.disabled = true; n.textContent = 'Sending…'; const r = await api('/rest/v1/ttm_feedback', {method: 'POST', headers: {Prefer: 'return=minimal'}, body: JSON.stringify({user_id: USER.id, section: t.dataset.fbsend, who: PROF.tg_handle ? '@' + PROF.tg_handle : 'Tester', message: msg.slice(0, 4000)})}); t.disabled = false;
    if(r.ok){ ta.value = ''; n.textContent = 'Sent, thank you.'; track('feat', 'beta_feedback'); await fbLoad(true); } else n.textContent = 'Could not send. TTM needs to run the beta database step first.'; }
  else if(t.dataset.fbreply){ const inp = document.querySelector(`[data-fbrt="${t.dataset.fbreply}"]`), v = inp.value.trim(); if(!v) return; t.disabled = true;
    const r = await api(`/rest/v1/ttm_feedback?id=eq.${t.dataset.fbreply}`, {method: 'PATCH', body: JSON.stringify({reply: v.slice(0, 4000), replied_at: new Date().toISOString(), read_at: new Date().toISOString()})}); if(r.ok) await fbLoad(true); else { t.disabled = false; alert('Could not save the reply.'); } }
  else if(t.dataset.fbdel){ if(!confirm('Delete this feedback?')) return; const r = await api(`/rest/v1/ttm_feedback?id=eq.${t.dataset.fbdel}`, {method: 'DELETE'}); if(r.ok) await fbLoad(true); }
});
document.addEventListener('change', async ev => { const t = ev.target; if(!t.dataset || !t.dataset.fbread) return;
  const r = await api(`/rest/v1/ttm_feedback?id=eq.${t.dataset.fbread}`, {method: 'PATCH', body: JSON.stringify({read_at: t.checked ? new Date().toISOString() : null})}); if(!r.ok){ t.checked = !t.checked; alert('Could not save.'); } else { const row = FB.rows.find(x => String(x.id) === t.dataset.fbread); if(row) row.read_at = t.checked ? new Date().toISOString() : null; } });
async function adminUi(){ await fbLoad(true);
  const a = $('admBody'); if(!a || !$('admin').classList.contains('active')) return;
  if(!PROF || !PROF.is_admin){ a.innerHTML = '<div class="rr-card"><p style="margin:0">Admins only.</p></div>'; return; }
  let r = await api('/rest/v1/ttm_profiles?select=id,email,plan,is_admin,created_at,plan_until,plan_note,beta,team,tg_handle,badges&order=created_at.desc&limit=500'); const hasTeam = r.ok; ADMB = {}; if(r.ok) (r.json || []).forEach(u => { ADMB[u.id] = u.badges || []; }); if(!r.ok) r = await api('/rest/v1/ttm_profiles?select=id,email,plan,is_admin,created_at,plan_until,plan_note,beta,tg_handle&order=created_at.desc&limit=500'); let noTg = false; if(!r.ok){ noTg = true; r = await api('/rest/v1/ttm_profiles?select=id,email,plan,is_admin,created_at,plan_until,plan_note,beta&order=created_at.desc&limit=500'); } let noBeta = false; if(!r.ok){ noBeta = true; r = await api('/rest/v1/ttm_profiles?select=id,email,plan,is_admin,created_at,plan_until,plan_note&order=created_at.desc&limit=500'); } let noTrials = false; if(!r.ok){ noTrials = true; r = await api('/rest/v1/ttm_profiles?select=id,email,plan,is_admin,created_at&order=created_at.desc&limit=500'); } const users = (r.ok && Array.isArray(r.json)) ? r.json : [];
  const sel = (attr, v) => `<select ${attr} style="background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 9px;font:inherit">${PLANS.map(p => `<option value="${p[0]}" ${p[0] === v ? 'selected' : ''}>${p[1]}</option>`).join('')}</select>`;
  const cell = (k, p) => `<td style="text-align:center"><input type="checkbox" data-ak="${k}" data-ap="${p}" ${(SET.access[k] || []).indexOf(p) >= 0 ? 'checked' : ''}></td>`;
  a.innerHTML = `<div class="rr-card"><h3>Switches</h3>
    <label style="display:flex;gap:10px;align-items:center;font-size:14px;margin-bottom:8px"><input type="checkbox" id="admCharge" ${SET.charging ? 'checked' : ''} style="width:auto"> <span><b>Plans on.</b> When off, every section and feature is open to everyone.</span></label>
    <label style="display:flex;gap:10px;align-items:center;font-size:14px;margin-bottom:8px"><input type="checkbox" id="admTrack" ${SET.track ? 'checked' : ''} style="width:auto"> <span><b>Collect usage data.</b> Untick to pause all tracking instantly (also blocks the database from accepting new events).</span></label>
    <label style="display:flex;gap:10px;align-items:center;font-size:14px"><input type="checkbox" id="admWall" ${SET.wall ? 'checked' : ''} style="width:auto"> <span><b>Require sign-in.</b> Visitors must sign in before anything opens (only applies when plans are on).</span></label></div>
    <div class="rr-card"><h3>What each plan sees</h3><div class="rr-wrap"><table class="rr-tbl"><thead><tr><th>Section or feature</th>${GRID.map(p => `<th style="text-align:center">${p[1]}</th>`).join('')}</tr></thead><tbody>${CAT.map(c => `<tr><td>${e(c[1])}</td>${GRID.map(p => cell(c[0], p[0])).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="rr-acts"><button class="rr-btn sm" id="admSaveSet">Save</button><button class="rr-btn ghost sm" id="admReset">Reset to the planned defaults</button></div><p class="calendar-note" id="admNote" style="margin:8px 0 0">Tick a box to give that plan the section; untick everywhere to switch it off until it is ready (you, as admin, still see everything). Ticking Free also ticks Premium and Pro, and ticking Premium also ticks Pro; unticking Pro unticks the others. Beta testers: tick a section under Beta to open it only for members you mark as beta testers (below), whatever their plan. Free means open to everyone, signed in or not. Locks work in the browser, so they hide and block what the page shows; the site is static and its code and data files are public, so real protection for paid content needs that content moved behind the backend. Prices are set in ttm_config.json.</p></div>
    ${noTrials || noBeta ? `<div class="rr-warn y"><b>One database step is missing.</b> In Supabase open SQL Editor, New query, paste the line below and press Run, then refresh this page. ${noTrials ? 'It adds the plan end date and the beta switch.' : 'It adds the beta switch.'}<pre style="white-space:pre-wrap;margin:8px 0 0;user-select:all">alter table public.ttm_profiles add column if not exists plan_until timestamptz, add column if not exists plan_note text, add column if not exists beta boolean not null default false;</pre></div>` : ''}
    <div class="rr-card"><h3>Give people a plan for a limited time</h3><p class="calendar-note" style="margin:0 0 10px">For giveaways, trials or "paid until" dates. Paste the emails of people who have already created an account (one per line). When the time is up they go back to Free on their own. If they pay, set their plan from the Members table below to remove the end date.</p>
      <textarea id="grEmails" rows="4" placeholder="winner1@example.com&#10;winner2@example.com" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:9px 10px;font:inherit"></textarea>
      <div class="rr-acts" style="margin:10px 0 0;align-items:center">${sel('id="grPlan"', 'pro')}<select id="grDays" style="background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 9px;font:inherit">${[7, 14, 30, 60, 90, 365].map(d => `<option value="${d}" ${d === 30 ? 'selected' : ''}>${d} days</option>`).join('')}</select><input id="grNote" value="giveaway" maxlength="20" style="width:120px;background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 9px;font:inherit" title="A label shown next to the end date"><button class="rr-btn sm" id="grGo">Grant access</button><button class="rr-btn ghost sm" id="grExpire">Revert expired now</button><button class="rr-btn ghost sm" id="grBeta">Make beta testers</button><button class="rr-btn ghost sm" id="grBetaOff">Remove beta</button></div>
      <p class="calendar-note" id="grNote2" style="margin:8px 0 0"></p></div>
    ${noTg || FB.err ? `<div class="rr-warn y"><b>One database step is missing.</b> In Supabase open SQL Editor, New query, paste this and press Run, then refresh. It adds the Telegram name and the beta feedback box.<pre style="white-space:pre-wrap;margin:8px 0 0;user-select:all;max-height:240px;overflow:auto">${e(FBSQL)}</pre></div>` : ''}
    ${lvAdminHtml()}
    ${rmAdminHtml()}
    ${discAdminHtml()}
    ${fbAdminHtml()}
    <div class="rr-card"><h3>Founding Member badge</h3><p class="calendar-note" style="margin:0 0 10px">Gives the <b>Founding Member</b> badge to the first people who signed up. Use the Badges buttons on a member below to add or remove any badge one by one. The TTM badge is automatic for admins.</p><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span>First</span><input id="bdgN" type="number" min="1" value="100" style="width:90px"><span>sign-ups</span><button class="rr-btn sm" id="bdgFound">Give Founding Member</button></div><p class="calendar-note" id="bdgNote" style="margin:8px 0 0"></p></div>
    <div class="rr-card"><h3>Members (${users.length})</h3><div class="rr-wrap"><table class="rr-tbl"><thead><tr><th>Email</th><th>X name</th><th>Joined</th><th>Plan</th><th>Until</th><th>Beta</th><th title="Your own team">Team</th><th title="Shown next to their name in the chat rooms">Badges</th><th></th></tr></thead><tbody>${users.map(u => `<tr><td>${e(u.email)}${u.is_admin ? ' <span class="rr-pill be">admin</span>' : ''}</td><td>${u.tg_handle ? '@' + e(u.tg_handle) : '<span class="ins-sub">—</span>'}</td><td>${new Date(u.created_at).toLocaleDateString()}</td><td>${sel('data-uid="' + u.id + '"', normPlan(u.plan))}</td><td style="white-space:nowrap">${u.plan_until ? (new Date(u.plan_until) < new Date() ? '<span style="color:#e0554d">ended ' : '<span style="color:var(--gold2)">') + new Date(u.plan_until).toLocaleDateString(undefined, {day: 'numeric', month: 'short'}) + '</span>' + (u.plan_note ? ' <span class="ins-sub">' + e(u.plan_note) + '</span>' : '') : '<span class="ins-sub">no end</span>'}</td><td style="text-align:center"><input type="checkbox" data-beta="${u.id}" ${u.beta ? 'checked' : ''}></td><td style="text-align:center"><input type="checkbox" data-team="${u.id}" ${u.team ? 'checked' : ''}></td><td style="min-width:210px">${u.is_admin ? '<span class="rr-pill be">TTM</span> ' : ''}${BDG.map(b => `<button type="button" class="bdg-chip ${(u.badges || []).indexOf(b[0]) >= 0 ? 'on' : ''}" data-bu="${u.id}" data-bk="${b[0]}" ${hasTeam ? '' : 'disabled title="Run supabase/badges2.sql first"'}>${b[2]}</button>`).join('')}</td><td>${USER && u.id === USER.id ? '' : `<button class="rr-btn ghost sm" data-delu="${e(u.id)}" data-em="${e(u.email)}" style="border-color:#e0554d;color:#e0554d">Delete</button>`}</td></tr>`).join('') || '<tr><td colspan="8" style="color:var(--mute)">No members yet.</td></tr>'}</tbody></table></div></div>
    <div class="rr-card"><h3>Usage insights</h3><p class="calendar-note" style="margin:0 0 10px">An executive summary of what people open and click: trends against the previous period, what is useful and what is not, where visitors are, and charts you can click into.</p><a class="rr-btn" style="text-decoration:none;display:inline-block" href="#insights">Open Insights →</a></div>`;
  lvLoad(); rmMutesLoad(); discAdminLoad(); billAdminLoad();
}

// ---------- Insights page (admin only): #insights
let INS = {days: '7', data: null, busy: false, detail: null};
const BTN = {rrOpen: 'Open trade', rrSave: 'Save as plan', rrXlsx: 'Download Excel', jXlsx: 'Download Excel (tracker)', rrLive: 'Use live price as entry', rrExport: 'Backup JSON', rrImportBtn: 'Restore JSON', tgSave: 'Telegram save', tgTest: 'Telegram test', bhTab: 'Bias history tab', rrConfirm: 'Confirm trade result', acctBtn: 'Sign in / account button', admSaveSet: 'Admin save', rrCopy: 'Copy order ticket'};
function uLabel(tg){
  const i = String(tg).indexOf('|'), pg = i > 0 ? tg.slice(0, i) : '', th = i > 0 ? tg.slice(i + 1) : tg, P = {crypto: 'Crypto', tradfi: 'TradFi', home: 'Home'}[pg] || pg;
  let name = th; const cat = CAT.find(c => c[0] === (pg === 'tradfi' ? 't:' : 'c:') + th); if(cat) name = cat[1].replace(/^(Crypto|TradFi) · /, ''); else if(BTN[th]) name = BTN[th]; else if(th === 'menu') name = 'Terminal menu'; else if(th === 'home') name = 'Front page'; else if(th.indexOf('feat:') === 0){ const c2 = CAT.find(c => c[0] === th.slice(5)); name = 'Locked feature: ' + (c2 ? c2[1] : th.slice(5)); }
  return e(name) + (P ? ` <span style="color:var(--mute);font-size:11px">${e(P)}</span>` : '');
}
function regionOf(tz){
  tz = String(tz || ''); if(!tz || tz === 'unknown') return 'Unknown';
  if(/^(Australia|Pacific\/(Auckland|Chatham|Fiji))/.test(tz)) return 'Australia & NZ';
  if(/^Europe\/(London|Dublin|Belfast|Jersey|Guernsey|Isle_of_Man)|^GB$/.test(tz)) return 'UK & Ireland';
  if(/^(Europe|Atlantic\/(Reykjavik|Azores|Madeira|Faroe|Canary))/.test(tz)) return tz === 'Europe/Istanbul' ? 'Middle East' : 'Europe';
  if(/^America\/(Sao_Paulo|Argentina|Buenos_Aires|Bogota|Lima|Santiago|Caracas|Montevideo|Asuncion|La_Paz|Guayaquil|Mexico_City|Panama|Costa_Rica|Guatemala|El_Salvador|Havana|Santo_Domingo|Puerto_Rico|Bahia|Fortaleza|Manaus|Recife)/.test(tz)) return 'Latin America';
  if(/^(America|US|Canada|Pacific\/Honolulu)/.test(tz)) return 'US & Canada';
  if(/^Asia\/(Dubai|Riyadh|Tehran|Qatar|Kuwait|Baghdad|Jerusalem|Tel_Aviv|Beirut|Amman|Muscat|Bahrain|Baku|Tbilisi|Yerevan)/.test(tz)) return 'Middle East';
  if(/^Asia\/(Kolkata|Calcutta|Colombo|Karachi|Dhaka|Kathmandu)/.test(tz)) return 'India & South Asia';
  if(/^(Asia|Indian)/.test(tz)) return 'Asia';
  if(/^Africa/.test(tz)) return 'Africa';
  return 'Other';
}
const uPct = (a, b) => b ? Math.round(a / b * 100) : 0;
const uDur = s => s == null ? '—' : s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's';
const uChg = (c, p, prevOn) => { if(!prevOn) return ''; c = +c || 0; p = +p || 0; if(!p && !c) return '<span class="ins-chg">–</span>'; if(!p) return '<span class="ins-chg up">new</span>'; const x = Math.round((c - p) / p * 100); return `<span class="ins-chg ${x > 2 ? 'up' : x < -2 ? 'dn' : ''}">${x > 0 ? '▲' : x < 0 ? '▼' : '='} ${Math.abs(x)}%</span>`; };
const uMap = (rows, key) => { const m = {}; (rows || []).forEach(r => { m[r[key || 'tg']] = r; }); return m; };
function uRows(rows, key, ev, prev, prevOn, fmt, limit){
  rows = (rows || []).slice(0, limit || 12); if(!rows.length) return '<p class="calendar-note" style="margin:0">Nothing yet.</p>';
  const mx = Math.max(1, ...rows.map(r => +r[key] || 0)), pm = uMap(prev);
  return '<div class="rr-wrap"><table class="rr-tbl"><tbody>' + rows.map(r => `<tr ${ev ? `class="ins-row" data-dev="${ev}" data-dtg="${e(r.tg)}" title="Click for the detail"` : ''}><td>${fmt ? fmt(r) : uLabel(r.tg)}</td><td style="width:34%"><div class="ins-bar"><div style="width:${Math.round((+r[key] || 0) / mx * 100)}%"></div></div></td><td style="text-align:right;white-space:nowrap"><b>${(+r[key] || 0).toLocaleString()}</b>${r.visitors != null ? ` <span class="ins-sub">· ${r.visitors} ${r.visitors == 1 ? 'person' : 'people'}</span>` : ''}</td><td style="text-align:right;white-space:nowrap">${uChg(r[key], pm[r.tg] && pm[r.tg][key], prevOn)}</td></tr>`).join('') + '</tbody></table></div>';
}
function uDaily(d, hourly){
  if(!d.length) return '<p class="calendar-note" style="margin:0">No visits in this range yet.</p>';
  const W = 760, H = 160, pl = 30, n = d.length, bw = Math.max(3, Math.min(26, (W - pl) / n - 3)), mx = Math.max(1, ...d.map(x => x.visitors)), step = (W - pl) / n;
  const lab = x => x.day.length > 10 ? x.day.slice(11) + 'h' : x.day.slice(5);
  let g = `<line x1="${pl}" y1="${H - 18}" x2="${W}" y2="${H - 18}" stroke="#2a2a2e"/><text x="2" y="12" font-size="10" fill="#9a978f">${mx}</text>`;
  d.forEach((x, i) => { const h = Math.round(x.visitors / mx * (H - 34)), s = Math.round(x.sessions / mx * (H - 34)), cx = pl + i * step + step / 2, t = `${x.day.replace('T', ' ')}${x.day.length > 10 ? ':00' : ''} · ${x.visitors} people, ${x.sessions} visits, ${x.views} page views, ${x.actions || 0} actions`;
    g += `<g class="insbar" data-t="${e(t)}" style="cursor:pointer"><title>${e(t)}</title><rect x="${cx - step / 2}" y="0" width="${step}" height="${H - 18}" fill="transparent"/><rect x="${cx - bw / 2}" y="${H - 18 - h}" width="${bw}" height="${h}" rx="2" fill="#dba118"/><rect x="${cx - bw / 2}" y="${H - 18 - s}" width="${bw}" height="2" fill="#f2c14e"/></g>`;
    if(n <= 14 || i % Math.ceil(n / 10) === 0) g += `<text x="${cx}" y="${H - 4}" font-size="9" text-anchor="middle" fill="#9a978f">${lab(x)}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${g}</svg><p class="calendar-note insread" style="margin:4px 0 0">Tap a bar for its numbers. Gold bar = people, thin line on top = visits.</p>`;
}
function uHours(h){
  const grid = Array.from({length: 7}, () => Array(24).fill(0)); h.forEach(x => { if(x.dow >= 0 && x.dow < 7) grid[x.dow][x.hr] = x.n; }); const mx = Math.max(1, ...h.map(x => x.n)), DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return '<div class="rr-wrap"><table style="border-collapse:separate;border-spacing:2px;font-size:10px;color:var(--mute)"><tr><td></td>' + Array.from({length: 24}, (_, i) => `<td style="text-align:center">${i % 3 === 0 ? i : ''}</td>`).join('') + '</tr>' +
    grid.map((row, d) => `<tr><td style="padding-right:6px">${DN[d]}</td>${row.map((v, hr) => `<td title="${DN[d]} ${hr}:00 · ${v} visits" style="width:18px;height:16px;border-radius:3px;background:${v ? `rgba(219,161,24,${(0.12 + 0.88 * v / mx).toFixed(2)})` : 'rgba(255,255,255,.04)'}"></td>`).join('')}</tr>`).join('') + '</table></div>';
}
function uRegions(zones, pz, prevOn, sel){
  const R = {}, add = (z, key) => { const rg = regionOf(z.tg); (R[rg] = R[rg] || {n: 0, p: 0, z: []}); R[rg][key] += +z.n || 0; if(key === 'n') R[rg].z.push(z); };
  (zones || []).forEach(z => add(z, 'n')); (pz || []).forEach(z => add(z, 'p'));
  const rows = Object.keys(R).map(k => ({tg: k, n: R[k].n, p: R[k].p, z: R[k].z})).sort((a, b) => b.n - a.n), tot = rows.reduce((s, r) => s + r.n, 0), mx = Math.max(1, ...rows.map(r => r.n));
  if(!rows.length) return '<p class="calendar-note" style="margin:0">No visits yet.</p>';
  return '<div class="rr-wrap"><table class="rr-tbl"><tbody>' + rows.map(r => `<tr class="ins-row" data-reg="${e(r.tg)}" title="Click to see the time zones"><td>${e(r.tg)}</td><td style="width:34%"><div class="ins-bar"><div style="width:${Math.round(r.n / mx * 100)}%"></div></div></td><td style="text-align:right;white-space:nowrap"><b>${r.n}</b> <span class="ins-sub">· ${uPct(r.n, tot)}%</span></td><td style="text-align:right">${uChg(r.n, r.p, prevOn)}</td></tr>` +
    (sel === r.tg ? `<tr><td colspan="4" style="padding:2px 0 10px 14px"><span class="ins-sub">${r.z.map(z => e(String(z.tg).replace(/^.*\//, '').replace(/_/g, ' ')) + ' <b>' + z.n + '</b>').join(' · ')}</span></td></tr>` : '')).join('') + '</tbody></table></div>';
}
// plain-English findings
function uStory(D){
  const c = D.cur, p = D.prev, prevOn = !!p, k = c.kpi || {}, out = [], V = k.visitors || 0, thin = V < 20;
  const per = D.days == null ? 'overall' : D.days === 1 ? 'in the last 24 hours' : 'in the last ' + D.days + ' days';
  const pk = p ? p.kpi || {} : {}, chg = (a, b) => b ? Math.round((a - b) / b * 100) : null;
  if(!V){ out.push({t: 'info', x: `No visitors recorded ${per} yet. Once people use the terminal this page fills in on its own.`}); return out; }
  out.push({t: 'info', x: `${V.toLocaleString()} ${V === 1 ? 'person' : 'people'} visited ${per}, making ${(k.sessions || 0).toLocaleString()} visits and ${(k.views || 0).toLocaleString()} page views.`});
  if(prevOn){ const x = chg(V, pk.visitors || 0); if(x == null) out.push({t: 'up', x: pk.visitors === 0 && V ? 'Audience is new compared with the period before.' : ''}); else out.push({t: x > 5 ? 'up' : x < -5 ? 'dn' : 'info', x: `Audience is ${x > 5 ? 'growing' : x < -5 ? 'shrinking' : 'steady'}: ${x > 0 ? '+' : ''}${x}% people against the previous ${D.days === 1 ? '24 hours' : D.days + ' days'}.`}); }
  if(thin) out.push({t: 'warn', x: `Small sample (${V} ${V === 1 ? 'person' : 'people'}). Treat the findings below as early hints, not proof.`});
  const sm = uMap(c.sections), psm = uMap(p && p.sections), cat = CAT.filter(x => /^[ct]:/.test(x[0]));
  const rows = cat.map(x => { const tg = (x[0][0] === 't' ? 'tradfi|' : 'crypto|') + x[0].slice(2), r = sm[tg] || {views: 0, visitors: 0}; return {tg, name: x[1].replace(/^(Crypto|TradFi) · /, ''), views: +r.views || 0, people: +r.visitors || 0, avg: r.avg_s, prev: psm[tg] ? +psm[tg].views || 0 : 0}; });
  const top = rows.slice().sort((a, b) => b.people - a.people)[0];
  if(top && top.people) out.push({t: 'up', x: `Most used section: ${top.name}, opened by ${top.people} ${top.people === 1 ? 'person' : 'people'} (${uPct(top.people, V)}% of visitors).`});
  const rise = rows.filter(r => prevOn && r.views >= 5 && r.prev && (r.views - r.prev) / r.prev >= .4).sort((a, b) => b.views / (b.prev || 1) - a.views / (a.prev || 1)).slice(0, 3);
  if(rise.length) out.push({t: 'up', x: 'Rising: ' + rise.map(r => `${r.name} (+${Math.round((r.views - r.prev) / r.prev * 100)}%)`).join(', ') + '.'});
  const fall = rows.filter(r => prevOn && r.prev >= 5 && (r.views - r.prev) / r.prev <= -.4).sort((a, b) => a.views / a.prev - b.views / b.prev).slice(0, 3);
  if(fall.length) out.push({t: 'dn', x: 'Falling: ' + fall.map(r => `${r.name} (${Math.round((r.views - r.prev) / r.prev * 100)}%)`).join(', ') + '.'});
  const unused = rows.filter(r => !r.views); if(unused.length && !thin) out.push({t: 'dn', x: `Not opened by anyone ${per}: ${unused.map(r => r.name).join(', ')}. Candidates to leave alone, merge or promote.`});
  const quick = rows.filter(r => r.people >= 3 && r.avg != null && r.avg < 8); if(quick.length) out.push({t: 'warn', x: `People leave quickly from ${quick.map(r => r.name).join(', ')} (under 8 seconds). It may not be what they expected or the data may be slow to load.`});
  const lk = (c.locks || [])[0]; if(lk) out.push({t: 'info', x: `Most wanted locked item: ${String(lk.tg).replace(/^[^|]*\|/, '').replace(/^feat:/, '')} (${lk.visitors} ${lk.visitors == 1 ? 'person' : 'people'} tried it). Good guide for what people would pay for.`});
  const f = c.funnel || {}; if(f.auth_open) out.push({t: f.auth_ok ? 'up' : 'warn', x: `Sign-in: ${f.auth_open} opened it, ${f.auth_sent || 0} asked for a link, ${f.auth_ok || 0} signed in.`});
  const feats = (c.features || [])[0]; if(feats) out.push({t: 'info', x: `Most used feature: ${String(feats.tg).replace(/^[^|]*\|/, '')} (${feats.n} times).`});
  const R = {}; (c.zones || []).forEach(z => { const rg = regionOf(z.tg); R[rg] = (R[rg] || 0) + (+z.n || 0); }); const rg = Object.keys(R).sort((a, b) => R[b] - R[a]); if(rg.length){ const tot = Object.values(R).reduce((a, b) => a + b, 0); out.push({t: 'info', x: `Audience is mostly ${rg[0]} (${uPct(R[rg[0]], tot)}%)${rg[1] ? ', then ' + rg[1] + ' (' + uPct(R[rg[1]], tot) + '%)' : ''}. Region is a guess from the device time zone.`}); }
  const hr = {}; (c.hours || []).forEach(x => { hr[x.hr] = (hr[x.hr] || 0) + x.n; }); const bh = Object.keys(hr).sort((a, b) => hr[b] - hr[a])[0]; if(bh != null && !thin) out.push({t: 'info', x: `Busiest hour is ${String(bh).padStart(2, '0')}:00 your time.`});
  const ret = c.returning || 0; if(V >= 10) out.push({t: ret / V >= .3 ? 'up' : 'info', x: `${uPct(ret, V)}% of visitors came back more than once.`});
  if((c.errors || []).length) out.push({t: 'dn', x: `${c.errors.length} page error type${c.errors.length === 1 ? '' : 's'} recorded. See Page errors below.`});
  return out.filter(o => o.x);
}
function uScore(D){
  const c = D.cur, p = D.prev, prevOn = !!p, V = (c.kpi || {}).visitors || 0, sm = uMap(c.sections), psm = uMap(p && p.sections);
  const rows = CAT.filter(x => /^[ct]:/.test(x[0])).map(x => { const tg = (x[0][0] === 't' ? 'tradfi|' : 'crypto|') + x[0].slice(2), r = sm[tg] || {}, pr = psm[tg] || {}, views = +r.views || 0, people = +r.visitors || 0, pv = +pr.views || 0; let v = ['Steady', 'be'];
    if(!views) v = ['Unused', 'dn']; else if(prevOn && views >= 5 && pv && (views - pv) / pv >= .4) v = ['Rising', 'up']; else if(prevOn && pv >= 5 && (views - pv) / pv <= -.4) v = ['Falling', 'dn']; else if(uPct(people, V) >= 30) v = ['Popular', 'up']; else if(V >= 10 && uPct(people, V) < 5) v = ['Rarely used', 'dn'];
    return {tg, name: x[1], views, people, avg: r.avg_s, pv, v}; }).sort((a, b) => b.people - a.people || b.views - a.views);
  return `<div class="rr-wrap"><table class="rr-tbl"><thead><tr><th>Section or tool</th><th>People</th><th>% of visitors</th><th>Views</th><th>Avg time</th><th>vs before</th><th>Verdict</th></tr></thead><tbody>${rows.map(r => `<tr class="ins-row" data-dev="view" data-dtg="${e(r.tg)}"><td>${e(r.name)}</td><td>${r.people}</td><td>${uPct(r.people, V)}%</td><td>${r.views}</td><td>${r.avg != null ? uDur(+r.avg) : '—'}</td><td>${uChg(r.views, r.pv, prevOn)}</td><td><span class="ins-tag ${r.v[1]}">${r.v[0]}</span></td></tr>`).join('')}</tbody></table></div>`;
}
function uInsRender(D){
  const c = D.cur, p = D.prev, prevOn = !!p, k = c.kpi || {}, pk = p ? p.kpi || {} : {}, V = k.visitors || 0;
  const tile = (l, v, pv) => `<div><small>${l}</small><strong>${v}</strong>${prevOn ? `<br>${uChg(typeof v === 'string' ? parseFloat(v) : v, pv, true)}` : ''}</div>`;
  const label = D.days == null ? 'All time' : D.days === 1 ? 'Last 24 hours' : 'Last ' + D.days + ' days', plabel = D.days === 1 ? 'the 24 hours before' : 'the ' + D.days + ' days before';
  const story = uStory(D), ic = {up: '▲', dn: '▼', warn: '!', info: '•'};
  let h = `<div class="rr-card"><h3>Executive summary · ${label}</h3><ul class="ins-story">${story.map(s => `<li class="${s.t}"><span>${ic[s.t]}</span>${e(s.x)}</li>`).join('')}</ul>${prevOn ? `<p class="calendar-note" style="margin:8px 0 0">Arrows compare with ${plabel}.</p>` : ''}</div>`;
  h += `<div class="rr-card"><h3>The numbers</h3><div class="rr-out c4">${tile('People', V.toLocaleString(), pk.visitors)}${tile('Visits', (k.sessions || 0).toLocaleString(), pk.sessions)}${tile('Page views', (k.views || 0).toLocaleString(), pk.views)}${tile('Actions (clicks and features)', ((c.daily || []).reduce((s, x) => s + (+x.actions || 0), 0)).toLocaleString(), (p && p.daily || []).reduce((s, x) => s + (+x.actions || 0), 0))}${tile('Average visit', uDur(c.avg_dur), p && p.avg_dur)}${tile('Came back', uPct(c.returning || 0, V) + '%', p ? uPct(p.returning || 0, pk.visitors || 0) : 0)}${tile('Signed-in members', k.members || 0, pk.members)}${tile('Data since', k.first ? new Date(k.first).toLocaleDateString() : '—')}</div></div>`;
  h += `<div class="rr-card"><h3>Visitors ${c.hourly ? 'per hour' : 'per day'}</h3>${uDaily(c.daily || [], c.hourly)}</div>`;
  h += `<div class="rr-card"><h3>What is useful and what is not</h3><p class="calendar-note" style="margin:0 0 8px">Every section and tool scored on how many people open it. Click a row for the detail.</p>${uScore(D)}</div>`;
  const P = p || {}, rrow = (ttl, rows, key, ev, prev, note) => `<div class="rr-card"><h3>${ttl}</h3>${uRows(rows, key, ev, prev, prevOn)}${note ? `<p class="calendar-note" style="margin:8px 0 0">${note}</p>` : ''}</div>`;
  h += `<div class="rr-grid" style="align-items:start"><div>${rrow('Most clicked buttons and links', c.clicks, 'n', 'click', P.clicks)}${rrow('Features used', c.features, 'n', 'feat', P.features, 'Trades opened and closed, exports, alerts, the History drawer. Only the kind of action is recorded, never amounts or prices.')}${rrow('Wanted but locked', c.locks, 'n', 'lock', P.locks, 'People who tried a section or feature their plan does not include: a good guide for what goes in which plan.')}</div>
  <div><div class="rr-card"><h3>Where people are (by time zone)</h3><p class="calendar-note" style="margin:0 0 8px">Region is a guess from the device time zone (US, UK, Australia, Asia…). No country or location is ever stored. A VPN shows its own zone. Click a region to see its zones.</p>${uRegions(c.zones, P.zones, prevOn, INS.reg)}</div>
  ${rrow('Devices', c.devices, 'n', null, P.devices)}
  ${rrow('Where people came from', (c.referrers || []), 'n', null, P.referrers)}
  ${rrow('Dropdown choices (account, time frame, exchange, leverage)', c.choices, 'n', null, P.choices)}</div></div>`;
  h += `<div class="rr-card"><h3>When people visit (your time zone)</h3>${uHours(c.hours || [])}</div>`;
  const f = c.funnel || {}, ft = (l, v, s) => `<div><small>${l}</small><strong>${v}</strong>${s ? `<br><span class="ins-sub">${s}</span>` : ''}</div>`;
  h += `<div class="rr-card"><h3>Sign-up funnel (people)</h3><div class="rr-out c5">${ft('Visited', f.visitors || 0)}${ft('Saw a locked item', f.lock_seen || 0, uPct(f.lock_seen, f.visitors) + '% of visitors')}${ft('Opened sign-in', f.auth_open || 0, uPct(f.auth_open, f.visitors) + '%')}${ft('Asked for a link', f.auth_sent || 0, uPct(f.auth_sent, f.auth_open) + '% of those')}${ft('Signed in', f.auth_ok || 0, uPct(f.auth_ok, f.auth_sent) + '% of those')}</div></div>`;
  h += `<div class="rr-card"><h3>Signed-in members</h3>${(c.members || []).length ? `<div class="rr-wrap"><table class="rr-tbl"><thead><tr><th>Member</th><th>Plan</th><th>Visits</th><th>Actions</th><th>Favourite section</th><th>Last seen</th></tr></thead><tbody>${c.members.map(m => `<tr><td>${e(m.email)}</td><td>${e(pname(m.plan))}</td><td>${m.sessions}</td><td>${m.events}</td><td>${m.top ? uLabel(m.top) : '—'}</td><td>${new Date(m.last).toLocaleString()}</td></tr>`).join('')}</tbody></table></div>` : '<p class="calendar-note" style="margin:0">No signed-in activity in this range.</p>'}</div>`;
  if((c.errors || []).length) h += rrow('Page errors (things to fix)', c.errors, 'n', null, null);
  h += '<div class="rr-acts"><a class="rr-btn ghost sm" href="#admin" id="insBack2" style="text-decoration:none">← Back</a></div>';
  if(c.ignored > 0) h += `<p class="calendar-note">${c.ignored} browser${c.ignored === 1 ? '' : 's'} with bot-like activity ${c.ignored === 1 ? 'was' : 'were'} left out of these numbers.</p>`;
  return h;
}
const insCss = `<style>.ins-bar{background:rgba(219,161,24,.15);border-radius:4px;height:8px}.ins-bar>div{background:var(--gold);height:8px;border-radius:4px}.ins-sub{color:var(--mute);font-size:11px}.ins-chg{font-size:11px;color:var(--mute)}.ins-chg.up{color:#3fb47a}.ins-chg.dn{color:#e0554d}.ins-row{cursor:pointer}.ins-row:hover td{background:rgba(219,161,24,.06)}.ins-tag{font-size:11px;border-radius:999px;padding:2px 8px;border:1px solid var(--line);color:var(--mute);white-space:nowrap}.ins-tag.up{color:#3fb47a;border-color:#3fb47a}.ins-tag.dn{color:#e0554d;border-color:#e0554d}.ins-story{list-style:none;margin:0;padding:0}.ins-story li{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:14px;line-height:1.45}.ins-story li:last-child{border:0}.ins-story li>span{width:16px;flex:none;color:var(--mute)}.ins-story li.up>span{color:#3fb47a}.ins-story li.dn>span{color:#e0554d}.ins-story li.warn>span{color:var(--gold)}.ins-top{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.ins-pane{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:900;display:flex;justify-content:flex-end}.ins-pane>div{background:var(--bg,#0e0e10);border-left:1px solid var(--line);width:min(560px,100%);height:100%;overflow:auto;padding:18px}</style>`;
function uDetail(d, ev, tg){
  const tot = d.people || 0, rgs = {}; (d.zones || []).forEach(z => { const r = regionOf(z.tg); rgs[r] = (rgs[r] || 0) + (+z.n || 0); });
  const reg = Object.keys(rgs).map(k => ({tg: k, n: rgs[k]})).sort((a, b) => b.n - a.n), nxt = (d.next || []).map(x => ({tg: x.tg, n: x.n, visitors: x.people, ev: x.ev}));
  const daily = (d.daily || []).map(x => ({day: x.day, visitors: x.people, sessions: x.people, views: x.n, actions: x.n}));
  const evn = {view: 'opened', click: 'clicked', feat: 'used', lock: 'tried (locked)'}[ev] || ev;
  return `<div class="ins-top"><h3 style="margin:0;flex:1">${uLabel(tg)}</h3><button class="rr-btn ghost sm" id="insClose">Close ✕</button></div>
  <p style="margin:10px 0">${(d.total || 0).toLocaleString()} times ${evn} by <b>${tot}</b> ${tot === 1 ? 'person' : 'people'}.</p>
  <div class="rr-card"><h3>Over time</h3>${uDaily(daily)}</div>
  <div class="rr-card"><h3>Who (by region)</h3>${uRows(reg, 'n', null, null, false)}</div>
  <div class="rr-card"><h3>Devices</h3>${uRows(d.devices, 'n', null, null, false, r => e(r.tg))}</div>
  <div class="rr-card"><h3>What those visits did as well</h3>${uRows(nxt, 'n', null, null, false)}</div>
  <div class="rr-card"><h3>When</h3>${uHours(d.hours || [])}</div>`;
}
async function insUi(){
  const root = $('insBody'); if(!root || !$('insights') || !$('insights').classList.contains('active')) return;
  if(!PROF || !PROF.is_admin){ root.innerHTML = '<div class="rr-card"><p style="margin:0">Admins only. Sign in with an admin account.</p></div>'; return; }
  if(INS.busy) return;
  const sel = `<select id="usgRange" style="background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 9px;font:inherit">${[['1', 'Last 24 hours'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['all', 'All time']].map(o => `<option value="${o[0]}" ${o[0] === INS.days ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`;
  const head = `${insCss}<div class="rr-card"><div class="ins-top"><a class="rr-btn ghost sm" href="#admin" id="insBack" style="text-decoration:none">← Back</a>${sel}<button class="rr-btn ghost sm" id="usgRefresh">Refresh</button><button class="rr-btn ghost sm" id="usgCsv">Export CSV</button><button class="rr-btn ghost sm" id="usgClearOld">Clear older than 90 days</button><button class="rr-btn ghost sm" id="usgClearAll" style="border-color:#e0554d;color:#e0554d">Clear ALL</button></div><p class="calendar-note" id="usgNote" style="margin:8px 0 0">Anonymous counts of what is opened and clicked, never what is typed. Your own visits are not counted. Data stays until you clear it.</p></div>`;
  root.innerHTML = head + '<p class="calendar-note">Loading…</p>'; INS.busy = true;
  let tz = 'UTC'; try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }catch(err){}
  try{ const r = await api('/rest/v1/rpc/ttm_usage_report', {method: 'POST', body: JSON.stringify({p_days: INS.days === 'all' ? null : +INS.days, p_tz: tz})});
    if(r.ok && r.json && r.json.cur){ INS.data = r.json; INS.head = head; root.innerHTML = head + uInsRender(r.json) + '<div id="insPane"></div>'; }
    else root.innerHTML = head + `<div class="rr-warn y">Usage data is not set up yet (or this account is not an admin). In Supabase open SQL Editor, run supabase/usage.sql from the repo, then press Refresh.${r.json && r.json.message ? ' (' + e(r.json.message) + ')' : ''}</div>`;
  }catch(err){ root.innerHTML = head + '<div class="rr-warn y">Could not load usage data.</div>'; }
  INS.busy = false;
}
document.addEventListener('change', ev => { if(ev.target.id === 'usgRange'){ INS.days = ev.target.value; insUi(); } });
document.addEventListener('click', async ev => {
  const g = ev.target.closest && ev.target.closest('.insbar'); if(g){ const t = g.closest('.rr-card').querySelector('.insread'); if(t) t.textContent = g.dataset.t; return; }
  const row = ev.target.closest && ev.target.closest('.ins-row');
  if(row && row.dataset.reg){ INS.reg = INS.reg === row.dataset.reg ? null : row.dataset.reg; const sc = window.scrollY; if(INS.data){ $('insBody').innerHTML = INS.head + uInsRender(INS.data) + '<div id="insPane"></div>'; window.scrollTo(0, sc); } return; }
  if(row && row.dataset.dev){
    const pane = $('insPane'); if(!pane) return; pane.innerHTML = '<div class="ins-pane"><div><p class="calendar-note">Loading…</p></div></div>';
    let tz = 'UTC'; try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }catch(err){}
    const r = await api('/rest/v1/rpc/ttm_usage_detail', {method: 'POST', body: JSON.stringify({p_ev: row.dataset.dev, p_tg: row.dataset.dtg, p_days: INS.days === 'all' ? null : +INS.days, p_tz: tz})});
    pane.innerHTML = '<div class="ins-pane" id="insShade"><div>' + (r.ok && r.json ? uDetail(r.json, row.dataset.dev, row.dataset.dtg) : '<p class="calendar-note">Could not load the detail.</p><button class="rr-btn ghost sm" id="insClose">Close</button>') + '</div></div>'; return; }
  if(ev.target.id === 'insClose' || ev.target.id === 'insShade'){ const pn = $('insPane'); if(pn) pn.innerHTML = ''; return; }
});
document.addEventListener('click', async ev => {
  const id = ev.target.id, note = txt => { const n = $('usgNote'); if(n) n.textContent = txt; };
  if(id === 'usgRefresh') insUi();
  else if(id === 'usgClearAll' || id === 'usgClearOld'){
    const old = id === 'usgClearOld'; if(!confirm(old ? 'Delete usage data older than 90 days? This cannot be undone.' : 'Delete ALL usage data? This cannot be undone. Export a CSV first if you want a copy.')) return;
    const q = old ? 'ts=lt.' + encodeURIComponent(new Date(Date.now() - 90 * 864e5).toISOString()) : 'id=gt.0';
    const r = await api('/rest/v1/ttm_events?' + q, {method: 'DELETE', headers: {Prefer: 'count=exact,return=minimal'}});
    note(r.ok ? 'Cleared.' : 'Could not clear (are you signed in as admin?).'); if(r.ok) insUi();
  } else if(id === 'usgCsv'){
    note('Preparing the file…'); let rows = [], from = 0;
    for(let i = 0; i < 200; i++){ const r = await api('/rest/v1/ttm_events?select=*&order=id.asc', {headers: {Range: from + '-' + (from + 999), 'Range-Unit': 'items'}}); if(!r.ok || !Array.isArray(r.json)){ note('Could not export.'); return; } rows = rows.concat(r.json); if(r.json.length < 1000) break; from += 1000; }
    const cols = ['id', 'ts', 'vid', 'sid', 'uid', 'pg', 'ev', 'tg', 'dv', 'p'], esc2 = v => { v = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const csv = cols.join(',') + '\n' + rows.map(r => cols.map(c => esc2(r[c])).join(',')).join('\n'), a2 = document.createElement('a');
    a2.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'})); a2.download = 'ttm-usage-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a2); a2.click(); a2.remove(); note('Exported ' + rows.length.toLocaleString() + ' rows.');
  }
});
document.addEventListener('click', async ev => { const t = ev.target.closest ? ev.target.closest('button') : null; if(!t) return;
  if(t.dataset && t.dataset.bu){ const uid = t.dataset.bu, k = t.dataset.bk, cur = ADMB[uid] || [], nxt = cur.indexOf(k) >= 0 ? cur.filter(x => x !== k) : cur.concat([k]); const r = await api(`/rest/v1/ttm_profiles?id=eq.${uid}`, {method: 'PATCH', body: JSON.stringify({badges: nxt})}); if(r.ok){ ADMB[uid] = nxt; t.classList.toggle('on', nxt.indexOf(k) >= 0); } else alert('Could not save. Run supabase/badges2.sql in the Supabase SQL editor first.'); return; }
  if(t.id === 'bdgFound'){ const n = Math.max(1, Math.min(5000, +($('bdgN').value) || 100)), r = await api('/rest/v1/rpc/ttm_grant_founding', {method: 'POST', body: JSON.stringify({n})}); $('bdgNote').textContent = r.ok ? `Done. Founding Member added to ${r.json} member${r.json === 1 ? '' : 's'} (the first ${n} sign-ups). Refresh to see the ticks.` : 'Could not save. Run supabase/badges2.sql first.'; return; }
});
document.addEventListener('change', async ev => { const t = ev.target;
  if(t.dataset && t.dataset.beta){ const r = await api(`/rest/v1/ttm_profiles?id=eq.${t.dataset.beta}`, {method: 'PATCH', body: JSON.stringify({beta: t.checked})}); t.style.outline = r.ok ? '' : '2px solid #e0554d'; if(!r.ok){ t.checked = !t.checked; alert('Could not save the beta switch. Run the database step shown in the yellow box at the top of Admin, then try again.'); } return; }
  if(t.dataset && t.dataset.team){ const r = await api(`/rest/v1/ttm_profiles?id=eq.${t.dataset.team}`, {method: 'PATCH', body: JSON.stringify({team: t.checked})}); t.style.outline = r.ok ? '' : '2px solid #e0554d'; if(!r.ok){ t.checked = !t.checked; alert('Could not save the Team switch. Run supabase/team_join.sql in the Supabase SQL editor first, then try again.'); } return; }
  if(t.dataset && t.dataset.uid){ const r = await api(`/rest/v1/ttm_profiles?id=eq.${t.dataset.uid}`, {method: 'PATCH', body: JSON.stringify({plan: t.value, plan_until: null, plan_note: null})}); t.style.borderColor = r.ok ? '#3fb47a' : '#e0554d'; } });
document.addEventListener('change', ev => {
  const t = ev.target; if(!(t.dataset && t.dataset.ak)) return; const row = t.closest('tr'), box = p => row.querySelector(`input[data-ap="${p}"]`);
  if(t.dataset.ap === 'free' && t.checked){ box('premium').checked = true; box('pro').checked = true; }
  else if(t.dataset.ap === 'premium'){ if(t.checked) box('pro').checked = true; else box('free').checked = false; }
  else if(t.dataset.ap === 'pro' && !t.checked){ box('premium').checked = false; box('free').checked = false; }
});
document.addEventListener('click', async ev => {
  const gid = ev.target.id, gn = txt => { const n = $('grNote2'); if(n) n.textContent = txt; };
  if(gid === 'grGo'){
    const em = ($('grEmails').value || '').split(/[\s,;]+/).map(x => x.trim()).filter(x => /@/.test(x)); if(!em.length){ gn('Paste at least one email address.'); return; }
    const plan = $('grPlan').value, days = +$('grDays').value; if(plan === 'free' && !confirm('Set these people to Free?')) return;
    gn('Working…'); const r = await api('/rest/v1/rpc/ttm_grant_plan', {method: 'POST', body: JSON.stringify({p_emails: em, p_plan: plan, p_days: days, p_note: ($('grNote').value || 'giveaway').slice(0, 20)})});
    if(!r.ok || !r.json || !r.json.granted){ gn('Could not grant. Run supabase/trials.sql in Supabase first, and check you are signed in as admin.' + (r.json && r.json.message ? ' (' + r.json.message + ')' : '')); return; }
    const g = r.json.granted, m = r.json.no_account || []; const msg = `${g.length} ${pname(plan)} for ${days} days, ending ${new Date(r.json.until).toLocaleDateString()}.` + (m.length ? ` No account yet for: ${m.join(', ')}. Ask them to register first, then grant again.` : ''); await adminUi(); gn(msg); return; }
  if(gid === 'grBeta' || gid === 'grBetaOff'){
    const em = ($('grEmails').value || '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => /@/.test(x)); if(!em.length){ gn('Paste at least one email address.'); return; }
    const onv = gid === 'grBeta', r = await api('/rest/v1/ttm_profiles?email=in.(' + em.map(x => '"' + x.replace(/["\\]/g, '') + '"').join(',') + ')&is_admin=eq.false', {method: 'PATCH', headers: {Prefer: 'return=representation'}, body: JSON.stringify({beta: onv})});
    if(!r.ok){ gn('Could not update. Run supabase/trials.sql in Supabase first (it adds the beta switch).'); return; }
    const got = (r.json || []).map(x => String(x.email).toLowerCase()), miss = em.filter(x => got.indexOf(x) < 0); await adminUi(); gn(`${got.length} ${onv ? 'now beta testers' : 'removed from beta'}.` + (miss.length ? ` No account yet for: ${miss.join(', ')}.` : '')); return; }
  if(gid === 'grExpire'){ const r = await api('/rest/v1/rpc/ttm_expire_plans', {method: 'POST', body: '{}'}); const msg2 = r.ok ? `${r.json} expired plan${r.json === 1 ? '' : 's'} moved back to Free.` : 'Could not run. Run supabase/trials.sql first.'; await adminUi(); gn(msg2); return; }
  if(ev.target.id === 'admReset'){ SET.access = JSON.parse(JSON.stringify(DEF)); adminUi(); const n = $('admNote'); if(n) n.textContent = 'Defaults restored. Press Save to apply.'; return; }
  if(ev.target.id !== 'admSaveSet') return;
  const acc = {_pro: true}; CAT.forEach(c => { acc[c[0]] = []; }); document.querySelectorAll('#admBody input[data-ak]').forEach(i => { if(i.checked) acc[i.dataset.ak].push(i.dataset.ap); });
  const ch = $('admCharge').checked, wall = $('admWall').checked;
  const r = await api('/rest/v1/ttm_settings', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates'}, body: JSON.stringify([{key: 'charging', value: ch}, {key: 'wall', value: wall}, {key: 'track', value: $('admTrack').checked}, {key: 'access', value: acc}])});
  if(r.ok){ SET.charging = ch; SET.wall = wall; SET.track = $('admTrack').checked; SET.access = acc; $('admNote').textContent = 'Saved.'; ui(); } else $('admNote').textContent = 'Could not save (are you an admin?).'; });
window.addEventListener('hashchange', () => { setTimeout(() => { adminUi(); insUi(); ui(); }, 80); });

// ---------- Message TTM (every signed-in member, private) and live sessions ----------
const css2 = document.createElement('style');
css2.textContent = `@media(max-width:700px){#ttmChatBtn,#ttmCommBtn.fab{width:42px;height:42px;padding:0!important;font-size:0!important;border-radius:50%;display:flex;align-items:center;justify-content:center;position:fixed;bottom:calc(12px + env(safe-area-inset-bottom,0px));opacity:.92;box-shadow:0 4px 14px rgba(0,0,0,.5)}#ttmChatBtn{right:10px}#ttmCommBtn.fab{left:10px}#ttmChatBtn::before{content:'\\2709';font-size:19px;line-height:1}#ttmCommBtn.fab::before{content:'\\1F4AC';font-size:19px;line-height:1}#ttmChatBtn i,#ttmCommBtn.fab i{position:absolute;top:-4px;right:-4px;margin:0;font-size:10px;padding:1px 5px;line-height:1.3}#ttmChat{bottom:calc(62px + env(safe-area-inset-bottom,0px))}}
#ttmChatBtn{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2600;background:var(--gold,#dba118);color:#111;border:0;border-radius:999px;padding:11px 16px;font:inherit;font-weight:800;font-size:13.5px;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,.5)}#ttmChatBtn i{font-style:normal;background:#e0554d;color:#fff;border-radius:999px;padding:1px 7px;margin-left:8px;font-size:12px}
#ttmChat{position:fixed;right:16px;bottom:calc(70px + env(safe-area-inset-bottom,0px));z-index:2700;width:360px;max-width:calc(100vw - 24px);height:480px;max-height:calc(100vh - 110px);background:var(--card,#16161a);border:1px solid var(--gold,#dba118);border-radius:14px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.65);color:var(--text,#e8e6e1)}#ttmChat.open{display:flex}
#ttmChat .ch-h{display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid var(--line,#2a2a2e);font-weight:800;color:var(--gold2,#f2c14e)}#ttmChat .ch-h b{flex:1;font-size:14px;letter-spacing:.04em;text-transform:uppercase}#ttmChat .ch-h button{background:none;border:0;color:var(--text,#e8e6e1);font-size:20px;cursor:pointer;line-height:1}
#ttmChat .ch-b{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}#ttmChat .ch-m{max-width:84%;padding:8px 11px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word;background:rgba(255,255,255,.07);align-self:flex-start}#ttmChat .ch-m.me{align-self:flex-end;background:rgba(219,161,24,.22)}#ttmChat .ch-m small{display:block;margin-top:3px;font-size:10.5px;color:var(--mute,#9a978f)}#ttmChat .ch-m u{float:right;margin-left:8px;cursor:pointer;color:var(--mute,#9a978f);font-size:11px;text-decoration:none}
#ttmChat .ch-f{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line,#2a2a2e)}#ttmChat .ch-f textarea{flex:1;resize:none;background:rgba(255,255,255,.05);border:1px solid var(--line,#2a2a2e);color:var(--text,#e8e6e1);border-radius:10px;padding:9px 10px;font:inherit;font-size:14px;height:40px}#ttmChat .ch-f button{background:var(--gold,#dba118);color:#111;border:0;border-radius:10px;padding:0 16px;font:inherit;font-weight:800;cursor:pointer}
#ttmChat .ch-c{display:flex;justify-content:space-between;gap:8px;padding:10px 12px;border:1px solid var(--line,#2a2a2e);border-radius:10px;cursor:pointer;background:rgba(255,255,255,.03)}#ttmChat .ch-c i{font-style:normal;background:#e0554d;color:#fff;border-radius:999px;padding:0 7px;font-size:12px;height:18px}
#ttmLive{background:linear-gradient(90deg,rgba(219,161,24,.22),rgba(219,161,24,.1));border-bottom:1px solid var(--gold,#dba118);padding:9px 16px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;font-size:14px;color:var(--text,#e8e6e1);position:relative;z-index:50}#ttmLive b{color:var(--gold2,#f2c14e);letter-spacing:.06em;font-size:12px}#ttmLive a{background:var(--gold,#dba118);color:#111;border-radius:999px;padding:5px 14px;font-weight:800;text-decoration:none}`;
document.head.appendChild(css2);
const CH = {open: false, msgs: [], sel: null, who: {}, t: null, ready: false};
const isAdm = () => !!(PROF && PROF.is_admin), chatOK = () => on() && !!USER;
const chUnread = () => CH.msgs.filter(m => !m.seen && (isAdm() ? !m.from_admin : m.from_admin)).length;
function chatUi(){
  let b = $('ttmChatBtn');
  if(!chatOK()){ if(b) b.remove(); const p = $('ttmChat'); if(p) p.remove(); clearInterval(CH.t); CH.t = null; return; }
  if(!b){ b = document.createElement('button'); b.id = 'ttmChatBtn'; document.body.appendChild(b);
    const p = document.createElement('div'); p.id = 'ttmChat'; p.innerHTML = '<div class="ch-h"><button id="chBack" style="display:none" aria-label="Back">‹</button><b id="chTitle">Message TTM</b><button id="chX" aria-label="Close">×</button></div><div class="ch-b" id="chBody"></div><div id="chPrev" style="display:none;padding:6px 10px 0;border-top:1px solid var(--line,#2a2a2e)"></div><div class="ch-f" id="chFoot"><button id="chImg" title="Add a photo or screenshot" style="padding:0 11px;font-size:17px">📷</button><input type="file" id="chFile" accept="image/*" style="display:none"><textarea id="chIn" maxlength="2000" placeholder="Write a message"></textarea><button id="chSend">Send</button></div>'; document.body.appendChild(p); { const fi = p.querySelector('#chFile'), ti = p.querySelector('#chIn'); fi.addEventListener('change', ev => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if(f) chPick(f); }); ti.addEventListener('paste', ev => { const it = Array.from((ev.clipboardData || {}).items || []).find(x => x.type && x.type.indexOf('image/') === 0); if(it){ ev.preventDefault(); chPick(it.getAsFile()); } }); }
    $('chIn').addEventListener('keydown', ev => { if(ev.key === 'Enter' && !ev.shiftKey){ ev.preventDefault(); chatSend(); } }); }
  const n = chUnread(); b.innerHTML = (isAdm() ? 'Inbox' : 'Message TTM') + (n ? `<i>${n}</i>` : '');
  if(!CH.t){ CH.t = setInterval(() => { if(!document.hidden) chatLoad(); }, 8000); chatLoad(); }
  if(location.hash === '#chat'){ try{ history.replaceState(null, '', location.pathname + location.search); }catch(err){} chatToggle(true); }
}
const css5 = document.createElement('style');
css5.textContent = `#ttmCommBtn{text-decoration:none;font-weight:800;font-size:13px;cursor:pointer;white-space:nowrap}#ttmCommBtn i{font-style:normal;background:#e0554d;color:#fff;border-radius:999px;padding:1px 7px;margin-left:8px;font-size:12px}#ttmCommBtn.hdr{display:inline-flex;align-items:center;border:1px solid var(--gold,#dba118);color:var(--gold2,#f2c14e);border-radius:999px;padding:7px 14px;margin-right:8px;background:transparent}#ttmCommBtn.hdr:hover{background:rgba(219,161,24,.15)}#ttmCommBtn.fab{position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2600;background:var(--gold,#dba118);color:#111;border-radius:999px;padding:11px 16px;box-shadow:0 6px 22px rgba(0,0,0,.5);font-size:13.5px}`;
document.head.appendChild(css5);
const RMU = {};
// read state is kept in the member's settings too, so a room read on the phone is not "new" on the desktop (and the other way round)
let SYNCT = null; const syncPrefs = () => { clearTimeout(SYNCT); SYNCT = setTimeout(() => { try{ if(USER && on() && typeof prefSave === 'function') prefSave(); }catch(err){} }, 2500); };
const rmSeenGet = r => { let a = null; try{ const v = localStorage.getItem('ttm_rmseen_' + r); a = v == null ? null : +v; }catch(err){} const b = PREFS && PREFS.rmseen && PREFS.rmseen[r] != null ? +PREFS.rmseen[r] : null; return a == null ? b : b == null ? a : Math.max(a, b); };
const rmSeenSet = (r, id) => { try{ localStorage.setItem('ttm_rmseen_' + r, String(id)); }catch(err){} if(!PREFS.rmseen) PREFS.rmseen = {}; if(!(+PREFS.rmseen[r] >= +id)){ PREFS.rmseen[r] = +id; syncPrefs(); } };
async function rmUnread(){
  if(!on() || !USER) return;
  for(const r of ROOMS){ const k = r[0]; if(!rmCan(k)){ RMU[k] = 0; continue; }
    const x = await api(`/rest/v1/ttm_room_msgs?select=id,user_id&room=eq.${k}&order=id.desc&limit=30`); if(!x.ok || !Array.isArray(x.json)) continue;
    const top = x.json.length ? x.json[0].id : 0, seen = rmSeenGet(k), viewing = location.hash === '#community' && RM.room === k && !document.hidden;
    if(seen == null || viewing){ rmSeenSet(k, top); RMU[k] = 0; } else RMU[k] = x.json.filter(m => m.id > seen && m.user_id !== USER.id).length; }
  commBtn(); rmTabs();
}
setInterval(() => { if(!document.hidden) rmUnread(); }, 30000); setTimeout(rmUnread, 3000);
function commBtn(){
  let b = $('ttmCommBtn'); if(!b){ b = document.createElement('a'); b.id = 'ttmCommBtn'; document.body.appendChild(b); }
  { const n = Object.keys(RMU).reduce((t, k) => t + RMU[k], 0), h = 'Community Chat' + (n ? `<i>${n > 99 ? '99+' : n}</i>` : ''); if(b.innerHTML !== h) b.innerHTML = h; }
  b.href = TERM === 'crypto' ? '#community' : BASE + 'crypto/index.html#community';
  const wide = window.innerWidth > 760, ac = $('acctBtn');
  if(wide && ac && ac.parentNode){ b.className = 'hdr'; if(b.nextSibling !== ac) ac.parentNode.insertBefore(b, ac); }
  else { b.className = 'fab'; if(b.parentNode !== document.body) document.body.appendChild(b); }
}
window.addEventListener('resize', () => { try{ commBtn(); }catch(err){} });
function chatToggle(v){ const p = $('ttmChat'); if(!p) return; CH.open = v; p.classList.toggle('open', v); if(v){ chatPaint(); chatSeen(); } }
function armTap(t, txt){ if(t.dataset.arm === '1') return true; t.dataset.arm = '1'; const old = t.textContent; t.textContent = txt || 'tap again to delete'; t.style.color = '#e0554d'; setTimeout(() => { t.dataset.arm = ''; t.textContent = old; t.style.color = ''; }, 3500); return false; }
async function delRow(path){ const r = await api(path, {method: 'DELETE', headers: {Prefer: 'return=representation'}}); return r.ok && Array.isArray(r.json) && r.json.length > 0; }
async function chatLoad(){
  if(!chatOK()) return;
  const r = await api(isAdm() ? '/rest/v1/ttm_chat?select=*&order=ts.desc&limit=400' : `/rest/v1/ttm_chat?select=*&member_id=eq.${USER.id}&order=ts.desc&limit=200`);
  if(!r.ok || !Array.isArray(r.json)) return;
  const old = JSON.stringify(CH.msgs.map(m => [m.id, m.seen])); CH.msgs = r.json.slice().reverse();
  if(isAdm()){ const need = [...new Set(CH.msgs.map(m => m.member_id))].filter(id => !CH.who[id]); if(need.length){ const p = await api('/rest/v1/ttm_profiles?select=id,email,tg_handle&id=in.(' + need.join(',') + ')'); if(p.ok && Array.isArray(p.json)) p.json.forEach(x => { CH.who[x.id] = x.tg_handle ? '@' + String(x.tg_handle).replace(/^@/, '') : x.email; }); } }
  if(JSON.stringify(CH.msgs.map(m => [m.id, m.seen])) !== old){ const b = $('ttmChatBtn'); const n = chUnread(); if(b) b.innerHTML = (isAdm() ? 'Inbox' : 'Message TTM') + (n ? `<i>${n}</i>` : ''); if(CH.open){ chatPaint(); chatSeen(); } }
}
function chatPaint(){
  const body = $('ttmChat') && $('chBody'); if(!body) return; const adm = isAdm(), list = adm && !CH.sel;
  $('chBack').style.display = adm && CH.sel ? '' : 'none'; $('chFoot').style.display = list ? 'none' : ''; $('chTitle').textContent = adm ? (CH.sel ? (CH.who[CH.sel] || 'Member') : 'Inbox') : 'Message TTM';
  const tm = t => new Date(t).toLocaleString([], {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}); const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
  if(list && CH.pick){ $('chTitle').textContent = 'New message'; $('chBack').style.display = '';
    const q = (CH.q || '').toLowerCase(), M = (CH.members || []).filter(m => !q || ((m.email || '') + ' ' + (m.tg_handle || '')).toLowerCase().indexOf(q) >= 0).slice(0, 80);
    body.innerHTML = `<input id="chFind" value="${e(CH.q || '')}" placeholder="Search members by name or email" autocomplete="off" style="width:100%;margin:0 0 8px;padding:8px;border-radius:8px;border:1px solid var(--line,#333);background:#0f0f12;color:inherit">` + (CH.members ? (M.length ? M.map(m => `<div class="ch-c" data-chnew="${e(m.id)}"><span style="pointer-events:none"><b>${e(m.tg_handle ? '@' + String(m.tg_handle).replace(/^@/, '') : (m.email || 'Member'))}</b><br><small style="color:var(--mute)">${e(m.email || '')}</small></span></div>`).join('') : '<p style="color:var(--mute);font-size:13px">No match.</p>') : '<p style="color:var(--mute);font-size:13px">Loading members…</p>'); return; }
  if(list){
    const g = {}; CH.msgs.forEach(m => { (g[m.member_id] = g[m.member_id] || []).push(m); });
    const ids = Object.keys(g).sort((a, b) => new Date(g[b][g[b].length - 1].ts) - new Date(g[a][g[a].length - 1].ts));
    body.innerHTML = '<button id="chNew" style="width:100%;margin:0 0 8px;padding:9px;border-radius:8px;border:1px solid var(--gold,#dba118);background:transparent;color:var(--gold,#dba118);font-weight:800;cursor:pointer">＋ New message to a member</button>' + (ids.length ? ids.map(id => { const l = g[id], last = l[l.length - 1], un = l.filter(m => !m.from_admin && !m.seen).length; return `<div class="ch-c" data-chc="${e(id)}"><span style="pointer-events:none"><b>${e(CH.who[id] || 'Member')}</b><br><small style="color:var(--mute)">${e((last.from_admin ? 'You: ' : '') + (last.body ? last.body.slice(0, 60) : '\U0001F4F7 Photo'))}</small></span>${un ? `<i style="pointer-events:none">${un}</i>` : ''}</div>`; }).join('') : '<p style="color:var(--mute);font-size:13px;margin:6px 2px">No messages yet. Pro members can write to you from the Message TTM button.</p>');
  } else {
    const l = CH.msgs.filter(m => adm ? m.member_id === CH.sel : true);
    body.innerHTML = l.length ? l.map(m => { const me = adm ? m.from_admin : !m.from_admin; return `<div class="ch-m ${me ? 'me' : ''}">${adm || !m.from_admin ? `<u data-chdel="${m.id}" title="Delete">delete</u>` : ''}${m.body ? e(m.body) : ''}${rmImgOk(m.img) ? `<a href="${e(m.img)}" target="_blank" rel="noopener noreferrer"><img class="rm-img" loading="lazy" src="${e(m.img)}" alt="Photo"></a>` : ''}<small>${me ? 'You' : (adm ? e(CH.who[CH.sel] || 'Member') : 'TTM')} · ${tm(m.ts)}${me && adm ? (m.seen ? ' · read' : '') : (me && m.seen ? ' · read' : '')}</small></div>`; }).join('') : '<p style="color:var(--mute);font-size:13px;margin:6px 2px">Write a private message to TTM. You get a notification on your phone when TTM replies (turn on Phone alerts in your Account card).</p>';
    if(atBottom || CH.force){ body.scrollTop = body.scrollHeight; CH.force = false; }
  }
}
async function chatSeen(){
  if(!CH.open) return; const adm = isAdm(); let q = null;
  if(adm){ if(CH.sel) q = `member_id=eq.${CH.sel}&from_admin=eq.false&seen=eq.false`; } else q = `member_id=eq.${USER.id}&from_admin=eq.true&seen=eq.false`;
  if(!q || !CH.msgs.some(m => !m.seen && (adm ? !m.from_admin && m.member_id === CH.sel : m.from_admin))) return;
  await api('/rest/v1/ttm_chat?' + q, {method: 'PATCH', body: JSON.stringify({seen: true}), headers: {Prefer: 'return=minimal'}});
  CH.msgs.forEach(m => { if(adm ? (!m.from_admin && m.member_id === CH.sel) : m.from_admin) m.seen = true; }); chatUi();
}
function chPrev(){ const d = $('chPrev'); if(!d) return; if(!CH.pend){ d.style.display = 'none'; d.innerHTML = ''; return; } d.style.display = ''; d.innerHTML = `<div style="position:relative;display:inline-block"><img src="${CH.pend.url}" alt="" style="max-height:90px;max-width:160px;border-radius:8px;display:block"><button id="chPrevX" title="Remove" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:0;background:#e0554d;color:#fff;font-size:13px;line-height:1;cursor:pointer;padding:0">×</button></div>`; }
async function chPick(file){
  const b = $('chBody'), msg = t => { if(b) b.insertAdjacentHTML('beforeend', '<p style="color:#e0554d;font-size:12.5px">' + e(t) + '</p>'); };
  if(!file || file.type.indexOf('image/') !== 0){ msg('Pick an image file.'); return; }
  if(file.type === 'image/gif'){ if(file.size > 2e6){ msg('That GIF is over 2 MB.'); return; } CH.pend = {blob: file, url: URL.createObjectURL(file)}; chPrev(); return; }
  try{ const bmp = await createImageBitmap(file), sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    let blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86)); if(blob && blob.size > 1.9e6) blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.6));
    if(!blob || blob.size > 2e6){ msg('That image is too large. Try a smaller screenshot.'); return; }
    CH.pend = {blob, url: URL.createObjectURL(blob)}; chPrev(); }catch(err){ msg('Could not read that image.'); }
}
async function chatSend(){
  const i = $('chIn'), txt = (i.value || '').trim(); if(!txt && !CH.pend) return; const adm = isAdm(); if(adm && !CH.sel) return;
  const sb = $('chSend'), b = $('chBody'), fail = t => { if(b) b.insertAdjacentHTML('beforeend', '<p style="color:#e0554d;font-size:12.5px">' + e(t) + '</p>'); if(sb) sb.disabled = false; };
  if(sb) sb.disabled = true; let img = null;
  if(CH.pend){
    const t = await token(), mime = CH.pend.blob.type === 'image/gif' ? 'image/gif' : 'image/jpeg', path = USER.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + (mime === 'image/gif' ? '.gif' : '.jpg');
    const up = await fetch(CFG.url + '/storage/v1/object/room-pending/' + path, {method: 'POST', headers: {apikey: CFG.key, Authorization: 'Bearer ' + t, 'Content-Type': mime}, body: CH.pend.blob});
    if(!up.ok){ fail('Could not upload the photo. It must be under 2 MB.'); return; }
    let sc = null; try{ const r = await fetch(CFG.url + '/functions/v1/scan-image', {method: 'POST', headers: {apikey: CFG.key, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json'}, body: JSON.stringify({path, type: mime})}); sc = await r.json(); }catch(x){}
    if(!sc || !sc.ok){ fail(sc && sc.reason ? 'Photo blocked: ' + sc.reason + '.' : 'Could not check the photo, so it was not sent. Try again.'); CH.pend = null; chPrev(); return; }
    img = sc.url;
  }
  i.value = ''; CH.force = true;
  const row = {member_id: adm ? CH.sel : USER.id, from_admin: adm, body: txt}; if(img) row.img = img;
  const r = await api('/rest/v1/ttm_chat', {method: 'POST', headers: {Prefer: 'return=minimal'}, body: JSON.stringify(row)});
  if(!r.ok){ i.value = txt; fail(img ? 'Could not send the photo. The "dm_images.sql" database step may still be missing.' : 'Could not send. Messaging is for Pro members, and the database step may still be missing.'); return; }
  CH.pend = null; chPrev(); if(sb) sb.disabled = false;
  await chatLoad(); chatPaint();
}
// live sessions
const LIVE = {rows: [], t: 0};
async function liveLoad(){ if(!on() || !USER) return; const r = await api('/rest/v1/ttm_live?select=*&starts_at=gt.' + encodeURIComponent(new Date(Date.now() - 3600e3).toISOString()) + '&order=starts_at.asc&limit=20'); if(r.ok && Array.isArray(r.json)){ LIVE.rows = r.json; liveBanner(); } }
function liveBanner(){
  let b = $('ttmLive'); const now = Date.now(), s = LIVE.rows.find(x => new Date(x.starts_at).getTime() > now - 3600e3 && new Date(x.starts_at).getTime() < now + 7 * 864e5);
  if(!USER || !s){ if(b) b.remove(); return; }
  if(!b){ b = document.createElement('div'); b.id = 'ttmLive'; document.body.insertBefore(b, document.body.firstChild); }
  const t = new Date(s.starts_at).getTime(), mins = Math.round((t - now) / 60000), when = new Date(t).toLocaleString([], {weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'});
  const st = mins <= 0 ? 'LIVE NOW' : mins <= 60 ? 'LIVE IN ' + mins + ' MIN' : 'LIVE SESSION';
  b.innerHTML = `<b>${st}</b><span>${e(s.title)} · ${e(when)}</span><a href="${e(s.zoom_url)}" target="_blank" rel="noopener">Join on Zoom</a>`;
}
setInterval(liveLoad, 60000); setInterval(liveBanner, 30000); setTimeout(liveLoad, 2500);
const LVD = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']], LV = {edit: null};
const lvDays = () => Array.from(document.querySelectorAll('.lvDow')).filter(c => c.checked).map(c => +c.value);
const lvDowOf = x => Array.isArray(x.repeat_dow) && x.repeat_dow.length ? x.repeat_dow : x.repeat_days ? [new Date(x.starts_at).getDay()] : [];
function lvReset(){ LV.edit = null; ['lvTitle', 'lvWhen', 'lvUrl', 'lvNote'].forEach(i => { if($(i)) $(i).value = ''; }); document.querySelectorAll('.lvDow').forEach(c => { c.checked = false; }); if($('lvAdd')) $('lvAdd').textContent = 'Add session'; if($('lvCancel')) $('lvCancel').style.display = 'none'; }
function lvEdit(id){ const x = LIVE.rows.find(r => String(r.id) === String(id)); if(!x) return; LV.edit = x.id; const d = new Date(x.starts_at), z = n => String(n).padStart(2, '0');
  $('lvTitle').value = x.title; $('lvWhen').value = d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + 'T' + z(d.getHours()) + ':' + z(d.getMinutes()); $('lvUrl').value = x.zoom_url || ''; $('lvNote').value = x.note || '';
  const ds = lvDowOf(x); document.querySelectorAll('.lvDow').forEach(c => { c.checked = ds.indexOf(+c.value) >= 0; }); $('lvAdd').textContent = 'Save changes'; $('lvCancel').style.display = ''; $('lvTitle').scrollIntoView({block: 'center', behavior: 'smooth'}); $('lvNoteMsg').textContent = 'Editing. This changes the next session, and the series carries on from it.'; }
function lvAdminHtml(){ return `<div class="rr-card"><h3>Live sessions (Zoom)</h3><p class="calendar-note" style="margin:0 0 10px">Add a session and it posts to Telegram within a minute, then again 15 minutes before it starts. Tick the days it repeats on and the next date is created by itself after each reminder. Press Edit on the upcoming one to change the name, time, link or days; delete it to stop the series. Every member with Phone alerts on gets a notification both times. Times use your own clock.</p>
  <div style="display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))"><input id="lvTitle" placeholder="Title, e.g. Weekly market live" style="background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:9px 10px;font:inherit"><input id="lvWhen" type="datetime-local" style="background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:9px 10px;font:inherit"><input id="lvUrl" placeholder="Zoom link" style="background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:9px 10px;font:inherit"><input id="lvNote" placeholder="Short note (optional)" style="background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:9px 10px;font:inherit"><div id="lvDays" style="grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><small style="color:var(--mute);margin-right:4px">Repeat on</small>${LVD.map(d => `<label style="display:inline-flex;gap:4px;align-items:center;padding:6px 9px;border:1px solid var(--line);border-radius:8px;cursor:pointer"><input type="checkbox" class="lvDow" value="${d[0]}">${d[1]}</label>`).join('')}<button type="button" class="rr-btn ghost sm" id="lvDaily">Every day</button><button type="button" class="rr-btn ghost sm" id="lvNone">None</button></div></div>
  <div class="rr-acts" style="margin:10px 0 0"><button class="rr-btn sm" id="lvAdd">Add session</button><button class="rr-btn ghost sm" id="lvCancel" style="display:none">Cancel edit</button></div><p class="calendar-note" id="lvNoteMsg" style="margin:8px 0 0"></p><div id="lvList"></div></div>`; }
async function lvLoad(){ const l = $('lvList'); if(!l) return; const r = await api('/rest/v1/ttm_live?select=*&order=starts_at.asc&limit=30&starts_at=gt.' + encodeURIComponent(new Date(Date.now() - 864e5).toISOString()));
  if(!r.ok){ l.innerHTML = '<div class="rr-warn y" style="margin-top:10px"><b>One database step is missing.</b> Run supabase/messaging.sql in the Supabase SQL editor, then refresh.</div>'; return; }
  LIVE.rows = r.json || []; l.innerHTML = LIVE.rows.length ? `<div class="rr-wrap" style="margin-top:10px"><table class="rr-tbl"><thead><tr><th>Session</th><th>When</th><th>Posted</th><th>Reminded</th><th></th></tr></thead><tbody>${LIVE.rows.map(x => `<tr><td>${e(x.title)}${lvDowOf(x).length ? ` <small style="color:var(--mute)">(repeats ${lvDowOf(x).length === 7 ? 'daily' : LVD.filter(d => lvDowOf(x).indexOf(d[0]) >= 0).map(d => d[1]).join(', ')})</small>` : ''}</td><td>${e(new Date(x.starts_at).toLocaleString([], {weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'}))}</td><td>${x.announced ? 'Yes' : 'Waiting'}</td><td>${x.reminded ? 'Yes' : 'Waiting'}</td><td style="white-space:nowrap"><button class="rr-btn ghost sm" data-lved="${x.id}">Edit</button> <button class="rr-btn ghost sm" data-lvdel="${x.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="calendar-note" style="margin:10px 0 0">No upcoming sessions.</p>'; liveBanner(); }
async function lvAdd(){ const n = $('lvNoteMsg'), title = ($('lvTitle').value || '').trim(), w = $('lvWhen').value, url = ($('lvUrl').value || '').trim();
  if(!title || !w || !/^https?:\/\//i.test(url)){ n.textContent = 'Add a title, a date and time, and a Zoom link starting with https://'; return; }
  const t = new Date(w); if(!(t.getTime() > Date.now())){ n.textContent = 'Pick a time in the future.'; return; }
  const ds = lvDays(), body = {title, starts_at: t.toISOString(), zoom_url: url, note: ($('lvNote').value || '').trim() || null, repeat_days: ds.length ? 7 : 0, repeat_dow: ds}; n.textContent = 'Saving…';
  let r;
  if(LV.edit){ if(t.getTime() > Date.now() + 16 * 60000) body.reminded = false; r = await api('/rest/v1/ttm_live?id=eq.' + LV.edit, {method: 'PATCH', headers: {Prefer: 'return=minimal'}, body: JSON.stringify(body)}); if(r.ok){ lvReset(); n.textContent = 'Saved.'; lvLoad(); } else n.textContent = 'Could not save. Run supabase/live_days.sql first.'; return; }
  r = await api('/rest/v1/ttm_live', {method: 'POST', headers: {Prefer: 'return=minimal'}, body: JSON.stringify(body)});
  if(r.ok){ n.textContent = 'Added. Members get a phone alert when it is announced and again before it starts.'; lvReset(); lvLoad(); } else n.textContent = 'Could not save. Run supabase/live_days.sql first.'; }

// ---------- Community chat rooms (Free / Premium / Pro) ----------
let ADMB = {};
const BDG = [['team', 'TTM Team', 'Team'], ['alpha', 'Alpha', 'Alpha'], ['mindset', 'Mindset', 'Mindset'], ['mod', 'Moderator', 'Mod'], ['founding', 'Founding Member', 'Founder']], BDGL = {ttm: 'TTM'}; BDG.forEach(b => { BDGL[b[0]] = b[1]; });
const bdgHtml = m => { const l = Array.isArray(m.badges) && m.badges.length ? m.badges : (m.badge === 'TTM' ? ['ttm'] : m.badge === 'TTM Team' ? ['team'] : []); return l.filter(k => BDGL[k]).map(k => `<em class="rm-badge ${k}">${BDGL[k]}</em>`).join(''); };
const RXS = ['👍', '🔥', '🚀', '😂', '❤️', '👀'], EMO = ['😀', '😂', '🤣', '😊', '😍', '😎', '🤔', '😅', '😭', '😡', '👍', '👎', '👏', '🙏', '💪', '🔥', '🚀', '🌙', '💎', '🐂', '🐻', '📈', '📉', '💰', '🎯', '✅', '❌', '⚠️', '👀', '🤝'];
const RM = {votes: {}, rx: {}, rxpick: null, room: null, sig: '', pend: null, muted: false, timer: null, built: false, busy: false, voice: null, rec: null, editing: null, seen: {}, rp: {}};
const ROOMS = [['free', 'Free'], ['premium', 'Premium'], ['pro', 'Pro']];
const rmTag = () => !!(PROF && (PROF.is_admin || (Array.isArray(PROF.badges) && PROF.badges.length > 0)));
const rmCan = r => !!USER && (can('room:' + r) || rmTag());
const rmAudOk = u => typeof u === 'string' && CFG.url && u.indexOf(CFG.url + '/storage/v1/object/public/room-voice/') === 0;
const rmImgOk = u => typeof u === 'string' && CFG.url && u.indexOf(CFG.url + '/storage/v1/object/public/room-images/') === 0;
async function rmReadPing(room, id){ if(!USER || !id || PREFS.online === false) return; if((RM.rp[room] || 0) >= id) return; RM.rp[room] = id;
  await api('/rest/v1/ttm_room_reads?on_conflict=user_id,room', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'}, body: JSON.stringify({user_id: USER.id, room, last_id: id, ts: new Date().toISOString()})}); }
function rmReplyLink(m){ if(rmRO()) return ''; const raw = String(m.body || '').replace(/^>> [^\n]*\n?/, '').replace(/\s+/g, ' ').trim(), sn = raw ? raw.slice(0, 100) : (m.img ? '[image]' : m.audio ? '[voice note]' : m.poll ? '[poll]' : ''); return `<u data-rmreply="${m.id}" data-n="${e(m.name || 'Member')}" data-s="${e(sn)}">reply</u>`; }
function rmReplyBar(){ let b = $('rmReplyBar'); if(!RM.reply){ if(b) b.remove(); return; } const anchor = $('rmPrev'); if(!anchor) return; if(!b){ b = document.createElement('div'); b.id = 'rmReplyBar'; b.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;border-top:1px solid var(--line);font-size:13px;background:rgba(219,161,24,.08)'; anchor.parentNode.insertBefore(b, anchor); } b.innerHTML = `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\u21a9 Replying to <b>${e(RM.reply.name)}</b>: ${e(RM.reply.snip)}</span><button class="rr-btn ghost sm" id="rmReplyX">\u2715</button>`; }
function rmFmt(m){
  const gifs = []; (String(m.body || '').match(/https?:\/\/[^\s<]+/g) || []).forEach(u => { let g = null; const gm = u.match(/^https:\/\/giphy\.com\/gifs\/(?:[^\/?#]*-)?([A-Za-z0-9]{8,24})(?:[\/?#]|$)/); if(gm) g = 'https://media.giphy.com/media/' + gm[1] + '/giphy.gif'; else if(/^https:\/\/(?:media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com)\/[^\s?#]+\.(?:gif|webp)(?:\?[^\s]*)?$/.test(u)) g = u; if(g && gifs.indexOf(g) < 0) gifs.push(g); });
  const imgs = []; let t = e(m.body || '').replace(/(^|[\s(])@([A-Za-z0-9_]{2,32})/g, '$1<b class="rm-at">@$2</b>').replace(/https?:\/\/[^\s<]+/g, u => { const c = u.replace(/&amp;/g, '&'), tv = c.match(/^https:\/\/(?:www\.)?tradingview\.com\/x\/([A-Za-z0-9]{5,14})/); if(tv) imgs.push(tv[1]); return `<a href="${e(c)}" target="_blank" rel="noopener noreferrer">${e(c.length > 48 ? c.slice(0, 45) + '…' : c)}</a>`; }).replace(/\n/g, '<br>');
  let rq = ''; { const qm = String(m.body || '').match(/^>> ([^|\n]{1,40}) \| ([^\n]{0,140})\n?/); if(qm){ rq = `<div class="rm-q"><b>${e(qm[1])}</b> ${e(qm[2])}</div>`; t = t.replace(/^&gt;&gt; [^\n]*?(<br>|$)/, ''); } }
  let h = (rq || '') + (t ? `<div>${t}</div>` : '');
  imgs.forEach(id => { const src = 'https://s3.tradingview.com/snapshots/' + id[0].toLowerCase() + '/' + id + '.png'; h += `<a href="https://www.tradingview.com/x/${e(id)}/" target="_blank" rel="noopener noreferrer"><img class="rm-img" loading="lazy" referrerpolicy="no-referrer" src="${e(src)}" alt="TradingView chart" onerror="this.style.display='none'"></a>`; });
  gifs.slice(0, 2).forEach(g => { h += `<a href="${e(g)}" target="_blank" rel="noopener noreferrer"><img class="rm-img" loading="lazy" referrerpolicy="no-referrer" src="${e(g)}" alt="GIF" onerror="this.style.display='none'"></a>`; });
  if(m.poll) h = pollHtml(m) + h;
  if(rmAudOk(m.audio)) h += `<div class="rm-vn">🎤 <audio controls preload="metadata" src="${e(m.audio)}" onerror="if(!this.dataset.x){this.dataset.x=1;this.insertAdjacentHTML('afterend',' <a href=&quot;'+this.src+'&quot; target=&quot;_blank&quot; rel=&quot;noopener&quot;>Open</a> <small>(this phone cannot play it here)</small>')}"></audio>${m.audio_secs ? `<small>${Math.floor(m.audio_secs / 60)}:${String(m.audio_secs % 60).padStart(2, '0')}</small>` : ''}</div>`;
  if(rmImgOk(m.img)) h += `<a href="${e(m.img)}" target="_blank" rel="noopener noreferrer"><img class="rm-img" loading="lazy" src="${e(m.img)}" alt="Screenshot"></a>`;
  return h;
}
function pollHtml(m){
  const p = m.poll || {}, opts = Array.isArray(p.opts) ? p.opts : [], vs = RM.votes[m.id] || [], voters = new Set(vs.map(v => v.user_id)).size, total = vs.length || 0;
  const mine = new Set(vs.filter(v => USER && v.user_id === USER.id).map(v => v.opt));
  return `<div class="rm-poll"><div class="rm-pq">📊 ${e(p.q || m.body || 'Poll')}</div><div class="rm-pm">${p.multi ? 'Pick one or more' : 'Pick one'} · ${voters} vote${voters === 1 ? '' : 'rs'}</div>` + opts.map((o, i) => { const c = vs.filter(v => v.opt === i).length, pc = total ? Math.round(c / total * 100) : 0;
    return `<button class="rm-po${mine.has(i) ? ' me' : ''}" data-vote="${m.id}|${i}"><span class="rm-pb" style="width:${pc}%"></span><span class="rm-pt">${e(String(o))}</span><span class="rm-pn">${c ? pc + '% · ' + c : ''}</span></button>`; }).join('') + `</div>`;
}
function gifPanel(){
  const box = $('rmGifBox'); if(!box) return; const key = CFG.giphy_key;
  if(!key){ box.innerHTML = '<p class="calendar-note" style="margin:0">Paste a <b>Giphy</b> or <b>Tenor</b> link into your message and it shows as a GIF. You can also upload a GIF file with the Image button (up to 2 MB).</p>'; return; }
  box.innerHTML = '<input id="rmGifQ" placeholder="Search GIFs" autocomplete="off" style="width:100%;box-sizing:border-box;margin-bottom:8px"><div id="rmGifRes" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-height:260px;overflow:auto"></div><p class="calendar-note" style="margin:6px 0 0">Powered by GIPHY</p>'; gifSearch('');
}
async function gifSearch(q){
  const res = $('rmGifRes'); if(!res || !CFG.giphy_key) return;
  try{ const r = await fetch('https://api.giphy.com/v1/gifs/' + (q ? 'search' : 'trending') + '?api_key=' + encodeURIComponent(CFG.giphy_key) + '&limit=18&rating=pg' + (q ? '&q=' + encodeURIComponent(q) : '')); const j = await r.json();
    res.innerHTML = (j.data || []).map(g => `<img src="${e(g.images.fixed_height_small.url)}" data-gif="${e(g.id)}" alt="" style="width:100%;height:90px;object-fit:cover;border-radius:6px;cursor:pointer">`).join('') || '<p class="calendar-note">No GIFs found.</p>'; }catch(err){ res.innerHTML = '<p class="calendar-note">GIF search is not available right now.</p>'; }
}
function pollForm(){
  const box = $('rmPollBox'); if(!box) return; if(box.dataset.open === '1'){ box.style.display = 'none'; box.dataset.open = ''; return; }
  box.dataset.open = '1'; box.style.display = 'block'; const inp = (id, ph) => `<input id="${id}" placeholder="${ph}" maxlength="100" autocomplete="off" style="width:100%;box-sizing:border-box;margin-bottom:6px">`;
  box.innerHTML = `${inp('rmPq', 'Poll question')}<div id="rmPopts">${inp('rmPo0', 'Option 1')}${inp('rmPo1', 'Option 2')}</div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="rr-btn ghost sm" id="rmPoAdd">+ Add option</button><label style="font-size:13px;display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="rmPMulti" style="width:auto"> Allow several answers</label><button class="rr-btn sm" id="rmPoGo" style="margin-left:auto">Post poll</button></div>`;
}
async function pollCreate(){
  const n = $('rmNote'), q = ($('rmPq').value || '').trim(), opts = [...document.querySelectorAll('#rmPopts input')].map(x => x.value.trim()).filter(Boolean);
  if(!q || opts.length < 2){ n.textContent = 'Enter a question and at least two options.'; return; }
  const r = await api('/rest/v1/ttm_room_msgs', {method: 'POST', headers: {Prefer: 'return=minimal'}, body: JSON.stringify({room: RM.room, body: '📊 ' + q, poll: {q, opts: opts.slice(0, 10), multi: !!$('rmPMulti').checked}})});
  if(!r.ok){ n.textContent = 'Could not post the poll. Run the polls step (supabase/polls.sql) in Supabase.'; return; }
  const b = $('rmPollBox'); b.style.display = 'none'; b.dataset.open = ''; n.textContent = 'Poll posted.'; await rmLoad(true); const l = $('rmList'); if(l) l.scrollTop = l.scrollHeight;
}
function rxHtml(m){
  const l = RM.rx[m.id] || [], by = {}; l.forEach(x => { (by[x.emoji] = by[x.emoji] || []).push(x.user_id); });
  let h = Object.keys(by).map(k => `<button class="rm-rx${USER && by[k].includes(USER.id) ? ' me' : ''}" data-rx="${m.id}|${k}">${k} ${by[k].length}</button>`).join('');
  h += RM.rxpick === m.id ? RXS.map(k => `<button class="rm-rx" data-rx="${m.id}|${k}">${k}</button>`).join('') : `<button class="rm-rx add" data-rxopen="${m.id}" title="React">☺ +</button>`;
  return `<div class="rm-rxw">${h}</div>`;
}
function rmBuild(){
  const root = $('rmApp'); if(!root) return false;
  if(!USER){ root.innerHTML = '<div class="rr-card"><p style="margin:0 0 10px">Sign in to join the chat rooms.</p><button class="rr-btn sm" id="memSignIn">Sign in</button></div>'; RM.built = false; return false; }
  if(RM.built && root.querySelector('#rmList')) return true;
  const tabs = ROOMS.map(r => `<button class="filter-chip" data-rmtab="${r[0]}" ${rmCan(r[0]) ? '' : 'style="opacity:.45"'}>${r[1]}${rmCan(r[0]) ? '' : ' 🔒'}</button>`).join('');
  root.innerHTML = `<div class="filter-row" id="rmTabs" style="margin-bottom:8px">${tabs}</div>
    <p class="calendar-note" id="rmOnline" style="margin:0 0 8px"></p>
    <div class="filter-row" id="rmFilt" style="margin:0 0 8px"><button class="filter-chip" data-rmf="all">Everyone</button><button class="filter-chip" data-rmf="follow">Only people I follow</button></div>
    <div class="rr-card" style="padding:0;overflow:hidden"><div id="rmList" style="height:min(60vh,520px);overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px"></div>
      <div id="rmPrev" style="display:none;padding:8px 12px;border-top:1px solid var(--line)"></div>
      <div id="rmGifBox" style="display:none;padding:8px 10px;border-top:1px solid var(--line)"></div>
      <div id="rmPollBox" style="display:none;padding:10px;border-top:1px solid var(--line)"></div>
      ${ROOMS.filter(r => rmCan(r[0])).length > 1 ? `<div id="rmTo" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:8px 12px;border-top:1px solid var(--line);font-size:13px"><b>Send to:</b>${ROOMS.filter(r => rmCan(r[0])).map(r => `<label style="display:flex;gap:5px;align-items:center;cursor:pointer"><input type="checkbox" class="rmToBox" value="${r[0]}"> ${r[1]}</label>`).join('')}<button class="rr-btn ghost sm" id="rmToAll" type="button">All my rooms</button></div>` : ''}
      <div id="rmEmoBox" style="display:none;padding:8px 10px;border-top:1px solid var(--line);flex-wrap:wrap;gap:4px">${EMO.map(k => `<button class="rm-rx" data-emo="${k}" style="font-size:18px">${k}</button>`).join('')}</div>
      <div id="rmInRow" style="display:flex;flex-wrap:wrap;gap:8px;padding:10px;border-top:1px solid var(--line);align-items:flex-end"><button class="rr-btn ghost sm" id="rmEmoBtn" title="Emoji">😊</button><button class="rr-btn ghost sm" id="rmGifBtn" title="GIF">GIF</button>${PROF && PROF.is_admin ? '<button class="rr-btn ghost sm" id="rmPollBtn" title="Create a poll">Poll</button>' : ''}<button class="rr-btn ghost sm" id="rmMicBtn" title="Record a voice note">🎤 Voice</button><button class="rr-btn ghost sm" id="rmImgBtn" title="Add a screenshot">Image</button><input type="file" id="rmFile" accept="image/*" style="display:none"><textarea id="rmIn" rows="2" spellcheck="true" autocorrect="on" autocapitalize="sentences" autocomplete="on" maxlength="1000" placeholder="Write a message. Paste a TradingView snapshot link or an image." style="flex:1;resize:none;background:rgba(255,255,255,.05);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:9px 10px;font:inherit;font-size:14px;max-height:120px"></textarea><button class="rr-btn sm" id="rmSend">Send</button></div></div>
    <p class="calendar-note" id="rmNote" style="margin:8px 0 0">Be respectful. TTM can remove messages and mute members, and can see who has read its messages (switch off \u201cShow me as online\u201d in your settings to stay private). You can edit your own messages. Nothing here is financial advice.</p>`;
  $('rmIn').addEventListener('keydown', ev => { if(ev.key === 'Enter' && !ev.shiftKey){ ev.preventDefault(); rmSend(); } });
  $('rmIn').addEventListener('paste', ev => { const it = Array.from((ev.clipboardData || {}).items || []).find(x => x.type && x.type.indexOf('image/') === 0); if(it){ ev.preventDefault(); rmPick1(it.getAsFile()); } });
  if(!window.__rmDD){ window.__rmDD = 1;
    const live = () => $('rmApp') && location.hash === '#community';
    ['dragenter', 'dragover'].forEach(e => document.addEventListener(e, ev => { if(!live()) return; ev.preventDefault(); if(ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'; $('rmApp').style.outline = '2px dashed var(--accent,#4da3ff)'; }));
    document.addEventListener('dragleave', ev => { if(live() && !ev.relatedTarget) $('rmApp').style.outline = ''; });
    document.addEventListener('drop', ev => { if(!live()) return; ev.preventDefault(); $('rmApp').style.outline = ''; const n = $('rmNote'), fl = Array.from((ev.dataTransfer || {}).files || []);
      const f = fl.find(x => /^image\/(png|jpeg|gif|webp)$/.test(x.type) || /\.(png|jpe?g|gif|webp)$/i.test(x.name));
      if(f) rmPick1(f.type ? f : new File([f], f.name, {type: /gif$/i.test(f.name) ? 'image/gif' : /png$/i.test(f.name) ? 'image/png' : /webp$/i.test(f.name) ? 'image/webp' : 'image/jpeg'}));
      else if(n) n.textContent = fl.length ? 'Drop a PNG, JPG, GIF or WebP image from your computer.' : 'That drop was a link, not a file. Save the GIF to your computer first, or paste its link in the message box.'; }); }
  $('rmFile').addEventListener('change', ev => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if(f) rmPick1(f); });
  RM.built = true; presBeat().then(presLoad); return true;
}
function rmFiltPaint(){ document.querySelectorAll('#rmFilt [data-rmf]').forEach(b => b.classList.toggle('active', b.dataset.rmf === (PREFS.rfilter === 'follow' ? 'follow' : 'all'))); }
function rmTabs(){ rmFiltPaint(); document.querySelectorAll('#rmTabs [data-rmtab]').forEach(b => { const k = b.dataset.rmtab; b.classList.toggle('active', k === RM.room); const lab = (ROOMS.find(r => r[0] === k) || [0, k])[1] + (rmCan(k) ? '' : ' 🔒') + (RMU[k] && k !== RM.room ? ` (${RMU[k]})` : ''); if(b.textContent !== lab) b.textContent = lab; }); }
function rmPick(r){ if(!rmCan(r)){ const n = $('rmNote'); if(n) n.textContent = 'The ' + (ROOMS.find(x => x[0] === r) || [0, r])[1] + ' room is for ' + needText('room:' + r) + ' members.'; return; } RM.room = r; RM.sig = ''; document.querySelectorAll('.rmToBox').forEach(c => { c.checked = c.value === r; }); rmTabs(); const l = $('rmList'); if(l) l.innerHTML = ''; rmLoad(true); }
async function rmLoad(force){
  if(!rmBuild()) return; if(!RM.room){ RM.room = (ROOMS.find(r => rmCan(r[0])) || ['free'])[0]; document.querySelectorAll('.rmToBox').forEach(c => { c.checked = c.value === RM.room; }); rmTabs(); }
  if(RM.busy || RM.editing) return; RM.busy = true;
  try{
    const r = await api(`/rest/v1/ttm_room_msgs?select=*&room=eq.${RM.room}&order=id.desc&limit=80`);
    const l = $('rmList'); if(!l) return;
    { const ro = rmRO(); document.body.classList.toggle('rm-ro', ro); let nt = $('rmRoNote'); if(ro && !nt){ const row = $('rmInRow'); if(row){ nt = document.createElement('div'); nt.id = 'rmRoNote'; nt.style.cssText = 'padding:12px;border-top:1px solid var(--line);font-size:13px;color:var(--mute)'; nt.innerHTML = 'Free members can <b>react with emojis</b> but cannot post or reply. <a href="#account" style="color:var(--gold2)">See the plans</a> to join the conversation.'; row.insertAdjacentElement('beforebegin', nt); } } else if(!ro && nt) nt.remove(); }
    if(!r.ok || !Array.isArray(r.json)){ l.innerHTML = '<p style="color:var(--mute);font-size:13px;margin:4px 2px">Could not open this room. If you just upgraded, refresh. The chat database step may also be missing.</p>'; return; }
    { const ids = r.json.map(x => x.id); RM.rx = {}; if(ids.length){ const q = await api('/rest/v1/ttm_room_reacts?select=msg_id,user_id,emoji&msg_id=in.(' + ids.join(',') + ')'); if(q.ok && Array.isArray(q.json)) q.json.forEach(x => { (RM.rx[x.msg_id] = RM.rx[x.msg_id] || []).push(x); }); } }
    { const ids = r.json.filter(x => x.poll).map(x => x.id); RM.votes = {}; if(ids.length){ const q = await api('/rest/v1/ttm_room_votes?select=msg_id,user_id,opt&msg_id=in.(' + ids.join(',') + ')'); if(q.ok && Array.isArray(q.json)) q.json.forEach(x => { (RM.votes[x.msg_id] = RM.votes[x.msg_id] || []).push(x); }); } }
    { RM.seen = {}; const mine = USER && PROF && PROF.is_admin ? r.json.filter(x => x.user_id === USER.id).map(x => x.id) : []; if(mine.length){ const q = await api('/rest/v1/rpc/ttm_seen_counts', {method: 'POST', body: JSON.stringify({rm: RM.room, ids: mine})}); if(q.ok && Array.isArray(q.json)) q.json.forEach(x => { RM.seen[x.id] = x.n; }); } }
    RM.rows = r.json;
    const fol = PREFS.rfilter === 'follow', fids = new Set((PREFS.follow || []).map(f => f.id));
    const rows = r.json.slice().reverse().filter(x => !fol || fids.has(x.user_id) || (USER && x.user_id === USER.id)), sig = (fol ? 'f:' : '') + rows.map(x => x.id + (x.edited_at || '') + ':' + (RM.seen[x.id] != null ? 's' + RM.seen[x.id] : '') + (RM.rx[x.id] || []).map(y => y.emoji + y.user_id.slice(0, 4)).sort().join('')).join(',') + '|' + RM.rxpick + '|' + Object.keys(RM.votes || {}).map(k => k + ':' + RM.votes[k].length + RM.votes[k].filter(v => USER && v.user_id === USER.id).map(v => v.opt).join('')).join(','); if(rows.length && location.hash === '#community' && !document.hidden){ rmSeenSet(RM.room, rows[rows.length - 1].id); rmReadPing(RM.room, r.json.length ? r.json[0].id : 0); RMU[RM.room] = 0; commBtn(); rmTabs(); }
    if(sig === RM.sig && !force) return; RM.sig = sig;
    const near = l.scrollHeight - l.scrollTop - l.clientHeight < 80, first = !l.children.length, adm = !!(PROF && PROF.is_admin);
    l.innerHTML = rows.length ? rows.map(m => { const mine = USER && m.user_id === USER.id, tm = new Date(m.ts).toLocaleString([], {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
      return `<div class="rm-m ${mine ? 'me' : ''}"><div class="rm-h"><b ${mine ? '' : `data-rmat="${e(m.name || '')}" title="Tap to tag"`}>${e(m.name || 'Member')}</b>${bdgHtml(m)}<span>${tm}${m.edited_at ? ' \u00b7 edited' : ''}</span>${mine && !m.poll ? `<u data-rmedit="${m.id}">edit</u>` : ''}${mine && RM.seen[m.id] != null ? `<u data-rmseen="${m.id}">seen by ${RM.seen[m.id]}</u>` : ''}${rmReplyLink(m)}${mine || adm ? `<u data-rmdel="${m.id}">delete</u>` : ''}${adm && !mine ? `<u data-rmmute="${m.user_id}">mute</u>` : ''}${!mine ? `<u data-rmfollow="${m.user_id}" data-n="${e(m.name || 'Member')}">${(PREFS.follow || []).some(x => x.id === m.user_id) ? 'following' : 'follow'}</u>` : ''}</div><div class="rm-bd">${rmFmt(m)}</div><div class="rm-sn" id="rmSn${m.id}"></div>${rxHtml(m)}</div>`; }).join('') : (fol ? '<p style="color:var(--mute);font-size:13px;margin:4px 2px">No messages from people you follow yet. Switch to Everyone to find people, then press <b>follow</b> on their messages.</p>' : '<p style="color:var(--mute);font-size:13px;margin:4px 2px">No messages yet. Say hello.</p>');
    if(near || first) l.scrollTop = l.scrollHeight;
    if(first){ const mu = await api('/rest/v1/ttm_room_mutes?select=room&user_id=eq.' + USER.id); RM.muted = !!(mu.ok && Array.isArray(mu.json) && mu.json.length); const i = $('rmIn'); if(i && RM.muted){ i.disabled = true; i.placeholder = 'You have been muted by TTM.'; } }
  } finally { RM.busy = false; }
}
function rmPrev(){ const p = $('rmPrev'); if(!p) return; if(RM.rec){ p.style.display = 'flex'; p.style.gap = '10px'; p.style.alignItems = 'center'; p.innerHTML = `<span style="color:#ff5a5a">● Recording</span><b id="rmRecT">0:00</b><button class="rr-btn sm" id="rmRecStop">Stop</button><button class="rr-btn ghost sm" id="rmClrVoice">Cancel</button>`; return; } if(RM.voice){ p.style.display = 'flex'; p.style.gap = '10px'; p.style.alignItems = 'center'; p.innerHTML = `🎤 <audio controls src="${RM.voice.url}" style="height:34px;max-width:230px"></audio><small style="color:var(--mute)">${RM.voice.secs}s</small><button class="rr-btn ghost sm" id="rmClrVoice">Remove</button>`; return; } if(!RM.pend){ p.style.display = 'none'; p.innerHTML = ''; return; } p.style.display = 'flex'; p.style.gap = '10px'; p.style.alignItems = 'center'; p.innerHTML = `<img src="${RM.pend.url}" alt="" style="height:54px;border-radius:6px"><small style="color:var(--mute)">${Math.round(RM.pend.blob.size / 1024)} KB</small><button class="rr-btn ghost sm" id="rmClrImg">Remove</button>`; }
const REC_MAX = 600;
async function rmMic(){
  const n = $('rmNote'); if(RM.rec || RM.voice) return; if(RM.muted) return;
  if(!navigator.mediaDevices || !window.MediaRecorder){ if(n) n.textContent = 'This browser cannot record audio. Try Chrome, Edge, Firefox or Safari 14.3 or newer.'; return; }
  let st; try{ st = await navigator.mediaDevices.getUserMedia({audio: true}); }catch(err){ if(n) n.textContent = 'Microphone is blocked. Allow the microphone for this site in your browser settings, then try again.'; return; }
  const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'], mt = types.find(x => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(x)) || '';
  let mr; try{ try{ mr = mt ? new MediaRecorder(st, {mimeType: mt, audioBitsPerSecond: 48000}) : new MediaRecorder(st, {audioBitsPerSecond: 48000}); }catch(e2){ mr = mt ? new MediaRecorder(st, {mimeType: mt}) : new MediaRecorder(st); } }catch(err){ st.getTracks().forEach(x => x.stop()); if(n) n.textContent = 'Could not start the recorder.'; return; }
  const chunks = [], t0 = Date.now(); RM.rec = {mr, st, t0, cancel: false, tick: null};
  mr.ondataavailable = ev => { if(ev.data && ev.data.size) chunks.push(ev.data); };
  mr.onstop = () => { const rc = RM.rec; clearInterval(rc && rc.tick); st.getTracks().forEach(x => x.stop()); const cancel = rc && rc.cancel; RM.rec = null;
    if(cancel || !chunks.length){ rmPrev(); return; }
    const type = (mr.mimeType || mt || 'audio/webm').split(';')[0], blob = new Blob(chunks, {type}), secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
    if(blob.size > 8e6){ if(n) n.textContent = 'That voice note is too long. Keep it under 10 minutes.'; rmPrev(); return; }
    RM.voice = {blob, url: URL.createObjectURL(blob), secs, type}; rmPrev(); };
  mr.start(); RM.rec.tick = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000), el = $('rmRecT'); if(el) el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); if(s >= REC_MAX) rmRecStop(); }, 250);
  if(n) n.textContent = ''; rmPrev();
}
function rmRecStop(){ if(RM.rec && RM.rec.mr.state !== 'inactive') RM.rec.mr.stop(); }
function rmRecDrop(){ if(RM.rec){ RM.rec.cancel = true; if(RM.rec.mr.state !== 'inactive') RM.rec.mr.stop(); else RM.rec = null; return; } RM.voice = null; rmPrev(); }
async function rmPick1(file){
  const n = $('rmNote'); if(!file || file.type.indexOf('image/') !== 0){ if(n) n.textContent = 'Pick an image file.'; return; }
  if(file.type === 'image/gif'){ if(file.size > 2e6){ if(n) n.textContent = 'That GIF is over 2 MB. Try a shorter one, or paste a Giphy or Tenor link instead.'; return; } RM.pend = {blob: file, url: URL.createObjectURL(file)}; rmPrev(); return; }
  try{ const bmp = await createImageBitmap(file), sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    let blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86)); if(blob && blob.size > 1.9e6) blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.6));
    if(!blob || blob.size > 2e6){ if(n) n.textContent = 'That image is too large. Try a smaller screenshot.'; return; }
    RM.pend = {blob, url: URL.createObjectURL(blob)}; rmPrev(); }catch(err){ if(n) n.textContent = 'Could not read that image.'; }
}
async function rmSend(){
  if(RM.sending || RM.muted) return; const i = $('rmIn'), n = $('rmNote'), body = (i.value || '').trim(); if(!body && !RM.pend && !RM.voice) return; if(!RM.room || RM.rec) return;
  RM.sending = true; n.textContent = RM.pend || RM.voice ? 'Uploading…' : 'Sending…';
  try{
    let img = null, audio = null, audio_secs = null;
    if(RM.voice){ const t = await token(), ext = RM.voice.type === 'audio/mp4' ? 'm4a' : RM.voice.type === 'audio/ogg' ? 'ogg' : 'webm', path = USER.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const up = await fetch(CFG.url + '/storage/v1/object/room-voice/' + path, {method: 'POST', headers: {apikey: CFG.key, Authorization: 'Bearer ' + t, 'Content-Type': RM.voice.type}, body: RM.voice.blob});
      if(!up.ok){ n.textContent = 'Could not upload the voice note. The voice database step may not be set up yet.'; return; }
      audio = CFG.url + '/storage/v1/object/public/room-voice/' + path; audio_secs = RM.voice.secs; }
    if(RM.pend){ const t = await token(), mime = RM.pend.blob.type === 'image/gif' ? 'image/gif' : 'image/jpeg', path = USER.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + (mime === 'image/gif' ? '.gif' : '.jpg');
      const up = await fetch(CFG.url + '/storage/v1/object/room-pending/' + path, {method: 'POST', headers: {apikey: CFG.key, Authorization: 'Bearer ' + t, 'Content-Type': mime}, body: RM.pend.blob});
      if(!up.ok){ n.textContent = 'Could not upload the image. The scan step may not be set up yet, or it is over 2 MB.'; return; }
      n.textContent = 'Scanning image…';
      let sc = null; try{ const r = await fetch(CFG.url + '/functions/v1/scan-image', {method: 'POST', headers: {apikey: CFG.key, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json'}, body: JSON.stringify({path, type: mime})}); sc = await r.json(); }catch(e){}
      if(!sc || !sc.ok){ n.textContent = sc && sc.reason ? 'Image blocked: ' + sc.reason + '.' : 'Could not scan the image, so it was not sent. Try again.'; RM.pend = null; rmPrev(); return; }
      img = sc.url; }
    let rooms = [RM.room]; { const ck = Array.from(document.querySelectorAll('.rmToBox:checked')).map(c => c.value).filter(rmCan); if(ck.length) rooms = ck; }
    const ORD = {pro: 0, premium: 1, free: 2}; rooms = rooms.slice().sort((x, y) => (ORD[x] == null ? 9 : ORD[x]) - (ORD[y] == null ? 9 : ORD[y]));
    let r = null, done = 0;
    for(let k = 0; k < rooms.length; k++){
      if(k > 0){ n.textContent = 'Sent to ' + rooms[k - 1] + '. Next: ' + rooms[k] + '…'; await new Promise(z => setTimeout(z, 3500)); }
      r = await api('/rest/v1/ttm_room_msgs', {method: 'POST', headers: {Prefer: 'return=minimal'}, body: JSON.stringify([{room: rooms[k], body: RM.reply ? ('>> ' + RM.reply.name.replace(/[|\n]/g, ' ').slice(0, 40) + ' | ' + RM.reply.snip.replace(/[\n]/g, ' ').slice(0, 140) + '\n' + body).slice(0, 1000) : body, img, audio, audio_secs}])});
      if(!r.ok) break; done++;
    }
    if(!r.ok){ const m = JSON.stringify(r.json || ''); n.textContent = (done ? 'Sent to ' + done + ' of ' + rooms.length + ' rooms. ' : '') + (/Slow down/i.test(m) ? 'Slow down a little, one message every few seconds.' : 'You cannot post in one of these rooms (muted, or not included in your plan).'); if(done){ i.value = ''; RM.pend = null; RM.voice = null; rmPrev(); await rmLoad(true); } return; }
    i.value = ''; RM.reply = null; rmReplyBar(); RM.pend = null; RM.voice = null; rmPrev(); n.textContent = rooms.length > 1 ? 'Sent to ' + rooms.length + ' rooms.' : ''; await rmLoad(true); const l = $('rmList'); if(l) l.scrollTop = l.scrollHeight;
  } finally { RM.sending = false; }
}
window.ttmPostImage = async function(blob, text){
  if(!chatOK || !rmCan('free') && !rmCan('premium') && !rmCan('pro')){ alert('Sign in to post in the chat rooms.'); return; }
  if(!document.getElementById('community')){ const fr = new FileReader(); fr.onload = () => { try{ sessionStorage.setItem('ttm_pend_chart', JSON.stringify({d: fr.result, t: text || ''})); }catch(x){ alert('That chart is too large to send from here. Use the Image button and add it in the chat by hand.'); return; } location.href = BASE + 'crypto/index.html#community'; }; fr.readAsDataURL(blob); return; }
  location.hash = '#community'; for(let k = 0; k < 40 && !$('rmIn'); k++) await new Promise(z => setTimeout(z, 250));
  const i = $('rmIn'); if(!i){ alert('The chat rooms did not open. Use the Download image button and add it by hand.'); return; }
  await rmPick1(new File([blob], 'chart.png', {type: 'image/png'})); if(!i.value) i.value = text || '';
  const n = $('rmNote'); if(n) n.textContent = 'Chart added. Tick the rooms under "Send to" (Pro goes out first, then Premium, then Free), then press Send.';
};
setTimeout(async () => { let v = null; try{ v = JSON.parse(sessionStorage.getItem('ttm_pend_chart') || 'null'); }catch(x){} if(!v || !document.getElementById('community')) return; try{ sessionStorage.removeItem('ttm_pend_chart'); }catch(x){} for(let k = 0; k < 40 && !(USER && chatOK()); k++) await new Promise(z => setTimeout(z, 400)); const b = await (await fetch(v.d)).blob(); window.ttmPostImage(b, v.t); }, 1500);
function rmStart(){ if(!$('rmApp')) return; clearInterval(RM.timer); RM.timer = setInterval(() => { if(!document.hidden && location.hash === '#community') rmLoad(false); }, 4000); }
function rmAdminHtml(){ return `<div class="rr-card"><h3>Chat room mutes</h3><p class="calendar-note" style="margin:0 0 10px">Who can read and write each room is set in the access table above (rows "Chat room"). Muted members can still read but cannot post. Mute someone below, or press <b>mute</b> on any of their messages in the room. Delete any message with <b>delete</b> (tap twice).</p>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px"><input id="rmMuteWho" placeholder="@telegram name or email" autocomplete="off" style="flex:1;min-width:180px"><select id="rmMuteRoom"><option value="all">All rooms</option><option value="free">Free room</option><option value="premium">Premium room</option><option value="pro">Pro room</option></select><button class="rr-btn sm" id="rmMuteBtn">Mute</button></div><p class="calendar-note" id="rmMuteNote" style="margin:0 0 8px"></p><div id="rmMutes"></div></div>`; }
async function rmMute(uid, room){ const r = await api('/rest/v1/ttm_room_mutes', {method: 'POST', headers: {Prefer: 'resolution=ignore-duplicates,return=minimal'}, body: JSON.stringify({user_id: uid, room})}); rmMutesLoad(); return r.ok; }
async function rmMuteForm(){
  const n = $('rmMuteNote'), q = (($('rmMuteWho') || {}).value || '').trim().replace(/^@+/, '').replace(/[^A-Za-z0-9_.@+-]/g, ''); if(!q){ n.textContent = 'Type a Telegram name or email first.'; return; }
  const r = await api(`/rest/v1/ttm_profiles?select=id,email,tg_handle&or=(email.ilike.${encodeURIComponent(q)},tg_handle.ilike.${encodeURIComponent(q)})&limit=5`);
  if(!r.ok || !Array.isArray(r.json) || !r.json.length){ n.textContent = 'No member found with that name or email.'; return; }
  if(r.json.length > 1){ n.textContent = 'More than one match. Type the full name or email.'; return; }
  const ok = await rmMute(r.json[0].id, $('rmMuteRoom').value); n.textContent = ok ? 'Muted ' + (r.json[0].tg_handle ? '@' + r.json[0].tg_handle : r.json[0].email) + '.' : 'Could not mute. Run the community update SQL in Supabase.'; if(ok) $('rmMuteWho').value = '';
}
async function rmMutesLoad(){
  const box = $('rmMutes'); if(!box) return; const r = await api('/rest/v1/ttm_room_mutes?select=user_id,room,created&order=created.desc&limit=100');
  if(!r.ok){ box.innerHTML = '<div class="rr-warn y"><b>One database step is missing.</b> Run supabase/rooms.sql in the Supabase SQL editor, then refresh.</div>'; return; }
  const rows = r.json || []; if(!rows.length){ box.innerHTML = '<p class="calendar-note" style="margin:0">Nobody is muted.</p>'; return; }
  const p = await api('/rest/v1/ttm_profiles?select=id,email,tg_handle&id=in.(' + rows.map(x => x.user_id).join(',') + ')'), who = {}; (p.json || []).forEach(x => { who[x.id] = x.tg_handle ? '@' + String(x.tg_handle).replace(/^@/, '') : x.email; });
  box.innerHTML = rows.map(x => `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--line)"><span>${e(who[x.user_id] || x.user_id)} <small style="color:var(--mute)">· ${x.room === 'all' ? 'all rooms' : e(x.room) + ' room'}</small></span><button class="rr-btn ghost sm" data-rmunmute="${e(x.user_id)}" data-rmroom="${e(x.room)}">Unmute</button></div>`).join('');
}
const cssRO = document.createElement('style'); cssRO.textContent = '.rm-ro #rmInRow,.rm-ro #rmPollBox,.rm-ro #rmReplyBar,.rm-ro #rmMuteBox{display:none!important}'; document.head.appendChild(cssRO);
const css3 = document.createElement('style');
css3.textContent = `.rm-q{border-left:3px solid var(--gold,#dba118);background:rgba(255,255,255,.05);border-radius:6px;padding:4px 8px;margin:0 0 6px;font-size:12.5px;color:var(--mute,#9a968c);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rm-q b{color:var(--gold,#dba118);margin-right:4px}#rmIn{min-width:0}@media(max-width:700px){#rmInRow{gap:6px!important}#rmIn{order:-1;flex:1 1 100%!important;width:100%;box-sizing:border-box;min-height:96px;max-height:40vh;font-size:17px!important;line-height:1.4;padding:12px!important}#rmInRow .rr-btn{flex:0 0 auto}.rm-h{flex-wrap:wrap;row-gap:4px}.rm-h u,.rm-h b,.rm-h span{white-space:nowrap}}body.rm-full #ttmChatBtn,body.rm-full #ttmCommBtn,body.rm-full #ttmInbox{display:none!important}.rm-badge{font-style:normal;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;border-radius:999px;padding:1px 7px;margin-left:6px;vertical-align:1px;white-space:nowrap}.rm-badge.ttm{background:var(--gold,#dba118);color:#111}.rm-badge.team{background:rgba(77,163,255,.18);color:#6db4ff;border:1px solid rgba(77,163,255,.5)}.rm-badge.alpha{background:rgba(224,85,77,.18);color:#ff8a82;border:1px solid rgba(224,85,77,.55)}.rm-badge.mindset{background:rgba(160,110,255,.18);color:#c3a2ff;border:1px solid rgba(160,110,255,.55)}.rm-badge.mod{background:rgba(63,180,122,.18);color:#6fdba6;border:1px solid rgba(63,180,122,.55)}.rm-badge.founding{background:transparent;color:var(--gold2,#f2c14e);border:1px solid var(--gold,#dba118)}.bdg-chip{background:transparent;border:1px solid var(--line);color:var(--mute);border-radius:999px;padding:2px 8px;font:inherit;font-size:11px;cursor:pointer;margin:1px}.bdg-chip.on{background:var(--gold,#dba118);border-color:var(--gold,#dba118);color:#111;font-weight:700}.rm-m{max-width:88%;align-self:flex-start;background:rgba(255,255,255,.06);border-radius:12px;padding:8px 11px;font-size:14px;line-height:1.45;word-break:break-word}.rm-m.me{align-self:flex-end;background:rgba(219,161,24,.18)}.rm-h{display:flex;gap:8px;align-items:baseline;margin-bottom:2px;font-size:12px;color:var(--mute,#9a978f)}.rm-h b{color:var(--gold2,#f2c14e);font-size:13px}.rm-h u{cursor:pointer;text-decoration:none;color:var(--text,#e8e6e1);font-size:11px;border:1px solid var(--line,#2a2a2e);border-radius:6px;padding:1px 7px;margin-left:auto}.rm-h u+u{margin-left:0}.rm-h u:hover{color:#e0554d}.rm-img{display:block;max-width:100%;max-height:340px;border-radius:8px;margin-top:6px}.rm-m a{color:var(--gold2,#f2c14e)}.rm-poll{margin:4px 0 2px;min-width:230px}.rm-pq{font-weight:700;margin-bottom:2px}.rm-pm{font-size:12px;color:var(--mute,#9a978f);margin-bottom:6px}.rm-po{position:relative;display:flex;justify-content:space-between;gap:10px;width:100%;text-align:left;background:rgba(255,255,255,.05);border:1px solid var(--line,#2a2a2e);color:var(--text,#e8e6e1);border-radius:8px;padding:7px 10px;margin:0 0 5px;font:inherit;font-size:13.5px;cursor:pointer;overflow:hidden}.rm-po.me{border-color:var(--gold,#dba118)}.rm-pb{position:absolute;left:0;top:0;bottom:0;background:rgba(219,161,24,.22);z-index:0}.rm-pt,.rm-pn{position:relative;z-index:1}.rm-pn{color:var(--mute,#9a978f);font-size:12px;white-space:nowrap}.rm-rxw{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.rm-rx{background:rgba(255,255,255,.06);border:1px solid var(--line,#2a2a2e);color:var(--text,#e8e6e1);border-radius:999px;padding:1px 9px;font:inherit;font-size:13px;cursor:pointer;line-height:1.6}.rm-rx.me{border-color:var(--gold,#dba118);background:rgba(219,161,24,.2)}.rm-rx.add{opacity:.6;font-size:12px}.rm-rx:hover{border-color:var(--gold,#dba118)}.rm-at{color:var(--gold2,#f2c14e);background:rgba(219,161,24,.15);border-radius:4px;padding:0 3px}.rm-h b[data-rmat]{cursor:pointer}`;
css3.textContent += `.rm-ed textarea{width:100%;resize:vertical;background:rgba(255,255,255,.06);border:1px solid var(--gold,#dba118);color:var(--text);border-radius:8px;padding:8px;font:inherit}.rm-sn{margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;align-items:center}.rm-sn:empty{display:none}.rm-sw{border:1px solid var(--line);border-radius:999px;padding:1px 8px;font-size:11.5px;color:var(--text)}.rm-vn{display:flex;align-items:center;gap:8px;margin-top:6px}.rm-vn audio{height:36px;max-width:260px;width:100%}.rm-vn small{color:var(--mute)}`;
document.head.appendChild(css3);
window.addEventListener('hashchange', () => { if(location.hash === '#community'){ RM.built = false; setTimeout(() => { rmLoad(true); }, 120); } });
setTimeout(() => { rmStart(); if(location.hash === '#community') rmLoad(true); }, 1500);


// ---------- Token unlocks (beta) ----------
const UN = {rows: [], px: null, f: '30', edit: null, t: null};
const unUsd = v => v == null || !isFinite(v) ? '—' : v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : '$' + Math.round(v).toLocaleString();
const unNum = v => v == null ? '—' : v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.round(v).toLocaleString();
function unLeft(ms){ if(ms <= 0) return 'now'; const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4); return d >= 2 ? d + ' days' : d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + ' min'; }
async function unLoad(){
  if(!on() || !USER || !isTester()) return; const root = $('unApp');
  if(!UN.px){ try{ const r = await fetch(BASE + 'top_coins.json?' + Date.now()); const j = await r.json(); UN.px = {}; (j.coins || []).forEach(c => { UN.px[c.s] = c.p; }); }catch(err){ UN.px = {}; } }
  const r = await api('/rest/v1/ttm_unlocks?select=*&order=unlock_at.asc&limit=500');
  if(!r.ok){ root.innerHTML = '<div class="rr-warn y"><b>One database step is missing.</b> Ask TTM to run supabase/unlocks.sql in Supabase.</div>'; return; }
  UN.rows = r.json || []; unEvents(); unPaint();
}
function unEvents(){
  const adm = !!(PROF && PROF.is_admin), now = Date.now();
  window.TTM_UNLOCK_EVENTS = UN.rows.map(x => { const t = Date.parse(x.unlock_at), p = UN.px && UN.px[String(x.token).toUpperCase()], v = p && x.amount ? p * x.amount : null, dt = new Date(t).toISOString().slice(0, 10);
    const bits = [x.name || '', x.amount ? unNum(x.amount) + ' tokens' : '', x.pct != null ? Number(x.pct).toFixed(2) + '% of supply' : '', v ? '≈' + unUsd(v) : '', x.kind || '', x.note || ''].filter(Boolean).join(' · ');
    return {date: new Date(t).toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'}), dt, type: 'unlock', type_label: 'Unlock', token: String(x.token).toUpperCase(), name: bits || 'Token unlock', link: adm && x.link && /^https?:\/\//.test(x.link) ? x.link : '', source: 'TTM'}; });
  if(window.teMerge) window.teMerge();
}
function unPaint(){
  const root = $('unApp'); if(!root) return; if(!(PROF && PROF.is_admin)){ root.innerHTML = ''; return; } const now = Date.now(), adm = true, lim = UN.f === 'all' ? 1e15 : +UN.f * 864e5;
  const l = UN.rows.filter(x => { const t = Date.parse(x.unlock_at); return t > now - 864e5 && t - now <= lim; });
  const chips = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All']].map(c => `<button class="filter-chip ${UN.f === c[0] ? 'active' : ''}" data-unf="${c[0]}">${c[1]}</button>`).join('');
  const tot = l.reduce((t, x) => { const p = UN.px && UN.px[String(x.token).toUpperCase()]; return t + (p && x.amount ? p * x.amount : 0); }, 0);
  const rows = l.map(x => { const t = Date.parse(x.unlock_at), p = UN.px && UN.px[String(x.token).toUpperCase()], v = p && x.amount ? p * x.amount : null, soon = t - now < 864e5 * 2;
    return `<tr><td><b>${e(String(x.token).toUpperCase())}</b>${x.name ? `<br><small style="color:var(--mute)">${e(x.name)}</small>` : ''}</td><td style="${soon ? 'color:var(--gold2);font-weight:700' : ''}">${unLeft(t - now)}<br><small style="color:var(--mute)">${new Date(t).toLocaleString([], {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})}</small></td><td>${unNum(x.amount)}</td><td>${x.pct == null ? '—' : Number(x.pct).toFixed(2) + '%'}</td><td>${unUsd(v)}</td><td>${e(x.kind || '')}${x.note ? `<br><small style="color:var(--mute)">${e(x.note)}</small>` : ''}${adm && x.link && /^https?:\/\//.test(x.link) ? `<br><a href="${e(x.link)}" target="_blank" rel="noopener noreferrer" style="color:var(--gold2)">source</a>` : ''}</td>${adm ? `<td style="white-space:nowrap"><u data-unedit="${x.id}" style="cursor:pointer">edit</u> · <u data-undel="${x.id}" style="cursor:pointer">delete</u></td>` : ''}</tr>`; }).join('');
  const ed = UN.edit != null ? (UN.rows.find(x => x.id === UN.edit) || {}) : {}, dt = ed.unlock_at ? new Date(Date.parse(ed.unlock_at) - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';
  const inp = (id, ph, v, ty, w) => `<input id="${id}" type="${ty || 'text'}" placeholder="${ph}" value="${e(v == null ? '' : v)}" ${ty === 'number' ? 'step="any" inputmode="decimal"' : ''} style="${w ? 'width:' + w + ';' : ''}min-width:90px">`;
  const form = adm ? `<div class="rr-card" style="margin-top:14px"><h3>${UN.edit != null ? 'Edit unlock' : 'Add an unlock'} <small style="font-weight:400;color:var(--mute)">(admin only)</small></h3><div style="display:flex;gap:8px;flex-wrap:wrap">${inp('unTok', 'Ticker e.g. OP', ed.token, 0, '90px')}${inp('unName', 'Name (optional)', ed.name)}<input id="unAt" type="datetime-local" value="${dt}">${inp('unAmt', 'Tokens unlocking', ed.amount, 'number')}${inp('unPct', '% of supply', ed.pct, 'number', '110px')}${inp('unKind', 'Type e.g. team', ed.kind)}${inp('unNote', 'Note', ed.note)}${inp('unLink', 'Source link', ed.link)}</div><div style="display:flex;gap:8px;margin-top:10px"><button class="rr-btn sm" id="unSave">${UN.edit != null ? 'Save changes' : 'Add unlock'}</button>${UN.edit != null ? '<button class="rr-btn ghost sm" id="unCancel">Cancel</button>' : ''}<span class="calendar-note" id="unNote" style="margin:0"></span></div><p class="calendar-note" style="margin:8px 0 0">The date is in your own time zone. Members with beta access get a phone alert 7 days and 24 hours before each unlock, if they leave the setting on.</p></div>` : '';
  root.innerHTML = `<h3 style="margin:16px 0 4px;font-size:15px">TTM unlock list <small style="font-weight:400;color:var(--mute)">admin: add, edit and delete. Beta testers see these in the table below.</small></h3><div class="filter-row" style="margin:6px 0 10px">${chips}</div><p class="calendar-note" style="margin:0 0 8px">${l.length} unlock${l.length === 1 ? '' : 's'} in this window${tot ? ' · about ' + unUsd(tot) + ' at current prices' : ''}</p>${l.length ? `<div class="rr-wrap"><table class="rr-tbl"><thead><tr><th>Token</th><th>Unlocks in</th><th>Tokens</th><th>% of supply</th><th>Value now</th><th>Details</th>${adm ? '<th></th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="calendar-note">Nothing listed in this window yet.</p>'}${form}<p class="calendar-note" style="margin:10px 0 0">Education only, not financial advice. Unlock schedules can change and a scheduled unlock does not mean the tokens will be sold.</p>`;
}
document.addEventListener('click', async ev => { const t = ev.target; if(!t || !t.dataset && !t.id) return;
  if(t.dataset && t.dataset.unf){ UN.f = t.dataset.unf; unPaint(); }
  else if(t.dataset && t.dataset.unedit){ UN.edit = +t.dataset.unedit; unPaint(); const f = $('unTok'); if(f) f.scrollIntoView({block: 'center'}); }
  else if(t.dataset && t.dataset.undel){ if(!armTap(t, 'tap again to delete')) return; await api('/rest/v1/ttm_unlocks?id=eq.' + t.dataset.undel, {method: 'DELETE'}); unLoad(); }
  else if(t.id === 'unCancel'){ UN.edit = null; unPaint(); }
  else if(t.id === 'unSave'){ const n = $('unNote'), tok = ($('unTok').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12), at = $('unAt').value; if(!tok || !at){ n.textContent = 'Enter a ticker and a date.'; return; }
    const num = v => { const x = parseFloat(v); return isFinite(x) ? x : null; }, row = {token: tok, name: ($('unName').value || '').trim().slice(0, 60), unlock_at: new Date(at).toISOString(), amount: num($('unAmt').value), pct: num($('unPct').value), kind: ($('unKind').value || '').trim().slice(0, 40), note: ($('unNote').value || '').trim().slice(0, 140), link: ($('unLink').value || '').trim().slice(0, 300), alerted7: false, alerted1: false};
    n.textContent = 'Saving…'; const r = UN.edit != null ? await api('/rest/v1/ttm_unlocks?id=eq.' + UN.edit, {method: 'PATCH', headers: {Prefer: 'return=minimal'}, body: JSON.stringify(row)}) : await api('/rest/v1/ttm_unlocks', {method: 'POST', headers: {Prefer: 'return=minimal'}, body: JSON.stringify(row)});
    if(r.ok){ UN.edit = null; unLoad(); } else n.textContent = 'Could not save. Run supabase/unlocks.sql in Supabase first.'; }
});
window.addEventListener('hashchange', () => { if(location.hash === '#tokenevents') unLoad(); });
setTimeout(unLoad, 2500); setInterval(() => { if(!document.hidden && UN.edit == null) unLoad(); }, 120000);

// ---------- Disclaimer gate ----------
const DISC_VER = '2026-11-02';
const DISC_HTML = `<h2 style="margin:0 0 12px;color:var(--gold2,#f2c14e);font-size:22px;letter-spacing:.04em">TTM DISCLAIMER</h2>
<p>All content shared within TTM, including the terminal, reports, charts, calculators, alerts, live sessions and community chat, is for <b>educational and informational purposes only</b> and is <b>not financial advice</b>.</p>
<p>TTM is not a licensed financial adviser, and nothing here takes into account your personal objectives, financial situation or needs. Any trade ideas, charts, analysis or market discussions are personal opinions and should not be taken as recommendations to buy or sell any asset. Consider speaking to a licensed adviser before you invest.</p>
<p>Trading and investing involve significant risk, and you may lose some or all of your capital. Past performance does not guarantee future results. Prices, levels, liquidation figures and other data are estimates and can be delayed or wrong. Always do your own research and manage your own risk.</p>
<p>By participating in TTM, you acknowledge that all trading and investment decisions are made at your own risk and responsibility.</p>`;
async function discCheck(){ if(!on() || !USER) return; const r = await api(`/rest/v1/ttm_acceptances?select=id&user_id=eq.${USER.id}&version=eq.${DISC_VER}&limit=1`); if(!r.ok || !Array.isArray(r.json)) return; if(!r.json.length) discShow(); }
function discShow(){
  if($('ttmDisc')) return; const d = document.createElement('div'); d.id = 'ttmDisc';
  d.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
  d.innerHTML = `<div style="max-width:560px;width:100%;background:var(--card,#16161a);border:1px solid var(--gold,#dba118);border-radius:16px;padding:24px;color:var(--text,#e8e6e1);font-size:14.5px;line-height:1.55;box-shadow:0 20px 60px rgba(0,0,0,.7)"><div style="font-weight:800;letter-spacing:.14em;font-size:11px;color:var(--mute,#9a978f);margin-bottom:6px">TRADE THE MOVE</div>${DISC_HTML}
  <label style="display:flex;gap:10px;align-items:flex-start;margin:14px 0;cursor:pointer;font-weight:600"><input type="checkbox" id="discTick" style="width:auto;margin-top:3px"> <span>I have read and understood the TTM disclaimer, and I accept it.</span></label>
  <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="ttm-btn" id="discOk" disabled style="opacity:.5">Accept and continue</button><button class="ttm-btn ghost" id="discOut">Sign out</button></div><p id="discNote" style="margin:10px 0 0;font-size:12px;color:var(--mute,#9a978f)"></p></div>`;
  document.body.appendChild(d);
}
document.addEventListener('change', ev => { if(ev.target && ev.target.id === 'discTick'){ const b = $('discOk'); b.disabled = !ev.target.checked; b.style.opacity = ev.target.checked ? 1 : .5; } });
document.addEventListener('click', async ev => { const t = ev.target; if(!t || !t.id) return;
  if(t.id === 'discOk'){ t.disabled = true; $('discNote').textContent = 'Saving…'; const r = await api('/rest/v1/ttm_acceptances?on_conflict=user_id,version', {method: 'POST', headers: {Prefer: 'resolution=ignore-duplicates,return=minimal'}, body: JSON.stringify({user_id: USER.id, version: DISC_VER})}); if(r.ok){ const d = $('ttmDisc'); if(d) d.remove(); } else { t.disabled = false; $('discNote').textContent = 'Could not save. Check your connection and try again.'; } }
  else if(t.id === 'discOut'){ try{ await api('/auth/v1/logout', {method: 'POST'}); }catch(err){} try{ localStorage.removeItem(AK); localStorage.removeItem(SYNCK); }catch(err){} location.reload(); }
  else if(t.dataset && t.dataset.accdel){ if(!armTap(t, 'tap again to remove')) return; if(await delRow('/rest/v1/ttm_acceptances?id=eq.' + t.dataset.accdel)) discAdminLoad(); }
  else if(t.id === 'accCsv'){ const rows = ACCS_LIST.map(x => [x.email || '', x.tg_handle || '', x.version, x.accepted_at].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')); const blob = new Blob(['Email,Telegram,Version,Accepted\n' + rows.join('\n')], {type: 'text/csv'}); const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob); a2.download = 'ttm-disclaimer-acceptances.csv'; a2.click(); setTimeout(() => URL.revokeObjectURL(a2.href), 2000); }
});
let ACCS_LIST = [];
function discAdminHtml(){ return `<div class="rr-card"><h3>Disclaimer acceptances</h3><p class="calendar-note" style="margin:0 0 10px">Every member ticks the disclaimer before using the terminal. These records stay here until you remove them, even if the member closes their account.</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 8px"><input id="accSearch" placeholder="Search email or name" autocomplete="off" style="flex:1;min-width:180px"><button class="rr-btn ghost sm" id="accCsv">Download CSV</button></div><div id="accList" class="rr-wrap"></div></div>`; }
async function discAdminLoad(){
  const box = $('accList'); if(!box) return; const r = await api('/rest/v1/ttm_acceptances?select=*&order=accepted_at.desc&limit=1000');
  if(!r.ok){ box.innerHTML = '<div class="rr-warn y"><b>One database step is missing.</b> Run supabase/disclaimer.sql in the Supabase SQL editor, then refresh.</div>'; return; }
  ACCS_LIST = r.json || []; discAdminPaint();
}
function discAdminPaint(){
  const box = $('accList'); if(!box) return; const q = (($('accSearch') || {}).value || '').toLowerCase(), l = ACCS_LIST.filter(x => !q || (x.email || '').toLowerCase().includes(q) || (x.tg_handle || '').toLowerCase().includes(q));
  box.innerHTML = l.length ? `<table class="rr-tbl"><thead><tr><th>Email</th><th>X name</th><th>Accepted</th><th>Version</th><th></th></tr></thead><tbody>${l.map(x => `<tr><td>${e(x.email || '')}</td><td>${x.tg_handle ? '@' + e(x.tg_handle) : ''}</td><td>${new Date(x.accepted_at).toLocaleString([], {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'})}</td><td>${e(x.version)}</td><td><u data-accdel="${x.id}" style="cursor:pointer">remove</u></td></tr>`).join('')}</tbody></table>` : '<p class="calendar-note" style="margin:0">No acceptances yet.</p>';
}
document.addEventListener('input', ev => { if(ev.target && ev.target.id === 'chFind'){ CH.q = ev.target.value; chatPaint(); const f = $('chFind'); if(f){ f.focus(); f.setSelectionRange(f.value.length, f.value.length); } } else if(ev.target && ev.target.id === 'accSearch') discAdminPaint(); else if(ev.target && ev.target.id === 'rmGifQ'){ clearTimeout(gifSearch.t); gifSearch.t = setTimeout(() => gifSearch(ev.target.value.trim()), 350); } });

// ---------- Who is online ----------
const PRES = {t: null, list: []};
async function presBeat(){ if(!on() || !USER || document.hidden) return; await api('/rest/v1/ttm_presence?on_conflict=user_id', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'}, body: JSON.stringify({user_id: USER.id, hidden: PREFS.online === false})}); }
async function presLoad(){ const box = $('rmOnline'); if(!box || !USER) return; const since = new Date(Date.now() - 90000).toISOString();
  const r = await api('/rest/v1/ttm_presence?select=user_id,name&hidden=eq.false&seen=gt.' + encodeURIComponent(since) + '&order=name.asc&limit=100');
  if(!r.ok || !Array.isArray(r.json)){ box.textContent = ''; return; } const l = r.json; PRES.list = l;
  box.innerHTML = l.length ? `<span style="color:#3fb47a">●</span> <b>${l.length} online now</b> <span style="color:var(--mute)">· ${l.slice(0, 12).map(x => e(x.name)).join(', ')}${l.length > 12 ? ' and ' + (l.length - 12) + ' more' : ''}</span>` : '<span style="color:var(--mute)">Nobody else is online right now.</span>'; }
setInterval(presBeat, 30000); setInterval(() => { if(location.hash === '#community' && !document.hidden) presLoad(); }, 12000);
document.addEventListener('visibilitychange', () => { if(!document.hidden){ presBeat(); if(location.hash === '#community') presLoad(); } });
setTimeout(presBeat, 3500);

// ---------- Member alert settings ----------
let PREFS = {};
const PREFDEF = [['live', 'Live sessions (new session, 15-minute reminder and live now)', () => true], ['mytrade', 'My trade alerts (TP, SL and stop moves on my own trades)', () => true], ['spot', 'TTM Spot moves (Pro)', () => isPro()], ['chat', 'Replies from TTM in my private chat (Pro)', () => isPro()], ['inbox', 'Private messages from members (admin)', () => !!(PROF && PROF.is_admin)], ['vest', 'Token unlock alerts, 7 days and 24 hours before (beta)', () => !!(PROF && (PROF.is_admin || PROF.beta))], ['luna', 'Eclipse alerts (7 days before and on the day)', () => !!(PROF && (PROF.is_admin || PROF.beta || PROF.team)) || isPro()]];
const ROOMPREF = [['free', 'Free'], ['premium', 'Premium'], ['pro', 'Pro']];
async function prefLoad(){ if(!on() || !USER) return; const r = await api('/rest/v1/ttm_prefs?select=prefs&user_id=eq.' + USER.id); if(r.ok && Array.isArray(r.json) && r.json[0] && r.json[0].prefs) PREFS = r.json[0].prefs; try{ ui(); }catch(err){} try{ rmUnread(); }catch(err){} }
const SESSPREF = [['s_asia_open', 'ASIA open'], ['s_asia_close', 'ASIA close'], ['s_ldn_open', 'London open'], ['s_ldn_close', 'London close'], ['s_ny_open', 'US open'], ['s_ny_close', 'US close']];
function prefsHtml(){
  const cb = (key, label, def) => `<label style="display:flex;gap:10px;align-items:center;font-size:13.5px;margin:4px 0;cursor:pointer"><input type="checkbox" data-pref="${key}" ${(def === false ? PREFS[key] === true : PREFS[key] !== false) ? 'checked' : ''} style="width:auto"> <span>${e(label)}</span></label>`;
  const grp = (t, inner) => `<div style="margin:10px 0 4px;padding-top:8px;border-top:1px solid var(--line)"><small style="color:var(--gold2);font-weight:700;letter-spacing:.04em;text-transform:uppercase">${t}</small>${inner}</div>`;
  const pick = ks => PREFDEF.filter(p => ks.includes(p[0]) && p[2]()).map(p => cb(p[0], p[1])).join('');
  const rooms = ROOMPREF.filter(r => rmCan(r[0])), mode = PREFS.rooms || 'ttm';
  const rmHtml = rooms.length ? `<small style="color:var(--mute);display:block;margin-top:4px">Community chat alerts on my phone</small><select data-prefsel="rooms" style="display:block;margin:4px 0;max-width:340px"><option value="ttm" ${mode === 'ttm' ? 'selected' : ''}>Only messages from TTM</option><option value="all" ${mode === 'all' ? 'selected' : ''}>Every message in my rooms</option><option value="follow" ${mode === 'follow' ? 'selected' : ''}>Only members I follow</option><option value="off" ${mode === 'off' ? 'selected' : ''}>Off</option></select>`
    + cb('mention', 'Alert me when someone tags me with @' + (PROF && PROF.tg_handle ? PROF.tg_handle : 'myname'))
    + rooms.map(r => cb('r_' + r[0], r[1] + ' room messages')).join('')
    + `<div style="font-size:13px;margin:6px 0 0">${(PREFS.follow || []).length ? 'Following: ' + PREFS.follow.map(f => `${e(f.n)} <u data-unfollow="${e(f.id)}" style="cursor:pointer;color:var(--mute)">remove</u>`).join(' · ') : '<span style="color:var(--mute)">Press <b>follow</b> on a member\'s message in a room to get alerts from them.</span>'}</div><div style="font-size:12px;color:var(--mute);margin-top:4px">Following is private. Nobody is told, and nobody can see who you follow. It only decides which phone alerts you get.</div>` : '';
  const sess = `<div style="font-size:12.5px;color:var(--mute);margin:2px 0 4px">Phone alert when a core market session opens or closes. All off until you tick them.</div>` + SESSPREF.map(s => cb(s[0], s[1], false)).join('') + cb('s_warn', '15-minute warning before the ones I ticked', false) + cb('s_wknd', 'Also on weekends (crypto trades all weekend)');
  return `<div style="margin:0 0 12px"><h4 style="margin:6px 0 0;font-size:15px">My settings <span style="font-weight:400;color:var(--mute);font-size:12px">alerts and messages</span></h4>`
    + grp('Trades and TTM', pick(['live', 'mytrade', 'spot', 'chat', 'inbox', 'luna', 'vest']))
    + grp('Market sessions', sess)
    + (rooms.length ? grp('Community chat', rmHtml + cb('online', 'Show me as online in the community chat')) : grp('Community chat', cb('online', 'Show me as online in the community chat')))
    + `<span id="prefNote" class="calendar-note"></span></div>`;
}
async function prefSave(){ const n = $('prefNote'); if(n) n.textContent = 'Saving…';
  const r = await api('/rest/v1/ttm_prefs?on_conflict=user_id', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'}, body: JSON.stringify({user_id: USER.id, prefs: PREFS, updated: new Date().toISOString()})}); const n2 = $('prefNote'); if(n2) n2.textContent = r.ok ? ' Saved.' : ' Could not save. Ask TTM to run the settings step.'; return r.ok; }
document.addEventListener('change', async ev => { const t = ev.target; if(!t || !t.dataset || !USER) return; if(t.dataset.pref){ PREFS[t.dataset.pref] = t.checked; await prefSave(); } else if(t.dataset.prefsel){ PREFS[t.dataset.prefsel] = t.value; await prefSave(); } if(t.dataset.pref === 'online'){ await presBeat(); presLoad(); } });


const cssE = document.createElement('style'); cssE.textContent = '.eng-badge{font-style:normal;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--line,#444);color:var(--mute,#999);border-radius:999px;padding:2px 8px;margin-left:8px;vertical-align:middle;font-weight:700}[data-engine].eng-open .eng-badge{color:var(--gold2,#e6b84a);border-color:var(--gold,#c9a227)}[data-engine].eng-locked,[data-tview].eng-locked{opacity:.78}[data-tview].eng-open .eng-badge{color:var(--gold2,#e6b84a);border-color:var(--gold,#c9a227)}[data-engine].eng-locked .cta,[data-tview].eng-locked .cta,[data-engine].eng-locked.menu-tile b{filter:grayscale(.6)}'; document.head.appendChild(cssE);
function tviewInit(){ const ok = on() && !!USER && lensOK(); const lg = $('ttmLensGuideLink'), ls2 = $('ttmLensGuideSep'); if(lg) lg.style.display = ok ? '' : 'none'; if(ls2) ls2.style.display = ok ? '' : 'none'; document.querySelectorAll('[data-tview]').forEach(a => { a.classList.toggle('eng-locked', !ok); a.classList.toggle('eng-open', ok); a.setAttribute('href', ok ? a.getAttribute('data-href') : '#'); if(ok) a.setAttribute('target', '_blank'); else a.removeAttribute('target'); const bd = a.querySelector('.eng-badge'); if(bd) bd.textContent = ok ? 'Team' : 'Locked'; const c = a.querySelector('.eng-cta'); if(c && c.firstChild) c.firstChild.nodeValue = ok ? 'Open TTM LENS ' : 'Locked '; }); }
document.addEventListener('click', ev => { const a = ev.target.closest && ev.target.closest('[data-tview]'); if(!a || !a.classList.contains('eng-locked')) return; ev.preventDefault(); openAuth(`<h3>TTM LENS</h3><p>TTM's own live charts with drawing tools, replay and the TTM indicators. It is locked while it is being built and tested.</p><div class="row"><button class="ttm-btn ghost" id="authClose">Close</button></div>`); });
function engineInit(){ tviewInit(); const ok = on() && !!USER && isTester(); document.querySelectorAll('[data-engine]').forEach(a => { a.classList.toggle('eng-locked', !ok); a.classList.toggle('eng-open', ok); a.setAttribute('href', ok ? a.getAttribute('data-href') : '#'); const bd = a.querySelector('.eng-badge'); if(bd) bd.textContent = ok ? 'Early access' : 'Locked'; const c = a.querySelector('.eng-cta'); if(c && c.firstChild) c.firstChild.nodeValue = ok ? 'Open the engine ' : 'Locked '; }); }
document.addEventListener('click', ev => { const a = ev.target.closest && ev.target.closest('[data-engine]'); if(!a || !a.classList.contains('eng-locked')) return; ev.preventDefault(); openAuth(`<h3>TTM Automated Trading Engine</h3><p>This is locked while it is being built. Early access is for TTM and testers only.</p><p>The plan is for members who open their exchange account through the TTM referral link to get access. Details will be announced.</p><div class="row">${USER ? '<button class="ttm-btn" id="lockDm">Direct Message TTM</button>' : '<button class="ttm-btn" id="lockSignIn">Sign in / create free account</button>'}<button class="ttm-btn ghost" id="authClose">Close</button></div>`); });
// ---- Hide $ values (eye button in every header; one switch for all pages, remembered on this device)
const HKEY = 'ttm_hide_usd';
const hidOn = () => { try{ return localStorage.getItem(HKEY) === '1'; }catch(e){ return false; } };
window.ttmHid = hidOn;
window.ttmMask = str => hidOn() ? '•••••' : str;
function hidApply(fire){
  const on = hidOn(); document.documentElement.classList.toggle('hide-usd', on);
  document.querySelectorAll('.eye-btn').forEach(b => { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.title = on ? 'Dollar values hidden. Tap to show.' : 'Hide dollar values'; b.innerHTML = on ? EYE_OFF : EYE_ON; b.classList.toggle('on', on); });
  if(fire) window.dispatchEvent(new Event('ttm-hide'));
}
const EYE_ON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';
function hidInit(){
  if(!document.getElementById('hideUsdCss')){ const st = document.createElement('style'); st.id = 'hideUsdCss';
    st.textContent = '.eye-btn{background:transparent;border:1px solid var(--line,#444);color:var(--mute,#999);width:34px;height:34px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;margin-left:8px;flex:none}.eye-btn.on{color:var(--gold2,#e6b84a);border-color:var(--gold,#c9a227)}'
      + '.hide-usd #rrBal,.hide-usd #rrRusd,.hide-usd #rrInv,.hide-usd #rrDaily,.hide-usd #rrMin,.hide-usd #ehAmt,.hide-usd #txBal,.hide-usd #txRiskUsd,.hide-usd [data-money]{filter:blur(7px)}';
    document.head.appendChild(st); }
  const ab = document.getElementById('acctBtn'); if(ab && !document.querySelector('.eye-btn')){ const b = document.createElement('button'); b.type = 'button'; b.className = 'eye-btn'; b.setAttribute('aria-label', 'Hide or show dollar values');
    b.addEventListener('click', () => { try{ localStorage.setItem(HKEY, hidOn() ? '0' : '1'); }catch(e){} hidApply(true); }); ab.parentNode.insertBefore(b, ab); }
  hidApply(false);
}
window.addEventListener('storage', e => { if(e.key === HKEY){ hidApply(true); } });
hidInit();
fxLoad().then(() => { if(FX) ui(); });
boot();
})();
