"""Insider trades (US): reads SEC Form 4 filings (free) day by day and keeps open-market buys (code P) and larger sells (code S)
for the last ~90 days. Resumable: finished days are remembered in insiders_us_state.json, so a long first run can be repeated."""
import json, os, re, sys, time, threading
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tf_common import log, get, ROOT, now_iso

OUT, STATE, STATUS = "insiders_us.json", "insiders_us_state.json", "insiders_us_status.json"
SEC = {"User-Agent": "TTM-Terminal research " + os.environ.get("SEC_CONTACT", "contact@ttm-terminal.example"), "Accept": "*/*"}
KEEP_DAYS, BACKFILL_DAYS, BUDGET = 90, 90, 22 * 60
T0 = time.time()
lock = threading.Lock(); last = [0.0]


def fetch(url):
    with lock:  # about 7 requests a second in total (SEC limit is 10)
        w = last[0] + 0.14 - time.time()
        if w > 0:
            time.sleep(w)
        last[0] = time.time()
    return get(url, headers=SEC, tries=2)


def load(p, d):
    try:
        return json.load(open(os.path.join(ROOT, p)))
    except Exception:
        return d


def ft(x, tag):
    e = x.find(tag)
    return (e.text or "").strip() if e is not None and e.text else ""


def val(x, tag):
    e = x.find(tag + "/value")
    return (e.text or "").strip() if e is not None and e.text else ""


def parse(txt, acc):
    m = re.search(r"<ownershipDocument>.*?</ownershipDocument>", txt, re.S)
    if not m:
        return []
    try:
        r = ET.fromstring(m.group(0))
    except Exception:
        return []
    iss = r.find("issuer")
    sym, name = ft(iss, "issuerTradingSymbol").upper(), ft(iss, "issuerName")
    if not sym:
        return []
    owners = []
    for o in r.findall("reportingOwner"):
        rel = o.find("reportingOwnerRelationship")
        role = ft(rel, "officerTitle") if rel is not None else ""
        if not role and rel is not None:
            role = "Director" if ft(rel, "isDirector") in ("1", "true") else "10% owner" if ft(rel, "isTenPercentOwner") in ("1", "true") else ""
        owners.append((ft(o.find("reportingOwnerId"), "rptOwnerName") if o.find("reportingOwnerId") is not None else "", role))
    who = owners[0] if owners else ("", "")
    res = []
    for i, t in enumerate(r.findall("nonDerivativeTable/nonDerivativeTransaction")):
        code = ft(t.find("transactionCoding"), "transactionCode")
        if code not in ("P", "S"):
            continue
        try:
            sh = float(val(t, "transactionAmounts/transactionShares") or val(t.find("transactionAmounts"), "transactionShares"))
            px = float(val(t.find("transactionAmounts"), "transactionPricePerShare") or 0)
        except Exception:
            continue
        d = val(t, "transactionDate")
        v = sh * px
        if px <= 0 or (code == "P" and v < 1000) or (code == "S" and v < 100000):
            continue
        own = val(t.find("postTransactionAmounts"), "sharesOwnedFollowingTransaction") if t.find("postTransactionAmounts") is not None else ""
        res.append({"k": f"{acc}:{i}", "s": sym, "n": name[:40], "o": who[0][:40], "r": who[1][:40], "d": d, "c": code, "sh": round(sh), "px": round(px, 2), "v": round(v), "own": round(float(own)) if own.replace('.', '', 1).isdigit() else None})
    return res


def main():
    state = load(STATE, {"days_done": [], "seen": {}})
    data = load(OUT, {"trades": []})
    trades = {t["k"]: t for t in data.get("trades", [])}
    today = datetime.now(timezone.utc).date()
    days = [today - timedelta(days=i) for i in range(0, BACKFILL_DAYS)]
    done = set(state["days_done"])
    todo = [d for d in days if d.weekday() < 5 and d.isoformat() not in done or d == today]
    log(f"days to do: {len(todo)}")
    fetched = errs = 0
    for d in todo:
        if time.time() - T0 > BUDGET:
            log("time budget reached; will continue next run")
            break
        q = (d.month - 1) // 3 + 1
        idx = fetch(f"https://www.sec.gov/Archives/edgar/daily-index/{d.year}/QTR{q}/form.{d.strftime('%Y%m%d')}.idx")
        if not idx:
            if d != today:
                done.add(d.isoformat())
            continue
        accs = {}
        for ln in idx.splitlines():
            if ln.startswith("4 ") and "/" in ln:
                path = ln.split()[-1]
                m = re.search(r"(\d{10}-\d{2}-\d{6})\.txt", path)
                if m:
                    accs[m.group(1)] = path
        seen = set(state["seen"].get(d.isoformat(), []))
        work = [(a, p) for a, p in accs.items() if a not in seen]
        log(f"{d}: {len(accs)} Form 4 filings, {len(work)} new")

        def one(ap):
            a, p = ap
            if time.time() - T0 > BUDGET:
                return None
            t = fetch("https://www.sec.gov/Archives/" + p)
            return (a, parse(t, a) if t else None)
        with ThreadPoolExecutor(4) as ex:
            for r in ex.map(one, work):
                if r is None:
                    continue
                a, rows = r
                if rows is None:
                    errs += 1
                    continue
                fetched += 1; seen.add(a)
                for t in rows:
                    trades[t["k"]] = t
        if all(a in seen for a in accs):
            done.add(d.isoformat()) if d != today else None
            state["seen"].pop(d.isoformat(), None)
        else:
            state["seen"][d.isoformat()] = sorted(seen)
    cut = (today - timedelta(days=KEEP_DAYS)).isoformat()
    rows = sorted([t for t in trades.values() if t["d"] >= cut], key=lambda t: t["d"], reverse=True)
    state["days_done"] = sorted(x for x in done if x >= cut)
    json.dump(state, open(os.path.join(ROOT, STATE), "w"), separators=(",", ":"))
    json.dump({"asof": now_iso(), "days": KEEP_DAYS, "covered_days": len(state["days_done"]), "trades": rows}, open(os.path.join(ROOT, OUT), "w"), separators=(",", ":"))
    json.dump({"generated_at": now_iso(), "filings_read": fetched, "errors": errs, "trades": len(rows), "days_done": len(state["days_done"]), "log_tail": __import__("tf_common").LOG[-20:]}, open(os.path.join(ROOT, STATUS), "w"), indent=1)


if __name__ == "__main__":
    main()
