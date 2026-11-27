"""Exchange holidays and early closes for the Trading hours widget -> exchange_holidays.json.
Uses the open-source exchange_calendars package (the same calendars professional tools use), so it follows each
exchange's own rules (Good Friday, Golden Week, Lunar New Year, Thanksgiving half day and so on) and extends itself."""
import json, os, sys
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


def build(keys, cal_names, normal_close, start, end):
    cal = None
    for n in cal_names:
        try:
            cal = xc.get_calendar(n, start=start, end=end)
            break
        except Exception as e:  # noqa
            print("calendar", n, "failed:", e, file=sys.stderr)
    if cal is None:
        return None
    sess = set(cal.sessions_in_range(start, end))
    names = {}
    try:
        s = cal.regular_holidays.holidays(start, end, return_name=True)
        for d, n in s.items():
            names[pd.Timestamp(d).date().isoformat()] = str(n)
    except Exception as e:  # noqa
        print("names failed:", e, file=sys.stderr)
    hol = {}
    d = pd.Timestamp(start)
    while d <= pd.Timestamp(end):
        if d.weekday() < 5 and d not in sess:
            hol[d.date().isoformat()] = names.get(d.date().isoformat(), "Market holiday")
        d += pd.Timedelta(days=1)
    early = {}
    for d in cal.sessions_in_range(start, end):
        try:
            c = cal.closes.loc[d].tz_convert(cal.tz)
            mins = c.hour * 60 + c.minute
            if mins < normal_close:
                early[pd.Timestamp(d).date().isoformat()] = mins
        except Exception:  # noqa
            continue
    return {"holidays": hol, "early": early}


def main():
    start = pd.Timestamp(date.today() - timedelta(days=7))
    end = pd.Timestamp(date.today() + timedelta(days=800))
    out = {}
    for k, (names, nc) in EXCH.items():
        r = build(k, names, nc, start, end)
        if r:
            out[k] = r
            print(k, len(r["holidays"]), "holidays,", len(r["early"]), "early closes")
    if not out:
        sys.exit("no calendars built")
    json.dump({"updated": date.today().isoformat(), "exchanges": out}, open(os.path.join(ROOT, "exchange_holidays.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
