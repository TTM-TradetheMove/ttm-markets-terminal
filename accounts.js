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
  ['t:calendar', 'TradFi · Macro Watch', ['free']], ['t:tradinghours', 'TradFi · Trading Hours', ['free']], ['t:congress', 'TradFi · Congress Watch', ['free']],
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
  const h = Object.assign({apikey: CFG.key, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || CFG.key)}, (opt && opt.headers) || {});
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

async function boot(){
  try{ const r = await fetch(BASE + 'ttm_config.json?t=' + Date.now(), {cache: 'no-store'}); if(r.ok){ const c = await r.json(); CFG = {url: c.supabase_url || '', key: c.supabase_anon_key || '', tv: c.tradingview || [], plans: c.plans || {}}; } }catch(err){}
  if(on()){
    try{ const r = await raw('/rest/v1/ttm_settings?select=key,value'); if(r.ok && Array.isArray(r.json)) r.json.forEach(x => { if(x.key === 'charging') SET.charging = x.value === true || x.value === 'true'; if(x.key === 'wall') SET.wall = x.value === true || x.value === 'true'; if(x.key === 'access' && x.value && typeof x.value === 'object') Object.keys(x.value).forEach(k => { SET.access[k] = x.value[k]; }); }); }catch(err){}
    const t = await token();
    if(t){ const u = await raw('/auth/v1/user', {}, t); if(u.ok && u.json && u.json.id){ USER = {id: u.json.id, email: u.json.email}; const p = await api(`/rest/v1/ttm_profiles?id=eq.${USER.id}&select=plan,is_admin,email`); PROF = (p.ok && p.json && p.json[0]) || {plan: 'free', is_admin: false}; } }
  }
  ui(); if(USER) syncInit();
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
  const label = (CAT.find(c => c[0] === key) || [0, key, 0])[1].replace(/^(Crypto|TradFi) · /, '');
  if(SET.wall && !USER){ openAuth('<p>Sign in to continue. It is free and takes a minute.</p>' + signInForm()); return; }
  openAuth(USER ? `<p><b>${e(label)}</b> is included with the <b>${e(needText(key))}</b> plan. You are on <b>${e(pname(PROF.plan))}</b>. Paid plans are not open for self-sign-up yet; ask TTM on Telegram.</p><div class="row"><button class="ttm-btn ghost" id="authClose">Close</button></div>`
    : `<p><b>${e(label)}</b> is included with the <b>${e(needText(key))}</b> plan. Sign in to continue.</p>` + signInForm());
}
window.ttmCan = can; window.ttmUpsell = upsell;

// ---------- sign-in modal
function signInForm(){ return on() ? `<label for="authEmail"><small>Email</small></label><input id="authEmail" type="email" autocomplete="email" placeholder="you@example.com"><div class="row"><button class="ttm-btn" id="authSend">Email me a sign-in link</button><button class="ttm-btn ghost" id="authClose">Cancel</button></div><p id="authNote" style="margin:12px 0 0"><small>No password. We email a one-time link and a code. Creating an account is free.</small></p>` : '<p>Accounts are coming soon. The terminal stays free and open in the meantime.</p><div class="row"><button class="ttm-btn ghost" id="authClose">Close</button></div>'; }
function openAuth(html){ $('authBody').innerHTML = '<h3>TTM account</h3>' + (html || signInForm()); modal.classList.add('open'); }
const closeAuth = () => modal.classList.remove('open');
document.addEventListener('click', async ev => {
  const t = ev.target; if(!t || !t.id && !t.closest) return;
  if(t.id === 'acctBtn'){ if(!USER) openAuth(); else if(TERM === 'home'){ const a = $('account'); if(a) a.scrollIntoView({behavior: 'smooth'}); } else location.href = BASE + 'index.html#account'; }
  else if(t.id === 'authClose' || t === modal) closeAuth();
  else if(t.id === 'memSignIn' || t.id === 'lockSignIn' || t.id === 'wallSignIn') openAuth();
  else if(t.id === 'authSend'){ const em = ($('authEmail').value || '').trim(); if(!/^\S+@\S+\.\S+$/.test(em)){ $('authNote').textContent = 'Enter a valid email address.'; return; }
    t.disabled = true; $('authNote').textContent = 'Sending…';
    const r = await raw('/auth/v1/otp?redirect_to=' + encodeURIComponent(location.origin + location.pathname), {method: 'POST', body: JSON.stringify({email: em, create_user: true})}); t.disabled = false;
    if(r.ok) $('authBody').innerHTML = `<h3>Check your email</h3><p>We sent a sign-in link to <b>${e(em)}</b>. Open it on this device, or type the code from the email here:</p><input id="authCode" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code"><div class="row"><button class="ttm-btn" id="authVerify" data-em="${e(em)}">Sign in with code</button><button class="ttm-btn ghost" id="authClose">Close</button></div><p id="authNote" style="margin:12px 0 0"><small>Nothing arrived? Check spam, or try again in a minute.</small></p>`;
    else $('authNote').textContent = 'Could not send the email' + (r.json && (r.json.msg || r.json.error_description) ? ': ' + (r.json.msg || r.json.error_description) : '.'); }
  else if(t.id === 'authVerify'){ const code = ($('authCode').value || '').trim(), em = t.dataset.em; if(!code) return;
    const r = await raw('/auth/v1/verify', {method: 'POST', body: JSON.stringify({type: 'email', email: em, token: code})});
    if(r.ok && r.json && r.json.access_token){ lw(AK, {access: r.json.access_token, refresh: r.json.refresh_token, exp: Date.now() + (r.json.expires_in || 3600) * 1000}); closeAuth(); await boot(); }
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
// ---------- UI
function planBadge(){ return PROF ? `<span class="rr-pill be">${e(pname(PROF.plan))}${PROF.is_admin ? ' · admin' : ''}</span>` : ''; }
function planCards(){
  const inPlan = (k, p) => { const a = SET.access[k] || []; return a.indexOf(p) >= 0; }, free = CAT.filter(c => inPlan(c[0], 'free')), lab = c => c[1].replace(/ \(.*\)$/, '');
  const only = p => CAT.filter(c => inPlan(c[0], p) && !inPlan(c[0], 'free'));
  const pro = CAT.filter(c => !inPlan(c[0], 'free') && !inPlan(c[0], 'crypto') && !inPlan(c[0], 'tradfi'));
  const price = p => { const x = (CFG.plans || {})[p]; return x && (x.monthly || x.annual) ? `${x.monthly ? '$' + e(x.monthly) + ' / month' : ''}${x.monthly && x.annual ? ' · ' : ''}${x.annual ? '$' + e(x.annual) + ' / year' : ''}` : (p === 'free' ? 'Free' : 'Price to be confirmed'); };
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
    <div class="rr-card"><h3>Members (${users.length})</h3><div class="rr-wrap"><table class="rr-tbl"><thead><tr><th>Email</th><th>Joined</th><th>Plan</th></tr></thead><tbody>${users.map(u => `<tr><td>${e(u.email)}${u.is_admin ? ' <span class="rr-pill be">admin</span>' : ''}</td><td>${new Date(u.created_at).toLocaleDateString()}</td><td>${sel('data-uid="' + u.id + '"', u.plan)}</td></tr>`).join('') || '<tr><td colspan="3" style="color:var(--mute)">No members yet.</td></tr>'}</tbody></table></div></div>`;
}
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
boot();
})();
