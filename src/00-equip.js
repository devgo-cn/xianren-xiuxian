/**
 * src/00-equip.js —— 装备与灵石系统（重构版 v6）
 *
 * ── 职责 ──────────────────────────────────────────────────────────
 * 4 装备格子（攻击/血量/防御/攻速），最高 33000 级，灵石升级。
 * 数值权威：设计文档《重构设计文档.md》§3.2、§5。
 *
 * ── 核心公式 ──────────────────────────────────────────────────────
 *   玩家面板 P = 基础(境界) × (1 + EQ_C × L)
 *     EQ_C = 0.0003   每级 +0.03%
 *     L    ∈ [0, 33000]
 *
 *   满级加成 = 1 + 0.0003 × 33000 = 10.9 倍
 *
 * ── 关键设计 ──────────────────────────────────────────────────────
 * · 装备是「加成」，转生清零（与「境界=基础」形成对照）
 * · 升级步长 1/10/100/1000/10000 —— 玩家用步长档位少点几次
 * · 灵石消耗随等级指数增长（否则 33000 级太快点满）
 */

import * as N from './00-num.js';

/* ─────────────────────────────────────────────────────────────
 *  参数
 * ───────────────────────────────────────────────────────────── */
export const EQ_CFG = {
  MAX_LV: 33000,              // 最高等级
  C: 0.0003,                  // 每级加成系数（+0.03%/级）
  STEPS: [1, 10, 100, 1000, 10000],   // 升级步长档位

  /* 灵石消耗：cost(L) = BASE × GROWTH^L
   * 指数增长，让后期升级需要海量灵石，避免 33000 级被瞬间点满。 */
  COST_BASE: 10,
  COST_GROWTH: 1.05,
};

/** 4 个装备格子的定义（顺序即 UI 上 4 个按钮的顺序） */
export const SLOTS = [
  { key: 'atk',  name: '攻击', icon: '⚔' },
  { key: 'hp',   name: '血量', icon: '❤' },
  { key: 'def',  name: '防御', icon: '🛡' },
  { key: 'aspd', name: '攻速', icon: '⚡' },
];

export const SLOT_KEYS = SLOTS.map(s => s.key);

/* ─────────────────────────────────────────────────────────────
 *  装备状态
 * ───────────────────────────────────────────────────────────── */

/** 新建空装备（转生后的初始状态） */
export function newEquip() {
  const e = {};
  for (const k of SLOT_KEYS) e[k] = 0;
  return e;
}

/** 归一化：保证等级在 [0, MAX_LV] 且为整数 */
export function normEquip(eq) {
  const out = {};
  for (const k of SLOT_KEYS) {
    let v = (eq && eq[k]) | 0;
    if (v < 0) v = 0;
    if (v > EQ_CFG.MAX_LV) v = EQ_CFG.MAX_LV;
    out[k] = v;
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────
 *  加成计算
 * ───────────────────────────────────────────────────────────── */

/**
 * 单格加成倍率：1 + C × L
 * @returns {number} 原生 Number（最大 10.9，安全）
 */
export function slotMult(lv) {
  let L = lv | 0;
  if (L < 0) L = 0;
  if (L > EQ_CFG.MAX_LV) L = EQ_CFG.MAX_LV;
  return 1 + EQ_CFG.C * L;
}

/**
 * 四格加成倍率表
 * @returns {{atk:number, hp:number, def:number, aspd:number}}
 */
export function equipBonus(eq) {
  const e = normEquip(eq);
  return {
    atk: slotMult(e.atk),
    hp: slotMult(e.hp),
    def: slotMult(e.def),
    aspd: slotMult(e.aspd),
  };
}

/* ─────────────────────────────────────────────────────────────
 *  灵石消耗
 * ───────────────────────────────────────────────────────────── */

/**
 * 灵石消耗闭式因子：(g^n - 1) / (g - 1)
 *
 * ⚠️ 必须走大数：n 可达 33000，Math.pow(1.05, 33000) ≈ 1e689，
 * 远超 JS Number 上限 1.8e308 → 直接算会得到 Infinity。
 * 因此用大数的 pow 分解：g^n = 10^(n·log10(g))，再算等比和。
 *
 * @param {number} n 级数
 * @returns {object} 大数
 */
function sumFactor(n) {
  const g = EQ_CFG.COST_GROWTH;
  if (n <= 0) return N.ZERO;
  const gn = N.pow(N.from(g), n);           // 大数 g^n
  return N.divNum(N.sub(gn, N.ONE), g - 1);
}

/**
 * 从当前等级升 1 级的灵石消耗
 * @param {number} curLv 当前等级
 * @returns {object} 大数
 */
export function levelCost(curLv) {
  const L = Math.max(0, Math.min(EQ_CFG.MAX_LV - 1, curLv | 0));
  return N.mulNum(
    N.pow(N.from(EQ_CFG.COST_GROWTH), L),
    EQ_CFG.COST_BASE
  );
}

/**
 * 从 curLv 升 steps 级的总消耗（等比级数求和）
 *
 *   cost = BASE × GROWTH^curLv × (GROWTH^steps - 1) / (GROWTH - 1)
 *
 * 用闭式公式而非循环 —— 步长可达 10000，循环会卡死 UI。
 * 全程走大数，避免 GROWTH^33000 溢出。
 *
 * @param {number} curLv 当前等级
 * @param {number} steps 步长
 * @returns {object} 大数
 */
export function upgradeCost(curLv, steps) {
  const L = Math.max(0, Math.min(EQ_CFG.MAX_LV, curLv | 0));
  const n = Math.max(0, Math.min(EQ_CFG.MAX_LV - L, steps | 0));
  if (n === 0) return N.ZERO;
  const first = N.mulNum(N.pow(N.from(EQ_CFG.COST_GROWTH), L), EQ_CFG.COST_BASE);
  return N.mul(first, sumFactor(n));
}

/**
 * 在给定灵石预算下，最多能升多少级（从 curLv 起）
 * 用对数反解，避免逐级试探。
 *
 * @param {number} curLv
 * @param {object} budget 可用灵石（大数）
 * @returns {number} 可升级数（不超过 MAX_LV - curLv）
 */
export function maxAffordableLevels(curLv, budget) {
  const L = Math.max(0, Math.min(EQ_CFG.MAX_LV, curLv | 0));
  const room = EQ_CFG.MAX_LV - L;
  if (room <= 0 || N.isZero(budget)) return 0;

  const g = EQ_CFG.COST_GROWTH;
  const first = N.mulNum(N.pow(N.from(g), L), EQ_CFG.COST_BASE);
  /* budget ≥ first × (g^n - 1)/(g-1)
   * → g^n ≤ budget·(g-1)/first + 1
   * → n ≤ log_g( budget·(g-1)/first + 1 ) */
  const ratio = N.mulNum(N.div(budget, first), g - 1);
  const inner = N.add(ratio, N.ONE);
  if (N.lte(inner, N.ONE)) return 0;
  const n = N.log10(inner) / Math.log10(g);
  let cnt = Math.floor(n);
  if (cnt < 0) cnt = 0;
  if (cnt > room) cnt = room;

  /* 浮点误差兜底：多退少补 */
  while (cnt > 0 && N.gt(upgradeCost(L, cnt), budget)) cnt--;
  while (cnt < room && N.lte(upgradeCost(L, cnt + 1), budget)) cnt++;
  return cnt;
}

/**
 * 尝试升级某格：返回新状态
 *
 * @param {object} eq 当前装备
 * @param {object} spirit 当前灵石（大数）
 * @param {string} key 格子 key
 * @param {number} steps 步长（必须是 STEPS 中的值，或任意正整数）
 * @returns {{ok:boolean, equip:object, spirit:object, gained:number, cost:object, reason:string}}
 */
export function tryUpgrade(eq, spirit, key, steps) {
  const e = normEquip(eq);
  if (SLOT_KEYS.indexOf(key) < 0) {
    return { ok: false, equip: e, spirit, gained: 0, cost: N.ZERO, reason: 'invalid_slot' };
  }
  const cur = e[key];
  if (cur >= EQ_CFG.MAX_LV) {
    return { ok: false, equip: e, spirit, gained: 0, cost: N.ZERO, reason: 'max_level' };
  }

  const n = Math.max(1, Math.min(EQ_CFG.MAX_LV - cur, steps | 0));
  const cost = upgradeCost(cur, n);
  if (N.lt(spirit, cost)) {
    /* 灵石不足：降到买得起的级数 */
    const afford = maxAffordableLevels(cur, spirit);
    if (afford <= 0) {
      return { ok: false, equip: e, spirit, gained: 0, cost, reason: 'not_enough' };
    }
    const c2 = upgradeCost(cur, afford);
    const next = { ...e };
    next[key] = cur + afford;
    return { ok: true, equip: next, spirit: N.sub(spirit, c2), gained: afford, cost: c2, reason: 'partial' };
  }

  const next = { ...e };
  next[key] = cur + n;
  return { ok: true, equip: next, spirit: N.sub(spirit, cost), gained: n, cost, reason: 'ok' };
}

/* ─────────────────────────────────────────────────────────────
 *  调试/展示辅助
 * ───────────────────────────────────────────────────────────── */

/** 描述当前装备状态（UI 用） */
export function describe(eq) {
  const e = normEquip(eq);
  return SLOTS.map(s => ({
    key: s.key,
    name: s.name,
    icon: s.icon,
    lv: e[s.key],
    mult: slotMult(e[s.key]),
    maxed: e[s.key] >= EQ_CFG.MAX_LV,
  }));
}
