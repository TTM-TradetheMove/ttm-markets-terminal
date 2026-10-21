#!/usr/bin/env python3
"""
TTM session-clock Telegram announcer.

Uses the same session / exchange hours as the Trading Hours clocks on the site and posts to a
Telegram chat when something happens: a heads-up before a core session opens, core open / close,
New York pre-market / post-market, Tokyo & Hong Kong lunch breaks, and cross-region overlaps
starting / ending.

Runs every 5 minutes from GitHub Actions. It announces every event whose time fell in
(last run, now] and remembers the last run in telegram_state.json, so nothing is sent twice.

Secrets (repo Settings > Secrets and variables > Actions):
  TELEGRAM_BOT_TOKEN   from @BotFather
  TELEGRAM_CHAT_ID     the channel / group id (e.g. -1001234567890 or @yourchannel)
Optional env: INCLUDE_WEEKENDS=1 (crypto-style: sessions "run" Sat/Sun too), HEADSUP_MIN=15, DRY_RUN=1
"""
import json, os, sys, time, urllib.request, urllib.parse
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(ROOT, "telegram_state.json")
SITE = "https://ttm-tradethemove.github.io/ttm-markets-terminal/crypto/?only=tradinghours"
HEADSUP = int(os.environ.get("HEADSUP_MIN", "10"))
WEEKENDS = os.environ.get("INCLUDE_WEEKENDS", "0") == "1"
MAX_LOOKBACK = timedelta(hours=3)   # GitHub's cron can skip hours, so catch up on what was missed  # never replay more than this after an outage
DISPLAY = ZoneInfo("Australia/Melbourne")

# Sessions: local minutes-from-midnight phases (same as the site)
SESSIONS = {
    "asia": {"name": "ASIA", "zone": "Australia/Melbourne", "flag": "🌏",
             "phases": [("core", 420, 960)]},
    "ldn":  {"name": "London", "zone": "Europe/London", "flag": "🇬🇧",
             "phases": [("core", 480, 1020)]},
    "ny":   {"name": "New York", "zone": "America/New_York", "flag": "🇺🇸",
             "phases": [("pre", 240, 570), ("core", 570, 960), ("post", 960, 1200)]},
}
# Exchanges (segments = two entries means a lunch break)
EXCHANGES = [
    ("asia", "ASX", "Australia/Sydney", [(600, 960)]),
    ("asia", "Tokyo (TSE)", "Asia/Tokyo", [(540, 690), (750, 930)]),
    ("asia", "Hong Kong (HKEX)", "Asia/Hong_Kong", [(570, 720), (780, 960)]),
    ("asia", "Singapore (SGX)", "Asia/Singapore", [(540, 1020)]),
    ("ldn", "LSE", "Europe/London", [(480, 990)]),
    ("ldn", "Xetra", "Europe/Berlin", [(540, 1050)]),
    ("ny", "NYSE / Nasdaq", "America/New_York", [(570, 960)]),
]


def local_to_utc(day, minutes, zone):
    z = ZoneInfo(zone)
    return datetime(day.year, day.month, day.day, minutes // 60, minutes % 60, tzinfo=z).astimezone(timezone.utc)


def days_around(now, zone):
    d = now.astimezone(ZoneInfo(zone)).date()
    return [d + timedelta(days=o) for o in (-1, 0, 1)]


def is_weekend(day):
    return day.weekday() >= 5


def windows(now, zone, segs, phase_names=None):
    out = []
    for day in days_around(now, zone):
        if is_weekend(day) and not WEEKENDS:
            continue
        for i, (o, c) in enumerate(segs):
            out.append((local_to_utc(day, o, zone), local_to_utc(day, c, zone), phase_names[i] if phase_names else "core"))
    return out


def fmt(ts, zone):
    return ts.astimezone(ZoneInfo(zone)).strftime("%H:%M")


def build_events(now):
    """Every candidate event around `now` as (utc_time, key, text)."""
    ev = []
    # --- sessions
    for k, s in SESSIONS.items():
        segs = [(o, c) for _, o, c in s["phases"]]
        for (st, en, ph) in windows(now, s["zone"], segs, [p for p, _, _ in s["phases"]]):
            day = st.astimezone(ZoneInfo(s["zone"])).date().isoformat()
            if ph == "core":
                hrs = f"{fmt(st, s['zone'])}–{fmt(en, s['zone'])} {s['name'] if k != 'asia' else 'Melbourne'}"
                ev.append((st - timedelta(minutes=HEADSUP), f"{k}-headsup-{day}",
                           f"⏰ <b>{s['name']}</b> core session opens in {HEADSUP} min ({hrs})"))
                ev.append((st, f"{k}-open-{day}", f"{s['flag']} <b>{s['name'].upper()} SESSION OPEN</b> ({hrs})"))
                ev.append((en - timedelta(minutes=HEADSUP), f"{k}-closing-{day}",
                           f"⏳ <b>{s['name']}</b> session closes in {HEADSUP} min"))
                ev.append((en, f"{k}-close-{day}", f"🔔 <b>{s['name'].upper()} SESSION CLOSED</b>"))
            elif ph == "pre":
                ev.append((st, f"{k}-pre-{day}", f"{s['flag']} <b>{s['name']} pre-market</b> is open ({fmt(st, s['zone'])}–{fmt(en, s['zone'])} ET)"))
            elif ph == "post":
                ev.append((st, f"{k}-post-{day}", f"{s['flag']} <b>{s['name']} post-market</b> is open ({fmt(st, s['zone'])}–{fmt(en, s['zone'])} ET)"))
    # --- lunch breaks
    for k, name, zone, segs in EXCHANGES:
        if len(segs) > 1:
            for day in days_around(now, zone):
                if is_weekend(day) and not WEEKENDS:
                    continue
                a = local_to_utc(day, segs[0][1], zone)
                b = local_to_utc(day, segs[1][0], zone)
                d = day.isoformat()
                ev.append((a - timedelta(minutes=HEADSUP), f"{name}-breakhead-{d}", f"⏳ <b>{name}</b> goes on lunch break in {HEADSUP} min ({fmt(a, zone)}–{fmt(b, zone)} local)"))
                ev.append((b - timedelta(minutes=HEADSUP), f"{name}-reopenhead-{d}", f"⏰ <b>{name}</b> reopens from lunch in {HEADSUP} min"))
                ev.append((a, f"{name}-break-{d}", f"🍜 <b>{name}</b> lunch break ({fmt(a, zone)}–{fmt(b, zone)} local)"))
                ev.append((b, f"{name}-reopen-{d}", f"🔄 <b>{name}</b> reopened after lunch"))
    # --- every exchange: heads-up + moment for its first open and last close of the day
    for k, name, zone, segs in EXCHANGES:
        for day in days_around(now, zone):
            if is_weekend(day) and not WEEKENDS:
                continue
            o = local_to_utc(day, segs[0][0], zone)
            c = local_to_utc(day, segs[-1][1], zone)
            d = day.isoformat()
            hrs = f"{fmt(o, zone)}–{fmt(c, zone)} local"
            ev.append((o - timedelta(minutes=HEADSUP), f"{name}-xhead-open-{d}", f"⏰ <b>{name}</b> opens in {HEADSUP} min ({hrs})"))
            ev.append((o, f"{name}-xopen-{d}", f"🟢 <b>{name}</b> is open ({hrs})"))
            ev.append((c - timedelta(minutes=HEADSUP), f"{name}-xhead-close-{d}", f"⏳ <b>{name}</b> closes in {HEADSUP} min"))
            ev.append((c, f"{name}-xclose-{d}", f"🔴 <b>{name}</b> closed"))
    # --- multi-session = exchanges from >= 2 different sessions open at once (merged into periods)
    wins = []
    for k, name, zone, segs in EXCHANGES:
        for (st, en, _) in windows(now, zone, segs):
            wins.append((k, name, st, en))
    cuts = sorted({w[2] for w in wins} | {w[3] for w in wins})
    periods = []  # [start, end, [(a, b, sessions, exchanges)...]]
    for a, b in zip(cuts, cuts[1:]):
        mid = a + (b - a) / 2
        op = [w for w in wins if w[2] <= mid < w[3]]
        sess = {w[0] for w in op}
        if len(sess) >= 2:
            iv = (a, b, sess, {w[1] for w in op})
            if periods and periods[-1][1] == a:
                periods[-1][1] = b
                periods[-1][2].append(iv)
            else:
                periods.append([a, b, [iv]])

    def snames(sess):
        return " + ".join(SESSIONS[k]["name"] for k in ("asia", "ldn", "ny") if k in sess)

    for a, b, ivs in periods:
        d = a.strftime("%Y%m%d%H%M")
        first = ivs[0]
        win = f"{fmt(a, 'Australia/Melbourne')}–{fmt(b, 'Australia/Melbourne')} Melbourne time"
        detail = lambda iv: f"{snames(iv[2])} ({', '.join(sorted(iv[3]))})"
        ev.append((a - timedelta(minutes=HEADSUP), f"multi-head-{d}",
                   f"⚠️ <b>MULTI-SESSION in {HEADSUP} min</b> — {detail(first)}\n{win}"))
        ev.append((a, f"multi-start-{d}", f"🔥 <b>MULTI-SESSION LIVE</b> — {detail(first)}\nBest liquidity: {win}"))
        for prev, cur in zip(ivs, ivs[1:]):
            if cur[2] != prev[2] or cur[3] != prev[3]:
                ev.append((cur[0], f"multi-change-{d}-{cur[0].strftime('%H%M')}",
                           f"🔀 <b>Multi-session update</b> — now {detail(cur)}"))
        last = ivs[-1]
        ev.append((b - timedelta(minutes=HEADSUP), f"multi-endhead-{d}",
                   f"⚠️ <b>Multi-session ends in {HEADSUP} min</b> — {detail(last)}"))
        ev.append((b, f"multi-end-{d}", f"⚪ Multi-session ended ({snames(first[2] | last[2])})"))
    return ev


def open_now(now):
    names = []
    for k, s in SESSIONS.items():
        for (st, en, ph) in windows(now, s["zone"], [(o, c) for _, o, c in s["phases"]], [p for p, _, _ in s["phases"]]):
            if st <= now < en and ph == "core":
                names.append(s["name"])
    return names


def send(text):
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if os.environ.get("DRY_RUN") == "1" or not token or not chat:
        print("[dry run] " + text.replace("\n", " | "))
        return True
    params = {"chat_id": chat, "text": text, "parse_mode": "HTML", "disable_web_page_preview": "true"}
    thread = (os.environ.get("TELEGRAM_THREAD_ID") or "").strip()
    if thread:
        params["message_thread_id"] = thread
    data = urllib.parse.urlencode(params).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data), timeout=20) as r:
            ok = json.loads(r.read()).get("ok")
        print("sent:" , ok, text[:60].replace("\n", " "))
        return bool(ok)
    except Exception as e:  # noqa
        print(f"telegram send failed: {type(e).__name__}: {e}")
        return False


def main():
    if os.environ.get("SEND_TEST") == "1":
        send("✅ <b>TTM Session bot test</b> — connected. Session alerts will appear here.")
        return
    now = datetime.fromisoformat(os.environ["NOW_ISO"]) if os.environ.get("NOW_ISO") else datetime.now(timezone.utc)
    try:
        st = json.load(open(STATE))
    except Exception:
        st = {}
    last = datetime.fromtimestamp(st["last"], timezone.utc) if st.get("last") else now - timedelta(minutes=6)
    last = max(last, now - MAX_LOOKBACK)
    sent = set(st.get("sent", []))
    due = sorted((e for e in build_events(now) if last < e[0] <= now and e[1] not in sent), key=lambda e: e[0])
    print(f"window {last.isoformat()} -> {now.isoformat()}: {len(due)} event(s)")
    # catch-up after a gap: drop stale heads-ups ("opens in 10 min" is useless later), label late open/close news, cap the burst
    HEADS = ("head", "closing")
    stale = [e for e in due if any(h in e[1] for h in HEADS) and now - e[0] > timedelta(minutes=12)]
    sent.update(e[1] for e in stale)
    due = [e for e in due if e not in stale]
    if len(due) > 6:
        sent.update(e[1] for e in due[:-6])
        print(f"catch-up: skipping {len(due) - 6} older events")
        due = due[-6:]
    late = []
    for ts, key, text in due:
        mins = int((now - ts).total_seconds() // 60)
        late.append((ts, key, (f"🕒 <i>{mins} min ago (delayed)</i>\n" if mins >= 15 else "") + text))
    due = late
    # merge messages that fire at the same moment and are the same kind (e.g. LSE + Xetra both opening)
    def kind(key):
        return "head" if "head" in key else "moment"
    groups = {}
    for ts, key, text in due:
        k = (ts, kind(key))
        groups.setdefault(k, []).append((key, text))
    for (ts, kd), items in sorted(groups.items(), key=lambda kv: kv[0][0]):
        body = "\n".join(t for _, t in items)
        tail = ""
        if any(x in body for x in ("OPEN", "LIVE", "is open")):
            o = open_now(now)
            tail = f"\nCore sessions open: {', '.join(o) if o else 'none'}"
        if send(body + tail + f"\n<a href=\"{SITE}\">TTM Markets Terminal</a>"):
            sent.update(k for k, _ in items)
            time.sleep(1)
    json.dump({"last": now.timestamp(), "sent": sorted(sent)[-300:]}, open(STATE, "w"))


if __name__ == "__main__":
    main()
