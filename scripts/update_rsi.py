#!/usr/bin/env python3
"""RSI heatmap  ->  rsi_heatmap.json

RSI(14, Wilder smoothing) for ~40 major coins across 15m / 1h / 4h / 12h / 1d / 1w, from OKX's public
candle API (free, no key, not geo-blocked). Also stores last price and 24h change from OKX tickers.
The newest, still-forming candle is included, like exchange charts show it.
OKX has no 8H bar, so 8h is built from pairs of 4H candles aligned to 00:00 / 08:00 / 16:00 UTC.
"""
import json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"}
TFS = [("15m", "15m"), ("1h", "1H"), ("4h", "4H"), ("8h", "8H"), ("12h", "12H"), ("1d", "1D"), ("1w", "1W")]
FETCHES = [("15m", "15m"), ("1H", "1H"), ("4H", "4H"), ("12H", "12H"), ("1D", "1D"), ("1W", "1W")]  # one API call each; 8h is built from 4H
COINS = ["BTC", "ETH", "XRP", "BNB", "SOL", "DOGE", "TRX", "ADA", "HYPE", "LINK", "XLM", "SUI", "BCH", "AVAX",
         "LTC", "HBAR", "TON", "DOT", "UNI", "AAVE", "NEAR", "APT", "ARB", "OP", "ATOM", "FIL", "ETC", "ICP",
         "INJ", "PEPE", "SHIB", "TAO", "ONDO", "WLD", "CRV", "ENA", "SEI", "TIA", "JUP", "RENDER",
         # added: the next ~100 by size / activity
         "OKB", "CRO", "POL", "MNT", "ALGO", "VET", "KAS", "ZEC", "XMR", "DASH", "S", "PENGU", "TRUMP", "BONK", "WIF",
         "FLOKI", "FET", "VIRTUAL", "ARKM", "AKT", "GRT", "AR", "STX", "IMX", "STRK", "ZK", "MKR", "LDO", "SNX", "COMP",
         "SUSHI", "1INCH", "DYDX", "GMX", "PENDLE", "RUNE", "CAKE", "ETHFI", "EIGEN", "BAL", "YFI", "SSV", "RPL", "ENS",
         "PYTH", "W", "ZRO", "AXL", "QNT", "IOTA", "ANKR", "BAT", "THETA", "OM", "POLYX", "CFG", "GT", "AXS", "SAND",
         "MANA", "GALA", "ENJ", "APE", "ILV", "PIXEL", "BEAM", "YGG", "MEME", "NEIRO", "TURBO", "POPCAT", "MOODENG",
         "XTZ", "EOS", "FLOW", "KAVA", "MINA", "ZIL", "CFX", "EGLD", "XDC", "LRC", "METIS", "API3", "IOTX", "NEO", "QTUM",
         # smart contract platforms
         "BERA", "MOVE", "IP", "KAIA", "CORE", "CELO", "ROSE", "ONE", "KSM", "GLMR", "ASTR", "ZETA", "ONT", "ICX", "WAVES", "XEM", "SCRT", "RVN", "AVAIL", "SONIC", "MON", "MEGA", "INIT", "SOON", "TREE", "STO", "BABY", "ZRC", "AERGO", "ELF"]
CATEGORIES = {
    "Layer 1": "BTC ETH BNB SOL ADA TRX AVAX DOT TON NEAR APT SUI ATOM ICP ALGO HBAR SEI TIA INJ XTZ EOS FLOW KAVA MINA ZIL CFX EGLD KAS S XDC ETC VET NEO QTUM IOTA",
    "Layer 2": "ARB OP POL IMX STRK ZK MNT METIS LRC STX",
    "DeFi": "UNI AAVE MKR CRV LDO SNX COMP SUSHI 1INCH DYDX GMX PENDLE ENA JUP RUNE CAKE ETHFI EIGEN BAL YFI SSV RPL HYPE",
    "Meme": "DOGE SHIB PEPE WIF BONK FLOKI TRUMP MEME NEIRO TURBO POPCAT MOODENG PENGU",
    "AI": "TAO RENDER FET WLD VIRTUAL ARKM AKT",
    "Gaming & NFT": "AXS SAND MANA GALA ENJ APE ILV PIXEL BEAM YGG",
    "Infrastructure": "LINK GRT FIL AR ENS PYTH W ZRO AXL QNT ANKR BAT THETA API3 IOTX",
    "Payments": "XRP XLM LTC BCH",
    "Privacy": "XMR ZEC DASH",
    "RWA": "ONDO OM POLYX CFG",
    "Exchange": "OKB CRO GT",
    "Smart Contract": "BERA MOVE IP KAIA CORE CELO ROSE ONE KSM GLMR ASTR ZETA ONT ICX WAVES SCRT AVAIL SONIC MON INIT",
}
CAT_OF = {sym: cat for cat, syms in CATEGORIES.items() for sym in syms.split()}
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


HOUR = 3600 * 1000


def vol_stats(buckets):
    """buckets: oldest-first [(ts, close, quote_volume, complete)]. -> (relative volume x avg of the 20 before, last completed candle's USDT volume)"""
    done = [b for b in buckets if b[3]]
    if len(done) < 6:
        return None, None, None
    last, prev = done[-1][2], [b[2] for b in done[-21:-1]]
    avg = sum(prev) / len(prev) if prev else 0
    op, cl = done[-1][4], done[-1][1]  # direction of the last completed candle: close vs open, in %
    return (round(last / avg, 2) if avg > 0 else None), round(last), (round((cl / op - 1) * 100, 2) if op else None)


def one(job):
    """One API call for a bar size -> {label: (rsi, relative volume, last-candle USDT volume)}"""
    sym, bar = job
    time.sleep(0.25)
    d = getj(f"https://www.okx.com/api/v5/market/candles?instId={sym}-USDT&bar={bar}&limit=300")
    if not d or d.get("code") != "0" or not d.get("data"):
        return sym, {}
    rows = sorted(d["data"], key=lambda c: int(c[0]))  # API returns newest first
    qv = lambda c: float(c[7]) if len(c) > 7 and c[7] not in ("", None) else 0.0
    out = {}
    label = {"15m": "15m", "1H": "1h", "4H": "4h", "12H": "12h", "1D": "1d", "1W": "1w"}[bar]
    base = [(int(c[0]), float(c[4]), qv(c), (c[8] == "1") if len(c) > 8 else True, float(c[1])) for c in rows]
    out[label] = (rsi([b[1] for b in base][-200:]),) + vol_stats(base)
    if bar == "4H":  # 8h = pairs of 4H candles aligned to 00:00 / 08:00 / 16:00 UTC
        now_ms, groups = int(time.time() * 1000), {}
        for ts, close, q, _, o in base:
            g = groups.setdefault(ts // (8 * HOUR), [0, 0.0, o])  # [close, volume, open of the first 4H candle]
            g[0] = close
            g[1] += q
        b8 = [(k * 8 * HOUR, v[0], v[1], (k + 1) * 8 * HOUR <= now_ms, v[2]) for k, v in sorted(groups.items())]
        out["8h"] = (rsi([b[1] for b in b8]),) + vol_stats(b8)
    return sym, out


def main():
    tick = getj("https://www.okx.com/api/v5/market/tickers?instType=SPOT") or {}
    tk = {}
    for t in tick.get("data", []):
        if t["instId"].endswith("-USDT"):
            try:
                last, op = float(t["last"]), float(t["open24h"])
                tk[t["instId"][:-5]] = (last, round((last / op - 1) * 100, 2) if op else None, round(float(t.get("volCcy24h") or 0)))
            except Exception:
                pass
    coins = [c for c in COINS if c in tk]
    log(f"{len(coins)}/{len(COINS)} coins listed on OKX spot; not listed: {[c for c in COINS if c not in tk]}")
    jobs = [(c, bar) for c in coins for _, bar in FETCHES]
    res = {}
    with ThreadPoolExecutor(max_workers=3) as ex:
        for sym, got in ex.map(one, jobs):
            res.setdefault(sym, {}).update(got)
    out = []
    for c in coins:
        r = res.get(c, {})
        if sum(1 for v in r.values() if v[0] is not None) < 3:
            continue
        tfl = [l for l, _ in TFS]
        out.append({"s": c, "p": tk[c][0], "c": tk[c][1], "cat": CAT_OF.get(c, "Other"), "v24": tk[c][2],
                    "r": {l: (r[l][0] if l in r else None) for l in tfl},
                    "vr": {l: (r[l][1] if l in r else None) for l in tfl},
                    "vq": {l: (r[l][2] if l in r else None) for l in tfl},
                    "vd": {l: (r[l][3] if l in r else None) for l in tfl}})
    if len(out) < 10:
        raise SystemExit("too few coins computed - not overwriting rsi_heatmap.json")
    payload = {"generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "source": "OKX",
               "period": 14, "tfs": [l for l, _ in TFS], "categories": list(CATEGORIES), "coins": out}
    with open(os.path.join(ROOT, "rsi_heatmap.json"), "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    log(f"wrote {len(out)} coins")
    with open(os.path.join(ROOT, "rsi_debug.txt"), "w") as f:
        f.write("\n".join(LOG) + "\n")


if __name__ == "__main__":
    main()
