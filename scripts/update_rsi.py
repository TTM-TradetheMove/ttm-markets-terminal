#!/usr/bin/env python3
"""RSI heatmap  ->  rsi_heatmap.json

RSI(14, Wilder smoothing) for ~40 major coins across 15m / 1h / 4h / 12h / 1d / 1w, from OKX's public
candle API (free, no key, not geo-blocked). Also stores last price and 24h change from OKX tickers.
The newest, still-forming candle is included, like exchange charts show it.
"""
import json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"}
TFS = [("15m", "15m"), ("1h", "1H"), ("4h", "4H"), ("12h", "12H"), ("1d", "1D"), ("1w", "1W")]
COINS = ["BTC", "ETH", "XRP", "BNB", "SOL", "DOGE", "TRX", "ADA", "HYPE", "LINK", "XLM", "SUI", "BCH", "AVAX",
         "LTC", "HBAR", "TON", "DOT", "UNI", "AAVE", "NEAR", "APT", "ARB", "OP", "ATOM", "FIL", "ETC", "ICP",
         "INJ", "PEPE", "SHIB", "TAO", "ONDO", "WLD", "CRV", "ENA", "SEI", "TIA", "JUP", "RENDER"]
LOG = []


def log(m):
    print(m)
    LOG.append(m)


def getj(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa
            if i == tries - 1:
                log(f"  GET fail {url[:90]} -> {type(e).__name__}: {e}")
                return None
            time.sleep(2 * (i + 1))


def rsi(closes, n=14):
    if len(closes) < n + 1:
        return None
    gains = losses = 0.0
    for i in range(1, n + 1):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0)
        losses += max(-d, 0)
    ag, al = gains / n, losses / n
    for i in range(n + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        ag = (ag * (n - 1) + max(d, 0)) / n
        al = (al * (n - 1) + max(-d, 0)) / n
    if al == 0:
        return 100.0 if ag > 0 else 50.0
    return round(100 - 100 / (1 + ag / al), 1)


def one(job):
    sym, label, bar = job
    time.sleep(0.3)
    d = getj(f"https://www.okx.com/api/v5/market/candles?instId={sym}-USDT&bar={bar}&limit=200")
    if not d or d.get("code") != "0" or not d.get("data"):
        return sym, label, None
    closes = [float(c[4]) for c in reversed(d["data"])]  # API returns newest first
    return sym, label, rsi(closes)


def main():
    tick = getj("https://www.okx.com/api/v5/market/tickers?instType=SPOT") or {}
    tk = {}
    for t in tick.get("data", []):
        if t["instId"].endswith("-USDT"):
            try:
                last, op = float(t["last"]), float(t["open24h"])
                tk[t["instId"][:-5]] = (last, round((last / op - 1) * 100, 2) if op else None)
            except Exception:
                pass
    coins = [c for c in COINS if c in tk]
    log(f"{len(coins)}/{len(COINS)} coins listed on OKX spot")
    jobs = [(c, l, b) for c in coins for l, b in TFS]
    res = {}
    with ThreadPoolExecutor(max_workers=3) as ex:
        for sym, label, v in ex.map(one, jobs):
            res.setdefault(sym, {})[label] = v
    out = []
    for c in coins:
        r = res.get(c, {})
        if sum(v is not None for v in r.values()) < 3:
            continue
        out.append({"s": c, "p": tk[c][0], "c": tk[c][1], "r": {l: r.get(l) for l, _ in TFS}})
    if len(out) < 10:
        raise SystemExit("too few coins computed - not overwriting rsi_heatmap.json")
    payload = {"generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "source": "OKX",
               "period": 14, "tfs": [l for l, _ in TFS], "coins": out}
    with open(os.path.join(ROOT, "rsi_heatmap.json"), "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    log(f"wrote {len(out)} coins")
    with open(os.path.join(ROOT, "rsi_debug.txt"), "w") as f:
        f.write("\n".join(LOG) + "\n")


if __name__ == "__main__":
    main()
