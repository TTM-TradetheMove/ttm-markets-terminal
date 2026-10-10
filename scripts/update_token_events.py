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

debug_lines = []


def dbg(msg):
    debug_lines.append(msg)
    print(msg)


def write_debug():
    try:
        with open("token_events_debug.txt", "w") as f:
            f.write(f"Run at {datetime.now(timezone.utc).isoformat()}\n\n")
            f.write("\n".join(debug_lines))
    except Exception:
        pass


def parse_date(date_str):
    """'Oct 11, 2026' -> datetime"""
    return datetime.strptime(date_str.strip(), "%b %d, %Y").replace(tzinfo=timezone.utc)


def scrape():
    events = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            user_agent="Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0; "
                       "+https://ttm-tradethemove.github.io/ttm-markets-terminal/)"
        )
        page.set_default_timeout(10000)
        try:
            # networkidle can hang indefinitely on SPAs with live polling --
            # use domcontentloaded + an explicit wait instead, same fix as
            # the calendar scraper needed.
            page.goto(SOURCE_URL, wait_until="domcontentloaded", timeout=30000)
        except Exception as exc:
            dbg(f"page.goto error (continuing): {exc}")
        page.wait_for_timeout(2500)

        dbg(f"page title: {page.title()!r}")
        dbg(f"page url after load: {page.url!r}")

        try:
            page.wait_for_selector("table tbody tr", timeout=15000)
        except Exception as exc:
            dbg(f"wait_for_selector('table tbody tr') failed: {exc}")

        rows = page.query_selector_all("table tbody tr")
        dbg(f"rows found: {len(rows)}")

        if not rows:
            body_text = page.inner_text("body")[:1500]
            dbg(f"no rows found -- body text snippet:\n{body_text}")

        sample_logged = 0
        skipped = 0
        for row in rows:
            try:
                cells = row.query_selector_all("td")
                if sample_logged < 5:
                    dbg(f"sample row: cells={len(cells)} raw_text={row.inner_text()[:120]!r}")
                    sample_logged += 1
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
            except Exception as row_exc:
                skipped += 1
                if skipped <= 5:
                    dbg(f"row error (skipped): {row_exc}")
                continue

        if skipped:
            dbg(f"total rows skipped due to errors: {skipped}")

        browser.close()

    events.sort(key=lambda e: e["dt"])
    return events


def main():
    try:
        events = scrape()
    except Exception as exc:
        dbg(f"scrape() failed entirely: {exc}")
        write_debug()
        raise SystemExit(f"Scrape failed -- not overwriting token_events_data.json. See token_events_debug.txt: {exc}")

    dbg(f"Scraped {len(events)} events")
    write_debug()

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
