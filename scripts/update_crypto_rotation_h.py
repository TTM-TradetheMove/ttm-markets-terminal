#!/usr/bin/env python3
"""Hourly prices (last 14 days) for the Crypto Rotation page -> crypto_rotation_h.json

Powers the 4H / 8H / 12H / 1D views. Built to survive CoinGecko's free rate limits:
 * every run takes ONE live snapshot of all tokens (2 cheap bulk calls) and adds it to the hourly history
 * every run also back-fills a small batch of tokens whose 14-day hourly history is still incomplete
Within a few runs every token is complete, and after that each run is just the cheap snapshot.
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
    started = time.time()
    ids = list(dict.fromkeys(R.BENCH + [c for s in R.SECTORS for c in s[2]]))
    LIMIT = int(os.environ.get("LIMIT") or (100 if R.KEY else 40))
    try:
        prev = json.load(open(OUT))
    except Exception:
        prev = {}
    pc, pt0 = prev.get("coins", {}), prev.get("t0")
    now = int(time.time() * 1000)
    t0 = (now // H) * H - (N - 1) * H
    off = int((t0 - pt0) // H) if pt0 else None
    coins = {}
    for cid in ids:
        a = pc.get(cid)
        if a and off is not None and 0 <= off < N:
            coins[cid] = a[off:] + [None] * off
        else:
            coins[cid] = [None] * N
    snap = 0
    for k in range(0, len(ids), 100):
        m = R.getj("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&ids=" + ",".join(ids[k:k + 100]), tries=3)
        for c in (m or []):
            if c.get("id") in coins and c.get("current_price") is not None:
                coins[c["id"]][-1] = R.r6(c["current_price"])
                snap += 1
        time.sleep(2)
    if snap < 30:
        status("could not take the live snapshot (rate-limited); kept the old file", snap=snap)
        sys.exit(0)
    cov = lambda c: sum(1 for v in coins[c] if v is not None)
    todo = sorted([c for c in ids if cov(c) < N * 0.9], key=lambda c: (c not in R.BENCH, cov(c)))[:LIMIT]
    got = 0
    for cid in todo:
        if time.time() - started > 24 * 60:
            break
        d = R.getj(f"https://api.coingecko.com/api/v3/coins/{cid}/market_chart?vs_currency=usd&days=14", tries=2)
        time.sleep(2.2 if R.KEY else 3.6)
        if not d or not d.get("prices"):
            continue
        fresh = R.day_grid_step(d["prices"], t0, N, H)
        a = coins[cid]
        for j in range(N):
            if a[j] is None and fresh[j] is not None:
                a[j] = R.r6(fresh[j])
        got += 1
    if "bitcoin" not in coins or cov("bitcoin") < 24:
        status("Bitcoin history not ready yet; will keep filling", snap=snap, filled=got)
        sys.exit(0)
    json.dump({"generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "t0": t0, "step": H, "n": N, "coins": coins}, open(OUT, "w"), separators=(",", ":"))
    status("ok", snap=snap, filled=got, incomplete=len([c for c in ids if cov(c) < N * .9]), bytes=os.path.getsize(OUT))


if __name__ == "__main__":
    main()
