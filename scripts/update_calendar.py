#!/usr/bin/env python3
"""
Pulls the current week's economic calendar from the free, no-auth feed that
most retail calendar widgets use (the same underlying data ForexFactory's
public calendar shows), filters it to the currencies TTM's dashboard tracks,
and writes calendar_data.json for the dashboard to fetch at page load.

Note: this feed does not carry "actual" (post-release) values -- only the
schedule, impact rating, forecast and previous. TTM's own historical table
(baked into index.html) is what carries actual results; this script only
keeps the forward-looking "Upcoming" schedule current.
"""
import json
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
        })

    # newest first
    out.sort(key=lambda r: r["dt"])
    return out


def main():
    raw = fetch_feed()
    events = transform(raw)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": FEED_URL,
        "events": events,
    }
    with open("calendar_data.json", "w") as f:
        json.dump(payload, f, indent=2)
    print(f"Wrote {len(events)} events to calendar_data.json")


if __name__ == "__main__":
    main()
