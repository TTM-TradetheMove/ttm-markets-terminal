#!/usr/bin/env python3
"""Add (idempotently) a fixed 'Return' button to every report page."""
import glob, os, re, sys
CSS = ('<style id="ttm-return-css">.ttm-return{position:fixed;top:14px;left:14px;z-index:9999;display:inline-flex;align-items:center;gap:8px;'
       'padding:9px 16px;background:rgba(9,8,10,.92);border:1px solid #d4af37;color:#f4d375;border-radius:999px;'
       'font:600 13px/1 Inter,system-ui,sans-serif;letter-spacing:.04em;text-decoration:none;cursor:pointer;'
       'backdrop-filter:blur(6px);box-shadow:0 4px 18px rgba(0,0,0,.5)}.ttm-return:hover{background:#d4af37;color:#09080a}'
       '@media print{.ttm-return{display:none}}</style>')
def btn(href):
    return ('<a class="ttm-return" id="ttm-return" href="%s">&larr; Return</a>'
            '<script>document.getElementById("ttm-return").addEventListener("click",function(e){'
            'try{if(window.opener&&!window.opener.closed){e.preventDefault();window.opener.focus();window.close();'
            'setTimeout(function(){location.href=this.href}.bind(this),150);}}catch(x){}});</script>' % href)
def patch(path, href):
    h = open(path, encoding='utf-8').read()
    if 'id="ttm-return"' in h: return False
    h = h.replace('</head>', CSS + '</head>', 1)
    h = re.sub(r'(<body[^>]*>)', lambda m: m.group(1) + btn(href), h, 1)
    open(path, 'w', encoding='utf-8').write(h); return True
if __name__ == '__main__':
    n = 0
    for f in sorted(glob.glob('crypto/*.html')):
        if os.path.basename(f) in ('index.html', 'debug_ff.html'): continue
        n += patch(f, 'index.html#library')
    for f in sorted(glob.glob('tradfi/*.html')):
        if os.path.basename(f) in ('index.html', 'debug_ff.html'): continue
        n += patch(f, 'index.html')
    print('patched', n)
