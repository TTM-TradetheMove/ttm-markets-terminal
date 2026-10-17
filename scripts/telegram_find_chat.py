#!/usr/bin/env python3
"""Finds the chat id(s) the bot can see and posts each id INTO that chat (not in the public logs)."""
import json, os, urllib.parse, urllib.request

token = os.environ.get("TELEGRAM_BOT_TOKEN")
if not token:
    raise SystemExit("Add the TELEGRAM_BOT_TOKEN secret first.")


def api(method, **params):
    data = urllib.parse.urlencode(params).encode() if params else None
    with urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{token}/{method}", data=data), timeout=25) as r:
        return json.loads(r.read())


res = api("getUpdates")
chats = {}
for u in res.get("result", []):
    for key in ("channel_post", "message", "edited_channel_post", "my_chat_member", "chat_member"):
        c = (u.get(key) or {}).get("chat")
        if c:
            chats[c["id"]] = c.get("title") or c.get("username") or c.get("first_name") or "chat"
print(f"found {len(chats)} chat(s)")  # ids deliberately not printed here
if not chats:
    raise SystemExit("No chats seen yet. Make the bot an admin of the channel, post a message there, then run this again (within 24h).")
for cid, name in chats.items():
    api("sendMessage", chat_id=cid, text=f"✅ TTM Session bot is connected.\nThis chat's ID is: {cid}\nPut this number in the GitHub secret TELEGRAM_CHAT_ID.")
    print(f"posted the id into '{name}'")
