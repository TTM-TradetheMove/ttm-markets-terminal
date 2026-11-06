#!/usr/bin/env python3
"""TTM 18-year property cycle data  ->  property_cycles.json
House price indices from the BIS residential property price database, via FRED (free csv, no key).
Real = adjusted for inflation (Q<CC>R628BIS), nominal = Q<CC>N628BIS. Quarterly, 2010 = 100, history from the 1970s for most countries."""
import json, os, urllib.request
from datetime import datetime, timezone
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "property_cycles.json")
UA = {"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"}
C = [("US", "United States"), ("AU", "Australia"), ("GB", "United Kingdom"), ("CA", "Canada"), ("NZ", "New Zealand"), ("DE", "Germany"), ("JP", "Japan")]

def get(sid):
    for _ in range(3):
        try:
            req = urllib.request.Request(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}", headers=UA)
            txt = urllib.request.urlopen(req, timeout=40).read().decode()
            rows = []
            for ln in txt.strip().splitlines()[1:]:
                d, _, v = ln.partition(",")
                try:
                    y, m = int(d[:4]), int(d[5:7]); rows.append([round(y + (m - 1) / 12, 2), round(float(v), 2)])
                except ValueError:
                    pass
            if rows: return rows
        except Exception as e:
            print(sid, "failed:", e)
    return []

out = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": "BIS residential property prices via FRED", "series": {}}
for cc, name in C:
    real, nom = get(f"Q{cc}R628BIS"), get(f"Q{cc}N628BIS")
    print(cc, len(real), len(nom))
    if real or nom: out["series"][cc] = {"name": name, "real": real, "nom": nom}
if out["series"]:
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
else:
    print("nothing fetched, keeping the old file")
