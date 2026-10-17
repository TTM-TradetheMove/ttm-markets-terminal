#!/usr/bin/env python3
"""BTC monthly returns since the start of exchange data  ->  btc_monthly.json

Daily candles come from Bitstamp (BTC/USD since Aug 2011, free, no key). If Bitstamp is unreachable
Coinbase Exchange daily candles (since 2015) are used instead. Monthly return = month-end close vs the
previous month-end close (the first month uses its first open). The current month is month-to-date.
"""
import json, os, time, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"}
DAY = 86400


def getj(url):
    last = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa
            last = e
            time.sleep(2)
    raise last


def bitstamp():
    out, cur, end = {}, 1313000000, int(time.time())  # Aug 2011
    while cur < end:
        rows = getj(f"https://www.bitstamp.net/api/v2/ohlc/btcusd/?step={DAY}&limit=1000&start={cur}")["data"]["ohlc"]
        if not rows:
            break
        for r in rows:
            out[int(r["timestamp"])] = (float(r["open"]), float(r["close"]))
        last = int(rows[-1]["timestamp"])
        if last <= cur:
            break
        cur = last + DAY
        time.sleep(0.3)
    return out


def coinbase():
    out, cur, end = {}, 1425168000, int(time.time())  # 2015-03-01
    while cur < end:
        nxt = min(cur + 300 * DAY, end)
        f = lambda t: datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        rows = getj(f"https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity={DAY}&start={f(cur)}&end={f(nxt)}")
        for t, lo, hi, op, cl, _v in rows:
            out[int(t)] = (float(op), float(cl))
        cur = nxt
        time.sleep(0.2)
    return out


def main():
    src, daily = None, {}
    for name, fn in (("Bitstamp", bitstamp), ("Coinbase", coinbase)):
        try:
            daily = fn()
            print(f"{name}: {len(daily)} daily candles")
            if len(daily) > 1000:
                src = name
                break
        except Exception as e:  # noqa
            print(f"{name} failed: {type(e).__name__}: {e}")
    if not src:
        raise SystemExit("no usable BTC history - not overwriting btc_monthly.json")
    months, first_open = {}, {}
    for ts in sorted(daily):
        d = datetime.fromtimestamp(ts, timezone.utc)
        ym = d.strftime("%Y-%m")
        first_open.setdefault(ym, daily[ts][0])
        months[ym] = daily[ts][1]  # last close seen in the month
    now_ym = datetime.now(timezone.utc).strftime("%Y-%m")
    out, prev = [], None
    for ym in sorted(months):
        base = prev if prev else first_open[ym]
        out.append({"m": ym, "c": round(months[ym], 2), "r": round((months[ym] / base - 1) * 100, 2), "p": ym == now_ym})
        prev = months[ym]
    payload = {"generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "source": src,
               "first": out[0]["m"], "months": out}
    with open(os.path.join(ROOT, "btc_monthly.json"), "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"wrote {len(out)} months {out[0]['m']} -> {out[-1]['m']} from {src}")


if __name__ == "__main__":
    main()
