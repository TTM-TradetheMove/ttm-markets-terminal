#!/usr/bin/env python3
"""
Pulls BTC/ETH perpetual-futures funding rate + open interest and writes
funding_data.json for the dashboard to fetch at page load.

We go through CoinGecko's free, no-auth /derivatives endpoint rather than
hitting Binance/Bybit directly. GitHub Actions runners (Azure/AWS datacenter
IPs) get hard-blocked by both: Binance returns HTTP 451 (regulatory geo-block
on its futures API from US/EU cloud ranges) and Bybit returns HTTP 403
(anti-bot block on datacenter IPs). CoinGecko fetches this data server-side
and re-serves it, so it isn't subject to either block.

  GET https://api.coingecko.com/api/v3/derivatives
  -> array of ticker objects: market, symbol, index_id, price, contract_type,
     funding_rate, open_interest (USD), last_traded_at, ...
  Docs: https://docs.coingecko.com/reference/derivatives-tickers

Writes funding_debug.txt every run (like the calendar/token-events scrapers)
so a silent miss is diagnosable without Actions-log access.
"""
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone

API_URL = "https://api.coingecko.com/api/v3/derivatives"

# (CoinGecko index_id -- the underlying asset ticker, e.g. "BTC"/"ETH", NOT
# CoinGecko's coin-id slugs like "bitcoin"/"ethereum" -- confirmed against
# docs.coingecko.com/reference/derivatives-tickers example response)
ASSETS = [("BTC", "BTCUSDT"), ("ETH", "ETHUSDT")]
EXCHANGES = ["binance", "bybit"]

debug_lines = []


def dbg(msg):
    debug_lines.append(msg)
    print(msg)


def write_debug():
    try:
        with open("funding_debug.txt", "w") as f:
            f.write(f"Run at {datetime.now(timezone.utc).isoformat()}\n\n")
            f.write("\n".join(debug_lines))
    except Exception:
        pass


def fetch_all(attempts=3):
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
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode("utf-8")
                dbg(f"Attempt {i}: HTTP {resp.status}, {len(body)} bytes")
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
    raise last_exc


def main():
    try:
        tickers = fetch_all()
    except Exception as exc:
        dbg(f"All attempts failed: {exc}")
        write_debug()
        raise SystemExit("Could not fetch derivatives data from CoinGecko -- not overwriting funding_data.json. See funding_debug.txt")

    dbg(f"CoinGecko returned {len(tickers)} total derivative tickers")

    snapshots = []
    for index_id, display_symbol in ASSETS:
        for exch in EXCHANGES:
            match = None
            for t in tickers:
                market = str(t.get("market", "")).lower()
                idx = str(t.get("index_id", "")).upper()
                if (
                    idx == index_id.upper()
                    and t.get("contract_type") == "perpetual"
                    and exch in market
                ):
                    match = t
                    break
            if not match:
                # Fallback: match on symbol directly (some exchanges report a
                # slightly different index_id than the ticker symbol).
                for t in tickers:
                    market = str(t.get("market", "")).lower()
                    sym = str(t.get("symbol", "")).upper()
                    if (
                        sym == display_symbol.upper()
                        and t.get("contract_type") == "perpetual"
                        and exch in market
                    ):
                        match = t
                        break
            if not match:
                sample = [t.get("market") for t in tickers if exch in str(t.get("market", "")).lower()][:5]
                dbg(f"No perpetual match for {exch}/{display_symbol} -- sample markets containing '{exch}': {sample}")
                continue
            try:
                row = {
                    "exchange": match.get("market"),
                    "symbol": display_symbol,
                    "fundingRate": float(match["funding_rate"]) / 100.0,  # CG gives %, store as fraction
                    "markPrice": float(match["price"]),
                    "nextFundingTime": None,
                    "openInterest": float(match.get("open_interest") or 0),
                }
            except (KeyError, TypeError, ValueError) as exc:
                dbg(f"{exch}/{display_symbol}: bad data in match -- {exc} -- raw: {json.dumps(match)[:300]}")
                continue
            dbg(f"OK: {row['exchange']} {row['symbol']} funding={row['fundingRate']} oi={row['openInterest']}")
            snapshots.append(row)

    write_debug()

    if not snapshots:
        raise SystemExit("No funding/OI snapshots matched in CoinGecko derivatives data -- not overwriting funding_data.json. See funding_debug.txt")

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sources": ["https://api.coingecko.com/api/v3/derivatives"],
        "snapshots": snapshots,
    }
    with open("funding_data.json", "w") as f:
        json.dump(payload, f, indent=2)
    print(f"Wrote {len(snapshots)} funding/OI snapshots to funding_data.json")


if __name__ == "__main__":
    main()
