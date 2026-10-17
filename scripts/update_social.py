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
DEADLINE = T0 + 230
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


def get(url, timeout=15, accept="*/*", headers=None):
    if time.time() > DEADLINE:
        return None
    try:
        h = {"User-Agent": UA, "Accept": accept}
        h.update(headers or {})
        req = urllib.request.Request(url, headers=h)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as e:  # noqa
        log(f"  GET fail {url[:90]} -> {type(e).__name__}: {str(e)[:80]}")
        LAST_ERR[0] = getattr(e, "code", None)
        return None


LAST_ERR = [None]


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


NEWS_FEEDS = [("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
              ("Cointelegraph", "https://cointelegraph.com/rss"),
              ("The Block", "https://www.theblock.co/rss.xml"),
              ("Decrypt", "https://decrypt.co/feed"),
              ("Bitcoin Magazine", "https://bitcoinmagazine.com/.rss/full/"),
              ("CryptoSlate", "https://cryptoslate.com/feed/")]


def fetch_news_one(name, url):
    txt = get(url, accept="application/rss+xml,application/xml,text/xml,*/*")
    if not txt:
        return {"name": name, "posts": [], "ok": False}
    out = []
    try:
        root = ET.fromstring(txt)
    except ET.ParseError as e:
        log(f"  {name}: rss parse error {e}")
        return {"name": name, "posts": [], "ok": False}
    for it in root.iter("item"):
        g = lambda n: (it.findtext(n) or "").strip()
        title = clean(g("title"))
        desc = clean(g("description"))
        if desc.lower().startswith(title.lower()[:30]) and title:
            desc = ""
        try:
            ts = int(parsedate_to_datetime(g("pubDate")).timestamp())
        except Exception:
            ts = None
        if title and ts:
            out.append({"id": g("guid") or g("link"), "title": title, "text": desc[:280], "link": g("link"), "ts": ts})
    out.sort(key=lambda p: p["ts"], reverse=True)
    log(f"news {name}: {len(out)} items")
    return {"name": name, "posts": out[:8], "ok": bool(out)}


def fetch_news():
    with ThreadPoolExecutor(max_workers=6) as ex:
        return list(ex.map(lambda f: fetch_news_one(*f), NEWS_FEEDS))


def x_from_feed(handle, url):
    txt = get(url, accept="application/rss+xml,*/*")
    return parse_rss(txt) if txt else []


def x_from_syndication(handle):
    txt = None
    for url in (f"https://syndication.twitter.com/srv/timeline-profile/screen-name/{handle}?showReplies=false",
                f"https://cdn.syndication.twimg.com/srv/timeline-profile/screen-name/{handle}?showReplies=false"):
        LAST_ERR[0] = None
        txt = get(url)
        if txt:
            break
        if LAST_ERR[0] == 429:
            log("  rate limited (429) - waiting 25s then one retry")
            time.sleep(25)
            txt = get(url)
            if txt:
                break
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


def x_from_api(handle, state):
    """Official X API v2 (pay-per-use). Needs the X_BEARER_TOKEN secret. Only NEW posts are requested
    (since_id), so usage - and cost - stays small. User ids / newest id seen are cached in `state`."""
    tok = os.environ.get("X_BEARER_TOKEN")
    if not tok:
        return None
    auth = {"Authorization": f"Bearer {tok}"}
    st = state.setdefault(handle, {})
    if not st.get("uid"):
        txt = get(f"https://api.twitter.com/2/users/by/username/{handle}", headers=auth, accept="application/json")
        try:
            st["uid"] = json.loads(txt)["data"]["id"]
        except Exception:
            log(f"  X API: could not resolve @{handle}: {(txt or 'no response')[:150]}")
            return None
    q = {"max_results": "10", "exclude": "replies,retweets", "tweet.fields": "created_at"}
    if st.get("since"):
        q["since_id"] = st["since"]
    txt = get(f"https://api.twitter.com/2/users/{st['uid']}/tweets?" + urllib.parse.urlencode(q), headers=auth, accept="application/json")
    try:
        data = json.loads(txt)
    except Exception:
        return None
    if data.get("errors") and not data.get("data"):
        log(f"  X API errors for @{handle}: {json.dumps(data.get('errors'))[:200]}")
        return None
    out = []
    for t in data.get("data") or []:
        try:
            ts = int(dt.datetime.fromisoformat(t["created_at"].replace("Z", "+00:00")).timestamp())
        except Exception:
            ts = None
        out.append({"id": t["id"], "text": clean(t.get("text", "")), "link": f"https://x.com/{handle}/status/{t['id']}", "ts": ts})
    if data.get("meta", {}).get("newest_id"):
        st["since"] = data["meta"]["newest_id"]
    return out  # [] is a valid answer: no new posts since last run


def fetch_x(acct, prev=None, state=None):
    handle, name, why = acct
    state = state if state is not None else {}
    feeds = json.loads(os.environ.get("X_FEEDS_JSON", "{}") or "{}")
    via, items = None, []
    got = None
    try:
        got = x_from_api(handle, state)
    except Exception as e:  # noqa
        log(f"  {handle} via x-api failed: {type(e).__name__}: {e}")
    if got is not None:
        via, items = "x-api", [i for i in got if i.get("text")]
    else:
        for how, fn in (("rss", lambda: x_from_feed(handle, feeds[handle]) if handle in feeds else []),
                        ("syndication", lambda: x_from_syndication(handle))):
            try:
                found = [i for i in fn() if i.get("text")]
            except Exception as e:  # noqa
                log(f"  {handle} via {how} failed: {type(e).__name__}: {e}")
                found = []
            if found:
                via, items = how, found
                break
    for i in items:
        i["tags"] = tags_for(i["text"])
    key = [i for i in items if i["tags"]]  # KEY posts only
    merged = {p["id"]: p for p in (prev or []) + key}  # keep earlier key posts, newest first
    posts = sorted(merged.values(), key=lambda p: p.get("ts") or 0, reverse=True)[:8]
    log(f"x @{handle}: via {via}, {len(items)} fetched, {len(key)} key, {len(posts)} kept")
    return {"handle": handle, "name": name, "why": why, "via": via, "seen": len(items), "posts": posts}


def main():
    log(f"social run {dt.datetime.now(dt.timezone.utc).isoformat()}")
    try:
        with open(os.path.join(ROOT, "social_data.json")) as f:
            old = json.load(f)
    except Exception:
        old = {}
    oldx = {a["handle"]: a for a in old.get("x", [])}
    state = old.get("x_state", {})
    has_api = bool(os.environ.get("X_BEARER_TOKEN"))
    x_on = has_api or bool(os.environ.get("X_FEEDS_JSON"))
    f_news = None
    with ThreadPoolExecutor(max_workers=1) as ex:
        f_truth = ex.submit(fetch_truth)
        f_news = ex.submit(fetch_news)
        # public X endpoints are rate limited per IP: one account at a time, spaced out, never in parallel
        xs, fails = [], 0
        for n, a in enumerate(X_ACCOUNTS):
            prev = oldx.get(a[0], {}).get("posts", [])
            if not has_api and (time.time() > DEADLINE - 20 or fails >= 3):
                xs.append({"handle": a[0], "name": a[1], "why": a[2], "via": None, "posts": prev})
                continue
            if n and not has_api:
                time.sleep(6)
            r = fetch_x(a, prev, state)
            fails = 0 if r["via"] else fails + 1
            xs.append(r)
        truth, truth_err, truth_seen = f_truth.result()
        news = f_news.result()
    oldnews = {n["name"]: n for n in old.get("news", [])}
    for n in news:  # keep earlier items if a feed fails this run
        if not n["posts"] and n["name"] in oldnews:
            n["posts"] = oldnews[n["name"]]["posts"]
    # keep previous Truth posts if the archive failed this run
    if not truth and old.get("truth"):
        truth = old["truth"]
    for a in xs:
        if not a["via"] and a["posts"]:
            a["stale"] = True
    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "truth": truth or [],
        "truth_error": truth_err,
        "truth_seen": truth_seen,
        "news": news,
        "x": xs,
        "x_working": sum(1 for a in xs if a["via"]),
        "x_state": state,
        "note": "Truth Social posts come from an independent public archive. X has no free API, so X accounts are best-effort.",
    }
    with open(os.path.join(ROOT, "social_data.json"), "w") as f:
        json.dump(out, f, indent=1)
    log(f"wrote social_data.json: truth={len(out['truth'])}, x accounts with posts={out['x_working']}/{len(xs)}; {time.time()-T0:.0f}s")


if __name__ == "__main__":
    main()
