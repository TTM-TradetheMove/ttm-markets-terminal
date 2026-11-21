#!/usr/bin/env python3
"""Spot crypto ETF flows for the TTM terminal  ->  etf_flows.json

Source: SoSoValue open API (free key: https://sosovalue.com/developer/dashboard -> "Apply your Key").
Put the key in the repository secret SOSO_API_KEY. Without it this script prints a note and exits without touching the data file.
Covers US spot ETFs for BTC ETH SOL XRP LTC DOGE HBAR LINK AVAX DOT, and the Hong Kong ones for BTC ETH SOL.
Per asset: daily totals (flow, net assets, cumulative) for about 120 days, and each fund's last ~30 days of flows.
Limits: 20 requests/minute, so this paces itself (about 5 minutes per run).
Env: SOSO_BASE=http://localhost:PORT to test against a fake server.
"""
import json, os, sys, time, urllib.request, urllib.error, urllib.parse
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "etf_flows.json")
KEY = os.environ.get("SOSO_API_KEY", "").strip()
BASE = os.environ.get("SOSO_BASE", "https://openapi.sosovalue.com/openapi/v1").rstrip("/")
GAP = float(os.environ.get("SOSO_GAP", "3.3"))  # seconds between calls (20/min limit)
ASSETS = [("BTC", "US"), ("ETH", "US"), ("SOL", "US"), ("XRP", "US"), ("LTC", "US"), ("DOGE", "US"), ("HBAR", "US"), ("LINK", "US"), ("AVAX", "US"), ("DOT", "US"),
          ("BTC", "HK"), ("ETH", "HK"), ("SOL", "HK")]
NAMES = {"BTC": "Bitcoin", "ETH": "Ether", "SOL": "Solana", "XRP": "XRP", "LTC": "Litecoin", "DOGE": "Dogecoin", "HBAR": "Hedera", "LINK": "Chainlink", "AVAX": "Avalanche", "DOT": "Polkadot"}
_last = 0.0


def get(path, params=None, tries=4):
    global _last
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    for i in range(tries):
        wait = GAP - (time.time() - _last)
        if wait > 0:
            time.sleep(wait)
        _last = time.time()
        try:
            req = urllib.request.Request(url, headers={"x-soso-api-key": KEY, "User-Agent": "TTMMarketsTerminalBot/1.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=40) as r:
                j = json.loads(r.read().decode("utf-8"))
            if isinstance(j, dict) and "data" in j and isinstance(j["data"], (list, dict)):
                return j["data"]
            return j
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(25 + i * 10); continue
            if e.code in (400, 404):
                return None
            print("  HTTP", e.code, path); time.sleep(3)
        except Exception as e:  # network hiccup
            print("  error", path, str(e)[:80]); time.sleep(3)
    return None


def num(v):
    try:
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def main():
    if not KEY:
        print("SOSO_API_KEY is not set. Add it under Settings > Secrets and variables > Actions, then run this job again. Nothing written.")
        return 0
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": "SoSoValue", "assets": []}
    for sym, cc in ASSETS:
        print(sym, cc, flush=True)
        funds = get("/etfs", {"symbol": sym, "country_code": cc})
        if not isinstance(funds, list) or not funds:
            print("  no funds listed"); continue
        summ = get("/etfs/summary-history", {"symbol": sym, "country_code": cc, "limit": 120}) or []
        rows = [{"d": r.get("date"), "flow": num(r.get("total_net_inflow")), "assets": num(r.get("total_net_assets")), "cum": num(r.get("cum_net_inflow")), "traded": num(r.get("total_value_traded"))} for r in summ if isinstance(r, dict) and r.get("date")]
        rows.sort(key=lambda r: r["d"])
        rows = [r for r in rows if r["flow"] is not None or r["assets"] is not None]
        fl = []
        for f in funds[:25]:
            t = f.get("ticker")
            if not t:
                continue
            h = get("/etfs/%s/history" % urllib.parse.quote(str(t))) or []
            hist = sorted([x for x in h if isinstance(x, dict) and x.get("date") and num(x.get("net_inflow")) is not None], key=lambda x: x["date"])
            last = hist[-1] if hist else {}
            fl.append({"t": t, "n": f.get("name"), "ex": f.get("exchange"), "d": last.get("date"), "flow": num(last.get("net_inflow")), "cum": num(last.get("cum_inflow")), "assets": num(last.get("net_assets")), "prem": num(last.get("prem_dsc")),
                       "traded": num(last.get("value_traded")), "hist": [{"d": x["date"], "flow": num(x.get("net_inflow"))} for x in hist[-30:]]})
        fl.sort(key=lambda x: -(x["assets"] or 0))
        out["assets"].append({"sym": sym, "cc": cc, "name": NAMES.get(sym, sym), "series": rows, "funds": fl})
    if not out["assets"]:
        print("No data came back, keeping the previous file."); return 0
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print("wrote", OUT, len(out["assets"]), "assets")
    return 0


if __name__ == "__main__":
    sys.exit(main())
