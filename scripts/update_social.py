#!/usr/bin/env python3
"""
Social Pulse feed for the crypto terminal -> social_data.json

  * Trump / Truth Social: independent public archive RSS (https://www.trumpstruth.org/feed).
    Truth Social has no free official API.
  * Key X accounts: X has no free API or RSS, so this is best-effort and tries, per account:
      1. a paid/self-made RSS feed you supply (env X_FEEDS_JSON = {"saylor": "https://.../feed.xml", ...})
      2. X's public embed/syndication timeline
      3. public Nitter mirrors (mostly dead in 2026)
    Whatever fails is reported in social_data.json -> status, so the page can say so honestly.

Only KEY posts are kept: a post must match crypto or market-moving keywords (everything else is dropped). Nothing is rewritten: text and links are the
original posts. Writes social_debug.txt live (survives a cancelled run).
"""
import html as htmllib, json, os, re, sys, time
import datetime as dt
import urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
T0 = time.time()
DEADLINE = T0 + 200
LOG = []

TRUTH_FEED = "https://www.trumpstruth.org/feed"
# Edit this list to change which X accounts are tracked: (handle, display name, why it matters)
X_ACCOUNTS = [
    ("elonmusk", "Elon Musk", "Market-moving on DOGE / BTC"),
    ("saylor", "Michael Saylor", "Strategy (MSTR) BTC buys"),
    ("VitalikButerin", "Vitalik Buterin", "Ethereum"),
    ("cz_binance", "CZ", "Binance founder"),
    ("brian_armstrong", "Brian Armstrong", "Coinbase CEO"),
    ("CryptoHayes", "Arthur Hayes", "Macro / liquidity views"),
    ("RaoulGMI", "Raoul Pal", "Macro / liquidity cycle"),
    ("SECGov", "SEC", "Regulation"),
    ("federalreserve", "Federal Reserve", "Rates / policy"),
]
NITTER = ["https://nitter.net", "https://nitter.poast.org", "https://nitter.privacydev.net", "https://xcancel.com"]

CRYPTO_RX = re.compile(r"\b(bitcoin|btc|crypto|cryptocurrenc\w*|ethereum|eth|stablecoin\w*|blockchain|digital asset\w*|"
                       r"strategic (bitcoin )?reserve|genius act|clarity act|sec\b|cftc|coinbase|binance|solana|xrp|"
                       r"dogecoin|doge|defi|etf|token\w*|mining|miner\w*|satoshi|web3|memecoin\w*)\b", re.I)
MACRO_RX = re.compile(r"\b(tariff\w*|fed\b|federal reserve|powell|rate cut\w*|interest rate\w*|inflation|jobs|economy|"
                      r"treasury|dollar|trade deal\w*|china|sanction\w*|oil|stock market|recession|debt|deficit|"
                      r"bank\w*|tax\w*|bessent|lutnick)\b", re.I)


def log(msg):
    print(msg, flush=True)
    LOG.append(msg)
    try:
        with open(os.path.join(ROOT, "social_debug.txt"), "w") as f:
            f.write("\n".join(LOG) + "\n")
    except Exception:
        pass


def get(url, timeout=15, accept="*/*"):
    if time.time() > DEADLINE:
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as e:  # noqa
        log(f"  GET fail {url[:90]} -> {type(e).__name__}: {str(e)[:80]}")
        return None


def clean(t):
    t = re.sub(r"<br\s*/?>", "\n", t or "", flags=re.I)
    t = re.sub(r"</p>\s*<p[^>]*>", "\n\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    t = htmllib.unescape(t)
    return re.sub(r"[ \t]+\n", "\n", t).strip()


def tags_for(text):
    out = []
    if CRYPTO_RX.search(text):
        out.append("crypto")
    if MACRO_RX.search(text):
        out.append("macro")
    return out


def parse_rss(txt, limit=40):
    items = []
    try:
        root = ET.fromstring(txt)
    except ET.ParseError as e:
        log(f"  rss parse error: {e}")
        return items
    for it in root.iter("item"):
        g = lambda n: (it.findtext(n) or "").strip()
        body = clean(g("description")) or clean(g("title"))
        try:
            ts = int(parsedate_to_datetime(g("pubDate")).timestamp())
        except Exception:
            ts = None
        items.append({"id": g("guid") or g("link"), "text": body, "link": g("link"), "ts": ts})
        if len(items) >= limit:
            break
    return items


def fetch_truth():
    txt = get(TRUTH_FEED, accept="application/rss+xml,*/*")
    if not txt:
        return None, "trumpstruth.org feed unreachable", 0
    allp = [i for i in parse_rss(txt, limit=80) if i["text"]]
    for i in allp:
        i["tags"] = tags_for(i["text"])
    items = [i for i in allp if i["tags"]][:15]  # KEY posts only: crypto- or market-related
    log(f"truth: {len(allp)} posts seen, {len(items)} key (crypto/market) kept")
    return (items or None), (None if allp else "feed returned no posts"), len(allp)


def x_from_feed(handle, url):
    txt = get(url, accept="application/rss+xml,*/*")
    return parse_rss(txt) if txt else []


def x_from_syndication(handle):
    txt = get(f"https://syndication.twitter.com/srv/timeline-profile/screen-name/{handle}?showReplies=false")
    if not txt:
        return []
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', txt, re.S)
    if not m:
        return []
    try:
        entries = json.loads(m.group(1))["props"]["pageProps"]["timeline"]["entries"]
    except Exception:
        return []
    out = []
    for e in entries:
        tw = (e.get("content") or {}).get("tweet") if e.get("type") == "tweet" else None
        if not tw or tw.get("in_reply_to_status_id_str"):
            continue
        try:
            ts = int(dt.datetime.strptime(tw["created_at"], "%a %b %d %H:%M:%S %z %Y").timestamp())
        except Exception:
            ts = None
        out.append({"id": tw.get("id_str"), "text": clean(tw.get("full_text") or tw.get("text") or ""),
                    "link": "https://x.com" + (tw.get("permalink") or f"/{handle}/status/{tw.get('id_str')}"), "ts": ts})
    return out


def x_from_nitter(handle):
    for base in NITTER:
        txt = get(f"{base}/{handle}/rss", timeout=8, accept="application/rss+xml,*/*")
        if txt and "<item" in txt:
            items = parse_rss(txt)
            for i in items:
                i["link"] = re.sub(r"^https?://[^/]+", "https://x.com", i["link"]).split("#")[0]
            return items
    return []


def fetch_x(acct):
    handle, name, why = acct
    feeds = json.loads(os.environ.get("X_FEEDS_JSON", "{}") or "{}")
    for how, fn in (("rss", lambda: x_from_feed(handle, feeds[handle]) if handle in feeds else []),
                    ("syndication", lambda: x_from_syndication(handle)),
                    ("nitter", lambda: x_from_nitter(handle))):
        try:
            items = [i for i in fn() if i.get("text")]
        except Exception as e:  # noqa
            log(f"  {handle} via {how} failed: {type(e).__name__}: {e}")
            items = []
        if items:
            for i in items:
                i["tags"] = tags_for(i["text"])
            key = [i for i in items if i["tags"]]  # KEY posts only
            log(f"x @{handle}: {len(items)} posts via {how}, {len(key)} key kept")
            return {"handle": handle, "name": name, "why": why, "via": how, "seen": len(items), "posts": key[:8]}
    log(f"x @{handle}: no source worked")
    return {"handle": handle, "name": name, "why": why, "via": None, "posts": []}


def main():
    log(f"social run {dt.datetime.now(dt.timezone.utc).isoformat()}")
    with ThreadPoolExecutor(max_workers=6) as ex:
        f_truth = ex.submit(fetch_truth)
        f_x = [ex.submit(fetch_x, a) for a in X_ACCOUNTS]
        truth, truth_err, truth_seen = f_truth.result()
        xs = [f.result() for f in f_x]
    try:
        with open(os.path.join(ROOT, "social_data.json")) as f:
            old = json.load(f)
    except Exception:
        old = {}
    # keep previous posts if a source failed this run (page never goes blank because of one bad run)
    if not truth and old.get("truth"):
        truth = old["truth"]
    oldx = {a["handle"]: a for a in old.get("x", [])}
    for a in xs:
        if not a["posts"] and oldx.get(a["handle"], {}).get("posts"):
            a["posts"] = oldx[a["handle"]]["posts"]
            a["stale"] = True
    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "truth": truth or [],
        "truth_error": truth_err,
        "truth_seen": truth_seen,
        "x": xs,
        "x_working": sum(1 for a in xs if a["posts"] and not a.get("stale")),
        "note": "Truth Social posts come from an independent public archive. X has no free API, so X accounts are best-effort.",
    }
    with open(os.path.join(ROOT, "social_data.json"), "w") as f:
        json.dump(out, f, indent=1)
    log(f"wrote social_data.json: truth={len(out['truth'])}, x accounts with posts={out['x_working']}/{len(xs)}; {time.time()-T0:.0f}s")


if __name__ == "__main__":
    main()
