#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查跨模块 import 的名字在对端模块是否真的有导出。"""
import io, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

def exports_of(path):
    s = io.open(path, encoding='utf-8').read()
    out = set()
    for m in re.finditer(r'(?:^|\n)\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)', s):
        out.add(m.group(1))
    for m in re.finditer(r'(?:^|\n)\s*export\s+(?:async\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)', s):
        out.add(m.group(1))
    i = s.find('\nexport {\n')
    if i >= 0:
        j = s.find('};', i)
        body = s[i + len('\nexport {\n'): j]
        for t in body.split(','):
            t = t.strip()
            if t: out.add(t.split(' as ')[-1].strip())
    for m in re.finditer(r'export\s*\{([^}]*)\}', s):
        for t in m.group(1).split(','):
            t = t.strip()
            if t: out.add(t.split(' as ')[-1].strip())
    return out

EXP = {f: exports_of(os.path.join('src', f))
       for f in os.listdir('src') if f.endswith('.js')}

bad = []
for f in sorted(os.listdir('src')):
    if not f.endswith('.js'): continue
    s = io.open(os.path.join('src', f), encoding='utf-8').read()
    for m in re.finditer(r"import\s*\{([^}]*)\}\s*from\s*['\"]\./([\w.-]+\.js)['\"]", s):
        names = [t.strip().split(' as ')[0].strip() for t in m.group(1).split(',') if t.strip()]
        tgt = m.group(2)
        if tgt not in EXP: continue
        for n in names:
            if n not in EXP[tgt]:
                bad.append('%s → %s 未导出 %s' % (f, tgt, n))
if bad:
    print('❌ 断链 import:')
    for b in sorted(set(bad)): print('  ' + b)
    sys.exit(1)
print('✅ import 全部有对应导出')
