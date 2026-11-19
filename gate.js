/* Attaches the member's sign-in to requests for paid data files, so the TTM data gate (worker.js) can see their plan.
   Loaded in the <head> of pages that read those files. Harmless where no gate is running. */
(function(){
  var FILES = ['tradfi_earnings.json','tradfi_liquidity.json','tradfi_corr.json','tradfi_commodities.json','screener_us.json','insiders_us.json','social_data.json','liquidations_data.json','liquidation_totals.json','liq_heatmap_data.json','funding_data.json','maxpain.json'];
  var of = window.fetch; if(!of) return;
  function tok(){
    var s = null; try{ s = JSON.parse(localStorage.getItem('ttm_auth_v1') || 'null'); }catch(e){}
    if(!s || !s.access) return Promise.resolve(null);
    if(s.exp - 60000 > Date.now()) return Promise.resolve(s.access);
    return new Promise(function(res){ var n = 0; (function w(){ if(window.ttmToken){ window.ttmToken().then(function(t){ res(t || s.access); }, function(){ res(s.access); }); } else if(n++ > 50) res(s.access); else setTimeout(w, 100); })(); });
  }
  window.fetch = function(u, o){
    try{
      var s = typeof u === 'string' ? u : (u && u.url) || '', f = s.split('?')[0].split('/').pop();
      if(FILES.indexOf(f) < 0) return of.apply(this, arguments);
      var self = this, a = arguments;
      return tok().then(function(t){
        if(!t) return of.apply(self, a);
        var o2 = Object.assign({}, o || {}), h = new Headers(o2.headers || (typeof u !== 'string' && u && u.headers) || {}); h.set('Authorization', 'Bearer ' + t); o2.headers = h; return of.call(window, u, o2);
      });
    }catch(e){ return of.apply(this, arguments); }
  };
})();
