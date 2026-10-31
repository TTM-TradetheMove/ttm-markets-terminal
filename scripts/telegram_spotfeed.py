#!/usr/bin/env python3
"""Post TTM's spot moves (buys, sells, limit orders, part take-profits) to the Telegram group 14 days after they happened.
Pro members see each move live in the terminal; this is the delayed public copy.
Reads the feed with the public key (the database only returns rows older than 14 days to anonymous readers).
Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID; optional TELEGRAM_THREAD_ID. Env: DRY_RUN=1.
"""
import json, os, sys, urllib.parse, urllib.request, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(ROOT, "telegram_spotfeed_state.json")
SITE = "https://ttm-tradethemove.github.io/ttm-markets-terminal/"
DELAY_DAYS = 14
ICON = {"buy": "🟢", "lo": "🕒", "fill": "✅", "tp": "🎯", "sell": "🔴", "part": "🟠"}


def esc(s):
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main():
    cfg = json.load(open(os.path.join(ROOT, "ttm_config.json")))
    url, key = cfg.get("supabase_url"), cfg.get("supabase_anon_key")
    if not url or not key:
        print("No Supabase config"); return 0
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=DELAY_DAYS)).isoformat()
    q = f"{url}/rest/v1/ttm_spot_feed?select=*&order=ts.asc&limit=50&ts=lt.{urllib.parse.quote(cutoff)}"
    req = urllib.request.Request(q, headers={"apikey": key, "Authorization": "Bearer " + key})
    try:
        rows = json.loads(urllib.request.urlopen(req, timeout=30).read())
    except Exception as ex:
        print("Could not read the feed:", ex); return 0
    state = json.load(open(STATE)) if os.path.exists(STATE) else {"sent": []}
    sent = set(state.get("sent", []))
    new = [r for r in rows if r["id"] not in sent]
    print(len(rows), "old enough,", len(new), "new")
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip(); chat = (os.environ.get("TELEGRAM_CHAT_ID") or "").strip()
    thread = (os.environ.get("TELEGRAM_THREAD_ID") or "").strip()
    for r in new:
        when = dt.datetime.fromisoformat(r["ts"].replace("Z", "+00:00")).strftime("%d %b %Y")
        text = (f"{ICON.get(r.get('kind'), '📣')} <b>{esc(r['title'])}</b>\n{esc(r.get('body'))}\n\n"
                f"<i>TTM spot move from {when}. Pro members saw this live.</i>\n<a href=\"{SITE}\">TTM Markets Terminal</a>")
        if os.environ.get("DRY_RUN") == "1" or not token or not chat:
            print("[dry]", text); continue
        body = {"chat_id": chat, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}
        if thread: body["message_thread_id"] = thread
        try:
            urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}), timeout=30)
            sent.add(r["id"])
        except Exception as ex:
            print("Telegram failed:", ex); break
    state["sent"] = sorted(sent)[-500:]
    json.dump(state, open(STATE, "w"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
