#!/usr/bin/env python3
"""
Adds free, keyless sources to token_events_data.json (run AFTER update_token_events.py):
  - Binance, Bybit, OKX, Upbit announcement feeds -> listings / airdrops
  - DefiLlama emissions -> token unlocks (best effort)
Each source is independent: a failure keeps that source's last good events (token_sources_cache.json).
Writes token_sources_debug.txt so we can see which sources answered from the runner.
"""
import json, re, time, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta

UA = {"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)", "Accept": "application/json"}
NOW = datetime.now(timezone.utc)
KEEP_PAST = timedelta(days=60)
LOG = []


def log(m):
    LOG.append(m); print(m)


def get(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def classify(title):
    t = title.lower()
    if re.search(r"airdrop|hodler|launchpool|megadrop|launchpad|token generation|tge", t):
        return "airdrop", "Airdrop"
    if re.search(r"will list|to list|listing|lists |new listing|adds? |will add|trading (pair|will open)|spot trading|market support", t):
        return "listing", "Listing"
    return None, None


def token_of(title):
    m = re.search(r"\(([A-Z0-9]{2,10})\)", title) or re.search(r"\b([A-Z0-9]{2,10})/(?:USDT|KRW|BTC|USDC)", title)
    return m.group(1) if m else "—"


def mk(ts, typ, label, token, name, link, src):
    dt = datetime.fromtimestamp(ts, timezone.utc)
    return {"date": dt.strftime("%d %b %Y"), "dt": dt.strftime("%Y-%m-%d"), "type": typ,
            "type_label": label, "token": token, "name": f"{name} · {src}", "link": link, "source": src}


def binance():
    out = []
    for cat in (48, 128):  # 48 new crypto listings, 128 airdrops
        d = get(f"https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId={cat}&pageNo=1&pageSize=20")
        arts = (d.get("data") or {}).get("catalogs", [{}])[0].get("articles", [])
        log(f"binance cat {cat}: {len(arts)} articles")
        for a in arts:
            typ, lab = classify(a["title"])
            if cat == 128: typ, lab = "airdrop", "Airdrop"
            if not typ: continue
            out.append(mk(a["releaseDate"] / 1000, typ, lab, token_of(a["title"]), a["title"],
                          "https://www.binance.com/en/support/announcement/" + a["code"], "Binance"))
    return out


def bybit():
    out = []
    for t in ("new_crypto", "latest_activities"):
        d = get(f"https://api.bybit.com/v5/announcements/index?locale=en-US&type={t}&limit=20")
        lst = (d.get("result") or {}).get("list", [])
        log(f"bybit {t}: {len(lst)}")
        for a in lst:
            typ, lab = classify(a["title"])
            if not typ: continue
            out.append(mk(a["dateTimestamp"] / 1000, typ, lab, token_of(a["title"]), a["title"], a.get("url"), "Bybit"))
    return out


def okx():
    out = []
    d = get("https://www.okx.com/api/v5/support/announcements?annType=announcements-new-listings&page=1")
    lst = ((d.get("data") or [{}])[0]).get("details", [])
    log(f"okx: {len(lst)}")
    for a in lst:
        typ, lab = classify(a["title"]) if a.get("title") else (None, None)
        if not typ: typ, lab = "listing", "Listing"
        out.append(mk(int(a["pTime"]) / 1000, typ, lab, token_of(a["title"]), a["title"], a.get("url"), "OKX"))
    return out


def upbit():
    out = []
    d = get("https://api-manager.upbit.com/api/v1/announcements?os=web&page=1&per_page=20&category=trade")
    lst = (d.get("data") or {}).get("notices", [])
    log(f"upbit: {len(lst)}")
    for a in lst:
        t = a.get("title", "")
        if not re.search(r"신규|상장|Market Support|Listing", t, re.I): continue
        ts = datetime.fromisoformat(a["listed_at"]).timestamp()
        out.append(mk(ts, "listing", "Listing", token_of(t), t, f"https://upbit.com/service_center/notice?id={a['id']}", "Upbit"))
    return out


def llama():
    out = []
    d = get("https://api.llama.fi/emissions", 30)
    log(f"defillama emissions: {len(d)} protocols")
    horizon = NOW + timedelta(days=60)
    for p in d:
        nxt = p.get("nextEvent") or p.get("events") or []
        if isinstance(nxt, dict): nxt = [nxt]
        for ev in nxt[:1]:
            ts = ev.get("timestamp")
            if not ts or not (NOW.timestamp() <= ts <= horizon.timestamp()): continue
            amt = sum(x.get("noOfTokens", [0])[0] if isinstance(x.get("noOfTokens"), list) else 0 for x in [ev])
            sym = (p.get("symbol") or p.get("name") or "?").upper()
            name = f"{p.get('name', sym)} token unlock" + (f" ({amt:,.0f} {sym})" if amt else "")
            out.append(mk(ts, "unlock", "Unlock", sym, name, "https://defillama.com/unlocks", "DefiLlama"))
    return out


SOURCES = [("Binance", binance), ("Bybit", bybit), ("OKX", okx), ("Upbit", upbit), ("DefiLlama", llama)]


def main():
    try: cache = json.load(open("token_sources_cache.json"))
    except Exception: cache = {}
    for name, fn in SOURCES:
        try:
            ev = fn()
            cache[name] = ev
            log(f"{name}: OK, {len(ev)} events kept")
        except Exception as e:
            log(f"{name}: FAILED ({type(e).__name__}: {e}) -- using {len(cache.get(name, []))} cached")
        time.sleep(1)
    json.dump(cache, open("token_sources_cache.json", "w"))

    base = json.load(open("token_events_data.json"))
    events = [e for e in base["events"] if not e.get("source")]
    lo = (NOW - KEEP_PAST).strftime("%Y-%m-%d")
    seen = {(e["dt"], e["token"], e["type"]) for e in events}
    for ev in cache.values():
        for e in ev:
            k = (e["dt"], e["token"], e["type"])
            if e["dt"] >= lo and not (k in seen and e["token"] != "—"):
                seen.add(k); events.append(e)
    events.sort(key=lambda e: e["dt"])
    base["events"] = events
    base["sources"] = sorted({e.get("source", "cryptotldr.io") for e in events})
    json.dump(base, open("token_events_data.json", "w"), indent=2)
    log(f"Total events written: {len(events)}")
    open("token_sources_debug.txt", "w").write(f"Run at {NOW.isoformat()}\n\n" + "\n".join(LOG))


if __name__ == "__main__":
    main()
