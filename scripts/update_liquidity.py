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

import csv, io, json
from datetime import date

SRC = {}


def alt_tga():
    """Treasury General Account, daily, $ millions  (US Treasury FiscalData: reliable from GitHub, unlike FRED)"""
    out, page = {}, 1
    while page < 8:
        j = T.getj("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance"
                   f"?fields=record_date,account_type,open_today_bal,close_today_bal&filter=record_date:gte:{START}&sort=record_date&page[size]=2000&page[number]={page}", timeout=45)
        rows = (j or {}).get("data") or []
        for r in rows:
            at_ = r.get("account_type") or ""
            try:
                if "Closing Balance" in at_ and "TGA" in at_:
                    out[r["record_date"]] = float(r["open_today_bal"])
                elif at_ == "Federal Reserve Account" and r["record_date"] not in out:
                    out[r["record_date"]] = float(r["close_today_bal"])
            except (TypeError, ValueError):
                pass
        if len(rows) < 2000:
            break
        page += 1
    T.log("fiscaldata TGA: %d rows" % len(out))
    return sorted(out.items())


def alt_rrp():
    """Overnight reverse repo take-up, daily, $ billions (NY Fed)"""
    out = {}
    for y in range(int(START[:4]), date.today().year + 1):
        j = T.getj(f"https://markets.newyorkfed.org/api/rp/reverserepo/all/results/search.json?startDate={y}-01-01&endDate={y}-12-31", timeout=45)
        for o in ((j or {}).get("repo") or {}).get("operations") or []:
            try:
                out[o["operationDate"]] = out.get(o["operationDate"], 0) + float(o["totalAmtAccepted"]) / 1e9
            except (KeyError, TypeError, ValueError):
                pass
    T.log("nyfed RRP: %d rows" % len(out))
    return sorted((d, round(v, 1)) for d, v in out.items() if d >= START)


def alt_fed():
    """Fed securities holdings (SOMA: Treasuries + agency MBS), weekly, $ millions. Close to, but a little below, total Fed assets (WALCL)."""
    j = T.getj("https://markets.newyorkfed.org/api/soma/summary.json", timeout=45)
    out = []
    for r in ((j or {}).get("soma") or {}).get("summary") or []:
        try:
            if r["asOfDate"] >= START:
                out.append((r["asOfDate"], float(r["total"]) / 1e6))
        except (KeyError, TypeError, ValueError):
            pass
    T.log("nyfed SOMA: %d rows" % len(out))
    if len(out) > 5:
        SRC["fed"] = "soma"
    return sorted(out)


def alt_ecb():
    """Eurosystem total assets, weekly, EUR millions (ECB)"""
    txt = T.get(f"https://data-api.ecb.europa.eu/service/data/ILM/W.U2.C.T000000.Z5.Z01.E?startPeriod={START}&format=csvdata", timeout=45)
    out = []
    for r in csv.DictReader(io.StringIO(txt or "")):
        try:
            out.append((r["TIME_PERIOD"][:10], float(r["OBS_VALUE"])))
        except (KeyError, ValueError):
            pass
    T.log("ecb assets: %d rows" % len(out))
    return sorted(out)


def first(*fs):
    for f in fs:
        v = f()
        if len(v) > 5:
            return v
    return []



def at(series, day):
    """last value on or before day from [(date, v)] oldest first"""
    ds = [d for d, _ in series]
    i = bisect.bisect_right(ds, day) - 1
    return series[i][1] if i >= 0 else None


def chg(vals, n):
    return None if len(vals) <= n or not vals[-1 - n] else round((vals[-1] / vals[-1 - n] - 1) * 100, 2)


def main():
    got = T.parallel({"WALCL": lambda: first(alt_fed, lambda: T.fred("WALCL", START)), "WTREGEN": lambda: first(alt_tga, lambda: [(d, v) for d, v in T.fred("WTREGEN", START)]),
                      "RRPONTSYD": lambda: first(alt_rrp, lambda: T.fred("RRPONTSYD", START)), "ECB": lambda: first(alt_ecb, lambda: T.fred("ECBASSETSW", START)),
                      "BOJ": lambda: T.fred("JPNASSETS", START), "M2": lambda: T.fred("M2SL", "2018-01-01"),
                      "EUR": lambda: T.yahoo_daily("EURUSD=X", "5y"), "JPY": lambda: T.yahoo_daily("JPY=X", "5y"),
                      "BTC": lambda: T.yahoo_daily("BTC-USD", "10y"), "SPX": lambda: T.yahoo_daily("^GSPC", "10y")})
    T.log("rows: " + ", ".join(f"{k}={len(v)}" for k, v in got.items()))
    wal, tga, rrp, ecb, boj, m2, eur, jpy, btc, spx = (got[k] for k in ("WALCL", "WTREGEN", "RRPONTSYD", "ECB", "BOJ", "M2", "EUR", "JPY", "BTC", "SPX"))
    if len(wal) < 20 or len(tga) < 20:
        T.keep_old("liquidity series unavailable (Fed assets %d rows, Treasury cash %d); kept previous file" % (len(wal), len(tga)), STATUS)
        return
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
        if e and e_fx:
            boj_usd = b * 0.1 / b_fx if b and b_fx else 0          # $ billions (BoJ series is in 100 million yen); left out if unavailable
            row["glob"] = round((w / 1000 + e / 1000 * e_fx + boj_usd) / 1000, 3)    # $ trillions
        row["btc"] = round(at(btc, d), 0) if at(btc, d) else None
        row["spx"] = round(at(spx, d), 1) if at(spx, d) else None
        rows.append(row)
    net = [r["net"] for r in rows]
    m2v = [(d, v) for d, v in m2]
    m2yoy = [(m2v[i][0], round((m2v[i][1] / m2v[i - 12][1] - 1) * 100, 2)) for i in range(12, len(m2v)) if m2v[i][0] >= FROM]
    last = rows[-1]
    regime = "expanding" if chg(net, 4) is not None and chg(net, 4) > 0.5 else "shrinking" if chg(net, 4) is not None and chg(net, 4) < -0.5 else "flat"
    out = {"generated_at": T.now_iso(), "fed_src": SRC.get("fed", "walcl"), "has_boj": bool(boj), "rows": rows, "m2_yoy": m2yoy, "m2_last": m2v[-1] if m2v else None,
           "now": {"date": last["d"], "net": last["net"], "fed": last["fed"], "tga": last["tga"], "rrp": last["rrp"], "glob": last.get("glob"),
                   "net_4w": chg(net, 4), "net_13w": chg(net, 13), "net_52w": chg(net, 52), "regime": regime}}
    T.save("tradfi_liquidity.json", out, STATUS, {"weeks": len(rows), "last": last["d"], "fed_src": SRC.get("fed", "walcl"), "rrp_rows": len(rrp), "have_ecb": bool(ecb), "have_boj": bool(boj), "have_m2": bool(m2), "have_btc": bool(btc), "have_spx": bool(spx)})
    print("wrote tradfi_liquidity.json", len(rows), "weeks, last", last["d"])


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        T.keep_old("crashed: " + traceback.format_exc()[-900:], STATUS)
