#!/usr/bin/env python3
"""Global liquidity dashboard data  ->  tradfi_liquidity.json (+ status)
Net liquidity (US) = Fed balance sheet - Treasury General Account - Reverse repo  (FRED: WALCL, WTREGEN, RRPONTSYD)
Global central-bank assets = Fed + ECB (ECBASSETSW) + Bank of Japan (JPNASSETS), in USD (Yahoo FX)
M2 money supply (M2SL). Compared with Bitcoin and the S&P 500 (Yahoo). Weekly points from 2020."""
import bisect, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tf_common as T

START = "2019-06-01"
FROM = "2020-01-01"
STATUS = "tradfi_liquidity_status.json"


def at(series, date):
    """last value on or before date from [(date, v)] oldest first"""
    ds = [d for d, _ in series]
    i = bisect.bisect_right(ds, date) - 1
    return series[i][1] if i >= 0 else None


def chg(vals, n):
    return None if len(vals) <= n or not vals[-1 - n] else round((vals[-1] / vals[-1 - n] - 1) * 100, 2)


def main():
    wal, tga, rrp = T.fred("WALCL", START), T.fred("WTREGEN", START), T.fred("RRPONTSYD", START)
    if len(wal) < 20 or len(tga) < 20:
        T.keep_old("FRED liquidity series unavailable; kept previous file", STATUS)
        return
    ecb, boj, m2 = T.fred("ECBASSETSW", START), T.fred("JPNASSETS", START), T.fred("M2SL", "2018-01-01")
    eur, jpy = T.yahoo_daily("EURUSD=X", "5y"), T.yahoo_daily("JPY=X", "5y")
    btc, spx = T.yahoo_daily("BTC-USD", "max"), T.yahoo_daily("^GSPC", "10y")
    rows = []
    for d, w in wal:
        if d < FROM:
            continue
        t, r = at(tga, d), at(rrp, d)
        if t is None:
            continue
        net = w / 1000 - t / 1000 - (r or 0)
        row = {"d": d, "fed": round(w / 1000, 1), "tga": round(t / 1000, 1), "rrp": round(r or 0, 1), "net": round(net, 1)}
        e, e_fx, b, b_fx = at(ecb, d), at(eur, d), at(boj, d), at(jpy, d)
        if e and e_fx and b and b_fx:
            row["glob"] = round((w / 1000 + e / 1000 * e_fx + b * 0.1 / b_fx) / 1000, 3)    # $ trillions (BoJ series is in 100 million yen)
        row["btc"] = round(at(btc, d), 0) if at(btc, d) else None
        row["spx"] = round(at(spx, d), 1) if at(spx, d) else None
        rows.append(row)
    net = [r["net"] for r in rows]
    m2v = [(d, v) for d, v in m2]
    m2yoy = [(m2v[i][0], round((m2v[i][1] / m2v[i - 12][1] - 1) * 100, 2)) for i in range(12, len(m2v)) if m2v[i][0] >= FROM]
    last = rows[-1]
    regime = "expanding" if chg(net, 4) is not None and chg(net, 4) > 0.5 else "shrinking" if chg(net, 4) is not None and chg(net, 4) < -0.5 else "flat"
    out = {"generated_at": T.now_iso(), "rows": rows, "m2_yoy": m2yoy, "m2_last": m2v[-1] if m2v else None,
           "now": {"date": last["d"], "net": last["net"], "fed": last["fed"], "tga": last["tga"], "rrp": last["rrp"], "glob": last.get("glob"),
                   "net_4w": chg(net, 4), "net_13w": chg(net, 13), "net_52w": chg(net, 52), "regime": regime}}
    T.save("tradfi_liquidity.json", out, STATUS, {"weeks": len(rows), "last": last["d"], "have_ecb": bool(ecb), "have_boj": bool(boj), "have_m2": bool(m2), "have_btc": bool(btc), "have_spx": bool(spx)})
    print("wrote tradfi_liquidity.json", len(rows), "weeks, last", last["d"])


if __name__ == "__main__":
    main()
