#!/usr/bin/env python3
"""
Pulls the Crypto Fear & Greed Index from alternative.me's free, no-auth API
and writes fear_greed_data.json for the dashboard to fetch at page load.

alternative.me/crypto/fear-and-greed-index/ explicitly documents this
endpoint as free to use. We pull a short recent history (7 days) so the
widget can also show a tiny trend, not just today's single number.
"""
import json
import urllib.request
from datetime import datetime, timezone

API_URL = "https://api.alternative.me/fng/?limit=7"


def main():
    req = urllib.request.Request(API_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = json.loads(resp.read().decode("utf-8"))

    entries = raw.get("data", [])
    if not entries:
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
    print(f"Wrote fear & greed index: {history[0]['value']} ({history[0]['classification']})")


if __name__ == "__main__":
    main()
