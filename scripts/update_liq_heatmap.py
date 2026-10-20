#!/usr/bin/env python3
"""Estimated liquidation heatmap + liquidation map  ->  liq_heatmap_data.json

This is a MODEL, like the CoinGlass / Coinank heatmaps (it is not a feed of
real positions - nobody publishes those). Inputs are free public futures data:
5-minute candles and 5-minute open-interest history for BTCUSDT / ETHUSDT
(Binance USD-M first, Bybit as a fallback).

Method (all assumptions are written into the output file's "model" block):
  * Each rise in open interest is treated as NEW positions opened at that
    candle's typical price; each fall closes existing positions pro-rata.
  * New notional is split long/short with a tilt toward the candle's
    direction, then across leverage tiers 10x/25x/50x/100x.
  * A position's liquidation price = entry -/+ (entry / leverage) with a
    0.5% maintenance-margin buffer.
  * Positions disappear once price trades through their liquidation level.
  * The simulation warms up over 30 days, then the last 24h is sampled every
    15 minutes -> heatmap columns. The final state is the "liquidation map".
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "liq_heatmap_data.json")
STEP5 = 300_000
LOOKBACK_DAYS = 30
TIERS = [10, 25, 50, 100]
TIER_W = [0.35, 0.30, 0.20, 0.15]
MM = 0.005
RANGE = 0.08          # grid covers +/-8% around the current price
NB = 160              # -> 0.1% bins
LOG = []


def log(m):
    print(m)
    LOG.append(m)


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 ttm-terminal", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa
            log(f"  GET fail ({i+1}/{tries}) {url[:100]} -> {type(e).__name__}: {str(e)[:80]}")
            time.sleep(1.2 * (i + 1))
    return None


# ----------------------------------------------------------------------------
# data sources -> candles [(t,o,h,l,c)] ascending, oi {t: usd}
# ----------------------------------------------------------------------------
def binance(sym, start_ms, end_ms):
    candles, t = [], start_ms
    while t < end_ms:
        d = get(f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval=5m&startTime={t}&limit=1500")
        if not d:
            return None
        for k in d:
            candles.append((int(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4])))
        if len(d) < 2:
            break
        t = int(d[-1][0]) + STEP5
    oi, end = {}, end_ms
    while end > start_ms:
        d = get(f"https://fapi.binance.com/futures/data/openInterestHist?symbol={sym}&period=5m&limit=500&endTime={end}")
        if not d:
            break
        for r in d:
            oi[int(r["timestamp"]) // STEP5 * STEP5] = float(r["sumOpenInterestValue"])
        first = min(int(r["timestamp"]) for r in d)
        if first >= end:
            break
        end = first - 1
    return (candles, oi) if candles and len(oi) > 100 else None


def bybit(sym, start_ms, end_ms):
    candles, end = {}, end_ms
    while end > start_ms:
        d = get(f"https://api.bybit.com/v5/market/kline?category=linear&symbol={sym}&interval=5&end={end}&limit=1000")
        rows = ((d or {}).get("result") or {}).get("list") or []
        if not rows:
            break
        for k in rows:
            candles[int(k[0])] = (int(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4]))
        end = min(int(k[0]) for k in rows) - 1
    oi, cursor, pages = {}, "", 0
    while pages < 60:
        url = f"https://api.bybit.com/v5/market/open-interest?category=linear&symbol={sym}&intervalTime=5min&startTime={start_ms}&limit=200"
        if cursor:
            url += f"&cursor={cursor}"
        d = get(url)
        res = (d or {}).get("result") or {}
        lst = res.get("list") or []
        if not lst:
            break
        for r in lst:
            t = int(r["timestamp"]) // STEP5 * STEP5
            c = candles.get(t)
            if c:
                oi[t] = float(r["openInterest"]) * c[4]
        cursor = res.get("nextPageCursor") or ""
        pages += 1
        if not cursor:
            break
    cl = sorted(candles.values())
    return (cl, oi) if cl and len(oi) > 100 else None



def coinbase_candles(sym, start_ms, end_ms):
    """5-minute spot candles from Coinbase Exchange (reachable from GitHub runners,
    unlike Binance/Bybit REST which are geo-blocked there)."""
    prod = {"BTCUSDT": "BTC-USD", "ETHUSDT": "ETH-USD"}.get(sym)
    if not prod:
        return None
    out, t = {}, start_ms
    iso = lambda ms: datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    while t < end_ms:
        e = min(t + 299 * STEP5, end_ms)
        d = get(f"https://api.exchange.coinbase.com/products/{prod}/candles?granularity=300&start={iso(t)}&end={iso(e)}")
        if d is None:
            return None
        for ts, lo, hi, op, cl, _v in d:
            out[int(ts) * 1000] = (int(ts) * 1000, float(op), float(hi), float(lo), float(cl))
        t = e
        time.sleep(0.12)
    cl = sorted(out.values())
    return cl if len(cl) > 500 else None


def okx_oi(sym, start_ms, end_ms):
    inst = {"BTCUSDT": "BTC-USDT-SWAP", "ETHUSDT": "ETH-USDT-SWAP"}.get(sym)
    if not inst:
        return None
    for host in ("www.okx.com", "aws.okx.com"):
        for period in ("5m", "15m"):
            oi, end, pages = {}, end_ms, 0
            while end > start_ms and pages < 400:
                d = get(f"https://{host}/api/v5/rubik/stat/contracts/open-interest-history?instId={inst}&period={period}&limit=100&end={end}", tries=2)
                rows = (d or {}).get("data") or []
                if not rows:
                    break
                for r in rows:  # [ts, oi (contracts), oiCcy, oiUsd]
                    try:
                        oi[int(r[0]) // STEP5 * STEP5] = float(r[3])
                    except (ValueError, IndexError):
                        pass
                oldest = min(int(r[0]) for r in rows)
                if oldest >= end:
                    break
                end = oldest - 1
                pages += 1
                time.sleep(0.1)
            if len(oi) >= 200:
                log(f"{sym}: OKX {period} open interest - {len(oi)} points from {host}")
                return oi
    return None


def gate_oi(sym, start_ms, end_ms):
    contract = {"BTCUSDT": "BTC_USDT", "ETHUSDT": "ETH_USDT"}.get(sym)
    if not contract:
        return None
    oi, frm, pages = {}, start_ms // 1000, 0
    while frm < end_ms // 1000 and pages < 200:
        d = get(f"https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract={contract}&interval=5m&limit=100&from={frm}", tries=2)
        if not d or not isinstance(d, list):
            break
        for r in d:
            try:
                usd = r.get("open_interest_usd")
                if usd is None:
                    continue
                oi[int(r["time"]) * 1000 // STEP5 * STEP5] = float(usd)
            except (KeyError, ValueError, TypeError):
                pass
        last = max(int(r["time"]) for r in d)
        if last < frm:
            break
        frm = last + 300
        pages += 1
        time.sleep(0.1)
    if len(oi) >= 200:
        log(f"{sym}: Gate open interest - {len(oi)} points")
        return oi
    return None


def fetch(sym, start_ms, end_ms):
    """Returns (source_label, candles, oi). Open interest: OKX, then Gate; candles from
    Coinbase. Binance / Bybit REST are last-resort only (both block GitHub's US runners)."""
    candles = coinbase_candles(sym, start_ms, end_ms)
    log(f"{sym}: coinbase candles - {len(candles) if candles else 'FAILED'}")
    if candles:
        for name, fn in (("OKX", okx_oi), ("Gate", gate_oi)):
            oi = fn(sym, start_ms, end_ms)
            if oi:
                return f"{name} (price: Coinbase)", candles, oi
            log(f"{sym}: {name} open interest failed")
    for name, fn in (("Binance", binance), ("Bybit", bybit)):
        got = fn(sym, start_ms, end_ms)
        if got:
            log(f"{sym}: {name} ok - {len(got[0])} candles, {len(got[1])} OI points")
            return name, got[0], got[1]
        log(f"{sym}: {name} failed")
    return None, None, None


# ----------------------------------------------------------------------------
WINDOWS = [  # name, columns, 5-minute steps per column, hours of history behind the map
    ("1h", 12, 1, 1), ("4h", 48, 1, 4), ("8h", 48, 2, 8),
    ("12h", 48, 3, 12), ("1d", 96, 3, 24), ("1w", 84, 24, 168),
]


def simulate(candles, oi, last_price, snap_last=0):
    """snap_last > 0 also records the last N 5-minute snapshots for the windowed heatmaps."""
    step = last_price * 2 * RANGE / NB
    lo = last_price * (1 - RANGE)
    snaps = []
    first_snap = len(candles) - snap_last

    def idx(p):
        return max(-1, min(NB, int((p - lo) // step)))

    longs = [[0.0] * NB for _ in TIERS]
    shorts = [[0.0] * NB for _ in TIERS]
    cols, col_times = [], []
    prev_oi = None
    for n, (t, o, h, l, c) in enumerate(candles):
        # 1) price trading through levels liquidates them
        il, ih = idx(l), idx(h)
        if il < NB:
            for a in longs:
                for i in range(max(il, 0), NB):
                    a[i] = 0.0
        if ih >= 0:
            for a in shorts:
                for i in range(0, min(ih, NB - 1) + 1):
                    a[i] = 0.0
        # 2) open-interest change -> new / closed positions
        cur = oi.get(t)
        if cur is not None and prev_oi is not None:
            d = cur - prev_oi
            if d > 0:
                entry = (h + l + c) / 3
                chg = (c - o) / o if o else 0
                tilt = max(-1.0, min(1.0, chg / 0.002)) * 0.15
                lshare = 0.5 + tilt
                for k, (lev, w) in enumerate(zip(TIERS, TIER_W)):
                    lp = entry * (1 - 1 / lev + MM)
                    sp = entry * (1 + 1 / lev - MM)
                    i, j = idx(lp), idx(sp)
                    if 0 <= i < NB:
                        longs[k][i] += d * lshare * w
                    if 0 <= j < NB:
                        shorts[k][j] += d * (1 - lshare) * w
            elif d < 0:
                total = sum(map(sum, longs)) + sum(map(sum, shorts))
                if total > 0:
                    f = max(0.0, 1 + d / total * 0.35)  # only part of a fall comes out of the tracked levels
                    for a in longs + shorts:
                        for i in range(NB):
                            a[i] *= f
        if cur is not None:
            prev_oi = cur
        if snap_last and n >= first_snap:
            snaps.append((t + STEP5, [sum(longs[k][i] + shorts[k][i] for k in range(len(TIERS))) for i in range(NB)]))
        # 3) sample every 15 minutes
        if (t // STEP5) % 3 == 2:
            cols.append([sum(longs[k][i] + shorts[k][i] for k in range(len(TIERS))) for i in range(NB)])
            col_times.append(t + STEP5)
    return lo, step, cols[-96:], col_times[-96:], longs, shorts, snaps


def build(sym, source, candles, oi):
    last = candles[-1][4]
    lo, step, cols, times, longs, shorts, snaps = simulate(candles, oi, last, snap_last=2016 + 24)
    mx = max((max(c) for c in cols), default=0) or 1.0
    enc = ["".join("%02x" % min(255, int(round(v / mx * 255))) for v in col) for col in cols]
    # 15-minute candles for the overlay
    c15 = []
    by = {c[0]: c for c in candles}
    for t in times:
        grp = [by.get(t - STEP5 * k) for k in (3, 2, 1)]
        grp = [g for g in grp if g]
        if grp:
            c15.append([t - 3 * STEP5, grp[0][1], max(g[2] for g in grp), min(g[3] for g in grp), grp[-1][4]])
    by5 = {c[0]: c for c in candles}
    wins, maps = {}, {}
    for name, ncols, stride, hours in WINDOWS:
        pick = snaps[::-1][::stride][:ncols][::-1]
        if not pick:
            continue
        wmx = max((max(col) for _, col in pick), default=0) or 1.0
        wcands = []
        for te, _col in pick:
            grp = [by5.get(te - STEP5 * k) for k in range(stride, 0, -1)]
            grp = [g for g in grp if g]
            if grp:
                wcands.append([te - stride * STEP5, grp[0][1], max(g[2] for g in grp), min(g[3] for g in grp), grp[-1][4]])
        wins[name] = {"max_usd": round(wmx), "times": [te for te, _ in pick], "candles": wcands,
                      "cols": ["".join("%02x" % min(255, int(round(v / wmx * 255))) for v in col) for _, col in pick]}
        # map: only positions opened inside this window
        n = hours * 12
        _lo, _st, _c, _t, wl, ws, _s = simulate(candles[-n:], oi, last)
        maps[name] = {"tiers": TIERS, "long": [[round(v / 1e6, 2) for v in a] for a in wl],
                      "short": [[round(v / 1e6, 2) for v in a] for a in ws]}
    return {
        "w": wins, "maps": maps,
        "symbol": sym, "price": last, "lo": round(lo, 4), "step": round(step, 4), "nb": NB,
        "max_usd": round(mx), "times": times, "cols": enc, "candles": c15,
        "map": {"tiers": TIERS, "long": [[round(v / 1e6, 3) for v in a] for a in longs],
                "short": [[round(v / 1e6, 3) for v in a] for a in shorts]},
        "source": source,
    }


def main():
    log(f"liq heatmap run {datetime.now(timezone.utc).isoformat()}")
    now = int(time.time() * 1000)
    end = now // STEP5 * STEP5
    start = end - LOOKBACK_DAYS * 86400_000
    out = {}
    for key, sym in (("BTC", "BTCUSDT"), ("ETH", "ETHUSDT")):
        try:
            source, candles, oi = fetch(sym, start, end)
            if candles:
                out[key] = build(sym, source, candles, oi)
        except Exception as e:  # noqa
            log(f"{sym} FAILED: {type(e).__name__}: {e}")
    if out:
        payload = {
            "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "model": {"lookback_days": LOOKBACK_DAYS, "tiers": TIERS, "tier_weights": TIER_W,
                      "maintenance_margin": MM, "bin_pct": round(RANGE * 2 / NB * 100, 3),
                      "note": "Modelled from open-interest changes and candles; not real position data."},
            **out}
        # keep a missing symbol from the previous file rather than dropping it
        try:
            old = json.load(open(OUT))
            for k in ("BTC", "ETH"):
                if k not in payload and k in old:
                    payload[k] = old[k]
        except Exception:
            pass
        with open(OUT, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        log(f"wrote {OUT} ({os.path.getsize(OUT)//1024} KB)")
    else:
        log("no data from any source - file not updated")
    with open(os.path.join(ROOT, "liq_heatmap_debug.txt"), "w") as f:
        f.write("\n".join(LOG) + "\n")


if __name__ == "__main__":
    main()
