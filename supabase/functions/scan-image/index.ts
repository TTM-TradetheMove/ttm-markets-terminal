// Scans an uploaded chat image before it is allowed into the community rooms.
// Flow: the member uploads to the private "room-pending" bucket, then calls this function with the path.
// If the file passes, it is copied into the public "room-images" bucket (only this function can write there).
// If not, it is deleted and the reason is returned.
// Keep "Verify JWT" ON for this function. Optional secret VT_API_KEY adds a VirusTotal known-malware check.
import {scan, sha256} from "./scan.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!, KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS"};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), {status: s, headers: {...CORS, "Content-Type": "application/json"}});
const H = {apikey: KEY, Authorization: "Bearer " + KEY};
const uidOf = (req: Request) => { try { const t = (req.headers.get("authorization") || "").replace(/^Bearer /i, ""), p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return p.role === "authenticated" ? String(p.sub) : ""; } catch (_) { return ""; } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers: CORS});
  const uid = uidOf(req); if (!uid) return json({ok: false, reason: "sign in first"}, 401);
  let b: any = {}; try { b = await req.json(); } catch (_) {}
  const path = String(b.path || ""); if (!path.startsWith(uid + "/") || path.includes("..") || path.length > 200) return json({ok: false, reason: "bad path"}, 400);
  const get = await fetch(`${URL_}/storage/v1/object/room-pending/${path}`, {headers: H}); if (!get.ok) return json({ok: false, reason: "upload not found"}, 404);
  const u = new Uint8Array(await get.arrayBuffer());
  const drop = () => fetch(`${URL_}/storage/v1/object/room-pending/${path}`, {method: "DELETE", headers: H}).catch(() => {});
  const v = scan(u, String(b.type || "") || undefined);
  if (!v.ok) { await drop(); return json({ok: false, reason: v.reason}); }
  const vt = Deno.env.get("VT_API_KEY");
  if (vt) {
    try { const r = await fetch("https://www.virustotal.com/api/v3/files/" + await sha256(u), {headers: {"x-apikey": vt}});
      if (r.ok) { const s = (await r.json())?.data?.attributes?.last_analysis_stats || {}; if ((s.malicious || 0) > 0) { await drop(); return json({ok: false, reason: "flagged as malware by VirusTotal"}); } } } catch (_) {}
  }
  const name = `${uid}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${v.ext}`;
  const up = await fetch(`${URL_}/storage/v1/object/room-images/${name}`, {method: "POST", headers: {...H, "Content-Type": v.mime}, body: u});
  await drop(); if (!up.ok) return json({ok: false, reason: "could not save the image"}, 500);
  return json({ok: true, url: `${URL_}/storage/v1/object/public/room-images/${name}`});
});
