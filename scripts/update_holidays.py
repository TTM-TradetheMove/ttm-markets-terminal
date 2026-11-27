"""Exchange holidays and early closes for the Trading hours widget -> exchange_holidays.json.
Uses the open-source exchange_calendars package (the same calendars professional tools use), so it follows each
exchange's own rules (Good Friday, Golden Week, Lunar New Year, Thanksgiving half day and so on) and extends itself."""
import json, os, sys, traceback
from datetime import date, timedelta
import pandas as pd
import exchange_calendars as xc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# our key -> (calendar names to try, normal close in local minutes)
EXCH = {
    "asx": (["XASX"], 960),
    "tse": (["XTKS"], 930),
    "hkex": (["XHKG"], 960),
    "sgx": (["XSES"], 1020),
    "lse": (["XLON"], 990),
    "xet": (["XETR", "XFRA"], 1050),
    "nyse": (["XNYS"], 960),
}


def build(cal_names, normal_close):
    cal = None
    for n in cal_names:
        try:
            cal = xc.get_calendar(n)   # default bounds: 20 years back to one year ahead (this job re-runs weekly)
            print("using calendar", n, "from", cal.first_session.date(), "to", cal.last_session.date())
            break
        except Exception:  # noqa
            print("calendar", n, "failed:"); traceback.print_exc(file=sys.stdout)
    if cal is None:
        return None
    start = max(pd.Timestamp(date.today() - timedelta(days=7)), cal.first_session.tz_localize(None) if cal.first_session.tzinfo else cal.first_session)
    end = pd.Timestamp(cal.last_session.date())
    sess = {pd.Timestamp(x).date() for x in cal.sessions_in_range(start, end)}
    names = {}
    try:
        s = cal.regular_holidays.holidays(start, end, return_name=True)
        for d, n in s.items():
            names[pd.Timestamp(d).date().isoformat()] = str(n)
    except Exception:  # noqa
        print("holiday names unavailable:"); traceback.print_exc(file=sys.stdout)
    hol = {}
    d = start.normalize()
    while d <= end:
        if d.weekday() < 5 and d.date() not in sess:
            hol[d.date().isoformat()] = names.get(d.date().isoformat(), "Market holiday")
        d += pd.Timedelta(days=1)
    early = {}
    try:
        closes = cal.closes
        for d in cal.sessions_in_range(start, end):
            c = closes.loc[d]
            c = c.tz_convert(str(cal.tz)) if c.tzinfo else c
            mins = c.hour * 60 + c.minute
            if mins < normal_close:
                early[pd.Timestamp(d).date().isoformat()] = int(mins)
    except Exception:  # noqa
        print("early closes unavailable:"); traceback.print_exc(file=sys.stdout)
    return {"holidays": hol, "early": early}


def main():
    out = {}
    for k, (names, nc) in EXCH.items():
        try:
            r = build(names, nc)
        except Exception:  # noqa
            print(k, "failed:"); traceback.print_exc(file=sys.stdout); r = None
        if r:
            out[k] = r
            print(k, len(r["holidays"]), "holidays,", len(r["early"]), "early closes")
    if not out:
        sys.exit("no calendars built")
    json.dump({"updated": date.today().isoformat(), "exchanges": out}, open(os.path.join(ROOT, "exchange_holidays.json"), "w"), indent=1)
    print("written", ", ".join(out))


if __name__ == "__main__":
    main()
