#!/usr/bin/env python3
"""Crypto reaction history to economic releases  ->  crypto_bias_history.json

For each tracked release (CPI, NFP, FOMC rate, ...) we store the outcome
vs consensus (above / in line / below) and how BTC and ETH moved afterwards
(+15m, +1h, +4h, +24h, plus the 4h high/low excursion). The dashboard turns
this into "X% of the time BTC was higher 4h after a hot CPI" style stats.

Sources (all free, no keys):
  * Releases (date, actual, forecast, previous): ForexFactory month pages,
    rendered with headless Chromium (same approach as update_calendar.py),
    plus released rows from calendar_data.json as a fallback / top-up.
  * Prices: Coinbase Exchange 15-minute candles (Bitstamp as fallback).

Release TIMES come from a fixed table of official schedules (e.g. US CPI
08:30 America/New_York), not from ForexFactory's display timezone.

Env: HISTORY_MONTHS (default 36) = how far back to scrape on a fresh build;
once the file exists only the last 2 months are re-scraped. FULL=1 forces
the full backfill again.
"""
import json, os, re, sys, time, urllib.request, urllib.parse
from datetime import datetime, timedelta, timezone, date
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "crypto_bias_history.json")
GRAN = 900  # seconds, 15-minute candles
LOG = []


def log(m):
    print(m)
    LOG.append(m)


# (currency, FF title) -> (key label, local hh, mm, tz)
NY, LDN, BER = "America/New_York", "Europe/London", "Europe/Berlin"
SCHEDULE = {}


def _add(cur, titles, hh, mm, tz):
    for t in titles:
        SCHEDULE[(cur, t)] = (hh, mm, tz)


_add("USD", ["CPI m/m", "CPI y/y", "Core CPI m/m", "Core CPI y/y", "PPI m/m", "Core PPI m/m",
             "Non-Farm Employment Change", "Unemployment Rate", "Average Hourly Earnings m/m",
             "Unemployment Claims", "Retail Sales m/m", "Core Retail Sales m/m", "Advance GDP q/q",
             "Core PCE Price Index m/m"], 8, 30, NY)
_add("USD", ["ADP Non-Farm Employment Change"], 8, 15, NY)
_add("USD", ["ISM Manufacturing PMI", "ISM Services PMI", "JOLTS Job Openings", "CB Consumer Confidence",
             "Prelim UoM Consumer Sentiment"], 10, 0, NY)
_add("USD", ["Federal Funds Rate"], 14, 0, NY)
_add("GBP", ["CPI y/y"], 7, 0, LDN)
_add("GBP", ["Official Bank Rate"], 12, 0, LDN)
_add("EUR", ["CPI Flash Estimate y/y"], 10, 0, BER)
_add("EUR", ["Main Refinancing Rate"], 14, 15, BER)
CUR2C = {"USD": "US", "GBP": "UK", "EUR": "EU"}


def norm(t):
    return re.sub(r"[^a-z0-9]+", "", t.lower())


def parse_num(s):
    if s is None:
        return None
    t = str(s).replace(",", "").replace("%", "").strip()
    m = re.match(r"^(-?\d*\.?\d+)\s*([KMBT]?)$", t, re.I)
    if not m:
        return None
    return float(m.group(1)) * {"K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}.get(m.group(2).upper(), 1)


def classify(actual, forecast):
    a, f = parse_num(actual), parse_num(forecast)
    if a is None or f is None:
        return None
    if abs(a - f) < 1e-9:
        return "I"
    return "A" if a > f else "B"


def release_utc(d_iso, hh, mm, tz):
    y, m, d = map(int, d_iso.split("-"))
    return datetime(y, m, d, hh, mm, tzinfo=ZoneInfo(tz)).astimezone(timezone.utc)


# ----------------------------------------------------------------------------
# ForexFactory month scrape
# ----------------------------------------------------------------------------
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
JS_EXTRACT = """
() => {
  const out = []; let date = '';
  document.querySelectorAll('tr.calendar__row').forEach(tr => {
    const de = tr.querySelector('.calendar__date');
    const dtxt = de ? de.innerText.replace(/\\s+/g, ' ').trim() : '';
    if (dtxt) date = dtxt;
    const cur = tr.querySelector('.calendar__currency'), ev = tr.querySelector('.calendar__event');
    if (!cur || !ev) return;
    const t = s => { const e = tr.querySelector(s); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : ''; };
    out.push({date: date, currency: t('.calendar__currency'), title: t('.calendar__event'),
              actual: t('.calendar__actual'), forecast: t('.calendar__forecast'), previous: t('.calendar__previous')});
  });
  return out;
}
"""


def month_list(n_months):
    today = date.today()
    y, m = today.year, today.month
    out = []
    for _ in range(n_months):
        out.append((y, m))
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return out


def scrape_months(months):
    """Returns list of dicts {d, cur, title, actual, forecast, previous} for tracked events only."""
    rows = []
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log("playwright not installed - skipping ForexFactory scrape")
        return rows
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                                           "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
        page.set_default_timeout(15000)
        for (y, m) in months:
            url = f"https://www.forexfactory.com/calendar?month={MONTHS[m-1]}.{y}"
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(2500)
                for _ in range(12):  # Cloudflare "Just a moment..." interstitial often clears by itself
                    if "just a moment" not in page.title().lower():
                        break
                    page.wait_for_timeout(2500)
                last_h = 0
                for _ in range(30):
                    page.mouse.wheel(0, 2500)
                    page.wait_for_timeout(250)
                    h = page.evaluate("document.body.scrollHeight")
                    if h == last_h:
                        break
                    last_h = h
                raw = page.evaluate(JS_EXTRACT)
            except Exception as e:  # noqa
                log(f"FF {y}-{m:02d}: FAILED {type(e).__name__}: {str(e)[:100]}")
                continue
            kept = 0
            for r in raw:
                spec = SCHEDULE.get((r["currency"], r["title"]))
                if not spec:
                    continue
                dtxt = r["date"]
                try:
                    pd = datetime.strptime(dtxt + " 2000", "%a %b %d %Y")  # year patched below
                except ValueError:
                    try:
                        pd = datetime.strptime(dtxt + " 2000", "%b %d %Y")
                    except ValueError:
                        continue
                yy = y
                if pd.month == 12 and m == 1:
                    yy = y - 1
                elif pd.month == 1 and m == 12:
                    yy = y + 1
                rows.append({"d": f"{yy}-{pd.month:02d}-{pd.day:02d}", "cur": r["currency"], "title": r["title"],
                             "actual": r["actual"], "forecast": r["forecast"], "previous": r["previous"]})
                kept += 1
            log(f"FF {y}-{m:02d}: {len(raw)} rows scraped, {kept} tracked events kept"
                + (f" | title={page.title()!r}" if not raw else ""))
            if not raw:
                try:
                    log("  body snippet: " + page.inner_text("body")[:300].replace("\n", " "))
                except Exception:
                    pass
            time.sleep(2.5)
        browser.close()
    return rows


def rows_from_calendar_json():
    out = []
    try:
        data = json.load(open(os.path.join(ROOT, "calendar_data.json")))
    except Exception:
        return out
    inv = {"US": "USD", "UK": "GBP", "EU": "EUR"}
    for e in data.get("events", []):
        cur = inv.get(e.get("country"))
        if not cur or (cur, e.get("event")) not in SCHEDULE:
            continue
        if e.get("upcoming") or e.get("actual") in (None, "", "—"):
            continue
        out.append({"d": e["dt"], "cur": cur, "title": e["event"], "actual": e["actual"],
                    "forecast": e.get("forecast", ""), "previous": e.get("previous", "")})
    return out


# ----------------------------------------------------------------------------
# Prices
# ----------------------------------------------------------------------------
def http_json(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ttm-terminal/1.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa
            log(f"  GET fail ({i+1}/{tries}) {url[:90]} -> {type(e).__name__}: {str(e)[:70]}")
            time.sleep(1.5 * (i + 1))
    return None


def fetch_candles_coinbase(product, start, end):
    out = {}
    step = timedelta(seconds=GRAN * 299)
    cur = start
    while cur < end:
        nxt = min(cur + step, end)
        url = (f"https://api.exchange.coinbase.com/products/{product}/candles?granularity={GRAN}"
               f"&start={cur.strftime('%Y-%m-%dT%H:%M:%SZ')}&end={nxt.strftime('%Y-%m-%dT%H:%M:%SZ')}")
        data = http_json(url)
        if data is None:
            return None
        for t, lo, hi, op, cl, _v in data:
            out[int(t)] = (op, hi, lo, cl)
        cur = nxt
        time.sleep(0.12)
    return out


def fetch_candles_bitstamp(pair, start, end):
    out = {}
    cur = int(start.timestamp())
    endts = int(end.timestamp())
    while cur < endts:
        url = f"https://www.bitstamp.net/api/v2/ohlc/{pair}/?step={GRAN}&limit=1000&start={cur}"
        data = http_json(url)
        if not data:
            return None
        rows = data.get("data", {}).get("ohlc", [])
        if not rows:
            break
        for r in rows:
            out[int(r["timestamp"])] = (float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]))
        last = int(rows[-1]["timestamp"])
        if last <= cur:
            break
        cur = last + GRAN
        time.sleep(0.2)
    return out


def get_candles(asset, start, end):
    prod, pair = {"btc": ("BTC-USD", "btcusd"), "eth": ("ETH-USD", "ethusd")}[asset]
    c = fetch_candles_coinbase(prod, start, end)
    src = "coinbase"
    if not c:
        log(f"{asset}: coinbase failed, trying bitstamp")
        c = fetch_candles_bitstamp(pair, start, end)
        src = "bitstamp"
    log(f"{asset}: {len(c) if c else 0} candles from {src if c else 'NONE'}")
    return c or {}, src


def reaction(candles, ts):
    """[r15, r1h, r4h, r24h, hi4h, lo4h] in percent, or None if no price at release."""
    c0 = candles.get(ts)
    if not c0:
        return None
    p0 = c0[0]

    def close_at(sec):
        for back in (0, GRAN, 2 * GRAN):
            c = candles.get(ts + sec - GRAN - back)
            if c:
                return c[3]
        return None

    def pct(x):
        return None if x is None else round((x / p0 - 1) * 100, 3)

    hi = [candles[t][1] for t in range(ts, ts + 4 * 3600, GRAN) if t in candles]
    lo = [candles[t][2] for t in range(ts, ts + 4 * 3600, GRAN) if t in candles]
    return [pct(close_at(GRAN)), pct(close_at(3600)), pct(close_at(4 * 3600)),
            pct(close_at(24 * 3600)), pct(max(hi)) if hi else None, pct(min(lo)) if lo else None]


def baseline(candles):
    """Unconditional: share of all rolling windows that were up, and mean |move|."""
    ts = sorted(candles)
    if len(ts) < 2000:
        return None
    out = []
    for sec in (GRAN, 3600, 4 * 3600, 24 * 3600):
        up = n = 0
        tot = 0.0
        for t in ts[::4]:  # hourly grid keeps it fast
            c = candles.get(t + sec - GRAN)
            if not c:
                continue
            r = c[3] / candles[t][0] - 1
            n += 1
            up += r > 0
            tot += abs(r)
        out.append({"up": round(up / n * 100, 1), "abs": round(tot / n * 100, 3)} if n else None)
    return out


# ----------------------------------------------------------------------------
def main():
    log(f"bias history run {datetime.now(timezone.utc).isoformat()}")
    try:
        existing = json.load(open(OUT))
    except Exception:
        existing = {}
    recs = {}
    for r in existing.get("events", []):
        recs[(r["c"], r["t"], r["d"])] = r
    full = os.environ.get("FULL") == "1" or not recs
    n_months = int(os.environ.get("HISTORY_MONTHS", "36")) if full else 2
    log(f"{'FULL backfill' if full else 'incremental'}: scraping {n_months} month(s); {len(recs)} existing records")

    raw = []
    try:
        raw += scrape_months(month_list(n_months))
    except Exception as e:  # noqa
        log(f"scrape failed: {type(e).__name__}: {e}")
    raw += rows_from_calendar_json()

    now = datetime.now(timezone.utc)
    for r in raw:
        if r["actual"] in ("", "—", "-", None):
            continue
        hh, mm, tz = SCHEDULE[(r["cur"], r["title"])]
        rel = release_utc(r["d"], hh, mm, tz)
        if rel > now - timedelta(minutes=30):
            continue
        key = (CUR2C[r["cur"]], r["title"], r["d"])
        old = recs.get(key, {})
        recs[key] = {"c": key[0], "t": r["title"], "d": r["d"], "u": rel.strftime("%Y-%m-%dT%H:%MZ"),
                     "a": r["actual"], "f": r["forecast"], "p": r["previous"],
                     "s": classify(r["actual"], r["forecast"]),
                     "btc": old.get("btc"), "eth": old.get("eth")}
    log(f"{len(recs)} records after merge")

    # which records still need price reactions?
    need = []
    for r in recs.values():
        rel = datetime.strptime(r["u"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
        incomplete = (not r.get("btc")) or r["btc"][3] is None or not r.get("eth")
        if incomplete and rel < now - timedelta(hours=25):
            need.append(rel)
        elif incomplete and rel < now - timedelta(minutes=30):
            need.append(rel)  # partial windows get completed on later runs
    prices_src = existing.get("price_source")
    base = existing.get("baseline")
    if need:
        start = min(need) - timedelta(hours=2)
        end = min(now, max(need) + timedelta(hours=26))
        log(f"fetching prices {start:%Y-%m-%d} -> {end:%Y-%m-%d} for {len(need)} releases")
        cand = {}
        for asset in ("btc", "eth"):
            cand[asset], src = get_candles(asset, start, end)
            if cand[asset]:
                prices_src = src
        if cand["btc"] and (end - start).days > 120:
            base = baseline(cand["btc"]) or base
        for r in recs.values():
            rel = datetime.strptime(r["u"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
            if rel < start + timedelta(hours=1) or rel > end:
                continue
            ts = int(rel.timestamp())
            for asset in ("btc", "eth"):
                if cand[asset]:
                    rx = reaction(cand[asset], ts)
                    if rx and (not r.get(asset) or any(v is not None for v in rx)):
                        r[asset] = rx

    events = sorted((r for r in recs.values() if r.get("btc")), key=lambda r: (r["d"], r["t"]))
    out = {"generated_at": now.replace(microsecond=0).isoformat(), "price_source": prices_src,
           "windows": ["15m", "1h", "4h", "24h"], "baseline": base, "n": len(events),
           "first": events[0]["d"] if events else None, "last": events[-1]["d"] if events else None,
           "events": events}
    if events or not existing:
        with open(OUT, "w") as f:
            json.dump(out, f, separators=(",", ":"))
    log(f"wrote {OUT}: {len(events)} events with price reactions")
    with open(os.path.join(ROOT, "bias_history_debug.txt"), "w") as f:
        f.write("\n".join(LOG) + "\n")


if __name__ == "__main__":
    main()
