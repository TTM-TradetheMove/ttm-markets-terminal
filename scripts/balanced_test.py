#!/usr/bin/env python3
"""Compare bitcoin-data.com balanced/transfer price with realized price."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import update_realized as ur
bal = json.loads(ur.fetch("https://bitcoin-data.com/v1/balanced-price"))
print("balanced rows", len(bal), bal[0], bal[-1])
for d in bal[-8:]:
    print(d)
tr = json.loads(ur.fetch("https://bitcoin-data.com/v1/transfer-price"))
print("transfer rows", len(tr), tr[0], tr[-1])
rp = {d["d"]: d.get("realizedPrice") for d in json.loads(ur.fetch("https://bitcoin-data.com/v1/realized-price"))}
bm = {d["d"]: d["balancedPrice"] for d in bal}
tm = {d["d"]: d["transferPrice"] for d in tr}
for d in sorted(bm)[-6:] + sorted(bm)[::150]:
    print(d, "realized", rp.get(d), "balanced", bm.get(d), "transfer", tm.get(d), "real-transfer", (rp[d] - tm[d]) if rp.get(d) and tm.get(d) else None)
for q in ("?startday=2011-01-01", "?startday=2011-01-01&endday=2011-02-01"):
    try:
        t = json.loads(ur.fetch("https://bitcoin-data.com/v1/balanced-price" + q))
        print(q, len(t), t[0])
    except Exception as e:
        print(q, "fail", e)
