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
   * 宠物跳关解锁表：按【历史最高关】分段授予，转生【不清零】。
   *
   * 格式 [历史最高关门槛, 跳关档位]。档位含义：宠物每一击额外撕掉 N 关，
   * 落在第三乘区 (1 + 跳关) 上，所以最高档 20 关 = 速率 ×21。
   *
   * ⚠️ 第一个门槛是 3000 —— 这与起始关机制的启用线【同一个数】，
   *    不是巧合：3000 关以前每轮本来就很短（<2 分钟），再给跳关会让
   *    前期一闪而过，新手完全看不到「打怪→推关→掉灵石」的循环。
   */
  SKIP_STEPS: [
    [3000, 1],
    [6000, 2],
    [10000, 4],
    [14000, 8],
    [18000, 10],
    [22000, 20],
  ],

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
 * 一次性取全部宠物资产。
 *
 * @param {number} bestStage 历史最高关
 * @returns {{gameSpeed:number, skip:number}}
 */
export function petAssetsFor(bestStage) {
  return {
    gameSpeed: unlockedSpeed(bestStage),
    skip: unlockedSkip(bestStage),
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
