#!/usr/bin/env python3
"""
TTM Telegram news feed: posts NEW headlines from the terminal's own data files into its own Telegram topic.

  crypto   - latest stories from CoinDesk, Cointelegraph, The Block, Decrypt, Bitcoin Magazine, CryptoSlate (social_data.json)
  trump    - Trump Truth Social posts (social_data.json)
  central  - central-bank releases: Fed, ECB, BoE, BoJ, RBA... (tradfi_news.json)
  macro    - TradFi policy / geopolitics headlines that move markets (tradfi_news.json, only items tagged with what they affect)

Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, and TELEGRAM_NEWS_THREAD_ID (the topic for news; falls back to TELEGRAM_THREAD_ID).
Env: DRY_RUN=1, NEWS_SOURCES=crypto,trump,central,macro (default all), MAX_AGE_H (default 12), MAX_PER_RUN (default 6).
First run only records what already exists (no flood). State: telegram_news_state.json.
"""
import json, os, sys, time, html, urllib.request, urllib.parse
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(ROOT, "telegram_news_state.json")
NOW = time.time()
DRY = os.environ.get("DRY_RUN", "0") == "1"
SOURCES = set((os.environ.get("NEWS_SOURCES") or "crypto,trump,central,macro").split(","))
MAX_AGE = float(os.environ.get("MAX_AGE_H") or 12) * 3600
MAX_PER_RUN = int(os.environ.get("MAX_PER_RUN") or 6)
e = html.escape


def load(name, default=None):
    try:
        return json.load(open(os.path.join(ROOT, name)))
    except Exception:
        return default


def send(text):
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    chat = (os.environ.get("TELEGRAM_CHAT_ID") or "").strip()
    thread = (os.environ.get("TELEGRAM_NEWS_THREAD_ID") or os.environ.get("TELEGRAM_THREAD_ID") or "").strip()
    if DRY or not token or not chat:
        print("[dry/unsent]", text.replace("\n", " | ")[:200])
        return DRY
    params = {"chat_id": chat, "text": text, "parse_mode": "HTML", "disable_web_page_preview": "false"}
    if thread:
        params["message_thread_id"] = thread
    try:
        with urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=urllib.parse.urlencode(params).encode()), timeout=20) as r:
            return json.loads(r.read()).get("ok", False)
    except Exception as ex:
        print("telegram send failed:", ex)
        return False


def clip(s, n):
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def collect():
    items = []  # (ts, key, text)
    social = load("social_data.json", {})
    if "crypto" in SOURCES:
        for outlet in social.get("news", []):
            for p in outlet.get("posts", []):
                if p.get("title") and p.get("link"):
                    body = f"\n{e(clip(p.get('text'), 160))}" if p.get("text") else ""
                    items.append((float(p.get("ts") or 0), "c|" + (p.get("id") or p["link"]), f"📰 <b>{e(outlet.get('name', 'Crypto news'))}</b>\n<a href=\"{e(p['link'])}\">{e(clip(p['title'], 200))}</a>{body}"))
    if "trump" in SOURCES:
        for p in social.get("truth", []):
            if p.get("text") and p.get("link"):
                tags = f" · {', '.join(p['tags'])}" if p.get("tags") else ""
                items.append((float(p.get("ts") or 0), "t|" + (p.get("id") or p["link"]), f"🇺🇸 <b>Trump · Truth Social</b>{e(tags)}\n{e(clip(p['text'], 350))}\n{e(p['link'])}"))
    tf = load("tradfi_news.json", {})
    if "central" in SOURCES:
        for p in tf.get("central_banks", []):
            if p.get("title") and p.get("link"):
                items.append((float(p.get("ts") or 0), "b|" + p["link"], f"🏦 <b>{e(p.get('bank', 'Central bank'))}</b>\n<a href=\"{e(p['link'])}\">{e(clip(p['title'], 200))}</a>"))
    if "macro" in SOURCES:
        for cat, icon in (("policy", "🏛️"), ("geopolitics", "🌍")):
            for p in tf.get(cat, []):
                if p.get("title") and p.get("link") and p.get("affects"):
                    aff = ", ".join(p["affects"][:3])
                    items.append((float(p.get("ts") or 0), "m|" + p["link"], f"{icon} <b>{cat.title()}</b> · {e(p.get('source', ''))}\n<a href=\"{e(p['link'])}\">{e(clip(p['title'], 200))}</a>\nAffects: {e(aff)}"))
    return items


def main():
    if os.environ.get("SEND_TEST") == "1":
        ok = send("✅ TTM news feed is connected. New crypto headlines, Trump posts, central-bank releases and market-moving policy news will appear here.")
        print("test sent" if ok else "test NOT sent")
        if not ok:
            sys.exit(1)
        return
    st = load("telegram_news_state.json", None)
    seeded = st is not None
    seen = set((st or {}).get("seen", []))
    items = sorted(collect(), key=lambda x: x[0])  # oldest first so the chat reads in order
    new = [i for i in items if i[1] not in seen]
    fresh = [i for i in new if i[0] and NOW - i[0] <= MAX_AGE]
    if not seeded:
        print(f"first run: recorded {len(items)} existing items, nothing sent")
        fresh = []
    sent = 0
    skipped = set()
    for ts, key, text in fresh[-MAX_PER_RUN:]:
        if send(text):
            sent += 1
        else:
            skipped.add(key)  # retry next run
        time.sleep(1.2)
    # everything seen (sent or too old/over cap) is marked, except sends that failed
    for ts, key, _ in new:
        if key not in skipped:
            seen.add(key)
    json.dump({"seen": sorted(seen)[-3000:]}, open(STATE, "w"))
    print(f"news: {len(new)} new, {len(fresh)} fresh, {sent} sent")


if __name__ == "__main__":
    main()
