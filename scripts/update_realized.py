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


STATUS = {}


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
    rd = csv.DictReader(io.StringIO(txt))
    cols = rd.fieldnames or []
    STATUS["csv_columns"] = [c for c in cols if c.startswith(("Cap", "Sply", "Price", "time"))][:30]
    rows = []
    for d in rd:
        try:
            price = float(d["PriceUSD"])
            if d.get("CapRealUSD") and d.get("SplyCur"):
                real = float(d["CapRealUSD"]) / float(d["SplyCur"])
            else:                                   # realized price = price / MVRV
                real = price / float(d["CapMVRVCur"])
            rows.append((d["time"][:10], price, real))
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


GENESIS = datetime(2009, 1, 3).date()
HALVINGS = [datetime(2009, 1, 3).date(), datetime(2012, 11, 28).date(), datetime(2016, 7, 9).date(), datetime(2020, 5, 11).date(), datetime(2024, 4, 20).date(), datetime(2028, 4, 17).date()]


def supply_on(t):
    """Circulating supply from the halving schedule (within ~0.5% of the real figure, which is plenty for this line)."""
    s, sub = 0.0, 50.0
    for i in range(len(HALVINGS) - 1):
        a, b = HALVINGS[i], HALVINGS[i + 1]
        if t >= b:
            s += 210000 * sub
        else:
            s += 210000 * sub * (t - a).days / (b - a).days
            break
        sub /= 2
    return s


def balanced_series(rows, dates):
    """TTM's own Balanced Price = realized price - transferred price (David Puell's model).
    Transferred price = sum over all days of (coin days destroyed x price) / (supply x days since genesis).
    Daily coin days destroyed comes from data/btc_cdd.csv (built once from the public Bitcoin dataset in Google BigQuery, see scripts/cdd_bigquery.sql).
    Days after the last CDD row keep the running total as it was (it moves very slowly)."""
    try:
        cdd = {r["day"]: float(r["cdd"]) for r in csv.DictReader(open(os.path.join(ROOT, "data", "btc_cdd.csv")))}
    except Exception as e:  # noqa
        STATUS["balanced"] = "no cdd file: " + str(e)[:100]
        return []
    cum, out = 0.0, {}
    for d, p, r in rows:
        t = datetime.strptime(d, "%Y-%m-%d").date()
        cum += cdd.get(d, 0.0) * p
        den = supply_on(t) * max(1, (t - GENESIS).days)
        if t >= datetime(2010, 11, 7).date():
            out[d] = r - cum / den
    STATUS["balanced"] = f"{len(out)} days, last cdd {max(cdd) if cdd else None}"
    return [[d, round(out[d], 2)] for d in dates if d in out and out[d] > 0]


def extend_to_today(rows):
    """The free sources lag by days. Fill the gap with Bitstamp daily closes (realized price carried forward, it moves ~0.1%/day), then today's live price."""
    try:
        last_d, _, last_r = rows[-1]
        STATUS["realized_as_of"] = last_d
        have = {d for d, _, _ in rows}
        c = json.loads(fetch("https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=60")).get("data", {}).get("ohlc", [])
        add = []
        for x in c:
            d = datetime.fromtimestamp(int(x["timestamp"]), timezone.utc).strftime("%Y-%m-%d")
            if d > last_d and d not in have:
                add.append((d, float(x["close"]), last_r))
        rows = rows + sorted(add)
        t = json.loads(fetch("https://www.bitstamp.net/api/v2/ticker/btcusd/"))
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        live = float(t["last"])
        if rows[-1][0] == today:
            rows[-1] = (today, live, rows[-1][2])
        else:
            rows.append((today, live, rows[-1][2]))
        STATUS["extended_to"] = today
    except Exception as e:  # noqa
        STATUS["extend"] = "failed: " + str(e)[:120]
    return rows


def main():
    status = STATUS
    base, fresh = [], []
    for fn, need in ((from_api, 2000), (from_csv, 2000)):
        try:
            base = fn()
            status[fn.__name__] = f"{len(base)} rows"
            if len(base) > need:
                break
        except Exception as e:  # noqa
            status[fn.__name__] = "failed: " + str(e)[:160]
            print(fn.__name__, "failed:", e)
    try:                                   # newest days (the public CSV can lag by months)
        fresh = from_bitcoin_data()
        status["from_bitcoin_data"] = f"{len(fresh)} rows"
    except Exception as e:  # noqa
        status["from_bitcoin_data"] = "failed: " + str(e)[:160]
    m = {d: (p, r) for d, p, r in base}
    for d, p, r in fresh:                  # fresh data wins where both have the day
        m[d] = (p, r)
    rows = sorted((d, p, r) for d, (p, r) in m.items() if p > 0.05 and r > 0.05)
    status["when"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    status["first_day"] = rows[0][0] if rows else None
    if len(rows) < 1000:
        print("No usable data, keeping the old file.")
        return
    rows = extend_to_today(rows)
    last_date = rows[-1][0]
    cut = max(0, len(rows) - 400)
    series = [[d, round(p, 2), round(r, 2)] for i, (d, p, r) in enumerate(rows) if i >= cut or i % 7 == 0]
    price, real = rows[-1][1], rows[-1][2]
    out = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "as_of": last_date, "price": round(price, 2),
           "realized": round(real, 2), "realized_as_of": status.get("realized_as_of", last_date), "mvrv": round(price / real, 3), "series": series, "balanced": balanced_series(rows, [x[0] for x in series])}
    json.dump(out, open(os.path.join(ROOT, "btc_realized.json"), "w"), separators=(",", ":"))
    json.dump(status, open(os.path.join(ROOT, "btc_realized_status.json"), "w"), indent=1)
    print("saved", last_date, out["price"], out["realized"], len(series), "points")


if __name__ == "__main__":
    main()
