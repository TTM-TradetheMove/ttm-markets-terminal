# Report spec format (consumed by tools/build_report.py)

Text fields may contain only <b>, <i>, &amp; (escape & as &amp;, < as &lt;). No other HTML.
Top level keys:
{
 "kind": "deep" | "review",
 "ticker": "ALGO", "ticker_display": "ALGO", "name": "Algorand",
 "file": "ALGO_Deep_Dive_TTM.html"  (reviews: "ALGO_Asset_Review_TTM.html"),
 "date": "18 Oct 2026",
 "subhead": "1-2 sentence summary",
 "price": "$0.19", "chg": "-3.1% (24h) · 7d range ...", "chg_up": false,
 "price_meta": "Market Cap ≈ $1.6B · Rank #55 · Reference: 18 Oct 2026",
 "sections": [ {"title","sub"(review only, optional),"banner"(deep only),"blocks":[...]} ]
}
Block types:
 {"type":"stats","rows":[["Label","Value"],["Label","Value","gold"|"up"|"down"]]}      (8 rows ideal)
 {"type":"card","title":"..","dot":"g"|"r"|"n","items":["<b>..</b> text", ...]}
 {"type":"twocol","cards":[card,card]}     card = {"title","dot","items"}
 {"type":"alert","label":"Notable Finding — ...","text":"..."}
 {"type":"timeline","items":[["Nov 2021","description"],...]}
 {"type":"para","text":"..."}                      (review small paragraph under a stats grid)
 {"type":"age","num":"~6 yrs","label":"Mainnet Live Since ...","text":"..."}   (review track-record callout)
 {"type":"levels","rows":[["Level name","$1.23","res"|"sup"|"piv"]],"momentum":[["Weekly Trend","Bearish"],...]}  (review technicals)
 {"type":"verdict","paras":["disclaimer para","What the data supports...","What the data flags as risk...","Honest takeaway..."]}

DEEP DIVE sections (exactly 8, same as AVAX_Deep_Dive_TTM.html):
 1 Real Usage — Is Anyone Actually Using It?  (banner, stats x8, card)
 2 Tokenomics (title may carry an asset-specific subtitle) (banner, stats x8, card)
 3 Team & Funding — Who's Behind It, and Who's Backing Them? (banner, stats x8, optional alert, card)
 4 Competitive Position — Is This Actually Differentiated? (banner, twocol: edge vs where competition bites)
 5 Price Context — Cheap, or Correctly Priced? (banner, timeline 5-7 items, card)
 6 Liquidity & Market Structure (banner, stats x6, card)
 7 Regulatory & Counterparty Risk (banner, card)
 8 Putting It Together (verdict, 4 paras; first para is always the "synthesis, not a recommendation" disclaimer)
ASSET REVIEW sections (exactly 6, same as AVAX_Asset_Review_TTM.html):
 1 What Is <Name> (sub, twocol: "The Basics" + "What the token does")
 2 Tokenomics & Supply (sub, stats x8, para)
 3 Track Record — How Long It's Been Around (age, timeline 6-8 items)
 4 Market Snapshot (stats x8)
 5 Technical Read (sub, levels with 6 rows + 5-6 momentum rows)
 6 Catalysts & Risks (twocol: catalysts dot g, risks dot r)
