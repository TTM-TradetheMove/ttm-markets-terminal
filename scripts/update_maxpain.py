#!/usr/bin/env python3
"""Options max pain  ->  maxpain.json

Pulls every listed option from Deribit's free public API (no key) for BTC, ETH, SOL, XRP and the USDC-settled
altcoin options, then for each expiry works out:
  - open interest per strike (calls and puts)
  - the "max pain" strike: the settlement price at which option buyers lose the most
    (total payout to holders of calls and puts is smallest there)
  - put/call open-interest ratio, and the total pain curve for charting
Open interest is in the underlying coin (1 contract = 1 coin on Deribit).
"""
import json, os, re, sys, time, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"}
API = "https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency={c}&kind=option"
MAX_EXPIRIES = 8
MON = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
NAME = re.compile(r"^(?:(?P<u>[A-Z0-9]+)_USDC|(?P<c>[A-Z0-9]+))-(?P<d>\d{1,2})(?P<m>[A-Z]{3})(?P<y>\d{2})-(?P<k>[\d.]+)-(?P<t>[CP])$")


def getj(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa
            if i == tries - 1:
                print(f"  GET fail {url[:80]} -> {type(e).__name__}: {e}")
                return None
            time.sleep(2 * (i + 1))


def parse(inst):
    m = NAME.match(inst or "")
    if not m or m["m"] not in MON:
        return None
    # Deribit options expire 08:00 UTC
    exp = datetime(2000 + int(m["y"]), MON[m["m"]], int(m["d"]), 8, tzinfo=timezone.utc)
    return (m["u"] or m["c"]), exp, float(m["k"]), m["t"]


def pain_curve(strikes, calls, puts):
    """Total payout (in USD) to all option holders if the coin settled exactly at each strike."""
    out = []
    for s in strikes:
        tot = 0.0
        for k in strikes:
            if s > k:
                tot += (s - k) * calls.get(k, 0.0)
            if s < k:
                tot += (k - s) * puts.get(k, 0.0)
        out.append(tot)
    return out


def build_expiry(exp, rows, spot, now):
    strikes = sorted({k for k, _, _ in rows})
    calls, puts = {}, {}
    for k, t, oi in rows:
        (calls if t == "C" else puts)[k] = calls.get(k, 0.0) + oi if t == "C" else puts.get(k, 0.0) + oi
    pain = pain_curve(strikes, calls, puts)
    if not strikes or max(pain) <= 0:
        return None
    mp = strikes[pain.index(min(pain))]
    co, po = sum(calls.values()), sum(puts.values())
    # keep the chart readable: strikes within a band around spot / max pain, but never drop big open interest
    lo, hi = spot * 0.5, spot * 1.6
    keep = [i for i, k in enumerate(strikes) if lo <= k <= hi or calls.get(k, 0) + puts.get(k, 0) >= 0.02 * (co + po)]
    return {
        "exp": exp.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "label": exp.strftime("%d %b %Y"),
        "days": round((exp - now).total_seconds() / 86400, 2),
        "max_pain": mp,
        "call_oi": round(co, 2), "put_oi": round(po, 2),
        "pc": round(po / co, 2) if co else None,
        "notional": round((co + po) * spot),
        "strikes": [{"k": strikes[i], "c": round(calls.get(strikes[i], 0), 2), "p": round(puts.get(strikes[i], 0), 2),
                     "pain": round(pain[i])} for i in keep],
    }


def main():
    now = datetime.now(timezone.utc)
    by = {}  # underlying -> {"spot": x, "exp": {expiry: [(k,t,oi)]}}
    for cur in ["BTC", "ETH", "SOL", "XRP", "USDC"]:
        d = getj(API.format(c=cur))
        res = (d or {}).get("result") or []
        print(f"{cur}: {len(res)} instruments")
        for r in res:
            p = parse(r.get("instrument_name"))
            if not p:
                continue
            und, exp, k, t = p
            if exp <= now:
                continue
            oi = float(r.get("open_interest") or 0)
            up = float(r.get("underlying_price") or 0)
            if oi <= 0 or up <= 0:
                continue
            u = by.setdefault(und, {"spot": up, "exp": {}})
            u["spot"] = up
            u["exp"].setdefault(exp, []).append((k, t, oi))
    coins = {}
    for und, u in by.items():
        exps = []
        for exp in sorted(u["exp"])[:MAX_EXPIRIES * 2]:
            e = build_expiry(exp, u["exp"][exp], u["spot"], now)
            if e and e["call_oi"] + e["put_oi"] > 0:
                exps.append(e)
            if len(exps) >= MAX_EXPIRIES:
                break
        if exps:
            tot = sum(e["notional"] for e in exps)
            coins[und] = {"spot": u["spot"], "oi_usd": tot, "expiries": exps}
    if not coins:
        print("No option data fetched; leaving maxpain.json unchanged")
        return 0
    out = {"generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "Deribit",
           "coins": dict(sorted(coins.items(), key=lambda kv: -kv[1]["oi_usd"]))}
    with open(os.path.join(ROOT, "maxpain.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {len(coins)} coins: {', '.join(out['coins'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
