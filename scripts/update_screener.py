"""Stock screener data (US): one pass over the SEC's free 'frames' data (every filer's annual figures in a handful of calls)
plus the Nasdaq list for price / market cap / sector. Writes screener_us.json (+ screener_us_status.json)."""
import json, os, sys, time
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tf_common import log, getj, save, keep_old, now_iso

STATUS = "screener_us_status.json"
SEC = {"User-Agent": "TTM-Terminal research " + os.environ.get("SEC_CONTACT", "contact@ttm-terminal.example"), "Accept": "application/json"}
Y1 = datetime.now(timezone.utc).year - 1
Y0 = Y1 - 1


def frame(tag, unit, period):
    d = getj(f"https://data.sec.gov/api/xbrl/frames/us-gaap/{tag}/{unit}/{period}.json", headers=SEC, tries=2)
    time.sleep(0.2)
    out = {}
    for x in (d or {}).get("data", []):
        try:
            out[int(x["cik"])] = float(x["val"])
        except Exception:
            pass
    log(f"  {tag} {period}: {len(out)}")
    return out


def first(tags, unit, period):
    """first non-empty value per company across alternative tag names"""
    res = {}
    for t in tags:
        for c, v in frame(t, unit, period).items():
            res.setdefault(c, v)
    return res


DUR = {
    "rev": ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
    "gp": ["GrossProfit"],
    "oi": ["OperatingIncomeLoss"],
    "ni": ["NetIncomeLoss"],
    "cfo": ["NetCashProvidedByUsedInOperatingActivities"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    "int": ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "InterestAndDebtExpense"],
    "div": ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
}
INST = {
    "eq": ["StockholdersEquity"],
    "debt": ["LongTermDebtNoncurrent", "LongTermDebt"],
    "cash": ["CashAndCashEquivalentsAtCarryingValue"],
}


def load_year(y):
    d = {k: first(v, "USD", f"CY{y}") for k, v in DUR.items()}
    d["eps"] = first(["EarningsPerShareDiluted"], "USD-per-shares", f"CY{y}")
    for k, v in INST.items():
        d[k] = first(v, "USD", f"CY{y}Q4I")
    return d


def num(s):
    try:
        return float(str(s).replace("$", "").replace(",", ""))
    except Exception:
        return None


def clamp(x, a, b, w):
    if x is None:
        return 0.0
    return w * max(0.0, min(1.0, (x - a) / (b - a)))


def r1(x, k=1):
    return None if x is None else round(x, k)


def main():
    tk = getj("https://www.sec.gov/files/company_tickers.json", headers=SEC)
    if not tk:
        return keep_old("SEC ticker list unavailable", STATUS)
    cik_of = {v["ticker"].upper(): int(v["cik_str"]) for v in tk.values()}
    nq = getj("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25000&offset=0&download=true",
              headers={"Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"})
    rows = ((nq or {}).get("data") or {}).get("rows") or []
    if len(rows) < 1000:
        return keep_old("Nasdaq list unavailable", STATUS)
    log(f"nasdaq rows {len(rows)}, sec tickers {len(cik_of)}")
    A1, A0 = load_year(Y1), load_year(Y0)
    if len(A1["rev"]) < 500 and len(A0["rev"]) < 500:
        return keep_old("SEC frames returned too little data", STATUS)
    out, nofin = [], 0
    for r in rows:
        sym = (r.get("symbol") or "").strip().upper()
        cik = cik_of.get(sym)
        px, mc = num(r.get("lastsale")), num(r.get("marketCap"))
        if not cik or not px or not mc or mc < 5e7 or any(c in sym for c in "^/ "):
            continue
        use, prev = (A1, A0) if cik in A1["rev"] else (A0, None)
        g = lambda k, d=use: d[k].get(cik)
        rev = g("rev")
        if not rev or rev <= 0:
            nofin += 1
            continue
        gp, oi, cfo, cap, itx, div, eps = g("gp"), g("oi"), g("cfo"), g("capex"), g("int"), g("div"), g("eps")
        eq, debt, cash = g("eq"), g("debt"), g("cash")
        gm = gp / rev if gp is not None else None
        om = oi / rev if oi is not None else None
        fcf = (cfo - abs(cap or 0)) if cfo is not None else None
        fcfm = fcf / rev if fcf is not None else None
        fy = fcf / mc if fcf is not None else None
        pe = px / eps if eps and eps > 0 else None
        cap_inv = (eq or 0) + (debt or 0)
        roic = oi * 0.79 / cap_inv if oi is not None and cap_inv > 0 else None
        ic = oi / itx if oi is not None and itx and itx > 0 else None
        de = debt / eq if eq and eq > 0 and debt is not None else None
        dy = abs(div) / mc if div else None
        rg = None
        if prev and prev["rev"].get(cik):
            rg = rev / prev["rev"][cik] - 1
        elif use is A1 and A0["rev"].get(cik):
            rg = rev / A0["rev"][cik] - 1
        known = sum(v is not None for v in (gm, om, fcfm, pe, roic, rg))
        if known < 3:
            nofin += 1
            continue
        s_profit = clamp(gm, 0, .6, 10) + clamp(om, 0, .25, 10) + clamp(roic, 0, .2, 10)
        s_cash = clamp(fcfm, 0, .2, 12) + (4 if fcf and fcf > 0 else 0) + clamp(fy, 0, .06, 4)
        s_stab = (10 if (itx is None or itx == 0) and oi is not None else clamp(ic, 0, 8, 10)) + (10 if (debt is not None and debt == 0) else (clamp(3 - de, 0, 2.5, 10) if de is not None else 0))
        s_val = clamp(40 - pe, 0, 28, 20) if pe else 0
        s_gro = clamp(rg, 0, .25, 10)
        score = s_profit + s_cash + s_stab + s_val + s_gro
        if fcf is not None and fcf > 0 and ((pe and pe <= 30) or (dy and dy > .01)):
            cl = "now"
        elif rg is not None and rg > .15 and (not pe or pe > 30 or (fcf is not None and fcf <= 0)):
            cl = "future"
        else:
            cl = "mixed"
        danger = bool((om is not None and om < 0 and fcf is not None and fcf < 0) and ((ic is not None and ic < 1.5) or (de is not None and de > 3) or (cash is not None and debt and cash < debt * .25)))
        pct = num(str(r.get("pctchange") or "").replace("%", ""))
        out.append({"s": sym, "n": (r.get("name") or "")[:48], "sec": r.get("sector") or "", "ind": r.get("industry") or "", "px": px, "mc": mc, "ch": pct, "vol": num(r.get("volume")),
                    "gm": r1(gm * 100 if gm is not None else None), "om": r1(om * 100 if om is not None else None), "fm": r1(fcfm * 100 if fcfm is not None else None),
                    "fy": r1(fy * 100 if fy is not None else None), "pe": r1(pe), "ro": r1(roic * 100 if roic is not None else None), "ic": r1(ic), "de": r1(de, 2),
                    "dy": r1(dy * 100 if dy is not None else None, 2), "rg": r1(rg * 100 if rg is not None else None),
                    "sc": round(score), "sp": round(s_profit), "sk": round(s_cash), "ss": round(s_stab), "sv": round(s_val), "sg": round(s_gro), "cl": cl, "dz": 1 if danger else 0})
    out.sort(key=lambda x: -x["sc"])
    log(f"screener rows {len(out)}; skipped (no usable financials) {nofin}")
    if len(out) < 300:
        return keep_old(f"only {len(out)} rows; keeping previous", STATUS)
    save("screener_us.json", {"asof": now_iso(), "fy": [Y0, Y1], "rows": out}, STATUS, {"rows": len(out), "skipped": nofin})


if __name__ == "__main__":
    main()
