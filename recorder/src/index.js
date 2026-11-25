// TTM order flow recorder (Cloudflare Worker + one Durable Object).
// Connects to Bybit and Binance public feeds (no keys needed), samples the order book every 10 seconds into compact heat slices,
// keeps big trades, and serves the last 48 hours to TTM LENS at /hist. Nothing here is private: it is all public market data.
const SLICE_MS = 10000, KEEP_MS = 48 * 3600e3, BIG_TRADE = 25000, MIN_LEVEL = 5000, BAND = 0.02;
const nice = x => { const e = Math.pow(10, Math.floor(Math.log10(x))), m = x / e; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e; };

export default {
  async fetch(req, env){
    const u = new URL(req.url), org = req.headers.get('Origin') || '', ok = (env.ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = {'Access-Control-Allow-Origin': ok.includes(org) ? org : (ok[0] || '*'), 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, OPTIONS'};
    if(req.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    const stub = env.REC.get(env.REC.idFromName(env.DOID || 'main'), {locationHint: env.HINT || 'weur'});
    const r = await stub.fetch(req.url.replace(/^https?:\/\/[^/]+/, 'https://rec'));
    const h = new Headers(r.headers); Object.entries(cors).forEach(([k, v]) => h.set(k, v)); if(!h.has('Cache-Control')) h.set('Cache-Control', 'public, max-age=8');
    return new Response(r.body, {status: r.status, headers: h});
  },
  async scheduled(ev, env){ const stub = env.REC.get(env.REC.idFromName(env.DOID || 'main'), {locationHint: env.HINT || 'weur'}); await stub.fetch('https://rec/ping'); }
};

export class Rec {
  constructor(state, env){
    this.st = state; this.env = env; this.S = new Map(); this.started = false; this.syms = (env.SYMS || 'BTC').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS slices (k TEXT, t INTEGER, d TEXT)'); this.sql.exec('CREATE INDEX IF NOT EXISTS ix_sl ON slices (k, t)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS trades (k TEXT, t INTEGER, p REAL, q REAL, s INTEGER)'); this.sql.exec('CREATE INDEX IF NOT EXISTS ix_tr ON trades (k, t)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, step REAL)');
  }
  async fetch(req){
    const u = new URL(req.url);
    if(u.pathname === '/ping'){ await this.start(); return new Response('ok'); }
    await this.start();
    if(u.pathname === '/health'){ const o = {}; this.S.forEach((s, k) => { o[k] = {st: s.st, bids: s.b ? s.b.size : 0, asks: s.a ? s.a.size : 0, last: s.lastT || 0}; }); return Response.json({now: Date.now(), streams: o, syms: this.syms});}
    if(u.pathname === '/hist'){
      const ex = u.searchParams.get('ex') === 'binance' ? 'binance' : 'bybit', mkt = u.searchParams.get('mkt') === 'perp' ? 'perp' : 'spot', sym = String(u.searchParams.get('sym') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const k = ex + ':' + mkt + ':' + sym, hrs = Math.max(0.1, Math.min(48, +u.searchParams.get('hours') || 6)), since = Math.max(Date.now() - hrs * 3600e3, +u.searchParams.get('since') || 0);
      if(!this.S.has(k)) return Response.json({error: 'not recorded', syms: this.syms}, {status: 404});
      const step = (this.sql.exec('SELECT step FROM meta WHERE k=?', k).toArray()[0] || {}).step || 0;
      const sl = this.sql.exec('SELECT t, d FROM slices WHERE k=? AND t>? ORDER BY t', k, since).toArray().map(r => { const d = JSON.parse(r.d); return [r.t, d[0], d[1]]; });
      const tr = this.sql.exec('SELECT t, p, q, s FROM trades WHERE k=? AND t>? ORDER BY t', k, since).toArray().map(r => [r.t, r.p, r.q, r.s]);
      return Response.json({k, step, now: Date.now(), slices: sl, trades: tr}, {headers: {'Cache-Control': 'public, max-age=8'}});
    }
    return new Response('TTM flow recorder', {status: 200});
  }
  async start(){
    if(!this.started){ this.started = true; this.syms.forEach(s => ['bybit', 'binance'].forEach(ex => ['spot', 'perp'].forEach(m => this.open(ex, m, s)))); }
    const a = await this.st.storage.getAlarm(); if(a == null) await this.st.storage.setAlarm(Date.now() + 15000);
  }
  async alarm(){
    const now = Date.now(); this.S.forEach(s => { if(!s.ws || (s.st !== 'live' && now - s.tried > 20000) || (s.lastMsg && now - s.lastMsg > 45000)){ try{ s.ws && s.ws.close(); }catch(x){} this.connect(s); } });
    if(!this.lastPrune || now - this.lastPrune > 60000){ this.lastPrune = now; const c = now - KEEP_MS; this.sql.exec('DELETE FROM slices WHERE t<?', c); this.sql.exec('DELETE FROM trades WHERE t<?', c); }
    await this.st.storage.setAlarm(Date.now() + 15000);
  }
  open(ex, m, sym){ const k = ex + ':' + m + ':' + sym, s = {k, ex, m, sym, pair: sym + 'USDT', b: null, a: null, st: 'new', ws: null, tried: 0, buf: [], step: (this.sql.exec('SELECT step FROM meta WHERE k=?', k).toArray()[0] || {}).step || 0, lastSample: 0};
    this.S.set(k, s); this.connect(s); }
  connect(s){
    s.tried = Date.now(); s.st = 'connecting'; s.b = null; s.a = null; s.buf = []; s.ready = false; s.last = 0; let ws;
    try{
      const url = s.ex === 'bybit' ? 'wss://stream.bybit.com/v5/public/' + (s.m === 'perp' ? 'linear' : 'spot')
        : (s.m === 'perp' ? 'wss://fstream.binance.com/stream?streams=' : 'wss://data-stream.binance.vision/stream?streams=') + s.pair.toLowerCase() + '@depth@100ms/' + s.pair.toLowerCase() + '@aggTrade';
      ws = new WebSocket(url);
    }catch(x){ s.st = 'error'; return; }
    s.ws = ws;
    ws.addEventListener('open', () => { s.st = 'live'; if(s.ex === 'bybit') ws.send(JSON.stringify({op: 'subscribe', args: ['orderbook.1000.' + s.pair, 'publicTrade.' + s.pair]})); else this.snap(s); });
    ws.addEventListener('message', ev => { s.lastMsg = Date.now(); let j; try{ j = JSON.parse(ev.data); }catch(x){ return; } try{ s.ex === 'bybit' ? this.onBybit(s, j) : this.onBinance(s, j.data || j); }catch(x){} });
    ws.addEventListener('close', () => { if(s.ws === ws){ s.ws = null; s.st = 'closed'; } });
    ws.addEventListener('error', () => { try{ ws.close(); }catch(x){} });
  }
  onBybit(s, j){
    if(!j || !j.topic) return; const d = j.data;
    if(/^orderbook/.test(j.topic)){ if(j.type === 'snapshot'){ s.b = new Map(); s.a = new Map(); } if(!s.b) return;
      (d.b || []).forEach(z => { const p = +z[0], q = +z[1]; q > 0 ? s.b.set(p, q) : s.b.delete(p); }); (d.a || []).forEach(z => { const p = +z[0], q = +z[1]; q > 0 ? s.a.set(p, q) : s.a.delete(p); }); this.maybeSample(s); }
    else if(/^publicTrade/.test(j.topic) && Array.isArray(d)) d.forEach(z => this.trade(s, +z.T, +z.p, +z.v, z.S === 'Buy' ? 1 : -1));
  }
  async snap(s){
    try{
      const url = s.m === 'perp' ? 'https://fapi.binance.com/fapi/v1/depth?symbol=' + s.pair + '&limit=1000' : 'https://data-api.binance.vision/api/v3/depth?symbol=' + s.pair + '&limit=5000';
      const r = await fetch(url); if(!r.ok){ s.st = 'blocked ' + r.status; try{ s.ws && s.ws.close(); }catch(x){} return; } const j = await r.json();
      s.b = new Map(); s.a = new Map(); j.bids.forEach(z => s.b.set(+z[0], +z[1])); j.asks.forEach(z => s.a.set(+z[0], +z[1])); s.last = j.lastUpdateId; s.synced = false;
      const q = s.buf; s.buf = []; s.ready = true; q.forEach(e => this.depth(s, e));
    }catch(x){ s.st = 'snapfail'; try{ s.ws && s.ws.close(); }catch(y){} }
  }
  onBinance(s, e){
    if(!e) return; if(e.e === 'aggTrade'){ this.trade(s, +e.T, +e.p, +e.q, e.m ? -1 : 1); return; }
    if(e.e === 'depthUpdate'){ if(!s.ready){ s.buf.push(e); return; } this.depth(s, e); }
  }
  depth(s, e){
    if(e.u <= s.last) return;
    if(!s.synced){ if(e.U > s.last + 1){ try{ s.ws && s.ws.close(); }catch(x){} return; } s.synced = true; }
    else if(s.m === 'perp' ? e.pu !== s.last : e.U !== s.last + 1){ s.ready = false; s.synced = false; s.buf = [e]; this.snap(s); return; }
    (e.b || []).forEach(z => { const p = +z[0], q = +z[1]; q > 0 ? s.b.set(p, q) : s.b.delete(p); }); (e.a || []).forEach(z => { const p = +z[0], q = +z[1]; q > 0 ? s.a.set(p, q) : s.a.delete(p); }); s.last = e.u; this.maybeSample(s);
  }
  trade(s, t, p, q, side){ if(p * q >= BIG_TRADE) this.sql.exec('INSERT INTO trades (k,t,p,q,s) VALUES (?,?,?,?,?)', s.k, t, p, q, side); }
  maybeSample(s){
    const now = Date.now(); if(now - s.lastSample < SLICE_MS || !s.b || !s.a || !s.b.size || !s.a.size) return; s.lastSample = now; s.lastT = now;
    let bb = 0, ba = Infinity; s.b.forEach((q, p) => { if(p > bb) bb = p; }); s.a.forEach((q, p) => { if(p < ba) ba = p; }); if(!bb || !isFinite(ba)) return; const mid = (bb + ba) / 2;
    if(!s.step){ s.step = nice(mid * 0.00003); this.sql.exec('INSERT OR REPLACE INTO meta (k, step) VALUES (?,?)', s.k, s.step); }
    const M = new Map(), lo = mid * (1 - BAND), hi = mid * (1 + BAND), add = (q, p) => { if(p < lo || p > hi) return; const n = p * q; if(n < 100) return; const id = Math.round(p / s.step); M.set(id, (M.get(id) || 0) + n); };
    s.b.forEach(add); s.a.forEach(add); const ids = [], v = []; M.forEach((n, id) => { if(n >= MIN_LEVEL){ ids.push(id); v.push(Math.round(n / 100)); } });
    if(ids.length) this.sql.exec('INSERT INTO slices (k,t,d) VALUES (?,?,?)', s.k, now, JSON.stringify([ids, v]));
  }
}
