#!/usr/bin/env python3
"""Top ~250 coins by market cap  ->  top_coins.json  (symbol, name, rank, price, market cap)

Feeds the asset picker in the Risk-to-Reward calculator. CoinGecko first, CoinPaprika as fallback; stablecoins are left out
(they are pointless to size a trade on). Keeps the previous file if both sources fail.
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "top_coins.json")
UA = {"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"}
STABLES = set("USDT USDC DAI USDE FDUSD USDS PYUSD USD1 TUSD USDD USDG BUIDL USDTB FRAX LUSD GUSD USDP RLUSD USDX EURC EURT XAUT PAXG USDF SUSDE SUSDS BFUSD USYC USDY USDO CUSD".split())


def getj(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.loads(r.read())
        except Exception as ex:
            print(f"fetch failed {url[:70]} ({type(ex).__name__}), try {i + 1}")
            time.sleep(4 * (i + 1))
    return None


def coingecko():
    rows = []
    for page in (1, 2):
        d = getj(f"https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=150&page={page}&sparkline=false")
        if not d:
            break
        rows += [{"s": c["symbol"].upper(), "n": c["name"], "r": c.get("market_cap_rank"), "p": c.get("current_price"), "m": c.get("market_cap")} for c in d]
        time.sleep(2)
    return rows


def paprika():
    d = getj("https://api.coinpaprika.com/v1/tickers?quotes=USD&limit=300")
    return [{"s": c["symbol"].upper(), "n": c["name"], "r": c.get("rank"), "p": (c.get("quotes", {}).get("USD") or {}).get("price"), "m": (c.get("quotes", {}).get("USD") or {}).get("market_cap")} for c in (d or [])]


def main():
    rows, src = coingecko(), "CoinGecko"
    if len(rows) < 100:
        rows, src = paprika(), "CoinPaprika"
    if len(rows) < 100:
        print("both sources failed; keeping previous top_coins.json")
        sys.exit(0)
    seen, out = set(), []
    for c in sorted(rows, key=lambda c: c["r"] or 10 ** 9):
        if not c["s"] or c["s"] in STABLES or c["s"] in seen or not c["p"]:
            continue
        seen.add(c["s"])
        out.append({"s": c["s"], "n": c["n"], "r": c["r"], "p": c["p"], "m": round(c["m"] or 0)})
        if len(out) >= 250:
            break
    json.dump({"generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "source": src, "coins": out}, open(OUT, "w"), separators=(",", ":"))
    print(f"wrote {len(out)} coins from {src}")


if __name__ == "__main__":
    main()
