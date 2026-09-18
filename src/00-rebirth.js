/**
 * src/00-rebirth.js —— 转生与境界系统（重构版 v6）
 *
 * ── 职责 ──────────────────────────────────────────────────────────
 * 把「关卡 / 装备 / 灵石」串成完整的转生循环。
 * 数值权威：设计文档《重构设计文档.md》§3.4、§4、§5。
 *
 * ── 核心循环 ──────────────────────────────────────────────────────
 *   推图（打怪 → 推关 → 掉灵石）
 *     ↓  杀死怪的时间 < 被打死的时间 → 过关
 *   卡住（被怪打死）
 *     ↓
 *   转生：转生点 r = (最高关/10)^1.5
 *     ↓
 *   突破境界：基础属性 ×q  ← 永久保留的地基
 *     ↓
 *   装备与灵石清零，在更高地基上重爬
 *
 * ── ⚠️ 约束 1（设计文档 §4）──────────────────────────────────────
 *   境界成本指数 qc 必须 < 转生点收益指数 1.5
 *   否则境界数被关卡数【线性】锁死 → 推图到某处永远涨不了境 → 死循环
 *   推荐 qc = 1.0（境界呈指数 1.5 的超线性增长）
 *
 * ── ⚠️ 约束 2（设计文档 §4）──────────────────────────────────────
 *   攻速/倍速必须进「推关速率」，不能进「单轮耗时」
 *   否则：P = g^S 时单轮耗时 T = 1/(g-1) = 常数，与面板无关
 *   → 攻速完全无效，挂机失去意义（建模中已实测复现）
 */

import * as N from './00-num.js';
import * as S from './00-stage.js';
import * as E from './00-equip.js';

/* ─────────────────────────────────────────────────────────────
 *  参数（唯一权威）
 * ───────────────────────────────────────────────────────────── */
export const REBIRTH_CFG = {
  /* 转生点：r = (最高关 / DIV)^EXP   ← 需求方给定 */
  PTS_DIV: 10,
  PTS_EXP: 1.5,

  /* 境界成本：突破到第 R 境需累计 (COST_BASE × K) × R^QC 点 */
  K_COST: 5,
  QC: 1.0,              // ⚠️ 必须 < 1.5（约束1）

  /* 每突破 1 境，基础属性 ×Q_REALM */
  Q_REALM: 2.2,

  /* 玩家初始基础面板（第 1 境，装备为 0 时） */
  BASE0: 10,

  /* 转生后保留：技能 / 配方 / 宠物（设计文档 §1 第 18 条）
   * 清零：境界（不，境界保留）/ 装备 / 灵石 / 关数 */
};

/* ─────────────────────────────────────────────────────────────
 *  转生点
 * ───────────────────────────────────────────────────────────── */

/**
 * 由最高关数计算本次转生获得的转生点
 *   r = (最高关 / 10)^1.5
 *
 * @param {number} maxStage 本次轮回推到的最高关
 * @returns {object} 大数
 */
export function rebirthPoints(maxStage) {
  const s = Math.max(1, Math.floor(maxStage));
  const base = N.divNum(N.from(s), REBIRTH_CFG.PTS_DIV);
  return N.pow(base, REBIRTH_CFG.PTS_EXP);
}

/* ─────────────────────────────────────────────────────────────
 *  境界成本与突破
 * ───────────────────────────────────────────────────────────── */

/**
 * 从第 R 境突破到第 R+1 境所需的【单次】点数
 *   cost(R) = (COST_BASE × K) × (R+1)^QC
 *
 * @param {number} R 当前境界（0 起）
 * @returns {object} 大数
 */
export function realmCost(R) {
  const r = Math.max(0, Math.floor(R));
  const base = REBIRTH_CFG.PTS_DIV * REBIRTH_CFG.K_COST;   // 10 × 5 = 50
  return N.mulNum(N.pow(N.from(r + 1), REBIRTH_CFG.QC), base);
}

/**
 * 消耗累计点数能突破到第几境（从 0 起算）
 *
 * 用二分搜索而非累加循环 —— 境界数可达数百，逐级累加在 UI 中可接受，
 * 但二分更稳健（不会因为大数比较变慢）。
 *
 * @param {object} totalPoints 累计转生点（大数）
 * @returns {number} 可达到的境界序号
 */
export function realmsFrom(totalPoints) {
  if (N.isZero(totalPoints)) return 0;
  /* 上界估算：cost(R) = 50·R^1.0，则累计 ≈ 25·R^2
   * → R ≈ sqrt(total / 25)，放宽 4 倍作为搜索上界 */
  const est = Math.sqrt(Math.max(1, N.toNumber(N.mulNum(totalPoints, 1)))) * 4;
  let hi = Math.max(10, Math.min(100000, Math.ceil(est) + 10));
  let lo = 0;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (N.lte(cumulativeCost(mid), totalPoints)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 从 0 境升到 R 境所需的【累计】点数
 *   Σ_{i=1..R} 50 × i^QC
 *
 * 用积分近似 + 修正：Σ i^q ≈ R^(q+1)/(q+1)（对 q=1 是精确的 R(R+1)/2）
 * 本函数对 q=1.0 走精确公式，其它 q 走大数积分近似。
 *
 * @param {number} R 目标境界
 * @returns {object} 大数
 */
export function cumulativeCost(R) {
  const r = Math.max(0, Math.floor(R));
  if (r === 0) return N.ZERO;
  const base = REBIRTH_CFG.PTS_DIV * REBIRTH_CFG.K_COST;
  const q = REBIRTH_CFG.QC;

  if (Math.abs(q - 1.0) < 1e-12) {
    /* Σ 50·i = 50 · R(R+1)/2 —— 精确 */
    return N.mulNum(N.from(r * (r + 1) / 2), base);
  }
  /* 一般情况：Σ i^q ≈ R^(q+1)/(q+1) + R^q/2（欧拉-麦克劳林一阶修正） */
  const a = N.divNum(N.pow(N.from(r), q + 1), q + 1);
  const b = N.divNum(N.pow(N.from(r), q), 2);
  return N.mulNum(N.add(a, b), base);
}

/* ─────────────────────────────────────────────────────────────
 *  玩家基础属性（境界决定，永久）
 * ───────────────────────────────────────────────────────────── */

/**
 * 第 R 境的基础面板
 *   base(R) = BASE0 × q^R
 *
 * @param {number} R 境界
 * @returns {object} 大数
 */
export function baseStat(R) {
  const r = Math.max(0, Math.floor(R));
  return N.mulNum(N.pow(N.from(REBIRTH_CFG.Q_REALM), r), REBIRTH_CFG.BASE0);
}

/* ─────────────────────────────────────────────────────────────
 *  推关速率（双乘区 —— 约束 2 的落地）
 * ───────────────────────────────────────────────────────────── */

export const RATE_CFG = {
  V_BASE: 1.0,        // 基准推关速率（关/秒）@ 倍速=1, 攻速=1
  SPD_CAP: 3.5,       // 游戏倍速上限（宠物提供，转生保留）
  /* 攻速上限 = 装备满级加成 = 1 + 0.0003 × 33000 = 10.9
   * 由装备系统实际上限决定，勿硬编码 3.0 */
  ASPD_CAP: 1 + E.EQ_CFG.C * E.EQ_CFG.MAX_LV,
};

/**
 * 推关速率：v = k × 游戏倍速 × 攻速
 *
 * ⚠️ 两条路线是【独立乘区】，相乘叠加（设计文档 §7）
 *    游戏倍速 = 永久资产（宠物保留）→ 长期底速
 *    攻速     = 每轮资产（装备清零）→ 每轮爬升动力
 *
 * ⚠️ 攻速封顶：
 *   游戏倍速封顶 SPD_CAP = 3.5（需求方设定）
 *   攻速封顶为「装备满级加成」= 1 + C × MAX_LV = 10.9
 *   （这是装备系统的硬上限，不是「3.0」——3.0 是旧设计要求，
 *     现按「4 装备格子 + 33000 级」的实际数学上限执行）
 *
 * @param {number} gameSpeed 游戏倍速 [1, 3.5]
 * @param {number} aspdMult 装备攻速倍率 [1, 10.9]
 * @returns {number} 推关速率（原生 Number）
 */
export function pushRate(gameSpeed, aspdMult) {
  const gs = clamp(gameSpeed, 1, RATE_CFG.SPD_CAP);
  const as = clamp(aspdMult, 1, RATE_CFG.ASPD_CAP);
  return RATE_CFG.V_BASE * gs * as;
}

function clamp(v, lo, hi) {
  v = +v || 0;
  return v < lo ? lo : (v > hi ? hi : v);
}

/* ─────────────────────────────────────────────────────────────
 *  玩家面板（完整）
 * ───────────────────────────────────────────────────────────── */

/**
 * 玩家完整面板
 *   P = 基础(境界) × (1 + EQ_C × L)
 *
 * @param {number} realm 境界
 * @param {object} equip 装备等级表
 * @returns {{atk:object, hp:object, def:object, aspd:number, power:object}}
 *          atk/hp/def 为大数；aspd 是倍率（原生）；power 是综合战力（大数）
 */
export function playerStats(realm, equip) {
  const base = baseStat(realm);
  const eb = E.equipBonus(equip);
  return {
    atk: N.mulNum(base, eb.atk),
    hp: N.mulNum(base, eb.hp),
    def: N.mulNum(base, eb.def),
    aspd: eb.aspd,
    /* 综合战力：攻×攻速（决定推关能力，对齐设计文档「面板」定义） */
    power: N.mulNum(base, eb.atk * eb.aspd),
  };
}

/* ─────────────────────────────────────────────────────────────
 *  一次完整轮回
 * ───────────────────────────────────────────────────────────── */

/**
 * 模拟一轮：从 startStage 开始推，直到被卡住。
 *
 * 卡关判据（需求方设定 #5）：推不动就让怪打死。
 * 数学形式：玩家面板 P < 第 s 关怪血量 H(s) → 打不过。
 *
 * @param {object} state {realm, equip, spirit, stage}
 * @returns {{reached:number, diedAt:number, spiritEarned:object, equip:object}}
 */
export function runOneLife(state) {
  const P = playerStats(state.realm, state.equip).power;
  let s = Math.max(1, Math.floor(state.stage || 1));
  const maxS = Math.floor(S.maxStageFor(P));
  const reachedRaw = Math.min(maxS, S.STAGE_CFG.S_MAX);

  /* 灵石产出：与关卡挂钩。简化为「每关基础产出 × 关卡量级」 */
  const spirit = spiritIncome(s, reachedRaw, P);

  return {
    reached: reachedRaw,
    diedAt: reachedRaw + 1,
    spiritEarned: spirit,
    equip: state.equip,
  };
}

/**
 * 灵石产出估算：推过的每一关都掉灵石。
 * 简化为「推到第 S 关时，累计灵石 ≈ S × 基准 × 关卡均值」。
 * 具体数值待实现时按战斗节奏标定，此处给出量级正确的关系式。
 */
function spiritIncome(from, to, P) {
  if (to <= from) return N.ZERO;
  const count = to - from + 1;
  /* 灵石按关卡线性产出（每关掉落的量随关卡缓慢增长） */
  const avg = N.div(N.add(S.stageHp(from), S.stageHp(to)), N.from(2));
  return N.mulNum(avg, count * 0.01);
}

/* ─────────────────────────────────────────────────────────────
 *  转生执行
 * ───────────────────────────────────────────────────────────── */

/**
 * 执行转生：把「最高关」兑换成转生点，尝试突破境界。
 *
 * ⚠️ 转生后清零：装备、灵石、关数
 * ✅ 转生后保留：境界（地基）、技能、配方、宠物
 *
 * @param {object} state {realm, equip, spirit, stage, maxStage, totalPoints, rebirths}
 * @returns {{state:object, gainedPoints:object, newRealms:number, realmGain:number}}
 */
export function doRebirth(state) {
  const maxStage = Math.max(state.maxStage || 0, state.stage || 1);
  const gained = rebirthPoints(maxStage);
  const total = N.add(state.totalPoints || N.ZERO, gained);
  const newRealm = realmsFrom(total);
  const realmGain = Math.max(0, newRealm - state.realm);

  return {
    state: {
      ...state,
      realm: newRealm,
      equip: E.newEquip(),        // 装备清零
      spirit: N.ZERO,             // 灵石清零
      stage: 1,                   // 关数归 1
      maxStage: 0,
      totalPoints: total,
      rebirths: (state.rebirths || 0) + 1,
    },
    gainedPoints: gained,
    newRealms: newRealm,
    realmGain,
  };
}

/* ─────────────────────────────────────────────────────────────
 *  初始状态
 * ───────────────────────────────────────────────────────────── */

export function newState() {
  return {
    realm: 0,
    equip: E.newEquip(),
    spirit: N.ZERO,
    stage: 1,
    maxStage: 0,
    totalPoints: N.ZERO,
    rebirths: 0,
    /* 保留系统（转生不清零，待实现） */
    skills: {},
    recipes: {},
    pets: {},
  };
}
