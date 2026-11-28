#!/usr/bin/env python3
"""Stock ticker list for TTM LENS -> stock_list.json  {asof, us:[[sym,name,mcap,sector]], au:[[code,name,mcap,sector]]}
US comes from screener_us.json (rebuilt nightly by the screener job). ASX comes from the ASX company directory (markitdigital).
If the ASX download fails, the last good ASX list is kept."""
import csv, io, json, os, re, time, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "stock_list.json")
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Origin": "https://www.asx.com.au", "Referer": "https://www.asx.com.au/"}
def clean(n):
    n = re.sub(r"\s+(Common Stock|Class [A-Z] Common Stock|Ordinary Shares?|American Depositary Shares?.*|Inc\.?|Corporation|Corp\.?)$", "", n or "", flags=re.I)
    return n.strip()[:48]
old = {}
try: old = json.load(open(OUT))
except Exception: pass
us = []
try:
    rows = json.load(open(os.path.join(ROOT, "screener_us.json")))["rows"]
    seen = set()
    for r in sorted(rows, key=lambda r: -(r.get("mc") or 0))[:3000]:
        s = (r.get("s") or "").upper().replace("/", "-").replace(".", "-")
        if s and s not in seen and re.fullmatch(r"[A-Z0-9\-]{1,10}", s):
            seen.add(s); us.append([s, clean(r.get("n")), int(r.get("mc") or 0), (r.get("sec") or "").strip()])
except Exception as e:
    print("US list failed:", e); us = old.get("us", [])
au = []
try:
    req = urllib.request.Request("https://asx.api.markitdigital.com/asx-research/1.0/companies/directory/file", headers=H)
    txt = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "replace")
    for r in csv.DictReader(io.StringIO(txt)):
        code = (r.get("ASX code") or "").strip().upper()
        if re.fullmatch(r"[A-Z0-9]{2,5}", code):
            try: mc = int(float(r.get("Market Cap") or 0))
            except Exception: mc = 0
            ik = next((k for k in r if k and "industry" in k.lower()), None)
            au.append([code, clean((r.get("Company name") or "").title()), mc, ((r.get(ik) if ik else "") or "").strip().title().replace(" And ", " & ")])
    au.sort(key=lambda x: -x[2])
except Exception as e:
    print("ASX list failed:", e); au = old.get("au", [])
json.dump({"asof": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "us": us, "au": au}, open(OUT, "w"), separators=(",", ":"))
print("us", len(us), "au", len(au))
