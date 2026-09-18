#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段3: 删除法宝系统 + 把战斗三围改由 v6 驱动。

关键点: pushBattleStats 原本读 state.arts(法宝) 算面板; 法宝删掉后
改读 v6 的 live() 面板 —— 否则战斗会失去属性来源。
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
    for c in ['  %s,\n' % name]:
        if c in t: return t.replace(c, '', 1)
    FAIL.append('导出: ' + name); return t

def cut_span(t, a, b, l):
    i = t.find(a)
    if i < 0: FAIL.append('cut start: ' + l); return t
    j = t.find(b, i + len(a))
    if j < 0: FAIL.append('cut end: ' + l); return t
    return t[:i] + t[j + len(b):]

def del_import_name(t, name):
    """从 import { ... } 列表里删掉一个名字。"""
    out, n = [], 0
    for line in t.split('\n'):
        if line.startswith('import {') and re.search(r'(?<![\w$])%s(?![\w$])' % re.escape(name), line):
            line = re.sub(r',\s*(?<![\w$])%s(?![\w$])\s*,' % re.escape(name), ',', line, count=1)
            if re.search(r'(?<![\w$])%s(?![\w$])' % re.escape(name), line):
                line = re.sub(r'(?<![\w$])%s(?![\w$])\s*,\s*' % re.escape(name), '', line, count=1)
            n += 1
        out.append(line)
    if n == 0: FAIL.append('import 名: ' + name)
    return '\n'.join(out)

# ═══════════════════════════════════════════════════════════════════
# 1) src/10-base.js —— 法宝函数全删 + pushBattleStats 改走 v6
# ═══════════════════════════════════════════════════════════════════
p = 'src/10-base.js'; s = rd(p); orig = len(s)

for sig, l in [
    ('function artCtx()', 'artCtx'),
    ('function equipBonus()', 'equipBonus(旧法宝版)'),
    ('function ensureScrollFx()', 'ensureScrollFx'),
    ('function closeEquip()', 'closeEquip'),
    ('function licBuild(cross, arr)', 'licBuild'),
    ('function artName(kind, q, lv)', 'artName'),
    ('function rollFx(kind, q)', 'rollFx'),
    ('function rollMonFx(big)', 'rollMonFx'),
    ('function fmtFxTag(f)', 'fmtFxTag'),
    ('function attrAssign(art, kind, q, pow)', 'attrAssign'),
]:
    s = del_func(s, sig, l)

# pushBattleStats: 改由 v6 live() 驱动
old_pbs = '''function pushBattleStats() {
  const api = window.BattleAPI;
  if (!api || !api.setStats) return;
  const lv = (state.realmIdx || 0) + 1, eb = equipBonus();
  /* v7.1: 基础三围改手动表 BASE_STATS —— 围绕怪物毛坯(境界间×4质变), 旧线性 10+46*lv 退役 */
  const bi = bigIndexOf(state.realmIdx);   /* v7.2b 纯函数推算, 修复启动期 SEG_META 未填充卡导入 */
  const bs = BASE_STATS[Math.min(BASE_STATS.length - 1, bi)] || BASE_STATS[0];
  const s = finalStats({ hp: bs[1], atk: bs[0], def: bs[2] },
    { hp: eb.hp || 0, atk: eb.atk || 0, def: eb.def || 0 }, eb.agg);
  s.lv = lv;                                  // 怪物成长按境界缩放
  api.setStats(s);
}'''
new_pbs = '''/**
 * 把当前面板推给战斗层。
 *
 * ⚠️ v6 重构后：面板唯一来源是 v6 的 live() ——
 *   基础三围由境界 baseStat 给，装备四槽给乘区，攻速进 aspd。
 *   旧法宝(state.arts)那条路已随法宝系统一并删除。
 *
 * 大数 → 原生 Number：战斗层是 PixiJS 渲染，数值只用于画面与掉血，
 *   不需要 e300 级别的精度。v6 已把上限卡在 54 层/10.86 倍乘区，
 *   toNumber 不会溢出到 Infinity。
 */
function pushBattleStats() {
  const api = window.BattleAPI;
  if (!api || !api.setStats) return;
  if (!window.V6 || !window.V6.state) return;      // v6 未就绪: 不推, 让战斗层用默认值
  try {
    const st = window.V6.state();
    const L = NS5_live(st);
    const s = {
      atk: N6_toNumber(L.atk),
      hp:  N6_toNumber(L.hp),
      def: N6_toNumber(L.def),
      aspd: N6_toNumber(L.aspd),
      lv: (st.realm || 0) + 1,                       // 怪物成长按境界缩放
    };
    if (!isFinite(s.atk) || !isFinite(s.hp) || !isFinite(s.def)) return;
    if (s.hp <= 0) return;
    api.setStats(s);
  } catch (e) { /* v6 异常时静默, 战斗层保留上一帧面板 */ }
}'''
s = sub1(s, old_pbs, new_pbs, 'pushBattleStats 改 v6')

for n in ['artCtx', 'equipBonus', 'ensureScrollFx', 'closeEquip', 'licBuild',
          'artName', 'rollFx', 'rollMonFx', 'fmtFxTag', 'attrAssign',
          'EQUI_SLOTN', 'TOTAL_SEGS']:
    s = del_export(s, n)

# import 清理
for n in ['ARMOR_POOL', 'ART_PREFIX', 'ART_SPECIAL', 'ART_SUFFIX', 'EQUI_SLOTI',
          'FX_POOL', 'FX_TXT', 'MON_FX_POOL', 'PEND_POOL', 'QUALITY',
          'SCROLL_POOL', 'SLOT_TYPES', 'EQ_POW', 'QW_TABLE', 'MON_ATK_SCALE',
          'fxAgg', 'fxCount', 'fxValue', 'eqMult', 'finalStats', 'BASE_STATS',
          'bigIndexOf', 'genMonster']:
    if re.search(r'(?<![\w$])%s(?![\w$])' % re.escape(n), s.split('\n')[7] if len(s.split('\n')) > 7 else ''):
        s = del_import_name(s, n)

# 新增依赖: 05-v6 的 live / 00-num 的 toNumber
s = sub1(s,
    "import { $, ARRAY_COST,",
    "import { live as NS5_live } from './05-v6.js';\nimport { toNumber as N6_toNumber } from './00-num.js';\nimport { $, ARRAY_COST,",
    '10-base 加 v6 import')
wr(p, s)
print('10-base.js  %6d -> %6d  (%+d)' % (orig, len(s), len(s) - orig))

if FAIL:
    print('\n❌ 未命中:')
    for f in FAIL: print('  - ' + f)
    sys.exit(1)
print('\n✅ 阶段3 第1批完成')
