"""Shared helpers for the TTM TradFi 'extra' data jobs (earnings, liquidity, correlation, commodities). Free, key-less sources only."""
import json, os, time, urllib.parse, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept": "*/*"}
LOG = []


def log(m):
    print(m, flush=True)
    LOG.append(m)


def get(url, timeout=25, tries=3, headers=None):
    h = dict(UA)
    h.update(headers or {})
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
                return r.read().decode("utf-8-sig", errors="replace")
        except Exception as ex:
            log(f"  fetch failed {url[:90]} ({type(ex).__name__} {getattr(ex, 'code', '')}) try {i + 1}")
            time.sleep(2 * (i + 1))
    return None


def getj(url, **kw):
    t = get(url, **kw)
    try:
        return json.loads(t) if t else None
    except Exception:
        return None


def yahoo_daily(sym, rng="1y"):
    """-> [(date 'YYYY-MM-DD', close)] oldest first, or []"""
    q = urllib.parse.quote(sym)
    for host in ("query1", "query2"):
        d = getj(f"https://{host}.finance.yahoo.com/v8/finance/chart/{q}?range={rng}&interval=1d&includePrePost=false")
        try:
            r = d["chart"]["result"][0]
            ts, cl = r["timestamp"], r["indicators"]["quote"][0]["close"]
            off = (r.get("meta") or {}).get("gmtoffset", 0) or 0
            out = [(datetime.fromtimestamp(t + off, timezone.utc).strftime("%Y-%m-%d"), c) for t, c in zip(ts, cl) if c]
            if out:
                return out
        except Exception:
            pass
    log(f"  yahoo: no data for {sym}")
    return []


def fred(sid, start="2020-01-01"):
    """-> [(date, value)] oldest first"""
    t = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}")
    out = []
    for ln in (t or "").strip().splitlines()[1:]:
        d, _, v = ln.partition(",")
        try:
            out.append((d, float(v)))
        except ValueError:
            pass
    return out


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def save(name, data, status_name=None, extra=None):
    """write <name>.json at the repo root, plus a small status file for debugging"""
    json.dump(data, open(os.path.join(ROOT, name), "w"), separators=(",", ":"))
    st = {"generated_at": now_iso(), "bytes": os.path.getsize(os.path.join(ROOT, name)), "log_tail": LOG[-25:]}
    st.update(extra or {})
    json.dump(st, open(os.path.join(ROOT, status_name or name.replace(".json", "_status.json")), "w"), indent=1)


def keep_old(msg, status_name):
    log(msg)
    json.dump({"generated_at": now_iso(), "error": msg, "log_tail": LOG[-25:]}, open(os.path.join(ROOT, status_name), "w"), indent=1)
