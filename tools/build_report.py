#!/usr/bin/env python3
"""
Build a TTM Deep Dive or Asset Review HTML page from a JSON spec.
usage: build_report.py specs/ALGO_deep.json   -> crypto/ALGO_Deep_Dive_TTM.html
Layout/CSS are lifted from the existing AVAX reports so new pages match the library.
Spec text fields may contain <b>, <i>, &amp; only.
"""
import json, re, sys, os, html
sys.path.insert(0, os.path.dirname(__file__))
from add_return_button import patch

BASE = {"deep": "crypto/AVAX_Deep_Dive_TTM.html", "review": "crypto/AVAX_Asset_Review_TTM.html"}
LOGO = "ttm_logo.png"

def head_css(kind):
    h = open(BASE[kind], encoding="utf-8").read()
    s = re.sub(r"base64,[A-Za-z0-9+/=]{100,}", "base64,LOGO", h)
    s = re.sub(r'<style id="ttm-return-css">.*?</style>', "", s, flags=re.S)
    return s[s.index("<head>") + 6: s.index("</head>")], s

def li(items): return "".join(f"<li>{x}</li>" for x in items)

def card(c): return f'<div class="card"><h3><span class="dot {c.get("dot","n")}"></span>{c["title"]}</h3><ul>{li(c["items"])}</ul></div>'

def stats(rows):
    out = []
    for r in rows:
        lab, val = r[0], r[1]; cls = r[2] if len(r) > 2 else ""
        st = ' style="color:var(--down);"' if cls == "down" else ' style="color:var(--up);"' if cls == "up" else ""
        c = "value gold" if cls == "gold" else "value"
        out.append(f'<div class="stat"><div class="label">{lab}</div><div class="{c}"{st}>{val}</div></div>')
    return '<div class="stat-grid" style="margin-top:24px;">' + "".join(out) + "</div>"

def block(b):
    t = b["type"]
    if t == "stats": return stats(b["rows"])
    if t == "card": return '<div style="margin-top:24px;">' + card(b) + "</div>"
    if t == "twocol": return '<div class="two-col" style="margin-top:24px;">' + "".join(card(c) for c in b["cards"]) + "</div>"
    if t == "alert": return f'<div class="alert-box"><div class="label">{b["label"]}</div><p>{b["text"]}</p></div>'
    if t == "timeline": return '<div class="timeline" style="margin-top:24px;">' + "".join(f'<div class="t-item"><div class="t-year">{y}</div><div class="t-desc">{d}</div></div>' for y, d in b["items"]) + "</div>"
    if t == "para": return f'<div style="margin-top:22px; font-size:13.5px; color:var(--ink-dim); max-width:680px; line-height:1.7;">{b["text"]}</div>'
    if t == "age": return f'<div class="age-callout"><div class="num">{b["num"]}</div><div class="txt"><div class="label">{b["label"]}</div><p>{b["text"]}</p></div></div>'
    if t == "levels":
        names = {"res": "Resistance", "sup": "Support", "piv": "Pivot"}
        rows = "".join(f'<tr><td>{r[0]}</td><td>{r[1]}</td><td><span class="tag {r[2]}">{r[3] if len(r) > 3 else names[r[2]]}</span></td></tr>' for r in b["rows"])
        mom = "".join(f'<li><span class="k">{k}</span><span class="v">{v}</span></li>' for k, v in b.get("momentum", []))
        return f'<div class="tech-grid"><div><table class="levels"><tr><th>Level</th><th>Price</th><th>Type</th></tr>{rows}</table></div><div><ul class="momentum-list">{mom}</ul></div></div>'
    if t == "verdict": return '<div class="verdict-box">' + "".join(f"<p>{p}</p>" for p in b["paras"]) + "</div>"
    raise ValueError("unknown block " + t)

def section(i, s, kind):
    out = [f'<section>\n<div class="sec-head"><span class="sec-num">{i:02d}</span><h2>{s["title"]}</h2></div>']
    if s.get("sub"): out.append(f'<p class="sec-sub" style="max-width:680px;">{s["sub"]}</p>')
    if s.get("banner"): out.append(f'<div class="framework-banner"><div class="label">Framework Check</div><p>{s["banner"]}</p></div>')
    out += [block(b) for b in s["blocks"]]
    out.append("</section>")
    return "\n".join(out)

def build(spec_path):
    sp = json.load(open(spec_path, encoding="utf-8")); kind = sp["kind"]; t = sp["ticker"]
    head, _ = head_css(kind)
    head = re.sub(r"<title>.*?</title>", f'<title>{sp["name"]} ({sp["ticker_display"]}) {"Deep Dive" if kind=="deep" else "Asset Review"} — TTM | Trade The Move</title>', head, flags=re.S)
    label = "Deep Dive Research" if kind == "deep" else "Asset Review"
    eyebrow = "Full Research Report" if kind == "deep" else "Digital Asset Review"
    suffix = f'/ {sp["ticker_display"]} Deep Dive' if kind == "deep" else f'/ {sp["ticker_display"]}'
    body = f'''<div class="hero">
  <div class="hero-inner">
    <div class="logo-row">
      <img src="{LOGO}" alt="TTM — Trade The Move">
      <div class="brief-tag">{label} · {sp["date"]}</div>
    </div>
    <div class="eyebrow">{eyebrow}</div>
    <h1 class="title">{sp["name"]} <span>{suffix}</span></h1>
    <p class="subhead">{sp["subhead"]}</p>
    <div class="price-strip">
      <div class="px">{sp["price"]}</div>
      <div class="chg{" up" if sp.get("chg_up") else ""}">{sp["chg"]}</div>
    </div>
    <div class="price-meta" style="margin-top:10px;">{sp["price_meta"]}</div>
  </div>
</div>
<div class="wrap">
''' + "\n".join(section(i + 1, s, kind) for i, s in enumerate(sp["sections"]))
    if kind == "deep":
        body = body  # synthesis is a normal last section with a verdict block
    foot = f'''
  <footer>
    <div class="disclaimer">
      <div class="footer-brand"><img src="{LOGO}" alt="TTM"><span>TTM · TRADE THE MOVE — {"DEEP DIVE RESEARCH SERIES" if kind=="deep" else "ASSET REVIEW SERIES"}</span></div>
      This document is for informational and educational purposes only and does not constitute financial, investment, or trading advice. Data points are reference figures as of the dates noted and can change materially, and some figures vary across sources. Cryptocurrency markets are highly volatile and carry risk of substantial or total capital loss. Always do your own research and consult a licensed financial advisor before making investment decisions. Not a recommendation to buy or sell {sp["ticker_display"]} or any other asset.
    </div>
  </footer>
</div>
</body>
</html>
'''
    page = f'<!DOCTYPE html>\n<html lang="en">\n<head>{head}</head>\n<body>\n{body}{foot}'
    out = f'crypto/{sp["file"]}'
    open(out, "w", encoding="utf-8").write(page)
    patch(out, "index.html#library")
    return out

if __name__ == "__main__":
    for p in sys.argv[1:]: print("built", build(p))
