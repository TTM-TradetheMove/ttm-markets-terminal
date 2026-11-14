#!/usr/bin/env python3
"""
TTM daily market brief: written from the terminal's own data files (no AI, no extra feeds), saved to daily_brief.json for the
terminal and sent to Telegram.

Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. Optional: TELEGRAM_BRIEF_THREAD_ID (own topic; falls back to TELEGRAM_NEWS_THREAD_ID, then TELEGRAM_THREAD_ID),
TELEGRAM_NEWS_CHAT_ID (separate group).
Env: DRY_RUN=1 (print only, write nothing), FORCE=1 (ignore the 7am Melbourne check and the sent-today check).
It runs twice a day in UTC so it lands at 7am Melbourne in summer and winter; the script only goes ahead in the 7am Melbourne hour, once per day.
"""
import json, os, html, time, urllib.request, urllib.parse
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEL = ZoneInfo("Australia/Melbourne")
DRY = os.environ.get("DRY_RUN", "0") == "1"
FORCE = os.environ.get("FORCE", "0") == "1"
SITE = "https://ttm-tradethemove.github.io/ttm-markets-terminal/"
e = html.escape
NOW = datetime.now(timezone.utc)
MNOW = NOW.astimezone(MEL)


def load(name, default=None):
    try:
        return json.load(open(os.path.join(ROOT, name)))
    except Exception:
        return default


def age_h(doc):
    try:
        return (NOW - datetime.fromisoformat(doc["generated_at"].replace("Z", "+00:00"))).total_seconds() / 3600
    except Exception:
        return None


def px(v):
    return f"{v:,.0f}" if v >= 1000 else f"{v:,.2f}" if v >= 1 else f"{v:.4f}"


def pct(v, d=1):
    r = round(v, d)
    return f"{'+' if r > 0 else ''}{abs(r) if r == 0 else r:.{d}f}%"


def usd(n):
    return f"${n/1e9:.2f}B" if n >= 1e9 else f"${n/1e6:.1f}M" if n >= 1e6 else f"${n/1e3:.0f}K"


def arrow(v):
    return "🟢" if v > 0.05 else "🔴" if v < -0.05 else "⚪"


def build():
    S = []          # sections: {"h": heading, "lines": [text, ...]}
    notes = []      # data that was too old to use
    head_bits = []

    # ---- crypto prices + movers (rsi_heatmap carries price and 24h change for the top coins)
    rsi = load("rsi_heatmap.json") or {}
    coins = {c["s"]: c for c in rsi.get("coins", []) if "p" in c}
    if coins and (age_h(rsi) or 0) < 12:
        lines = []
        for k in ("BTC", "ETH", "SOL"):
            c = coins.get(k)
            if c:
                lines.append(f"{arrow(c['c'])} {k} ${px(c['p'])} ({pct(c['c'])} 24h)")
        big = [c for c in coins.values() if c.get("v24", 0) > 50e6 and c["s"] not in ("USDT", "USDC")]
        big.sort(key=lambda c: c["c"], reverse=True)
        if big:
            lines.append("Top movers: " + ", ".join(f"{c['s']} {pct(c['c'])}" for c in big[:3]) + " · Weakest: " + ", ".join(f"{c['s']} {pct(c['c'])}" for c in big[-3:][::-1]))
        S.append({"h": "Crypto", "lines": lines})
        b = coins.get("BTC")
        if b:
            head_bits.append(f"BTC ${px(b['p'])} ({pct(b['c'])})")
        # RSI stretch on the daily chart across the biggest coins
        hot = [c["s"] for c in big if c.get("r", {}).get("1d", 50) >= 70][:5]
        cold = [c["s"] for c in big if c.get("r", {}).get("1d", 50) <= 30][:5]
        if hot or cold:
            S[-1]["lines"].append("Daily RSI: " + ("overbought " + ", ".join(hot) if hot else "") + (" · " if hot and cold else "") + ("oversold " + ", ".join(cold) if cold else ""))
    else:
        notes.append("crypto prices")

    # ---- sentiment
    fg = load("fear_greed_data.json") or {}
    cur = fg.get("current")
    if cur:
        hist = fg.get("history", [])
        prev = next((h for h in hist if h.get("date") != cur.get("date")), None)
        t = f"Fear & Greed: {cur['value']} ({cur['classification']})"
        if prev:
            d = cur["value"] - prev["value"]
            t += f", {'up' if d > 0 else 'down' if d < 0 else 'unchanged'} {abs(d)} from yesterday" if d else ", unchanged from yesterday"
        S.append({"h": "Sentiment", "lines": [t]})
        head_bits.append(f"F&G {cur['value']}")

    # ---- derivatives: funding + liquidations
    dl = []
    fd = load("funding_data.json") or {}
    snaps = fd.get("snapshots", [])
    if snaps:
        by = {}
        for s in snaps:
            sym = s.get("symbol", "")[:3]
            if sym in ("BTC", "ETH") and s.get("fundingRate") is not None:
                by.setdefault(sym, []).append(s["fundingRate"])
        for sym, v in by.items():
            avg = sum(v) / len(v) * 100
            mood = "crowded longs" if avg > 0.03 else "crowded shorts" if avg < -0.01 else "neutral"
            dl.append(f"{sym} funding {avg:+.4f}% per 8h ({mood})")
    lq = load("liquidation_totals.json") or {}
    if lq.get("agg5"):
        cut = (NOW.timestamp() - 24 * 3600) * 1000
        L = sum(r[3] for r in lq["agg5"] if r[2] == 0 and r[0] >= cut)
        Sh = sum(r[4] for r in lq["agg5"] if r[2] == 0 and r[0] >= cut)
        if L + Sh > 0:
            dl.append(f"Liquidations seen in the last 24h: {usd(L + Sh)} (longs {usd(L)}, shorts {usd(Sh)})" + (" · mostly longs wiped out" if L > Sh * 2 else " · mostly shorts wiped out" if Sh > L * 2 else ""))
    if dl:
        S.append({"h": "Derivatives", "lines": dl})

    # ---- traditional markets
    tm = load("tradfi_markets.json") or {}
    if tm.get("indices") and (age_h(tm) or 0) < 48:
        lines = []
        ix = {i["name"]: i for i in tm["indices"]}
        lines.append(" · ".join(f"{n} {pct(ix[n]['chg_pct'], 2)}" for n in ("S&P 500", "Nasdaq 100", "ASX 200", "Nikkei 225", "FTSE 100", "DAX") if n in ix))
        mc = tm.get("macro", {})
        bits = []
        for key, label in (("dxy", "DXY"), ("gold", "Gold"), ("oil", "Oil"), ("us10y", "US10Y")):
            if key in mc:
                bits.append(f"{label} {px(mc[key]['price'])} ({pct(mc[key]['chg_pct'], 2)})")
        if bits:
            lines.append(" · ".join(bits))
        if tm.get("vix"):
            lines.append(f"VIX {tm['vix']['price']:.1f} ({pct(tm['vix']['chg_pct'])})")
        if tm.get("risk"):
            lines.append(f"TTM risk read: {tm['risk']['label']}")
        S.append({"h": "Traditional markets", "lines": lines})
        if tm.get("risk"):
            head_bits.append(f"risk {tm['risk']['label'].lower()}")

    # ---- today's high-impact calendar (next 24h)
    cal = load("calendar_data.json") or {}
    ev = []
    for x in cal.get("events", []):
        ts = x.get("ts")
        if x.get("impact") == "high" and ts and NOW.timestamp() <= ts <= NOW.timestamp() + 24 * 3600:
            ev.append((ts, x))
    ev.sort(key=lambda t: t[0])
    if ev:
        lines = []
        for ts, x in ev[:8]:
            t = datetime.fromtimestamp(ts, MEL).strftime("%a %-I:%M%p").replace("AM", "am").replace("PM", "pm")
            extra = " · forecast " + x["forecast"] if x.get("forecast") not in (None, "", "—") else ""
            lines.append(f"{t} {x.get('country', '')} {x['event']}{extra}")
        S.append({"h": "High-impact events (next 24h, Melbourne time)", "lines": lines})
    else:
        S.append({"h": "High-impact events", "lines": ["None in the next 24 hours."]})

    day = MNOW.strftime("%A %-d %B")
    headline = " · ".join(head_bits) if head_bits else "Market snapshot"
    return {"date": MNOW.strftime("%Y-%m-%d"), "title": f"TTM Daily Brief, {day}", "headline": headline, "sections": S,
            "stale": notes, "generated_at": NOW.isoformat(timespec="seconds")}


def telegram_text(b):
    out = [f"☀️ <b>{e(b['title'])}</b>", f"<i>{e(b['headline'])}</i>", ""]
    for s in b["sections"]:
        out.append(f"<b>{e(s['h'])}</b>")
        out += ["• " + e(l) for l in s["lines"]]
        out.append("")
    out.append(f"<a href=\"{SITE}crypto/\">Open the TTM terminal</a>  ·  <i>Built automatically from TTM's data feeds. Not financial advice.</i>")
    return "\n".join(out)


def send(text):
    env = os.environ.get
    token = (env("TELEGRAM_BOT_TOKEN") or "").strip()
    chat = (env("TELEGRAM_NEWS_CHAT_ID") or env("TELEGRAM_CHAT_ID") or "").strip()
    thread = (env("TELEGRAM_BRIEF_THREAD_ID") or env("TELEGRAM_NEWS_THREAD_ID") or env("TELEGRAM_THREAD_ID") or "").strip()
    if DRY or not token or not chat:
        print("[dry/unsent]\n" + text)
        return DRY
    params = {"chat_id": chat, "text": text, "parse_mode": "HTML", "disable_web_page_preview": "true"}
    if thread:
        params["message_thread_id"] = thread
    try:
        with urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=urllib.parse.urlencode(params).encode()), timeout=20) as r:
            return json.loads(r.read()).get("ok", False)
    except Exception as ex:
        print("telegram send failed:", ex)
        return False


def main():
    prev = load("daily_brief.json") or {}
    if not FORCE and not DRY:
        if MNOW.hour != 7:
            print("Not 7am in Melbourne, skipping.")
            return
        if prev.get("date") == MNOW.strftime("%Y-%m-%d") and prev.get("sent"):
            print("Already sent today.")
            return
    b = build()
    ok = send(telegram_text(b))
    b["sent"] = bool(ok)
    if DRY:
        return
    json.dump(b, open(os.path.join(ROOT, "daily_brief.json"), "w"), indent=1, ensure_ascii=False)
    print("brief saved; telegram", "sent" if ok else "NOT sent")


if __name__ == "__main__":
    main()
