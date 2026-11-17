/* TTM Education: video lessons set to Free / Premium / Pro. Needs supabase/education.sql. Uses accounts.js helpers (ttmApi, ttmWho, ttmMyTier, ttmBuy, ttmSignIn, ttmIsAdmin). */
(function(){
  var box = document.getElementById('eduBox'); if(!box) return;
  var TIERS = {free: 0, premium: 1, pro: 2}, TN = {free: 'Free', premium: 'Premium', pro: 'Pro'};
  var L = [], cat = 'All', admin = false, editId = null, loaded = false, seen = {};
  try{ seen = JSON.parse(localStorage.getItem('ttm_edu_seen') || '{}') || {}; }catch(_){ seen = {}; }
  var esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); };
  var api = function(p, o){ return window.ttmApi ? window.ttmApi(p, o) : Promise.resolve({ok: false}); };
  var who = function(){ return window.ttmWho ? window.ttmWho() : {}; };
  var tier = function(){ return window.ttmMyTier ? window.ttmMyTier() : 0; };

  var css = document.createElement('style');
  css.textContent = '#eduBox .ed-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}' +
    '#eduBox .ed-card{border:1px solid var(--line,#2a2a2f);border-radius:14px;background:var(--card,#16161a);overflow:hidden;display:flex;flex-direction:column;cursor:pointer;transition:transform .15s,border-color .15s}' +
    '#eduBox .ed-card:hover{transform:translateY(-2px);border-color:rgba(219,161,24,.6)}' +
    '#eduBox .ed-th{height:120px;display:flex;align-items:center;justify-content:center;font-size:38px;position:relative;background:linear-gradient(135deg,#2a2210,#14110a)}' +
    '#eduBox .ed-card.pro .ed-th{background:linear-gradient(135deg,#3a2a06,#1a1305)}#eduBox .ed-card.free .ed-th{background:linear-gradient(135deg,#10261c,#0b1510)}' +
    '#eduBox .ed-tier{position:absolute;top:8px;right:8px;font-size:10px;font-weight:800;letter-spacing:.06em;border-radius:99px;padding:2px 9px;background:rgba(0,0,0,.55);color:var(--gold2,#f0c14b);border:1px solid rgba(219,161,24,.5)}' +
    '#eduBox .ed-card.free .ed-tier{color:#3fb97a;border-color:rgba(63,185,122,.5)}' +
    '#eduBox .ed-ok{position:absolute;top:8px;left:8px;font-size:11px;font-weight:800;color:#3fb97a}' +
    '#eduBox .ed-bd{padding:12px 14px 14px;display:flex;flex-direction:column;gap:5px;flex:1}#eduBox .ed-bd b{font-size:15px;line-height:1.3}' +
    '#eduBox .ed-bd small{color:var(--mute,#8a8a90);font-size:12px}#eduBox .ed-bd p{margin:0;font-size:13px;color:var(--mute,#8a8a90);line-height:1.5}' +
    '#eduModal{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.82);display:none;align-items:center;justify-content:center;padding:14px}' +
    '#eduModal .ed-in{width:min(960px,100%);background:#101013;border:1px solid rgba(219,161,24,.45);border-radius:14px;padding:12px 12px 14px}' +
    '#eduModal .ed-vid{position:relative;padding-top:56.25%;background:#000;border-radius:10px;overflow:hidden}#eduModal iframe{position:absolute;inset:0;width:100%;height:100%;border:0}' +
    '#eduBox .ed-f{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}#eduBox .ed-f input,#eduBox .ed-f select,#eduBox .ed-f textarea{background:rgba(255,255,255,.04);border:1px solid var(--line,#2a2a2f);color:var(--text,#eee);border-radius:8px;padding:9px 10px;font:inherit;width:100%;box-sizing:border-box}';
  document.head.appendChild(css);
  var modal = document.createElement('div'); modal.id = 'eduModal'; document.body.appendChild(modal);

  function parseVid(v, prov){ v = (v || '').trim(); if(!v) return ''; if(prov === 'zoom') return /^https:\/\/([a-z0-9-]+\.)*(zoom\.us|zoomgov\.com)\//i.test(v) ? v : ''; if(prov === 'stream'){ var m = v.match(/([a-f0-9]{32})/i); return m ? m[1] : v; }
    var r = v.match(/(?:youtu\.be\/|v=|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/); if(r) return r[1]; return /^[A-Za-z0-9_-]{11}$/.test(v) ? v : ''; }
  function save(){ try{ localStorage.setItem('ttm_edu_seen', JSON.stringify(seen)); }catch(_){} }
  function closeModal(){ modal.style.display = 'none'; modal.innerHTML = ''; }
  function say(html){ modal.innerHTML = '<div class="ed-in" style="max-width:460px">' + html + '</div>'; modal.style.display = 'flex'; }

  async function load(){
    var w = who();
    if(!w.user){ box.innerHTML = '<div class="rr-card" style="text-align:center;padding:26px 14px"><h3 style="margin:0 0 6px">Sign in to start learning</h3><p style="color:var(--mute)">Free lessons are open to every member. Premium and Pro lessons unlock with your plan.</p><button class="rr-btn" id="edSign">Sign in or create a free account</button></div>'; loaded = false; return; }
    admin = !!(window.ttmIsAdmin && window.ttmIsAdmin());
    var r = await api('/rest/v1/ttm_lessons?select=id,title,descr,category,provider,min_tier,sort,duration,published&order=sort.asc,id.asc');
    if(!r.ok){ box.innerHTML = '<div class="rr-warn y"><b>One database step is missing.</b> Run <code>supabase/education.sql</code> in the Supabase SQL editor, then refresh.</div>' + (admin ? adminHtml() : ''); wire(); return; }
    L = Array.isArray(r.json) ? r.json : []; loaded = true; render();
  }

  function render(){
    var t = tier(), cats = ['All'].concat(L.map(function(x){ return x.category; }).filter(function(c, i, a){ return a.indexOf(c) === i; }));
    var vis = L.filter(function(x){ return (admin || x.published) && (cat === 'All' || x.category === cat); }), done = L.filter(function(x){ return seen[x.id] && x.published; }).length, total = L.filter(function(x){ return x.published; }).length;
    var h = '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px"><div class="filter-row" id="edCats">' + cats.map(function(c){ return '<button class="filter-chip' + (c === cat ? ' active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>' +
      (total ? '<span class="calendar-note" style="margin:0">' + done + ' of ' + total + ' watched</span>' : '') + '</div>';
    h += vis.length ? '<div class="ed-grid">' + vis.map(function(x){ var need = TIERS[x.min_tier] || 0, locked = t < need;
      return '<div class="ed-card ' + esc(x.min_tier) + '" data-id="' + x.id + '"><div class="ed-th">' + (locked ? '🔒' : '▶️') + '<span class="ed-tier">' + TN[x.min_tier] + '</span>' + (seen[x.id] ? '<span class="ed-ok">✓ Watched</span>' : '') + (x.published ? '' : '<span class="ed-ok" style="color:#e0554d">Hidden</span>') + '</div>' +
        '<div class="ed-bd"><small>' + esc(x.category) + (x.duration ? ' · ' + esc(x.duration) : '') + '</small><b>' + esc(x.title) + '</b>' + (x.descr ? '<p>' + esc(x.descr) + '</p>' : '') + '</div></div>'; }).join('') + '</div>'
      : '<div class="rr-card" style="text-align:center;padding:26px 14px"><h3 style="margin:0 0 6px">Lessons are on the way</h3><p style="color:var(--mute);margin:0">New videos are added here as they are published.</p></div>';
    if(admin) h += adminHtml();
    box.innerHTML = h; wire(); if(admin) adminList();
  }

  async function open(id){
    var x = L.filter(function(z){ return String(z.id) === String(id); })[0]; if(!x) return; var w = who();
    if(!w.user){ if(window.ttmSignIn) window.ttmSignIn(); return; }
    if(tier() < (TIERS[x.min_tier] || 0)){
      var p = x.min_tier === 'pro' ? 'pro' : 'premium';
      say('<h3 style="margin:4px 0 6px">🔒 ' + esc(x.title) + '</h3><p style="color:var(--mute)">This lesson is for <b>' + TN[x.min_tier] + '</b> members' + (x.min_tier === 'premium' ? ' (Pro members get it too)' : '') + '.</p><div class="rr-acts">' +
        (window.ttmBillOn && window.ttmBillOn() ? '<button class="rr-btn" data-buy="' + p + '">Upgrade to ' + TN[x.min_tier] + '</button>' : '<p class="calendar-note" style="margin:0">Paid plans open soon. Message TTM to ask about access.</p>') + '<button class="rr-btn ghost" data-close="1">Close</button></div>'); return; }
    say('<p style="color:var(--mute);text-align:center;padding:30px 0">Loading…</p>');
    var r = await api('/rest/v1/rpc/ttm_lesson_video', {method: 'POST', body: JSON.stringify({p_id: +x.id})}), v = r.ok ? r.json : null;
    if(v && typeof v === 'object' && !v.vid && v.ttm_lesson_video) v = v.ttm_lesson_video;
    if(!v || !v.vid){ say('<h3>Not available</h3><p style="color:var(--mute)">This lesson could not be opened with your current plan.</p><div class="rr-acts"><button class="rr-btn ghost" data-close="1">Close</button></div>'); return; }
    if(v.provider === 'zoom'){ modal.innerHTML = '<div class="ed-in" style="max-width:460px"><h3 style="margin:4px 0 6px">' + esc(x.title) + '</h3>' + (x.descr ? '<p style="color:var(--mute);font-size:13px">' + esc(x.descr) + '</p>' : '') + '<p style="color:var(--mute);font-size:13px">This lesson opens in Zoom in a new tab. If Zoom asks for a passcode, ask TTM. Please do not share the link.</p><div class="rr-acts"><a class="rr-btn" href="' + esc(v.vid) + '" target="_blank" rel="noopener noreferrer" data-zoomgo="1">▶ Watch on Zoom</a><button class="rr-btn sm" data-seen="' + x.id + '">' + (seen[x.id] ? '✓ Watched (tap to undo)' : 'Mark as watched') + '</button><button class="rr-btn ghost sm" data-close="1">Close</button></div></div>'; modal.style.display = 'flex'; return; }
    var src = v.provider === 'stream' ? 'https://iframe.videodelivery.net/' + encodeURIComponent(v.vid) : 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(v.vid) + '?rel=0&modestbranding=1&playsinline=1';
    modal.innerHTML = '<div class="ed-in"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0 2px 8px"><b style="font-size:15px">' + esc(x.title) + '</b><button class="rr-btn ghost sm" data-close="1">Close ✕</button></div><div class="ed-vid"><iframe src="' + src + '" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>' +
      (x.descr ? '<p style="color:var(--mute);font-size:13px;margin:10px 4px 0">' + esc(x.descr) + '</p>' : '') + '<div class="rr-acts" style="margin-top:10px"><button class="rr-btn sm" data-seen="' + x.id + '">' + (seen[x.id] ? '✓ Watched (tap to undo)' : 'Mark as watched') + '</button></div></div>';
    modal.style.display = 'flex';
  }

  // ---------- admin: add / edit / hide / delete lessons ----------
  function adminHtml(){ return '<div class="rr-card" style="margin-top:22px"><h3 style="margin:0 0 4px">Manage lessons <small style="color:var(--mute);font-weight:400">(only you see this)</small></h3>' +
    '<p class="calendar-note" style="margin:0 0 10px">Paste a YouTube link (set the video to <b>Unlisted</b> on YouTube). Choose who can watch. Lessons show in Order, smallest first. A YouTube link can be shared by someone who has it; for fully locked video later, switch Video host to Cloudflare Stream and paste the Stream video id.</p>' +
    '<div class="ed-f"><input id="edT" placeholder="Lesson title"><input id="edC" placeholder="Category, e.g. Basics, Trading, Macro" value="General"><input id="edV" placeholder="Video link (YouTube / Zoom) or Stream video id"><select id="edP"><option value="youtube">Video host: YouTube (unlisted)</option><option value="stream">Video host: Cloudflare Stream</option><option value="zoom">Video host: Zoom recording link</option></select>' +
    '<select id="edM"><option value="free">Who can watch: Free (all members)</option><option value="premium">Premium and Pro</option><option value="pro">Pro only</option></select><input id="edS" type="number" placeholder="Order (1 = first)" value="100"><input id="edD" placeholder="Length, e.g. 12 min"><label style="display:flex;gap:8px;align-items:center"><input id="edU" type="checkbox" checked style="width:auto"> Published</label></div>' +
    '<textarea id="edX" placeholder="Short description (optional)" rows="2" style="margin-top:8px;background:rgba(255,255,255,.04);border:1px solid var(--line,#2a2a2f);color:var(--text,#eee);border-radius:8px;padding:9px 10px;font:inherit;width:100%;box-sizing:border-box"></textarea>' +
    '<div class="rr-acts" style="margin:10px 0 0"><button class="rr-btn sm" id="edAdd">Add lesson</button><button class="rr-btn ghost sm" id="edCancel" style="display:none">Cancel edit</button></div><p class="calendar-note" id="edMsg" style="margin:8px 0 0"></p><div id="edList"></div></div>'; }
  function adminList(){ var l = document.getElementById('edList'); if(!l) return; l.innerHTML = L.length ? '<div class="rr-wrap" style="margin-top:10px"><table class="rr-tbl"><thead><tr><th>#</th><th>Lesson</th><th>Plan</th><th>Shown</th><th></th></tr></thead><tbody>' + L.map(function(x){
    return '<tr><td>' + x.sort + '</td><td>' + esc(x.title) + '<br><small style="color:var(--mute)">' + esc(x.category) + (x.duration ? ' · ' + esc(x.duration) : '') + '</small></td><td>' + TN[x.min_tier] + '</td><td>' + (x.published ? 'Yes' : 'Hidden') + '</td><td><button class="rr-btn ghost sm" data-edit="' + x.id + '">Edit</button> <button class="rr-btn ghost sm" data-del="' + x.id + '">Delete</button></td></tr>'; }).join('') + '</tbody></table></div>' : ''; }
  function reset(){ editId = null; ['edT', 'edV', 'edD', 'edX'].forEach(function(i){ var n = document.getElementById(i); if(n) n.value = ''; }); var c = document.getElementById('edC'); if(c) c.value = 'General'; var s = document.getElementById('edS'); if(s) s.value = '100'; var u = document.getElementById('edU'); if(u) u.checked = true;
    var a = document.getElementById('edAdd'); if(a) a.textContent = 'Add lesson'; var k = document.getElementById('edCancel'); if(k) k.style.display = 'none'; }
  async function edit(id){ var x = L.filter(function(z){ return String(z.id) === String(id); })[0]; if(!x) return; editId = x.id;
    var r = await api('/rest/v1/rpc/ttm_lesson_video', {method: 'POST', body: JSON.stringify({p_id: +x.id})}), v = r.ok ? r.json : null; if(v && v.ttm_lesson_video) v = v.ttm_lesson_video;
    var g = function(i){ return document.getElementById(i); }; g('edT').value = x.title; g('edC').value = x.category; g('edV').value = v && v.vid ? v.vid : ''; g('edP').value = x.provider; g('edM').value = x.min_tier; g('edS').value = x.sort; g('edD').value = x.duration || ''; g('edX').value = x.descr || ''; g('edU').checked = !!x.published;
    g('edAdd').textContent = 'Save changes'; g('edCancel').style.display = ''; g('edT').scrollIntoView({block: 'center', behavior: 'smooth'}); g('edMsg').textContent = 'Editing this lesson.'; }
  async function add(){ var g = function(i){ return document.getElementById(i); }, m = g('edMsg'), prov = g('edP').value, vid = parseVid(g('edV').value, prov), title = g('edT').value.trim();
    if(!title){ m.textContent = 'Add a title.'; return; } if(!vid){ m.textContent = prov === 'zoom' ? 'Paste the Zoom share link (https://…zoom.us/rec/share/…).' : prov === 'stream' ? 'Paste the Cloudflare Stream video id.' : 'Paste a YouTube link (youtube.com/watch?v=… or youtu.be/…).'; return; }
    var body = {title: title, descr: g('edX').value.trim() || null, category: g('edC').value.trim() || 'General', provider: prov, vid: vid, min_tier: g('edM').value, sort: parseInt(g('edS').value, 10) || 100, duration: g('edD').value.trim() || null, published: g('edU').checked};
    m.textContent = 'Saving…'; var r = editId ? await api('/rest/v1/ttm_lessons?id=eq.' + editId, {method: 'PATCH', headers: {Prefer: 'return=minimal'}, body: JSON.stringify(body)}) : await api('/rest/v1/ttm_lessons', {method: 'POST', headers: {Prefer: 'return=minimal'}, body: JSON.stringify(body)});
    if(r.ok){ reset(); await load(); var m2 = document.getElementById('edMsg'); if(m2) m2.textContent = 'Saved.'; } else m.textContent = 'Could not save. Run supabase/education.sql first, and make sure you are signed in as admin.'; }

  function wire(){
    if(box.dataset.w) return; box.dataset.w = '1';
    box.addEventListener('click', function(ev){ var t = ev.target;
      var c = t.closest('[data-cat]'); if(c){ cat = c.dataset.cat; render(); return; }
      if(t.closest('#edSign')){ if(window.ttmSignIn) window.ttmSignIn(); return; }
      if(t.closest('#edAdd')){ add(); return; } if(t.closest('#edCancel')){ reset(); var m = document.getElementById('edMsg'); if(m) m.textContent = ''; return; }
      var ed = t.closest('[data-edit]'); if(ed){ edit(ed.dataset.edit); return; }
      var dl = t.closest('[data-del]'); if(dl){ if(confirm('Delete this lesson?')) api('/rest/v1/ttm_lessons?id=eq.' + dl.dataset.del, {method: 'DELETE'}).then(load); return; }
      var k = t.closest('.ed-card'); if(k){ open(k.dataset.id); } });
    modal.addEventListener('click', function(ev){ var t = ev.target;
      if(t === modal || t.closest('[data-close]')){ closeModal(); return; }
      var b = t.closest('[data-buy]'); if(b){ closeModal(); if(window.ttmBuy) window.ttmBuy(b.dataset.buy); return; }
      var s = t.closest('[data-seen]'); if(s){ var id = s.dataset.seen; if(seen[id]) delete seen[id]; else seen[id] = 1; save(); s.textContent = seen[id] ? '✓ Watched (tap to undo)' : 'Mark as watched'; render(); } });
    document.addEventListener('keydown', function(ev){ if(ev.key === 'Escape') closeModal(); });
  }
  // load when the Education page is opened, and again once sign-in finishes
  function boot(){ if(location.hash === '#education' || !loaded) load(); }
  window.addEventListener('hashchange', function(){ if(location.hash === '#education') load(); });
  document.addEventListener('ttm:auth', load);
  setTimeout(boot, 1500); setInterval(function(){ if(!loaded && location.hash === '#education') load(); }, 4000);
})();
