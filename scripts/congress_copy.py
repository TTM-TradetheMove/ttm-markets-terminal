#!/usr/bin/env python3
"""
TTM Congress Copy agent (PAPER ONLY).
Rule: when the followed member (default Nancy Pelosi) files a stock BUY, the paper account buys; when she files a SELL, it sells.

Source: House Clerk periodic transaction reports (same feed as telegram_congress.py). Filings arrive up to 45 days after the trade,
so the paper account trades at the price on the day the filing is first seen (what a real follower would get), and the file also records
her own trade date and the price then, so the cost of the delay is visible.
Only plain stock rows ([ST]) are copied. Options, funds, bonds and anything without a ticker are skipped and logged.
Output: congress_copy.json (read by the Engine page). First run only records existing filings and does not trade.
Env: FOLLOW="Pelosi:Nancy"  START=100000  SIZE_PCT=5  RESET=1 (wipe and restart)  DRY_RUN=1
"""
import json, os, re, sys, time, subprocess, tempfile, urllib.parse
from datetime import datetime, timezone

os.environ["MEMBERS"] = os.environ.get("FOLLOW") or "Pelosi:Nancy"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import telegram_congress as tc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "congress_copy.json")
START = float(os.environ.get("START") or 100000)
SIZE_PCT = float(os.environ.get("SIZE_PCT") or 5)
DRY = os.environ.get("DRY_RUN", "0") == "1"
NOW = lambda: datetime.now(timezone.utc).isoformat(timespec="seconds")


def rows(txt):
    """Transactions from the filing text: [{action, ticker, kind, amt, tdate, asset}]"""
    out = []
    for line in txt.splitlines():
        m = tc.ROW.search(" ".join(line.split()))
        if not m:
            continue
        asset = re.sub(r"^(SP|JT|DC)\s+", "", m["asset"].strip())
        t = re.search(r"\(([A-Z][A-Z.\-]{0,5})\)", asset)
        k = re.search(r"\[([A-Z]{2})\]", asset)
        typ = m["type"].upper().replace(" ", "")
        out.append({"action": {"P": "buy", "S": "sell", "S(PARTIAL)": "sell_partial", "E": "exchange"}.get(typ, typ),
                    "ticker": t.group(1) if t else None, "kind": k.group(1) if k else None,
                    "amt": tc.short_amt(m["amt"]), "tdate": m["tdate"], "asset": asset[:60]})
    return out


def pdf_text(pdf):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "f.pdf"); open(p, "wb").write(pdf)
        return subprocess.run(["pdftotext", "-layout", p, "-"], capture_output=True, text=True, timeout=60).stdout


_cache = {}
def chart(tk):
    if tk in _cache:
        return _cache[tk]
    try:
        raw = tc.fetch("https://query1.finance.yahoo.com/v8/finance/chart/%s?range=2y&interval=1d" % urllib.parse.quote(tk.replace(".", "-")), tries=2)
        r = json.loads(raw)["chart"]["result"][0]
        pts = [(t, c) for t, c in zip(r["timestamp"], r["indicators"]["quote"][0]["close"]) if c]
        _cache[tk] = {"last": r["meta"].get("regularMarketPrice") or pts[-1][1], "pts": pts}
    except Exception as ex:
        print("no price for", tk, type(ex).__name__)
        _cache[tk] = None
    return _cache[tk]


def price_on(tk, tdate):
    c = chart(tk)
    if not c:
        return None
    try:
        d = datetime.strptime(tdate, "%m/%d/%Y").replace(tzinfo=timezone.utc).timestamp()
        return next(p for t, p in c["pts"] if t >= d - 86400)
    except Exception:
        return None


def mark(S):
    eq = S["cash"]
    for tk, p in S["positions"].items():
        c = chart(tk)
        if c:
            p["last"] = round(c["last"], 4)
        eq += p["units"] * (p.get("last") or p["entry"])
    return round(eq, 2)


def main():
    try:
        S = None if os.environ.get("RESET") == "1" else json.load(open(OUT))
    except Exception:
        S = None
    seeded = S is not None
    if not seeded:
        S = {"follow": os.environ["MEMBERS"], "start_balance": START, "size_pct": SIZE_PCT, "cash": START, "positions": {}, "closed": [], "seen": [], "skipped": [], "log": [], "equity": []}
    fs = tc.filings(datetime.now(timezone.utc).year)
    if fs is None:
        print("filing index unavailable this run; keeping state"); return
    new = [f for f in fs if f["doc"] not in S["seen"]]
    print("%d filing(s), %d new%s" % (len(fs), len(new), "" if seeded else " (first run: recording only)"))
    if not seeded:
        S["seen"] = sorted(f["doc"] for f in new)
    else:
        for f in sorted(new, key=lambda f: (f["date"][-4:], f["date"][:5]))[:6]:
            pdf = tc.fetch("https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/%s/%s.pdf" % (f["year"], f["doc"]))
            if not pdf:
                continue   # try again next run
            try:
                tr = rows(pdf_text(pdf))
            except Exception as ex:
                print("could not read", f["doc"], ex); continue
            for t in tr:
                key = "%s|%s|%s|%s" % (f["doc"], t["ticker"], t["action"], t["tdate"])
                tk = t["ticker"]
                if t["action"] not in ("buy", "sell", "sell_partial") or t["kind"] != "ST" or not tk:
                    S["skipped"].append({"doc": f["doc"], "asset": t["asset"], "action": t["action"], "why": "not a plain stock buy or sell", "ts": NOW()}); continue
                c = chart(tk)
                if not c:
                    S["log"].append({"ts": NOW(), "msg": "No price for %s, skipped" % tk}); continue
                px = c["last"]; her = price_on(tk, t["tdate"])
                if t["action"] == "buy":
                    if tk in S["positions"]:
                        S["log"].append({"ts": NOW(), "msg": "Already holding %s, skipped a repeat buy" % tk}); continue
                    eq = mark(S); size = min(eq * SIZE_PCT / 100, S["cash"])
                    if size < 50:
                        S["log"].append({"ts": NOW(), "msg": "Not enough cash for %s" % tk}); continue
                    S["cash"] = round(S["cash"] - size, 2)
                    S["positions"][tk] = {"entry": round(px, 4), "units": size / px, "cost": round(size, 2), "opened": NOW(), "her_date": t["tdate"], "her_price": round(her, 4) if her else None, "her_amt": t["amt"], "doc": f["doc"], "last": round(px, 4)}
                    S["log"].append({"ts": NOW(), "msg": "BUY %s $%d at %s (she traded %s, %s)" % (tk, size, round(px, 2), t["tdate"], t["amt"])})
                else:
                    p = S["positions"].get(tk)
                    if not p:
                        S["log"].append({"ts": NOW(), "msg": "She sold %s but we hold none, nothing to sell" % tk}); continue
                    frac = 0.5 if t["action"] == "sell_partial" else 1.0
                    u = p["units"] * frac; proceeds = u * px; cost = p["cost"] * frac; pnl = proceeds - cost
                    S["cash"] = round(S["cash"] + proceeds, 2)
                    S["closed"].append({"ticker": tk, "entry": p["entry"], "exit": round(px, 4), "pnl": round(pnl, 2), "pct": round((px / p["entry"] - 1) * 100, 2), "opened": p["opened"], "closed": NOW(), "her_buy_date": p["her_date"], "her_sell_date": t["tdate"], "partial": frac < 1})
                    S["log"].append({"ts": NOW(), "msg": "SELL%s %s at %s (%+.1f%%)" % (" half" if frac < 1 else "", tk, round(px, 2), (px / p["entry"] - 1) * 100)})
                    if frac < 1:
                        p["units"] -= u; p["cost"] = round(p["cost"] - cost, 2)
                    else:
                        del S["positions"][tk]
            S["seen"].append(f["doc"]); time.sleep(1)
    S["equity"].append([NOW(), mark(S)])
    S["equity"] = S["equity"][-1500:]; S["log"] = S["log"][-60:]; S["skipped"] = S["skipped"][-40:]; S["updated"] = NOW()
    if DRY:
        print(json.dumps({k: S[k] for k in ("cash", "positions", "closed", "log")}, indent=1)[:2500]); return
    json.dump(S, open(OUT, "w"), indent=1)


if __name__ == "__main__":
    main()
