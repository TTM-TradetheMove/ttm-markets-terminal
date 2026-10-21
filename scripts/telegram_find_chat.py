#!/usr/bin/env python3
"""Finds the chat id(s) the bot can see and posts each id INTO that chat (not in the public logs)."""
import json, os, urllib.error, urllib.parse, urllib.request

token = os.environ.get("TELEGRAM_BOT_TOKEN")
if not token:
    raise SystemExit("SECRET MISSING: add TELEGRAM_BOT_TOKEN under Settings > Secrets and variables > Actions.")


def api(method, **params):
    data = urllib.parse.urlencode(params).encode() if params else None
    with urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{token}/{method}", data=data), timeout=25) as r:
        return json.loads(r.read())


try:
    me = api("getMe")
    print("token OK, bot is @" + me["result"]["username"])
    res = api("getUpdates")
except urllib.error.HTTPError as e:
    raise SystemExit(f"Telegram rejected the token (HTTP {e.code}). The TELEGRAM_BOT_TOKEN secret is wrong or was revoked - paste the newest token from @BotFather.")
chats = {}
topics = {}  # (chat id, topic id) -> chat name
for u in res.get("result", []):
    for key in ("channel_post", "message", "edited_channel_post", "my_chat_member", "chat_member"):
        m = u.get(key) or {}
        c = m.get("chat")
        if c:
            chats[c["id"]] = c.get("title") or c.get("username") or c.get("first_name") or "chat"
            if m.get("message_thread_id") and (m.get("is_topic_message") or c.get("is_forum")):
                topics[(c["id"], m["message_thread_id"])] = chats[c["id"]]
print(f"found {len(chats)} chat(s)")  # ids deliberately not printed here
if not chats:
    raise SystemExit("NO CHATS SEEN YET: make the bot an ADMIN of the channel/group, post a new message there, then run this again within 24 hours.")
for (cid, tid), name in topics.items():
    try:
        api("sendMessage", chat_id=cid, message_thread_id=tid, text=f"✅ This TOPIC's ID is: {tid}\nThe group's chat ID is: {cid}\nFor alerts in this topic, put {tid} in the GitHub secret TELEGRAM_THREAD_ID.")
        print(f"posted topic id into a topic of '{name}'")
    except Exception as ex:
        print("topic post failed:", ex)
for cid, name in chats.items():
    api("sendMessage", chat_id=cid, text=f"✅ TTM Session bot is connected.\nThis chat's ID is: {cid}\nPut this number in the GitHub secret TELEGRAM_CHAT_ID.")
    print(f"posted the id into '{name}'")
