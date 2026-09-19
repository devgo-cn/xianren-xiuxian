/**
 * tests/test_realm.mjs —— 境界表（54 层）回归测试
 *
 * ⚠️ 修改 00-realm.js 的任何参数后必须重跑本文件。
 *    本文件锁定的不是"某个数"，而是【几条不许破坏的关系】：
 *      1. 总层数 = 54（12 大境：凡人1 + 炼气13 + 其余10境×4）
 *      2. 命名规则与旧版 BIGS/SEG_META 一致（炼气是「X层」不是「前期」）
 *      3. Q_REALM_REF 与 00-rebirth.REBIRTH_CFG.Q_REALM 一致
 *      4. 天仙门禁：第 53 层【推不满】30000，第 54 层（天仙）才够到 30000
 *      5. 全程轮数 = Λ×53（v7.1 恒定节奏；毕业天数由 model.py 的休闲档口径验证）
 *      6. 门槛单调递增、反向求解可逆
 */
import * as RM from '../src/00-realm.js';
import * as R from '../src/00-rebirth.js';
import * as E from '../src/00-equip.js';
import * as S from '../src/00-stage.js';
import * as N from '../src/00-num.js';

/* 别名：自洽性检查里用 RB 指 rebirth（R 已被别处占用为随机数用途的惯例） */
const RB = R;

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  PASS ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
}

console.log('\n=== 境界表 ===');

/* ── 1. 总层数与大境结构 ── */
t('状态总数 = 54（含凡人）', RM.REALM_STATES === 54, 'got ' + RM.REALM_STATES);
t('最大层号 = 53（凡人不占层号）', RM.REALM_MAX === 53, 'got ' + RM.REALM_MAX);
t('12 个大境', RM.BIG_REALMS.length === 12, 'got ' + RM.BIG_REALMS.length);
t('凡人 1 段', RM.BIG_REALMS[0].segs === 1);
t('炼气 13 段', RM.BIG_REALMS[1].segs === 13);
t('炼气->天仙都 4 段',
  RM.BIG_REALMS.slice(2).every(b => b.segs === 4));

/* 每个层号的显示名唯一 —— 曾出现「天仙圆满」重复占两层 */
const allNames = new Set(Array.from({length: RM.REALM_MAX + 1}, (_, i) => RM.nameOf(i)));
t('54 个层号对应 54 个唯一名', allNames.size === RM.REALM_MAX + 1,
  'unique=' + allNames.size + ' expect=' + (RM.REALM_MAX + 1));

/* ── 2. 命名规则 ── */
console.log('\n=== 命名规则（必须与旧版 BIGS 口径一致）===');
t('0 层 = 凡人', RM.nameOf(0) === '凡人', 'got ' + RM.nameOf(0));
t('1 层 = 炼气一层', RM.nameOf(1) === '炼气一层', 'got ' + RM.nameOf(1));
t('13 层 = 炼气十三层', RM.nameOf(13) === '炼气十三层', 'got ' + RM.nameOf(13));
t('14 层 = 筑基前期', RM.nameOf(14) === '筑基前期', 'got ' + RM.nameOf(14));
t('17 层 = 筑基圆满', RM.nameOf(17) === '筑基圆满', 'got ' + RM.nameOf(17));
t('18 层 = 结丹前期', RM.nameOf(18) === '结丹前期', 'got ' + RM.nameOf(18));
t('53 层 = 天仙圆满', RM.nameOf(53) === '天仙圆满', 'got ' + RM.nameOf(53));
t('52 层 = 天仙后期', RM.nameOf(52) === '天仙后期', 'got ' + RM.nameOf(52));

/* 炼气不允许出现 14 层（只有 13 段） */
const lianqi14 = RM.nameOf(14);
t('不存在「炼气十四层」', lianqi14.indexOf('炼气') !== 0, 'got ' + lianqi14);

/* realmName 的结构字段供 UI 复用（旧版 updateRealmUI 依赖 seg/big/segNo） */
const r1 = RM.realmName(1), r14 = RM.realmName(14), r0 = RM.realmName(0);
t('realmName(1).big = 炼气', r1.big === '炼气');
t('realmName(1).segNo = 1', r1.segNo === 1, 'got ' + r1.segNo);
t('realmName(1).seg = 一层', r1.seg === '一层', 'got ' + r1.seg);
t('realmName(14).seg = 前期', r14.seg === '前期', 'got ' + r14.seg);
t('realmName(0).seg 为空', r0.seg === '', 'got "' + r0.seg + '"');
t('每层都有 color', Array.from({length: RM.REALM_MAX + 1}, (_, i) => RM.realmName(i))
  .every(x => typeof x.color === 'string' && x.color[0] === '#'));

/* ── 3. 参数一致性 ── */
console.log('\n=== 参数一致性（跨文件）===');
t('Q_REALM_REF == REBIRTH_CFG.Q_REALM',
  Math.abs(RM.Q_REALM_REF - R.REBIRTH_CFG.Q_REALM) < 1e-9,
  'realm=' + RM.Q_REALM_REF + ' rebirth=' + R.REBIRTH_CFG.Q_REALM);

/* 装备倍率：00-realm 内部常量必须与 00-equip 的实际值一致 */
const eqMult = E.EQUIP_MAX_BONUS;
t('装备满级倍率 = 10.9（v7.1 线性公式 1+C·L）',
  Math.abs(eqMult - 10.9) < 0.01, 'got ' + eqMult.toFixed(2));

/* ── 4. 54 层走完 30000 关 ── */
console.log('\n=== 走完全图 ===');
const EQ_MULT = E.EQUIP_MAX_BONUS;
function yieldAt(realmLv) {
  const r = RM.realmName(realmLv).bigIdx;
  /* 与 00-realm.roundYield 同式 */
  const Q = RM.Q_REALM_REF;
  const base = 10 * Math.pow(Q, realmLv - 1) * EQ_MULT;
  const s = Math.min(30000, 1 + Math.log(base / 1.0055) / Math.log(1.006));
  return { stage: s, pts: Math.pow(s / 10, 1.5) };
}
const top = yieldAt(53);       // 第 53 层（渡劫末期，未成天仙）时刷本轮
/* v7.1 门禁：R53 必须【够不到】30000 —— 天仙才是通关的唯一门票。
 * 缓冲越大越安全：当前 Q=27.0464 留 551 关，玩家靠宠物跳关/离线补课
 * 也翻不过去。若这里改回 >= 30000，等于「不用成仙也能通关」，直接违背需求方。 */
t('第 53 层推不满 30000 关（天仙门禁成立）', top.stage < 30000 - 100,
  'stage=' + top.stage.toFixed(0) + ' 距顶 ' + (30000 - top.stage).toFixed(0) + ' 关');
const below = yieldAt(45);
t('第 45 层还没到顶（后期确实更难）', below.stage < 30000, 'stage=' + below.stage.toFixed(0));

/* ── 5. 门槛单调递增 + 量级合理 ── */
console.log('\n=== 门槛曲线 ===');
let mono = true, prev = N.ZERO;
for (let r = 1; r <= RM.REALM_MAX; r++) {
  const c = RM.cumCultivation(r);
  if (N.lt(c, prev)) mono = false;
  prev = c;
}
t('累计门槛单调递增', mono);

const c1 = N.toNumber(RM.cumCultivation(1));
const c54 = N.toNumber(RM.cumCultivation(RM.REALM_MAX));
t('第 1 层门槛 < 1e6（开局不会卡死）', c1 < 1e6, 'c1=' + c1.toExponential(3));
t('末层门槛 > 1e8（天仙够熬）', c54 > 1e8, 'c54=' + c54.toExponential(3));
t('门槛跨度 > 100 倍', c54 / c1 > 100, 'ratio=' + (c54 / c1).toFixed(0));

/* ── 6. 轮数曲线 ── */
console.log('\n=== 轮数曲线 ===');
t('第 1 层轮数 ≈ ROUNDS_BASE（±10%）',
  Math.abs(RM.roundsFor(1) / RM.ROUNDS_BASE - 1) < 0.1,
  'got ' + RM.roundsFor(1).toFixed(2) + ' base=' + RM.ROUNDS_BASE);
t('末层轮数 = Λ × 1（v7.1 恒定）',
  Math.abs(RM.roundsFor(RM.REALM_MAX) - RM.ROUNDS_BASE * RM.ESCALATE) < 0.01,
  'got ' + RM.roundsFor(RM.REALM_MAX).toFixed(2));
let totalRounds = 0;
for (let r = 1; r <= RM.REALM_MAX; r++) totalRounds += RM.roundsFor(r);
const days = totalRounds * RM.ROUND_MINUTES / 1440;
/* v7.1：同形成本下【每境轮数恒定】，所以总轮数必须精确等于 Λ×层数。
 * 这条取代了旧版「按每轮 30 分钟估天数」的口径 —— 那个口径没算离线收益，
 * 与 v7.1 的休闲档（每天 2 次在线 + 2×11h 离线）33 天毕业不是一回事。
 * 真正的毕业天数由附录脚本 model.py 的 casual_sim 验证。 */
t('全程轮数 = Λ × 层数（v7.1 恒定节奏）',
  Math.abs(totalRounds - RM.ROUNDS_BASE * RM.REALM_MAX) < 1e-6,
  'rounds=' + totalRounds.toFixed(0) + ' expect=' + (RM.ROUNDS_BASE * RM.REALM_MAX));
t('全程轮数落在 Λ 量级（6000 上下）', totalRounds > 5500 && totalRounds < 6600,
  'rounds=' + totalRounds.toFixed(0) + ' days(纯在线折算)=' + days.toFixed(1));

/* ── 7. 反向求解可逆 ── */
console.log('\n=== levelFrom / tryBreakthrough ===');
let inv = true, bad = '';
for (const r of [1, 5, 13, 14, 27, 37, 48, 52, RM.REALM_MAX]) {
  const got = RM.levelFrom(RM.cumCultivation(r));
  if (got !== r) { inv = false; bad = 'lv=' + r + ' got=' + got; }
}
t('levelFrom(cum(r)) == r（全部采样点）', inv, bad);

t('修为为 0 → 层数 0', RM.levelFrom(N.ZERO) === 0);
t('修为不足以突破 → 停在 0 层',
  RM.levelFrom(N.divNum(RM.cumCultivation(1), 2)) === 0);

const bt = RM.tryBreakthrough(0, RM.cumCultivation(3));
t('tryBreakthrough 一次跨 3 层', bt.lv === 3 && bt.gained === 3, 'lv=' + bt.lv);
t('tryBreakthrough 跨大境标记', bt.crossedBig === true);
const bt2 = RM.tryBreakthrough(1, RM.cumCultivation(2));
t('同大境内不标 crossedBig', bt2.crossedBig === false);

/* ── 8. 大数安全 ── */
console.log('\n=== 大数安全 ===');
t('末层门槛是有限大数（非 Infinity）',
  Number.isFinite(RM.cumCultivation(RM.REALM_MAX).m) && Number.isFinite(RM.cumCultivation(RM.REALM_MAX).e),
  N.sci(RM.cumCultivation(RM.REALM_MAX)));
t('levelCost(末层) > 0', N.gt(RM.levelCost(RM.REALM_MAX), N.ZERO));
t('levelCost(0) == 0', N.isZero(RM.levelCost(0)));

/* realmTable 导出完整 */
const rows = RM.realmTable();
t('realmTable 返回 REALM_MAX 行', rows.length === RM.REALM_MAX, 'got ' + rows.length + ' expect=' + RM.REALM_MAX);
t('realmTable 每行有 name/cum/levelCost',
  rows.every(x => typeof x.name === 'string' && x.cum && x.levelCost));

/* ══════════════════════════════════════════════════════════════
 *  自洽性：门槛必须与玩家真实推关能力对齐
 * ══════════════════════════════════════════════════════════════
 * 这是整套数值里最重要的一条不变量，曾经被写错两次（Q^R vs Q^(R-1)），
 * 每次都会让全程时长偏移 30~40%，而且【不会被其他测试发现】。
 *
 * 判据：玩家在【第 R-1 层】攒钱突破到第 R 层，
 *       每轮产出 = (他所在层能推到的关 / 10)^1.5
 *       实际需要轮数 = levelCost(R) / 每轮产出
 *       必须 ≈ roundsFor(R)（设计轮数）
 *
 * 允许 2% 误差（大数转换与取整带来的抖动）。 */
{
  let worst = 0, worstAt = 0;
  for (let r = 1; r <= RM.REALM_MAX; r++) {
    const base = RB.baseStat(r - 1);                       // 玩家【当前】在第 r-1 层
    const P = N.mulNum(base, E.EQUIP_MAX_BONUS);           // 装备刷满
    const s = Math.min(S.STAGE_CFG.S_MAX, Math.floor(S.maxStageFor(P)));
    const per = Math.pow(s / 10, 1.5);
    const actual = N.toNumber(RM.levelCost(r)) / per;
    const design = RM.roundsFor(r);
    const dev = Math.abs(actual / design - 1);
    if (dev > worst) { worst = dev; worstAt = r; }
  }
  t('门槛与推关能力自洽（全 53 层偏差 < 2%）', worst < 0.02,
    '最大偏差 ' + (worst * 100).toFixed(2) + '% @ 第 ' + worstAt + ' 层 ' + RM.nameOf(worstAt));

  /* v7.1：这里锁【总轮数结构】，不再锁「60~95 天」——
   * 纯在线折算的天数（125.9 天）不含离线收益，不是玩家的真实体感。
   * 休闲档 33 天是「每天 2 次在线 + 2×11h 离线」的口径，
   * 由设计文档附录 model.py 的 casual_sim() 负责验证。 */
  let totalRounds = 0;
  for (let r = 1; r <= RM.REALM_MAX; r++) totalRounds += RM.roundsFor(r);
  const days = totalRounds * RM.ROUND_MINUTES / 60 / 24;
  t('全程 ' + totalRounds.toFixed(0) + ' 轮（= Λ×' + RM.REALM_MAX + '）',
    Math.abs(totalRounds - RM.ROUNDS_BASE * RM.REALM_MAX) < 1e-6,
    '纯在线折算 ' + days.toFixed(1) + ' 天（不含离线，非玩家体感）');

  /* 单轮跨度：v7.1 线性装备下 ≈399 关（log(10.9)/log(1.006)），
   * 旧版指数装备是 ≈1655 关。具体断言见 test_rebirth。 */
  t('v7.1 线性装备口径已生效（满级 10.9 倍）', Math.abs(RM.EQ_MULT - 10.9) < 0.01,
    '见 00-equip.EQUIP_MAX_BONUS = ' + RM.EQ_MULT);
}

console.log('\n通过 ' + pass + ' / ' + (pass + fail) + '\n');
process.exit(fail === 0 ? 0 : 1);
