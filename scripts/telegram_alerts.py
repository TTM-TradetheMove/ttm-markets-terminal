#!/usr/bin/env python3
"""
TTM Telegram alerts: posts market news from the dashboard's own data files to your Telegram chat.

  1. MACRO   - heads-up 15 min before a high-impact release, then the result (actual vs forecast) once it prints
  2. RSI     - a coin newly entering Overbought (>=70) or Oversold (<=30) on 4H / 8H / 12H / 1D / 1W
  3. TOKENS  - new token unlocks / listings / airdrops / major events, once, when they are within 48h (or announced today)
  3b. VOLUME - a coin newly surging to 3x+ normal volume on 1H / 4H / 12H / 1D (own topic: TELEGRAM_VOLUME_THREAD_ID)
  4. SENTIMENT - Fear & Greed moving into / out of an extreme

Secrets (same as the session announcer): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
Env: DRY_RUN=1 prints instead of sending; ALERT_TYPES=macro,rsi,tokens,sentiment (default all); SEND_TEST=1 sends one test message.
The first run only records what already exists (no flood). State lives in telegram_alerts_state.json.
"""
import json, os, sys, time, html, urllib.request, urllib.parse
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(ROOT, "telegram_alerts_state.json")
SITE = "https://ttm-tradethemove.github.io/ttm-markets-terminal/"


def page(sec, area="crypto"):
    """Link that opens ONLY that terminal page (no menu, no way to other pages)."""
    return f"{SITE}{area}/?only={sec}"
MEL = ZoneInfo("Australia/Melbourne")
NOW = datetime.now(timezone.utc)
DRY = os.environ.get("DRY_RUN", "0") == "1"
TYPES = set((os.environ.get("ALERT_TYPES") or "macro,rsi,volume,cycle,tokens,sentiment").split(","))
VOL_TFS = {"1h": "1H", "4h": "4H", "12h": "12H", "1d": "1D"}   # volume alerts: a candle at 3x+ its 20-candle average
VOL_MIN_24H = 2_000_000   # ignore coins trading under $2M a day (noisy)
RSI_TFS = {"4h": "4H", "8h": "8H", "12h": "12H", "1d": "1D", "1w": "1W"}
MAX_PER_RUN = 8
FLAG = {"US": "🇺🇸", "UK": "🇬🇧", "EU": "🇪🇺", "JP": "🇯🇵"}
TYPE_ICON = {"unlock": "🔓", "listing": "📈", "airdrop": "🎁", "major": "📅"}


def load(name, default=None):
    try:
        return json.load(open(os.path.join(ROOT, name)))
    except Exception:
        return default


def send(text, kind="other"):
    """kind 'rsi' -> TELEGRAM_RSI_THREAD_ID; anything else -> TELEGRAM_ALERTS_THREAD_ID; both fall back to TELEGRAM_THREAD_ID."""
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    chat = (os.environ.get("TELEGRAM_CHAT_ID") or "").strip()
    env = os.environ.get
    thread = ((env("TELEGRAM_RSI_THREAD_ID") if kind == "rsi" else env("TELEGRAM_VOLUME_THREAD_ID") if kind == "volume" else None) or env("TELEGRAM_ALERTS_THREAD_ID") or env("TELEGRAM_THREAD_ID") or "").strip()
    if DRY or not token or not chat:
        print("[dry/unsent]", text.replace("\n", " | "))
        return DRY
    params = {"chat_id": chat, "text": text, "parse_mode": "HTML", "disable_web_page_preview": "true"}
    if thread:
        params["message_thread_id"] = thread
    data = urllib.parse.urlencode(params).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data), timeout=20) as r:
            return json.loads(r.read()).get("ok", False)
    except Exception as ex:
        print("telegram send failed:", ex)
        return False


e = html.escape


def macro(st, seeded):
    out = []
    cal = load("calendar_data.json", {}).get("events", [])
    for ev in cal:
        if ev.get("impact") != "high" or not ev.get("ts"):
            continue
        key = f'{ev["dt"]}|{ev["country"]}|{ev["event"]}'
        until = ev["ts"] - NOW.timestamp()
        when = datetime.fromtimestamp(ev["ts"], timezone.utc).astimezone(MEL).strftime("%a %d %b %H:%M")
        flag = FLAG.get(ev["country"], "")
        released = ev.get("actual") not in (None, "", "—")
        if released and key + "|res" not in st["macro"]:
            st["macro"].append(key + "|res")
            if seeded and until > -6 * 3600:
                verdict = {True: "⚠️ Missed forecast", False: "In line / better"}.get(bool(ev.get("miss")), "")
                out.append(f"📊 {flag} <b>{e(ev['event'])}</b> is out\nActual <b>{e(ev['actual'])}</b> · Forecast {e(ev['forecast'])} · Previous {e(ev['previous'])}\n{verdict}\nTTM bias history: {page('calendar')}")
        elif not released and 0 < until <= 900 and key + "|soon" not in st["macro"]:
            st["macro"].append(key + "|soon")
            if seeded:
                out.append(f"⏰ {flag} <b>{e(ev['event'])}</b> in {max(1, int(until // 60))} min ({when} Melbourne)\nForecast {e(ev['forecast'])} · Previous {e(ev['previous'])}\nHigh-impact: expect volatility. {page('calendar')}")
    return out


def rsi(st, seeded):
    out = []
    d = load("rsi_heatmap.json", {})
    for c in d.get("coins", []):
        for tf, lab in RSI_TFS.items():
            v = (c.get("r") or {}).get(tf)
            if v is None:
                continue
            zone = "ob" if v >= 70 else "os" if v <= 30 else "mid"
            k = f'{c["s"]}|{tf}'
            old = st["rsi"].get(k)
            st["rsi"][k] = zone
            if seeded and zone != "mid" and old != zone:
                tag = "🔴 Overbought" if zone == "ob" else "🟢 Oversold"
                out.append(f"{tag}: <b>{e(c['s'])}</b> RSI {v:.1f} on {lab} · ${(f"{c['p']:,.2f}" if c['p']>=1 else f"{c['p']:.6g}")}\nStretched momentum, not a trade call. {page('rsimap')}")
    return out


def volume(st, seeded):
    """A coin newly enters Surging volume (3x+ its 20-candle average) on a completed candle, with the candle's direction."""
    out, first = [], "vol" not in st
    st.setdefault("vol", {})
    hits = []
    for c in load("rsi_heatmap.json", {}).get("coins", []):
        for tf, lab in VOL_TFS.items():
            v = (c.get("vr") or {}).get(tf)
            if v is None:
                continue
            k = f'{c["s"]}|{tf}'
            zone = "su" if v >= 3 else "no"
            old = st["vol"].get(k)
            st["vol"][k] = zone
            if seeded and not first and zone == "su" and old != "su" and (c.get("v24") or 0) >= VOL_MIN_24H:
                hits.append((v, c, tf, lab))
    for v, c, tf, lab in sorted(hits, key=lambda h: -h[0])[:6]:
        d = (c.get("vd") or {}).get(tf)
        icon, word = ("🟢", "positive volume ▲") if d and d > 0 else ("🔴", "negative volume ▼") if d and d < 0 else ("⚪", "volume")
        mv = f" · candle {d:+.2f}%" if d is not None else ""
        q = (c.get("vq") or {}).get(tf)
        qs = f" · ${q/1e6:,.1f}M traded" if q else ""
        out.append(f"{icon} <b>Volume surge</b>: <b>{e(c['s'])}</b> {v:.1f}× normal on {lab} ({word}){mv}{qs}\nHeavy volume shows activity, not who is buying or selling. {page('volume')}")
    return out


def cycle(st, seeded):
    """TTM Liquidity Cycle: post when the displayed stage changes (liquidity_cycle.json is written by update_cycle.py)."""
    d = load("liquidity_cycle.json", {}) or {}
    s_ = d.get("stage") or {}
    if not s_.get("primary"):
        return []
    names = d.get("names", {})
    cur = {"primary": s_["primary"], "lit": s_.get("lit", [])}
    old = st.get("cycle")
    st["cycle"] = cur
    if not seeded or not old or old == cur:
        return []
    chain = " → ".join(names.get(str(i), str(i)) for i in cur["lit"])
    was = " → ".join(names.get(str(i), str(i)) for i in old.get("lit", []))
    nxt = s_.get("next")
    pr = s_.get("progress")
    tail = f"\nNext: {e(names.get(str(nxt), ''))}" + (f" ({e(pr['label'])} {pr['value']} of {pr['target']})" if pr else "") if nxt else ""
    return [f"🧭 <b>TTM Liquidity Cycle update</b>\nNow: <b>{e(chain)}</b>\nWas: {e(was)}{tail}\nTTM's own model from live readings, not advice. {SITE}crypto/?cycle=1"]


def tokens(st, seeded):
    out = []
    today = NOW.strftime("%Y-%m-%d")
    horizon = (NOW + timedelta(days=2)).strftime("%Y-%m-%d")
    for ev in load("token_events_data.json", {}).get("events", []):
        key = f'{ev["dt"]}|{ev["type"]}|{ev["token"]}|{ev["name"][:40]}'
        if key in st["tokens"]:
            continue
        near = today <= ev["dt"] <= horizon
        announced = ev.get("source") and ev["dt"] == today  # exchange announcement posted today
        if near or announced:
            st["tokens"].append(key)
            if seeded:
                link = f'\n{e(ev["link"])}' if ev.get("link") else ""
                out.append(f"{TYPE_ICON.get(ev['type'], '📌')} <b>{e(ev['type_label'])}</b> · {e(ev['token'])} · {e(ev['date'])}\n{e(ev['name'])}{link}\nTTM: {page('tokenevents')}")
    st["tokens"] = st["tokens"][-400:]
    return out


def sentiment(st, seeded):
    cur = load("fear_greed_data.json", {}).get("current") or {}
    v = cur.get("value")
    if v is None:
        return []
    zone = "xfear" if v <= 24 else "xgreed" if v >= 75 else "mid"
    old = st.get("fg")
    st["fg"] = zone
    if seeded and old is not None and zone != old:
        if zone == "mid":
            return [f"😐 Fear &amp; Greed back to <b>{v}</b> ({e(cur.get('classification', ''))}), out of the extreme."]
        icon = "😱" if zone == "xfear" else "🤑"
        return [f"{icon} Fear &amp; Greed hit <b>{v}</b> — {e(cur.get('classification', ''))}\nExtremes can mark turning points, but they can persist. {page('marketpulse')}"]
    return []


def main():
    if os.environ.get("SEND_TEST") == "1":
        ok = send("✅ TTM alerts bot is connected. Macro releases, token events and sentiment shifts will appear here.")
        ok_rsi = send("✅ TTM RSI alerts are connected. Overbought and oversold warnings will appear here.", "rsi")
        ok_vol = send("✅ TTM volume alerts are connected. Volume surges will appear here.", "volume")
        ok = ok and ok_rsi and ok_vol
        t = (os.environ.get("TELEGRAM_BOT_TOKEN") or "")
        print("token shape: length", len(t), "| has colon:", ":" in t, "| has space/newline:", t != t.strip() or " " in t, "| digits before colon:", t.split(":")[0].isdigit() if ":" in t else False)
        print("token set:", bool(os.environ.get("TELEGRAM_BOT_TOKEN")), "| chat id set:", bool(os.environ.get("TELEGRAM_CHAT_ID")))
        print("test sent" if ok else "test NOT sent")
        if not ok:
            sys.exit(1)
        return
    st = load("telegram_alerts_state.json", None)
    seeded = st is not None
    st = st or {}
    st.setdefault("macro", []); st.setdefault("rsi", {}); st.setdefault("tokens", [])
    msgs = []
    for name, fn in (("macro", macro), ("rsi", rsi), ("volume", volume), ("cycle", cycle), ("tokens", tokens), ("sentiment", sentiment)):
        if name in TYPES:
            try:
                msgs += [(name, t) for t in fn(st, seeded)]
            except Exception as ex:
                print(f"{name} failed: {type(ex).__name__}: {ex}")
    if not seeded:
        print(f"first run: recorded current state, nothing sent ({len(msgs)} suppressed)")
    sent = 0
    for name, m in msgs[:MAX_PER_RUN]:
        if send(m, name if name in ("rsi", "volume") else "other"):
            sent += 1
        time.sleep(1.2)
    if len(msgs) > MAX_PER_RUN:
        print(f"{len(msgs) - MAX_PER_RUN} more alerts skipped this run (cap {MAX_PER_RUN})")
    st["macro"] = st["macro"][-600:]
    json.dump(st, open(STATE, "w"))
    print(f"alerts: {len(msgs)} generated, {sent} sent")


if __name__ == "__main__":
    main()
