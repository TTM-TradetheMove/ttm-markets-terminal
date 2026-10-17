#!/usr/bin/env python3
"""
Pulls ~90 days of daily BTC/USD close prices from CoinGecko's free, no-auth
market_chart endpoint and writes btc_price_data.json for the dashboard's
price-vs-macro-events chart.
"""
import json
import urllib.request
from datetime import datetime, timedelta, timezone

COINBASE = "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&start={s}&end={e}"
COINGECKO = "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=90&interval=daily"
UA = {"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"}


def getj(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def from_coinbase():
    """Daily closes from Coinbase Exchange (works from GitHub's US runners). Rows: [time, low, high, open, close, vol]."""
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=100)
    rows = getj(COINBASE.format(s=start.strftime("%Y-%m-%dT%H:%M:%SZ"), e=end.strftime("%Y-%m-%dT%H:%M:%SZ")))
    return {datetime.fromtimestamp(r[0], tz=timezone.utc).strftime("%Y-%m-%d"): round(float(r[4]), 2) for r in rows}


def from_coingecko():
    raw = getj(COINGECKO)
    out = {}
    for ts_ms, price in raw.get("prices", []):
        out[datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")] = round(price, 2)
    return out


def main():
    by_date, source = {}, ""
    for name, fn, url in (("Coinbase", from_coinbase, "https://www.coinbase.com/price/bitcoin"),
                          ("CoinGecko", from_coingecko, "https://www.coingecko.com/en/coins/bitcoin")):
        try:
            by_date = fn()
            print(f"{name}: {len(by_date)} daily points")
            if len(by_date) >= 30:
                source = url
                break
        except Exception as exc:
            print(f"{name} failed: {type(exc).__name__}: {exc}")
    if len(by_date) < 30:
        raise SystemExit("No usable BTC price history -- not overwriting btc_price_data.json")
    # keep the last ~92 days
    by_date = dict(sorted(by_date.items())[-92:])

    series = [{"date": d, "price": p} for d, p in sorted(by_date.items())]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "prices": series,
    }
    with open("btc_price_data.json", "w") as f:
        json.dump(payload, f, indent=2)
    print(f"Wrote {len(series)} daily BTC price points to btc_price_data.json")


if __name__ == "__main__":
    main()
