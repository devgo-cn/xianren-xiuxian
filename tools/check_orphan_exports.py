#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查各模块 export { } 表里是否有【本文件已无定义】的悬空导出。
用法: python3 tools/check_orphan_exports.py  → 有悬空则打印并 exit 1
"""
import io, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

def defines(src, name):
    n = re.escape(name)
    pats = [
        r'(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+' + n + r'(?![\w$])',
        r'(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:const|let|var)\s+' + n + r'(?![\w$])',
        r'(?:^|\n)\s*export\s*\{[^}]*?(?<![\w$])' + n + r'(?![\w$])[^}]*\}',
        r'(?:^|\n)\s*class\s+' + n + r'(?![\w$])',
    ]
    return any(re.search(p, src) for p in pats)

bad = {}
for fn in sorted(os.listdir('src')):
    if not fn.endswith('.js'): continue
    p = os.path.join('src', fn)
    s = io.open(p, encoding='utf-8').read()
    i = s.find('\nexport {\n')
    if i < 0: continue
    j = s.find('};', i)
    if j < 0: continue
    body = s[i + len('\nexport {\n'): j]
    names = [t.strip() for t in body.split(',') if t.strip()]
    miss = [n for n in names if not defines(s, n)]
    if miss: bad[p] = miss

if bad:
    print('❌ 悬空导出:')
    for p, m in bad.items(): print('  %s → %s' % (p, m))
    sys.exit(1)
print('✅ 无悬空导出')
