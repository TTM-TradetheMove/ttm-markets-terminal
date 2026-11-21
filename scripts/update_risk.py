#!/usr/bin/env python3
"""TTM Risk charts  ->  risk_data.json

Our own versions of well-known public indicators, built from free data only:
  FRED (credit spread, yield curve, liquidity inputs), Coin Metrics community (BTC price), Yahoo/Stooq (S&P 500 overlay).
Scores are TTM scores from 0 (low risk) to 1 (high risk). Each is a percentile of its own past (expanding window, no look-ahead).
If a source fails, that chart is skipped and the old file's chart is kept.
"""
import csv, io, json, math, os, time, urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"}
STATUS = {}
GENESIS = date(2009, 1, 3)


def fetch(url, tries=3, timeout=60):
    last = None
    for _ in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read().decode()
        except Exception as e:  # noqa
            last = e
            time.sleep(3)
    raise last


def fred(sid, start="1985-01-01"):
    t = fetch(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}", tries=3, timeout=90)
    out = []
    for row in csv.reader(io.StringIO(t)):
        if len(row) < 2 or not row[0][:1].isdigit():
            continue
        try:
            out.append((row[0], float(row[1])))
        except ValueError:
            pass
    if len(out) < 20:
        raise ValueError(f"FRED {sid}: too few rows")
    return out


def month_last(rows):
    """Last value of each month -> list of (YYYY-MM-01, value)."""
    m = {}
    for d, v in rows:
        m[d[:7]] = v
    return sorted((k + "-01", v) for k, v in m.items())


def month_avg(rows):
    s, n = {}, {}
    for d, v in rows:
        k = d[:7]
        s[k] = s.get(k, 0) + v
        n[k] = n.get(k, 0) + 1
    return sorted((k + "-01", s[k] / n[k]) for k in s)


def pct_expanding(vals, minn=36):
    """Percentile (0..1) of each value among all values up to and including it. None until minn values exist."""
    out, seen = [], []
    import bisect
    for v in vals:
        if v is None:
            out.append(None)
            continue
        bisect.insort(seen, v)
        out.append(None if len(seen) < minn else bisect.bisect_left(seen, v) / (len(seen) - 1 if len(seen) > 1 else 1))
    return out


def smooth(vals, n):
    out = []
    for i in range(len(vals)):
        w = [x for x in vals[max(0, i - n + 1):i + 1] if x is not None]
        out.append(sum(w) / len(w) if w and vals[i] is not None else None)
    return out


def yoy(rows, lag):
    out = []
    for i, (d, v) in enumerate(rows):
        out.append((d, (v / rows[i - lag][1] - 1) * 100) if i >= lag and rows[i - lag][1] else (d, None))
    return out


def series_of(dates, vals, nd=3):
    return [[d, round(v, nd)] for d, v in zip(dates, vals) if v is not None]


def trim(series, from_date):
    return [p for p in series if p[0] >= from_date]


def weekly(rows):
    """Keep one point per ISO week (the last) but every day of the last 400 days."""
    cut = (date.today() - timedelta(days=400)).isoformat()
    last = {}
    for d, v in rows:
        if d >= cut:
            last[d] = v
        else:
            y, w, _ = date.fromisoformat(d).isocalendar()
            last[(y, w)] = (d, v)
    out = [(k[0] if isinstance(k, tuple) else k, v) for k, v in last.items()]
    flat = []
    for k, v in last.items():
        flat.append((v[0], v[1]) if isinstance(k, tuple) else (k, v))
    return sorted(flat)


# ---------- overlays ----------
def sp500():
    try:
        j = json.loads(fetch("https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=max&interval=1mo"))["chart"]["result"][0]
        ts, cl = j["timestamp"], j["indicators"]["quote"][0]["close"]
        rows = [(datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-01"), c) for t, c in zip(ts, cl) if c]
        if len(rows) > 200:
            STATUS["sp500"] = "yahoo " + str(len(rows))
            return rows
    except Exception as e:  # noqa
        STATUS["sp500_yahoo"] = str(e)[:100]
    try:
        t = fetch("https://stooq.com/q/d/l/?s=%5Espx&i=m")
        rows = []
        for r in csv.DictReader(io.StringIO(t)):
            try:
                rows.append((r["Date"][:7] + "-01", float(r["Close"])))
            except (KeyError, ValueError):
                pass
        if len(rows) > 200:
            STATUS["sp500"] = "stooq " + str(len(rows))
            return rows
    except Exception as e:  # noqa
        STATUS["sp500_stooq"] = str(e)[:100]
    return []


def btc_daily():
    txt = fetch("https://raw.githubusercontent.com/coinmetrics/data/master/csv/btc.csv", timeout=120)
    rows = []
    for r in csv.DictReader(io.StringIO(txt)):
        try:
            rows.append((r["time"][:10], float(r["PriceUSD"]), float(r.get("CapMrktCurUSD") or 0) or None, float(r.get("CapRealUSD") or 0) or None))
        except (KeyError, ValueError):
            pass
    # extend to today from the site's own price file (Coinbase) if the CSV is behind
    try:
        recent = json.load(open(os.path.join(ROOT, "btc_price_data.json")))["prices"]
        have = {d for d, _ in rows}
        rows += [(p["date"], float(p["price"]), None, None) for p in recent if p["date"] not in have and p["date"] > rows[-1][0]]
    except Exception:  # noqa
        pass
    rows.sort()
    if len(rows) < 3000:
        raise ValueError("BTC history too short")
    return rows


# ---------- charts ----------
MACRO_BANDS = ["Very Loose", "Loose", "Neutral", "Tight", "Very Tight"]
RISK_BANDS = ["Very low", "Low", "Medium", "High", "Very high"]


def chart_credit(spx):
    r = month_avg(fred("BAA10Y"))
    p = pct_expanding([v for _, v in r], 60)
    d = [x[0] for x in r]
    return {"id": "credit", "title": "Credit Spread Risk", "kind": "risk", "bands": ["Very calm", "Calm", "Neutral", "Stressed", "Very stressed"], "freq": "monthly",
            "sub": "Moody's Baa corporate yield minus the 10-year Treasury, as a percentile of its own history",
            "series": trim(series_of(d, p), "1991-01-01"), "overlay": {"name": "S&P 500", "log": True, "series": [[a, round(b, 2)] for a, b in spx if a >= "1991-01-01"]},
            "extra": {"name": "Spread (%)", "series": [[a, round(b, 2)] for a, b in r if a >= "1991-01-01"]},
            "desc": "How much extra yield investors demand to hold risky company debt instead of government bonds. When that gap widens fast, lenders are getting nervous and credit is tightening, which has come before most recessions and many equity and crypto drawdowns. High score = spreads wide for their own history.",
            "how": "Source: FRED BAA10Y (monthly average). Score = where the latest spread sits among every spread seen up to that month (0 = tightest ever, 1 = widest ever). No look-ahead."}


def chart_curve(spx):
    r = month_avg(fred("T10Y3M"))
    p = pct_expanding([-v for _, v in r], 60)
    d = [x[0] for x in r]
    return {"id": "curve", "title": "Yield Curve Recession Risk", "kind": "risk", "bands": ["Very low", "Low", "Medium", "High", "Very high"], "freq": "monthly",
            "sub": "US 10-year minus 3-month Treasury yield; the flatter or more inverted, the higher the score",
            "series": trim(series_of(d, p), "1987-01-01"), "overlay": {"name": "S&P 500", "log": True, "series": [[a, round(b, 2)] for a, b in spx if a >= "1987-01-01"]},
            "extra": {"name": "10y minus 3m (%)", "series": [[a, round(b, 2)] for a, b in r if a >= "1987-01-01"]},
            "desc": "When short-term rates rise above long-term rates (an inverted curve) it has signalled a US recession ahead in every downturn since the 1970s, usually 6 to 18 months early. High score = curve inverted or very flat compared with its history.",
            "how": "Source: FRED T10Y3M (monthly average). Score = percentile of the inverted spread (the more inverted, the higher). It is a warning gauge, not a timing tool."}


def chart_liquidity(spx):
    parts = {}
    z = fred("DFII10", "2003-01-01"); parts["real10"] = (month_avg(z), 1)                      # higher real yield = tighter
    try:
        z = fred("DTWEXBGS", "2005-06-01"); parts["usd"] = (month_avg(z), 1)                   # stronger dollar = tighter
    except Exception as e:  # noqa
        STATUS["usd"] = str(e)[:80]
    z = fred("BAA10Y", "2002-01-01"); parts["credit"] = (month_avg(z), 1)
    m2 = month_last(fred("M2SL", "2002-01-01")); parts["m2"] = ([(d, v) for d, v in yoy(m2, 12) if v is not None], -1)   # slower M2 = tighter
    walcl = dict(fred("WALCL", "2002-01-01")); tga = dict(fred("WTREGEN", "2002-01-01"))
    try:
        rrp = dict(fred("RRPONTSYD", "2002-01-01"))
    except Exception:  # noqa
        rrp = {}
    tga_scale = 1000.0 if (sorted(tga.values())[len(tga) // 2] if tga else 0) > 5000 else 1.0
    net, last_rrp = [], 0.0
    for d in sorted(walcl):
        last_rrp = rrp.get(d, last_rrp)
        net.append((d, walcl[d] / 1000.0 - (tga.get(d, 0) / tga_scale) - last_rrp))
    nm = month_last(net); parts["net"] = ([(d, v) for d, v in yoy(nm, 12) if v is not None], -1)      # shrinking net liquidity = tighter
    allm = sorted({d for lst, _ in parts.values() for d, _ in lst})
    pcts = {}
    for k, (lst, sign) in parts.items():
        mp = dict(lst)
        vals = [(sign * mp[d]) if d in mp else None for d in allm]
        pcts[k] = pct_expanding(vals, 36)
    comp = []
    for i in range(len(allm)):
        w = [pcts[k][i] for k in pcts if pcts[k][i] is not None]
        comp.append(sum(w) / len(w) if len(w) >= 3 else None)
    comp = smooth(comp, 3)
    return {"id": "liquidity", "title": "Liquidity Risk", "kind": "risk", "bands": MACRO_BANDS, "freq": "monthly",
            "sub": "How tight US and global money conditions are, as a percentile of their own history (0 loose, 1 very tight)",
            "series": trim(series_of(allm, comp), "2007-01-01"), "overlay": {"name": "S&P 500", "log": True, "series": [[a, round(b, 2)] for a, b in spx if a >= "2007-01-01"]},
            "desc": "Risk assets (stocks and crypto) tend to do best when money is loose and worst when it is tight. This score blends the 10-year real yield, the US dollar, credit spreads, money-supply (M2) growth and the Fed's net liquidity (balance sheet minus Treasury cash and reverse repos). High score = tight conditions, which are less supportive for risk assets.",
            "how": "Five inputs from FRED, each turned into its own percentile (past only), averaged, then smoothed over 3 months. Needs at least 3 inputs available. Net liquidity growth uses WALCL minus TGA minus reverse repo."}


def chart_btc(btc, spx_unused=None):
    import statistics
    d = [x[0] for x in btc]; p = [x[1] for x in btc]; mc = [x[2] for x in btc]; rc = [x[3] for x in btc]
    ln = [math.log(v) for v in p]
    xs = [math.log(max(1, (date.fromisoformat(x) - GENESIS).days)) for x in d]
    # log regression over the whole history (hindsight fit, shown as such)
    start = next(i for i, x in enumerate(d) if x >= "2011-01-01")
    X, Y = xs[start:], ln[start:]
    mx, my = sum(X) / len(X), sum(Y) / len(Y)
    b = sum((a - mx) * (c - my) for a, c in zip(X, Y)) / sum((a - mx) ** 2 for a in X); a0 = my - b * mx
    res = [c - (a0 + b * a) for a, c in zip(X, Y)]
    sd = statistics.pstdev(res)
    fitv = lambda day: a0 + b * math.log(max(1, day))
    # --- risk score
    ma = [None] * len(p)
    for i in range(len(p)):
        if i >= 1399:
            ma[i] = sum(p[i - 1399:i + 1]) / 1400
    a_dev = [(math.log(p[i] / ma[i]) if ma[i] else None) for i in range(len(p))]
    r_dev = [None] * len(p)
    for k, i in enumerate(range(start, len(p))):
        r_dev[i] = res[k]
    mvrv = [(mc[i] / rc[i]) if mc[i] and rc[i] else None for i in range(len(p))]
    z = [None] * len(p); n_, s1, s2 = 0, 0.0, 0.0
    for i in range(len(p)):
        if mc[i]:
            n_ += 1; s1 += mc[i]; s2 += mc[i] ** 2
        if mc[i] and rc[i] and n_ > 365:
            sdv = math.sqrt(max(s2 / n_ - (s1 / n_) ** 2, 1e-9)); z[i] = (mc[i] - rc[i]) / sdv
    halv = [(date(2012, 11, 28), 25.0), (date(2016, 7, 9), 12.5), (date(2020, 5, 11), 6.25), (date(2024, 4, 20), 3.125), (date(2028, 4, 20), 1.5625)]
    def subsidy(dt):
        sv = 50.0
        for hd, v in halv:
            if dt >= hd:
                sv = v
        return sv
    iss = [subsidy(date.fromisoformat(x)) * 144 * v for x, v in zip(d, p)]
    pu = [(iss[i] / (sum(iss[i - 364:i + 1]) / 365) if i >= 364 and d[i] >= "2011-06-01" else None) for i in range(len(iss))]
    P = {"ma200w": pct_expanding(a_dev, 365), "logreg": pct_expanding(r_dev, 365), "mvrv": pct_expanding(mvrv, 365), "mvrvz": pct_expanding(z, 365), "puell": pct_expanding(pu, 365)}
    names = {"ma200w": "Price vs 200-week average", "logreg": "Log regression", "mvrv": "MVRV", "mvrvz": "MVRV Z-Score", "puell": "Puell Multiple"}
    PS = {k: smooth(v, 7) for k, v in P.items()}
    comp = []
    for i in range(len(p)):
        w = [PS[k][i] for k in PS if PS[k][i] is not None]
        comp.append(sum(w) / len(w) if len(w) >= 3 else None)
    comp = smooth(comp, 7)
    rows = list(zip(d, comp))
    wk = weekly([(a, v) for a, v in rows if v is not None and a >= "2014-06-01"])
    wset = {a for a, _ in wk}
    parts = [{"k": k, "name": names[k], "series": [[a, round(v, 3)] for a, v in zip(d, PS[k]) if v is not None and a in wset]} for k in names]
    risk = {"id": "btcrisk", "title": "Bitcoin Risk", "kind": "risk", "bands": RISK_BANDS, "freq": "daily",
            "sub": "One 0 to 1 gauge of how stretched Bitcoin is, combining five valuation measures. You can change how much each counts.",
            "series": [[a, round(v, 3)] for a, v in wk],
            "parts": parts,
            "overlay": {"name": "BTC price", "log": True, "series": [[a, round(v, 2)] for a, v in weekly([(a, v) for a, v in zip(d, p) if a >= "2014-06-01"])]},
            "desc": "Low scores have been where Bitcoin was cheap against its own history; high scores where it was stretched. It says where we are in the cycle, not what happens next. Use the sliders to remove or down-weight any measure and see how the score changes.",
            "how": "Five measures, each turned into a percentile of its own past (no look-ahead) and smoothed over 7 days: price vs the 200-week average, price vs the log-regression trend, MVRV, MVRV Z-Score and the Puell Multiple. The score is their weighted average. Starts mid 2014 so there is enough history to rank."}
    # --- log regression chart
    end_day = (date.today() - GENESIS).days + 365
    lines = [{"n": "BTC price", "c": "#dba118", "w": 1.8, "s": [[a, round(v, 2)] for a, v in weekly(list(zip(d, p))) if a >= "2011-01-01"]}]
    for k, lab, col in [(2, "+2σ", "#e0554d"), (1, "+1σ", "#e08a4d"), (0, "Trend", "#9aa0aa"), (-1, "-1σ", "#4da3ff"), (-2, "-2σ", "#3fb47a")]:
        s = []
        for day in range((date(2011, 1, 1) - GENESIS).days, end_day, 14):
            dd = (GENESIS + timedelta(days=day)).isoformat()
            s.append([dd, round(math.exp(fitv(day) + k * sd), 4)])
        lines.append({"n": lab, "c": col, "w": 1.1 if k else 1.6, "dash": bool(k), "s": s})
    logreg = {"id": "logreg", "title": "Logarithmic Regression", "kind": "lines", "freq": "daily", "logY": True,
              "sub": f"Bitcoin price with a long-term trend line and bands at ±1 and ±2 standard deviations (fitted on all data since 2011; slope {b:.2f})",
              "lines": lines,
              "desc": "A straight line fitted through Bitcoin's price on log scales shows its long-term growth path. The bands show how far price has historically swung from that path. Price near the bottom band has been cheap and near the top band stretched. Growth has been slowing over time, so older fits overstate the future.",
              "how": "Least squares fit of ln(price) against ln(days since the genesis block, 3 Jan 2009), using daily prices from 2011. Bands are the standard deviation of the fit errors. This is fitted with hindsight on purpose: it is a map of the past, not a forecast."}
    # --- Puell (uses iss/pu above)
    puell = {"id": "puell", "title": "Puell Multiple", "kind": "ratio", "freq": "daily", "logY": True,
             "zones": [{"lo": 0, "hi": 0.5, "label": "Miner stress", "c": "63,180,122"}, {"lo": 4, "hi": 100, "label": "Miner euphoria", "c": "224,85,77"}],
             "sub": "Daily value of newly mined bitcoin divided by its 365-day average",
             "series": [[a, round(v, 3)] for a, v in weekly([(a, v) for a, v in zip(d, pu) if v is not None])],
             "overlay": {"name": "BTC price", "log": True, "series": [[a, round(v, 2)] for a, v in weekly([(a, v) for a, v in zip(d, p) if a >= "2012-01-01"])]},
             "desc": "Miners sell much of what they earn, so the dollar value of new coins is a pulse on miner income. Very low readings (below about 0.5) have lined up with miner capitulation and major cycle lows. Very high readings (above about 4) have lined up with euphoric tops.",
             "how": "Daily issuance (block reward from the halving schedule × 144 blocks) × price, divided by its 365-day average. Uses the reward only (not fees), as in the original definition. Halvings: Nov 2012, Jul 2016, May 2020, Apr 2024."}
    return [risk, logreg, puell]


def main():
    out_path = os.path.join(ROOT, "risk_data.json")
    old = {}
    try:
        old = {c["id"]: c for c in json.load(open(out_path)).get("charts", [])}
    except Exception:  # noqa
        pass
    spx = sp500()
    new = {}
    for name, fn in (("liquidity", lambda: [chart_liquidity(spx)]), ("credit", lambda: [chart_credit(spx)]), ("curve", lambda: [chart_curve(spx)]), ("btc", lambda: chart_btc(btc_daily()))):
        try:
            for c in fn():
                new[c["id"]] = c
            STATUS[name] = "ok"
        except Exception as e:  # noqa
            STATUS[name] = "failed: " + str(e)[:150]
    order = ["liquidity", "credit", "curve", "btcrisk", "logreg", "puell"]
    charts = []
    for k in order:
        c = new.get(k) or old.get(k)
        if c:
            if k not in new:
                c["stale"] = True
            c["latest"] = (c.get("series") or [None])[-1] if c.get("series") else (c["lines"][0]["s"][-1] if c.get("lines") else None)
            charts.append(c)
    if not charts:
        print("nothing built, keeping the old file", STATUS)
        raise SystemExit(0)
    json.dump({"generated_at": datetime.now(timezone.utc).isoformat(), "charts": charts}, open(out_path, "w"), separators=(",", ":"))
    json.dump({"generated_at": datetime.now(timezone.utc).isoformat(), "status": STATUS}, open(os.path.join(ROOT, "risk_data_status.json"), "w"), indent=1)
    print(json.dumps(STATUS, indent=1), "size", os.path.getsize(out_path))


if __name__ == "__main__":
    main()
