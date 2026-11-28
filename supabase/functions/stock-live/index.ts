// Live-ish stock prices for TTM Pills (US and ASX). Public and read-only: turn OFF "Verify JWT" for this function (the Pills page is free for everyone).
// Reads the stock list that the pills data job already built (pills_us.json / pills_au.json on the site), pulls today's 1-minute candles from Yahoo for each
// stock, and returns the price and the 5m / 15m / 1h / 4h / 1d moves. Cached for 45 seconds so many viewers cost one pull. US prices are close to live.
// ASX prices are delayed about 20 minutes by the exchange, so they update but trail the market.
const CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, OPTIONS"};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SITE = Deno.env.get("SITE_URL") ? Deno.env.get("SITE_URL")!.replace(/\/?$/, "/") : "https://ttm.markets/";
const TTL = 45000, UNI_TTL = 600000, MAX = 250;
const cache: Record<string, {t: number, body: string}> = {}, uni: Record<string, {t: number, s: string[], y: Record<string, string>}> = {}, busy: Record<string, Promise<string> | undefined> = {};
const r2 = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const pc = (a: number, b: number | null | undefined) => (b && b > 0) ? r2((a / b - 1) * 100, 2) : null;

async function universe(m: string): Promise<string[]> {
  const u = uni[m]; if (u && Date.now() - u.t < UNI_TTL) return u.s;
  try { const r = await fetch(SITE + `pills_${m}.json?_=${Math.floor(Date.now() / 600000)}`); const j = await r.json(); const s = (j.coins || []).slice(0, MAX).map((c: any) => String(c.s)), y: Record<string, string> = {}; (j.coins || []).forEach((c: any) => { if (c.y) y[String(c.s)] = String(c.y); }); if (s.length) { uni[m] = {t: Date.now(), s, y}; return s; } } catch (_e) { /* fall through */ }
  return u ? u.s : [];
}
async function one(code: string, m: string): Promise<[string, (number | null)[]] | null> {
  const sym = m === "cx" ? (uni.cx?.y[code] || code) : m === "au" ? code + ".AX" : code;
  for (const host of ["query1", "query2"]) {
    try {
      const x = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1m&includePrePost=false`, {headers: {"User-Agent": UA, "Accept": "application/json"}});
      if (!x.ok) continue;
      const j = await x.json(), r = j?.chart?.result?.[0]; if (!r?.timestamp) continue;
      const cl: number[] = r.indicators?.quote?.[0]?.close || [], ts: number[] = r.timestamp, meta = r.meta || {};
      const pts: [number, number][] = []; for (let i = 0; i < ts.length; i++) if (cl[i] != null) pts.push([ts[i], cl[i]]);
      const px = meta.regularMarketPrice ?? (pts.length ? pts[pts.length - 1][1] : null); if (!px) continue;
      const lastT = pts.length ? pts[pts.length - 1][0] : 0, at = (mins: number) => { if (!pts.length) return null; const t0 = lastT - mins * 60; if (pts[0][0] > t0 + 90) return null; let v = pts[0][1]; for (const p of pts) { if (p[0] <= t0) v = p[1]; else break; } return v; };
      return [code, [r2(px, 4), pc(px, meta.chartPreviousClose ?? meta.previousClose), pc(px, at(5)), pc(px, at(15)), pc(px, at(60)), pc(px, at(240))]];
    } catch (_e) { /* try next host */ }
  }
  return null;
}
async function build(m: string): Promise<string> {
  const syms = await universe(m); if (!syms.length) return JSON.stringify({error: "no list yet"});
  const q: Record<string, (number | null)[]> = {}; let i = 0;
  await Promise.all(Array.from({length: 24}, async () => { while (i < syms.length) { const c = syms[i++], r = await one(c, m); if (r) q[r[0]] = r[1]; } }));
  return JSON.stringify({t: Math.floor(Date.now() / 1000), m, n: Object.keys(q).length, q});
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, {headers: CORS});
  const m0 = new URL(req.url).searchParams.get("m"), m = m0 === "au" ? "au" : m0 === "cx" ? "cx" : "us";
  const c = cache[m]; if (c && Date.now() - c.t < TTL) return new Response(c.body, {headers: {...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=30"}});
  const p = busy[m] || (busy[m] = build(m).finally(() => { busy[m] = undefined; }));
  const body = await p; if (!body.includes('"error"')) cache[m] = {t: Date.now(), body};
  return new Response(body, {status: body.includes('"error"') ? 503 : 200, headers: {...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=30"}});
});
