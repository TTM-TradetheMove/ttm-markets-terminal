#!/usr/bin/env python3
"""US earnings calendar + reactions  ->  tradfi_earnings.json (+ tradfi_earnings_status.json)
Calendar: Nasdaq's public earnings calendar (last 7 days and next 14 days, the biggest companies per day).
Reaction: the share-price move after the report (Yahoo daily closes). Before the open = that day vs the day before; after the close = next day vs report day."""
import os, re, sys
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tf_common as T

PER_DAY = 30
STATUS = "tradfi_earnings_status.json"


def money(s):
    try:
        return float(re.sub(r"[^0-9.\-]", "", str(s)) or "nan")
    except ValueError:
        return float("nan")


def num(x):
    v = money(x)
    return None if v != v else v


def when(t):
    t = str(t or "")
    return "bmo" if "pre" in t else "amc" if "after" in t else "na"


def fetch_day(d):
    j = T.getj(f"https://api.nasdaq.com/api/calendar/earnings?date={d}", headers={"Accept": "application/json, text/plain, */*", "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"})
    try:
        rows = j["data"]["rows"] or []
    except Exception:
        return None
    out = []
    for r in rows:
        cap = num(r.get("marketCap"))
        out.append({"s": r.get("symbol"), "n": (r.get("name") or "")[:40], "cap": cap, "t": when(r.get("time")), "q": r.get("fiscalQuarterEnding"),
                    "epsF": num(r.get("epsForecast")), "eps": num(r.get("eps")), "surp": num(r.get("surprise")), "est": r.get("noOfEsts")})
    out = [x for x in out if x["s"] and x["cap"]]
    out.sort(key=lambda x: -x["cap"])
    return out[:PER_DAY]


def main():
    today = datetime.now(timezone.utc).date()
    days, ok, failed = [], 0, 0
    for k in range(-7, 15):
        d = today + timedelta(days=k)
        if d.weekday() >= 5:
            continue
        r = fetch_day(d.isoformat())
        if r is None:
            failed += 1
            continue
        ok += 1
        days.append({"date": d.isoformat(), "rows": r})
    if not ok or not any(x["rows"] for x in days):
        T.keep_old("earnings calendar unavailable; kept previous file", STATUS)
        return
    past = [x for x in days if x["date"] < today.isoformat()]
    syms = sorted({r["s"] for x in past for r in x["rows"]})
    px = {}
    for s in syms:
        px[s] = T.yahoo_daily(s.replace(".", "-"), "1mo")
    n_react = 0
    for x in past:
        for r in x["rows"]:
            c = px.get(r["s"]) or []
            ds = [d for d, _ in c]
            if x["date"] not in ds:
                continue
            i = ds.index(x["date"])
            try:
                if r["t"] == "amc":
                    r["move"] = round((c[i + 1][1] / c[i][1] - 1) * 100, 2) if i + 1 < len(c) else None
                else:
                    r["move"] = round((c[i][1] / c[i - 1][1] - 1) * 100, 2) if i >= 1 else None
            except Exception:
                r["move"] = None
            n_react += r.get("move") is not None
    for x in days:
        for r in x["rows"]:
            if r["eps"] is not None and r["epsF"]:
                r["beat"] = 1 if r["eps"] > r["epsF"] else -1 if r["eps"] < r["epsF"] else 0
    T.save("tradfi_earnings.json", {"generated_at": T.now_iso(), "today": today.isoformat(), "days": days}, STATUS,
           {"days_ok": ok, "days_failed": failed, "companies": sum(len(x["rows"]) for x in days), "with_reaction": n_react})
    print("wrote tradfi_earnings.json", ok, "days,", n_react, "reactions")


if __name__ == "__main__":
    main()
