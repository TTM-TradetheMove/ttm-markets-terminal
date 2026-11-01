// Sends a phone push to every Pro member's device when a new row lands in ttm_spot_feed.
// Hook: Database > Webhooks > table ttm_spot_feed > Insert > Supabase Edge Function > push-spot
import webpush from "npm:web-push@3.6.7";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
webpush.setVapidDetails("mailto:" + (Deno.env.get("VAPID_SUBJECT") || "tradethemove@icloud.com"),
  Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);
const H = {apikey: KEY, Authorization: "Bearer " + KEY};
const get = async (p: string) => (await fetch(URL_ + "/rest/v1/" + p, {headers: H})).json();

Deno.serve(async (req) => {
  const {record} = await req.json();
  if (!record || !record.title) return new Response("no record");
  const now = new Date().toISOString();
  const pros = await get(`ttm_profiles?select=id&or=(is_admin.eq.true,and(plan.eq.pro,or(plan_until.is.null,plan_until.gt.${now})))`);
  if (!pros.length) return new Response("no pro");
  const ids = pros.map((p: any) => p.id).join(",");
  const subs = await get(`ttm_push_subs?select=*&user_id=in.(${ids})`);
  const dir = /Short/.test(record.title) ? "Short" : "Long";
  const short: Record<string, string> = {buy: dir + " position opened", fill: dir + " limit order collected", tp: dir + " TP hit", part: "partial profit taken", sell: dir + " position closed", add: dir + " position added to"};
  const title = record.asset && short[record.kind] ? record.asset + " " + short[record.kind] : record.title;
  const body = record.body || "TTM Spot portfolio";
  const payload = JSON.stringify({title, body, tag: "ttm-" + record.id, url: "./crypto/index.html"});
  let sent = 0;
  await Promise.all(subs.map(async (s: any) => {
    try {
      await webpush.sendNotification({endpoint: s.endpoint, keys: {p256dh: s.p256dh, auth: s.auth}}, payload, {TTL: 3600, urgency: "high"});
      sent++;
    } catch (e: any) {
      if (e.statusCode === 404 || e.statusCode === 410)
        await fetch(URL_ + "/rest/v1/ttm_push_subs?endpoint=eq." + encodeURIComponent(s.endpoint), {method: "DELETE", headers: H});
    }
  }));
  return new Response("sent " + sent);
});
