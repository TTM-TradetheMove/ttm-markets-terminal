// TTM plan gate. Runs in front of the site on Cloudflare; only .json data requests come here (see wrangler.jsonc).
// Free data files go straight through. Paid data files are only served if the signed-in member's plan allows that section,
// using the same rules as the site's menus (settings + plans from Supabase). If anything about the check fails, it lets the
// request through, so a hiccup never locks a paying member out.
// GATE modes (set in wrangler.jsonc): "off" = never blocks, "report" = never blocks but adds an x-ttm-gate header saying what it
// would have done (for testing), "on" = blocks people whose plan does not include the section.

// data file -> section key(s) from the site's plan list. Allowed if the plan allows ANY of the sections.
const FILES = {
  'tradfi_earnings.json': ['t:earnings'],
  'tradfi_liquidity.json': ['t:liquidity'],
  'tradfi_corr.json': ['t:crypto'],
  'tradfi_commodities.json': ['t:commodities'],
  'screener_us.json': ['t:screener'],
  'insiders_us.json': ['t:congress'],
  'social_data.json': ['c:socialpulse'],
  'liquidations_data.json': ['c:marketpulse'],
  'liquidation_totals.json': ['c:marketpulse'],
  'liq_heatmap_data.json': ['c:marketpulse'],
  'funding_data.json': ['c:marketpulse'],
  'maxpain.json': ['c:maxpain']
};
// default plans per section (same as the site's defaults; an admin's saved settings override these)
const DEF = {
  't:earnings': ['pro'], 't:liquidity': ['pro'], 't:crypto': ['pro'], 't:commodities': ['pro'],
  't:screener': ['team'], 't:congress': ['pro'],
  'c:socialpulse': ['premium', 'pro'], 'c:marketpulse': ['premium', 'pro'], 'c:maxpain': ['premium', 'pro']
};

let CFG = null, CFGAT = 0, SETT = null, SETAT = 0; const PCACHE = new Map();

async function cfg(env){
  if(CFG && Date.now() - CFGAT < 600000) return CFG;
  const r = await env.ASSETS.fetch(new Request('https://x/ttm_config.json'));
  const j = await r.json(); CFG = {url: String(j.supabase_url || '').replace(/\/$/, ''), key: j.supabase_anon_key || ''}; CFGAT = Date.now(); return CFG;
}
async function sb(c, path, token){
  const h = {apikey: c.key}; if(token) h.Authorization = 'Bearer ' + token; else if(String(c.key).indexOf('eyJ') === 0) h.Authorization = 'Bearer ' + c.key;
  return fetch(c.url + path, {headers: h});
}
async function settings(c){
  if(SETT && Date.now() - SETAT < 60000) return SETT;
  const r = await sb(c, '/rest/v1/ttm_settings?select=key,value'); if(!r.ok) throw new Error('settings ' + r.status);
  const rows = await r.json(), s = {charging: false, wall: false, access: {}};
  rows.forEach(x => { if(x.key === 'charging') s.charging = x.value === true || x.value === 'true'; if(x.key === 'wall') s.wall = x.value === true || x.value === 'true'; if(x.key === 'access' && x.value && typeof x.value === 'object') s.access = x.value; });
  SETT = s; SETAT = Date.now(); return s;
}
// returns null for "not signed in / token not valid", otherwise the profile
async function profile(c, token){
  if(!token) return null;
  const hit = PCACHE.get(token); if(hit && Date.now() - hit.t < 60000) return hit.p;
  const u = await sb(c, '/auth/v1/user', token);
  if(u.status === 401 || u.status === 403){ PCACHE.set(token, {t: Date.now(), p: null}); return null; }
  if(!u.ok) throw new Error('auth ' + u.status);
  const id = (await u.json()).id; if(!id) return null;
  let r = await sb(c, '/rest/v1/ttm_profiles?id=eq.' + id + '&select=plan,is_admin,beta,team', token);
  if(!r.ok) r = await sb(c, '/rest/v1/ttm_profiles?id=eq.' + id + '&select=plan,is_admin', token);
  if(!r.ok) throw new Error('profile ' + r.status);
  const rows = await r.json(), p = rows[0] || {plan: 'free'};
  if(PCACHE.size > 500) PCACHE.clear(); PCACHE.set(token, {t: Date.now(), p}); return p;
}
// same rules as can() in accounts.js
function allowed(key, s, p){
  if(!s.charging) return true;
  if(p && p.is_admin) return true;
  if(s.wall && !p) return false;
  const a = s.access[key] || DEF[key]; if(!a) return true;
  if(a.indexOf('soon') >= 0) return false;
  const plan = p ? (p.plan || 'free') : 'free';
  if(p && p.beta && a.indexOf('beta') >= 0) return true;
  if(p && p.team && a.indexOf('team') >= 0) return true;
  return a.indexOf(plan) >= 0 || a.indexOf('free') >= 0;
}
async function decide(env, keys, auth){
  const c = await cfg(env), s = await settings(c); const token = /^Bearer\s+(.+)$/i.test(auth || '') ? RegExp.$1.trim() : '';
  if(!s.charging) return {ok: true, why: 'charging-off'};
  const p = await profile(c, token);
  return keys.some(k => allowed(k, s, p)) ? {ok: true, why: p ? 'plan-ok' : 'public'} : {ok: false, why: p ? 'plan-too-low' : 'signed-out'};
}

// Reliable timer: GitHub's own scheduler sometimes never starts a run, so Cloudflare's timer asks GitHub to start these jobs instead.
// Needs a GitHub token saved as the secret GH_DISPATCH_TOKEN (Actions: read and write, this repository only). Without it, this does nothing.
const REPO = 'TTM-TradetheMove/ttm-markets-terminal';
const BRIEF = [{wf: 'daily-brief.yml', inputs: {force: 'false'}}];   // the brief script only writes once a day, 7am to 11am Melbourne
const DEPLOY = [{wf: 'deploy-cloudflare.yml', inputs: {}}];            // publishes the data files the jobs have committed
async function kick(env, list){
  if(!env.GH_DISPATCH_TOKEN) return;
  for(const k of list){
    try{
      const r = await fetch('https://api.github.com/repos/' + REPO + '/actions/workflows/' + k.wf + '/dispatches', {method: 'POST', headers: {Authorization: 'Bearer ' + env.GH_DISPATCH_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'ttm-timer', 'X-GitHub-Api-Version': '2022-11-28'}, body: JSON.stringify({ref: 'main', inputs: k.inputs || {}})});
      if(!r.ok) console.log('dispatch', k.wf, r.status, (await r.text()).slice(0, 200));
    }catch(e){ console.log('dispatch failed', k.wf, String(e)); }
  }
}

export default {
  async scheduled(event, env, ctx){ ctx.waitUntil(kick(env, event.cron === '*/15 * * * *' ? DEPLOY : BRIEF)); },
  async fetch(request, env){
    const url = new URL(request.url), file = url.pathname.split('/').pop(), keys = FILES[file], mode = String(env.GATE || 'off');
    if(!keys || mode === 'off' || (request.method !== 'GET' && request.method !== 'HEAD')) return env.ASSETS.fetch(request);
    let d; try{ d = await decide(env, keys, request.headers.get('Authorization')); }catch(e){ d = {ok: true, why: 'check-failed-allowed'}; }
    if(!d.ok && mode === 'on') return new Response(JSON.stringify({error: 'plan', message: 'Your plan does not include this data.'}), {status: 403, headers: {'content-type': 'application/json', 'cache-control': 'no-store', 'x-ttm-gate': 'blocked-' + d.why}});
    const r = await env.ASSETS.fetch(new Request(url.origin + url.pathname + url.search, {method: request.method, headers: {}}));
    const out = new Response(r.body, r); out.headers.set('x-ttm-gate', (d.ok ? 'allowed-' : 'would-block-') + d.why); out.headers.set('cache-control', 'no-store'); return out;
  }
};
