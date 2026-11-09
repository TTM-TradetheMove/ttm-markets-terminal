#!/usr/bin/env python3
"""Crypto Market indices for TTM LENS  ->  crypto_market.json

TradingView's CRYPTOCAP:* series are TradingView's own data, so TTM builds an equivalent from free CoinGecko data:
the top 125 coins by market cap, hourly for 90 days (and daily for a year with --daily).

  TOTAL     = sum of those market caps ($B)            TOTAL3  = TOTAL - BTC - ETH ($B)
  OTHERS    = TOTAL - the 10 biggest coins ($B)        OTHERSBTC = OTHERS in BTC (OTHERS $ / BTC price)
  BTC.D / USDT.D / USDC.D / OTHERS.D = share of TOTAL (%)
  (OTHERS-USDT)/BTC and (TOTAL3-USDT)/BTC = ratios of market caps, as in the TradingView formulas

Values will be close to, but not identical to, TradingView (their universe differs slightly).
Intra-candle highs/lows are not available, so candles are built from the hourly / daily closes.
Env: DRY_FILE=path to a JSON fixture {id: {"prices": [...], "market_caps": [...]}} to test offline.
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "crypto_market.json")
UA = {"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"}
N = 125
H = 3600000
D = 86400000


def getj(url, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.loads(r.read())
        except Exception as ex:
            code = getattr(ex, "code", None)
            print(f"fetch failed {url[:80]} ({type(ex).__name__} {code}), try {i + 1}")
            time.sleep(25 * (i + 1) if code == 429 else 5 * (i + 1))
    return None


def top_coins():
    d = getj(f"https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page={N}&page=1&sparkline=false")
    return [(c["id"], (c.get("market_cap") or 0)) for c in (d or []) if c.get("market_cap")]


def series(cid, hourly):
    url = f"https://api.coingecko.com/api/v3/coins/{cid}/market_chart?vs_currency=usd&days={'90' if hourly else '365'}" + ("" if hourly else "&interval=daily")
    d = getj(url)
    return d


def grid_of(d, step, t0, n):
    """last value in each step bucket, forward filled; 0 before the coin has data"""
    out, buckets = [0.0] * n, {}
    for t, v in d:
        j = int((t - t0) // step)
        if 0 <= j < n and v:
            buckets[j] = v
    last = 0.0
    for j in range(n):
        if j in buckets:
            last = buckets[j]
        out[j] = last
    return out


def build(caps, prices, top10, n):
    """caps/prices: {coin_id: [per-step values]} -> dict of index series"""
    s = {k: [] for k in ("BTC.D", "USDT.D", "USDC.D", "OTHERS.D", "TOTAL", "TOTAL3", "OTHERS", "OTHERSBTC", "(OTHERS-USDT)/BTC", "(TOTAL3-USDT)/BTC")}
    for j in range(n):
        total = sum(c[j] for c in caps.values())
        btc, eth = caps.get("bitcoin", [0] * n)[j], caps.get("ethereum", [0] * n)[j]
        usdt, usdc = caps.get("tether", [0] * n)[j], caps.get("usd-coin", [0] * n)[j]
        others = total - sum(caps[c][j] for c in top10 if c in caps)
        total3 = total - btc - eth
        bp = prices.get("bitcoin", [0] * n)[j]
        if total <= 0 or btc <= 0:
            for k in s:
                s[k].append(None)
            continue
        s["BTC.D"].append(round(btc / total * 100, 3)); s["USDT.D"].append(round(usdt / total * 100, 3)); s["USDC.D"].append(round(usdc / total * 100, 3)); s["OTHERS.D"].append(round(others / total * 100, 3))
        s["TOTAL"].append(round(total / 1e9, 2)); s["TOTAL3"].append(round(total3 / 1e9, 2)); s["OTHERS"].append(round(others / 1e9, 2))
        s["OTHERSBTC"].append(round(others / bp, 0) if bp else None)
        s["(OTHERS-USDT)/BTC"].append(round((others - usdt) / btc, 6)); s["(TOTAL3-USDT)/BTC"].append(round((total3 - usdt) / btc, 6))
    return s


def block(coins, hourly):
    now = int(time.time() * 1000)
    step, n = (H, 90 * 24) if hourly else (D, 365)
    t0 = (now // step) * step - (n - 1) * step
    caps, prices, ids = {}, {}, [c[0] for c in coins]
    fx = os.environ.get("DRY_FILE")
    fix = json.load(open(fx)) if fx else None
    for i, cid in enumerate(ids):
        d = fix.get(cid) if fix else series(cid, hourly)
        if not d or not d.get("market_caps"):
            print("no data for", cid)
            continue
        caps[cid] = grid_of(d["market_caps"], step, t0, n)
        prices[cid] = grid_of(d["prices"], step, t0, n)
        if not fix:
            time.sleep(6)
    top10 = ids[:10]
    return {"t0": t0, "step": step, "n": n, "s": build(caps, prices, top10, n)}, len(caps)


def main():
    coins = [("bitcoin", 1)] if os.environ.get("DRY_FILE") and False else top_coins()
    if os.environ.get("DRY_FILE"):
        coins = [(k, 1) for k in json.load(open(os.environ["DRY_FILE"]))]
    if len(coins) < 50:
        print("could not load the coin list; keeping previous file")
        sys.exit(0)
    prev = {}
    try:
        prev = json.load(open(OUT))
    except Exception:
        pass
    out = {"generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "source": "CoinGecko (top %d coins)" % N,
           "note": "TTM-built from CoinGecko top coins; close to, not identical to, TradingView CRYPTOCAP.", "h": None, "d": prev.get("d")}
    h, used = block(coins, True)
    if used < 40:
        print("too few coins returned data; keeping previous file")
        sys.exit(0)
    out["h"] = h
    if "--daily" in sys.argv or not out["d"]:
        d, used2 = block(coins, False)
        if used2 >= 40:
            out["d"] = d
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    print("wrote", OUT, os.path.getsize(OUT), "bytes;", used, "coins")


if __name__ == "__main__":
    main()
