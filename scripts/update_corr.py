#!/usr/bin/env python3
"""Crypto vs TradFi correlation  ->  tradfi_corr.json (+ status)
Daily returns of Bitcoin and Ethereum against the Nasdaq 100, S&P 500, gold, the dollar index and the 10-year yield (Yahoo Finance).
Days are the days US markets were open (crypto's close on that date). Rolling 30-day correlation of BTC against each, plus 30 / 90 day tables."""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tf_common as T

STATUS = "tradfi_corr_status.json"
ASSETS = {"BTC": "BTC-USD", "ETH": "ETH-USD"}
REFS = {"NDX": ("^NDX", "Nasdaq 100"), "SPX": ("^GSPC", "S&P 500"), "GOLD": ("GC=F", "Gold"), "DXY": ("DX-Y.NYB", "US dollar index"), "US10Y": ("^TNX", "10-year US yield")}


def corr(a, b):
    n = len(a)
    if n < 10:
        return None
    ma, mb = sum(a) / n, sum(b) / n
    sa = math.sqrt(sum((x - ma) ** 2 for x in a)); sb = math.sqrt(sum((x - mb) ** 2 for x in b))
    return None if sa == 0 or sb == 0 else sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (sa * sb)


def main():
    px = {}
    for k, s in ASSETS.items():
        px[k] = dict(T.yahoo_daily(s, "2y"))
    for k, (s, _) in REFS.items():
        px[k] = dict(T.yahoo_daily(s, "2y"))
    if not px["BTC"] or not px["NDX"]:
        T.keep_old("Bitcoin or Nasdaq prices unavailable; kept previous file", STATUS)
        return
    refs = [k for k in REFS if px[k]]
    dates = sorted(set.intersection(*[set(px[k]) for k in ["BTC"] + refs]))
    if len(dates) < 120:
        T.keep_old("not enough shared days (%d); kept previous file" % len(dates), STATUS)
        return
    ret = {}
    for k in list(ASSETS) + refs:
        v, r = px[k], {}
        for i in range(1, len(dates)):
            a, b = v.get(dates[i - 1]), v.get(dates[i])
            if a and b:
                r[dates[i]] = (b - a) if k == "US10Y" else (b / a - 1)
        ret[k] = r
    rd = dates[1:]

    def series(k, ref, w):
        out = []
        for i in range(len(rd)):
            if i + 1 < w:
                out.append(None)
                continue
            win = rd[i + 1 - w:i + 1]
            if all(d in ret[k] and d in ret[ref] for d in win):
                c = corr([ret[k][d] for d in win], [ret[ref][d] for d in win])
                out.append(None if c is None else round(c, 3))
            else:
                out.append(None)
        return out
    keep = rd[-365:]
    off = len(rd) - len(keep)
    roll = {r: series("BTC", r, 30)[off:] for r in refs}
    table = {}
    for a in ASSETS:
        if a == "ETH" and not ret["ETH"]:
            continue
        table[a] = {r: {"d30": (series(a, r, 30) or [None])[-1], "d90": (series(a, r, 90) or [None])[-1]} for r in refs}
    sig = {}
    for r in refs:
        v = [x for x in roll[r] if x is not None]
        if not v:
            continue
        now, avg = v[-1], sum(v) / len(v)
        sig[r] = {"now": now, "avg": round(avg, 3), "state": "moving together" if now >= 0.5 else "loosely linked" if now >= 0.2 else "decoupled" if now > -0.2 else "moving opposite", "vs_avg": round(now - avg, 3)}
    out = {"generated_at": T.now_iso(), "labels": {k: REFS[k][1] for k in refs}, "dates": keep, "roll": roll, "table": table, "signal": sig, "last": rd[-1]}
    T.save("tradfi_corr.json", out, STATUS, {"days": len(dates), "refs": refs, "last": rd[-1], "eth": bool(ret["ETH"])})
    print("wrote tradfi_corr.json", len(dates), "days, last", rd[-1])


if __name__ == "__main__":
    main()
