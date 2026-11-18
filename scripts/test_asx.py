"""One-off test: which free sources give Australian (ASX) company figures from GitHub Actions? Writes tradfi_asx_test.json"""
import json, time, urllib.request
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
OUT = {}
def go(name, url, headers=None, cut=500):
    t = time.time()
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json,text/html,*/*", **(headers or {})}), timeout=25)
        b = r.read().decode("utf-8", "replace"); OUT[name] = {"ok": True, "status": r.status, "len": len(b), "head": b[:cut]}
    except Exception as e:
        OUT[name] = {"ok": False, "error": str(e)[:200]}
    print(name, OUT[name]["ok"], flush=True); time.sleep(0.5)
H = {"Origin": "https://www.asx.com.au", "Referer": "https://www.asx.com.au/"}
for p in ["header", "key-statistics", "about", "financial-statements", "dividends", "financials", "statistics"]:
    go("asx_markit_" + p, f"https://asx.api.markitdigital.com/asx-research/1.0/companies/CBA/{p}", H)
for p in ["header", "key-statistics"]:
    go("asx_markit_bhp_" + p, f"https://asx.api.markitdigital.com/asx-research/1.0/companies/BHP/{p}", H)
go("asx_directory_json", "https://asx.api.markitdigital.com/asx-research/1.0/companies/directory/file", H, 200)
mods = "financialData,defaultKeyStatistics,summaryDetail"
go("yahoo_summary_nocrumb", f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/CBA.AX?modules={mods}")
go("yahoo_chart_ok", "https://query1.finance.yahoo.com/v8/finance/chart/CBA.AX?range=5d&interval=1d", None, 200)
go("yahoo_html_stats", "https://finance.yahoo.com/quote/CBA.AX/key-statistics/", None, 300)
go("stooq_csv", "https://stooq.com/q/l/?s=cba.au&f=sd2t2ohlcv&h&e=csv", None, 300)
go("google_finance", "https://www.google.com/finance/quote/CBA:ASX", None, 300)
go("fmp_demo", "https://financialmodelingprep.com/api/v3/profile/CBA.AX?apikey=demo", None, 300)
go("eodhd_demo", "https://eodhd.com/api/fundamentals/CBA.AU?api_token=demo&fmt=json", None, 300)
go("asx_announce_cba", "https://asx.api.markitdigital.com/asx-research/1.0/companies/CBA/announcements", H, 300)
json.dump(OUT, open("tradfi_asx_test.json", "w"), indent=1)
