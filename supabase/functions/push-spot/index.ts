// One function for every phone push (spot moves, chat, live sessions, unlocks, new members, announcements).
//  - Database webhook on ttm_spot_feed (insert): Pro members get the spot move
//  - Database webhook on ttm_chat (insert): admin gets member messages, members get replies
//  - pg_cron tick every minute (table = "cron"): live sessions are announced, then reminded 15 minutes before
// Turn OFF "Verify JWT" for this function. It only ever acts on real rows in the database, and each row
// can fire only once, so a fake call cannot send anything.
import webpush from "npm:web-push@3.6.7";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
webpush.setVapidDetails("mailto:" + (Deno.env.get("VAPID_SUBJECT") || "tradethemove@icloud.com"),
  Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);
const H = {apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json"};
const rest = (p: string, o: any = {}) => fetch(URL_ + "/rest/v1/" + p, {...o, headers: {...H, ...(o.headers || {})}});
const get = async (p: string) => { const r = await rest(p); const j = await r.json(); return Array.isArray(j) ? j : []; };
// mark a row as handled; only the first caller gets the row back, so nothing is sent twice
const claim = async (table: string, id: number, col: string) => {
  const r = await rest(`${table}?id=eq.${id}&${col}=eq.false`, {method: "PATCH", headers: {Prefer: "return=representation"}, body: JSON.stringify({[col]: true})});
  const j = await r.json(); return Array.isArray(j) && j.length ? j[0] : null;
};
const idsOf = (rows: any[]) => rows.map((p) => p.id).join(",");
const subsFor = async (ids: string | null) => ids === null ? await get("ttm_push_subs?select=*") : ids ? await get(`ttm_push_subs?select=*&user_id=in.(${ids})`) : [];
// members who switched this kind of alert off in their settings
const offFor = async (key: string) => new Set((await get(`ttm_prefs?select=user_id&prefs->>${key}=eq.false`)).map((x: any) => x.user_id));
async function send(subs: any[], payload: object, key?: string) {
  if (key) { const off = await offFor(key); subs = subs.filter((s: any) => !off.has(s.user_id)); }
  const body = JSON.stringify(payload); let sent = 0;
  await Promise.all(subs.map(async (s: any) => {
    try { await webpush.sendNotification({endpoint: s.endpoint, keys: {p256dh: s.p256dh, auth: s.auth}}, body, {TTL: 3600, urgency: "high"}); sent++; }
    catch (e: any) { if (e.statusCode === 404 || e.statusCode === 410) await rest("ttm_push_subs?endpoint=eq." + encodeURIComponent(s.endpoint), {method: "DELETE"}); }
  }));
  return sent;
}
// same clock time in Sydney, a number of days later (so a weekly session stays at the same time across daylight saving)
const TZ = "Australia/Sydney";
const wall = (ms: number) => { const p: any = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); };
const addDays = (iso: string, days: number) => { const base = new Date(iso).getTime(), target = wall(base) + days * 864e5; let g = base + days * 864e5; for (let i = 0; i < 3; i++) g += target - wall(g); return new Date(g).toISOString(); };
const when = (iso: string) => new Intl.DateTimeFormat("en-AU", {timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true}).format(new Date(iso)) + " Melbourne time";

// ---- market sessions: same core hours as the Trading Hours clocks (all exchanges of a region open together)
const EXCH: [string, string, number, number][] = [
  ["asia", "Australia/Sydney", 600, 960], ["asia", "Asia/Tokyo", 540, 930], ["asia", "Asia/Hong_Kong", 570, 960], ["asia", "Asia/Singapore", 540, 1020],
  ["ldn", "Europe/London", 480, 990], ["ldn", "Europe/Berlin", 540, 1050], ["ny", "America/New_York", 570, 960]];
const SESS: Record<string, {name: string; zone: string; icon: string}> = {asia: {name: "ASIA", zone: "Australia/Melbourne", icon: "🌏"}, ldn: {name: "London", zone: "Europe/London", icon: "🇬🇧"}, ny: {name: "US", zone: "America/New_York", icon: "🇺🇸"}};
const wz = (ms: number, zone: string) => { const p: any = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); };
const localToUtc = (day: number, min: number, zone: string) => { const want = day + min * 60000; let g = want; for (let i = 0; i < 3; i++) g += want - wz(g, zone); return g; };
function sessionEvents(now: number) {
  const out: {t: number; id: string; key: string; warn: boolean; wk: boolean; title: string; body: string}[] = [];
  for (const k of Object.keys(SESS)) {
    let spans: [number, number][] | null = null;
    for (const [kk, zone, o, c] of EXCH) {
      if (kk !== k) continue;
      const base = Math.floor(wz(now, zone) / 864e5) * 864e5, w: [number, number][] = [-1, 0, 1].map((d) => [localToUtc(base + d * 864e5, o, zone), localToUtc(base + d * 864e5, c, zone)]);
      spans = spans === null ? w : spans.flatMap(([a1, b1]) => w.map(([a2, b2]) => [Math.max(a1, a2), Math.min(b1, b2)] as [number, number]).filter(([a, b]) => a < b));
    }
    for (const [st, en] of spans || []) {
      const dow = new Date(wz(st, SESS[k].zone)).getUTCDay(), wk = dow === 0 || dow === 6;
      const day = new Date(wz(st, SESS[k].zone)).toISOString().slice(0, 10), s = SESS[k];
      out.push({t: st - 15 * 60000, id: `${k}-warnopen-${day}`, key: `s_${k}_open`, warn: true, wk, title: `${s.icon} ${s.name} opens in 15 min`, body: wk ? "Weekend crypto session about to start" : "Core market session about to start"});
      out.push({t: st, id: `${k}-open-${day}`, key: `s_${k}_open`, warn: false, wk, title: `${s.icon} ${s.name} session open`, body: wk ? "Weekend crypto session is now live" : "Core market session is now live"});
      out.push({t: en - 15 * 60000, id: `${k}-warnclose-${day}`, key: `s_${k}_close`, warn: true, wk, title: `${s.icon} ${s.name} closes in 15 min`, body: wk ? "Weekend crypto session ending soon" : "Core market session ending soon"});
      out.push({t: en, id: `${k}-close-${day}`, key: `s_${k}_close`, warn: false, wk, title: `${s.icon} ${s.name} session closed`, body: wk ? "Weekend crypto session has ended" : "Core market session has ended"});
    }
  }
  return out;
}
async function sessionAlerts(now: number) {
  for (const ev of sessionEvents(now)) {
    if (!(ev.t <= now && ev.t > now - 150000)) continue;
    const r = await rest("ttm_session_fired?on_conflict=ukey", {method: "POST", headers: {Prefer: "resolution=ignore-duplicates,return=representation"}, body: JSON.stringify({ukey: ev.id})});
    const j = await r.json(); if (!Array.isArray(j) || !j.length) continue;   // already sent
    const who = await get(`ttm_prefs?select=user_id&prefs->>${ev.key}=eq.true${ev.warn ? "&prefs->>s_warn=eq.true" : ""}${ev.wk ? "&or=(prefs->>s_wknd.is.null,prefs->>s_wknd.neq.false)" : ""}`);
    if (!who.length) continue;
    await send(await subsFor(idsOf(who.map((x: any) => ({id: x.user_id})))), {title: ev.title, body: ev.body, tag: "sess-" + ev.id, url: "./crypto/index.html#tradinghours"});
  }
}

// token unlocks (beta): a heads-up 7 days and 24 hours before
async function unlockAlerts(now: number) {
  for (const [col, ms, label] of [["alerted7", 7 * 864e5, "7 days"], ["alerted1", 864e5, "24 hours"]] as [string, number, string][]) {
    const due = await get(`ttm_unlocks?select=*&${col}=eq.false&unlock_at=gt.${new Date(now).toISOString()}&unlock_at=lte.${new Date(now + ms).toISOString()}`);
    for (const u of due) {
      if (!(await claim("ttm_unlocks", u.id, col))) continue;
      if (col === "alerted7" && new Date(u.unlock_at).getTime() - now <= 864e5) continue;   // added late: only the 24 hour alert
      const people = await get("ttm_profiles?select=id&or=(is_admin.eq.true,beta.eq.true)");
      const bits = [u.pct != null ? Number(u.pct).toFixed(2) + "% of supply" : "", u.amount ? Number(u.amount).toLocaleString("en-US", {maximumFractionDigits: 0}) + " " + u.token : "", u.kind || ""].filter(Boolean).join(" · ");
      await send(await subsFor(idsOf(people)), {title: "🔓 " + String(u.token).toUpperCase() + " unlock in " + label, body: bits || "Scheduled token unlock", tag: "unlock-" + u.id + "-" + col, url: "./crypto/index.html#tokenunlocks"}, "vest");
    }
  }
}

// room message alerts: who has access to the room, then each member's own settings decide
async function roomPush(m: any) {
  const accRow = (await get("ttm_settings?select=value&key=eq.access"))[0];
  const dflt: Record<string, string[]> = {free: ["free", "premium", "pro"], premium: ["premium", "pro"], pro: ["pro"]};
  const allowed: string[] = (accRow?.value && accRow.value["room:" + m.room]) || dflt[m.room] || [];
  const subs = (await get("ttm_push_subs?select=*")).filter((s: any) => s.user_id !== m.user_id);
  const ids = [...new Set(subs.map((s: any) => s.user_id))]; if (!ids.length) return;
  const profs = await get(`ttm_profiles?select=id,is_admin,beta,plan,plan_until&id=in.(${ids.join(",")})`);
  const sender = (await get(`ttm_profiles?select=is_admin&id=eq.${m.user_id}`))[0];
  const prefs: Record<string, any> = {}; (await get(`ttm_prefs?select=user_id,prefs&user_id=in.(${ids.join(",")})`)).forEach((x: any) => { prefs[x.user_id] = x.prefs || {}; });
  const nowIso = new Date().toISOString();
  // @tags: the tagged member gets their own alert, whatever their room setting (unless they turned tags off)
  const tags = [...new Set([...String(m.body || "").matchAll(/(?:^|[\s(])@([A-Za-z0-9_]{2,32})/g)].map((x) => x[1].toLowerCase()))].slice(0, 5);
  const tagged = new Set<string>();
  if (tags.length) {
    const tp = await get(`ttm_profiles?select=id,is_admin,beta,plan,plan_until,tg_handle&tg_handle=in.(${tags.map((x) => '"' + x + '"').join(",")})`);
    const byLower = tp.filter((p: any) => tags.includes(String(p.tg_handle || "").toLowerCase()));
    const tIds = byLower.map((p: any) => p.id).filter((id: string) => id !== m.user_id);
    if (tIds.length) {
      const tprefs: Record<string, any> = {}; (await get(`ttm_prefs?select=user_id,prefs&user_id=in.(${tIds.join(",")})`)).forEach((x: any) => { tprefs[x.user_id] = x.prefs || {}; });
      const tsubs = await get(`ttm_push_subs?select=*&user_id=in.(${tIds.join(",")})`);
      const okIds = byLower.filter((p: any) => {
        let plan = p.plan === "crypto" || p.plan === "tradfi" ? "premium" : (p.plan || "free");
        if (plan !== "free" && p.plan_until && p.plan_until < nowIso) plan = "free";
        return (p.is_admin || allowed.includes("free") || allowed.includes(plan) || (p.beta && allowed.includes("beta"))) && (tprefs[p.id] || {}).mention !== false;
      }).map((p: any) => p.id);
      okIds.forEach((id: string) => tagged.add(id));
      const rm = m.room.charAt(0).toUpperCase() + m.room.slice(1);
      await send(tsubs.filter((s: any) => okIds.includes(s.user_id)), {title: (m.name || "Member") + " tagged you · " + rm + " room", body: String(m.body).slice(0, 140), tag: "tag-" + m.id, url: "./crypto/index.html#community"});
    }
  }
  const to = new Set(profs.filter((p: any) => {
    if (tagged.has(p.id)) return false;
    let plan = p.plan === "crypto" || p.plan === "tradfi" ? "premium" : (p.plan || "free");
    if (plan !== "free" && p.plan_until && p.plan_until < nowIso) plan = "free";
    const ok = p.is_admin || allowed.includes("free") || allowed.includes(plan) || (p.beta && allowed.includes("beta"));
    if (!ok) return false;
    const pr = prefs[p.id] || {}, mode = pr.rooms || "ttm";
    if (mode === "off" || pr["r_" + m.room] === false) return false;
    if (mode === "all") return true;
    if (mode === "follow") return Array.isArray(pr.follow) && pr.follow.some((f: any) => f.id === m.user_id);
    return !!sender?.is_admin;
  }).map((p: any) => p.id));
  const list = subs.filter((s: any) => to.has(s.user_id)); if (!list.length) return;
  const room = m.room.charAt(0).toUpperCase() + m.room.slice(1);
  await send(list, {title: (m.name || "Member") + " · " + room + " room", body: m.img && !m.body ? "Sent an image" : String(m.body).slice(0, 140), tag: "room-" + m.room, url: "./crypto/index.html#community"});
}

Deno.serve(async (req) => {
  let b: any = {}; try { b = await req.json(); } catch (_) {}
  const table = b.table || "cron", rec = b.record || {};
  const now = Date.now();

  if (table === "ttm_spot_feed") {
    const row = rec.id && await claim("ttm_spot_feed", rec.id, "pushed"); if (!row) return new Response("skip");
    const dir = /Short/.test(row.title) ? "Short" : "Long";
    const short: Record<string, string> = {buy: dir + " position opened", fill: dir + " limit order collected", tp: dir + " TP hit", part: "partial profit taken", sell: dir + " position closed", add: dir + " position added to"};
    const title = row.asset && short[row.kind] ? row.asset + (row.market === "tradfi" ? " (TradFi Spot) " : " (Spot) ") + short[row.kind] : row.title;
    const pros = await get(`ttm_profiles?select=id&or=(is_admin.eq.true,and(plan.eq.pro,or(plan_until.is.null,plan_until.gt.${new Date().toISOString()})))`);
    const n = await send(await subsFor(idsOf(pros)), {title, body: row.body || "TTM Spot portfolio", tag: "ttm-" + row.id, url: "./crypto/index.html"}, "spot");
    return new Response("spot " + n);
  }

  if (table === "ttm_my_alerts") {
    const row = rec.id && await claim("ttm_my_alerts", rec.id, "pushed"); if (!row) return new Response("skip");
    const n = await send(await subsFor(row.user_id), {title: row.title, body: row.body || "", tag: "my-" + row.id, url: "./crypto/index.html#riskreward"}, "mytrade");
    return new Response("mine " + n);
  }

  if (table === "ttm_chat") {
    const row = rec.id && await claim("ttm_chat", rec.id, "pushed"); if (!row) return new Response("skip");
    const text = String(row.body).slice(0, 140);
    if (row.from_admin) {
      const n = await send(await subsFor(row.member_id), {title: "TTM replied to you", body: text, tag: "chat-" + row.member_id, url: "./crypto/index.html#chat"}, "chat");
      return new Response("reply " + n);
    }
    const p = (await get(`ttm_profiles?select=email,tg_handle&id=eq.${row.member_id}`))[0] || {};
    const admins = await get("ttm_profiles?select=id&is_admin=eq.true");
    const n = await send(await subsFor(idsOf(admins)), {title: "Message from " + (p.tg_handle ? "@" + String(p.tg_handle).replace(/^@/, "") : p.email || "a member"), body: text, tag: "chat-" + row.member_id, url: "./crypto/index.html#chat"}, "inbox");
    return new Response("msg " + n);
  }

  try { await unlockAlerts(now); } catch (e) { console.log("unlock alerts failed:", String(e)); }
  // cron tick: market session alerts, new community room messages, then live sessions
  try { await sessionAlerts(now); } catch (e) { console.log("session alerts failed:", String(e)); }
  const fresh0 = new Date(now - 10 * 60000).toISOString();
  for (const m of await get(`ttm_room_msgs?select=*&pushed=eq.false&ts=gt.${fresh0}&order=id.asc&limit=20`)) {
    if (!(await claim("ttm_room_msgs", m.id, "pushed"))) continue;
    await roomPush(m);
  }
  const soon = new Date(now + 15 * 60000).toISOString(), back = new Date(now - 10 * 60000).toISOString();
  const due = await get(`ttm_live?select=*&reminded=eq.false&starts_at=lte.${soon}&starts_at=gt.${back}`);
  for (const s of due) {
    const c = await claim("ttm_live", s.id, "reminded"); if (!c) continue;
    await rest(`ttm_live?id=eq.${s.id}`, {method: "PATCH", body: JSON.stringify({announced: true})});
    const dows: number[] = Array.isArray(s.repeat_dow) ? s.repeat_dow : [];
    if (dows.length || s.repeat_days > 0) {
      let next = addDays(s.starts_at, s.repeat_days > 0 ? s.repeat_days : 7);
      if (dows.length) { for (let k = 1; k <= 7; k++) { const c = addDays(s.starts_at, k); if (dows.includes(new Date(wall(new Date(c).getTime())).getUTCDay())) { next = c; break; } } }
      if (!(await get(`ttm_live?select=id&starts_at=eq.${encodeURIComponent(next)}&title=eq.${encodeURIComponent(s.title)}`)).length)
        await rest("ttm_live", {method: "POST", headers: {Prefer: "return=minimal"}, body: JSON.stringify({title: s.title, starts_at: next, zoom_url: s.zoom_url, note: s.note, repeat_days: s.repeat_days || 7, repeat_dow: dows, announced: true})});
    }
    const mins = Math.max(1, Math.round((new Date(s.starts_at).getTime() - now) / 60000));
    await send(await subsFor(null), {title: "Live in " + mins + " minutes", body: s.title, tag: "live-" + s.id, url: s.zoom_url}, "live");
  }
  const fresh = await get(`ttm_live?select=*&announced=eq.false&starts_at=gt.${new Date(now).toISOString()}`);
  for (const s of fresh) {
    const c = await claim("ttm_live", s.id, "announced"); if (!c) continue;
    await send(await subsFor(null), {title: "New live session", body: s.title + " · " + when(s.starts_at), tag: "live-new-" + s.id, url: "./crypto/index.html"}, "live");
  }
  // Eclipse alerts: a push 7 days before and another on the day, to admin, Team, beta testers and Pro members
  const ecAudience = async () => { let people; try { people = await get("ttm_profiles?select=id&or=(is_admin.eq.true,beta.eq.true,team.eq.true,plan.eq.pro)"); } catch (_) { people = await get("ttm_profiles?select=id&or=(is_admin.eq.true,beta.eq.true)"); } return await subsFor(idsOf(people)); };
  const ecDay = (t: string) => new Intl.DateTimeFormat("en-AU", {timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", year: "numeric"}).format(new Date(t));
  const luna = await get(`ttm_luna_alerts?select=*&notified=eq.false&starts_at=gt.${new Date(now).toISOString()}&starts_at=lte.${new Date(now + 7 * 864e5).toISOString()}`);
  for (const s of luna) {
    const c = await claim("ttm_luna_alerts", s.id, "notified"); if (!c) continue;
    await send(await ecAudience(), {title: (s.color === "green" ? "🟢 " : "🔴 ") + s.name, body: "Eclipse in 7 days · " + ecDay(s.starts_at), tag: "luna-" + s.id, url: "./crypto/index.html#lunacycles"}, "luna");
  }
  try {
    const today = await get(`ttm_luna_alerts?select=*&notified_day=eq.false&starts_at=lte.${new Date(now).toISOString()}&starts_at=gt.${new Date(now - 2 * 864e5).toISOString()}`);
    for (const s of today) {
      const c = await claim("ttm_luna_alerts", s.id, "notified_day"); if (!c) continue;
      await send(await ecAudience(), {title: (s.color === "green" ? "🟢 " : "🔴 ") + s.name, body: "Eclipse is happening today · " + ecDay(s.starts_at), tag: "luna-day-" + s.id, url: "./crypto/index.html#lunacycles"}, "luna");
    }
  } catch (e) { console.log("eclipse day alert failed (run supabase/eclipse_alerts.sql):", String(e)); }
  // one-off announcements: insert a row in ttm_announce (see supabase/announce.sql); it goes out within a minute, once
  try {
    for (const an of await get("ttm_announce?select=*&sent=eq.false&order=id.asc&limit=5")) {
      if (!(await claim("ttm_announce", an.id, "sent"))) continue;
      const aud = String(an.audience || "beta");
      const people = aud === "all" ? null : await get(aud === "admin" ? "ttm_profiles?select=id&is_admin=eq.true" : "ttm_profiles?select=id&or=(is_admin.eq.true,beta.eq.true)");
      const n = await send(await subsFor(people === null ? null : idsOf(people)), {title: an.title, body: an.body || "", tag: "ann-" + an.id, url: an.url || "./index.html"});
      await rest(`ttm_announce?id=eq.${an.id}`, {method: "PATCH", body: JSON.stringify({sent_to: n || 0})});
    }
  } catch (e) { console.log("announce failed:", String(e)); }
  // new member: a phone alert to the admin with their name (needs supabase/team_join.sql run once)
  try {
    for (const m of await get("ttm_profiles?select=id,email,tg_handle&join_alerted=eq.false&is_admin=eq.false&order=created_at.asc&limit=10")) {
      if (!(await claim("ttm_profiles", m.id, "join_alerted"))) continue;
      const admins = await get("ttm_profiles?select=id&is_admin=eq.true");
      await send(await subsFor(idsOf(admins)), {title: "👋 New TTM member", body: String(m.tg_handle || m.email || "Someone") + " just joined", tag: "join-" + m.id, url: "./index.html#account"});
    }
  } catch (e) { console.log("new member alert failed:", String(e)); }
  return new Response("tick");
});
