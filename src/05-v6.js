/**
 * src/05-v6.js —— v6 挂机重构：整合层
 *
 * ── 这一层是干什么的 ──────────────────────────────────────────────
 * 00-num / 00-stage / 00-equip / 00-rebirth 是【纯数学层】：无状态、无 DOM、
 * 可被 Node 单测 84 条全覆盖。但游戏要跑起来还需要三样东西：
 *   1. 运行时状态容器（把 big number 存成可序列化的形式）
 *   2. 与旧 state 的桥接（旧代码在读写 state.gold / state.stage 等）
 *   3. DOM 渲染与按钮事件
 *
 * 本文件只做这三件事，【不含任何游戏公式】——公式一律回纯数学层取。
 * 这样如果后续要调平衡，改的是 00-*.js，本文件不用动。
 *
 * ── 存档格式 ──────────────────────────────────────────────────────
 * 大数序列化为数组 [m, e]（比 {m,e} 省一半体积，云存档有字节上限）。
 * 反序列化对任何脏数据都容错（返回 0），避免坏档让游戏永久白屏。
 */

import * as N from './00-num.js';
import * as S from './00-stage.js';
import * as E from './00-equip.js';
import * as R from './00-rebirth.js';
import * as RM from './00-realm.js';
import * as A from './00-anchor.js';
import * as P from './00-pet.js';   // v7.1：Buff 宠物（倍速 + 跳关，永久资产）

/* ─────────────────────────────────────────────────────────────
 *  1. 大数 ↔ 存档
 * ───────────────────────────────────────────────────────────── */

/** 大数 → [m, e] */
function pack(a) {
  if (N.isZero(a)) return 0;
  return [a.m, a.e];
}

/** [m, e] / {m,e} / number / 脏数据 → 大数 */
function unpack(v) {
  if (v === null || v === undefined) return N.ZERO;
  if (typeof v === 'number') return N.from(v);
  if (Array.isArray(v) && v.length === 2 && isFinite(v[0]) && isFinite(v[1])) {
    return N.norm(v[0], v[1]);
  }
  /* ⚠️ 必须兼容已经是 {m,e} 的对象。
   * normV6 是【幂等归一化】，上游可能传来刚 newV6() 出来的活状态
   * （totalPoints 已经是 {m,e}），不是存档里的 [m,e]。
   * 只认数组会让这条路径静默归零 —— 曾导致「转生点显示 0」。 */
  if (typeof v === 'object' && isFinite(v.m) && isFinite(v.e)) {
    return N.norm(v.m, v.e);
  }
  return N.ZERO;
}

/* ─────────────────────────────────────────────────────────────
 *  2. v6 状态
 * ───────────────────────────────────────────────────────────── */

/** v6 状态的存档键（存在旧 state 的 v6 字段下，互不干扰） */
export const V6_KEY = 'v6';

/**
 * 新建 v6 状态
 * @returns {object}
 */
export function newV6() {
  return {
    realm: 0,               // 境界（永久地基）
    totalPoints: N.ZERO,    // 累计修为点（大数）
    equip: E.newEquip(),    // 4 格装备等级（转生清零）
    spirit: N.ZERO,         // 灵石（转生清零）
    stage: 1,               // 当前关
    maxStage: 0,            // 本轮最高关（跨轮保留历史最高用 bestStage）
    bestStage: 0,           // 历史最高关
    rebirths: 0,            // 转生次数

    /* 三乘区（v7.1 设计文档 §4.3 / §7）
     *  gameSpeed: 游戏倍速，来源=Buff 宠物，上限 3.5，转生【保留】
     *  skip:      宠物跳关档位 0/1/2/4/8/10/20，来源=Buff 宠物，转生【保留】
     *  attackSpeed: 装备第 4 格（攻速）加成，上限 3.0，转生【清零】
     *  ⚠️ 三者是独立乘区，不能合并 —— 需求方明确要求几条路线分别抓：
     *     倍速/跳关 = 跨轮永久底速，攻速 = 本轮爬升动力。 */
    gameSpeed: 1,
    skip: 0,                // 宠物跳关档位（见 00-pet.js 的解锁门控表）

    /* 本轮战斗计时 */
    runT: 0,                // 本轮已用秒数（用于展示「推关速率」）
    lastTick: 0,            // 上一次 loop 的时间戳（离线结算用）
    carry: 0,               // 推进累加器：攒够 1 关才 +1（保留小数进度）
  };
}

/** 归一化：把任何来源的 v6 状态修成合法值 */
export function normV6(s) {
  const o = newV6();
  if (!s || typeof s !== 'object') return o;
  o.realm = Math.max(0, Math.floor(+s.realm || 0));
  o.totalPoints = unpack(s.totalPoints);
  o.equip = E.normEquip(s.equip);
  o.spirit = unpack(s.spirit);
  o.stage = Math.max(1, Math.min(S.STAGE_CFG.S_MAX, Math.floor(+s.stage || 1)));
  o.maxStage = Math.max(0, Math.floor(+s.maxStage || 0));
  o.bestStage = Math.max(o.maxStage, Math.floor(+s.bestStage || 0));
  o.rebirths = Math.max(0, Math.floor(+s.rebirths || 0));
  o.gameSpeed = Math.max(1, Math.min(R.RATE_CFG.SPD_CAP, +s.gameSpeed || 1));
  /* 宠物跳关：只对【合法档位】放行（0/1/2/4/8/10/20）。
   * ⚠️ 这里不做「按历史最高关重算」—— 那是 syncPetAssets 的活。
   *    normV6 必须是纯归一化，否则外部显式设的 3.5 倍速（验收脚本用）
   *    会被 bestStage=0 悄悄压回 1，A/B 对照就不可复现了。 */
  o.skip = P.normSkipTier(s.skip);
  o.runT = Math.max(0, +s.runT || 0);
  o.lastTick = Math.max(0, +s.lastTick || 0);
  /* carry ∈ [0, 1)：小数进度，超过 1 说明状态被外部写脏了，归零更安全 */
  let c = +s.carry || 0;
  o.carry = (c > 0 && c < 1) ? c : 0;
  return o;
}

/** v6 状态 → 存档对象 */
export function packV6(s) {
  const o = normV6(s);
  return {
    realm: o.realm,
    tp: pack(o.totalPoints),      // [m,e] 或 0
    eq: [o.equip.atk, o.equip.hp, o.equip.def, o.equip.aspd],
    sp: pack(o.spirit),
    st: o.stage,
    ms: o.maxStage,
    bs: o.bestStage,
    rb: o.rebirths,
    gs: o.gameSpeed,
    sk: o.skip,               // v7.1：宠物跳关档位（永久资产，必须落盘）
    /* carry 保留 3 位小数即可（精度损失不可感知，省存档体积） */
    ca: o.carry ? +o.carry.toFixed(3) : 0,
  };
}

/** 存档对象 → v6 状态 */
export function unpackV6(p) {
  if (!p || typeof p !== 'object') return null;
  return normV6({
    realm: p.realm,
    totalPoints: p.tp,
    equip: { atk: (p.eq || [])[0], hp: (p.eq || [])[1], def: (p.eq || [])[2], aspd: (p.eq || [])[3] },
    spirit: p.sp,
    stage: p.st,
    maxStage: p.ms,
    bestStage: p.bs,
    rebirths: p.rb,
    gameSpeed: p.gs,
    skip: p.sk,               // 老存档没有这一位 → undefined → normV6 归 0（无跳关）
    carry: p.ca,
  });
}

/* ─────────────────────────────────────────────────────────────
 *  3. 玩家实况（推关速率 / 能推到第几关）
 * ───────────────────────────────────────────────────────────── */

/**
 * 取玩家当前实况。
 * @param {object} s v6 状态
 * @returns {{atk, hp, def, power, aspd, gameSpeed, rate, rateNum, canReach, maxReach}}
 *   atk/hp/def/power/aspd/rate 为大数；gameSpeed/rateNum/maxReach 为原生数
 */
export function live(s) {
  const st = normV6(s);
  const eb = E.equipBonus(st.equip);
  const base = R.baseStat(st.realm);
  const atk = N.mul(base, eb.atk);
  const hp = N.mul(base, eb.hp);
  const def = N.mul(base, eb.def);
  const power = N.mul(base, N.mul(eb.atk, eb.aspd));
  /* v7.1 三乘区：v = 35关/分 × 倍速 × 攻速 × (1 + 跳关) */
  const rate = R.pushRate(st.gameSpeed, eb.aspd, st.skip);
  const maxReach = Math.min(S.STAGE_CFG.S_MAX, Math.floor(S.maxStageFor(power)));
  return {
    atk, hp, def, power,
    aspd: eb.aspd,
    gameSpeed: st.gameSpeed,
    skip: st.skip,
    rate,
    /* 推进速率理论上是个不大不小的数（三乘区满配 128.6 关/秒），
     * 但类型上仍走大数，避免以后改参数时无声溢出。
     * 关卡推进与展示都只需要 Number 精度，统一在这里降级一次，
     * 下游（tickV6 / 离线结算 / UI）不再各自 toNumber。 */
    rateNum: N.toNumber(rate),
    maxReach,
  };
}

/* ─────────────────────────────────────────────────────────────
 *  4. Buff 宠物授予（v7.1）
 * ───────────────────────────────────────────────────────────── */

/**
 * 按【历史最高关】把还没拿到的宠物资产补发到状态里。
 *
 * ══════════════════════════════════════════════════════════════
 *  ⚠️ 棘轮式：只增不减
 * ══════════════════════════════════════════════════════════════
 *  为什么不允许「按当前 bestStage 重算」？
 *    · 旧存档迁移时 bestStage 可能归零/丢失，重算会把玩家已经
 *      打通 20000 关拿到的 ×3.5 倍速、20 档跳关一夜清空 ——
 *      这类「资产倒退」比数值失衡更伤玩家。
 *    · 验收脚本会显式设 gameSpeed=3.5 做 A/B 对照，重算会破坏可复现性。
 *  所以这里只做「该有的 ≥ 现有的，就写进去」。
 *
 *  副作用：曾经给出去的东西收不回来。这是有意为之 —— 门控表只会往前调。
 *
 * @param {object} s v6 状态（会被就地修改）
 * @returns {boolean} 是否发生了变化（UI 可以据此弹「宠物解锁」提示）
 */
export function syncPetAssets(s) {
  if (!s || typeof s !== 'object') return false;
  const best = Math.max(+s.bestStage || 0, +s.maxStage || 0, (+s.stage || 1) - 1);
  const gift = P.petAssetsFor(best);
  let changed = false;
  if (gift.gameSpeed > (+s.gameSpeed || 1)) { s.gameSpeed = gift.gameSpeed; changed = true; }
  if (gift.skip > P.normSkipTier(s.skip)) { s.skip = gift.skip; changed = true; }
  return changed;
}

/**
 * 下一档宠物奖励还差多少关（UI 钩子）。
 * @param {object} s v6 状态
 * @returns {?{at:number, kind:string, value:number, remain:number}}
 */
export function nextPetUnlock(s) {
  const st = normV6(s);
  return P.nextUnlock(st.bestStage);
}

/* ─────────────────────────────────────────────────────────────
 *  5. 推进（每帧调用）
 * ───────────────────────────────────────────────────────────── */

/**
 * 推进 dt 秒。
 *
 * ── 推进模型（对应设计文档 §3.3 / 约束 2）──────────────────────
 *   速率 v = 35关/分 × 游戏倍速 × 攻速 × (1 + 宠物跳关)  ← 三条路线独立相乘
 *   本帧推进关数 = v × dt
 *
 * ⚠️ 这里有一处必须讲清的设计决策：
 *   纯线性「v × dt」会让玩家在推进中被卡住时停住不动，但设计意图是
 *   「推不动就让怪打死 → 转生」。所以本函数做两件事：
 *     1. 面板够强（能打过当前关）→ 以速率 v 推进
 *     2. 面板不够（已经打不过下一关）→ 停止推进，标记 stuck = true
 *       （由上层决定弹转生提示还是自动转生）
 *
 *   而「能推多远」由 maxStageFor(power) 反解，与推进速率【解耦】：
 *   攻速既进速率（跑得多快）也进 maxReach（能跑多远，因为 power 含 aspd），
 *   两条路线都因攻速而受益，但作用在【不同】的数学位置 —— 这正是约束 2 要求的。
 *
 * @param {object} s v6 状态（会被就地修改）
 * @param {number} dt 秒
 * @returns {{advanced:number, stuck:boolean, reachedCap:boolean}}
 */
export function tickV6(s, dt) {
  const stats = live(s);
  const cur = s.stage;
  /* 已经打不过当前关 → 卡住 */
  if (cur > stats.maxReach) {
    s.carry = 0;
    return { advanced: 0, stuck: true, reachedCap: false };
  }
  /* 下一关就打不过 → 停在当前关（不再前进），但仍算「未卡死」直到超过 maxReach */
  const target = Math.min(S.STAGE_CFG.S_MAX, stats.maxReach);
  if (cur >= target) {
    /* v7.1：推关速率已降到「关/秒」量级（初始 0.583 关/秒），撞顶时最后一步
     * 刚好卡满、走不到 `whole > room` 分支，会残留一个 <1 的 carry（实测 0.25）。
     * 这与本函数「撞顶不留余量」的既有约定冲突——残留余量会在玩家升级装备后
     * 立刻兑现成免费关数。因此两个封顶出口统一清零 carry。 */
    s.carry = 0;
    return { advanced: 0, stuck: true, reachedCap: cur >= S.STAGE_CFG.S_MAX };
  }

  s.runT += dt;

  /* ── 推进累加器（carry）—— 必须保留小数进度 ────────────────────
   * ⚠️ 直接 `s.stage += floor(rate × dt)` 会导致速率 < 1 时永远推不动：
   *   dt=0.2s（5次/秒驱动）、rate=1 → floor(0.2)=0，每帧推进 0 关，
   *   小数部分被反复丢弃，玩家永远停在第 1 关（已在浏览器实测复现）。
   * 正确做法：把「本帧应推进的小数关数」累加进 carry，攒够 1 关才 +1，
   *   并把消耗掉的部分从 carry 里扣掉。这样 rate=0.5 时 2 秒推进 1 关也是对的。
   * carry 同时充当「关卡内进度」——渲染层可据此画更平滑的进度条。 */
  s.carry = (s.carry || 0) + stats.rateNum * dt;
  let whole = Math.floor(s.carry);
  if (whole <= 0) {
    return { advanced: 0, stuck: false, reachedCap: false };
  }

  /* 撞到 maxReach 或全图上限时，把多余进度丢掉（不再累积），
   * 否则 carry 会无限膨胀，玩家升一次装备就瞬间跳一大截。 */
  const room = target - cur;
  if (whole > room) {
    whole = room;
    s.carry = 0;
  } else {
    s.carry -= whole;
  }

  const next = cur + whole;
  s.stage = next;
  if (next > s.maxStage) s.maxStage = next;
  if (next > s.bestStage) s.bestStage = next;

  /* ── v7.1：宠物资产随【历史最高关】解锁 ─────────────────────────
   * 这里是唯一的自动授予点。放在 stage 更新之后，保证「刚跨过门槛的那一帧」
   * 立刻生效；用棘轮（只增不减）保证外部显式设定的值不被覆盖。 */
  syncPetAssets(s);

  return {
    advanced: whole,
    stuck: next >= target,
    reachedCap: next >= S.STAGE_CFG.S_MAX,
  };
}

/* ─────────────────────────────────────────────────────────────
 *  6. 灵石掉落
 * ───────────────────────────────────────────────────────────── */

/**
 * 灵石掉落：按「本帧推过的关数」结算。
 *
 * ── 核心设计：产出锚在【关卡】，但底数与成本【刻意错开】──────────
 *   产出/关  inc(s) = INC0 × Gi^s      Gi = SPIRIT_GROWTH ≈ 1.0474
 *   成本/级  cost(L) = BASE × G^L      G  = EQ_CFG.COST_GROWTH = 1.05
 *
 * 两个底数都指数量级，但不相等（Gi = G^0.95）。由此：
 *
 *   累计产出 vs 累计成本 相等 ⟹ G^L ≈ Gi^s ⟹ L ≈ 0.95·s
 *   ⇒ 装备等级 ≈ 关卡的 95%（比例，不是相等）
 *
 * 为什么不用相等（Gi = G）：相等会让「推 N 关 = 升 N 级」严格 1:1 咬死，
 * 玩家一眼看出是公式算的，毫无养成感（需求方明确否掉了这个版本）。
 *
 * 两种行为都保留：
 *   · 想升级 → 必须推关（卡在同一段刷，产出 Gi^s 被成本 G^L 甩开）
 *   · 不推关只刷 → d(L) ∝ G^(0.95s − L) 随 L 指数衰减 → 一级都升不动
 *
 * ⚠️ 反例（已实测复现，勿重蹈）：若产出底数误用怪血底数 g=1.006、
 *   成本底数用 1.05，则「推 1 关」只顶 1.006 倍而成本要 1.05 倍，
 *   要推 8.2 关才抵 1 级 —— 刷和推双输，玩家陷入死水。
 *
 * @param {object} s v6 状态
 * @param {number} from 起始关
 * @param {number} to 结束关
 */
export function grantSpirit(s, from, to) {
  if (to <= from) return N.ZERO;

  /* 逐关求和 Σ INC0·Gi^k（k = 1..to），去掉 from 之前的部分。
   * 用等比级数闭式：Σ_{k=1}^{n} Gi^k = Gi·(Gi^n − 1)/(Gi − 1)
   * 必须走大数 —— n 可达 30000，Gi≈1.047 时 Gi^30000 ≈ 1e600。 */
  const gain = N.sub(cumSpirit(to), cumSpirit(from));
  s.spirit = N.add(s.spirit, gain);
  return gain;
}

/**
 * 从第 1 关推到第 n 关的【累计】灵石产出（大数）。
 *
 * ── 实现已改为查锚点表 ────────────────────────────────────────────
 * 旧实现是闭式等比级数 INC0·Gi(Gi^n−1)/(Gi−1)，它会让 L/s 精确锁死
 * 在 0.95（详见 00-anchor 的模块注释）。现在改为直接取
 * 00-anchor.cumSpiritAt(n) 的锚定值 —— 那条曲线是人手填的，
 * 各段底数故意不等，公式再也反解不出一个固定比例。
 *
 * 保留本函数是为了给上层一个稳定的调用点（tickV6 / 测试都走它），
 * 真正的数值来源在 00-anchor。
 */
export function cumSpirit(n) {
  const m = Math.floor(n);
  if (!(m > 0)) return N.ZERO;
  return A.cumSpiritAt(m);
}

/**
 * @deprecated 产出底数已由锚点表取代，此常量仅保留给旧测试引用。
 *
 * ── 它为什么被淘汰 ──────────────────────────────────────────────
 * Gi = G^0.95 让「推到第 s 关能买几级」可以解析反解为 L = 0.95·s，
 * 实测 15 轮 9000 关，L/s 精确稳定在 0.950 零漂移。
 * 玩家会立刻发现等级永远等于关卡数的 95%，一眼看穿是算出来的
 * （需求方原话「太假了」）。手填锚点表后此问题从根上消失。
 */
export const SPIRIT_GROWTH = Math.pow(E.EQ_CFG.COST_GROWTH, 0.95);

/**
 * @deprecated 单关灵石基数已由锚点表取代，此常量仅保留给旧测试引用。
 * 现行产出曲线见 00-anchor 的 LV_ANCHORS。
 */
export const SPIRIT_INC0 = E.EQ_CFG.COST_BASE;

/* ─────────────────────────────────────────────────────────────
 *  7. 升级装备
 * ───────────────────────────────────────────────────────────── */

/**
 * 升级某一格。steps 为 0 时用「买得起多少就升多少」策略。
 *
 * @param {object} s v6 状态（就地修改）
 * @param {string} key atk|hp|def|aspd
 * @param {number} steps 档位（0 = 自动最大）
 * @returns {{ok:boolean, gained:number, cost:object, reason:string}}
 */
export function upgradeSlot(s, key, steps) {
  if (!s) return { ok: false, gained: 0, cost: N.ZERO, reason: 'no_state' };
  let n = steps | 0;
  if (n <= 0) {
    /* 自动策略：买得起多少升多少 */
    n = E.maxAffordableLevels(s.equip[key], s.spirit);
    if (n <= 0) return { ok: false, gained: 0, cost: N.ZERO, reason: 'not_enough' };
  }
  const r = E.tryUpgrade(s.equip, s.spirit, key, n);
  if (r.ok) {
    s.equip = r.equip;
    s.spirit = r.spirit;
  }
  return { ok: r.ok, gained: r.gained, cost: r.cost, reason: r.reason };
}

/* ─────────────────────────────────────────────────────────────
 *  8. 转生
 * ───────────────────────────────────────────────────────────── */

/**
 * 预演转生（不改变状态，只算给 UI 看）。
 *
 * ⚠️ maxStage 取【本轮】最高关（st.maxStage），不掺历史最高关。
 *   转生点 = (本轮最高关/10)^1.5 —— 用历史最高关会让玩家白嫖（转生后连点
 *   就能反复领同一份奖励）。所以可转生条件是「本轮真推过图」，
 *   而 bestStage 只是跨轮的荣誉展示。
 *
 * @returns {{maxStage:number, gain:object, realmNow:number, realmNext:number, realmGain:number}}
 */
export function previewRebirth(s) {
  const st = normV6(s);
  /* 本轮最高关：maxStage 与当前 stage 取大（防 maxStage 漏记） */
  const maxStage = Math.max(st.maxStage, st.stage > 1 ? st.stage : 0);
  const gain = R.rebirthPoints(Math.max(1, maxStage));
  const total = N.add(st.totalPoints, gain);
  const realmNext = R.realmsFrom(total);
  /* 还要多少修为才能突破下一境（UI 显示「还差 X」用） */
  const needNext = RM.levelCost(realmNext + 1);
  const toNext = N.sub(needNext, total);
  return {
    maxStage,
    gain,
    realmNow: st.realm,
    realmNext,
    realmGain: Math.max(0, realmNext - st.realm),
    /* ── 可读名（UI 直接用，不要再显示裸数字）── */
    realmNowName: RM.nameOf(st.realm),
    realmNextName: RM.nameOf(realmNext),
    realmNextColor: RM.realmName(realmNext).color,
    /* 下一境门槛 / 还差多少（大数） */
    needNext,
    toNext: N.gt(toNext, N.ZERO) ? toNext : N.ZERO,
  };
}

/**
 * 执行转生（就地修改）。
 *
 * ✅ 保留：境界、累计修为点、宠物资产（游戏倍速 + 跳关档位）、技能/配方
 * ❌ 清零：4 格装备等级、灵石、本轮最高关
 * ↩️ 重置：当前关回到【起始关】（v7.1：历史最高关 > 3000 时 = 最高关 − 1500，
 *    否则仍是第 1 关 —— 见 R.startStageFor）
 *
 * @param {object} s v6 状态
 * @returns {{gain:object, realmGain:number, realm:number, prevMax:number, startStage:number}}
 */
export function applyRebirth(s) {
  const pv = previewRebirth(s);
  const total = N.add(s.totalPoints, pv.gain);
  s.totalPoints = total;
  s.realm = pv.realmNext;
  s.equip = E.newEquip();
  s.spirit = N.ZERO;
  s.maxStage = 0;
  s.runT = 0;
  s.carry = 0;              // 累加器随关卡归零，否则转生后立刻多推一关
  s.rebirths += 1;
  /* ⚠️ bestStage（历史最高关）【不清零】—— 它是跨轮的荣誉记录，
   * 且 rebirthText 的「本轮最高关」用的也是它兜底。
   * 转生时把本轮最高关并入历史最高，否则转生后历史记录会被抹掉。 */
  if (pv.maxStage > s.bestStage) s.bestStage = pv.maxStage;

  /* ── v7.1 起始关：不再从【第 1 关】出发 ─────────────────────────
   * history > 3000 时从「历史最高关 − 1500」出发（固定减，不是一半）。
   * 这一步必须在 bestStage 合并【之后】做，否则本轮刚推的那 1500 关
   * 不计入起点，玩家每轮都被迫重复推同一段上坡路 —— 那正是需求方
   * 提出跳关/起始关时要消灭的「巨大时间成本」。 */
  s.stage = R.startStageFor(s.bestStage);
  /* 起始关把玩家直接抬到了高关卡区，宠物解锁也在同一时刻重算一次
   *（正常推进里 tickV6 会授予，但直接调 applyRebirth 的路径不走 tick）。 */
  syncPetAssets(s);

  return { gain: pv.gain, realmGain: pv.realmGain, realm: pv.realmNext, prevMax: pv.maxStage, startStage: s.stage };
}

/**
 * ══════════════════════════════════════════════════════════════════
 *  通关判定（v7.1 天仙门禁）
 * ══════════════════════════════════════════════════════════════════
 *  需求方：游戏只有【到达天仙】才算完成 —— 不是「推满 30000 关」就算。
 *  所以这里是【且】：关卡推满 30000 【并且】境界已达天仙圆满（第 53 层）。
 *
 *  两个条件今天恰好等价，但我们仍然两个都判：
 *    · 面板 P = BASE0 × Q^R × 装备分，maxReach 由它反解；
 *    · 实测 Q=27.0464 且装备拉满时：天仙后期 maxReach=29848 < 30000，
 *      天仙圆满 maxReach=30399 ≥ 30000 —— 即【只有天仙圆满推得满】，
 *      门禁天然成立，不需要额外拦截；
 *    · 但 Q 一旦被重调（改天有人想动 Q），这个等价性会【静默失效】：
 *      推满 30000 却还不是天仙时，只判关卡就等于偷偷放行了。
 *      双条件把「必须成仙」从数值巧合升级成代码级硬约束。
 *
 * @param {object} s v6 状态
 * @returns {boolean}
 */
export function isGameCleared(s) {
  const st = normV6(s);
  return S.isCleared(st.stage) && st.realm >= RM.REALM_MAX;
}

/**
 * 通关进度快照（UI 用：告诉玩家卡在门口的哪一步）。
 * @param {object} s v6 状态
 * @returns {{stagePct:number, realmDone:boolean, cleared:boolean, realmName:string}}
 */
export function clearProgress(s) {
  const st = normV6(s);
  return {
    stagePct: Math.min(1, Math.max(0, (st.stage - 1) / S.STAGE_CFG.S_MAX)),
    realmDone: st.realm >= RM.REALM_MAX,
    cleared: isGameCleared(st),
    realmName: RM.nameOf(st.realm),
  };
}

/* ─────────────────────────────────────────────────────────────
 *  9. 离线结算
 * ───────────────────────────────────────────────────────────── */

/**
 * 离线结算。
 *
 * ══════════════════════════════════════════════════════════════════
 *  模型（需求方口述，务必按这个理解）
 * ══════════════════════════════════════════════════════════════════
 *  「离线收益是根据玩家【在线通关速度】来算的。
 *    比如我在线 10 分钟，通了 300 关，点了转生 ——
 *    点转生那一刻，就决定了他离线收益的产出。
 *    那么就是 10 分钟一轮、300 关修为。
 *    我离线 10 小时，那就给 60 轮 × 300 关的收益。」
 *
 * 所以离线【不重新模拟游戏】，只做一道乘法：
 *
 *     roundSec   = 上一轮实际耗时（state.runT，即 runT）
 *     roundStage = 上一轮实际推到的最深关（state.maxStage / bestStage）
 *     rounds     = 离线秒数 / roundSec
 *     总修为      = rounds × rebirthPoints(roundStage)
 *
 * 为什么不能「重新模拟」：
 *   · 离线复现不了玩家的操作水平（他可能手动刷装备、挑关卡打）
 *   · 重新模拟必然引入一套【自己的】装备/转生假设，
 *     一旦那套假设和真实数值脱节（例如装备成本 1.05^n 太陡，
 *     模拟里永远刷不到高装备），离线收益就会崩成在线的 1/100
 *   · 而按【玩家自己的实测速度】折算，两个口径天然一致 ——
 *     他这一轮多快，离线就按多快发；他变强了，离线自动跟着涨
 *
 * 首次离线（还没转过生，runT=0）：用基准轮估算，兜底给一个合理值，
 * 避免新玩家离线收益为 0。基准轮取 ROUND_MINUTES（见 00-realm.js）。
 *
 * @param {object} s v6 状态（就地修改）
 * @param {number} seconds 离线秒数
 * @returns {{rounds:number, roundSec:number, roundStage:number,
 *            gain:object, realmGain:number, realmFrom:number, realmTo:number,
 *            spirit:object, stages:number, seconds:number, capped:boolean}}
 */
export function settleOffline(s, seconds) {
  const st = normV6(s);
  const total = Math.max(0, Math.floor(seconds));
  if (total <= 0) {
    return { rounds: 0, roundSec: 0, roundStage: 0, gain: N.ZERO, realmGain: 0,
             realmFrom: st.realm, realmTo: st.realm, spirit: N.ZERO, stages: 0,
             seconds: 0, capped: false };
  }

  const startRealm = st.realm;
  const startStage = st.stage;
  const startBest = st.bestStage;

  /* ── 1. 上一轮的耗时与成绩 ────────────────────────────────────────
   * runT 记录本轮已用秒数，转生时归零（见 applyRebirth）。
   * 所以 runT ∈ [0, 本轮耗时]，正是需求方说的「我这一轮花了多久」。
   *
   * ⚠️ runT 会随 tick 累加，但若玩家刚转生就下线，runT 会很小，
   *    除出来的轮数会多到失真。所以设下限 MIN_ROUND_SEC。 */
  const MIN_ROUND_SEC = 60;                    // 一轮至少按 1 分钟算
  const BASE_ROUND_SEC = 30 * 60;              // 首轮/异常时的基准（30 分钟）

  let roundSec = st.runT;
  if (!(roundSec >= MIN_ROUND_SEC)) roundSec = BASE_ROUND_SEC;

  /* 上一轮推到的最深关 —— 优先本轮最高关，退回历史最高关 */
  let roundStage = Math.max(st.maxStage, 0) || Math.max(st.bestStage, 0);
  if (!(roundStage > 0)) {
    /* 从没推过图（新号）→ 用当前面板能到的最深关兜底 */
    roundStage = Math.max(1, Math.floor(live(st).maxReach));
  }
  roundStage = Math.min(roundStage, S.STAGE_CFG.S_MAX);

  /* ── 2. 轮数 = 离线时长 / 单轮时长 ──────────────────────────────
   * 上限防极端（30 天离线挂机不该爆出十万轮），
   * 超出部分按 capped 标记，仍按同一速度线性给（等价，只是标记）。 */
  const MAX_ROUNDS = 100000;
  const rawRounds = total / roundSec;
  const rounds = Math.min(MAX_ROUNDS, rawRounds);
  const capped = rawRounds > MAX_ROUNDS;

  /* ── 3. 每轮收益（按玩家自己的成绩）→ 累加 ─────────────────────── */
  const perRound = R.rebirthPoints(roundStage);
  const gain = N.mulNum(perRound, rounds);

  /* ── 4. 落账 ───────────────────────────────────────────────────
   * 累计修为增加 → 境界按新曲线提升。
   * 灵石：离线期间等价于「刷了 rounds 轮 × 每轮灵石产出」，
   *      但灵石要留在【本轮】花，转生会清零 —— 所以离线只结算
   *      最后一轮推到 roundStage 时应得的灵石，不跨轮累加。 */
  const newTotal = N.add(st.totalPoints, gain);
  st.totalPoints = newTotal;
  const newRealm = RM.levelFrom(newTotal);
  const realmGain = Math.max(0, newRealm - st.realm);
  st.realm = newRealm;

  /* 灵石按最后一轮的口径给（不跨轮累加，因为转生会清零） */
  const spiritGain = N.sub(cumSpirit(roundStage), cumSpirit(1));
  st.spirit = N.add(st.spirit, spiritGain);

  /* 关数/best 推进：玩家一轮能到 roundStage，历史最高随之抬高 */
  if (roundStage > st.bestStage) st.bestStage = roundStage;
  if (roundStage > st.maxStage) st.maxStage = roundStage;
  st.stage = roundStage;

  st.rebirths += Math.floor(rounds);
  st.runT = 0;
  st.carry = 0;

  /* ⚠️ normV6 返回的是【新对象】st，必须逐字段回写到入参 s，
   *    否则调用方拿到的状态没有任何变化（曾经的 bug）。 */
  s.realm = st.realm;
  s.totalPoints = st.totalPoints;
  s.equip = st.equip;
  s.spirit = st.spirit;
  s.stage = st.stage;
  s.maxStage = st.maxStage;
  s.bestStage = st.bestStage;
  s.rebirths = st.rebirths;
  s.runT = 0;
  s.carry = 0;

  return {
    rounds: Math.floor(rounds),
    roundSec,
    roundStage,
    gain,                                        // 离线总修为
    perRound,                                    // 单轮修为（展示用）
    realmGain,
    realmFrom: startRealm,
    realmTo: newRealm,
    spirit: spiritGain,
    stages: roundStage - startStage,             // 净推进（跨轮保留的那个）
    startStage,
    seconds: total,
    capped,
  };
}

/**
 * 自动花灵石：4 格都买得起就买，返回是否花掉过。
 * 优先攻速 > 攻击 > 血量 > 防御（攻速同时提升速率与战力，边际收益最高）。
 */
function autoSpendSpirit(s) {
  let any = false;
  for (const k of ['aspd', 'atk', 'hp', 'def']) {
    const n = E.maxAffordableLevels(s.equip[k], s.spirit);
    if (n > 0) {
      const r = upgradeSlot(s, k, n);
      if (r.ok) any = true;
    }
  }
  return any;
}

/* ─────────────────────────────────────────────────────────────
 *  10. 展示辅助（给 DOM 层用）
 * ───────────────────────────────────────────────────────────── */

/** 关卡条文案 */
export function stageText(s) {
  const st = normV6(s);
  const info = S.stageInfo(st.stage);
  const stats = live(st);
  const cur = S.stageHp(st.stage);
  const nxt = S.stageHp(Math.min(S.STAGE_CFG.S_MAX, st.stage + 1));
  /* 推进度 = 当前关怪血 / 下一关怪血（用于进度条，纯视觉） */
  const ratio = N.isZero(nxt) ? 1 : Math.max(0, Math.min(1, N.toNumber(N.div(cur, nxt))));
  return {
    stage: st.stage,
    max: S.STAGE_CFG.S_MAX,
    slug: info.slug,
    mobName: mobLabel(info.slug),
    best: st.bestStage,
    hp: cur,
    progress: ratio,
    realm: st.realm,
    /* 可读名 + 颜色（UI 直接往 DOM 里塞，不要再显示纯数字） */
    realmName: RM.nameOf(st.realm),
    realmLabel: RM.realmName(st.realm).label,      // 「炼气·九层」
    realmColor: RM.realmName(st.realm).color,
    /* 下一境还差多少修为（进度条/文案用） */
    toNext: (() => {
      const need = RM.levelCost(Math.min(RM.REALM_MAX, st.realm + 1));
      const left = N.sub(need, st.totalPoints);
      return N.gt(left, N.ZERO) ? left : N.ZERO;
    })(),
    rate: stats.rateNum,
    maxReach: stats.maxReach,
    stuck: st.stage >= stats.maxReach,
  };
}

/** slug → 可读怪名（用 00-pure 的 MON_NAMES 若有，否则退回 slug） */
export function mobLabel(slug) {
  try {
    const g = typeof window !== 'undefined' ? window.MON_NAMES : null;
    if (g && g[slug]) return g[slug];
  } catch (e) { /* 忽略：非浏览器环境 */ }
  return slug;
}

/** 单格按钮文案 */
export function slotText(s, key) {
  const st = normV6(s);
  const lv = st.equip[key];
  const maxed = lv >= E.EQ_CFG.MAX_LV;
  const next = Math.min(1, E.EQ_CFG.MAX_LV - lv);
  const cost = maxed ? N.ZERO : E.upgradeCost(lv, next);
  const afford = !maxed && N.gte(st.spirit, cost);
  return {
    key,
    lv,
    mult: E.slotMult(lv),
    maxed,
    cost,
    afford,
    costText: maxed ? '已满级' : N.fmt(cost),
  };
}

/** 转生按钮文案 */
export function rebirthText(s) {
  const pv = previewRebirth(s);
  const willBreak = pv.realmGain > 0;
  return {
    gain: pv.gain,
    gainText: '+' + N.fmt(pv.gain),
    realmNow: pv.realmNow,
    realmNext: pv.realmNext,
    realmGain: pv.realmGain,
    maxStage: pv.maxStage,
    can: pv.maxStage > 0,
    /* ── 可读文案（UI 直接用）──
     * 转生 ≠ 突破：多数轮次只是攒修为，不跨境。
     * 所以按钮要能显示「转生后仍是 XXX，还差 Y 修为」。 */
    realmNowName: pv.realmNowName,
    realmNextName: pv.realmNextName,
    realmNextColor: pv.realmNextColor,
    willBreak,
    /* 「转生 → 炼气三层（+2）」 或 「转生后仍是炼气一层，还差 2.1万」 */
    realmText: willBreak
      ? pv.realmNowName + ' → ' + pv.realmNextName + '（+' + pv.realmGain + '）'
      : '仍是 ' + pv.realmNowName + '，还差 ' + N.fmt(pv.toNext),
    toNextText: N.fmt(pv.toNext),
  };
}

/* ─────────────────────────────────────────────────────────────
 *  10. 旧 state 桥接
 * ───────────────────────────────────────────────────────────── */

/**
 * 从旧 state 读/建 v6 子状态。
 * 旧存档没有 v6 字段时返回全新状态（等于开始新玩法），
 * 但【保留】旧存档里已经拿到的游戏倍速（宠物资产不因重构丢失）。
 *
 * @param {object} legacy 旧 state
 * @returns {object} v6 状态
 */
export function fromLegacy(legacy) {
  if (!legacy || typeof legacy !== 'object') return newV6();
  if (legacy[V6_KEY]) {
    const s = unpackV6(legacy[V6_KEY]);
    if (s) return s;
  }
  const s = newV6();
  /* 旧存档的宠物倍速 → 游戏倍速（取值保守：上限 3.5） */
  try {
    if (typeof legacy.gameSpeed === 'number') {
      s.gameSpeed = Math.max(1, Math.min(R.RATE_CFG.SPD_CAP, legacy.gameSpeed));
    }
  } catch (e) { /* 忽略 */ }
  return s;
}

/** 把 v6 状态写回旧 state */
export function toLegacy(legacy, s) {
  if (!legacy || typeof legacy !== 'object') return;
  legacy[V6_KEY] = packV6(s);
}
