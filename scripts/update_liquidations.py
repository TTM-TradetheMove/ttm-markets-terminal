#!/usr/bin/env python3
"""
Builds a rolling 24h "liquidation map" for BTC and ETH perpetuals from real,
free, no-auth public exchange liquidation feeds -- Binance Futures' public
"All Market Liquidation Order Streams" websocket (!forceOrder@arr, no key)
and Bybit v5's public allLiquidation/liquidation topics.

This is NOT the same thing as a paid "predictive" liquidation heatmap
(CoinGlass/Kiyotaka/NewHedge-style, modeled from estimated open-interest and
leverage distribution) -- those all require a paid API key, confirmed by
checking their docs. What this script captures is real, historical,
already-fired liquidation orders, bucketed by price distance from the
current mark so it reads visually like a heatmap: price buckets on one axis,
liquidated USD volume as bar length/intensity, split long vs short.

Because GitHub Actions runs this as a short-lived job rather than an
always-on listener, each run connects to both exchanges' public websockets
for a short window (~70s), captures whatever fires in that window, and
merges it into a persistent rolling log (liquidations_data.json) trimmed to
the last 24h. Frequent, staggered cron runs keep the gaps between windows
small, but this is not a complete tape -- it's a real sample, not a mocked
one.

Writes liquidations_debug.txt every run (success or failure), like the
other scrapers, so a silent miss is diagnosable without Actions-log access.
"""
import asyncio
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

try:
    import websockets
except ImportError:
    websockets = None

BINANCE_WS = "wss://fstream.binance.com/ws/!forceOrder@arr"
BYBIT_WS = "wss://stream.bybit.com/v5/public/linear"
BYBIT_SYMBOLS = ["BTCUSDT", "ETHUSDT"]
BYBIT_TOPICS = [f"allLiquidation.{s}" for s in BYBIT_SYMBOLS] + [f"liquidation.{s}" for s in BYBIT_SYMBOLS]

CAPTURE_SECONDS = 180
DATA_FILE = "liquidations_data.json"
MAX_AGE_HOURS = 24

# Mark price lookup (for bucketing) -- reuse the same free CoinGecko
# derivatives endpoint the funding script already relies on, so we don't
# need a third external dependency just for a reference price.
PRICE_API = "https://api.coingecko.com/api/v3/derivatives"

debug_lines = []


def dbg(msg):
    debug_lines.append(msg)
    print(msg)


def write_debug():
    try:
        with open("liquidations_debug.txt", "w") as f:
            f.write(f"Run at {datetime.now(timezone.utc).isoformat()}\n\n")
            f.write("\n".join(debug_lines))
    except Exception:
        pass


def fetch_mark_prices():
    """Best-effort BTC/ETH mark price lookup for bucketing. Returns {} on failure
    rather than raising -- a missing reference price shouldn't block the rest."""
    prices = {}
    try:
        req = urllib.request.Request(
            PRICE_API,
            headers={"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"},
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            tickers = json.loads(resp.read().decode("utf-8"))
        for index_id, symbol in (("BTC", "BTCUSDT"), ("ETH", "ETHUSDT")):
            for t in tickers:
                if (
                    str(t.get("index_id", "")).upper() == index_id
                    and t.get("contract_type") == "perpetual"
                    and "binance" in str(t.get("market", "")).lower()
                ):
                    prices[symbol] = float(t["price"])
                    break
        dbg(f"Mark prices: {prices}")
    except Exception as exc:
        dbg(f"Mark price lookup failed (non-fatal): {exc}")
    return prices


async def capture_binance(events, seconds):
    if websockets is None:
        dbg("Binance: websockets module not available")
        return
    try:
        async with websockets.connect(BINANCE_WS, open_timeout=15, close_timeout=5) as ws:
            dbg("Binance: connected")
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                except asyncio.TimeoutError:
                    break
                try:
                    msg = json.loads(raw)
                    o = msg.get("o", {})
                    symbol = o.get("s")
                    if symbol not in ("BTCUSDT", "ETHUSDT"):
                        continue
                    side_raw = o.get("S")  # SELL = forced-sell = a LONG got liquidated; BUY = a SHORT got liquidated
                    side = "long" if side_raw == "SELL" else "short" if side_raw == "BUY" else None
                    price = float(o.get("ap") or o.get("p") or 0)
                    qty = float(o.get("z") or o.get("q") or 0)
                    ts = int(o.get("T") or msg.get("E") or time.time() * 1000)
                    if not (side and price and qty):
                        continue
                    events.append({
                        "exchange": "Binance",
                        "symbol": symbol,
                        "side": side,
                        "price": price,
                        "qty": qty,
                        "usd": price * qty,
                        "time": ts,
                    })
                except Exception as exc:
                    dbg(f"Binance: bad message skipped -- {exc}")
        dbg(f"Binance: capture window closed, {sum(1 for e in events if e['exchange'] == 'Binance')} events")
    except Exception as exc:
        dbg(f"Binance: capture failed -- {type(exc).__name__}: {exc}")


async def capture_bybit(events, seconds):
    if websockets is None:
        dbg("Bybit: websockets module not available")
        return
    try:
        async with websockets.connect(BYBIT_WS, open_timeout=15, close_timeout=5) as ws:
            dbg("Bybit: connected")
            await ws.send(json.dumps({"op": "subscribe", "args": BYBIT_TOPICS}))
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                except asyncio.TimeoutError:
                    break
                try:
                    msg = json.loads(raw)
                    topic = msg.get("topic", "")
                    if "liquidation" not in topic.lower():
                        continue
                    data = msg.get("data")
                    rows = data if isinstance(data, list) else [data] if data else []
                    for row in rows:
                        if not isinstance(row, dict):
                            continue
                        symbol = row.get("symbol") or row.get("s")
                        if symbol not in ("BTCUSDT", "ETHUSDT"):
                            continue
                        side_raw = row.get("side") or row.get("S")
                        # Bybit: side is the side of the FORCED order itself.
                        # "Sell" closing-order = a LONG got liquidated; "Buy" = a SHORT got liquidated.
                        side = "long" if side_raw == "Sell" else "short" if side_raw == "Buy" else None
                        price = float(row.get("price") or row.get("p") or 0)
                        qty = float(row.get("size") or row.get("v") or row.get("q") or 0)
                        ts = int(row.get("updatedTime") or row.get("T") or msg.get("ts") or time.time() * 1000)
                        if not (side and price and qty):
                            continue
                        events.append({
                            "exchange": "Bybit",
                            "symbol": symbol,
                            "side": side,
                            "price": price,
                            "qty": qty,
                            "usd": price * qty,
                            "time": ts,
                        })
                except Exception as exc:
                    dbg(f"Bybit: bad message skipped -- {exc}")
        dbg(f"Bybit: capture window closed, {sum(1 for e in events if e['exchange'] == 'Bybit')} events")
    except Exception as exc:
        dbg(f"Bybit: capture failed -- {type(exc).__name__}: {exc}")


def build_buckets(events, mark_prices):
    """Price-distance buckets (% from current mark), summed USD by side, per symbol."""
    BUCKET_PCT = 0.5   # each bucket spans 0.5% of mark price
    RANGE_PCT = 10.0   # cover +/-10% from mark
    buckets_by_symbol = {}
    for symbol in ("BTCUSDT", "ETHUSDT"):
        mark = mark_prices.get(symbol)
        sym_events = [e for e in events if e["symbol"] == symbol]
        if not mark or not sym_events:
            buckets_by_symbol[symbol] = {"mark": mark, "buckets": []}
            continue
        n_buckets = int((RANGE_PCT * 2) / BUCKET_PCT)
        bucket_totals = {}  # bucket_index -> {"long": usd, "short": usd}
        for e in sym_events:
            pct = (e["price"] - mark) / mark * 100
            if abs(pct) > RANGE_PCT:
                continue
            idx = int(round(pct / BUCKET_PCT))
            bucket_totals.setdefault(idx, {"long": 0.0, "short": 0.0})
            bucket_totals[idx][e["side"]] += e["usd"]
        buckets = []
        for idx in range(-n_buckets // 2, n_buckets // 2 + 1):
            totals = bucket_totals.get(idx, {"long": 0.0, "short": 0.0})
            if totals["long"] == 0 and totals["short"] == 0:
                continue
            bucket_price = mark * (1 + (idx * BUCKET_PCT) / 100)
            buckets.append({
                "pricePct": round(idx * BUCKET_PCT, 2),
                "price": round(bucket_price, 2),
                "longUsd": round(totals["long"], 2),
                "shortUsd": round(totals["short"], 2),
            })
        buckets.sort(key=lambda b: b["pricePct"])
        buckets_by_symbol[symbol] = {"mark": mark, "buckets": buckets}
    return buckets_by_symbol


def main():
    if websockets is None:
        dbg("FATAL: 'websockets' package not installed")
        write_debug()
        raise SystemExit("websockets package missing -- not updating liquidations_data.json")

    events = []

    async def run_captures():
        await asyncio.gather(
            capture_binance(events, CAPTURE_SECONDS),
            capture_bybit(events, CAPTURE_SECONDS),
        )

    try:
        asyncio.run(run_captures())
    except Exception as exc:
        dbg(f"Capture run failed: {exc}")

    dbg(f"Captured {len(events)} new liquidation events this run")

    # Merge with existing rolling log, dedupe, trim to MAX_AGE_HOURS.
    existing = []
    try:
        with open(DATA_FILE) as f:
            existing = json.load(f).get("events", [])
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    now_ms = time.time() * 1000
    cutoff_ms = now_ms - MAX_AGE_HOURS * 3600 * 1000

    def event_key(e):
        return (e["exchange"], e["symbol"], e["side"], round(e["price"], 2), round(e["qty"], 6), e["time"])

    seen = set()
    merged = []
    for e in existing + events:
        if e["time"] < cutoff_ms:
            continue
        k = event_key(e)
        if k in seen:
            continue
        seen.add(k)
        merged.append(e)
    merged.sort(key=lambda e: e["time"], reverse=True)

    dbg(f"Rolling log: {len(existing)} existing + {len(events)} new -> {len(merged)} after dedupe/trim")

    mark_prices = fetch_mark_prices()
    buckets = build_buckets(merged, mark_prices)

    totals = {}
    for symbol in ("BTCUSDT", "ETHUSDT"):
        sym_events = [e for e in merged if e["symbol"] == symbol]
        totals[symbol] = {
            "longUsd": round(sum(e["usd"] for e in sym_events if e["side"] == "long"), 2),
            "shortUsd": round(sum(e["usd"] for e in sym_events if e["side"] == "short"), 2),
            "count": len(sym_events),
        }

    biggest = sorted(merged, key=lambda e: e["usd"], reverse=True)[:25]

    write_debug()

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window_hours": MAX_AGE_HOURS,
        "sources": [
            "wss://fstream.binance.com/ws/!forceOrder@arr",
            "wss://stream.bybit.com/v5/public/linear",
        ],
        "totals": totals,
        "buckets": buckets,
        "biggest": biggest,
        "events": merged,
    }
    with open(DATA_FILE, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"Wrote {len(merged)} liquidation events ({len(events)} new this run) to {DATA_FILE}")


if __name__ == "__main__":
    main()
