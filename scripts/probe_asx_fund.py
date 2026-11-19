#!/usr/bin/env python3
"""One-off probe: which free sources give ASX fundamentals (market cap, P/E, EPS, dividend yield, 52-week range)?
Writes asx_fund_probe.json with the status, keys and a sample of each reply so the real job can be built from it."""
import json, os, time, urllib.request, urllib.error
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
def get(url, headers=None):
    t = time.time(); h = {"User-Agent": UA, "Accept": "application/json, text/plain, */*"}; h.update(headers or {})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=25) as r:
            b = r.read().decode("utf-8", "replace"); return {"ok": True, "status": r.status, "secs": round(time.time() - t, 1), "len": len(b), "body": b}
    except urllib.error.HTTPError as e:
        return {"ok": False, "status": e.code, "secs": round(time.time() - t, 1), "error": str(e), "body": (e.read() or b"").decode("utf-8", "replace")[:300]}
    except Exception as e:
        return {"ok": False, "secs": round(time.time() - t, 1), "error": str(e)[:200]}
def keys(o, depth=0):
    if isinstance(o, dict): return {k: (keys(v, depth + 1) if depth < 2 else type(v).__name__) for k, v in o.items()}
    if isinstance(o, list): return [keys(o[0], depth + 1)] if o else []
    return type(o).__name__
ORIGIN = {"Origin": "https://www.asx.com.au", "Referer": "https://www.asx.com.au/"}
TESTS = {
 "markit_key_statistics_CBA": ("https://asx.api.markitdigital.com/asx-research/1.0/companies/cba/key-statistics", ORIGIN),
 "markit_header_CBA": ("https://asx.api.markitdigital.com/asx-research/1.0/companies/cba/header", ORIGIN),
 "markit_about_CBA": ("https://asx.api.markitdigital.com/asx-research/1.0/companies/cba/about", ORIGIN),
 "markit_directory": ("https://asx.api.markitdigital.com/asx-research/1.0/companies/directory?page=0&itemsPerPage=25&order=ascending&orderBy=companyName&includeFilterOptions=false&recentListingsOnly=false", ORIGIN),
 "markit_key_statistics_BHP_noorigin": ("https://asx.api.markitdigital.com/asx-research/1.0/companies/bhp/key-statistics", {}),
 "asx_old_share_CBA": ("https://www.asx.com.au/asx/1/share/CBA", {}),
 "asx_old_company_CBA": ("https://www.asx.com.au/asx/1/company/CBA?fields=primary_share", {}),
 "yahoo_quoteSummary_CBA": ("https://query2.finance.yahoo.com/v10/finance/quoteSummary/CBA.AX?modules=summaryDetail,defaultKeyStatistics,financialData", {}),
 "yahoo_chart_meta_CBA": ("https://query1.finance.yahoo.com/v8/finance/chart/CBA.AX?range=1y&interval=1d", {}),
}
out = {"generated_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())}
for name, (url, hdr) in TESTS.items():
    r = get(url, hdr); rec = {k: r.get(k) for k in ("ok", "status", "secs", "len", "error")}
    b = r.get("body") or ""
    try:
        j = json.loads(b); rec["keys"] = keys(j); rec["sample"] = json.dumps(j)[:1800]
    except Exception:
        rec["sample"] = b[:400]
    out[name] = rec; print(name, rec.get("ok"), rec.get("status"), flush=True); time.sleep(1)
# 12 quick calls to see whether it throttles
r = [get("https://asx.api.markitdigital.com/asx-research/1.0/companies/%s/key-statistics" % c, ORIGIN) for c in "wow tls anz nab wbc csl fmg rio wds stO sun mqg".split()]
out["markit_burst"] = [x.get("status") or x.get("error") for x in r]
open(os.path.join(ROOT, "asx_fund_probe.json"), "w").write(json.dumps(out, indent=1))
