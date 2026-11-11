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
    ("Layer 1", "Base-layer smart-contract chains", ["solana", "cardano", "avalanche-2", "near", "aptos", "sui", "sei-network", "tron", "the-open-network", "polkadot"]),
    ("Layer 2", "Ethereum scaling networks", ["arbitrum", "optimism", "matic-network", "starknet", "mantle", "immutable-x"]),
    ("DeFi", "Lending, DEXs, perps and yield", ["uniswap", "aave", "lido-dao", "curve-dao-token", "jupiter-exchange-solana", "pendle", "ethena", "maker", "hyperliquid", "dydx-chain", "gmx"]),
    ("AI", "AI, compute and data networks", ["render-token", "bittensor", "fetch-ai", "virtual-protocol", "akash-network", "the-graph", "worldcoin-wld"]),
    ("Memecoins", "High-beta attention coins", ["dogecoin", "shiba-inu", "pepe", "bonk", "dogwifcoin", "floki"]),
    ("RWA & Oracles", "Tokenised assets and data feeds", ["ondo-finance", "chainlink", "pyth-network", "api3", "polymesh", "centrifuge"]),
    ("Payments", "Payment and settlement coins", ["ripple", "stellar", "hedera-hashgraph", "litecoin", "algorand", "xdc-network", "bitcoin-cash"]),
    ("Exchange tokens", "Centralised exchange ecosystems", ["binancecoin", "okb", "crypto-com-chain", "leo-token", "bitget-token", "gatechain-token"]),
    ("Gaming", "Gaming and metaverse", ["gala", "the-sandbox", "axie-infinity", "decentraland", "apecoin"]),
    ("Privacy", "Privacy coins", ["monero", "zcash", "dash"]),
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
            time.sleep(30 * (i + 1) if code == 429 else 5 * (i + 1))
    return None


def day_grid(pairs, t0, n, fill=True):
    out, b = [None] * n, {}
    for t, v in pairs:
        j = int((t - t0) // D)
        if 0 <= j < n and v is not None:
            b[j] = v
    last = None
    for j in range(n):
        if j in b:
            last = b[j]
        out[j] = last if fill else b.get(j)
    return out


def r6(v):
    if v is None:
        return None
    return float("%.6g" % v)


def main():
    ids = list(dict.fromkeys(BENCH + [c for s in SECTORS for c in s[2]]))
    fx = os.environ.get("DRY_FILE")
    fix = json.load(open(fx)) if fx else None
    meta = {}
    if not fix:
        for k in range(0, len(ids), 100):
            m = getj("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&ids=" + ",".join(ids[k:k + 100]))
            for c in (m or []):
                meta[c["id"]] = c
        if len(meta) < 30:
            status("could not load the coin list from CoinGecko (rate-limited or blocked); no file written", loaded=len(meta))
            sys.exit(0)
    else:
        meta = {i: {"id": i, "symbol": i[:4], "name": i, "market_cap": 1e9} for i in fix}
    now = int(time.time() * 1000)
    t0 = (now // D) * D - (DAYS - 1) * D
    dates = [datetime.fromtimestamp((t0 + j * D) / 1000, timezone.utc).strftime("%Y-%m-%d") for j in range(DAYS)]
    coins = {}
    for cid in ids:
        if cid not in meta:
            print("unknown on CoinGecko:", cid)
            continue
        d = fix.get(cid) if fix else getj(f"https://api.coingecko.com/api/v3/coins/{cid}/market_chart?vs_currency=usd&days={DAYS}&interval=daily")
        if not d or not d.get("prices"):
            print("no data for", cid)
            continue
        px = day_grid(d["prices"], t0, DAYS)
        vol = day_grid(d.get("total_volumes") or [], t0, DAYS, fill=False)
        m = meta[cid]
        coins[cid] = {"sym": (m.get("symbol") or cid).upper(), "name": m.get("name") or cid, "mc": m.get("market_cap") or 0, "p": [r6(v) for v in px], "v": [None if v is None else int(v) for v in vol]}
        if not fix:
            time.sleep(2.2 if KEY else 3.6)
    if len(coins) < 35 or "bitcoin" not in coins:
        status("too few coins returned history (CoinGecko rate limit); no file written", coins=len(coins))
        sys.exit(0)
    out = {"generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "source": "CoinGecko", "dates": dates,
           "sectors": [{"id": s[0], "desc": s[1], "coins": [c for c in s[2] if c in coins]} for s in SECTORS], "coins": coins}
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    status("ok", coins=len(coins), bytes=os.path.getsize(OUT))


if __name__ == "__main__":
    main()
