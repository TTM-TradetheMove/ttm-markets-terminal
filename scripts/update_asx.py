#!/usr/bin/env python3
"""TTM ASX snapshot builder -> asx_snapshot.json (free page "ASX snapshot" + ASX tab of the sector heatmap).

Reuses the Yahoo chart helper from update_tradfi.py. Pulls: ASX 200, the S&P/ASX 200 sector indices (fallback: average of
the big stocks in each sector), ~45 large ASX stocks for movers + breadth, and AUD/USD to show gold and oil in Australian dollars.
Every piece is optional: a failure only blanks that part. If nothing at all comes back the old file is kept.
"""
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
import datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import update_tradfi as T  # noqa: E402

LOG = []
def log(msg):
    print(msg, flush=True); LOG.append(msg)
    try:
        open(os.path.join(ROOT, "asx_debug.txt"), "w").write("\n".join(LOG) + "\n")
    except Exception:
        pass
T.log = log   # the helper functions write to our log, not the TradFi one

SECT_IDX = [("^AXEJ", "Energy"), ("^AXMJ", "Materials"), ("^AXIJ", "Industrials"), ("^AXDJ", "Cons. Disc."),
            ("^AXSJ", "Cons. Staples"), ("^AXHJ", "Health Care"), ("^AXXJ", "Financials"), ("^AXPJ", "A-REITs"),
            ("^AXTJ", "Tech"), ("^AXNJ", "Comm. Svcs"), ("^AXUJ", "Utilities")]
STOCKS = {
 "Financials": ["CBA", "NAB", "WBC", "ANZ", "MQG", "QBE", "SUN", "IAG", "ASX"],
 "Materials": ["BHP", "RIO", "FMG", "NST", "EVN", "S32", "MIN", "PLS", "BSL"],
 "Energy": ["WDS", "STO", "ORG", "YAL", "PDN"],
 "Health Care": ["CSL", "RMD", "COH", "SHL", "PME"],
 "Cons. Disc.": ["WES", "JBH", "ALL", "LNW", "TLC"],
 "Cons. Staples": ["WOW", "COL", "TWE"],
 "Industrials": ["TCL", "BXB", "QAN", "ALQ", "SYD"],
 "Comm. Svcs": ["TLS", "REA"],
 "Utilities": ["AGL", "APA"],
 "A-REITs": ["GMG", "SCG", "GPT", "MGR", "DXS"],
 "Tech": ["XRO", "WTC", "TNE", "NXT"],
}
def fetch(sym):
    r = T.yahoo(sym)
    return sym, r

def main():
    syms = ["^AXJO", "AUDUSD=X", "GC=F", "CL=F", "HG=F"] + [s for s, _ in SECT_IDX] + [c + ".AX" for v in STOCKS.values() for c in v]
    res = {}
    with ThreadPoolExecutor(8) as ex:
        for sym, r in ex.map(fetch, syms):
            if r:
                try:
                    q, hist = T.build_quote(sym, sym, r[0], r[1], r[2]); res[sym] = q
                except Exception as e:  # noqa
                    log(f"quote fail {sym}: {e}")
    log(f"quotes ok: {len(res)}/{len(syms)}")
    out = {"generated_at": T.now_iso()}
    ix = res.get("^AXJO")
    if ix:
        out["index"] = {"name": "ASX 200", "price": ix["price"], "chg_pct": ix["chg_pct"], "m1": ix["perf"]["m1"], "ytd": ix["perf"]["ytd"],
                        "w52_high": ix["w52_high"], "w52_low": ix["w52_low"], "spark": ix["spark"]}
    # stocks + sector fallback
    stocks, bysec = [], {}
    for sec, codes in STOCKS.items():
        for c in codes:
            q = res.get(c + ".AX")
            if q and q.get("chg_pct") is not None:
                stocks.append({"code": c, "sector": sec, "price": q["price"], "chg_pct": q["chg_pct"], "m1": q["perf"]["m1"]})
                bysec.setdefault(sec, []).append(q)
    sectors = []
    for sym, name in SECT_IDX:
        q = res.get(sym)
        if q and q.get("chg_pct") is not None:
            sectors.append({"name": name, "d1": q["chg_pct"], "m1": q["perf"]["m1"], "src": "index"})
        elif bysec.get(name):
            qs = bysec[name]; avg = lambda k: round(sum(k(x) for x in qs if k(x) is not None) / max(1, len([x for x in qs if k(x) is not None])), 2)
            sectors.append({"name": name, "d1": avg(lambda x: x["chg_pct"]), "m1": avg(lambda x: x["perf"]["m1"]), "src": "stocks"})
    out["sectors"] = sectors
    if stocks:
        st = sorted(stocks, key=lambda s: -s["chg_pct"])
        out["movers"] = {"up": st[:6], "down": list(reversed(st[-6:]))}
        out["breadth"] = {"up": sum(1 for s in stocks if s["chg_pct"] > 0), "down": sum(1 for s in stocks if s["chg_pct"] < 0), "n": len(stocks)}
    fx = res.get("AUDUSD=X"); aud = {}
    if fx and fx.get("price"):
        aud["audusd"] = {"price": fx["price"], "chg_pct": fx["chg_pct"]}
        for key, sym, nm in (("gold", "GC=F", "Gold"), ("oil", "CL=F", "Oil (WTI)"), ("copper", "HG=F", "Copper")):
            q = res.get(sym)
            if q and q.get("price") and q.get("prev") and fx.get("prev"):
                p = q["price"] / fx["price"]; p0 = q["prev"] / fx["prev"]
                if key == "copper": p, p0 = p * 2204.62, p0 * 2204.62   # US$/lb -> A$/tonne
                aud[key] = {"name": nm, "price": round(p, 2), "chg_pct": round((p / p0 - 1) * 100, 2)}
    if aud: out["aud"] = aud
    if len(out) <= 1:
        log("nothing fetched, keeping the old file"); return
    path = os.path.join(ROOT, "asx_snapshot.json")
    try:
        old = json.load(open(path))
        for k in ("index", "sectors", "movers", "breadth", "aud"):
            if k not in out or not out[k]:
                if k in old: out[k] = old[k]
    except Exception:
        pass
    json.dump(out, open(path, "w"), separators=(",", ":"))
    log(f"wrote asx_snapshot.json: sectors {len(sectors)} ({sum(1 for s in sectors if s['src']=='index')} from indices), stocks {len(stocks)}, aud {list(aud)}")

if __name__ == "__main__":
    main()
