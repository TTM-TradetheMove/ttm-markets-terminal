#!/usr/bin/env python3
"""
Pulls the Crypto Fear & Greed Index from alternative.me's free, no-auth API
and writes fear_greed_data.json for the dashboard to fetch at page load.

alternative.me/crypto/fear-and-greed-index/ explicitly documents this
endpoint as free to use. We pull a short recent history (7 days) so the
widget can also show a tiny trend, not just today's single number.

Writes fear_greed_debug.txt every run (success or failure), like the
calendar/token-events/funding scrapers, so a silent miss is diagnosable
without Actions-log access.
"""
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

API_URL = "https://api.alternative.me/fng/?limit=7"

debug_lines = []


def dbg(msg):
    debug_lines.append(msg)
    print(msg)


def write_debug():
    try:
        with open("fear_greed_debug.txt", "w") as f:
            f.write(f"Run at {datetime.now(timezone.utc).isoformat()}\n\n")
            f.write("\n".join(debug_lines))
    except Exception:
        pass


def fetch(attempts=3):
    last_exc = None
    for i in range(1, attempts + 1):
        try:
            req = urllib.request.Request(
                API_URL,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                status = resp.status
                body = resp.read().decode("utf-8")
                dbg(f"Attempt {i}: HTTP {status}, {len(body)} bytes")
                return json.loads(body)
        except urllib.error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf-8", errors="replace")[:300]
            except Exception:
                pass
            dbg(f"Attempt {i}: HTTPError {exc.code} {exc.reason} -- body: {body}")
            last_exc = exc
        except Exception as exc:
            dbg(f"Attempt {i}: {type(exc).__name__}: {exc}")
            last_exc = exc
        if i < attempts:
            time.sleep(3 * i)
    raise last_exc


def main():
    try:
        raw = fetch()
    except Exception as exc:
        dbg(f"All attempts failed: {exc}")
        write_debug()
        raise SystemExit("Could not fetch Fear & Greed index -- not overwriting fear_greed_data.json. See fear_greed_debug.txt")

    entries = raw.get("data", [])
    if not entries:
        dbg(f"Response had no 'data' entries -- raw: {json.dumps(raw)[:300]}")
        write_debug()
        raise SystemExit("No data returned from alternative.me -- not overwriting fear_greed_data.json")

    history = []
    for e in entries:
        history.append({
            "value": int(e["value"]),
            "classification": e["value_classification"],
            "date": datetime.fromtimestamp(int(e["timestamp"]), tz=timezone.utc).strftime("%Y-%m-%d"),
        })

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "https://alternative.me/crypto/fear-and-greed-index/",
        "current": history[0],
        "history": history,  # newest first
    }
    with open("fear_greed_data.json", "w") as f:
        json.dump(payload, f, indent=2)
    dbg(f"OK: Wrote fear & greed index: {history[0]['value']} ({history[0]['classification']})")
    write_debug()
    print(f"Wrote fear & greed index: {history[0]['value']} ({history[0]['classification']})")


if __name__ == "__main__":
    main()
