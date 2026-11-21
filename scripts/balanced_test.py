#!/usr/bin/env python3
"""Probe free bitcoin-data.com endpoints for coin-days-destroyed / balanced / transfer price."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import update_realized as ur
for n in ("cdd", "coin-days-destroyed", "balanced-price", "transfer-price", "cvdd", "cdd-90d", "reserve-risk", "supply-adj-cdd", "vdd-multiple", "sth-realized-price", "lth-realized-price"):
    u = "https://bitcoin-data.com/v1/" + n
    try:
        t = ur.fetch(u)
        print("OK", n, len(t), t[:200].replace("\n", " "))
    except Exception as e:
        print("fail", n, str(e)[:80])
