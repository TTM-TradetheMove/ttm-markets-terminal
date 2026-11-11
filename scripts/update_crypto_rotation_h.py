#!/usr/bin/env python3
"""Hourly prices (last 14 days) for the Crypto Rotation page -> crypto_rotation_h.json

Powers the 4H / 8H / 12H / 1D views. Same token list as update_crypto_rotation.py.
Keeps the previous hourly series for any token that fails this run, so one rate-limit hiccup never blanks the page.
"""
import json, os, sys, time
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import update_crypto_rotation as R

ROOT = R.ROOT
OUT = os.path.join(ROOT, "crypto_rotation_h.json")
STATUS = os.path.join(ROOT, "crypto_rotation_h_status.json")
H = 3600000
N = 14 * 24


def status(msg, **kw):
    kw.update({"at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "msg": msg})
    json.dump(kw, open(STATUS, "w"))
    print(msg, kw, flush=True)


def main():
    ids = list(dict.fromkeys(R.BENCH + [c for s in R.SECTORS for c in s[2]]))
    try:
        prev = json.load(open(OUT)).get("coins", {})
    except Exception:
        prev = {}
    now = int(time.time() * 1000)
    t0 = (now // H) * H - (N - 1) * H
    coins, fails = {}, 0
    for cid in ids:
        d = R.getj(f"https://api.coingecko.com/api/v3/coins/{cid}/market_chart?vs_currency=usd&days=14", tries=2)
        if d and d.get("prices"):
            coins[cid] = [R.r6(v) for v in R.day_grid_step(d["prices"], t0, N, H)]
        else:
            fails += 1
            if cid in prev:
                coins[cid] = prev[cid]
        time.sleep(2.2 if R.KEY else 3.6)
    if len(coins) < 60 or "bitcoin" not in coins:
        status("too few tokens returned hourly data; no file written", coins=len(coins), fails=fails)
        sys.exit(0)
    json.dump({"generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "t0": t0, "step": H, "n": N, "coins": coins}, open(OUT, "w"), separators=(",", ":"))
    status("ok", coins=len(coins), fails=fails, bytes=os.path.getsize(OUT))


if __name__ == "__main__":
    main()
