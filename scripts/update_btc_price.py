#!/usr/bin/env python3
"""
Pulls ~90 days of daily BTC/USD close prices from CoinGecko's free, no-auth
market_chart endpoint and writes btc_price_data.json for the dashboard's
price-vs-macro-events chart.
"""
import json
import urllib.request
from datetime import datetime, timezone

API_URL = "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=90&interval=daily"


def main():
    req = urllib.request.Request(API_URL, headers={"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = json.loads(resp.read().decode("utf-8"))

    points = raw.get("prices", [])
    if not points:
        raise SystemExit("No price points returned from CoinGecko -- not overwriting btc_price_data.json")

    # CoinGecko gives [timestamp_ms, price] pairs, often several per day near
    # the present; collapse to one point per calendar date (last seen wins).
    by_date = {}
    for ts_ms, price in points:
        date = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        by_date[date] = round(price, 2)

    series = [{"date": d, "price": p} for d, p in sorted(by_date.items())]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "https://www.coingecko.com/en/coins/bitcoin",
        "prices": series,
    }
    with open("btc_price_data.json", "w") as f:
        json.dump(payload, f, indent=2)
    print(f"Wrote {len(series)} daily BTC price points to btc_price_data.json")


if __name__ == "__main__":
    main()
