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


def compute_bias(actual, forecast):
    """Best-effort numeric compare to flag beat/miss for styling."""
    def to_num(s):
        if not s or s in ("—", "-"):
            return None
        m = re.match(r"^-?[\d.]+", s.replace(",", ""))
        return float(m.group(0)) if m else None

    a, f = to_num(actual), to_num(forecast)
    if a is None or f is None:
        return "neutral", False
    if a > f:
        return "beat", False
    if a < f:
        return "miss", True
    return "neutral", False


def scrape_actuals():
    """
    Render forexfactory.com/calendar with headless Chromium and pull out
    (NY date, currency, normalized title) -> actual value.
    Returns {} on any failure rather than raising, so the main feed-based
    schedule is never blocked by this best-effort enrichment step.
    """
    results = {}
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Playwright not installed -- skipping live actuals scrape")
        return results

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                           "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
            )
            page.goto("https://www.forexfactory.com/calendar", wait_until="networkidle", timeout=60000)
            page.wait_for_selector("tr.calendar__row", timeout=20000)

            rows = page.query_selector_all("tr.calendar__row")
            current_date = None
            current_time = None
            for row in rows:
                date_el = row.query_selector(".calendar__date")
                if date_el:
                    date_text = date_el.inner_text().strip()
                    if date_text:
                        current_date = date_text

                time_el = row.query_selector(".calendar__time")
                if time_el:
                    time_text = time_el.inner_text().strip()
                    if time_text:
                        current_time = time_text

                currency_el = row.query_selector(".calendar__currency")
                event_el = row.query_selector(".calendar__event")
                actual_el = row.query_selector(".calendar__actual")
                if not (currency_el and event_el and actual_el):
                    continue

                currency = currency_el.inner_text().strip()
                title = event_el.inner_text().strip()
                actual = actual_el.inner_text().strip()
                if not currency or not title or not actual or actual == "—":
                    continue
                if not current_date:
                    continue

                try:
                    year = datetime.now(timezone.utc).year
                    parsed = datetime.strptime(f"{current_date} {year}", "%a%b %d %Y")
                except ValueError:
                    try:
                        parsed = datetime.strptime(f"{current_date} {year}", "%b %d %Y")
                    except ValueError:
                        continue

                key = (parsed.strftime("%Y-%m-%d"), currency, _norm(title))
                results[key] = actual

            browser.close()
    except Exception as exc:
        print(f"Live actuals scrape failed (continuing with feed-only data): {exc}")
        return {}

    print(f"Scraped {len(results)} live actual values from forexfactory.com")
    return results


def merge_actuals(events, actuals):
    if not actuals:
        return events
    matched = 0
    for e in events:
        key = (e["_ny_date"], e["_currency"], e["_title_norm"])
        if key in actuals:
            e["actual"] = actuals[key]
            bias, miss = compute_bias(e["actual"], e["forecast"])
            e["bias"] = bias
            e["miss"] = miss
            e["upcoming"] = False
            matched += 1
    print(f"Matched {matched} actual values onto scheduled events")
    return events


def main():
    raw = fetch_feed()
    events = transform(raw)

    actuals = scrape_actuals()
    events = merge_actuals(events, actuals)

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
