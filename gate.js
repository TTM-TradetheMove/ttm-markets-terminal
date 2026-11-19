/* TTM page helper, loaded in the <head> of the Crypto and TradFi pages.
   1) Attaches the member's sign-in to requests for paid data files, so the plan gate (worker.js) can see their plan.
   2) Stops the page asking for the same data file several times at once: a repeat request within 15 seconds reuses the first answer. */
(function(){
  var FILES = ['tradfi_earnings.json','tradfi_liquidity.json','tradfi_corr.json','tradfi_commodities.json','screener_us.json','insiders_us.json','social_data.json','liquidations_data.json','liquidation_totals.json','liq_heatmap_data.json','funding_data.json','maxpain.json'];
  var of = window.fetch; if(!of) return;
  function tok(){
    var s = null; try{ s = JSON.parse(localStorage.getItem('ttm_auth_v1') || 'null'); }catch(e){}
    if(!s || !s.access) return Promise.resolve(null);
    if(s.exp - 60000 > Date.now()) return Promise.resolve(s.access);
    return new Promise(function(res){ var n = 0; (function w(){ if(window.ttmToken){ window.ttmToken().then(function(t){ res(t || s.access); }, function(){ res(s.access); }); } else if(n++ > 50) res(s.access); else setTimeout(w, 100); })(); });
  }
  var send = function(self, a){
    var u = a[0], o = a[1];
    try{
      var s = typeof u === 'string' ? u : (u && u.url) || '', f = s.split('?')[0].split('/').pop();
      if(FILES.indexOf(f) < 0) return of.apply(self, a);
      return tok().then(function(t){
        if(!t) return of.apply(self, a);
        var o2 = Object.assign({}, o || {}), h = new Headers(o2.headers || (typeof u !== 'string' && u && u.headers) || {}); h.set('Authorization', 'Bearer ' + t); o2.headers = h; return of.call(window, u, o2);
      });
    }catch(e){ return of.apply(self, a); }
  };
  // On the old GitHub address the paid data files are no longer published: say so, with the way to the new site.
  if(/github\.io$/.test(location.hostname)){
    var shown = false, orig = send;
    send = function(self, a){
      var u = a[0], s = typeof u === 'string' ? u : (u && u.url) || '', f = s.split('?')[0].split('/').pop();
      if(FILES.indexOf(f) < 0) return orig(self, a);
      if(!shown){ shown = true; var add = function(){ if(document.getElementById('ttmPaidMoved')) return; var b = document.createElement('div'); b.id = 'ttmPaidMoved'; b.style.cssText = 'position:sticky;top:0;z-index:99999;background:#dba118;color:#111;padding:10px 14px;text-align:center;font:700 14px/1.4 system-ui,sans-serif'; b.innerHTML = 'Premium and Pro data has moved to <a href="https://ttm.markets/" style="color:#111;text-decoration:underline">ttm.markets</a>. Sign in there with the same email and password. If your antivirus (Avast/AVG) blocks it, add ttm.markets as an exception, then use <b>Direct Message TTM</b> on the new site if you need help. <button type="button" aria-label="Close" style="background:none;border:0;font-size:20px;line-height:1;cursor:pointer;margin-left:8px;color:#111">\u00d7</button>'; b.querySelector('button').onclick = function(){ b.remove(); }; document.body.insertBefore(b, document.body.firstChild); }; if(document.body) add(); else document.addEventListener('DOMContentLoaded', add); }
      return Promise.resolve(new Response('{"error":"moved"}', {status: 410, headers: {'content-type': 'application/json'}}));
    };
  }
  var MEM = {};
  window.fetch = function(u, o){
    var a = arguments, self = this;
    try{
      if(typeof u === 'string' && (!o || !o.method || String(o.method).toUpperCase() === 'GET') && /\.json(\?|$)/.test(u) && (u.indexOf('://') < 0 || u.indexOf(location.origin) === 0)){
        var k = new URL(u, location.href).pathname, m = MEM[k];
        if(m && Date.now() - m.t < 15000) return m.p.then(function(r){ return r.clone(); });
        var p = send(self, a); MEM[k] = {t: Date.now(), p: p};
        p.then(function(r){ if(!r || !r.ok) delete MEM[k]; }, function(){ delete MEM[k]; });
        return p.then(function(r){ return r.clone(); });
      }
    }catch(e){}
    return send(self, a);
  };
})();
