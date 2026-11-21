#!/usr/bin/env python3
"""Experiment: BTC Balanced Price from free data (blockchain.com coin-days-destroyed + Coin Metrics prices). Prints a comparison, writes nothing to the repo."""
import json, os, sys, time, urllib.request
from datetime import datetime, timezone, date
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import update_realized as ur

GENESIS = date(2009, 1, 3)

def cdd():
    last = None
    names = ("bitcoin-days-destroyed", "bitcoin-days-destroyed-cumulative", "days-destroyed")
    hosts = ("https://api.blockchain.info/charts/", "https://blockchain.info/charts/", "https://api.blockchain.com/charts/", "https://www.blockchain.com/charts/", "https://api.blockchain.info/charts/")
    for n in names:
        for h in hosts:
            for q in ("?timespan=all&sampled=false&format=json", "?timespan=20years&format=json", "?format=json"):
                u = h + n + q
                try:
                    j = json.loads(ur.fetch(u))
                    v = j["values"]
                    out = {datetime.fromtimestamp(p["x"], timezone.utc).strftime("%Y-%m-%d"): float(p["y"]) for p in v}
                    print("OK", u, "rows", len(out), "first", min(out), "last", max(out), "unit", j.get("unit"), "period", j.get("period"))
                    if n == "bitcoin-days-destroyed" and len(out) > 3000:
                        return out
                except Exception as e:
                    last = e
                    print("fail", u, str(e)[:60])
    raise last

def main():
    base = ur.from_csv()
    fresh = []
    try:
        fresh = ur.from_bitcoin_data()
    except Exception as e:
        print("fresh fail", e)
    m = {d: (p, r) for d, p, r in base}
    for d, p, r in fresh:
        m[d] = (p, r)
    # supply from csv
    import csv, io
    txt = ur.fetch("https://raw.githubusercontent.com/coinmetrics/data/master/csv/btc.csv")
    sup = {}
    for d in csv.DictReader(io.StringIO(txt)):
        try:
            sup[d["time"][:10]] = float(d["SplyCur"])
        except Exception:
            pass
    c = cdd()
    days = sorted(set(c) & set(m))
    print("overlap days", len(days), days[0], days[-1])
    cum = 0.0
    cumbtc = 0.0
    res = {}
    lastsup = 0
    d0 = None
    # cumulative from genesis: days before price exists (before 2010-07) have ~no value; price missing -> 0
    for d in sorted(c):
        p = m.get(d, (None, None))[0]
        if p is None:
            continue
        cum += c[d] * p
        s = sup.get(d)
        if s:
            lastsup = s
        else:
            lastsup += 450
        age = (date.fromisoformat(d) - GENESIS).days
        tp_a = cum / (age * lastsup)
        tp_b = cum / age / 21e6 * 1.0
        real = m[d][1]
        res[d] = (p, real, tp_a, real - tp_a, tp_b, real - tp_b)
    for d in sorted(res)[-12:]:
        p, r, ta, ba, tb, bb = res[d]
        print(d, f"price {p:,.0f} realized {r:,.0f} | A transfer {ta:,.0f} balanced {ba:,.0f} | B(21M) transfer {tb:,.0f} balanced {bb:,.0f}")
    print("-- monthly samples")
    for d in sorted(res):
        if d.endswith("-01") and d >= "2018-01-01":
            p, r, ta, ba, tb, bb = res[d]
            print(d, f"p {p:,.0f} real {r:,.0f} bal_A {ba:,.0f} bal_B {bb:,.0f}")
    json.dump({d: [round(x, 2) for x in v] for d, v in res.items()}, open("/tmp/balanced_test.json", "w"))

main()  # run
