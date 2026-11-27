#!/usr/bin/env python3
"""Market maker tracker -> mm_positions.json (Hyperliquid long/short, public) and mm_moves.json (large wallet moves on ETH, BTC, SOL, XRP).
Wallets come from data/mm_wallets.json (each with a public source). Only public, keyless endpoints are used.
Every wallet and chain is wrapped so one failure never stops the job."""
import json, os, sys, time, traceback, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOCUS = ["BTC", "ETH", "XRP", "SOL"]
MIN_MOVE_USD = 250_000
UA = {"User-Agent": "ttm-terminal/1.0", "Content-Type": "application/json"}


def http(url, body=None, timeout=25):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def load(name, default):
    try:
        return json.load(open(os.path.join(ROOT, name)))
    except Exception:  # noqa
        return default


def prices():
    p = {}
    try:
        for c in load("rsi_heatmap.json", {}).get("coins", []):
            if "p" in c:
                p[c["s"]] = float(c["p"])
    except Exception:  # noqa
        pass
    return p


def hl_state(addr):
    j = http("https://api.hyperliquid.xyz/info", {"type": "clearinghouseState", "user": addr})
    ms = j.get("marginSummary", {})
    pos = []
    for ap in j.get("assetPositions", []):
        q = ap.get("position", {})
        szi = float(q.get("szi", 0) or 0)
        if not szi:
            continue
        lev = q.get("leverage") or {}
        pos.append({"coin": q.get("coin"), "side": "long" if szi > 0 else "short", "size": abs(szi),
                    "notional": float(q.get("positionValue", 0) or 0), "entry": float(q.get("entryPx", 0) or 0),
                    "upnl": float(q.get("unrealizedPnl", 0) or 0), "lev": lev.get("value"), "liq": q.get("liquidationPx")})
    return {"equity": float(ms.get("accountValue", 0) or 0), "positions": pos}


def run_positions(wallets, hist, now):
    out, snap = [], {}
    for w in wallets:
        if w.get("venue") != "hyperliquid":
            continue
        try:
            st = hl_state(w["address"])
        except Exception:  # noqa
            print("hyperliquid failed", w["id"]); traceback.print_exc(file=sys.stdout)
            continue
        signed = {p["coin"]: (p["notional"] if p["side"] == "long" else -p["notional"]) for p in st["positions"]}
        snap[w["id"]] = signed
        longs = sum(p["notional"] for p in st["positions"] if p["side"] == "long")
        shorts = sum(p["notional"] for p in st["positions"] if p["side"] == "short")
        # compare with the snapshot closest to 24h ago
        prev = None
        for h in hist:
            if h["t"] <= now - 23 * 3600 and w["id"] in h["w"]:
                prev = h["w"][w["id"]]
        focus = []
        for c in FOCUS:
            p = next((x for x in st["positions"] if x["coin"] == c), None)
            cur = signed.get(c, 0.0)
            chg = None
            if prev is not None:
                old = prev.get(c, 0.0)
                if old == 0 and cur != 0:
                    chg = "opened " + ("long" if cur > 0 else "short")
                elif old != 0 and cur == 0:
                    chg = "closed"
                elif old * cur < 0:
                    chg = "flipped to " + ("long" if cur > 0 else "short")
                elif old != 0 and abs(cur - old) / abs(old) >= 0.1:
                    chg = ("added " if abs(cur) > abs(old) else "reduced ") + f"{abs(cur - old) / abs(old) * 100:.0f}%"
            focus.append({"coin": c, "side": p["side"] if p else "flat", "notional": p["notional"] if p else 0, "entry": p["entry"] if p else None,
                          "upnl": p["upnl"] if p else 0, "lev": p["lev"] if p else None, "liq": p["liq"] if p else None, "change24h": chg})
        out.append({"id": w["id"], "firm": w["firm"], "address": w["address"], "label": w.get("label"), "source": w.get("source"),
                    "attribution": w.get("attribution"), "equity": st["equity"], "longs": longs, "shorts": shorts, "focus": focus,
                    "others": sorted([p for p in st["positions"] if p["coin"] not in FOCUS], key=lambda p: -p["notional"])[:40],
                    "has24h": prev is not None})
    return out, snap


# ---- large wallet moves (public explorers, no key)
def eth_moves(addr, px):
    a = addr.lower(); res = []
    j = http(f"https://eth.blockscout.com/api/v2/addresses/{addr}/transactions")
    for t in j.get("items", [])[:50]:
        v = int(t.get("value", "0") or 0) / 1e18
        if v <= 0 or t.get("result") not in (None, "success"):
            continue
        fr = (t.get("from") or {}).get("hash", "").lower(); to = ((t.get("to") or {}) or {}).get("hash", "").lower()
        out = fr == a
        ts = int(datetime.fromisoformat(t["timestamp"].replace("Z", "+00:00")).timestamp())
        res.append({"t": ts, "coin": "ETH", "dir": "out" if out else "in", "amount": v, "usd": v * px.get("ETH", 0), "cp": to if out else fr, "tx": t["hash"], "url": "https://etherscan.io/tx/" + t["hash"]})
    return res


def btc_moves(addr, px):
    res = []
    for t in http(f"https://mempool.space/api/address/{addr}/txs")[:25]:
        inn = sum(i.get("prevout", {}).get("value", 0) for i in t["vin"] if i.get("prevout", {}).get("scriptpubkey_address") == addr)
        outv = sum(o.get("value", 0) for o in t["vout"] if o.get("scriptpubkey_address") == addr)
        net = (outv - inn) / 1e8
        if net == 0 or not t.get("status", {}).get("block_time"):
            continue
        others = sorted([o for o in t["vout"] if o.get("scriptpubkey_address") not in (addr, None)], key=lambda o: -o["value"])
        res.append({"t": t["status"]["block_time"], "coin": "BTC", "dir": "in" if net > 0 else "out", "amount": abs(net), "usd": abs(net) * px.get("BTC", 0),
                    "cp": others[0]["scriptpubkey_address"] if others else "", "tx": t["txid"], "url": "https://mempool.space/tx/" + t["txid"]})
    return res


def sol_moves(addr, px):
    res = []
    sigs = http("https://api.mainnet-beta.solana.com", {"jsonrpc": "2.0", "id": 1, "method": "getSignaturesForAddress", "params": [addr, {"limit": 12}]}).get("result", [])
    for s in sigs:
        if s.get("err"):
            continue
        tx = http("https://api.mainnet-beta.solana.com", {"jsonrpc": "2.0", "id": 1, "method": "getTransaction", "params": [s["signature"], {"encoding": "json", "maxSupportedTransactionVersion": 0}]}).get("result")
        if not tx:
            continue
        keys = tx["transaction"]["message"]["accountKeys"]
        if addr not in keys:
            continue
        i = keys.index(addr); d = (tx["meta"]["postBalances"][i] - tx["meta"]["preBalances"][i]) / 1e9
        if abs(d) < 1:
            continue
        res.append({"t": tx.get("blockTime") or s.get("blockTime"), "coin": "SOL", "dir": "in" if d > 0 else "out", "amount": abs(d), "usd": abs(d) * px.get("SOL", 0),
                    "cp": "", "tx": s["signature"], "url": "https://solscan.io/tx/" + s["signature"]})
        time.sleep(0.4)
    return res


def xrp_moves(addr, px):
    res = []
    j = http("https://s1.ripple.com:51234/", {"method": "account_tx", "params": [{"account": addr, "limit": 25}]}).get("result", {})
    for x in j.get("transactions", []):
        t = x.get("tx", {})
        if t.get("TransactionType") != "Payment" or not isinstance(t.get("Amount"), str) or not x.get("validated"):
            continue
        v = int(t["Amount"]) / 1e6
        out = t.get("Account") == addr
        res.append({"t": int(t.get("date", 0)) + 946684800, "coin": "XRP", "dir": "out" if out else "in", "amount": v, "usd": v * px.get("XRP", 0),
                    "cp": t.get("Destination") if out else t.get("Account"), "tx": t["hash"], "url": "https://xrpscan.com/tx/" + t["hash"]})
    return res


FETCH = {"eth": eth_moves, "btc": btc_moves, "sol": sol_moves, "xrp": xrp_moves}


def run_moves(wallets, px, now):
    old = load("mm_moves.json", {"moves": []}).get("moves", [])
    seen = {m["tx"] + m["firm"] + m["coin"] for m in old}
    new = []
    for w in wallets:
        fn = FETCH.get(w.get("venue"))
        if not fn:
            continue
        try:
            for m in fn(w["address"], px):
                m["firm"] = w["firm"]; m["wallet"] = w["id"]
                if m["usd"] >= MIN_MOVE_USD and m["tx"] + m["firm"] + m["coin"] not in seen:
                    new.append(m)
        except Exception:  # noqa
            print("moves failed", w["id"]); traceback.print_exc(file=sys.stdout)
    moves = [m for m in new + old if m["t"] >= now - 30 * 86400]
    moves.sort(key=lambda m: -m["t"])
    return moves[:300]


def main():
    reg = load("data/mm_wallets.json", {"wallets": []})
    wallets = reg.get("wallets", [])
    now = int(time.time()); px = prices()
    hist = load("mm_history.json", {"snaps": []}).get("snaps", [])
    pos, snap = run_positions(wallets, hist, now)
    if snap:
        hist.append({"t": now, "w": snap})
    hist = [h for h in hist if h["t"] >= now - 8 * 86400]
    moves = run_moves(wallets, px, now)
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    json.dump({"updated": stamp, "wallets": pos, "tracked": len(wallets)}, open(os.path.join(ROOT, "mm_positions.json"), "w"), indent=1)
    json.dump({"updated": stamp, "moves": moves, "min_usd": MIN_MOVE_USD, "chains": sorted({w["venue"] for w in wallets if w.get("venue") in FETCH})}, open(os.path.join(ROOT, "mm_moves.json"), "w"), indent=1)
    json.dump({"snaps": hist}, open(os.path.join(ROOT, "mm_history.json"), "w"))
    print("positions", len(pos), "wallets; moves", len(moves))


if __name__ == "__main__":
    main()
