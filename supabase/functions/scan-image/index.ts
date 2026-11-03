// Scans an uploaded chat image before it is allowed into the community rooms. Single file version. Keep Verify JWT ON. Optional secret VT_API_KEY.
// Image checks used by the scan-image function. Pure functions, no network.
// This validates and screens files. It is not a full antivirus engine.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u: Uint8Array, a: number, b: number) => { let c = 0xffffffff; for (let i = a; i < b; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const u32 = (u: Uint8Array, i: number) => ((u[i] << 24) | (u[i + 1] << 16) | (u[i + 2] << 8) | u[i + 3]) >>> 0;
const str = (u: Uint8Array, i: number, n: number) => String.fromCharCode(...u.slice(i, i + n));
type Verdict = {ok: true; mime: string; ext: string} | {ok: false; reason: string};
const MAX_BYTES = 2 * 1024 * 1024, MAX_DIM = 8000;

function sniff(u: Uint8Array): string | null {
  if (u.length > 8 && u[0] === 0x89 && str(u, 1, 3) === "PNG") return "png";
  if (u.length > 3 && u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return "jpeg";
  if (u.length > 6 && (str(u, 0, 6) === "GIF87a" || str(u, 0, 6) === "GIF89a")) return "gif";
  if (u.length > 12 && str(u, 0, 4) === "RIFF" && str(u, 8, 4) === "WEBP") return "webp";
  return null;
}

function checkPng(u: Uint8Array): string | null {
  let p = 8, first = true, chunks = 0;
  while (p + 12 <= u.length) {
    const len = u32(u, p), type = str(u, p + 4, 4); if (len > u.length || p + 12 + len > u.length) return "damaged PNG";
    if (crc32(u, p + 4, p + 8 + len) !== u32(u, p + 8 + len)) return "PNG checksum error";
    if (first) { if (type !== "IHDR" || len !== 13) return "bad PNG header"; const w = u32(u, p + 8), h = u32(u, p + 12); if (!w || !h || w > MAX_DIM || h > MAX_DIM) return "image dimensions are not allowed"; first = false; }
    if (++chunks > 2000) return "too many PNG chunks";
    p += 12 + len;
    if (type === "IEND") return p === u.length ? null : "extra data after the end of the PNG";
  }
  return "PNG has no end";
}
function checkJpeg(u: Uint8Array): string | null {
  let last = -1; for (let i = u.length - 2; i >= 2; i--) if (u[i] === 0xff && u[i + 1] === 0xd9) { last = i; break; }
  if (last < 0) return "JPEG has no end";
  return u.length - (last + 2) <= 2 ? null : "extra data after the end of the JPEG";
}
function checkGif(u: Uint8Array): string | null {
  const w = u[6] | (u[7] << 8), h = u[8] | (u[9] << 8); if (!w || !h || w > MAX_DIM || h > MAX_DIM) return "image dimensions are not allowed";
  let p = 13; const fl = u[10]; if (fl & 0x80) p += 3 * (1 << ((fl & 7) + 1));
  let frames = 0;
  const subs = () => { while (p < u.length) { const n = u[p++]; if (n === 0) return true; p += n; } return false; };
  while (p < u.length) {
    const b = u[p++];
    if (b === 0x3b) return p === u.length ? null : "extra data after the end of the GIF";
    if (b === 0x21) { p++; if (!subs()) return "damaged GIF"; }
    else if (b === 0x2c) { if (p + 9 > u.length) return "damaged GIF"; const lf = u[p + 8]; p += 9; if (lf & 0x80) p += 3 * (1 << ((lf & 7) + 1)); p++; if (!subs()) return "damaged GIF"; if (++frames > 400) return "GIF has too many frames"; }
    else return "unknown GIF block";
  }
  return "GIF has no end";
}
function checkWebp(u: Uint8Array): string | null {
  const size = u[4] | (u[5] << 8) | (u[6] << 16) | (u[7] << 24) >>> 0; return (size >>> 0) + 8 === u.length ? null : "WebP size mismatch";
}
const BAD = ["<script", "<?php", "<iframe", "javascript:", "vbscript:", "powershell", "cmd.exe", "#!/bin/", "this program cannot be run", "onerror=", "<svg", "<!doctype html", "<html"];
function scan(u: Uint8Array, declaredMime?: string): Verdict {
  if (u.length < 32) return {ok: false, reason: "file is empty or too small"};
  if (u.length > MAX_BYTES) return {ok: false, reason: "file is over 2 MB"};
  const k = sniff(u); if (!k) return {ok: false, reason: "not a PNG, JPEG, GIF or WebP image"};
  const mime = "image/" + k, ext = k === "jpeg" ? "jpg" : k;
  if (declaredMime && declaredMime !== mime) return {ok: false, reason: "file type does not match its contents"};
  const err = k === "png" ? checkPng(u) : k === "jpeg" ? checkJpeg(u) : k === "gif" ? checkGif(u) : checkWebp(u);
  if (err) return {ok: false, reason: err};
  const txt = new TextDecoder("latin1").decode(u).toLowerCase();
  for (const s of BAD) if (txt.includes(s)) return {ok: false, reason: "contains script or executable content"};
  if (txt.includes("pk\x03\x04") || txt.includes("rar!\x1a") || txt.includes("mz\x90\x00\x03")) return {ok: false, reason: "contains a hidden archive or program"};
  return {ok: true, mime, ext};
}
async function sha256(u: Uint8Array) { const d = await crypto.subtle.digest("SHA-256", u); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); }

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
