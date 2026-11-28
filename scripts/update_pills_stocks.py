#!/usr/bin/env python3
"""TTM Pills for stocks -> pills_us.json and pills_au.json  {generated_at, source, coins:[{s,n,p,m,v24,cat,ch{5m,15m,1h,4h,1d,1w,1m}}]}
Universe: the biggest US and ASX companies from stock_list.json (market cap order). Prices and moves come from Yahoo Finance chart data (delayed).
Two calls per stock: 5-minute candles for 5d (5m, 15m, 1h, 4h moves) and daily candles for 1mo (1d, 1w, 1m moves).
If a market returns too little data, the last good file is kept."""
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tf_common import getj, log, now_iso, ROOT
import urllib.parse

N = {"us": 250, "au": 250}
# Commodities and indices: (Yahoo symbol, short code, name, group). List order sets bubble size (first = biggest).
CX = [("^GSPC", "SPX", "S&P 500", "Index"), ("^IXIC", "NASDAQ", "Nasdaq Composite", "Index"), ("^DJI", "DOW", "Dow Jones", "Index"), ("^RUT", "RUT", "Russell 2000", "Index"),
      ("^AXJO", "ASX200", "ASX 200", "Index"), ("^FTSE", "FTSE", "FTSE 100", "Index"), ("^GDAXI", "DAX", "DAX 40", "Index"), ("^N225", "N225", "Nikkei 225", "Index"),
      ("^HSI", "HSI", "Hang Seng", "Index"), ("000001.SS", "SSE", "Shanghai Composite", "Index"), ("^STOXX50E", "SX5E", "Euro Stoxx 50", "Index"), ("^VIX", "VIX", "Volatility (VIX)", "Index"),
      ("DX-Y.NYB", "DXY", "US Dollar Index", "Currency"), ("AUDUSD=X", "AUDUSD", "AUD / USD", "Currency"),
      ("GC=F", "GOLD", "Gold", "Metals"), ("SI=F", "SILVER", "Silver", "Metals"), ("HG=F", "COPPER", "Copper", "Metals"), ("PL=F", "PLAT", "Platinum", "Metals"), ("PA=F", "PALL", "Palladium", "Metals"),
      ("CL=F", "WTI", "Crude Oil (WTI)", "Energy"), ("BZ=F", "BRENT", "Brent Crude", "Energy"), ("NG=F", "NATGAS", "Natural Gas", "Energy"),
      ("ZW=F", "WHEAT", "Wheat", "Agriculture"), ("ZC=F", "CORN", "Corn", "Agriculture"), ("ZS=F", "SOY", "Soybeans", "Agriculture"), ("KC=F", "COFFEE", "Coffee", "Agriculture"),
      ("SB=F", "SUGAR", "Sugar", "Agriculture"), ("CC=F", "COCOA", "Cocoa", "Agriculture"), ("CT=F", "COTTON", "Cotton", "Agriculture")]
Q = "https://{h}.finance.yahoo.com/v8/finance/chart/{s}?range={r}&interval={i}&includePrePost=false"


def chart(sym, rng, iv):
    q = urllib.parse.quote(sym)
    for h in ("query1", "query2"):
        d = getj(Q.format(h=h, s=q, r=rng, i=iv), tries=2, timeout=20)
        try:
            r = d["chart"]["result"][0]
            if r.get("timestamp"):
                return r
        except Exception:
            pass
    return None


def series(r):
    ts = r.get("timestamp") or []
    q = (r.get("indicators", {}).get("quote") or [{}])[0]
    cl, vo = q.get("close") or [], q.get("volume") or []
    return [(t, c, (vo[i] if i < len(vo) else 0) or 0) for i, (t, c) in enumerate(zip(ts, cl)) if c]


def pct(a, b):
    return round((a / b - 1) * 100, 2) if a and b else None


def one(item):
    mkt, sym, code, name, mc, sec = item
    try:
        di = chart(sym, "1mo", "1d")
        ii = chart(sym, "5d", "5m")
        if not di:
            return None
        ds = series(di)
        meta = di.get("meta") or {}
        px = meta.get("regularMarketPrice") or (ds[-1][1] if ds else None)
        if not px or len(ds) < 3:
            return None
        off = meta.get("gmtoffset", 0) or 0
        today = ((meta.get("regularMarketTime") or ds[-1][0]) + off) // 86400
        hist = [c for t, c, v in ds if (t + off) // 86400 != today]
        ch = {"1d": pct(px, hist[-1] if hist else None), "1w": pct(px, hist[-5] if len(hist) >= 5 else (hist[0] if hist else None)), "1m": pct(px, hist[-21] if len(hist) >= 21 else (hist[0] if hist else None))}
        for k in ("5m", "15m", "1h", "4h"):
            ch[k] = None
        if ii:
            cs = [c for t, c, v in series(ii)]
            for k, back in (("5m", 1), ("15m", 3), ("1h", 12), ("4h", 48)):
                if len(cs) > back:
                    ch[k] = pct(px, cs[-1 - back])
        vol = ds[-1][2]
        o = {"s": code, "n": name, "p": round(px, 4), "m": mc, "v24": int(vol * px) if vol else 0, "cat": sec or "", "ch": ch}
        if mkt == "cx":
            o["y"] = sym
        return o
    except Exception as e:  # noqa
        log(f"  {sym}: {type(e).__name__} {e}")
        return None


def build(mkt, lst):
    items = []
    for row in lst[: N[mkt] + 40]:
        code, name, mc = row[0], row[1], row[2]
        sec = row[3] if len(row) > 3 else ""
        sym = code + ".AX" if mkt == "au" else code
        items.append((mkt, sym, code, name, mc, sec))
    out = []
    with ThreadPoolExecutor(8) as ex:
        for r in ex.map(one, items):
            if r:
                out.append(r)
    out.sort(key=lambda c: -(c["m"] or 0))
    return out[: N[mkt]]


def build_cx():
    items = [("cx", y, code, name, (len(CX) - i) * 1e9, grp) for i, (y, code, name, grp) in enumerate(CX)]
    out = []
    with ThreadPoolExecutor(8) as ex:
        for r in ex.map(one, items):
            if r:
                out.append(r)
    return out


def main():
    sl = json.load(open(os.path.join(ROOT, "stock_list.json")))
    for mkt in ("us", "au", "cx"):
        t0 = time.time()
        coins = build_cx() if mkt == "cx" else build(mkt, sl.get(mkt) or [])
        path = os.path.join(ROOT, f"pills_{mkt}.json")
        log(f"{mkt}: {len(coins)} items in {time.time() - t0:.0f}s")
        if len(coins) < (10 if mkt == "cx" else 40):
            log(f"{mkt}: too few stocks, keeping the last good file")
            continue
        json.dump({"generated_at": now_iso(), "source": "Yahoo Finance (delayed)", "coins": coins}, open(path, "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
