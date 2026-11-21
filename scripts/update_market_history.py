#!/usr/bin/env python3
"""Long history (2010s onward) for the TTM Crypto Market series  ->  crypto_market_history.json (+ crypto_market_history_status.json)

TradingView's CRYPTOCAP series go back to 2013. CoinGecko's free feed only gives ~1 year, so older days are built from
Coin Metrics community data (market cap per coin, daily) for the biggest coins, then joined to the CoinGecko-based
series in crypto_market.json so the line is continuous (each series is scaled by the median ratio over the overlap).
Before ~2017 the market was almost all BTC, so TOTAL is dominated by it; old OTHERS / TOTAL3 are approximations.
Env: CSV_DIR=path to a folder of <coin>.csv files (tests, offline).
"""
import csv, io, json, os, statistics, sys, time, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "crypto_market_history.json")
STATUS = os.path.join(ROOT, "crypto_market_history_status.json")
CUR = os.path.join(ROOT, "crypto_market.json")
BASE = "https://raw.githubusercontent.com/coinmetrics/data/master/csv/%s.csv"
COINS = ["btc", "eth", "usdt", "usdc", "bnb", "xrp", "ada", "doge", "sol", "trx", "ltc", "bch", "link", "xlm", "dot", "avax",
         "xmr", "etc", "dai", "busd", "tusd", "matic", "shib", "uni", "atom", "near", "algo", "vet", "fil", "icp", "eos", "xtz", "neo", "dash", "zec", "mkr", "aave", "ftt", "cro", "leo"]
TOP10 = ["btc", "eth", "usdt", "bnb", "xrp", "usdc", "sol", "trx", "doge", "ada"]
KEYS = ("BTC.D", "USDT.D", "USDC.D", "OTHERS.D", "TOTAL", "TOTAL3", "OTHERS", "OTHERSBTC", "(OTHERS-USDT)/BTC", "(TOTAL3-USDT)/BTC")
D = 86400000


def fetch(coin):
    d = os.environ.get("CSV_DIR")
    if d:
        p = os.path.join(d, coin + ".csv")
        return open(p).read() if os.path.exists(p) else None
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(BASE % coin, headers={"User-Agent": "TTMBot/1.0"}), timeout=90) as r:
                return r.read().decode()
        except Exception as ex:
            if getattr(ex, "code", None) == 404:
                return None
            time.sleep(4 * (i + 1))
    return None


def parse(txt):
    """-> {day_index: (marketcap, price)}"""
    out = {}
    for row in csv.DictReader(io.StringIO(txt)):
        try:
            t = int(datetime.strptime(row["time"][:10], "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1000) // D
        except Exception:
            continue
        def f(k):
            try:
                v = float(row.get(k) or "")
                return v if v > 0 else None
            except Exception:
                return None
        px = f("PriceUSD")
        cap = f("CapMrktCurUSD")
        if cap is None and px and f("SplyCur"):
            cap = px * f("SplyCur")
        if cap:
            out[t] = (cap, px)
    return out


def main():
    st = {"started": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "coins": {}, "ok": False}
    data = {}
    for c in COINS:
        txt = fetch(c)
        if not txt:
            st["coins"][c] = "missing"
            continue
        p = parse(txt)
        if p:
            data[c] = p
            st["coins"][c] = "%d days, %s to %s" % (len(p), datetime.fromtimestamp(min(p) * 86400, timezone.utc).date(), datetime.fromtimestamp(max(p) * 86400, timezone.utc).date())
        else:
            st["coins"][c] = "no market cap column"
    if "btc" not in data:
        st["error"] = "no bitcoin data; kept previous file"
        json.dump(st, open(STATUS, "w"), indent=1)
        print(st["error"])
        return
    days = range(min(data["btc"]), max(max(v) for v in data.values()) + 1)
    s = {k: [] for k in KEYS}
    for dix in days:
        cap = {}
        for c, p in data.items():
            if dix in p:
                cap[c] = p[dix][0]
            else:                                     # a day missing in one coin: carry its last known value (up to 5 days)
                for b in range(1, 6):
                    if dix - b in p:
                        cap[c] = p[dix - b][0]
                        break
        btc = cap.get("btc")
        total = sum(cap.values())
        if not btc or total <= 0:
            for k in KEYS:
                s[k].append(None)
            continue
        eth, usdt, usdc = cap.get("eth", 0), cap.get("usdt", 0), cap.get("usdc", 0)
        others = total - sum(cap.get(c, 0) for c in TOP10)
        total3 = total - btc - eth
        bp = data["btc"].get(dix, (0, 0))[1]
        s["BTC.D"].append(btc / total * 100); s["USDT.D"].append(usdt / total * 100); s["USDC.D"].append(usdc / total * 100); s["OTHERS.D"].append(others / total * 100)
        s["TOTAL"].append(total / 1e9); s["TOTAL3"].append(total3 / 1e9); s["OTHERS"].append(others / 1e9)
        s["OTHERSBTC"].append(others / bp if bp else None)
        s["(OTHERS-USDT)/BTC"].append((others - usdt) / btc); s["(TOTAL3-USDT)/BTC"].append((total3 - usdt) / btc)
    t0 = days[0] * D
    n = len(days)
    # join to the CoinGecko-based daily series: scale each series by the median ratio over the overlap (last 60 shared days)
    scale = {}
    try:
        cur = json.load(open(CUR))["d"]
        for k in KEYS:
            rs = []
            for j, v in enumerate(cur["s"].get(k, [])):
                i = (cur["t0"] + j * cur["step"] - t0) // D
                if v and 0 <= i < n and s[k][i]:
                    rs.append(v / s[k][i])
            rs = rs[-60:]
            scale[k] = statistics.median(rs) if len(rs) >= 10 else 1.0
        st["scale"] = {k: round(v, 4) for k, v in scale.items()}
    except Exception as ex:
        st["scale_note"] = "no current series to join to (%s); unscaled" % type(ex).__name__
    for k in KEYS:
        m = scale.get(k, 1.0)
        dp = 6 if "/" in k else 3
        s[k] = [None if v is None else round(v * m, dp if k not in ("OTHERSBTC",) else 0) for v in s[k]]
    # Coin Metrics community data can run months behind. Past its last day, carry on with the CoinGecko-based daily series (already on the same scale).
    try:
        cur = json.load(open(CUR))["d"]
        add = {}
        for k in KEYS:
            for j, v in enumerate(cur["s"].get(k, [])):
                i = (cur["t0"] + j * cur["step"] - t0) // D
                if i >= n and v is not None:
                    add.setdefault(i, {})[k] = v
        if add:
            new_n = max(add) + 1
            for k in KEYS:
                last = s[k][-1] if s[k] else None
                for i in range(n, new_n):
                    v = add.get(i, {}).get(k, last)
                    s[k].append(v)
                    last = v if v is not None else last
            st["extended_from_coingecko"] = "%d days after %s" % (new_n - n, datetime.fromtimestamp((t0 + (n - 1) * D) / 1000, timezone.utc).date())
            n = new_n
    except Exception as ex:
        st["extend_note"] = "could not extend (%s)" % type(ex).__name__
    out = {"generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "source": "Coin Metrics community data, joined to CoinGecko-based series",
           "t0": t0, "step": D, "n": n, "s": s}
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    st.update(ok=True, days=n, first_day=str(datetime.fromtimestamp(t0 / 1000, timezone.utc).date()), last_day=str(datetime.fromtimestamp((t0 + (n - 1) * D) / 1000, timezone.utc).date()), bytes=os.path.getsize(OUT))
    json.dump(st, open(STATUS, "w"), indent=1)
    print("wrote", OUT, st["days"], "days from", st["first_day"], "to", st["last_day"])


if __name__ == "__main__":
    main()
