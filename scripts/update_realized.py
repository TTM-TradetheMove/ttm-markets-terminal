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


def main():
    rows = []
    for fn in (from_api, from_csv):
        try:
            rows = fn()
            if len(rows) > 2000:
                break
        except Exception as e:  # noqa
            print(fn.__name__, "failed:", e)
    if len(rows) < 2000:
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
