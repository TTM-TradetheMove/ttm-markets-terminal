#!/usr/bin/env python3
"""Bubbles page data  ->  bubbles.json

The top ~250 coins by market cap (top_coins.json) that trade as USDT pairs on OKX spot.
Per coin: last price, 24h volume, and the price change over 5m / 15m / 1h / 4h / 24h / 1w / 1m,
worked out from three cheap candle calls (5m, 1H, 1D) plus the one-call ticker list.
The page streams live prices on top of this and re-bases the changes on the reference prices.
"""
import json, os, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import update_rsi as R

ROOT = R.ROOT
# (bar, candles to fetch, [(key, candles back)])
PLAN = [("5m", 14, [("5m", 1), ("15m", 3), ("1h", 12)]), ("1H", 8, [("4h", 4)]), ("1D", 35, [("1w", 7), ("1m", 30)])]


def one(job):
    sym, bar, limit, wants = job
    time.sleep(0.2)
    d = R.getj(f"https://www.okx.com/api/v5/market/candles?instId={sym}-USDT&bar={bar}&limit={limit}")
    res = {}
    if not d or d.get("code") != "0" or not d.get("data"):
        return sym, res
    rows = sorted(d["data"], key=lambda c: int(c[0]))  # oldest first
    closes = [float(c[4]) for c in rows]
    for key, back in wants:
        if len(closes) > back and closes[-1 - back]:
            res[key] = round((closes[-1] / closes[-1 - back] - 1) * 100, 2)
    return sym, res


def main():
    top = json.load(open(os.path.join(ROOT, "top_coins.json"))).get("coins", [])
    tick = R.getj("https://www.okx.com/api/v5/market/tickers?instType=SPOT") or {}
    tk = {}
    for t in tick.get("data", []):
        if t["instId"].endswith("-USDT"):
            try:
                last, op = float(t["last"]), float(t["open24h"])
                tk[t["instId"][:-5]] = (last, round((last / op - 1) * 100, 2) if op else None, round(float(t.get("volCcy24h") or 0)))
            except Exception:
                pass
    coins = [c for c in top if c["s"] in tk]
    print(f"{len(coins)}/{len(top)} top coins trade on OKX spot")
    jobs = [(c["s"], bar, lim, w) for c in coins for bar, lim, w in PLAN]
    got = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for sym, r in ex.map(one, jobs):
            got.setdefault(sym, {}).update(r)
    out = []
    for c in coins:
        s = c["s"]; r = got.get(s, {})
        if len(r) < 3:
            continue
        item = {"s": s, "n": c.get("n"), "p": tk[s][0], "m": c.get("m") or 0, "v24": tk[s][2], "cat": R.CAT_OF.get(s, "Other"),
                "ch": {"5m": r.get("5m"), "15m": r.get("15m"), "1h": r.get("1h"), "4h": r.get("4h"), "1d": tk[s][1], "1w": r.get("1w"), "1m": r.get("1m")}}
        if c.get("i"):
            item["i"] = c["i"]
        out.append(item)
    if len(out) < 40:
        raise SystemExit("too few coins computed - not overwriting bubbles.json")
    payload = {"generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "source": "OKX + CoinGecko", "coins": out}
    with open(os.path.join(ROOT, "bubbles.json"), "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"wrote {len(out)} coins")


if __name__ == "__main__":
    main()
