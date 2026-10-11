#!/usr/bin/env python3
"""
Pulls BTC/ETH perpetual-futures funding rate + open interest from Binance and
Bybit's free, no-auth public REST APIs and writes funding_data.json for the
dashboard to fetch at page load.

Both are standard documented public market-data endpoints (no API key):
  Binance: GET /fapi/v1/premiumIndex?symbol=BTCUSDT  -> lastFundingRate, markPrice, nextFundingTime
           GET /fapi/v1/openInterest?symbol=BTCUSDT  -> openInterest (in contracts/coins)
  Bybit:   GET /v5/market/tickers?category=linear&symbol=BTCUSDT -> fundingRate, openInterest, openInterestValue

Writes funding_debug.txt every run (like the calendar/token-events scrapers)
so a silent miss is diagnosable without Actions-log access.
"""
import json
import urllib.request
from datetime import datetime, timezone

SYMBOLS = ["BTC", "ETH"]

debug_lines = []


def dbg(msg):
    debug_lines.append(msg)
    print(msg)


def write_debug():
    try:
        with open("funding_debug.txt", "w") as f:
            f.write(f"Run at {datetime.now(timezone.utc).isoformat()}\n\n")
            f.write("\n".join(debug_lines))
    except Exception:
        pass


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_binance(symbol):
    pair = f"{symbol}USDT"
    try:
        premium = fetch_json(f"https://fapi.binance.com/fapi/v1/premiumIndex?symbol={pair}")
        oi = fetch_json(f"https://fapi.binance.com/fapi/v1/openInterest?symbol={pair}")
        return {
            "exchange": "Binance",
            "symbol": pair,
            "fundingRate": float(premium["lastFundingRate"]),
            "markPrice": float(premium["markPrice"]),
            "nextFundingTime": premium.get("nextFundingTime"),
            "openInterest": float(oi["openInterest"]),
        }
    except Exception as exc:
        dbg(f"Binance {pair} fetch failed: {exc}")
        return None


def fetch_bybit(symbol):
    pair = f"{symbol}USDT"
    try:
        data = fetch_json(f"https://api.bybit.com/v5/market/tickers?category=linear&symbol={pair}")
        rows = data.get("result", {}).get("list", [])
        if not rows:
            dbg(f"Bybit {pair}: no rows in response -- raw: {json.dumps(data)[:300]}")
            return None
        row = rows[0]
        return {
            "exchange": "Bybit",
            "symbol": pair,
            "fundingRate": float(row["fundingRate"]),
            "markPrice": float(row["markPrice"]),
            "nextFundingTime": row.get("nextFundingTime"),
            "openInterest": float(row["openInterest"]),
        }
    except Exception as exc:
        dbg(f"Bybit {pair} fetch failed: {exc}")
        return None


def main():
    snapshots = []
    for symbol in SYMBOLS:
        for row in (fetch_binance(symbol), fetch_bybit(symbol)):
            if row:
                dbg(f"OK: {row['exchange']} {row['symbol']} funding={row['fundingRate']} oi={row['openInterest']}")
                snapshots.append(row)

    write_debug()

    if not snapshots:
        raise SystemExit("No funding/OI data fetched from any exchange -- not overwriting funding_data.json. See funding_debug.txt")

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sources": ["https://fapi.binance.com", "https://api.bybit.com"],
        "snapshots": snapshots,
    }
    with open("funding_data.json", "w") as f:
        json.dump(payload, f, indent=2)
    print(f"Wrote {len(snapshots)} funding/OI snapshots to funding_data.json")


if __name__ == "__main__":
    main()
