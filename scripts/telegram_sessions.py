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
SITE = "https://ttm-tradethemove.github.io/ttm-markets-terminal/crypto/#tradinghours"
HEADSUP = int(os.environ.get("HEADSUP_MIN", "15"))
WEEKENDS = os.environ.get("INCLUDE_WEEKENDS", "0") == "1"
MAX_LOOKBACK = timedelta(minutes=20)  # never replay more than this after an outage
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
                ev.append((a, f"{name}-break-{d}", f"🍜 <b>{name}</b> lunch break ({fmt(a, zone)}–{fmt(b, zone)} local)"))
                ev.append((b, f"{name}-reopen-{d}", f"🔄 <b>{name}</b> reopened after lunch"))
    # --- cross-region overlaps (>= 2 regions open at once), merged into continuous periods
    wins = []
    for k, name, zone, segs in EXCHANGES:
        for (st, en, _) in windows(now, zone, segs):
            wins.append((k, name, st, en))
    cuts = sorted({w[2] for w in wins} | {w[3] for w in wins})
    periods = []
    for a, b in zip(cuts, cuts[1:]):
        mid = a + (b - a) / 2
        op = [w for w in wins if w[2] <= mid < w[3]]
        if len({w[0] for w in op}) >= 2:
            if periods and periods[-1][1] == a:
                periods[-1][1] = b
                periods[-1][2].update(w[1] for w in op)
            else:
                periods.append([a, b, {w[1] for w in op}])
    for a, b, names in periods:
        label = " + ".join(sorted(names))
        d = a.date().isoformat() + a.strftime("%H%M")
        ev.append((a, f"overlap-start-{d}", f"🔥 <b>OVERLAP LIVE</b> — {label}\nBest liquidity: {fmt(a, 'Australia/Melbourne')}–{fmt(b, 'Australia/Melbourne')} Melbourne time"))
        ev.append((b, f"overlap-end-{d}", f"⚪ Overlap ended ({label})"))
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
    data = urllib.parse.urlencode({"chat_id": chat, "text": text, "parse_mode": "HTML",
                                   "disable_web_page_preview": "true"}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data), timeout=20) as r:
            ok = json.loads(r.read()).get("ok")
        print("sent:" , ok, text[:60].replace("\n", " "))
        return bool(ok)
    except Exception as e:  # noqa
        print(f"telegram send failed: {type(e).__name__}: {e}")
        return False


def main():
    now = datetime.now(timezone.utc)
    try:
        st = json.load(open(STATE))
    except Exception:
        st = {}
    last = datetime.fromtimestamp(st["last"], timezone.utc) if st.get("last") else now - timedelta(minutes=6)
    last = max(last, now - MAX_LOOKBACK)
    sent = set(st.get("sent", []))
    due = sorted((e for e in build_events(now) if last < e[0] <= now and e[1] not in sent), key=lambda e: e[0])
    print(f"window {last.isoformat()} -> {now.isoformat()}: {len(due)} event(s)")
    for ts, key, text in due:
        tail = ""
        if "OPEN" in text or "OVERLAP LIVE" in text:
            o = open_now(now)
            tail = f"\nCore sessions open: {', '.join(o) if o else 'none'}"
        if send(text + tail + f"\n<a href=\"{SITE}\">Live clocks</a>"):
            sent.add(key)
            time.sleep(1)
    json.dump({"last": now.timestamp(), "sent": sorted(sent)[-300:]}, open(STATE, "w"))


if __name__ == "__main__":
    main()
