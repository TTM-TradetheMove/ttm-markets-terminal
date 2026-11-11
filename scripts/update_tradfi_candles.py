#!/usr/bin/env python3
"""TradFi candles for TTM LENS  ->  out/tradfi_candles/*.json   (published to the 'data' branch by the workflow)

Yahoo Finance chart API. Per symbol and timeframe one small file, rows are [t_ms, o, h, l, c, v].
  1d  = 5 years      1h = 1 year      15m = 60 days      5m = 30 days
LENS builds 30m from 15m, 4h from 1h and 1w from 1d.  Intraday US data is delayed about 15 minutes.
"""
import json, os, re, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.environ.get("OUT_DIR", os.path.join(ROOT, "out")), "tradfi_candles")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", "Accept": "application/json,text/plain,*/*", "Accept-Language": "en-US,en;q=0.9"}
ERR = {}

SYMS = [
    ("^GSPC", "S&P 500", "Index"), ("^NDX", "Nasdaq 100", "Index"), ("^DJI", "Dow Jones", "Index"), ("^RUT", "Russell 2000", "Index"),
    ("^VIX", "VIX", "Index"), ("^AXJO", "ASX 200", "Index"), ("^N225", "Nikkei 225", "Index"), ("^FTSE", "FTSE 100", "Index"), ("^GDAXI", "DAX", "Index"),
    ("SPY", "S&P 500 ETF", "ETF"), ("QQQ", "Nasdaq 100 ETF", "ETF"), ("IWM", "Russell 2000 ETF", "ETF"),
    ("XLK", "Technology", "Sector"), ("XLC", "Communication", "Sector"), ("XLY", "Consumer Discretionary", "Sector"), ("XLP", "Consumer Staples", "Sector"),
    ("XLF", "Financials", "Sector"), ("XLV", "Health Care", "Sector"), ("XLI", "Industrials", "Sector"), ("XLE", "Energy", "Sector"),
    ("XLB", "Materials", "Sector"), ("XLU", "Utilities", "Sector"), ("XLRE", "Real Estate", "Sector"),
    ("GC=F", "Gold", "Commodity"), ("SI=F", "Silver", "Commodity"), ("CL=F", "WTI Crude", "Commodity"), ("NG=F", "Natural Gas", "Commodity"), ("HG=F", "Copper", "Commodity"),
    ("DX-Y.NYB", "US Dollar Index", "FX"), ("EURUSD=X", "EUR/USD", "FX"), ("GBPUSD=X", "GBP/USD", "FX"), ("USDJPY=X", "USD/JPY", "FX"),
    ("AUDUSD=X", "AUD/USD", "FX"), ("USDCAD=X", "USD/CAD", "FX"), ("NZDUSD=X", "NZD/USD", "FX"), ("USDCHF=X", "USD/CHF", "FX"),
    ("^TNX", "US 10Y yield", "Rates"), ("^TYX", "US 30Y yield", "Rates"),
    ("AAPL", "Apple", "Stock"), ("MSFT", "Microsoft", "Stock"), ("NVDA", "Nvidia", "Stock"), ("GOOGL", "Alphabet", "Stock"), ("AMZN", "Amazon", "Stock"),
    ("META", "Meta", "Stock"), ("TSLA", "Tesla", "Stock"), ("JPM", "JPMorgan", "Stock"), ("XOM", "Exxon Mobil", "Stock"),
]
TFS = [("1d", "1d", "5y"), ("1h", "1h", "1y"), ("15m", "15m", "60d"), ("5m", "5m", "30d")]


def sf(sym):
    return re.sub(r"[^A-Za-z0-9]", "_", sym)


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
                return json.loads(r.read())
        except Exception as e:
            code = str(getattr(e, "code", type(e).__name__))
            ERR[code] = ERR.get(code, 0) + 1
            time.sleep(6 * (i + 1) if code == "429" else 2 * (i + 1))
    return None


def fetch(sym, interval, rng):
    q = urllib.parse.quote(sym, safe="")
    for host in ("query1", "query2"):
        d = get(f"https://{host}.finance.yahoo.com/v8/chart/{q}?range={rng}&interval={interval}&includePrePost=false")
        try:
            res = d["chart"]["result"][0]
            ts, qd = res.get("timestamp") or [], res["indicators"]["quote"][0]
            rows = []
            for i, t in enumerate(ts):
                o, h, l, c = qd["open"][i], qd["high"][i], qd["low"][i], qd["close"][i]
                if None in (o, h, l, c):
                    continue
                rows.append([t * 1000, round(o, 5), round(h, 5), round(l, 5), round(c, 5), int(qd["volume"][i] or 0)])
            if len(rows) >= 5:
                return rows, res["meta"]
        except Exception:
            pass
    return None, None


def one(item):
    sym, name, typ = item
    info = None
    for tf, iv, rng in TFS:
        time.sleep(0.4)
        rows, meta = fetch(sym, iv, rng)
        if not rows:
            print("  no data", sym, tf)
            continue
        with open(os.path.join(OUT, f"{sf(sym)}_{tf}.json"), "w") as f:
            json.dump(rows, f, separators=(",", ":"))
        if tf == "1d":
            px = (meta or {}).get("regularMarketPrice") or rows[-1][4]
            prev = rows[-2][4] if len(rows) > 1 else px
            if rows and meta and meta.get("regularMarketTime") and rows[-1][0] // 864e5 != meta["regularMarketTime"] // 86400:
                prev = rows[-1][4]
            info = {"s": sym, "f": sf(sym), "n": name, "k": typ, "px": round(px, 5), "chg": round((px / prev - 1) * 100, 2) if prev else 0}
    return info


def main():
    os.makedirs(OUT, exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as ex:
        res = list(ex.map(one, SYMS))
    idx = [r for r in res if r]
    if len(idx) < 10:
        print("too few symbols returned data:", len(idx), "| Yahoo errors by code:", ERR)
        sys.exit(1)
    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "items": idx}, f, separators=(",", ":"))
    print("wrote", len(idx), "symbols to", OUT, "| Yahoo errors by code:", ERR)


if __name__ == "__main__":
    main()
