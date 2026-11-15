#!/usr/bin/env python3
"""BTC realized price  ->  btc_realized.json

Realized price = realized cap / coins in circulation (the average price every coin last moved at). Source: Coin Metrics
community data (free, no key): the API first, then the public CSV on GitHub. If both fail the old file is kept.
Output: {updated, price, realized, mvrv, series: [[YYYY-MM-DD, price, realized], ...]}  (weekly points, daily for the last 400 days)
"""
import csv, io, json, os, time, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"}


def fetch(url):
    last = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read().decode()
        except Exception as e:  # noqa
            last = e
            time.sleep(3)
    raise last


def from_api():
    rows, url = [], "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapRealUSD,SplyCur,PriceUSD&frequency=1d&start_time=2011-01-01&page_size=10000"
    while url:
        j = json.loads(fetch(url))
        for d in j.get("data", []):
            try:
                rows.append((d["time"][:10], float(d["PriceUSD"]), float(d["CapRealUSD"]) / float(d["SplyCur"])))
            except (KeyError, TypeError, ValueError, ZeroDivisionError):
                pass
        url = j.get("next_page_url")
    return rows


def from_csv():
    txt = fetch("https://raw.githubusercontent.com/coinmetrics/data/master/csv/btc.csv")
    rows = []
    for d in csv.DictReader(io.StringIO(txt)):
        try:
            rows.append((d["time"][:10], float(d["PriceUSD"]), float(d["CapRealUSD"]) / float(d["SplyCur"])))
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            pass
    return rows


def from_bitcoin_data():
    """Third source: realized price from bitcoin-data.com, daily BTC price from Bitstamp."""
    raw = json.loads(fetch("https://bitcoin-data.com/v1/realized-price"))
    rp = {}
    for d in raw if isinstance(raw, list) else raw.get("data", []):
        k = str(d.get("d") or d.get("theDay") or "")[:10]
        v = d.get("realizedPrice") or d.get("realized_price")
        if k and v is not None:
            rp[k] = float(v)
    px, end = {}, int(time.time())
    for _ in range(8):
        j = json.loads(fetch(f"https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=1000&end={end}"))
        c = j.get("data", {}).get("ohlc", [])
        if not c:
            break
        for x in c:
            px[datetime.fromtimestamp(int(x["timestamp"]), timezone.utc).strftime("%Y-%m-%d")] = float(x["close"])
        end = int(c[0]["timestamp"]) - 1
    return [(d, px[d], rp[d]) for d in sorted(rp) if d in px and rp[d] > 0]


def main():
    status = {}
    rows = []
    for fn, need in ((from_api, 2000), (from_csv, 2000), (from_bitcoin_data, 1000)):
        try:
            rows = fn()
            status[fn.__name__] = f"{len(rows)} rows"
            if len(rows) > need:
                break
        except Exception as e:  # noqa
            status[fn.__name__] = "failed: " + str(e)[:160]
            print(fn.__name__, "failed:", e)
    status["when"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    json.dump(status, open(os.path.join(ROOT, "btc_realized_status.json"), "w"), indent=1)
    if len(rows) < 1000:
        print("No usable data, keeping the old file.")
        return
    rows.sort()
    last_date = rows[-1][0]
    cut = max(0, len(rows) - 400)
    series = [[d, round(p, 2), round(r, 2)] for i, (d, p, r) in enumerate(rows) if i >= cut or i % 7 == 0]
    price, real = rows[-1][1], rows[-1][2]
    out = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "as_of": last_date, "price": round(price, 2),
           "realized": round(real, 2), "mvrv": round(price / real, 3), "series": series}
    json.dump(out, open(os.path.join(ROOT, "btc_realized.json"), "w"), separators=(",", ":"))
    print("saved", last_date, out["price"], out["realized"], len(series), "points")


if __name__ == "__main__":
    main()
