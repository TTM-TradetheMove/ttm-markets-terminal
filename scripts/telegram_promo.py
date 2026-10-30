#!/usr/bin/env python3
"""Post the TTM terminal promo image to Telegram with a tappable "Open the terminal" button under it.
(Links inside a picture cannot be tapped in Telegram; the button under the picture can.)

Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. Optional: TELEGRAM_THREAD_ID (forum topic).
Env: PROMO_THREAD_ID (overrides the topic for this post), PROMO_CAPTION (overrides the caption), PROMO_BUTTON (button text), DRY_RUN=1.
"""
import json, os, sys, uuid, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://ttm-tradethemove.github.io/ttm-markets-terminal/"
CAPTION = os.environ.get("PROMO_CAPTION") or (
    "🚀 <b>TTM Markets Terminal is open for early access</b>\n\n"
    "Live data, key levels and the events that move price. Crypto and TradFi in one place.\n\n"
    "📊 Max Pain + RSI confluence\n🔥 RSI &amp; Volume heatmaps\n💧 Liquidation map\n📅 Economic calendar\n"
    "🎯 Risk/reward calculator &amp; trade tracker\n\n"
    "Register a free account to enter the early access giveaway.\n\n<b>SEE THE MOVE. TRADE THE MOVE.</b>")
BUTTON = os.environ.get("PROMO_BUTTON") or "Open the terminal →"


def multipart(fields, fname, data):
    b = "----ttm" + uuid.uuid4().hex
    out = b""
    for k, v in fields.items():
        out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    out += f'--{b}\r\nContent-Disposition: form-data; name="photo"; filename="{fname}"\r\nContent-Type: image/png\r\n\r\n'.encode() + data + b"\r\n"
    out += f"--{b}--\r\n".encode()
    return out, f"multipart/form-data; boundary={b}"


def main():
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    chat = (os.environ.get("TELEGRAM_CHAT_ID") or "").strip()
    thread = (os.environ.get("PROMO_THREAD_ID") or os.environ.get("TELEGRAM_THREAD_ID") or "").strip()
    if os.environ.get("DRY_RUN") == "1" or not token or not chat:
        print("[dry/unsent] chat:", bool(chat), "token:", bool(token), "thread:", thread or "-")
        print(CAPTION)
        return 0
    fields = {"chat_id": chat, "caption": CAPTION, "parse_mode": "HTML",
              "reply_markup": json.dumps({"inline_keyboard": [[{"text": BUTTON, "url": SITE}]]})}
    if thread:
        fields["message_thread_id"] = thread
    data = open(os.path.join(ROOT, "promo", "ttm_terminal_promo.png"), "rb").read()
    body, ctype = multipart(fields, "ttm_terminal_promo.png", data)
    try:
        with urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{token}/sendPhoto", data=body, headers={"Content-Type": ctype}), timeout=60) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as ex:
        print("Telegram error:", ex.code, ex.read().decode()[:300])
        return 1
    except Exception as ex:
        print("Telegram failed:", type(ex).__name__, ex)
        return 1
    print("sent" if res.get("ok") else res)
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
