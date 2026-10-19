#!/usr/bin/env python3
"""Point each ASSETS entry in crypto/index.html at the report files that exist."""
import re, os
p = 'crypto/index.html'; s = open(p, encoding='utf-8').read()
def fix(m):
    t = m.group(1); rest = m.group(0)
    rev, deep = f'{t}_Asset_Review_TTM.html', f'{t}_Deep_Dive_TTM.html'
    r = f'"{rev}"' if os.path.exists('crypto/' + rev) else 'null'
    d = f'"{deep}"' if os.path.exists('crypto/' + deep) else 'null'
    return re.sub(r'review:(?:"[^"]*"|null),deep:(?:"[^"]*"|null)', f'review:{r},deep:{d}', rest)
s2 = re.sub(r'\{ticker:"([A-Za-z0-9_]+)",name:"[^"]*",review:[^}]*\}', fix, s)
open(p, 'w', encoding='utf-8').write(s2); print('changed' if s2 != s else 'no change')
