#!/usr/bin/env python3
"""
Scrapes the "Upcoming Events" table at cryptotldr.io/events (token unlocks,
listings, airdrops, major events) and writes token_events_data.json for the
dashboard to fetch at page load.

cryptotldr.io's robots.txt explicitly allows crawling "/" (Disallow only
covers /admin, /auth, /api), so this path is fair game. The page is a
client-rendered app, so this uses a headless browser rather than a plain
HTTP fetch.
"""
import json
import re
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright

SOURCE_URL = "https://cryptotldr.io/events"

TYPE_MAP = {
    "Unlock": "unlock",
    "Listing": "listing",
    "Airdrop": "airdrop",
    "Major": "major",
}


def parse_date(date_str):
    """'Oct 11, 2026' -> datetime"""
    return datetime.strptime(date_str.strip(), "%b %d, %Y").replace(tzinfo=timezone.utc)


def scrape():
    events = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(user_agent="Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0; +https://ttm-tradethemove.github.io/ttm-markets-terminal/)")
        page.goto(SOURCE_URL, wait_until="networkidle", timeout=60000)
        page.wait_for_selector("table tbody tr", timeout=20000)

        rows = page.query_selector_all("table tbody tr")
        for row in rows:
            cells = row.query_selector_all("td")
            if len(cells) < 5:
                continue
            date_text = cells[0].inner_text().strip()
            type_text = cells[1].inner_text().strip()
            token_text = cells[2].inner_text().strip()
            name_el = cells[3].query_selector("a")
            name_text = (name_el.inner_text() if name_el else cells[3].inner_text()).strip()
            link = name_el.get_attribute("href") if name_el else None

            try:
                dt = parse_date(date_text)
            except ValueError:
                continue

            events.append({
                "date": dt.strftime("%d %b %Y"),
                "dt": dt.strftime("%Y-%m-%d"),
                "type": TYPE_MAP.get(type_text, "other"),
                "type_label": type_text,
                "token": token_text,
                "name": name_text,
                "link": link,
            })

        browser.close()

    events.sort(key=lambda e: e["dt"])
    return events


def main():
    events = scrape()
    if not events:
        # Don't overwrite good data with an empty result if the site's
        # structure changed and nothing was found -- fail loudly instead.
        raise SystemExit("No events scraped -- site structure may have changed. Not overwriting token_events_data.json.")

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": SOURCE_URL,
        "events": events,
    }
    with open("token_events_data.json", "w") as f:
        json.dump(payload, f, indent=2)
    print(f"Wrote {len(events)} events to token_events_data.json")


if __name__ == "__main__":
    main()
