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
import * as RM from './00-realm.js';

/* ─────────────────────────────────────────────────────────────
 *  参数（唯一权威）
 * ───────────────────────────────────────────────────────────── */
export const REBIRTH_CFG = {
  /* 转生点：r = (最高关 / DIV)^EXP   ← 需求方给定 */
  PTS_DIV: 10,
  PTS_EXP: 1.5,

  /* 每突破 1 境，基础属性 ×Q_REALM。
   *
   * ⚠️ 28.3 是【反解出来的】，不是拍的：
   *   怪 H(s) = H0·g^(s-1)，第 30000 关怪强度 ≈ 1e78；
   *   玩家面板 = BASE0 × Q^R，54 层要够到 1e78 就得
   *       Q^53 ≈ 1e77  ⟹  Q ≈ 28.3
   *   低于这个值 → 关卡早就推满 30000，境界却还差几十层，
   *                后期玩家会在关卡顶上空转。
   *   高于这个值 → 关卡还没推完就天仙了。
   *
   *   改这个值必须同步改 00-realm.js 的 Q_REALM_REF，
   *   并重跑 tests/test_realm.mjs（有断言检查两者一致）。 */
  Q_REALM: 27.0464,   // v7.1 精确标定值（旧值 28.3 为粗估）

  /* 玩家初始基础面板（凡人，装备为 0 时） */
  BASE0: 10,

  /* 转生后保留：境界、技能、配方、宠物（设计文档 §1 第 18 条）
   * 清零：装备 / 灵石 / 关数 */
};

/* ─────────────────────────────────────────────────────────────
 *  转生点
 * ───────────────────────────────────────────────────────────── */

/**
 * 由最高关数计算本次转生获得的转生点（= 修为）
 *   r = (最高关 / 10)^1.5
 *
 * ⚠️ 每轮只结算一次，取本轮推到的最深关卡。
 *    推 350 关给 207，推 351 关给 208 —— 推得越远给得越多，
 *    所以「再推几关看看」是有收益的，但推到最后必然推不动，
 *    那就转生。
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
 *  境界成本与突破（已移交 00-realm.js）
 * ───────────────────────────────────────────────────────────── */

/**
 * 从第 R-1 层突破到第 R 层的单层修为需求。
 * @deprecated 直接调 RM.levelCost(R)；保留此转发仅为兼容旧调用点。
 */
export function realmCost(R) {
  const r = Math.max(0, Math.floor(R));
  if (r <= 0) return RM.levelCost(1);
  return RM.levelCost(r + 1);
}

/**
 * 消耗累计修为能突破到第几层（0 = 凡人）。
 * @deprecated 直接用 RM.levelFrom(total)。
 */
export function realmsFrom(totalPoints) {
  return RM.levelFrom(totalPoints);
}

/**
 * 从 0 层升到 R 层所需的累计修为。
 * @deprecated 直接用 RM.cumCultivation(R)。
 */
export function cumulativeCost(R) {
  return RM.cumCultivation(R);
}

/* ─────────────────────────────────────────────────────────────
 *  玩家基础属性（境界决定，永久）
 * ───────────────────────────────────────────────────────────── */

/**
 * 第 R 层的基础面板
 *   base(R) = BASE0 × Q_REALM^R
 *
 * @param {number} R 层数（0 = 凡人）
 * @returns {object} 大数
 */
export function baseStat(R) {
  const r = Math.max(0, Math.floor(R));
  return N.mulNum(N.pow(N.from(REBIRTH_CFG.Q_REALM), r), REBIRTH_CFG.BASE0);
}

/* ─────────────────────────────────────────────────────────────
 *  v7.1 §7：起始关机制
 * ───────────────────────────────────────────────────────────── */

export const START_CFG = {
  /**
   * 起始关 = 历史最高关 − 1500（【固定值】，不是一半）。
   *
   * 需求方原话：「不是一半，固定减 1500 关，因为后面可能到 3 万关。」
   * 理由很实在：一半在 3 万关时意味着每轮要从 15000 关起步，
   * 单轮推进量被线性放大到不可控；固定 1500 让【每轮时长】基本恒定，
   * 这正是 Λ=114（每境恒定轮数）能成立的前提。
   */
  OFFSET: 1500,

  /**
   * 启用线：历史最高关 > 3000 才生效。
   *
   * 前期不启用是为了保住新手体验：3000 关以前每轮本来就只有 1~2 分钟，
   * 跳过前期等于掐掉了「学会看装备/灵石循环」的那一段。
   * 3000 这个数与 Buff 宠物【跳关】的第一档门槛相同（见 00-pet.js），
   * 两条机制在同一节点同时进场，中期的手感变化是「一次性跳变」。
   */
  MIN_BEST: 3000,
};

/**
 * 计算下一轮的起始关。
 *
 * @param {number} bestStage 历史最高关（不含本轮；调用方负责把本轮并入）
 * @returns {number} 起始关（≥1，且 ≤ 历史最高关）
 */
export function startStageFor(bestStage) {
  const best = Math.max(0, Math.floor(+bestStage || 0));
  if (best <= START_CFG.MIN_BEST) return 1;
  const s = best - START_CFG.OFFSET;
  /* 双重夹取：下限 1（永远合法），上限 best（不许超过自己的历史记录，
   * 否则可凭空获得「本轮最高关」，进而套出超额的转生点）。 */
  return Math.max(1, Math.min(best, s));
}

/* ─────────────────────────────────────────────────────────────
 *  推关速率（双乘区 —— 约束 2 的落地）
 * ───────────────────────────────────────────────────────────── */

export const RATE_CFG = {
  /* v7.1 基准推关速率：35 关/分钟（需求方口径「推到 350 关正好 10 分钟」）。
   * 本模块内部一律用【关/秒】，所以这里存换算值 35/60。
   * 注意与旧值 V_BASE=1.0（=60 关/分钟）的区别 —— v7.1 是 35 关/分钟。 */
  V_BASE: 35 / 60,
  SPD_CAP: 3.5,       // 游戏倍速上限（宠物提供，转生保留）

  /* v7.1 §4.3：攻速上限 = 3.0（装备第 4 格）。
   *
   * ⚠️ 与装备口径联动：v7.1 的装备是线性 (1+C·L)，满级 10.9 倍，
   *    攻速作为其中一格，谷歌口径上限取 3.0（不再取 1.0003^33000 ≈ 1.99e4）。
   *    保留大数接口是为了不与 v_base / 倍速的连乘处改动撕裂最小。 */
  ASPD_CAP: N.from(3.0),

  /* v7.1 §4.3：第三乘区 —— 宠物跳关档位 0/1/2/4/8/10/20。
   * 实际可跳档由 00-stage.js 的 SKIP_GATED(skipTier, bestStage) 按历史最高关
   * 门控解锁；这里只负责「有档位时怎么乘」。 */
  SKIP_TIERS: [0, 1, 2, 4, 8, 10, 20],
};

/**
 * 宠物跳关：把【跳关档位】转成数值（越界收敛到合法档位）。
 *
 * @param {number} tier 期望档位
 * @returns {number} 合法跳关值（0 / 1 / 2 / 4 / 8 / 10 / 20）
 */
export function normSkip(tier) {
  const t = Math.floor(+tier || 0);
  const tiers = RATE_CFG.SKIP_TIERS;
  let best = 0;
  for (const c of tiers) if (t >= c) best = c;
  return best;
}

/**
 * 推关速率：v7.1 三乘区
 *
 *     v = 35 关/分钟 × 游戏倍速 × 攻速 × (1 + 跳关)
 *
 * ⚠️ 三条路线是【独立乘区】，相乘叠加（设计文档 §六 约束 4）
 *    游戏倍速 = 永久资产（宠物保留）→ 长期底速
 *    攻速     = 每轮资产（装备清零）→ 每轮爬升动力
 *    宠物跳关 = 永久资产（宠物保留）→ v7 新增第三乘区
 *
 * ⚠️ 返回值是【大数】。三个乘区连乘后仍可能超出 Number 安全表示，
 *   统一走大数避免后续改参数时无声溢出。
 *
 * @param {number} gameSpeed 游戏倍速 [1, 3.5]
 * @param {object} aspdMult 装备攻速倍率（大数，[1, 3.0]）
 * @param {number} [skip] 宠物跳关档位（0/1/2/4/8/10/20，缺省 0）
 * @returns {object} 推关速率（大数，关/秒）
 */
export function pushRate(gameSpeed, aspdMult, skip) {
  const gs = clamp(gameSpeed, 1, RATE_CFG.SPD_CAP);
  const as = clampBig(aspdMult);
  const sk = normSkip(skip);
  return N.mulNum(N.mulNum(N.mulNum(as, RATE_CFG.V_BASE), gs), 1 + sk);
}

function clamp(v, lo, hi) {
  v = +v || 0;
  return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * 大数版 clamp(a, 1, ASPD_CAP)。
 *
 * 攻速倍率的来源是装备（已是大数），下限 1、上限 ASPD_CAP 都是常量，
 * 越界时直接返回常量而不是原值 —— 返回常量才是【真的封顶】，
 * 原样返回会让越界值（比如外部写脏的状态）继续放大速率。
 *
 * @param {object} a 大数
 * @returns {object} 大数
 */
function clampBig(a) {
  if (N.isZero(a) || N.isNeg(a)) return N.ONE;
  if (N.lt(a, N.ONE)) return N.ONE;
  if (N.gt(a, RATE_CFG.ASPD_CAP)) return RATE_CFG.ASPD_CAP;
  return a;
}

/* ─────────────────────────────────────────────────────────────
 *  玩家面板（完整）
 * ───────────────────────────────────────────────────────────── */

/**
 * 玩家完整面板
 *   P = 基础(境界) × (1 + EQ_C)^L
 *
 * ⚠️ 装备加成自 v6 起为指数 (1+C)^L，量级可达 1.99e4 倍，
 *   因此 4 格加成与综合战力全部走大数乘法（N.mul），
 *   不能再用 N.mulNum(base, eb.atk) —— 那样要求乘数是原生 Number。
 *
 * @param {number} realm 境界
 * @param {object} equip 装备等级表
 * @returns {{atk:object, hp:object, def:object, aspd:object, power:object}}
 *          atk/hp/def/power 为大数；aspd 是倍率（大数）
 */
export function playerStats(realm, equip) {
  const base = baseStat(realm);
  const eb = E.equipBonus(equip);
  return {
    atk: N.mul(base, eb.atk),
    hp: N.mul(base, eb.hp),
    def: N.mul(base, eb.def),
    aspd: eb.aspd,
    /* 综合战力：攻×攻速（决定推关能力，对齐设计文档「面板」定义） */
    power: N.mul(base, N.mul(eb.atk, eb.aspd)),
  };
}

/* ─────────────────────────────────────────────────────────────
 *  一次完整轮回
 * ───────────────────────────────────────────────────────────── */

/**
 * 模拟一轮：从 startStage 开始推，边推边用灵石升装备，直到被卡住。
 *
 * ── 一轮的完整生命周期（需求方口述）───────────────────────────
 *   转生后：装备清零，境界保留 → 面板只有 baseStat(realm)
 *   推图：打怪掉灵石 → 升装备 → 面板变强 → 推得更远
 *   直到：灵石也不够升装备了，推不动了 → 玩家点转生
 *
 * ── 关键简化：单轮装备能点到多少级 ─────────────────────────────
 * 灵石产出随关卡指数增长（怪血量 ≈ 1.006^s），所以装备等级
 * 在一轮内会被"推得很满"——实测单轮跨度 ≈ log(EQ_MULT)/log(G)，
 * 几乎与境界无关。这里直接按【装备满级】估算本轮终点，
 * 与 00-realm.js 的 ROUND_SPAN 注释保持同一口径。
 *
 * ⚠️ 这是【上界估算】（假设装备能点满）。真实值受灵石掉落曲线
 *    影响会略低，上线后需按实测回调 00-realm.js 的 ROUNDS_BASE。
 *
 * @param {object} state {realm, equip, spirit, stage}
 * @returns {{reached:number, diedAt:number, spiritEarned:object, equip:object}}
 */
export function runOneLife(state) {
  const base = baseStat(state.realm);
  const eb = E.equipBonus(state.equip);

  /* 本轮能点到满装备 → 面板上界
   * ⚠️ 两个大数相乘必须用 N.mul（mulNum 只接受「大数 × 原生数」） */
  const fullEquip = E.EQUIP_MAX_BONUS;
  const Pfull = N.mulNum(N.mul(base, N.mul(eb.atk, eb.aspd)), fullEquip);

  const sStart = Math.max(1, Math.floor(state.stage || 1));
  const maxS = Math.floor(S.maxStageFor(Pfull));
  const reachedRaw = Math.min(maxS, S.STAGE_CFG.S_MAX);

  const spirit = spiritIncome(sStart, reachedRaw, Pfull);

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
 * ⚠️ 转生后清零：装备、灵石、本轮最高关
 * ⚠️ 关数【不归 1】：v7.1 起始关机制 —— 历史最高关 > 3000 时，
 *    新一轮从「最高关 − 1500」出发（见 START_CFG）。
 * ✅ 转生后保留：境界（地基）、累计修为、技能、配方、宠物（倍速/跳关）
 *
 * @param {object} state {realm, equip, spirit, stage, maxStage, bestStage, totalPoints, rebirths}
 * @returns {{state:object, gainedPoints:object, newRealms:number, realmGain:number, startStage:number}}
 */
export function doRebirth(state) {
  const maxStage = Math.max(state.maxStage || 0, state.stage || 1);
  const gained = rebirthPoints(maxStage);
  const total = N.add(state.totalPoints || N.ZERO, gained);
  const newRealm = realmsFrom(total);
  const realmGain = Math.max(0, newRealm - state.realm);
  /* 历史最高关：本轮成绩并入后再算起始关，否则本轮白推的那 1500 关不算数 */
  const bestStage = Math.max(state.bestStage || 0, maxStage);
  const startStage = startStageFor(bestStage);

  return {
    state: {
      ...state,
      realm: newRealm,
      equip: E.newEquip(),        // 装备清零
      spirit: N.ZERO,             // 灵石清零
      stage: startStage,          // v7.1：从起始关出发（早期仍是 1）
      maxStage: 0,
      bestStage,                  // 历史最高关（永久）
      totalPoints: total,
      rebirths: (state.rebirths || 0) + 1,
    },
    gainedPoints: gained,
    newRealms: newRealm,
    realmGain,
    startStage,
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
    /* 保留系统（转生不清零） */
    recipes: {},
    pets: {},
  };
}
