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

FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"

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
            dt = datetime.fromisoformat(iso)
        except ValueError:
            continue
        display_date = dt.strftime("%d %b %Y")

        forecast = e.get("forecast") or "—"
        previous = e.get("previous") or "—"

        out.append({
            "date": display_date,
            "dt": dt.strftime("%Y-%m-%d"),
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
