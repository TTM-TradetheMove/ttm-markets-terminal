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
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
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
            browser = p.chromium.launch()
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
        if key in actuals:
            e["actual"] = actuals[key]
            e["miss"] = compute_miss(e["actual"], e["forecast"])
            e["bias"] = "neutral"  # see compute_miss() docstring
            e["upcoming"] = False
            matched += 1
    print(f"Matched {matched} actual values onto scheduled events")
    return events


def main():
    raw = fetch_feed()
    events = transform(raw)

    # scrape_actuals() already catches everything internally, but this is a
    # second, final safety net: whatever happens in the live-scrape/merge
    # step, the feed-based schedule above must still get written out. A
    # crash here must never turn into a stale/no-op dashboard update.
    try:
        actuals = scrape_actuals()
        events = merge_actuals(events, actuals)
    except Exception as exc:
        print(f"Unexpected error during live-actuals step (writing feed-only data instead): {exc}")
        try:
            _write_debug([f"Unexpected top-level error: {exc}"])
        except Exception:
            pass

    # strip internal match-key fields before writing
    for e in events:
        e.pop("_ny_date", None)
        e.pop("_currency", None)
        e.pop("_title_norm", None)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": FEED_URL,
        "live_actuals_source": "https://www.forexfactory.com/calendar" if actuals else None,
        "events": events,
    }
    with open("calendar_data.json", "w") as f:
        json.dump(payload, f, indent=2)
    print(f"Wrote {len(events)} events to calendar_data.json")


if __name__ == "__main__":
    main()
