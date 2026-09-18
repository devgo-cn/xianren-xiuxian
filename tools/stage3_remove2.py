#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段3 第2批: 清理法宝系统的消费者。
保留: rateNow / buffMult / arrMult / 境界链 —— 它们属阶段5, 此处只摘掉法宝那一项。
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
FAIL = []

def rd(p): return io.open(p, encoding='utf-8').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8').write(s)

def sub1(t, o, n, l):
    if o not in t:
        FAIL.append('sub1: ' + l); return t
    return t.replace(o, n, 1)

def del_func(t, sig, l):
    i = t.find(sig)
    if i < 0:
        FAIL.append('del_func: ' + l); return t
    ls = t.rfind('\n', 0, i) + 1
    k = t.find('{', i)
    if k < 0:
        FAIL.append('del_func 无体: ' + l); return t
    depth, j = 0, k
    while j < len(t):
        if t[j] == '{': depth += 1
        elif t[j] == '}':
            depth -= 1
            if depth == 0:
                j += 1; break
        j += 1
    while j < len(t) and t[j] in ' \t': j += 1
    if j < len(t) and t[j] == '\n': j += 1
    while j < len(t) and t[j] == '\n': j += 1
    return t[:ls] + t[j:]

def del_export(t, name):
    if ('  %s,\n' % name) in t: return t.replace('  %s,\n' % name, '', 1)
    FAIL.append('导出: ' + name); return t

def del_import(t, name):
    out = []
    for line in t.split('\n'):
        if line.startswith('import {') and re.search(r'(?<![\w$])%s(?![\w$])' % re.escape(name), line):
            line = re.sub(r'(?<![\w$])%s(?![\w$])\s*,\s*' % re.escape(name), '', line, count=1)
            if re.search(r'(?<![\w$])%s(?![\w$])' % re.escape(name), line):
                line = re.sub(r',\s*(?<![\w$])%s(?![\w$])' % re.escape(name), '', line, count=1)
        out.append(line)
    return '\n'.join(out)

def del_bridge(t, name):
    n2 = re.sub(r'\n  "%s": function \(\) \{[^\n]*\},' % re.escape(name), '', t)
    if n2 == t: FAIL.append('桥接: ' + name)
    return n2

# ═══ 10-base.js: artMult 摘掉法宝项 ═══════════════════════════════
p = 'src/10-base.js'; s = rd(p)
s = sub1(s,
'''function artMult() { /* v1.9.9 累乘→弱化加算: 4件玄天级(3.8)从 55x 压到 3.5x, 6件从 3011x 压到 6.9x —— 累乘乘区随装备成长指数爆炸(实测 42h 炼气→化神圆满), 需求曲线追不上; 同式已同步服务端 game-core.js rateNowOf */
  return 1 + state.arts.reduce((m, a) => m + ((a.mult || 1) - 1), 0) * 0.12;
}''',
'''/* ⚠️ v6 重构: 法宝系统已删除, 这里恒为 1。
 * 保留函数名是因为 rateNow() 仍在乘法链上 —— 整条 rateNow 链路属【阶段5】
 * 的清理范围（届时随旧打坐体系一起下线），此处只摘掉法宝这一项。 */
function artMult() { return 1; }''', 'artMult 去法宝')
wr(p, s)
print('10-base.js: artMult 已去法宝项')

# ═══ 20-core.js ══════════════════════════════════════════════════
p = 'src/20-core.js'; s = rd(p); orig = len(s)
# 删掉法宝相关函数: makeArt/updateArts/renderEquip/pickArt/equipBonus 引用段等
for sig, l in [
    ('function equipBonus()', 'core equipBonus'),
]:
    s = del_func(s, sig, l)
# ensureScrollFx 调用
s = sub1(s, '      ensureScrollFx();         // v2.5: 旧档功法补攻速词条\n', '', 'core ensureScrollFx 调用')
# artCtx 调用段 (360 附近): 找到整个使用块
i = s.find('  const c = artCtx();')
if i >= 0:
    # 删到下一个空行后的顶层 function
    j = s.find('\nfunction ', i)
    if j < 0: FAIL.append('core artCtx 块尾')
    else: s = s[:i] + s[j + 1:]
else:
    FAIL.append('core artCtx 调用')
for n in ['EQUI_SLOTN', 'artCtx', 'ensureScrollFx', 'licBuild']:
    s = del_import(s, n)
wr(p, s)
print('20-core.js  %6d -> %6d' % (orig, len(s)))

# ═══ 30-systems.js ══════════════════════════════════════════════
p = 'src/30-systems.js'; s = rd(p); orig = len(s)
for sig, l in [
    ('function makeArt()', 'makeArt'),
    ('function openEquip()', 'openEquip'),
    ('function renderEquip()', 'renderEquip'),
    ('function pickArt(i)', 'pickArt'),
    ('function pickQ()', 'pickQ'),
]:
    s = del_func(s, sig, l)
s = sub1(s,
    '  return Math.max(0, fin(4 * realmMult() * artMult() * arrMult(state.arrayLv) * buffMult() * boostMult(), 0));',
    '  return Math.max(0, fin(4 * realmMult() * arrMult(state.arrayLv) * buffMult() * boostMult(), 0));',
    'rateNow 去 artMult')
for n in ['makeArt', 'openEquip', 'renderEquip', 'pickArt', 'pickQ',
          'artMult', 'artName', 'attrAssign', 'equipBonus', 'EQUI_SLOTN',
          'TOTAL_SEGS']:
    s = del_export(s, n)
for n in ['artMult', 'artName', 'attrAssign', 'equipBonus', 'EQUI_SLOTN',
          'TOTAL_SEGS', 'EQ_POW', 'QW_TABLE', 'QUALITY']:
    s = del_import(s, n)
wr(p, s)
print('30-systems.js  %6d -> %6d' % (orig, len(s)))

# ═══ 40-app.js ══════════════════════════════════════════════════
p = 'src/40-app.js'; s = rd(p); orig = len(s)
for n in ['TOTAL_SEGS', 'ensureScrollFx']:
    s = del_import(s, n)
for n in ['ensureScrollFx']:
    s = re.sub(r'\n\s*ensureScrollFx\(\);[^\n]*', '', s)
wr(p, s)
print('40-app.js  %6d -> %6d' % (orig, len(s)))

# ═══ main.js 桥接 ═══════════════════════════════════════════════
p = 'src/main.js'; s = rd(p); orig = len(s)
for n in ['artCtx', 'equipBonus', 'ensureScrollFx', 'licBuild', 'makeArt',
          'openEquip', 'pickArt', 'pickQ', 'artName', 'attrAssign',
          'rollFx', 'rollMonFx', 'fmtFxTag', 'renderEquip', 'closeEquip']:
    s = del_bridge(s, n)
wr(p, s)
print('main.js  %6d -> %6d' % (orig, len(s)))

if FAIL:
    print('\n❌ 未命中:')
    for f in FAIL: print('  - ' + f)
    sys.exit(1)
print('\n✅ 阶段3 第2批完成')
