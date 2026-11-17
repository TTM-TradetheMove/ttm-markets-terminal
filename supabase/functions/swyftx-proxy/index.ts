// Relay for Swyftx's public market data (Swyftx does not allow websites to read it directly).
// Only two read-only paths are allowed: the coin list and chart candles. Turn OFF "Verify JWT" for this function.
const CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, OPTIONS"};
const OK = /^\/(markets\/assets\/|charts\/v2\/getBars\/[A-Za-z0-9]{1,12}\/[A-Za-z0-9]{1,12}\/(ask|bid)\/\?[A-Za-z0-9=&]{1,200})$/;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, {headers: CORS});
  const p = new URL(req.url).searchParams.get("p") || "";
  if (!OK.test(p)) return new Response("not allowed", {status: 400, headers: CORS});
  try {
    const r = await fetch("https://api.swyftx.com.au" + p, {headers: {Accept: "application/json"}});
    return new Response(await r.text(), {status: r.status, headers: {...CORS, "Content-Type": "application/json", "Cache-Control": p.startsWith("/markets") ? "public, max-age=3600" : "public, max-age=20"}});
  } catch (_e) { return new Response("upstream error", {status: 502, headers: CORS}); }
});
