#!/usr/bin/env python3
"""Crypto Rotation data for TTM  ->  crypto_rotation.json

Daily prices + volumes (1 year) for ~75 hand-picked tokens grouped into sectors, plus BTC and ETH as benchmarks.
All scoring (relative strength vs BTC, stages, verdicts, cycle phase) is done in the page from this file.
Source: CoinGecko free API (optional free COINGECKO_KEY 'Demo' key = faster/safer).
Env: DRY_FILE=path to JSON {id: {"prices": [[ms,v]..], "total_volumes": [[ms,v]..]}} to test offline.
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "crypto_rotation.json")
KEY = os.environ.get("COINGECKO_KEY", "").strip()
UA = {"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"}
if KEY:
    UA["x-cg-demo-api-key"] = KEY
D = 86400000
DAYS = 365

SECTORS = [
    ("Layer 1", "Base-layer smart-contract chains", ["solana", "cardano", "avalanche-2", "near", "aptos", "sui", "sei-network", "tron", "the-open-network", "polkadot", "cosmos", "internet-computer", "kaspa", "injective-protocol", "celestia", "sonic-3", "berachain-bera", "multiversx", "vechain", "tezos", "flow", "mina-protocol", "ethereum-classic", "zilliqa"]),
    ("Layer 2", "Ethereum scaling networks", ["arbitrum", "optimism", "matic-network", "starknet", "mantle", "immutable-x", "blast", "zksync", "scroll", "manta-network", "metis-token", "loopring", "taiko"]),
    ("DeFi", "Lending, DEXs, perps and yield", ["uniswap", "aave", "lido-dao", "curve-dao-token", "jupiter-exchange-solana", "maker", "hyperliquid", "dydx-chain", "gmx", "compound-governance-token", "havven", "1inch", "sushi", "balancer", "raydium", "convex-finance", "frax-share", "rocket-pool", "eigenlayer", "ether-fi", "jito-governance-token", "aerodrome-finance", "cow-protocol", "yearn-finance"]),
    ("Yield & Fixed Income", "On-chain yield, rates and synthetic dollars", ["pendle", "ethena", "morpho", "resolv", "notional-finance", "spectra", "term-finance", "usual"]),
    ("AI", "AI, compute and data networks", ["render-token", "bittensor", "fetch-ai", "virtual-protocol", "akash-network", "the-graph", "worldcoin-wld", "singularitynet", "ocean-protocol", "arkham", "aixbt", "grass", "io", "nosana", "golem", "livepeer", "numeraire"]),
    ("Memecoins", "High-beta attention coins", ["dogecoin", "shiba-inu", "pepe", "bonk", "dogwifcoin", "floki", "official-trump", "fartcoin", "popcat", "brett", "mog-coin", "book-of-meme", "turbo", "pudgy-penguins", "cat-in-a-dogs-world"]),
    ("RWA & Oracles", "Tokenised assets and data feeds", ["ondo-finance", "chainlink", "pyth-network", "api3", "polymesh", "centrifuge", "band-protocol", "uma", "tellor", "mantra-dao", "plume", "maple", "clearpool", "goldfinch"]),
    ("Payments", "Payment and settlement coins", ["ripple", "stellar", "hedera-hashgraph", "litecoin", "algorand", "xdc-network", "bitcoin-cash", "quant-network", "iota", "nano"]),
    ("Exchange tokens", "Centralised exchange ecosystems", ["binancecoin", "okb", "crypto-com-chain", "leo-token", "bitget-token", "gatechain-token", "kucoin-shares", "huobi-token", "mx-token", "bitmart-token", "nexo", "whitebit"]),
    ("Gaming", "Gaming and metaverse", ["gala", "the-sandbox", "axie-infinity", "decentraland", "apecoin", "illuvium", "enjincoin", "stepn", "beam-2", "ronin", "pixels", "big-time", "magic", "yield-guild-games"]),
    ("Privacy", "Privacy coins", ["monero", "zcash", "dash", "decred", "horizen", "secret", "beldex", "firo", "oasis-network"]),
    ("DePIN & Storage", "Decentralised infrastructure and storage", ["filecoin", "arweave", "helium", "iotex", "hivemapper", "aethir", "theta-token", "storj", "ankr", "flux"]),
]
BENCH = ["bitcoin", "ethereum"]


STATUS = os.path.join(ROOT, "crypto_rotation_status.json")
ERRS = {}


def status(msg, **kw):
    kw.update({"at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "msg": msg, "http_errors": ERRS, "keyed": bool(KEY)})
    json.dump(kw, open(STATUS, "w"))
    print("STATUS:", msg, kw, flush=True)


def getj(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.loads(r.read())
        except Exception as ex:
            code = getattr(ex, "code", None)
            ERRS[str(code or type(ex).__name__)] = ERRS.get(str(code or type(ex).__name__), 0) + 1
            print(f"fetch failed {url[:90]} ({type(ex).__name__} {code}), try {i + 1}", flush=True)
            time.sleep(20 * (i + 1) if code == 429 else 5 * (i + 1))
    return None


def day_grid(pairs, t0, n, fill=True, step=None):
    step = step or D
    out, b = [None] * n, {}
    for t, v in pairs:
        j = int((t - t0) // step)
        if 0 <= j < n and v is not None:
            b[j] = v
    last = None
    for j in range(n):
        if j in b:
            last = b[j]
        out[j] = last if fill else b.get(j)
    return out


def day_grid_step(pairs, t0, n, step):
    return day_grid(pairs, t0, n, True, step)


def r6(v):
    if v is None:
        return None
    return float("%.6g" % v)


def shift(arr, old_dates, dates, last=None):
    """Re-align a previously saved series onto today's date grid, forward-fill, set today's slot to the live value."""
    m = {d: k for k, d in enumerate(old_dates)}
    out = [arr[m[d]] if d in m and m[d] < len(arr) else None for d in dates]
    lastv = None
    for k in range(len(out)):
        if out[k] is not None:
            lastv = out[k]
        elif lastv is not None:
            out[k] = lastv
    if last is not None:
        out[-1] = last
    return out


def main():
    started = time.time()
    ids = list(dict.fromkeys(BENCH + [c for s in SECTORS for c in s[2]]))
    LIMIT = int(os.environ.get("LIMIT") or 40)
    try:
        prev = json.load(open(OUT))
    except Exception:
        prev = {}
    pc, pd = prev.get("coins", {}), prev.get("dates", [])
    meta = {}
    for k in range(0, len(ids), 100):
        m = getj("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&ids=" + ",".join(ids[k:k + 100]), tries=3)
        for c in (m or []):
            meta[c["id"]] = c
        time.sleep(2)
    if len(meta) < 30:
        status("could not load the coin list from CoinGecko (rate-limited or blocked); kept the old file", loaded=len(meta))
        sys.exit(0)
    now = int(time.time() * 1000)
    t0 = (now // D) * D - (DAYS - 1) * D
    dates = [datetime.fromtimestamp((t0 + j * D) / 1000, timezone.utc).strftime("%Y-%m-%d") for j in range(DAYS)]
    coins = {}
    for cid in ids:
        if cid not in meta:
            continue
        m = meta[cid]
        if cid in pc:
            o = pc[cid]
            coins[cid] = {"sym": o.get("sym"), "name": o.get("name"), "mc": m.get("market_cap") or o.get("mc") or 0, "ts": o.get("ts", 0),
                          "p": [r6(v) for v in shift(o["p"], pd, dates, m.get("current_price"))], "v": shift(o["v"], pd, dates, None)}
            coins[cid]["v"][-1] = int(m.get("total_volume") or 0) or coins[cid]["v"][-1]
    todo = sorted([c for c in ids if c in meta], key=lambda c: coins[c]["ts"] if c in coins else -1)[:LIMIT]
    got = 0
    for cid in todo:
        if time.time() - started > 24 * 60:
            print("time budget reached; will continue next run")
            break
        d = getj(f"https://api.coingecko.com/api/v3/coins/{cid}/market_chart?vs_currency=usd&days={DAYS}&interval=daily", tries=2)
        time.sleep(2.2 if KEY else 3.6)
        if not d or not d.get("prices"):
            print("no data for", cid)
            continue
        m = meta[cid]
        px = day_grid(d["prices"], t0, DAYS)
        vol = day_grid(d.get("total_volumes") or [], t0, DAYS, fill=False)
        coins[cid] = {"sym": (m.get("symbol") or cid).upper(), "name": m.get("name") or cid, "mc": m.get("market_cap") or 0, "ts": now,
                      "p": [r6(v) for v in px], "v": [None if v is None else int(v) for v in vol]}
        got += 1
    if len(coins) < 40 or "bitcoin" not in coins:
        status("too few coins have history yet (CoinGecko rate limit); will keep filling on the next runs", coins=len(coins), refreshed=got)
        sys.exit(0)
    out = {"generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "source": "TTM Markets data", "dates": dates,
           "sectors": [{"id": s[0], "desc": s[1], "coins": [c for c in s[2] if c in coins]} for s in SECTORS], "coins": coins}
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    status("ok", coins=len(coins), refreshed=got, bytes=os.path.getsize(OUT))


if __name__ == "__main__":
    main()
