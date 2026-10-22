#!/usr/bin/env python3
"""
Alerts when a tracked member of Congress (default: Nancy Pelosi) files a new stock-trade disclosure.

Source: the U.S. House Clerk's official financial-disclosure index (free, no key):
  https://disclosures-clerk.house.gov/public_disc/financial-pdfs/<year>FD.zip   (XML list of every filing)
Periodic Transaction Reports (filing type "P") are the buy/sell disclosures under the STOCK Act. For each NEW one we
download the PDF, read the transactions out of it (best effort) and post them to Telegram. If the PDF can't be read,
the alert still goes out with the link. Members have up to 45 days to file, so trades are reported weeks late.

Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_TRADFI_NEWS_THREAD_ID (topic for markets news; falls back to TELEGRAM_THREAD_ID).
Env: DRY_RUN=1, MEMBERS="Pelosi:Nancy;Another:Name" (last:first, semicolon separated), SEND_TEST=1.
First run only records existing filings (no flood). State: telegram_congress_state.json.
"""
import io, json, os, re, subprocess, sys, tempfile, time, html, urllib.request, urllib.parse, zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(ROOT, "telegram_congress_state.json")
DRY = os.environ.get("DRY_RUN", "0") == "1"
MEMBERS = [tuple(x.strip().lower() for x in m.split(":", 1)) for m in (os.environ.get("MEMBERS") or "Pelosi:Nancy").split(";") if ":" in m]
UA = {"User-Agent": "Mozilla/5.0 (compatible; TTMMarketsTerminalBot/1.0)"}
SITE = "https://ttm-tradethemove.github.io/ttm-markets-terminal/"
e = html.escape


def fetch(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return r.read()
        except Exception as ex:
            if i == tries - 1:
                print(f"fetch failed {url[:100]}: {type(ex).__name__}: {ex}")
                return None
            time.sleep(3 * (i + 1))


def send(text):
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    chat = (os.environ.get("TELEGRAM_CHAT_ID") or "").strip()
    env = os.environ.get
    thread = (env("TELEGRAM_TRADFI_NEWS_THREAD_ID") or env("TELEGRAM_NEWS_THREAD_ID") or env("TELEGRAM_THREAD_ID") or "").strip()
    if DRY or not token or not chat:
        print("[dry/unsent]", text.replace("\n", " | ")[:300])
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


def filings(year):
    """All periodic transaction reports for the tracked members this year: [{doc, name, date, year}]"""
    raw = fetch(f"https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{year}FD.zip")
    if not raw:
        return None
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
        xml = next(n for n in z.namelist() if n.lower().endswith(".xml"))
        root = ET.fromstring(z.read(xml))
    except Exception as ex:
        print("could not read the filing index:", ex)
        return None
    out = []
    for m in root.iter("Member"):
        g = lambda t: (m.findtext(t) or "").strip()
        if g("FilingType") != "P":
            continue
        last, first = g("Last").lower(), g("First").lower()
        if not any(last == l and first.startswith(f) for l, f in MEMBERS):
            continue
        out.append({"doc": g("DocID"), "name": f"{g('First')} {g('Last')}".title(), "date": g("FilingDate"), "year": g("Year") or str(year)})
    return out


MONEY = r"\$[\d,]+(?:\s*-\s*\$[\d,]+)?"
ROW = re.compile(r"(?P<asset>.+?)\s+(?P<type>P|S|S\s*\(partial\)|E)\s+(?P<tdate>\d\d/\d\d/\d{4})\s+(?P<ndate>\d\d/\d\d/\d{4})\s+(?P<amt>" + MONEY + ")")


def short_amt(a):
    def s(x):
        n = int(x.replace("$", "").replace(",", ""))
        if n >= 1_000_000:
            m = round(n / 1_000_000, 1)
            return f"${m:g}M"
        return f"${round(n / 1000)}K" if n >= 1000 else f"${n}"
    try:
        parts = [p.strip() for p in a.split("-")]
        return " – ".join(s(p) for p in parts)
    except Exception:
        return a


def trades(pdf_bytes):
    """Best-effort read of the transactions table with pdftotext. Returns [(action, ticker_or_asset, amount, traded_date)]"""
    try:
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "f.pdf")
            open(p, "wb").write(pdf_bytes)
            txt = subprocess.run(["pdftotext", "-layout", p, "-"], capture_output=True, text=True, timeout=60).stdout
    except Exception as ex:
        print("pdftotext failed:", ex)
        return []
    return parse_text(txt)


def parse_text(txt):
    out = []
    for line in txt.splitlines():
        m = ROW.search(" ".join(line.split()))
        if not m:
            continue
        asset = re.sub(r"^(SP|JT|DC)\s+", "", m["asset"].strip())
        t = re.search(r"\(([A-Z][A-Z.\-]{0,5})\)", asset)
        name = t.group(1) if t else re.sub(r"\s*\[[A-Z]{2}\]\s*$", "", asset)[:40]
        kind = m["type"].upper().replace(" ", "")
        action = {"P": "buy", "S": "sell", "S(PARTIAL)": "sell (partial)", "E": "exchange"}.get(kind, kind)
        out.append((action, name, short_amt(m["amt"]), m["tdate"]))
    return out


def message(f, tr):
    head = f"🏛️ <b>{e(f['name'])}</b> filed a new stock-trade disclosure"
    if f["date"]:
        head += f" ({e(f['date'])})"
    lines = [head]
    for action, name, amt, tdate in tr[:10]:
        icon = "🟢" if action == "buy" else "🔴" if action.startswith("sell") else "🔁"
        lines.append(f"{icon} {action.upper()} <b>{e(name)}</b> · {e(amt)} · traded {e(tdate)}")
    if len(tr) > 10:
        lines.append(f"…and {len(tr) - 10} more in the filing")
    if not tr:
        lines.append("Open the filing for the trades (could not read them automatically).")
    lines.append(f"<a href=\"https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{e(f['year'])}/{e(f['doc'])}.pdf\">Official filing (PDF)</a> · <a href=\"{SITE}tradfi/?only=congress\">Open in TTM</a>")
    lines.append("Disclosures can lag the actual trades by up to 45 days. Not a trade call.")
    return "\n".join(lines)


def main():
    if os.environ.get("SEND_TEST") == "1":
        ok = send("✅ TTM Congress alerts connected. You'll get a post here when a tracked member files a new stock-trade disclosure.")
        print("test sent" if ok else "test NOT sent")
        if not ok:
            sys.exit(1)
        return
    st = None
    try:
        st = json.load(open(STATE))
    except Exception:
        pass
    seeded = st is not None
    seen = set((st or {}).get("seen", []))
    year = datetime.now(timezone.utc).year
    fs = filings(year)
    if fs is None:
        print("filing index unavailable this run; keeping state")
        return
    new = [f for f in fs if f["doc"] not in seen]
    print(f"{len(fs)} filing(s) for tracked members this year, {len(new)} new" + ("" if seeded else " (first run: recording only)"))
    sent_docs = set()
    if seeded:
        for f in sorted(new, key=lambda f: f["date"]):
            pdf = fetch(f"https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{f['year']}/{f['doc']}.pdf")
            tr = trades(pdf) if pdf else []
            if send(message(f, tr)):
                sent_docs.add(f["doc"])
            time.sleep(1.2)
    else:
        sent_docs = {f["doc"] for f in new}
    seen |= sent_docs
    json.dump({"seen": sorted(seen)}, open(STATE, "w"))


if __name__ == "__main__":
    main()
