// One function for every phone push and the live-session Telegram posts.
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
async function send(subs: any[], payload: object) {
  const body = JSON.stringify(payload); let sent = 0;
  await Promise.all(subs.map(async (s: any) => {
    try { await webpush.sendNotification({endpoint: s.endpoint, keys: {p256dh: s.p256dh, auth: s.auth}}, body, {TTL: 3600, urgency: "high"}); sent++; }
    catch (e: any) { if (e.statusCode === 404 || e.statusCode === 410) await rest("ttm_push_subs?endpoint=eq." + encodeURIComponent(s.endpoint), {method: "DELETE"}); }
  }));
  return sent;
}
async function telegram(text: string, zoom: string) {
  const tok = Deno.env.get("TELEGRAM_BOT_TOKEN"), chat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!tok || !chat) { console.log("telegram skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID secret is missing"); return false; }
  const thread = +(Deno.env.get("TELEGRAM_LIVE_THREAD_ID") || "41");
  const markup = {inline_keyboard: [[{text: "Join the live session", url: zoom}]]};
  const call = async (method: string, extra: object) => {
    const r = await fetch(`https://api.telegram.org/bot${tok}/${method}`, {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({chat_id: chat, message_thread_id: thread, reply_markup: markup, ...extra})});
    const j = await r.json(); if (!j.ok) console.log("telegram " + method + " failed:", j.error_code, j.description); return !!j.ok;
  };
  const photo = Deno.env.get("LIVE_IMAGE_URL") || "https://ttm-tradethemove.github.io/ttm-markets-terminal/promo/live-session.jpg";
  if (await call("sendPhoto", {photo, caption: text.slice(0, 1000)})) return true;
  return await call("sendMessage", {text, disable_web_page_preview: true});
}
// same clock time in Sydney, a number of days later (so a weekly session stays at the same time across daylight saving)
const TZ = "Australia/Sydney";
const wall = (ms: number) => { const p: any = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); };
const addDays = (iso: string, days: number) => { const base = new Date(iso).getTime(), target = wall(base) + days * 864e5; let g = base + days * 864e5; for (let i = 0; i < 3; i++) g += target - wall(g); return new Date(g).toISOString(); };
const when = (iso: string) => new Intl.DateTimeFormat("en-AU", {timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true}).format(new Date(iso)) + " Melbourne time";

Deno.serve(async (req) => {
  let b: any = {}; try { b = await req.json(); } catch (_) {}
  const table = b.table || "cron", rec = b.record || {};
  const now = Date.now();

  if (table === "ttm_spot_feed") {
    const row = rec.id && await claim("ttm_spot_feed", rec.id, "pushed"); if (!row) return new Response("skip");
    const dir = /Short/.test(row.title) ? "Short" : "Long";
    const short: Record<string, string> = {buy: dir + " position opened", fill: dir + " limit order collected", tp: dir + " TP hit", part: "partial profit taken", sell: dir + " position closed", add: dir + " position added to"};
    const title = row.asset && short[row.kind] ? row.asset + " " + short[row.kind] : row.title;
    const pros = await get(`ttm_profiles?select=id&or=(is_admin.eq.true,and(plan.eq.pro,or(plan_until.is.null,plan_until.gt.${new Date().toISOString()})))`);
    const n = await send(await subsFor(idsOf(pros)), {title, body: row.body || "TTM Spot portfolio", tag: "ttm-" + row.id, url: "./crypto/index.html"});
    return new Response("spot " + n);
  }

  if (table === "ttm_my_alerts") {
    const row = rec.id && await claim("ttm_my_alerts", rec.id, "pushed"); if (!row) return new Response("skip");
    const n = await send(await subsFor(row.user_id), {title: row.title, body: row.body || "", tag: "my-" + row.id, url: "./crypto/index.html#riskreward"});
    return new Response("mine " + n);
  }

  if (table === "ttm_chat") {
    const row = rec.id && await claim("ttm_chat", rec.id, "pushed"); if (!row) return new Response("skip");
    const text = String(row.body).slice(0, 140);
    if (row.from_admin) {
      const n = await send(await subsFor(row.member_id), {title: "TTM replied to you", body: text, tag: "chat-" + row.member_id, url: "./crypto/index.html#chat"});
      return new Response("reply " + n);
    }
    const p = (await get(`ttm_profiles?select=email,tg_handle&id=eq.${row.member_id}`))[0] || {};
    const admins = await get("ttm_profiles?select=id&is_admin=eq.true");
    const n = await send(await subsFor(idsOf(admins)), {title: "Message from " + (p.tg_handle ? "@" + String(p.tg_handle).replace(/^@/, "") : p.email || "a member"), body: text, tag: "chat-" + row.member_id, url: "./crypto/index.html#chat"});
    return new Response("msg " + n);
  }

  // cron tick: live sessions
  const soon = new Date(now + 15 * 60000).toISOString(), back = new Date(now - 10 * 60000).toISOString();
  const due = await get(`ttm_live?select=*&reminded=eq.false&starts_at=lte.${soon}&starts_at=gt.${back}`);
  for (const s of due) {
    const c = await claim("ttm_live", s.id, "reminded"); if (!c) continue;
    await rest(`ttm_live?id=eq.${s.id}`, {method: "PATCH", body: JSON.stringify({announced: true})});
    if (s.repeat_days > 0) {
      const next = addDays(s.starts_at, s.repeat_days);
      if (!(await get(`ttm_live?select=id&starts_at=eq.${encodeURIComponent(next)}&title=eq.${encodeURIComponent(s.title)}`)).length)
        await rest("ttm_live", {method: "POST", headers: {Prefer: "return=minimal"}, body: JSON.stringify({title: s.title, starts_at: next, zoom_url: s.zoom_url, note: s.note, repeat_days: s.repeat_days, announced: true})});
    }
    const mins = Math.max(1, Math.round((new Date(s.starts_at).getTime() - now) / 60000));
    await telegram(`LIVE SESSION STARTING SOON\n\n${s.title}\nStarts in about ${mins} minutes\n${when(s.starts_at)}\n\n${s.zoom_url}`, s.zoom_url);
    await send(await subsFor(null), {title: "Live in " + mins + " minutes", body: s.title, tag: "live-" + s.id, url: s.zoom_url});
  }
  const fresh = await get(`ttm_live?select=*&announced=eq.false&starts_at=gt.${new Date(now).toISOString()}`);
  for (const s of fresh) {
    const c = await claim("ttm_live", s.id, "announced"); if (!c) continue;
    await telegram(`LIVE SESSION\n\n${s.title}\n${when(s.starts_at)}\n${s.note ? "\n" + s.note + "\n" : ""}\n${s.zoom_url}`, s.zoom_url);
    await send(await subsFor(null), {title: "New live session", body: s.title + " · " + when(s.starts_at), tag: "live-new-" + s.id, url: "./crypto/index.html"});
  }
  const luna = await get(`ttm_luna_alerts?select=*&notified=eq.false&starts_at=gt.${new Date(now).toISOString()}&starts_at=lte.${new Date(now + 7 * 864e5).toISOString()}`);
  for (const s of luna) {
    const c = await claim("ttm_luna_alerts", s.id, "notified"); if (!c) continue;
    const people = await get("ttm_profiles?select=id&or=(is_admin.eq.true,beta.eq.true)");
    const day = new Intl.DateTimeFormat("en-AU", {timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", year: "numeric"}).format(new Date(s.starts_at));
    await send(await subsFor(idsOf(people)), {title: (s.color === "green" ? "🟢 " : "🔴 ") + s.name, body: "Starts in 7 days · " + day, tag: "luna-" + s.id, url: "./crypto/index.html#lunacycles"});
  }
  return new Response("tick");
});
