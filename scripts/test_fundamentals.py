"""One-off data test for the planned stock screener: which free sources can we reach from GitHub Actions?
Writes tradfi_fund_test.json with, for each source, ok/failed and a small sample."""
import json, os, time, urllib.request, urllib.parse, http.cookiejar
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
# SEC asks for a contact in the User-Agent; set the repo variable SEC_CONTACT later if they ever complain
SEC_UA = "TTM-Terminal research " + os.environ.get("SEC_CONTACT", "contact@ttm-terminal.example")
OUT = {}
def rec(name, fn):
    t = time.time()
    try:
        r = fn(); OUT[name] = {"ok": True, "secs": round(time.time() - t, 1), "sample": r}
    except Exception as e:
        OUT[name] = {"ok": False, "secs": round(time.time() - t, 1), "error": str(e)[:300]}
    print(name, OUT[name]["ok"], str(OUT[name].get("error", ""))[:120], flush=True)
def get(url, headers=None, opener=None, timeout=25):
    h = {"User-Agent": UA, "Accept": "application/json,text/html,*/*"}; h.update(headers or {})
    req = urllib.request.Request(url, headers=h)
    return (opener or urllib.request.build_opener()).open(req, timeout=timeout).read().decode("utf-8", "replace")
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
crumb = {}
def y_crumb():
    try: get("https://fc.yahoo.com", opener=op)
    except Exception: pass
    c = get("https://query1.finance.yahoo.com/v1/test/getcrumb", opener=op)
    if not c or "<" in c: raise Exception("no crumb: " + c[:80])
    crumb["c"] = c; return "got crumb"
rec("yahoo_crumb", y_crumb)
def y_summary(sym):
    mods = "financialData,defaultKeyStatistics,summaryDetail,price,assetProfile"
    j = json.loads(get(f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{sym}?modules={mods}&crumb={urllib.parse.quote(crumb['c'])}", opener=op))
    r = j["quoteSummary"]["result"][0]; fd = r["financialData"]
    g = lambda d, k: (d.get(k) or {}).get("raw")
    return {"sector": r["assetProfile"].get("sector"), "mcap": g(r["price"], "marketCap"), "grossMargins": g(fd, "grossMargins"), "fcf": g(fd, "freeCashflow"),
            "roe": g(fd, "returnOnEquity"), "roa": g(fd, "returnOnAssets"), "debtToEq": g(fd, "debtToEquity"), "pe": g(r["summaryDetail"], "trailingPE"), "divYield": g(r["summaryDetail"], "dividendYield")}
for s in ["AAPL", "BHP.AX"]:
    if crumb: rec("yahoo_quoteSummary_" + s, lambda s=s: y_summary(s))
def y_ts(sym):
    types = "trailingGrossProfit,trailingTotalRevenue,trailingFreeCashFlow,trailingOperatingIncome,trailingInterestExpense,annualInvestedCapital"
    j = json.loads(get(f"https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{sym}?type={types}&period1=1600000000&period2={int(time.time())}", opener=op))
    return {x["meta"]["type"][0]: (x.get(x["meta"]["type"][0]) or [None])[-1] for x in j["timeseries"]["result"] if x.get(x["meta"]["type"][0])}
for s in ["AAPL", "CBA.AX"]: rec("yahoo_timeseries_" + s, lambda s=s: y_ts(s))
def y_quote():
    if not crumb: raise Exception("no crumb")
    j = json.loads(get("https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL,MSFT,BHP.AX&crumb=" + urllib.parse.quote(crumb["c"]), opener=op))
    return [{k: x.get(k) for k in ("symbol", "marketCap", "trailingPE", "dividendYield", "sector")} for x in j["quoteResponse"]["result"]]
rec("yahoo_quote_batch", y_quote)
def sec():
    j = json.loads(get("https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json", headers={"User-Agent": SEC_UA}))
    return {"entity": j["entityName"], "tags": len(j["facts"]["us-gaap"]), "hasGrossProfit": "GrossProfit" in j["facts"]["us-gaap"]}
rec("sec_companyfacts", sec)
def sec_tickers():
    j = json.loads(get("https://www.sec.gov/files/company_tickers.json", headers={"User-Agent": SEC_UA})); return {"count": len(j)}
rec("sec_tickers", sec_tickers)
def nasdaq():
    j = json.loads(get("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&offset=0&download=true", headers={"Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}))
    rows = j["data"]["rows"]; return {"rows": len(rows), "first": rows[0]}
rec("nasdaq_screener_list", nasdaq)
def wiki():
    t = get("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"); return {"len": len(t), "hasAAPL": "AAPL" in t}
rec("wikipedia_sp500", wiki)
def asx():
    t = get("https://www.asx.com.au/asx/research/ASXListedCompanies.csv"); return {"len": len(t), "head": t[:200]}
rec("asx_listed_csv", asx)
def house():
    t = get("https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json"); return {"len": len(t)}
rec("congress_house", house)
def sec_form4():
    t = get("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&count=10&output=atom", headers={"User-Agent": SEC_UA}); return {"len": len(t)}
rec("sec_form4_feed", sec_form4)
json.dump(OUT, open("tradfi_fund_test.json", "w"), indent=1)
