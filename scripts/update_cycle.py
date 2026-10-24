#!/usr/bin/env python3
"""TTM Liquidity Cycle  ->  liquidity_cycle.json

Works out where the market sits on the 9-stage TTM Liquidity Cycle from live readings:
  macro  (stages 1/2/3/8): Fed direction, Fed net liquidity (FRED, best effort), S&P 500 trend, dollar, gold, oil, TTM risk score
  crypto (stages 4-7, 9):  BTC trend vs 200-day, BTC dominance, altcoin-season index (share of ~50 big alts beating BTC over 90 days),
                           meme strength, Fear & Greed
The stage only changes after the new reading has held for ~48 hours, so it doesn't flip-flop. TTM's own model, not advice.
Free public sources only: OKX candles, CoinGecko / CoinPaprika (dominance), FRED csv, and the repo's own data files.
"""
import json, os, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "liquidity_cycle.json")
UA = {"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"}
LOG = []
NAMES = {1: "Recovery", 2: "Expansion", 3: "Late Cycle", 4: "Bitcoin Season", 5: "Altcoin Season",
         6: "Memecoin Mania", 7: "Peak", 8: "Contraction", 9: "Smart Money Accumulation"}
ALTS = ("ETH XRP BNB SOL DOGE TRX ADA HYPE LINK XLM SUI BCH AVAX LTC HBAR TON DOT UNI AAVE NEAR APT ARB OP ATOM FIL ETC ICP "
        "INJ PEPE SHIB TAO ONDO WLD CRV ENA SEI TIA JUP RENDER POL ALGO VET KAS XMR FET MKR LDO PENDLE").split()
MEMES = "DOGE SHIB PEPE BONK WIF FLOKI PENGU TRUMP POPCAT NEIRO TURBO MEME".split()
HOLD_HOURS = 48


def log(m):
    print(m); LOG.append(m)


def load(name, default=None):
    try:
        return json.load(open(os.path.join(ROOT, name)))
    except Exception:
        return default


def getj(url, timeout=25, tries=2):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as ex:
            if i == tries - 1:
                log(f"fetch failed {url[:70]}: {type(ex).__name__}")
            time.sleep(1.5)
    return None


def gett(url, timeout=40):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except Exception as ex:
        log(f"fetch failed {url[:70]}: {type(ex).__name__}")
        return None


def closes(sym, n):
    d = getj(f"https://www.okx.com/api/v5/market/candles?instId={sym}-USDT&bar=1D&limit={n}")
    if not d or d.get("code") != "0":
        return []
    return [float(c[4]) for c in sorted(d["data"], key=lambda c: int(c[0]))]


def dominance():
    d = getj("https://api.coingecko.com/api/v3/global")
    try:
        return round(float(d["data"]["market_cap_percentage"]["btc"]), 2)
    except Exception:
        pass
    d = getj("https://api.coinpaprika.com/v1/global")
    try:
        return round(float(d["bitcoin_dominance_percentage"]), 2)
    except Exception:
        return None


def fred(sid):
    txt = gett(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={(datetime.now(timezone.utc) - timedelta(days=75)).date()}")
    out = []
    for line in (txt or "").splitlines()[1:]:
        p = line.split(",")
        if len(p) == 2 and p[1] not in (".", ""):
            try:
                out.append((p[0], float(p[1])))
            except ValueError:
                pass
    return out


def net_liquidity():
    """Fed net liquidity ($B) = Fed assets - Treasury General Account - overnight reverse repo; and its change over ~4 weeks."""
    with ThreadPoolExecutor(max_workers=3) as ex:
        wal, tga, rrp = list(ex.map(fred, ["WALCL", "WTREGEN", "RRPONTSYD"]))
    if len(wal) < 6 or len(tga) < 6:
        return None, None
    def at(series, date):  # latest value on or before date
        v = None
        for d, x in series:
            if d <= date:
                v = x
            else:
                break
        return v
    def net(date):
        w, t, r = at(wal, date), at(tga, date), at(rrp, date) if rrp else 0
        return None if w is None or t is None else w / 1000 - t / 1000 - (r or 0)
    last = wal[-1][0]
    prev = (datetime.fromisoformat(last) - timedelta(days=28)).date().isoformat()
    a, b = net(last), net(prev)
    return (round(a, 1), round(a - b, 1)) if a is not None and b is not None else (None, None)


def pct(a, b):
    return (a / b - 1) * 100 if a and b else None


def main():
    old = load("liquidity_cycle.json", {}) or {}
    ind = []  # indicators shown on the page: key,label,value(display),read,tone(-1 bearish / 0 neutral / +1 bullish for risk)

    # ---------------- crypto
    btc = closes("BTC", 220)
    ma200 = sum(btc[-200:]) / 200 if len(btc) >= 200 else None
    ma50 = sum(btc[-50:]) / 50 if len(btc) >= 50 else None
    btc90 = pct(btc[-1], btc[-91]) if len(btc) > 91 else None
    btc30 = pct(btc[-1], btc[-31]) if len(btc) > 31 else None
    with ThreadPoolExecutor(max_workers=3) as ex:
        alt_cl = dict(zip(ALTS, ex.map(lambda s: (time.sleep(.2), closes(s, 100))[1], ALTS)))
    def beat(group):
        ok = n = 0
        for s in group:
            c = alt_cl.get(s) or []
            if len(c) > 91 and btc90 is not None:
                n += 1; ok += pct(c[-1], c[-91]) > btc90
        return (round(100 * ok / n) if n >= 8 else None), n
    for m in MEMES:  # memecoins not already in the alts list
        if m not in alt_cl:
            alt_cl[m] = closes(m, 100); time.sleep(.2)
    alt_idx, alt_n = beat(ALTS)
    meme_idx, meme_n = beat([m for m in MEMES if alt_cl.get(m)])
    dom = dominance()
    dh = [x for x in old.get("dom_history", []) if isinstance(x, list)]
    today = datetime.now(timezone.utc).date().isoformat()
    if dom is not None and (not dh or dh[-1][0] != today):
        dh.append([today, dom])
    dh = dh[-150:]
    dom30 = None
    if dom is not None and len(dh) > 1:
        cut = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
        ref = next((v for d, v in dh if d >= cut), dh[0][1])
        dom30 = round(dom - ref, 2)
    fg = ((load("fear_greed_data.json", {}) or {}).get("current") or {}).get("value")
    log(f"btc={btc[-1] if btc else None} ma200={ma200 and round(ma200)} alt_idx={alt_idx}/{alt_n} meme_idx={meme_idx}/{meme_n} dom={dom} dom30={dom30} fg={fg}")

    # ---------------- macro
    tm = load("tradfi_markets.json", {}) or {}
    rates = load("tradfi_rates.json", {}) or {}
    spx = next((i for i in tm.get("indices", []) if i.get("symbol") == "^GSPC"), {})
    mac = tm.get("macro", {}) or {}
    spx_vs50 = pct(spx.get("price"), spx.get("ma50"))
    spx_m1 = (spx.get("perf") or {}).get("m1")
    dxy_vs50 = pct((mac.get("dxy") or {}).get("price"), (mac.get("dxy") or {}).get("ma50"))
    gold_m1 = ((mac.get("gold") or {}).get("perf") or {}).get("m1")
    oil_m1 = ((mac.get("oil") or {}).get("perf") or {}).get("m1")
    risk = (tm.get("risk") or {}).get("score")
    fed = (rates.get("policy") or {}).get("fed") or {}
    exp = (rates.get("expectations") or {}).get("us") or {}
    hiking = (fed.get("change_bp") or 0) > 0 or "hike" in (exp.get("read") or "").lower()
    cutting = (fed.get("change_bp") or 0) < 0 or "cut" in (exp.get("read") or "").lower()
    liq, liq4 = net_liquidity()
    log(f"macro: spx_vs50={spx_vs50} spx_m1={spx_m1} dxy_vs50={dxy_vs50} gold_m1={gold_m1} oil_m1={oil_m1} risk={risk} fed={fed.get('display')} hiking={hiking} liq={liq} liq4={liq4}")

    tight = 0
    tight += 1 if hiking else (-1 if cutting else 0)
    tight += 1 if (dxy_vs50 or 0) > 1 else (-1 if (dxy_vs50 or 0) < -1 else 0)
    tight += 1 if (liq4 is not None and liq4 < -25) else (-1 if (liq4 is not None and liq4 > 25) else 0)
    real = (1 if (gold_m1 or 0) > 2 else 0) + (1 if (oil_m1 or 0) > 3 else 0)       # real assets / commodities running
    eq_up = (spx_vs50 or 0) > 0
    if (spx_vs50 is not None and spx_vs50 < -5) or ((spx_m1 or 0) < -8):
        macro = 8                      # stocks breaking down: liquidity leaving
    elif tight >= 1 and (eq_up or real or (spx_vs50 or 0) > -3):
        macro = 3                      # tightening while stocks/real assets still hold up: late cycle
    elif tight <= -1 and eq_up:
        macro = 2
    elif tight <= -1:
        macro = 1
    else:
        macro = 3 if (spx_vs50 or 0) > -3 else 1
    macro_why = {1: "easing policy but stocks still weak", 2: "easing policy and stocks trending up",
                 3: "tight policy with stocks and real assets still holding", 8: "stocks breaking down"}[macro]

    # ---------------- crypto stage
    trend_up = ma200 is not None and btc[-1] > ma200
    if ma200 is None or alt_idx is None:
        crypto = None
    elif not trend_up:
        crypto = 8 if (btc30 is not None and btc30 < -12) or (fg is not None and fg >= 40) else 9
    elif alt_idx >= 75 and fg is not None and fg >= 80:
        crypto = 7
    elif alt_idx >= 75 and meme_idx is not None and meme_idx >= 70:
        crypto = 6
    elif alt_idx >= 75:
        crypto = 5
    else:
        crypto = 4
    crypto_why = {4: "BTC above its 200-day average and most big alts still lag it", 5: "most big alts are beating BTC",
                  6: "alts and memecoins are both beating BTC", 7: "alts running and Fear & Greed at extreme greed",
                  8: "BTC below its 200-day average and falling", 9: "BTC below its 200-day average, sentiment washed out", None: "not enough data"}[crypto]
    # progress toward the next stage (for the "next" marker)
    nxt, prog = None, None
    if crypto == 4 and alt_idx is not None:
        nxt, prog = 5, {"label": "Altcoin Season index", "value": alt_idx, "target": 75}
    elif crypto == 5 and meme_idx is not None:
        nxt, prog = 6, {"label": "Memecoin strength", "value": meme_idx, "target": 70}
    elif crypto == 6 and fg is not None:
        nxt, prog = 7, {"label": "Fear & Greed", "value": fg, "target": 80}
    elif crypto == 9:
        nxt, prog = (1, None)

    cand_lit = sorted({s for s in (macro, crypto) if s})
    cand_primary = crypto if crypto in (4, 5, 6, 7, 8, 9) else macro
    # ---------------- stability: a new primary stage must hold HOLD_HOURS
    now = datetime.now(timezone.utc)
    cur = old.get("stage") or {}
    pend = old.get("pending") or {}
    prim, lit = cur.get("primary"), cur.get("lit")
    changed = False
    key = f"{cand_primary}|{','.join(map(str, cand_lit))}"
    if prim is None:
        prim, lit, changed = cand_primary, cand_lit, True
        pend = {}
    elif key == f"{prim}|{','.join(map(str, lit or []))}":
        pend = {}
    else:
        if pend.get("key") != key:
            pend = {"key": key, "since": now.isoformat()}
        since = datetime.fromisoformat(pend["since"])
        if now - since >= timedelta(hours=HOLD_HOURS):
            prim, lit, changed, pend = cand_primary, cand_lit, True, {}
    hist = old.get("history", [])
    if changed:
        hist.append({"date": today, "stage": prim, "name": NAMES[prim], "lit": lit})
    # "next" only counts when it follows the displayed stage
    if prim != cand_primary:
        nxt, prog = None, None
    chain = " → ".join(NAMES[s] for s in lit)
    text = chain + (f" · next: {NAMES[nxt]}" + (f" ({prog['value']}/{prog['target']})" if prog else "") if nxt else "")

    # ---------------- indicators shown on the page
    def add(key, label, value, read, tone=0):
        ind.append({"key": key, "label": label, "value": value, "read": read, "tone": tone})
    add("dom", "BTC dominance", f"{dom:.1f}%" if dom is not None else "—",
        (f"{dom30:+.1f} pts in 30d" if dom30 is not None else "history building"), 0 if dom30 is None else (-1 if dom30 > 0.5 else 1 if dom30 < -0.5 else 0))
    add("alt", "Altcoin Season index", f"{alt_idx}" if alt_idx is not None else "—", "75+ = altseason · 90-day, top 50 alts vs BTC", 1 if (alt_idx or 0) >= 75 else 0)
    add("btc", "BTC vs 200-day avg", f"{pct(btc[-1], ma200):+.1f}%" if ma200 else "—", "above = uptrend" if trend_up else "below = downtrend", 1 if trend_up else -1)
    add("fg", "Fear & Greed", f"{fg}" if fg is not None else "—", "80+ greed extreme · 20- fear extreme", 0)
    add("fed", "Fed funds", fed.get("display", "—"), (exp.get("read") or "").lower() or "—", -1 if hiking else 1 if cutting else 0)
    add("liq", "Fed net liquidity", f"${liq/1000:.2f}T" if liq else "—", (f"{liq4:+.0f}B over 4 weeks" if liq4 is not None else "FRED unavailable this run"), 0 if liq4 is None else (1 if liq4 > 25 else -1 if liq4 < -25 else 0))
    add("spx", "S&P 500 vs 50-day", f"{spx_vs50:+.1f}%" if spx_vs50 is not None else "—", "stocks trend", 1 if (spx_vs50 or 0) > 0 else -1)
    add("dxy", "US dollar vs 50-day", f"{dxy_vs50:+.1f}%" if dxy_vs50 is not None else "—", "strong dollar drains liquidity", -1 if (dxy_vs50 or 0) > 1 else 1 if (dxy_vs50 or 0) < -1 else 0)
    add("gold", "Gold (1 month)", f"{gold_m1:+.1f}%" if gold_m1 is not None else "—", "real-asset demand", 1 if (gold_m1 or 0) > 2 else -1 if (gold_m1 or 0) < -2 else 0)
    add("oil", "Oil (1 month)", f"{oil_m1:+.1f}%" if oil_m1 is not None else "—", "commodities", 0)

    payload = {"generated_at": now.replace(microsecond=0).isoformat(),
               "names": NAMES,
               "stage": {"primary": prim, "lit": lit, "next": nxt, "progress": prog, "text": text,
                         "macro": {"stage": macro, "why": macro_why}, "crypto": {"stage": crypto, "why": crypto_why}},
               "candidate": {"primary": cand_primary, "lit": cand_lit},
               "pending": pend, "history": hist[-30:], "indicators": ind, "dom_history": dh}
    json.dump(payload, open(OUT, "w"), separators=(",", ":"))
    open(os.path.join(ROOT, "cycle_debug.txt"), "w").write("\n".join(LOG) + "\n")
    log(f"stage primary={prim} lit={lit} next={nxt} candidate={cand_primary}/{cand_lit} changed={changed}")


if __name__ == "__main__":
    main()
