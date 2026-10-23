#!/usr/bin/env python3
"""
Builds calendar_data.json for the dashboard.

Two sources are combined:
1. The free ForexFactory-mirror JSON feed (nfs.faireconomy.media) -- gives
   the full week's schedule, impact rating, forecast and previous reliably,
   but NEVER carries "actual" (post-release) values.
2. A live render of forexfactory.com/calendar itself (via headless Chromium)
   -- carries real "Actual" values once an event has released. This is
   merged onto the feed events by matching (date, currency, event title).

If the live scrape fails for any reason (site structure change, blocked,
etc.) we fail soft: the feed-only schedule is still written so the dashboard
never goes stale, just without fresh Actuals until the next successful run.
"""
import json
import re
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
NEXT_FEED_URL = "https://nfs.faireconomy.media/ff_calendar_nextweek.json"
MELBOURNE = ZoneInfo("Australia/Melbourne")
NEW_YORK = ZoneInfo("America/New_York")
LONDON = ZoneInfo("Europe/London")
FRANKFURT = ZoneInfo("Europe/Berlin")  # ECB/Frankfurt -- most relevant EU financial-time zone

CURRENCY_TO_COUNTRY = {
    "USD": "US",
    "GBP": "UK",
    "EUR": "EU",
    "JPY": "JP",
}

IMPACT_MAP = {
    "Low": "low",
    "Medium": "medium",
    "High": "high",
}


def fetch_feed():
    req = urllib.request.Request(FEED_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_next_feed():
    """Next week's schedule from the same mirror. Best effort: a miss never blocks the run."""
    try:
        req = urllib.request.Request(NEXT_FEED_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        print(f"next-week feed: {len(data)} events")
        return data
    except Exception as exc:
        print(f"next-week feed unavailable ({exc}) -- continuing without it")
        return []


FC_BASE = "https://www.financecalendar.com/wp-json/fc/v1/calendar"
FC_COUNTRY_TO_CUR = {"US": "USD", "GB": "GBP", "EU": "EUR", "JP": "JPY"}
FC_CATEGORIES = {"economic-indicators", "central-banks-monetary-policy"}


def fetch_month_ahead(after_ts, dbg):
    """Free fallback for the weeks ForexFactory's site won't serve us (it sits behind a Cloudflare check):
    financecalendar.com's open API (no key, attribution required). Returns raw events in feed format that are
    LATER than anything we already have, so it only fills the gap and never duplicates the other sources."""
    now = datetime.now(timezone.utc)
    frm, to = now.strftime("%Y-%m-%d"), (now + timedelta(days=75)).strftime("%Y-%m-%d")
    out, offset, seen = [], 0, 0
    try:
        while offset < 2000:
            url = f"{FC_BASE}?from={frm}&to={to}&country={','.join(FC_COUNTRY_TO_CUR)}&limit=500&offset={offset}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=40) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            evs = data.get("events", [])
            seen += len(evs)
            for e in evs:
                cur = FC_COUNTRY_TO_CUR.get(e.get("country"))
                when = e.get("release_at_utc")
                if not cur or not when or e.get("category") not in FC_CATEGORIES or e.get("status") in ("cancelled",):
                    continue
                try:
                    ts = datetime.fromisoformat(when.replace("Z", "+00:00")).timestamp()
                except ValueError:
                    continue
                if ts <= after_ts:
                    continue
                impact = {"high": "High", "medium": "Medium", "low": "Low"}.get((e.get("impact") or "").lower()) \
                    or ("High" if e.get("category") == "central-banks-monetary-policy" else "Medium")
                unit = e.get("unit") or ""
                fmtv = lambda v: "" if v in (None, "") else (f"{v}{unit}" if unit in ("%", "K", "M", "B") and not str(v).endswith(unit) else str(v))
                out.append({"title": (e.get("name") or e.get("title") or "").strip(), "country": cur, "date": datetime.fromtimestamp(ts, timezone.utc).isoformat(),
                            "impact": impact, "forecast": fmtv(e.get("consensus")), "previous": fmtv(e.get("prior"))})
            if len(evs) < 500 or offset + len(evs) >= int(data.get("total") or 0):
                break
            offset += len(evs)
        dbg(f"month-ahead fallback (financecalendar.com): {seen} rows read, {len(out)} events after {datetime.fromtimestamp(after_ts, timezone.utc).date()} added")
    except Exception as exc:
        dbg(f"month-ahead fallback failed: {type(exc).__name__}: {exc}")
    return out


FF_ZONES = ["America/New_York", "America/Chicago", "UTC", "Europe/London", "America/Los_Angeles", "Australia/Sydney", "Australia/Melbourne", "Europe/Berlin"]
IMPACT_CLASS = {"impact-red": "High", "impact-ora": "Medium", "impact-yel": "Low"}
ROWS_JS = """() => { const out = []; let date = '', time = '';
  document.querySelectorAll('tr.calendar__row').forEach(r => {
    const t = s => { const e = r.querySelector(s); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : ''; };
    const d = t('.calendar__date'); if (d && d !== date) { date = d; time = ''; }
    const tm = t('.calendar__time'); if (tm) time = tm;
    const imp = r.querySelector('.calendar__impact span'); 
    out.push({date, time, cur: t('.calendar__currency'), impact: imp ? imp.className : '', title: t('.calendar__event'),
              actual: t('.calendar__actual'), forecast: t('.calendar__forecast'), previous: t('.calendar__previous')});
  });
  return out; }"""


def _parse_time(txt):
    txt = (txt or "").strip().lower()
    for fmt in ("%I:%M%p", "%I%p"):
        try:
            t = datetime.strptime(txt, fmt)
            return t.hour, t.minute
        except ValueError:
            pass
    return None  # All Day / Tentative / blank


def _local_ts(date_str, year, tm, tzname):
    """'Sun Oct 18' + year + (h, m) in zone -> UTC epoch."""
    try:
        d = datetime.strptime(" ".join(date_str.split()[-2:]) + f" {year}", "%b %d %Y")
    except ValueError:
        return None
    h, m = tm if tm else (0, 0)
    return int(datetime(d.year, d.month, d.day, h, m, tzinfo=ZoneInfo(tzname)).timestamp())


def scrape_months(known_events, month_params, dbg):
    """Scrape forexfactory.com/calendar?month=... for the weeks the JSON feeds don't cover.
    The page's timezone is not fixed (it follows the runner), so we calibrate it: try candidate zones
    and keep the one under which the scraped times line up with feed events whose UTC time we know.
    Returns (raw_events in feed format, actuals {(ny_date, cur, norm): actual})."""
    raw_out, act_out = [], {}
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        dbg("month scrape: Playwright missing")
        return raw_out, act_out
    known = {}
    for e in known_events:
        if e.get("ts"):
            known.setdefault((e["_currency"], e["_title_norm"]), []).append(e["ts"])
    have = {(e["_currency"], e["_title_norm"], e["ts"] // 3600) for e in known_events if e.get("ts")}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--disable-blink-features=AutomationControlled"])
            ctx = browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                                      locale="en-US", viewport={"width": 1366, "height": 900}, timezone_id="America/New_York")
            ctx.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")
            page = ctx.new_page()
            page.set_default_timeout(10000)
            def load_rows(url, what, attempt=0):
                """Open one forexfactory calendar url, scroll to load lazy rows, return its rows (and log what the page looked like)."""
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                # ForexFactory sits behind a Cloudflare check ("Just a moment..."): give it time to clear before reading
                for _ in range(30):
                    try:
                        cleared = "just a moment" not in (page.title() or "").lower() and page.locator("tr.calendar__row").count() > 0
                    except Exception:
                        cleared = False
                    if cleared:
                        break
                    page.wait_for_timeout(1000)
                page.wait_for_timeout(2000)
                for _ in range(16):
                    page.mouse.wheel(0, 1500)
                    page.wait_for_timeout(250)
                got = page.evaluate(ROWS_JS)
                tracked = sum(1 for r in got if r["cur"] in CURRENCY_TO_COUNTRY and r["title"])
                if not tracked and attempt < 2:
                    dbg(f"{what}: blocked or empty (title={page.title()!r}), retrying after a pause")
                    page.wait_for_timeout(12000)
                    return load_rows(url, what, attempt + 1)
                dbg(f"{what}: title={page.title()!r} url={page.url!r} rows={len(got)} tracked={tracked}")
                if not tracked:
                    dbg(f"{what}: first rows: {[(r['date'], r['time'], r['cur'], r['title']) for r in got[:4]]}")
                return got

            page_zone = None
            for label, year in month_params:
                try:
                    rows = load_rows(f"https://www.forexfactory.com/calendar?month={label}", f"month {label}")
                    if sum(1 for r in rows if r["cur"] in CURRENCY_TO_COUNTRY and r["title"]) < 3:
                        # the month view came back (nearly) empty -> read the same weeks one by one instead
                        mon, yr = label.split(".")
                        first = datetime.strptime(f"{mon} 1 {yr}", "%b %d %Y")
                        sunday = first - timedelta(days=(first.weekday() + 1) % 7)
                        nxt_first = (first + timedelta(days=32)).replace(day=1)
                        rows = []
                        while sunday < nxt_first:
                            wl = f"{sunday.strftime('%b').lower()}{sunday.day}.{sunday.year}"
                            try:
                                rows += load_rows(f"https://www.forexfactory.com/calendar?week={wl}", f"week {wl}")
                            except Exception as exc2:
                                dbg(f"week {wl}: load failed ({exc2})")
                            sunday += timedelta(days=7)
                except Exception as exc:
                    dbg(f"month {label}: load failed ({exc})")
                    continue
                rows = [r for r in rows if r["cur"] in CURRENCY_TO_COUNTRY and r["title"]]
                dbg(f"month {label}: {len(rows)} rows for tracked currencies; sample: {rows[:2]}")
                if not rows:
                    continue
                # calibrate the page timezone
                best, best_n = None, 0
                for z in FF_ZONES:
                    n = 0
                    for r in rows:
                        tm = _parse_time(r["time"])
                        if not tm:
                            continue
                        ts = _local_ts(r["date"], year, tm, z)
                        for k in known.get((r["cur"], _norm(r["title"])), []):
                            if ts and abs(ts - k) < 120:
                                n += 1
                                break
                    if n > best_n:
                        best, best_n = z, n
                dbg(f"month {label}: page timezone calibrated to {best} ({best_n} matching rows)")
                if best_n >= 3:
                    page_zone = best
                elif page_zone:
                    # later months have no feed events to match against, but the page timezone is the same
                    best, best_n = page_zone, 3
                    dbg(f"month {label}: using the timezone calibrated earlier ({page_zone})")
                if best_n < 3:
                    dbg(f"month {label}: not enough matches to trust times -- skipping")
                    continue
                added = 0
                for r in rows:
                    impact = next((v for k, v in IMPACT_CLASS.items() if k in r["impact"]), None)
                    if not impact:
                        continue
                    tm = _parse_time(r["time"])
                    ts = _local_ts(r["date"], year, tm, best)
                    if not ts:
                        continue
                    key = (r["cur"], _norm(r["title"]), ts // 3600)
                    if key in have:
                        continue
                    have.add(key)
                    iso = datetime.fromtimestamp(ts, timezone.utc).isoformat()
                    raw_out.append({"title": r["title"], "country": r["cur"], "date": iso, "impact": impact,
                                    "forecast": r["forecast"], "previous": r["previous"]})
                    if r["actual"] and r["actual"] != "—":
                        ny = datetime.fromtimestamp(ts, timezone.utc).astimezone(NEW_YORK).strftime("%Y-%m-%d")
                        act_out[(ny, r["cur"], _norm(r["title"]))] = r["actual"]
                    added += 1
                dbg(f"month {label}: added {added} events not already in the weekly feeds")
            browser.close()
    except Exception as exc:
        dbg(f"month scrape failed: {exc}")
    return raw_out, act_out


def transform(raw_events):
    out = []
    for e in raw_events:
        country = CURRENCY_TO_COUNTRY.get(e.get("country"))
        impact = IMPACT_MAP.get(e.get("impact"))
        if not country or not impact:
            continue  # skip currencies we don't track and Holiday/non-data entries

        iso = e.get("date", "")
        try:
            dt_source = datetime.fromisoformat(iso)
        except ValueError:
            continue

        # Convert to Melbourne time -- this also decides the *displayed* date,
        # since an event late in the US day can already be "tomorrow" in Melbourne.
        dt_melb = dt_source.astimezone(MELBOURNE)
        display_date = dt_melb.strftime("%d %b %Y")

        def fmt(dt_zoned):
            return dt_zoned.strftime("%I:%M%p").lstrip("0").lower() + " " + dt_zoned.tzname()

        dt_ny = dt_source.astimezone(NEW_YORK)
        dt_ldn = dt_source.astimezone(LONDON)
        dt_eu = dt_source.astimezone(FRANKFURT)
        display_time = (
            f"MEL {fmt(dt_melb)} · NY {fmt(dt_ny)} · "
            f"LDN {fmt(dt_ldn)} · EU {fmt(dt_eu)}"
        )

        forecast = e.get("forecast") or "—"
        previous = e.get("previous") or "—"

        out.append({
            "date": display_date,
            "dt": dt_melb.strftime("%Y-%m-%d"),
            "time": display_time,
            "country": country,
            "event": e.get("title", "").strip(),
            "impact": impact,
            "actual": "—",
            "forecast": forecast,
            "previous": previous,
            "miss": False,
            "bias": "neutral",
            "upcoming": True,
            "ts": int(dt_source.timestamp()),
            # match keys used to merge in live "actual" values, not rendered
            "_ny_date": dt_ny.strftime("%Y-%m-%d"),
            "_currency": e.get("country"),
            "_title_norm": _norm(e.get("title", "")),
        })

    out.sort(key=lambda r: r["dt"])
    return out


def _norm(title):
    return re.sub(r"[^a-z0-9]+", "", title.lower())


def compute_miss(actual, forecast):
    """
    Numeric compare against forecast, used only to redden the Actual cell
    when a print misses -- NOT the dashboard's "Crypto Bias" column. That
    column is TTM's own editorial read of how a print is typically digested
    by risk assets (e.g. a weak jobs print can be "bullish" for risk via
    looser Fed expectations), which a blind beat/miss-vs-forecast compare
    cannot responsibly infer. So scraped live rows always get bias
    "neutral" here; only TTM's curated historical rows carry up/down.
    """
    def to_num(s):
        if not s or s in ("—", "-"):
            return None
        m = re.match(r"^-?[\d.]+", s.replace(",", ""))
        return float(m.group(0)) if m else None

    a, f = to_num(actual), to_num(forecast)
    if a is None or f is None:
        return False
    return a < f


def scrape_actuals():
    """
    Render forexfactory.com/calendar with headless Chromium and pull out
    (NY date, currency, normalized title) -> actual value.
    Returns {} on any failure rather than raising, so the main feed-based
    schedule is never blocked by this best-effort enrichment step.

    Always writes ff_scrape_debug.txt with what it found/tried, since this
    runs unattended in CI and the only way to diagnose a silent miss is to
    commit a breadcrumb trail alongside calendar_data.json.
    """
    results = {}
    debug_lines = []

    def dbg(msg):
        debug_lines.append(msg)
        print(msg)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        dbg("Playwright not installed -- skipping live actuals scrape")
        _write_debug(debug_lines)
        return results

    # Candidate selector sets to try, in order -- forexfactory's markup has
    # changed class naming schemes before (BEM-ish calendar__x historically,
    # but we can't be sure which is live right now), so we probe a few.
    # Deliberately NOT falling back to a bare "table tbody tr": the real page
    # has other tables (nav/sidebar/forum excerpts) and matching those could
    # mean walking hundreds of irrelevant rows, each a slow round-trip call.
    ROW_SELECTORS = ["tr.calendar__row", "tr[data-event-id]", "table.calendar__table tbody tr"]
    MAX_ROWS = 600  # hard cap so a wrong/broad selector can never cause a runaway scrape
    CELL_SELECTORS = {
        "date":     [".calendar__date", "td.date", "[class*='date']"],
        "time":     [".calendar__time", "td.time", "[class*='time']"],
        "currency": [".calendar__currency", "td.currency", "[class*='currency']"],
        "event":    [".calendar__event", "td.event", "[class*='event']"],
        "actual":   [".calendar__actual", "td.actual", "[class*='actual']"],
    }

    def first_match(row, selectors):
        for sel in selectors:
            el = row.query_selector(sel)
            if el:
                return el
        return None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--disable-blink-features=AutomationControlled"])
            page = browser.new_page(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                           "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
            )
            page.set_default_timeout(8000)  # bound every call -- never let one hung row stall the whole run
            try:
                # networkidle never fires on this page (it has live-ticking
                # widgets that poll continuously), so it was just burning the
                # full 60s timeout every run for nothing -- domcontentloaded
                # is what we actually need, then we wait + scroll ourselves.
                page.goto("https://www.forexfactory.com/calendar", wait_until="domcontentloaded", timeout=30000)
            except Exception as exc:
                dbg(f"page.goto error (continuing): {exc}")
            page.wait_for_timeout(2500)

            # Some of the "Actual" cells appear to hydrate lazily as rows
            # scroll into view (common for calendar widgets that paint the
            # colored actual/forecast comparison via JS after initial render).
            # Scroll the whole table into view in steps so every row gets a
            # chance to hydrate before we read it back out.
            try:
                for _ in range(10):
                    page.mouse.wheel(0, 1200)
                    page.wait_for_timeout(350)
                page.wait_for_timeout(1500)
            except Exception as exc:
                dbg(f"scroll-through error (continuing): {exc}")

            dbg(f"page title: {page.title()!r}")
            dbg(f"page url after load: {page.url!r}")

            rows = []
            used_row_selector = None
            for sel in ROW_SELECTORS:
                rows = page.query_selector_all(sel)
                if rows:
                    used_row_selector = sel
                    break
            dbg(f"row selector used: {used_row_selector!r}, rows found: {len(rows)}")
            if len(rows) > MAX_ROWS:
                dbg(f"capping to first {MAX_ROWS} rows (found {len(rows)})")
                rows = rows[:MAX_ROWS]

            if not rows:
                # Dump a text snippet so we can see what's actually on the page
                # (bot-block page, cookie wall, different markup, etc.)
                body_text = page.inner_text("body")[:1500]
                dbg(f"no rows found -- body text snippet:\n{body_text}")

            current_date = None
            sample_logged = 0
            skipped_errors = 0
            for row in rows:
                try:
                    date_el = first_match(row, CELL_SELECTORS["date"])
                    if date_el:
                        # The date cell renders as two lines ("Sun" / "Oct 4"),
                        # so inner_text() comes back "Sun\nOct 4" -- collapse
                        # all whitespace/newlines to single spaces so it parses.
                        date_text = " ".join(date_el.inner_text().split())
                        if date_text:
                            current_date = date_text

                    currency_el = first_match(row, CELL_SELECTORS["currency"])
                    event_el = first_match(row, CELL_SELECTORS["event"])
                    actual_el = first_match(row, CELL_SELECTORS["actual"])

                    if sample_logged < 5:
                        dbg(f"sample row: date_el={bool(date_el)} currency_el={bool(currency_el)} "
                            f"event_el={bool(event_el)} actual_el={bool(actual_el)} "
                            f"raw_text={row.inner_text()[:120]!r}")
                        sample_logged += 1

                    if not (currency_el and event_el and actual_el):
                        continue

                    currency = currency_el.inner_text().strip()
                    title = event_el.inner_text().strip()
                    actual = actual_el.inner_text().strip()

                    if "unemployment" in title.lower() or "consumer sentiment" in title.lower():
                        dbg(f"TARGET ROW: date={current_date!r} currency={currency!r} title={title!r} actual={actual!r}")

                    if not currency or not title or not actual or actual == "—":
                        continue
                    if not current_date:
                        continue

                    try:
                        year = datetime.now(timezone.utc).year
                        # current_date is now whitespace-normalized, e.g. "Sun Oct 4"
                        parsed = datetime.strptime(f"{current_date} {year}", "%a %b %d %Y")
                    except ValueError:
                        try:
                            parsed = datetime.strptime(f"{current_date} {year}", "%b %d %Y")
                        except ValueError:
                            if skipped_errors <= 5:
                                dbg(f"date parse failed for current_date={current_date!r}")
                            continue

                    key = (parsed.strftime("%Y-%m-%d"), currency, _norm(title))
                    results[key] = actual
                except Exception as row_exc:
                    # One malformed/hung row (detached element, nav away mid-loop,
                    # etc.) must never take down the whole scrape.
                    skipped_errors += 1
                    if skipped_errors <= 5:
                        dbg(f"row error (skipped): {row_exc}")
                    continue

            if skipped_errors:
                dbg(f"total rows skipped due to errors: {skipped_errors}")

            by_date = {}
            for (d, _, _) in results:
                by_date[d] = by_date.get(d, 0) + 1
            dbg(f"matched-actuals by date: {dict(sorted(by_date.items()))}")

            browser.close()
    except Exception as exc:
        dbg(f"Live actuals scrape failed (continuing with feed-only data): {exc}")
        _write_debug(debug_lines)
        return {}

    dbg(f"Scraped {len(results)} live actual values from forexfactory.com")
    _write_debug(debug_lines)
    return results


def _write_debug(lines):
    try:
        with open("ff_scrape_debug.txt", "w") as f:
            f.write(f"Run at {datetime.now(timezone.utc).isoformat()}\n\n")
            f.write("\n".join(lines))
    except Exception:
        pass


def merge_actuals(events, actuals):
    if not actuals:
        return events
    matched = 0
    for e in events:
        key = (e["_ny_date"], e["_currency"], e["_title_norm"])
        if key not in actuals:
            # FF's page date can differ from our NY date by a day (timezone of the scrape): try the neighbours
            try:
                base = datetime.strptime(e["_ny_date"], "%Y-%m-%d")
                for off in (-1, 1):
                    k2 = ((base + timedelta(days=off)).strftime("%Y-%m-%d"), e["_currency"], e["_title_norm"])
                    if k2 in actuals:
                        key = k2
                        break
            except ValueError:
                pass
        if key in actuals:
            e["actual"] = actuals[key]
            e["miss"] = compute_miss(e["actual"], e["forecast"])
            e["bias"] = "neutral"  # see compute_miss() docstring
            e["upcoming"] = False
            matched += 1
    print(f"Matched {matched} actual values onto scheduled events")
    nowts = datetime.now(timezone.utc).timestamp()
    miss = [f'{e["_ny_date"]} {e["_currency"]} {e["event"]}' for e in events
            if e.get("upcoming") and e.get("ts") and e["ts"] < nowts - 7200 and "speak" not in e["event"].lower()]
    if miss:
        print("Past events still without an actual (" + str(len(miss)) + "): " + "; ".join(miss[:25]))
        print("Scraped keys for GBP/GDP-like titles: " + str([k for k in actuals if k[1] == "GBP"][:30]))
        try:
            with open("ff_scrape_debug.txt", "a") as f:
                f.write("\nPast events without actual (" + str(len(miss)) + "): " + "; ".join(miss[:25]) + "\n")
                f.write("Scraped GBP keys: " + str([k for k in actuals if k[1] == "GBP"][:30]) + "\n")
        except Exception:
            pass
    return events


def main():
    raw = fetch_feed()
    raw_next = fetch_next_feed()
    events = transform(raw + raw_next)
    now = datetime.now(timezone.utc)

    # Months to look at beyond the weekly feeds: this month and next month.
    def mp(dt):
        return (dt.strftime("%b").lower() + "." + dt.strftime("%Y"), dt.year)
    nxt = (now.replace(day=1) + timedelta(days=32)).replace(day=1)
    month_params = [mp(now), mp(nxt)]
    mdebug = []
    mdebug_fn = lambda m: (mdebug.append(m), print(m))
    month_raw, month_actuals = [], {}
    # The month pages change slowly and this job runs every minute: scrape them at most every 30 minutes
    # and carry the previous result forward in between.
    try:
        prev = json.load(open("calendar_data.json"))
    except Exception:
        prev = {}
    scraped_at = prev.get("months_scraped_at")
    fresh = False
    try:
        fresh = scraped_at and (now - datetime.fromisoformat(scraped_at)).total_seconds() < 1800
    except Exception:
        pass
    new_scraped_at = scraped_at
    if fresh:
        have_k = {(e["dt"], e["country"], e["event"]) for e in events}
        carried = [e for e in prev.get("events", []) if e.get("ts") and e["ts"] > now.timestamp()
                   and (e["dt"], e["country"], e["event"]) not in have_k]
        for e in carried:  # restore the internal match keys that are stripped before writing
            e["_ny_date"] = datetime.fromtimestamp(e["ts"], timezone.utc).astimezone(NEW_YORK).strftime("%Y-%m-%d")
            e["_currency"] = {v: k for k, v in CURRENCY_TO_COUNTRY.items()}.get(e["country"])
            e["_title_norm"] = _norm(e["event"])
        events += carried
        print(f"month scrape skipped (last run {scraped_at}); carried {len(carried)} later events")
    else:
        try:
            month_raw, month_actuals = scrape_months(events, month_params, mdebug_fn)
            events += transform(month_raw)
            if month_raw:
                new_scraped_at = now.isoformat()
        except Exception as exc:
            print(f"month scrape step failed: {exc}")
            mdebug.append(f"month scrape step failed: {exc}")

    # Fill whatever the feeds and the ForexFactory pages did not cover (normally: the month ahead)
    try:
        after = max([e["ts"] for e in events if e.get("ts")] or [now.timestamp()])
        extra = fetch_month_ahead(after, mdebug_fn)
        if extra:
            events += transform(extra)
    except Exception as exc:
        mdebug.append(f"month-ahead fallback step failed: {exc}")

    actuals = {}
    try:
        actuals = scrape_actuals()
        actuals = {**month_actuals, **actuals}
        events = merge_actuals(events, actuals)
    except Exception as exc:
        print(f"Unexpected error during live-actuals step (writing feed-only data instead): {exc}")
        try:
            _write_debug([f"Unexpected top-level error: {exc}"])
        except Exception:
            pass
    try:
        with open("ff_scrape_debug.txt", "a") as f:
            f.write("\n-- month scrape --\n" + "\n".join(mdebug) + "\n")
    except Exception:
        pass

    # strip internal match-key fields before writing
    for e in events:
        e.pop("_ny_date", None)
        e.pop("_currency", None)
        e.pop("_title_norm", None)

    # keep recent history: events that rolled out of the weekly feed stay in the file for 75 days
    try:
        old = json.load(open("calendar_data.json")).get("events", [])
        have = {(e["dt"], e["country"], e["event"]) for e in events}
        cutoff = now.timestamp() - 75 * 86400
        kept = [e for e in old if e.get("ts") and cutoff < e["ts"] < now.timestamp() - 3600
                and (e["dt"], e["country"], e["event"]) not in have]
        events = kept + events
        print(f"kept {len(kept)} earlier events for history")
    except Exception as exc:
        print(f"no previous calendar file to carry history from ({exc})")
    events.sort(key=lambda e: (e.get("ts") or 0))

    payload = {
        "generated_at": now.isoformat(),
        "source": FEED_URL,
        "live_actuals_source": "https://www.forexfactory.com/calendar" if actuals else None,
        "months_scraped_at": new_scraped_at,
        "month_ahead_source": "https://www.financecalendar.com",
        "events": events,
    }
    with open("calendar_data.json", "w") as f:
        json.dump(payload, f, indent=2)
    print(f"Wrote {len(events)} events to calendar_data.json")


if __name__ == "__main__":
    main()
