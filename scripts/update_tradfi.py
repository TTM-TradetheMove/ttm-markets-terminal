#!/usr/bin/env python3
"""TTM TradFi data builder.

Pulls only free, key-less public sources and writes three JSON files at the
repo root, read by /tradfi/index.html:

  tradfi_markets.json  - index/sector/FX/commodity quotes, performance, ranges,
                         VIX, breadth proxy, correlations, risk-on/off score
  tradfi_rates.json    - US Treasury curve, Australian govt yields, policy
                         rates, rate-expectation proxies, Fed liquidity,
                         financial conditions
  tradfi_news.json     - central-bank releases + policy/geopolitical/company
                         headlines (title + link only)

Every source is wrapped independently: a failure only blanks that section and
is logged to tradfi_debug.txt. Old values are kept when a refresh fails.
"""
import csv, io, json, math, os, re, sys, time
import datetime as dt
import urllib.request, urllib.parse
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
LOG = []


T0 = time.time()
DEADLINE = T0 + 265          # hard stop for all network work (job limit is 8 min)
HOST_FAIL, HOST_OK = {}, {}


def log(msg):
    print(msg, flush=True)
    LOG.append(msg)
    try:  # live debug file: survives a cancelled / timed-out run
        with open(os.path.join(ROOT, "tradfi_debug.txt"), "w") as f:
            f.write("\n".join(LOG) + "\n")
    except Exception:
        pass


def get(url, timeout=12, tries=2, accept="*/*", breaker=True):
    host = urllib.parse.urlparse(url).netloc
    for i in range(tries):
        if time.time() > DEADLINE:
            log(f"  SKIP (deadline) {url[:100]}")
            return None
        if breaker and HOST_FAIL.get(host, 0) >= 4 and not HOST_OK.get(host):
            log(f"  SKIP (host {host} unreachable) {url[:90]}")
            return None
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
            HOST_OK[host] = HOST_OK.get(host, 0) + 1
            return raw.decode("utf-8-sig", errors="replace")
        except Exception as e:  # noqa
            HOST_FAIL[host] = HOST_FAIL.get(host, 0) + 1
            log(f"  GET fail ({i+1}/{tries}) {url[:110]} -> {type(e).__name__}: {str(e)[:90]}")
            time.sleep(1.0 * (i + 1))
    return None


def now_iso():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def load_json(name):
    try:
        with open(os.path.join(ROOT, name)) as f:
            return json.load(f)
    except Exception:
        return {}


def merge_write(name, new):
    """Keep previous values for any section that failed this run."""
    old = load_json(name)
    out = dict(old)
    changed = False
    for k, v in new.items():
        if v:
            out[k] = v
            changed = True
    if changed:
        out["generated_at"] = now_iso()
    with open(os.path.join(ROOT, name), "w") as f:
        json.dump(out, f, indent=1)
    log(f"wrote {name} ({'updated' if changed else 'NO new data, kept old'}) keys={sorted(k for k in out if k != 'generated_at')}")


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def pct(a, b):
    try:
        return (a / b - 1) * 100
    except Exception:
        return None


def corr(xs, ys):
    n = len(xs)
    if n < 10:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx == 0 or syy == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / math.sqrt(sxx * syy)


def rnd(x, n=2):
    return None if x is None else round(x, n)


# ----------------------------------------------------------------------------
# Yahoo Finance chart API  (quotes + 1y of daily closes)
# ----------------------------------------------------------------------------
INDICES = [
    ("^GSPC", "S&P 500", "Americas"), ("^NDX", "Nasdaq 100", "Americas"), ("^DJI", "Dow Jones", "Americas"),
    ("^AXJO", "ASX 200", "Asia-Pacific"), ("^N225", "Nikkei 225", "Asia-Pacific"),
    ("^FTSE", "FTSE 100", "Europe"), ("^GDAXI", "DAX", "Europe"),
]
SECTORS = [("XLK", "Tech"), ("XLF", "Financials"), ("XLE", "Energy"), ("XLV", "Health Care"),
           ("XLY", "Cons. Disc."), ("XLP", "Cons. Staples"), ("XLI", "Industrials"), ("XLB", "Materials"),
           ("XLU", "Utilities"), ("XLRE", "Real Estate"), ("XLC", "Comm. Svcs")]
OTHERS = [("^VIX", "VIX"), ("DX-Y.NYB", "US Dollar Index (DXY)"), ("GC=F", "Gold"), ("CL=F", "WTI Crude"),
          ("HG=F", "Copper"), ("^TNX", "US 10Y yield"), ("BTC-USD", "Bitcoin"), ("RSP", "S&P 500 Equal Weight"),
          ("SPY", "S&P 500 ETF")]


def yahoo(sym):
    q = urllib.parse.quote(sym, safe="")
    for host in ("query1", "query2"):
        txt = get(f"https://{host}.finance.yahoo.com/v8/finance/chart/{q}?range=1y&interval=1d&includePrePost=false",
                  tries=2, accept="application/json")
        if not txt:
            continue
        try:
            res = json.loads(txt)["chart"]["result"][0]
            meta = res["meta"]
            off = meta.get("gmtoffset", 0) or 0
            ts = res.get("timestamp") or []
            qd = res["indicators"]["quote"][0]
            series = []
            for i, t in enumerate(ts):
                c = qd["close"][i]
                if c is None:
                    continue
                d = dt.datetime.fromtimestamp(t + off, dt.timezone.utc).date().isoformat()
                series.append((d, float(c), qd["high"][i], qd["low"][i]))
            if len(series) < 5:
                continue
            return meta, series, off
        except Exception as e:  # noqa
            log(f"  yahoo parse fail {sym}: {type(e).__name__}: {e}")
    return None


def build_quote(sym, name, meta, series, off):
    price = meta.get("regularMarketPrice") or series[-1][1]
    mt = meta.get("regularMarketTime")
    mdate = dt.datetime.fromtimestamp((mt or 0) + off, dt.timezone.utc).date().isoformat() if mt else series[-1][0]
    closes = [s[1] for s in series]
    dates = [s[0] for s in series]
    if dates[-1] == mdate:
        full = closes[:-1] + [price]
        fdates = dates
    else:
        full = closes + [price]
        fdates = dates + [mdate]
    prev = full[-2]
    last_hi, last_lo = series[-1][2], series[-1][3]
    hi = meta.get("regularMarketDayHigh") or last_hi
    lo = meta.get("regularMarketDayLow") or last_lo
    year = fdates[-1][:4]
    base = next((c for c, d in zip(reversed(full), reversed(fdates)) if d[:4] < year), full[0])

    def back(n):
        return full[-1 - n] if len(full) > n else None

    q = {
        "symbol": sym, "name": name, "price": rnd(price, 4), "prev": rnd(prev, 4),
        "chg": rnd(price - prev, 4), "chg_pct": rnd(pct(price, prev)),
        "day_high": rnd(hi, 4), "day_low": rnd(lo, 4),
        "range_pct": rnd((hi - lo) / prev * 100) if hi and lo and prev else None,
        "range_pos": rnd((price - lo) / (hi - lo), 3) if hi and lo and hi > lo else None,
        "w52_high": rnd(meta.get("fiftyTwoWeekHigh") or max(full), 4),
        "w52_low": rnd(meta.get("fiftyTwoWeekLow") or min(full), 4),
        "perf": {"d1": rnd(pct(price, prev)), "w1": rnd(pct(price, back(5))), "m1": rnd(pct(price, back(21))),
                 "ytd": rnd(pct(price, base))},
        "ma20": rnd(mean(full[-20:]), 4), "ma50": rnd(mean(full[-50:]), 4),
        "spark": [rnd(x, 3) for x in full[-40:]],
        "market_time": mt,
    }
    return q, dict(zip(fdates, full))


def fetch_markets():
    from concurrent.futures import ThreadPoolExecutor
    quotes, hist = {}, {}
    allsyms = ([(s, n) for s, n, _ in INDICES] + SECTORS + OTHERS)
    region = {s: r for s, _, r in INDICES}
    with ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(lambda sn: yahoo(sn[0]), allsyms))
    for (sym, name), got in zip(allsyms, results):
        if not got:
            log(f"yahoo: no data for {sym}")
            continue
        q, h = build_quote(sym, name, *got)
        if sym in region:
            q["region"] = region[sym]
        quotes[sym] = q
        hist[sym] = h
    log(f"yahoo: {len(quotes)}/{len(allsyms)} symbols")
    return quotes, hist


def derive_market_sections(quotes, hist):
    out = {}
    idx = [quotes[s] for s, _, _ in INDICES if s in quotes]
    out["indices"] = idx
    # VIX
    v = quotes.get("^VIX")
    if v:
        series = list(hist["^VIX"].values())
        rank = sum(1 for x in series if x <= v["price"]) / len(series) * 100
        p = v["price"]
        regime = "Calm" if p < 15 else "Normal" if p < 20 else "Elevated" if p < 30 else "Stress"
        out["vix"] = {**{k: v[k] for k in ("price", "chg", "chg_pct", "ma20", "w52_high", "w52_low", "spark",
                                           "day_high", "day_low")}, "percentile_1y": rnd(rank, 0), "regime": regime}
    # breadth proxy
    sec = [dict(symbol=s, name=n, chg_pct=quotes[s]["chg_pct"], m1=quotes[s]["perf"]["m1"])
           for s, n in SECTORS if s in quotes]
    if sec:
        adv = sum(1 for x in sec if (x["chg_pct"] or 0) > 0)
        b = {"sectors": sec, "advancing": adv, "declining": len(sec) - adv}
        rsp, spy = quotes.get("RSP"), quotes.get("SPY")
        if rsp and spy:
            b["equal_vs_cap"] = {"rsp_d1": rsp["perf"]["d1"], "spy_d1": spy["perf"]["d1"],
                                 "rsp_m1": rsp["perf"]["m1"], "spy_m1": spy["perf"]["m1"],
                                 "spread_m1": rnd((rsp["perf"]["m1"] or 0) - (spy["perf"]["m1"] or 0))}
        b["indices_advancing"] = sum(1 for x in idx if (x["chg_pct"] or 0) > 0)
        b["indices_total"] = len(idx)
        out["breadth"] = b
    # macro assets for intermarket cards
    out["macro"] = {k: quotes[s] for k, s in
                    (("dxy", "DX-Y.NYB"), ("gold", "GC=F"), ("oil", "CL=F"), ("copper", "HG=F"),
                     ("us10y", "^TNX"), ("btc", "BTC-USD"), ("spx", "^GSPC")) if s in quotes}
    # correlations (30 trading-day, pairwise date-aligned daily returns)
    names = [("S&P 500", "^GSPC"), ("DXY", "DX-Y.NYB"), ("Gold", "GC=F"), ("Oil", "CL=F"),
             ("Copper", "HG=F"), ("US 10Y", "^TNX"), ("VIX", "^VIX"), ("Bitcoin", "BTC-USD")]
    names = [(n, s) for n, s in names if s in hist]

    def rets(sa, sb, win=30):
        common = sorted(set(hist[sa]) & set(hist[sb]))[-(win + 1):]
        ra, rb = [], []
        for d0, d1 in zip(common, common[1:]):
            ra.append(hist[sa][d1] / hist[sa][d0] - 1)
            rb.append(hist[sb][d1] / hist[sb][d0] - 1)
        return ra, rb

    mat = []
    for _, sa in names:
        row = []
        for _, sb in names:
            if sa == sb:
                row.append(1.0)
            else:
                c = corr(*rets(sa, sb))
                row.append(rnd(c, 2))
        mat.append(row)
    if names:
        out["correlations"] = {"assets": [n for n, _ in names], "matrix": mat, "window_days": 30}
    # risk-on / risk-off composite
    comps = []

    def add(name, signal, detail):
        comps.append({"name": name, "signal": signal, "detail": detail})

    spx = quotes.get("^GSPC")
    if spx and spx["ma50"]:
        add("S&P 500 vs 50-day average", 1 if spx["price"] > spx["ma50"] else -1,
            f"{pct(spx['price'], spx['ma50']):+.1f}% vs 50d")
    if v:
        add("VIX level", 1 if v["price"] < 18 else -1 if v["price"] > 25 else 0, f"VIX {v['price']:.1f}")
    dxy = quotes.get("DX-Y.NYB")
    if dxy and dxy["ma50"]:
        add("US Dollar vs 50-day average", -1 if dxy["price"] > dxy["ma50"] else 1,
            f"DXY {pct(dxy['price'], dxy['ma50']):+.1f}% vs 50d (strong USD = risk-off)")
    if "HG=F" in hist and "GC=F" in hist:
        common = sorted(set(hist["HG=F"]) & set(hist["GC=F"]))
        if len(common) > 21:
            r_now = hist["HG=F"][common[-1]] / hist["GC=F"][common[-1]]
            r_old = hist["HG=F"][common[-21]] / hist["GC=F"][common[-21]]
            ch = pct(r_now, r_old)
            add("Copper / Gold ratio (20d)", 1 if ch > 0 else -1, f"{ch:+.1f}% over 20 sessions")
    if "equal_vs_cap" in out.get("breadth", {}):
        sp = out["breadth"]["equal_vs_cap"]["spread_m1"]
        add("Equal-weight vs cap-weight (1m)", 1 if sp >= 0 else -1, f"RSP minus SPY {sp:+.1f}%")
    if comps:
        score = round(sum(c["signal"] for c in comps) / len(comps) * 100)
        label = "Risk-on" if score >= 33 else "Risk-off" if score <= -33 else "Mixed"
        out["risk"] = {"score": score, "label": label, "components": comps}
    return out


# ----------------------------------------------------------------------------
# FRED (no key) + US Treasury + RBA + BoE
# ----------------------------------------------------------------------------
FRED_CACHE = {}
FRED_SERIES = [("DFEDTARU", "2024-01-01"), ("DFEDTARL", "2024-01-01"), ("IRSTCB01AUM156N", "2024-01-01"),
               ("ECBDFR", "2024-01-01"), ("IRSTCB01GBM156N", "2024-01-01"), ("IRSTCB01JPM156N", "2024-01-01"),
               ("WALCL", "2024-01-01"), ("RRPONTSYD", "2024-01-01"), ("WTREGEN", "2024-01-01"),
               ("NFCI", "2024-01-01"), ("STLFSI4", "2024-01-01"), ("BAMLH0A0HYM2", "2025-01-01"),
               ("T10YIE", "2025-01-01"), ("T5YIE", "2025-01-01"), ("DFII10", "2025-01-01"), ("DFF", "2025-06-01")]


def _fred_raw(series_id, start):
    # FRED is slow from cloud IPs: long timeout, and exempt from the host circuit breaker
    return get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}&cosd={start}",
               timeout=45, tries=2, breaker=False)


def prefetch_fred():
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=8) as ex:
        for (sid, start), txt in zip(FRED_SERIES, ex.map(lambda a: _fred_raw(*a), FRED_SERIES)):
            FRED_CACHE[(sid, start)] = txt
    log(f"fred prefetch: {sum(1 for v in FRED_CACHE.values() if v)}/{len(FRED_SERIES)} series")


def fred(series_id, start="2024-01-01"):
    key = (series_id, start)
    txt = FRED_CACHE[key] if key in FRED_CACHE else _fred_raw(series_id, start)
    if not txt:
        return []
    out = []
    for i, row in enumerate(csv.reader(io.StringIO(txt))):
        if i == 0 or len(row) < 2:
            continue
        try:
            out.append((row[0], float(row[1])))
        except ValueError:
            continue
    log(f"fred {series_id}: {len(out)} rows, last={out[-1] if out else None}")
    return out


def parse_date(s):
    s = s.strip()
    for f in ("%Y-%m-%d", "%d-%b-%Y", "%d %b %Y", "%d/%m/%Y", "%b-%Y", "%d-%b-%y", "%m/%d/%Y"):
        try:
            return dt.datetime.strptime(s, f).date().isoformat()
        except ValueError:
            pass
    return None


def last_change(series):
    """(current, previous_distinct, date_current_began)."""
    if not series:
        return None
    cur = series[-1][1]
    j = len(series) - 1
    while j > 0 and abs(series[j - 1][1] - cur) < 1e-9:
        j -= 1
    if j == 0:
        return {"rate": cur, "prev": None, "since": series[0][0], "change_bp": None, "as_of": series[-1][0]}
    return {"rate": cur, "prev": series[j - 1][1], "since": series[j][0],
            "change_bp": round((cur - series[j - 1][1]) * 100), "as_of": series[-1][0]}


def fetch_treasury():
    year = dt.date.today().year
    rows = []
    for y in (year, year - 1):
        url = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
               f"daily-treasury-rates.csv/{y}/all?type=daily_treasury_yield_curve&field_tdr_date_value={y}&page&_format=csv")
        txt = get(url, tries=2)
        if not txt:
            continue
        rd = csv.DictReader(io.StringIO(txt))
        for r in rd:
            try:
                rows.append({k.strip(): (float(v) if v not in ("", None) and k.strip() != "Date" else v)
                             for k, v in r.items() if k})
            except ValueError:
                continue
        if len(rows) >= 30:
            break
    if not rows:
        return None

    def dkey(r):
        return parse_date(r["Date"]) or ""

    rows.sort(key=dkey, reverse=True)
    tenors = {"1M": "1 Mo", "3M": "3 Mo", "6M": "6 Mo", "1Y": "1 Yr", "2Y": "2 Yr", "3Y": "3 Yr", "5Y": "5 Yr",
              "7Y": "7 Yr", "10Y": "10 Yr", "20Y": "20 Yr", "30Y": "30 Yr"}

    def curve(r):
        return {k: r.get(v) for k, v in tenors.items() if r.get(v) is not None}

    cur, prev = curve(rows[0]), curve(rows[1]) if len(rows) > 1 else {}
    m1 = curve(rows[21]) if len(rows) > 21 else {}
    y1 = curve(rows[250]) if len(rows) > 250 else {}
    hist = []
    for r in reversed(rows[:120]):
        if r.get("2 Yr") is not None and r.get("10 Yr") is not None:
            hist.append([dkey(r), round(r["10 Yr"] - r["2 Yr"], 3)])
    s2s10 = rnd(cur["10Y"] - cur["2Y"], 3) if "10Y" in cur and "2Y" in cur else None
    s3m10 = rnd(cur["10Y"] - cur["3M"], 3) if "10Y" in cur and "3M" in cur else None
    return {"date": dkey(rows[0]), "curve": cur, "prev": prev, "month_ago": m1, "year_ago": y1,
            "spread_2s10s": s2s10, "spread_3m10y": s3m10,
            "inverted_2s10s": (s2s10 < 0) if s2s10 is not None else None,
            "inverted_3m10y": (s3m10 < 0) if s3m10 is not None else None,
            "history_2s10s": hist}


def rba_table(names):
    for n in names:
        txt = get(f"https://www.rba.gov.au/statistics/tables/csv/{n}", tries=2)
        if not txt:
            continue
        rows = list(csv.reader(io.StringIO(txt)))
        sid = next((i for i, r in enumerate(rows) if r and r[0].strip().lower() == "series id"), None)
        title = next((i for i, r in enumerate(rows) if r and r[0].strip().lower() == "title"), None)
        if sid is None:
            log(f"rba {n}: no 'Series ID' row")
            continue
        ids = [c.strip() for c in rows[sid][1:]]
        titles = [c.strip() for c in rows[title][1:]] if title is not None else [""] * len(ids)
        data = {i: [] for i in range(len(ids))}
        for r in rows[sid + 1:]:
            if not r:
                continue
            d = parse_date(r[0])
            if not d:
                continue
            for i in range(len(ids)):
                if i + 1 < len(r) and r[i + 1].strip() not in ("", "-"):
                    try:
                        data[i].append((d, float(r[i + 1])))
                    except ValueError:
                        pass
        for i in data:
            data[i].sort()
        log(f"rba {n}: {len(ids)} series, e.g. {ids[:6]}")
        return ids, titles, data
    return None


def fetch_au():
    t = rba_table(["f2-data.csv", "f2.1-data.csv"])
    if not t:
        return None
    ids, titles, data = t
    want = {"2Y": ("FCMYGBAG2", r"\b2[- ]year"), "3Y": ("FCMYGBAG3", r"\b3[- ]year"),
            "5Y": ("FCMYGBAG5", r"\b5[- ]year"), "10Y": ("FCMYGBAG10", r"\b10[- ]year")}
    out = {}
    for k, (sid, rx) in want.items():
        idx = ids.index(sid) if sid in ids else next(
            (i for i, tt in enumerate(titles) if re.search(rx, tt, re.I) and "government" in tt.lower()), None)
        if idx is None or not data[idx]:
            log(f"rba f2: no series for {k}")
            continue
        s = data[idx]
        out[k] = {"yield": s[-1][1], "prev": s[-2][1] if len(s) > 1 else None, "date": s[-1][0],
                  "m1": s[-22][1] if len(s) > 22 else None}
    return out or None


def fetch_policy():
    pol = {}
    # Fed target range
    up, lo = fred("DFEDTARU"), fred("DFEDTARL")
    if up and lo:
        lc = last_change(up)
        pol["fed"] = {"bank": "Federal Reserve", "rate": up[-1][1], "rate_low": lo[-1][1], "display":
                      f"{lo[-1][1]:.2f}–{up[-1][1]:.2f}%", **{k: lc[k] for k in ("since", "change_bp", "as_of")}}
    # RBA cash rate target
    t = rba_table(["f1-data.csv", "f1.1-data.csv"])
    series = None
    if t:
        ids, titles, data = t
        idx = ids.index("FIRMMCRT") if "FIRMMCRT" in ids else next(
            (i for i, tt in enumerate(titles) if "cash rate target" in tt.lower()), None)
        if idx is not None and data[idx]:
            series = data[idx]
    if not series:
        series = fred("IRSTCB01AUM156N")
    if series:
        lc = last_change(series)
        pol["rba"] = {"bank": "Reserve Bank of Australia", "rate": series[-1][1], "display": f"{series[-1][1]:.2f}%",
                      **{k: lc[k] for k in ("since", "change_bp", "as_of")}}
    # ECB deposit facility
    s = fred("ECBDFR")
    if s:
        lc = last_change(s)
        pol["ecb"] = {"bank": "European Central Bank", "rate": s[-1][1], "display": f"{s[-1][1]:.2f}%",
                      **{k: lc[k] for k in ("since", "change_bp", "as_of")}}
    # BoE bank rate
    boe = None
    txt = get("https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes"
              "&Datefrom=01/Jan/2024&Dateto=now&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N", tries=2)
    if txt:
        pts = []
        for r in csv.reader(io.StringIO(txt)):
            if len(r) >= 2:
                d = parse_date(r[0])
                try:
                    if d:
                        pts.append((d, float(r[1])))
                except ValueError:
                    pass
        pts.sort()
        boe = pts or None
        log(f"boe IUDBEDR: {len(pts)} rows")
    if not boe:
        boe = fred("IRSTCB01GBM156N")
    if boe:
        lc = last_change(boe)
        pol["boe"] = {"bank": "Bank of England", "rate": boe[-1][1], "display": f"{boe[-1][1]:.2f}%",
                      **{k: lc[k] for k in ("since", "change_bp", "as_of")}}
    # BoJ (monthly OECD series on FRED)
    s = fred("IRSTCB01JPM156N")
    if s:
        lc = last_change(s)
        pol["boj"] = {"bank": "Bank of Japan", "rate": s[-1][1], "display": f"{s[-1][1]:.2f}%",
                      **{k: lc[k] for k in ("since", "change_bp", "as_of")}, "note": "monthly series"}
    return pol or None


def fetch_liquidity():
    walcl, rrp, tga = fred("WALCL"), fred("RRPONTSYD"), fred("WTREGEN")
    if not walcl:
        return None

    def bn(v, big):  # normalise to $bn
        return v / 1000 if v > big else v

    wal = [(d, bn(v, 100000)) for d, v in walcl]
    out = {"balance_sheet_bn": rnd(wal[-1][1], 0), "as_of": wal[-1][0]}

    def chg(n):
        return rnd(wal[-1][1] - wal[-1 - n][1], 0) if len(wal) > n else None

    out["chg_4w_bn"], out["chg_13w_bn"], out["chg_52w_bn"] = chg(4), chg(13), chg(52)
    c13 = out["chg_13w_bn"]
    out["regime"] = None if c13 is None else ("QE-like (expanding)" if c13 > 25 else
                                              "QT (shrinking)" if c13 < -25 else "Roughly flat")
    out["spark"] = [rnd(v, 0) for _, v in wal[-52:]]
    r = rrp[-1][1] if rrp else None
    t = bn(tga[-1][1], 20000) if tga else None
    out["rrp_bn"], out["tga_bn"] = rnd(r, 0), rnd(t, 0)
    if r is not None and t is not None:
        out["net_liquidity_bn"] = rnd(wal[-1][1] - t - r, 0)
        if len(rrp) > 22 and len(tga) > 4 and len(wal) > 4:
            nl_old = wal[-5][1] - bn(tga[-5][1], 20000) - rrp[-22][1]
            out["net_liquidity_chg_4w_bn"] = rnd(out["net_liquidity_bn"] - nl_old, 0)
    return out


def fetch_conditions():
    out = {}
    for key, sid, start in (("nfci", "NFCI", "2024-01-01"), ("stlfsi", "STLFSI4", "2024-01-01"),
                            ("hy_oas", "BAMLH0A0HYM2", "2025-01-01"), ("breakeven_10y", "T10YIE", "2025-01-01"),
                            ("breakeven_5y", "T5YIE", "2025-01-01"), ("real_10y", "DFII10", "2025-01-01"),
                            ("effr", "DFF", "2025-06-01")):
        s = fred(sid, start)
        if s:
            out[key] = {"value": s[-1][1], "date": s[-1][0], "prev": s[-2][1] if len(s) > 1 else None,
                        "m1": s[-22][1] if len(s) > 22 else (s[0][1] if len(s) > 1 else None),
                        "spark": [round(v, 3) for _, v in s[-60:]]}
            out[key]["_series"] = s
    return out or None


# ----------------------------------------------------------------------------
# News (RSS)
# ----------------------------------------------------------------------------
def strip_ns(tag):
    return tag.split("}", 1)[-1]


def parse_feed(txt, limit=12):
    try:
        root = ET.fromstring(txt)
    except ET.ParseError as e:
        log(f"  rss parse error: {e}")
        return []
    items = []
    for el in root.iter():
        if strip_ns(el.tag) not in ("item", "entry"):
            continue
        d = {"title": "", "link": "", "date": "", "source": ""}
        for c in el:
            t = strip_ns(c.tag)
            if t == "title":
                d["title"] = (c.text or "").strip()
            elif t == "link":
                d["link"] = (c.text or "").strip() or c.attrib.get("href", "")
            elif t in ("pubDate", "date", "updated", "published"):
                d["date"] = (c.text or "").strip()
            elif t == "source":
                d["source"] = (c.text or "").strip()
        if d["title"] and d["link"]:
            d["ts"] = to_ts(d["date"])
            items.append(d)
    items.sort(key=lambda x: x["ts"] or 0, reverse=True)
    return items[:limit]


def to_ts(s):
    if not s:
        return None
    from email.utils import parsedate_to_datetime
    try:
        return int(parsedate_to_datetime(s).timestamp())
    except Exception:
        pass
    try:
        return int(dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
    except Exception:
        return None


CB_FEEDS = [
    ("Fed", "https://www.federalreserve.gov/feeds/press_monetary.xml"),
    ("Fed", "https://www.federalreserve.gov/feeds/press_all.xml"),
    ("ECB", "https://www.ecb.europa.eu/rss/press.html"),
    ("BoE", "https://www.bankofengland.co.uk/rss/news"),
    ("RBA", "https://www.rba.gov.au/rss/rss-cb-media-releases.xml"),
    ("BoJ", "https://www.boj.or.jp/en/rss/whatsnew.xml"),
]
TOPICS = {
    "policy": "tariffs OR \"trade deal\" OR \"trade war\" OR sanctions OR \"fiscal policy\" OR \"government shutdown\" OR \"export controls\"",
    "geopolitics": "geopolitical OR ceasefire OR missile OR \"Strait of Hormuz\" OR \"Middle East\" OR Ukraine OR Taiwan",
    "companies": "\"earnings\" OR \"profit warning\" OR \"raises guidance\" OR \"cuts guidance\" OR acquisition OR \"merger\" stocks",
    "liquidity": "\"balance sheet\" OR \"quantitative tightening\" OR \"quantitative easing\" OR \"liquidity\" central bank",
}
AFFECTS = [
    (r"tariff|trade (war|deal)|export control|import dut", ["Equities", "FX", "Commodities"]),
    (r"oil|opec|crude|hormuz|energy", ["Oil", "Energy equities", "Inflation"]),
    (r"fed|fomc|powell|warsh|rate (cut|hike|decision)|ecb|boe|rba|boj|inflation|cpi", ["Bonds", "USD", "Equities"]),
    (r"war|missile|ceasefire|attack|sanction|ukraine|taiwan|iran|israel|gaza|russia|china", ["Gold", "Oil", "Risk sentiment"]),
    (r"earnings|guidance|profit|revenue", ["Single stocks", "Sector ETFs"]),
    (r"acqui|merger|takeover|buyout", ["Single stocks", "M&A"]),
    (r"balance sheet|quantitative|liquidity|repo|treasury", ["Bonds", "Funding markets"]),
    (r"yen|boj|japan", ["JPY", "Nikkei", "JGBs"]),
    (r"china|yuan|pboc", ["CNH", "Commodities", "Asia equities"]),
]


def tag_affects(title):
    tags = []
    for rx, ts in AFFECTS:
        if re.search(rx, title, re.I):
            for t in ts:
                if t not in tags:
                    tags.append(t)
    return tags[:4]


def clean_google(it):
    # Google News titles are "Headline - Source"
    if " - " in it["title"] and not it.get("source"):
        h, s = it["title"].rsplit(" - ", 1)
        it["title"], it["source"] = h, s
    return it


def fetch_news():
    out = {}
    cb, seen_banks = [], set()
    for bank, url in CB_FEEDS:
        if bank == "Fed" and "Fed" in seen_banks:
            continue
        txt = get(url, tries=2)
        if not txt:
            continue
        items = parse_feed(txt, 6)
        log(f"rss {bank}: {len(items)} items")
        if items:
            seen_banks.add(bank)
            for it in items:
                cb.append({"bank": bank, "title": it["title"], "link": it["link"], "ts": it["ts"]})
    cb.sort(key=lambda x: x["ts"] or 0, reverse=True)
    out["central_banks"] = cb[:30]
    for key, q in TOPICS.items():
        url = ("https://news.google.com/rss/search?q=" + urllib.parse.quote(q + " when:2d")
               + "&hl=en-US&gl=US&ceid=US:en")
        txt = get(url, tries=2)
        items = [clean_google(i) for i in parse_feed(txt, 14)] if txt else []
        log(f"rss google[{key}]: {len(items)} items")
        out[key] = [{"title": i["title"], "link": i["link"], "source": i.get("source", ""), "ts": i["ts"],
                     "affects": tag_affects(i["title"])} for i in items]
    return out


# ----------------------------------------------------------------------------
def main():
    from concurrent.futures import ThreadPoolExecutor
    log(f"TTM tradfi run {now_iso()}")
    mk_new, rates_new, news_new = {}, {}, {}
    try:
        prefetch_fred()
    except Exception as e:  # noqa
        log(f"fred prefetch FAILED: {e}")
    pool = ThreadPoolExecutor(max_workers=7)
    F = {
        "markets": pool.submit(fetch_markets),
        "treasury": pool.submit(fetch_treasury),
        "au": pool.submit(fetch_au),
        "policy": pool.submit(fetch_policy),
        "liquidity": pool.submit(fetch_liquidity),
        "conditions": pool.submit(fetch_conditions),
        "news": pool.submit(fetch_news),
    }

    def res(name, default=None):
        try:
            v = F[name].result(timeout=max(5, DEADLINE + 20 - time.time()))
            log(f"{name}: {'ok' if v else 'EMPTY'}")
            return v
        except Exception as e:  # noqa
            log(f"{name} FAILED: {type(e).__name__}: {e}")
            return default

    quotes, hist = res("markets", ({}, {}))
    try:
        if quotes:
            mk_new = derive_market_sections(quotes, hist)
            mk_new["sectors_quotes"] = None
    except Exception as e:  # noqa
        log(f"markets derive FAILED: {type(e).__name__}: {e}")
    rates_new["treasury"] = res("treasury")
    rates_new["au"] = res("au")
    rates_new["policy"] = res("policy")
    rates_new["liquidity"] = res("liquidity")
    cond = res("conditions")

    # expectations proxy: 2Y yield vs policy rate
    try:
        exp = {}
        tr, au, pol = rates_new.get("treasury"), rates_new.get("au"), rates_new.get("policy") or {}
        effr = (cond or {}).get("effr", {}).get("value")
        if tr and effr is not None and "2Y" in tr["curve"]:
            gap = tr["curve"]["2Y"] - effr
            exp["us"] = {"policy": effr, "two_year": tr["curve"]["2Y"], "gap_bp": round(gap * 100),
                         "three_month": tr["curve"].get("3M"),
                         "read": "Market pricing cuts" if gap < -0.25 else "Market pricing hikes" if gap > 0.25 else "Roughly on hold"}
        if au and "2Y" in au and pol.get("rba"):
            gap = au["2Y"]["yield"] - pol["rba"]["rate"]
            exp["au"] = {"policy": pol["rba"]["rate"], "two_year": au["2Y"]["yield"], "gap_bp": round(gap * 100),
                         "read": "Market pricing cuts" if gap < -0.25 else "Market pricing hikes" if gap > 0.25 else "Roughly on hold"}
        rates_new["expectations"] = exp or None
    except Exception as e:  # noqa
        log(f"expectations FAILED: {type(e).__name__}: {e}")

    # conditions block (strip raw series) + oil vs breakeven correlation
    if cond:
        be = cond.get("breakeven_10y", {}).get("_series")
        oil = hist.get("CL=F") if hist else None
        if be and oil:
            bem = dict(be)
            common = sorted(set(bem) & set(oil))[-31:]
            xs, ys = [], []
            for d0, d1 in zip(common, common[1:]):
                xs.append(oil[d1] / oil[d0] - 1)
                ys.append(bem[d1] - bem[d0])
            cond["oil_vs_breakeven_corr_30d"] = rnd(corr(xs, ys), 2)
        for v in cond.values():
            if isinstance(v, dict):
                v.pop("_series", None)
        rates_new["conditions"] = cond

    news_new = res("news", {}) or {}

    mk_new.pop("sectors_quotes", None)
    merge_write("tradfi_markets.json", mk_new)
    merge_write("tradfi_rates.json", rates_new)
    merge_write("tradfi_news.json", news_new)
    log(f"done in {time.time() - T0:.0f}s")
    pool.shutdown(wait=False, cancel_futures=True)


if __name__ == "__main__":
    main()
