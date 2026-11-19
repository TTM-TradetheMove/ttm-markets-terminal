// Relay for stock chart candles (US and ASX) used by TTM LENS. Read-only, allow-listed. Turn OFF "Verify JWT" for this function.
const CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, OPTIONS"};
const SYM = /^[A-Za-z0-9.\-^=]{1,16}$/;
const INT = new Set(["1m", "2m", "5m", "15m", "30m", "60m", "1d"]);
const RNG = new Set(["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"]);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, {headers: CORS});
  const q = new URL(req.url).searchParams, s = q.get("s") || "", i = q.get("i") || "", r = q.get("r") || "";
  if (!SYM.test(s) || !INT.has(i) || !RNG.has(r)) return new Response("not allowed", {status: 400, headers: CORS});
  let last = 502, body = "upstream error";
  for (const host of ["query1", "query2"]) {
    try {
      const u = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=${r}&interval=${i}&includePrePost=false`;
      const x = await fetch(u, {headers: {"User-Agent": UA, "Accept": "application/json,text/plain,*/*", "Accept-Language": "en-US,en;q=0.9"}});
      const t = await x.text();
      if (x.ok) return new Response(t, {status: 200, headers: {...CORS, "Content-Type": "application/json", "Cache-Control": i === "1d" ? "public, max-age=900" : "public, max-age=30"}});
      last = x.status; body = t.slice(0, 200);
    } catch (_e) { /* try the next host */ }
  }
  return new Response(body, {status: last === 404 ? 404 : 502, headers: CORS});
});
