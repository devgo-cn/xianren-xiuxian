/**
 * src/00-realm.js —— 境界表（重构版 v6）
 *
 * ── 为什么要有这个文件 ────────────────────────────────────────────
 * v6 的第一版把境界做成了【连续可购买的曲线】：
 *     cost(R) = 50 × (R+1)^1.0      （成本线性）
 *     points(s) = (s/10)^1.5        （收益 1.5 次方）
 * 收益涨得比成本快，于是境界被瞬间填满。实测：
 *     33 轮转生 → 通关全图 → 境界 80 层 → 基本满了
 * 而需求方的设计是【十二大境、54 个小境、两三个月到天仙】。
 * 差了三个数量级 —— 「转生几次就推了十几级」，游戏因此失去意义。
 *
 * ── 本表严格对齐 00-pure.js 的 BIGS ──────────────────────────────
 *   凡人(1) 炼气(13) 筑基(4) 结丹(4) 元婴(4) 化神(4)
 *   炼虚(4) 合体(4) 大乘(4) 渡劫(4) 真仙(4) 天仙(4)   = 54 小境
 *
 * 炼气有 13 段是因为「炼气一层…十三层」是修仙文的固定说法；
 * 其余大境各 4 段（前期/中期/后期/圆满，见 00-pure.SEG4）。
 *
 * ── 节奏标定：两三个月到天仙（需求方确认）────────────────────────
 * 约束：一轮（转生后重推到卡住）≈ 几十分钟，取 30 分钟。
 * 目标总时长 75 天（2.5 个月）⟹ 约 3600 轮 ⟹ 平均每小境 67 轮。
 *
 * 曲线形状沿用旧版 REALM_DAYS 的相对比例（越往后越慢），
 * 但【不照搬绝对值】—— 旧的 148 天是离线挂机口径，新玩法节奏不同。
 * 缩放后每小境需要的轮数：
 *
 *   大境    每小境轮数   约合天数
 *   凡人        4        几十分钟
 *   炼气        5        —
 *   筑基       21        1.8 天
 *   结丹       30        2.5 天
 *   元婴       39        3.3 天
 *   化神       52        4.3 天
 *   炼虚       67        5.6 天
 *   合体       85        7.1 天
 *   大乘      106        8.9 天
 *   渡劫      131       10.9 天
 *   真仙      158       13.2 天
 *   天仙      194       16.2 天   ← 最后一段最熬，符合修仙文预期
 *
 * ── 推进方式：修为累积（需求方确认）──────────────────────────────
 * 每次转生按【本轮推到第几关】折算修为，修为累积到门槛即突破一小境。
 * 不是时间锁 —— 玩家推得越远，突破越快，"卡住就下线等离线"仍然成立。
 */

import * as N from './00-num.js';

/* ─────────────────────────────────────────────────────────────
 *  十二大境（名称/段数/颜色严格对齐 00-pure.js 的 BIGS）
 * ───────────────────────────────────────────────────────────── */

export const BIG_REALMS = [
  { n: '凡人', segs: 1,  color: '#c6b07c' },
  { n: '炼气', segs: 13, color: '#7fe0ff' },
  { n: '筑基', segs: 4,  color: '#61d0c4' },
  { n: '结丹', segs: 4,  color: '#e8c56b' },
  { n: '元婴', segs: 4,  color: '#c59bff' },
  { n: '化神', segs: 4,  color: '#58ccff' },
  { n: '炼虚', segs: 4,  color: '#b98aff' },
  { n: '合体', segs: 4,  color: '#ff8ac2' },
  { n: '大乘', segs: 4,  color: '#ffb36b' },
  { n: '渡劫', segs: 4,  color: '#8a9dff' },
  { n: '真仙', segs: 4,  color: '#a9f0c8' },
  { n: '天仙', segs: 4,  color: '#fff0a8' },
];

/** 小境名（前/中/后/圆满）；凡人只有 1 段，炼气是「X 层」 */
export const SEG_NAMES = ['前期', '中期', '后期', '圆满'];

/**
 * 最大的层号 = 54 - 1 = 53（天仙圆满）。
 * 推导：REALM_STATES 个状态里，凡人占掉 0 号，剩下 53 个是可突破层。
 */
const REALM_MAX_LV = BIG_REALMS.reduce((a, b) => a + b.segs, 0) - 1;   // 53

/**
 * 境界【状态总数】= 54。
 *
 * 注意这里是「有名字的状态个数」，不是「最大的层号」：
 *   凡人(1) + 炼气(13) + 筑基/结丹/…/天仙(10×4) = 54 个有名字的状态
 * 但凡人只对应层号 0（出生状态，不需要突破），所以
 *   可突破的层号范围是 1..53  → 见 REALM_MAX
 * 两个数差 1，曾经因此写出「炼气十四层」和「天仙圆满重复」两个 bug。
 */
export const REALM_STATES = BIG_REALMS.reduce((a, b) => a + b.segs, 0);   // 54

/**
 * 最大的【层号】= 53（天仙圆满）。
 *
 * 层号语义：
 *   0        = 凡人（出生，无门槛）
 *   1..53    = 炼气一层 … 天仙圆满
 * @see REALM_STATES
 */
export const REALM_MAX = REALM_MAX_LV;

/* ─────────────────────────────────────────────────────────────
 *  节奏曲线（v6 定稿）
 * ──────────────────────────────────────────────────────────── */

/**
 * ══════════════════════════════════════════════════════════════
 *  ⚠️ 改这里的任何一个数之前，先读完本段
 * ══════════════════════════════════════════════════════════════
 *
 * ── 玩法模型（需求方口述，务必按这个理解）──────────────────────
 *   · 一轮 = 打怪冲关，看能推到第几关。一轮几十分钟。
 *   · 冲不动了 → 点转生 → 按【本轮推到第几关】给修为。
 *   · 修为累加，攒够门槛才突破一次境界。
 *   · ⚠️ 转生 ≠ 突破。有些境界要几十次甚至几百次转生。
 *
 * ── 由此推出两条硬约束（数学，不是拍脑袋）─────────────────────
 *
 * 约束1：单轮跨度 = log(装备满级倍率) / log(怪每关增长率)
 *        装备把面板放大 EQ_MULT 倍，就能多推
 *            log(EQ_MULT) / log(G)  关
 *        取 EQ_MULT = 1 + 0.0003×33000 = 10.9、G = 1.006：
 *            log(10.9) / log(1.006) ≈ 399 关
 *        ⚠️ 这是【每轮固定】的，与境界无关 —— 因为转生会清空装备。
 *           所以「一轮能推多深」是个常数，不能靠调装备放大
 *           （倍率涨 1000 倍，跨度只从 399 涨到 1540，被 log 压死）。
 *
 * 约束2：境界必须走完 30000 关
 *        怪 H(s) = H0 · 1.006^(s-1)，第 30000 关怪血 ≈ 1e78。
 *        玩家面板 = 10 × Q_REALM^R，要够到 1e78 就得
 *            Q_REALM^53 ≈ 1e77   ⟹   Q_REALM ≈ 28
 *        ⚠️ Q_REALM 定义在 00-rebirth.js，改它要同步重跑这个文件
 *           的注释表；Q_REALM 小于 28 会导致「关卡早就推满 30000，
 *           境界却还差一大截」，后期几十层全在关卡顶上空转。
 *
 * ── 门槛怎么排 ────────────────────────────────────────────────
 * 每轮的修为产出 ≈ (推到关卡/10)^1.5，而关卡在单轮内只涨 399 关，
 * 所以同一境界内每轮的产出几乎是常数。要让「后期越来越熬」，
 * 只能让【每层需要的轮数】递增：
 *
 *     rounds(层) = ROUNDS_BASE × ESCALATE^(层/54)
 *
 * 取 ROUNDS_BASE = 18、ESCALATE = 9（实测最优）：
 *     第 1 层  ≈ 19 轮     （开局，半天一层）
 *     第 27 层 ≈ 55 轮
 *     第 54 层 ≈ 162 轮    （天仙圆满，要熬三四天）
 *     全程     ≈ 3611 轮 = 75.2 天（单轮 30 分钟）✓ 命中目标
 *
 * 实测扫描（单轮 30 分钟）：
 *     base=12 esc=8.5 → 2316 轮 = 48.3 天（偏快）
 *     base=18 esc=9   → 3611 轮 = 75.2 天  ★ 定稿
 *     base=20 esc=10  → 4312 轮 = 89.8 天（偏慢）
 *
 * 调 ROUNDS_BASE 改「前期快慢」，调 ESCALATE 改「后期陡度」。
 */

/** 目标全程时长（天）。需求方：「大概两三个月到天仙」→ 取 2.5 个月。 */
export const TARGET_DAYS = 75;

/** 一轮的预估时长（分钟）—— 需求方：「一轮几十分钟合理」 */
export const ROUND_MINUTES = 30;

/** 第 1 层需要的转生轮数（开局半天一层） */
export const ROUNDS_BASE = 18;

/** 后期陡度：末层轮数 = ROUNDS_BASE × ESCALATE = 18 × 9 = 162 */
export const ESCALATE = 9;

/**
 * 玩家初始面板 / 第 1 关怪血 / 怪每关增长率
 * —— 与 00-stage.STAGE_CFG 的 H0、G 保持同口径。
 */
const P0 = 10;
const H0 = 1.0055;
const G_LOG = Math.log(1.006);

/**
 * 每突破 1 境，基础面板的倍率。
 *
 * ⚠️ 必须与 00-rebirth.REBIRTH_CFG.Q_REALM 一致！
 *    这里复制一份是为了避免循环 import（00-rebirth → 00-realm）。
 *    tests/test_realm.mjs 有断言检查两者相等。
 *
 * 28.3 是反解值：怪第 30000 关 ≈ 1e78，玩家 54 层要够到同一量级
 *           ⟹ Q^53 ≈ 1e77 ⟹ Q ≈ 28.3。
 */
export const Q_REALM_REF = 28.3;

/**
 * 单轮跨度（关）—— 由装备倍率决定，与境界无关。
 * 仅用于注释与测试断言，实际值由 00-equip.js 的 EQ_CFG 决定。
 */
export const ROUND_SPAN = 399;

/**
 * 第 R 层需要多少轮转生。
 *   rounds(R) = ROUNDS_BASE × ESCALATE^(R/54)
 *
 * @param {number} R 层号（1-based）
 * @returns {number} 轮数（≥ ROUNDS_BASE）
 */
export function roundsFor(R) {
  const r = Math.max(1, Math.min(REALM_MAX, Math.floor(R)));
  return ROUNDS_BASE * Math.pow(ESCALATE, r / REALM_MAX);
}

/** 全图关卡总数（与 00-stage.STAGE_CFG.S_MAX 同步） */
const S_MAX = 30000;

/**
 * 装备满级倍率 —— 与 00-equip.EQUIP_MAX_BONUS 同步。
 *
 * ⚠️ 是【指数】公式 (1+C)^MAX_LV = 1.0003^33000 ≈ 19900 倍，
 *    不是线性 1 + C·MAX_LV = 10.9 倍。
 *    两者差 1800 倍，直接决定单轮跨度：
 *        指数 → log(19900)/log(1.006) ≈ 1655 关/轮
 *        线性 → log(10.9)/log(1.006)  ≈  399 关/轮
 *    改 00-equip.EQ_CFG 时必须同步这里的常量（有测试断言）。
 */
const EQ_MULT = Math.pow(1 + 0.0003, 33000);      // ≈ 19900.8

/**
 * 第 R 层的【单轮产出】—— 玩家【冲击】第 R 层时，转生一次能拿多少修为。
 *
 * ⚠️ 用【R-1】而不是 R —— 这是本表最容易搞错的一处，务必看完。
 *
 * 语义是「为了跨进第 R 层，玩家要先攒够 levelCost(R) 修为；
 *        而这些修为是他在【第 R-1 层】一轮一轮攒出来的」。
 * 所以产出必须按他【当前所在层 R-1】的面板算：
 *     面板 = P0 · Q_REALM^(R-1) · EQ_MULT
 *
 * 曾经误用 Q^R（把 R 当「已突破次数」），使门槛整体虚高 ~44%：
 *     炼气一层用的是境界 1 的面板 4188/轮，
 *     但玩家突破前还在境界 0，实际只有 2912/轮。
 * 结果「设计 18.8 轮」变成实际 27 轮，全程从 74 天拖到 ~100 天。
 *
 * 能推到的关：
 *     s = 1 + ln(面板 / H0) / ln(G)
 * 本轮的修为：
 *     g = (s / 10)^1.5
 *
 * 装备倍率必须计入：转生后装备清零，但玩家是「刷满装备再转生」的，
 * 所以一轮产出按满装备算。不含装备会低估 1800 倍（见 EQ_MULT）。
 *
 * @param {number} R 目标层号（1-based）
 * @returns {number} 该层单轮修为（原生 number）
 */
function roundYield(R) {
  const r = Math.max(1, Math.min(REALM_MAX, Math.floor(R)));
  const base = P0 * Math.pow(Q_REALM_REF, r - 1) * EQ_MULT;
  const s = Math.min(S_MAX, 1 + Math.log(base / H0) / G_LOG);
  return Math.pow(s / 10, 1.5);
}

/**
 * 突破到第 R 层所需的【累计】修为（大数）。
 *
 * 累加每层的「轮数 × 单轮产出」：
 *     cum(R) = Σ_{i=1..R}  rounds(i) × roundGain(startStage(i))
 *
 * 这样排出来的门槛自动满足：
 *   · 前期门槛低（轮数少、起步关低）→ 开局很快突破
 *   · 后期门槛高（轮数多、起步关接近 30000）→ 天仙极熬
 *
 * @param {number} R 目标层数（1-based；0 = 凡人，返回 0）
 * @returns {object} 大数
 */
export const REALM_CFG = {
  /* 全局难度系数。调大 = 全程更熬；调小 = 更快到天仙。
   * 1.0 对应约 TARGET_DAYS 天（见文件头注释）。 */
  SCALE: 1.0,
};

/**
 * 突破到第 R 层需要的累计修为（大数）。
 *
 * 逐层累加「轮数 × 单轮产出」，见 roundsFor / roundGain。
 * 全程约 2700 轮，末层累计约 6e8 量级 —— 用大数层承载绰绰有余，
 * 但接口保持大数，方便后续加「多周目」时继续放大。
 *
 * @param {number} R 目标层数（1-based；0 表示还在凡人，返回 0）
 * @returns {object} 大数
 */
export function cumCultivation(R) {
  const r = Math.max(0, Math.min(REALM_MAX, Math.floor(R)));
  if (r <= 0) return N.ZERO;
  let sum = 0;
  for (let i = 1; i <= r; i++) sum += roundsFor(i) * roundYield(i);
  return N.mulNum(N.from(sum * REALM_CFG.SCALE), 1);
}

/**
 * 从第 R-1 层突破到第 R 层所需的【单层】修为（大数）。
 *
 * ⚠️ 语义：传入「目标层号」，返回「跨进这一层」要多少修为。
 *   levelCost(1)  = 从凡人跨到炼气一层
 *   levelCost(54) = 从天仙后期跨到天仙圆满
 * 这与旧版（传当前层、返回下一层的成本）差一位，已统一为
 * 【传目标层】，因为 UI 上显示的是「还差多少能到下一境」。
 *
 * @param {number} R 目标层数（1-based）
 * @returns {object} 大数
 */
export function levelCost(R) {
  const r = Math.max(0, Math.min(REALM_MAX, Math.floor(R)));
  if (r <= 0) return N.ZERO;
  return N.sub(cumCultivation(r), cumCultivation(r - 1));
}

/* ─────────────────────────────────────────────────────────────
 *  查询：累计修为 → 当前层数
 * ───────────────────────────────────────────────────────────── */

/**
 * 给定累计修为，反解当前能到第几层。
 *
 * 用二分而非累加：54 层逐级比较在大数下也不慢，但二分更稳，
 * 且 realm 会被频繁调用（每次转生、每帧渲染都可能调）。
 *
 * @param {object} total 累计修为（大数）
 * @returns {number} 层数（0..REALM_MAX）
 */
export function levelFrom(total) {
  if (N.isZero(total)) return 0;
  let lo = 0, hi = REALM_MAX;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (N.lte(cumCultivation(mid), total)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/* ─────────────────────────────────────────────────────────────
 *  展示：层数 → 可读名
 * ───────────────────────────────────────────────────────────── */

/**
 * 层数 → { big, seg, name, label, bigIdx, segIdx, segNo, color }
 *
 * ── ⚠️ 命名规则：凡人占 0 号，不占层号 ────────────────────────────
 * 「凡人」是【出生状态】，不是一个可以「突破到」的小境，
 * 所以它对应层号 0，不参与 1..54 的编号。这与旧版 SEG_META 一致：
 *   SEG_META[0] = 凡人 → state.realmIdx = 0 时显示「凡人」
 *
 * 命名规则必须与旧版（00-pure.SEG_META / 10-base.段名 /
 * 20-core.updateRealmUI）完全一致，否则 UI 会出现「炼气·九层」乱码：
 *   炼气        → seg = "九层"    （13 段是「X 层」不是「前期」）
 *   筑基/结丹…  → seg = "前期"    （4 段：前期/中期/后期/圆满）
 *
 * 层号 ↔ 名字（1-based）：
 *   0  → 凡人（出生）
 *   1..13   → 炼气·一层 … 炼气·十三层
 *   14..17  → 筑基·前期 … 筑基·圆满
 *   51..54  → 天仙·前期 … 天仙·圆满
 *
 * @param {number} lv 层数（0 = 凡人，1..REALM_MAX 为小境）
 */
export function realmName(lv) {
  const t = Math.max(0, Math.min(REALM_MAX, Math.floor(lv)));
  const mortal = BIG_REALMS[0];
  if (t === 0) {
    return { big: '凡人', seg: '', name: '凡人', label: '凡人',
             bigIdx: 0, segIdx: 0, segNo: 0, color: mortal.color };
  }

  /* 层号 1..54 依次落到 炼气..天仙。
   *
   * ⚠️ acc 是【已用掉的层数】，从 0 起（凡人只占 0 号，不占段位编号）。
   *    炼气窗口 = (0, 13] → 层 1..13 共 13 个 ✓
   *    筑基窗口 = (13, 17] → 层 14..17 共 4 个 ✓
   * 曾写错成 acc 从 mortal.segs 起，导致出现「炼气十四层」。 */
  let acc = 0;
  for (let i = 1; i < BIG_REALMS.length; i++) {
    const big = BIG_REALMS[i];
    /* t - acc = 在本大境内的第几段（1-based）；≤ segs 即命中 */
    if (t - acc <= big.segs) {
      const segIdx = t - acc - 1;    // 0-based 段内序号
      const segNo  = segIdx + 1;     // 1-based，给「炼气X层」用
      /* 炼气用「一层/二层…」而不是「前期/中期」——
       * 修仙文里「炼气十三层」是固定说法，写成「炼气后期」反而怪。
       * 规则照抄旧版 30-systems.buildSegs()。 */
      const seg = big.n === '炼气'
        ? CN_DIGITS[segIdx] + '层'
        : (SEG_NAMES[segIdx] || '');
      return {
        big: big.n,
        seg,
        name: big.n + seg,          // 紧凑显示：「炼气九层」
        label: big.n + '·' + seg,   // 旧版格式：「炼气·九层」
        bigIdx: i,
        segIdx,
        segNo,
        color: big.color,
      };
    }
    acc += big.segs;
  }
  /* 理论上到不了这里（t ≤ REALM_MAX），兜底给最后一层 */
  const last = BIG_REALMS[BIG_REALMS.length - 1];
  return { big: last.n, seg: SEG_NAMES[3], name: last.n + SEG_NAMES[3],
           label: last.n + '·' + SEG_NAMES[3],
           bigIdx: BIG_REALMS.length - 1, segIdx: 3, segNo: 4, color: last.color };
}

/** 中文数字（炼气十三层用）—— 与旧版 cnNum 的取值表一致 */
const CN_DIGITS = [
  '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  '十一', '十二', '十三', '十四',
];

/** 层数 → 名字（字符串快捷方式） */
export function nameOf(lv) { return realmName(lv).name; }

/* ─────────────────────────────────────────────────────────────
 *  突破
 * ───────────────────────────────────────────────────────────── */

/**
 * 尝试突破：给定累计修为，返回新层数与是否跨大境。
 *
 * @param {number} curLv 当前层数
 * @param {object} total 累计修为（大数）
 * @returns {{lv:number, gained:number, crossedBig:boolean, name:string}}
 */
export function tryBreakthrough(curLv, total) {
  const next = levelFrom(total);
  const gained = Math.max(0, next - curLv);
  const from = realmName(curLv);
  const to = realmName(next);
  return {
    lv: next,
    gained,
    crossedBig: gained > 0 && to.bigIdx > from.bigIdx,
    name: to.name,
  };
}

/* ─────────────────────────────────────────────────────────────
 *  调参辅助
 * ───────────────────────────────────────────────────────────── */

/**
 * 导出整条境界曲线，便于调难度时打印查看。
 * @returns {Array<{lv, name, cum, levelCost, rounds}>}
 */
export function realmTable() {
  const rows = [];
  for (let r = 1; r <= REALM_MAX; r++) {
    const cum = cumCultivation(r);
    rows.push({
      lv: r,
      name: nameOf(r),
      cum,
      cumLog10: N.log10(cum),
      levelCost: levelCost(r),
    });
  }
  return rows;
}
