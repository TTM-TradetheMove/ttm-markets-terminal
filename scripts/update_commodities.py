#!/usr/bin/env python3
"""Commodities & energy  ->  tradfi_commodities.json (+ status)
Futures prices from Yahoo Finance (front month, may be delayed ~10-15 min), performance, 52-week range and the classic ratios."""
import os, sys
from datetime import datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tf_common as T

STATUS = "tradfi_commodities_status.json"
GROUPS = [
    ("Metals", [("GC=F", "Gold", "$/oz"), ("SI=F", "Silver", "$/oz"), ("HG=F", "Copper", "$/lb"), ("PL=F", "Platinum", "$/oz")]),
    ("Energy", [("CL=F", "WTI crude oil", "$/bbl"), ("BZ=F", "Brent crude oil", "$/bbl"), ("NG=F", "Natural gas", "$/MMBtu")]),
    ("Grains", [("ZW=F", "Wheat", "¢/bu"), ("ZC=F", "Corn", "¢/bu"), ("ZS=F", "Soybeans", "¢/bu")]),
]


def pct(c, n):
    return round((c[-1][1] / c[-1 - n][1] - 1) * 100, 2) if len(c) > n and c[-1 - n][1] else None


def main():
    data, groups = {}, []
    for g, items in GROUPS:
        rows = []
        for sym, name, unit in items:
            c = T.yahoo_daily(sym, "2y")
            if len(c) < 30:
                continue
            data[sym] = c
            yr = c[-252:]
            lo, hi = min(v for _, v in yr), max(v for _, v in yr)
            y0 = datetime.now().year
            ytd = next((v for d, v in c if d >= f"{y0}-01-01"), None)
            rows.append({"s": sym, "n": name, "u": unit, "px": round(c[-1][1], 3), "d1": pct(c, 1), "w1": pct(c, 5), "m1": pct(c, 21), "m3": pct(c, 63), "y1": pct(c, 252),
                         "ytd": round((c[-1][1] / ytd - 1) * 100, 2) if ytd else None, "lo": round(lo, 3), "hi": round(hi, 3), "pos": round((c[-1][1] - lo) / (hi - lo) * 100, 0) if hi > lo else None,
                         "spark": [round(v, 3) for _, v in c[-90:]], "date": c[-1][0]})
        if rows:
            groups.append({"g": g, "rows": rows})
    if not groups:
        T.keep_old("no commodity prices available; kept previous file", STATUS)
        return

    def ratio(a, b, k=1.0):
        if a not in data or b not in data:
            return None
        da, db = dict(data[a]), dict(data[b])
        ds = sorted(set(da) & set(db))[-500:]
        s = [(d, da[d] / db[d] * k) for d in ds if db[d]]
        if len(s) < 60:
            return None
        v = [x for _, x in s]
        now = v[-1]
        pr = round(sum(1 for x in v if x <= now) / len(v) * 100)
        return {"dates": [d for d, _ in s][-260:], "v": [round(x, 4) for x in v][-260:], "now": round(now, 3), "pctile": pr, "avg": round(sum(v) / len(v), 3)}
    ratios = {"goldsilver": ratio("GC=F", "SI=F"), "coppergold": ratio("HG=F", "GC=F", 1000), "oilgold": ratio("CL=F", "GC=F", 1000), "brentwti": None}
    if "BZ=F" in data and "CL=F" in data:
        da, db = dict(data["BZ=F"]), dict(data["CL=F"])
        ds = sorted(set(da) & set(db))[-260:]
        v = [round(da[d] - db[d], 3) for d in ds]
        ratios["brentwti"] = {"dates": ds, "v": v, "now": v[-1], "pctile": round(sum(1 for x in v if x <= v[-1]) / len(v) * 100), "avg": round(sum(v) / len(v), 3)}
    T.save("tradfi_commodities.json", {"generated_at": T.now_iso(), "groups": groups, "ratios": ratios}, STATUS, {"symbols": len(data), "ratios": [k for k, v in ratios.items() if v]})
    print("wrote tradfi_commodities.json", len(data), "symbols")


if __name__ == "__main__":
    main()
