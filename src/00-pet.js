/**
 * 00-pet.js —— Buff 宠物（永久资产的唯一授予入口）
 *
 * ══════════════════════════════════════════════════════════════
 *  这个模块为什么存在
 * ══════════════════════════════════════════════════════════════
 *  v7.1 §4.3 把推关速率拆成【三乘区】：
 *
 *      v = 35 关/分钟 × 游戏倍速 × 攻速 × (1 + 跳关)
 *
 *  其中「游戏倍速」和「跳关」在需求方眼里是同一件事的两条支线 ——
 *  都挂在同一只 Buff 宠物上：
 *
 *      · 倍速 = 播放速度快一点（线性加速，看得见）
 *      · 跳关 = 宠物一爪撕掉若干关（跳跃加速，摸得着）
 *
 *  需求方原话（v7 新增需求第 3 条）：
 *      「每一次重生，玩家从第一关一直往后推，需要很大的时间成本……
 *        所以引入跳关机制，宠物打一关有可能跳 1、2、4、8、10、20 关。」
 *
 *  所以【宠物跳关必须实现在 Buff 宠物里】，不能散落到装备或技能上：
 *      · 装备 = 每轮清零的短期资产（转生清零，负责本轮爬升）
 *      · 宠物 = 跨轮保留的永久资产（转生保留，负责长期底速）
 *  这两类的数学位置不同（一个在时间轴、一个在乘数轴），混在一起会让
 *  「转生后手感变慢」和「长期进度停滞」同时发生。
 *
 * ══════════════════════════════════════════════════════════════
 *  模块边界（很重要，别越界）
 * ══════════════════════════════════════════════════════════════
 *  本模块【只做查询】：给定历史最高关 → 返回该有的宠物资产。
 *  它不持有 state、不写 DOM、不碰存档；把「查询」和「授予」分开，
 *  是为了让 05-v6.js 能自由决定【什么时候】写入（当前是棘轮式只增不减）。
 *
 *  它也刻意【不 import 任何模块】：
 *      · 不依赖 00-rebirth（那边要在 05-v6 里调用本模块，避免循环引用）
 *      · 不依赖 00-num（倍速/跳关全是小整数，不必进大数层）
 *  代价是跳关档位表在这里又写了一遍。用 tests/test_pet.mjs 的
 *  「解锁档位 ⊆ RATE_CFG.SKIP_TIERS」断言把它们锁在一起。
 *
 * @module 00-pet
 */

/* ─────────────────────────────────────────────────────────────
 *  Buff 宠物择时表（设计文档 v7.1 §7「宠物解锁门控」）
 * ───────────────────────────────────────────────────────────── */

export const PET_CFG = {
  /**
   * 游戏倍速解锁表：按【历史最高关】分段授予，转生【不清零】。
   *
   * 格式 [历史最高关门槛, 倍速值]，必须按门槛升序。
   * 上限 3.5 来自需求方（§1 第 16 条：倍速由 Buff 宠物提供，上限 3.5）。
   */
  SPD_STEPS: [
    [500, 1.5],
    [2000, 2.0],
    [6000, 2.5],
    [12000, 3.0],
    [20000, 3.5],
  ],

  /**
   * 宠物跳关解锁表：按【历史最高关】分段解锁【可跳到的最高档】，转生【不清零】。
   *
   * ⚠️ v7.9（用户明确要求）：第一档门槛是 **0** —— 从第一关开始就能跳。
   *    原设计从 3000 关才给第一档，理由是前期每轮本来就短；实测下来前期
   *    那段恰恰是最磨的（要刷七百多轮、两百多小时在线才拿到起始关补给），
   *    再不给跳关等于把新手期的苦役拉长。
   *
   * ⚠️ 这里的数值是【天花板】，不是每次实际跳的关数 ——
   *    实际每次在「已解锁档位 ∪ {0}」里**随机**抽一档（见 rollSkip），
   *    0 表示这一下没跳过，也可能一把撕掉 20 关。
   */
  SKIP_STEPS: [
    [0, 1],
    [3000, 2],
    [6000, 4],
    [10000, 8],
    [14000, 10],
    [18000, 20],
  ],

  /**
   * 抽档权重（可选）。留空 = 均匀随机。
   *
   * ⚠️ 改这里会直接改动长期平均速率 —— 速率第三乘区用的是【期望值】
   *    E[skip]（见 skipExpected），不是最高档。想要"大跳更常见"就上调
   *    高档位的权重，但那等价于整体加速，记得重跑 tests/test_pet 的
   *    「期望落在家区间」断言，以及用 sim_repo.mjs 复验赛程。
   */
  SKIP_WEIGHTS: null,

  SPD_CAP: 3.5,   // 倍速硬上限（与 RATE_CFG.SPD_CAP 必须一致，测试有断言）
  SKIP_CAP: 20,   // 跳关硬上限
};

/** 合法跳关档位集合（必须与 00-rebirth.RATE_CFG.SKIP_TIERS 同构） */
export const SKIP_TIERS = [0, 1, 2, 4, 8, 10, 20];

/* ─────────────────────────────────────────────────────────────
 *  1. 归一化
 * ───────────────────────────────────────────────────────────── */

/**
 * 把任意输入收敛成合法倍速 ∈ [1, SPD_CAP]。
 * @param {number} v
 * @returns {number}
 */
export function normSpeed(v) {
  const x = +v || 0;
  if (!(x > 1)) return 1;
  return x > PET_CFG.SPD_CAP ? PET_CFG.SPD_CAP : x;
}

/**
 * 把任意输入收敛成合法跳关档位（0/1/2/4/8/10/20）。
 *
 * 取「不大于输入的最大合法档」而不是四舍五入 —— 存档里若出现脏值
 * （比如旧版本存了 6），截到 4 是保守方向，截到 8 会凭空送玩家一档。
 *
 * @param {number} tier
 * @returns {number}
 */
export function normSkipTier(tier) {
  const t = Math.floor(+tier || 0);
  let best = 0;
  for (const c of SKIP_TIERS) if (t >= c) best = c;
  return best;
}

/* ─────────────────────────────────────────────────────────────
 *  2. 查表：给定历史最高关 → 应有宠物资产
 * ───────────────────────────────────────────────────────────── */

/**
 * 已解锁的游戏倍速。
 * @param {number} bestStage 历史最高关（0 表示还没推过）
 * @returns {number} [1, 3.5]
 */
export function unlockedSpeed(bestStage) {
  const best = Math.max(0, Math.floor(+bestStage || 0));
  let out = 1;
  for (const [gate, spd] of PET_CFG.SPD_STEPS) if (best >= gate) out = spd;
  return normSpeed(out);
}

/**
 * 已解锁的跳关档位。
 * @param {number} bestStage 历史最高关
 * @returns {number} 0 / 1 / 2 / 4 / 8 / 10 / 20
 */
export function unlockedSkip(bestStage) {
  const best = Math.max(0, Math.floor(+bestStage || 0));
  let out = 0;
  for (const [gate, tier] of PET_CFG.SKIP_STEPS) if (best >= gate) out = tier;
  return normSkipTier(out);
}

/**
 * 已经解锁的跳关档位集合（升序，含 0 = 这一下不跳）。
 *
 * @param {number} bestStage 历史最高关
 * @returns {number[]} 例如当前最高档为 4 时 → [0, 1, 2, 4]
 */
export function unlockedSkipTiers(bestStage) {
  const max = unlockedSkip(bestStage);
  return SKIP_TIERS.filter((t) => t <= max);
}

/**
 * 掷一次宠物跳关：在已解锁档位里随机抽一档（含 0）。
 *
 * ── 为什么速率公式里不用它，而用 skipExpected ──────────────────────
 *   这只是【单次结果】。tick 每秒跑几十帧，如果每帧都用它当乘数，
 *   宏观速率会变成一个随机数（方差被部分抵消但仍会漂），
 *   而「多久毕业」这种赛程标定必须是可预测的数 ——
 *   所以：
 *     · 实际抖动   ← rollSkip 的结果（玩家能感到时快时慢）
 *     · 速率公式   ← skipExpected 的期望值（长期严格等于随机过程的均值）
 *
 * @param {number} bestStage 历史最高关
 * @returns {number} 本次跳关数（0 / 1 / 2 / 4 / 8 / 10 / 20）
 */
export function rollSkip(bestStage) {
  const tiers = unlockedSkipTiers(bestStage);
  if (tiers.length <= 1) return 0;
  const weights = weightsFor(tiers);
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return tiers[0];
  let r = Math.random() * total;
  for (let i = 0; i < tiers.length; i++) {
    r -= weights[i];
    if (r < 0) return tiers[i];
  }
  return tiers[tiers.length - 1];
}

/**
 * 跳关的【期望值】E[skip] —— 第三乘区真正用的数。
 *
 * 掷一次跳关的期望 = Σ pᵢ·tierᵢ，是概率意义上的长期平均。用它做乘数时，
 * 实际随机过程的长期推进速率严格等于「恒定按 E 跳」的结果，赛程标定因此可预测。
 *
 * @param {number} bestStage 历史最高关
 * @returns {number}
 */
export function skipExpected(bestStage) {
  const tiers = unlockedSkipTiers(bestStage);
  if (tiers.length <= 1) return 0;
  const weights = weightsFor(tiers);
  let total = 0, acc = 0;
  for (let i = 0; i < tiers.length; i++) { total += weights[i]; acc += weights[i] * tiers[i]; }
  return total > 0 ? acc / total : 0;
}

/** 权重表：未配置时退化为全 1（均匀随机） */
function weightsFor(tiers) {
  const cfg = PET_CFG.SKIP_WEIGHTS;
  if (!cfg || !cfg.length) return tiers.map(() => 1);
  return tiers.map((t) => {
    const w = cfg[SKIP_TIERS.indexOf(t)];
    return (typeof w === 'number' && w > 0) ? w : 1;
  });
}

/**
 * 一次性取全部宠物资产。
 *
 * @param {number} bestStage 历史最高关
 * @returns {{gameSpeed:number, skip:number, skipExp:number}}
 *   skip    = 当前能跳到的【最高档】（UI 展示用：显示「跳 ≤4」）
 *   skipExp = 期望值（速率第三乘区用，见 rollSkip 注释）
 */
export function petAssetsFor(bestStage) {
  const skip = unlockedSkip(bestStage);
  return {
    gameSpeed: unlockedSpeed(bestStage),
    skip,
    skipExp: skipExpected(bestStage),
  };
}

/* ─────────────────────────────────────────────────────────────
 *  3. 解锁进度（UI 用：下一档还差多少）
 * ───────────────────────────────────────────────────────────── */

/**
 * 下一个还没拿到的宠物奖励。
 *
 * 给 UI 画「再推 XXX 关，阿青学会跳 N 关」这类钩子用 ——
 * 需求方要求玩家能看到「下一口饭在哪」，否则中后期只有数字在涨。
 *
 * @param {number} bestStage 历史最高关
 * @returns {?{at:number, kind:'speed'|'skip', value:number, remain:number}}
 *  全部解锁完返回 null
 */
export function nextUnlock(bestStage) {
  const best = Math.max(0, Math.floor(+bestStage || 0));
  const nexts = [];
  for (const [gate, spd] of PET_CFG.SPD_STEPS) {
    if (best < gate) { nexts.push({ at: gate, kind: 'speed', value: spd, remain: gate - best }); break; }
  }
  for (const [gate, tier] of PET_CFG.SKIP_STEPS) {
    if (best < gate) { nexts.push({ at: gate, kind: 'skip', value: tier, remain: gate - best }); break; }
  }
  if (!nexts.length) return null;
  nexts.sort((a, b) => a.at - b.at);
  return nexts[0];
}

/**
 * 宠物资产文字摘要（UI 直接展示，别再自己拼字符串）。
 * @param {number} bestStage 历史最高关
 * @returns {string}
 */
export function petSummary(bestStage) {
  const a = petAssetsFor(bestStage);
  const parts = ['倍速 ×' + a.gameSpeed.toFixed(1)];
  if (a.skip > 0) parts.push('跳关 ' + a.skip);
  return parts.join(' ／ ');
}
