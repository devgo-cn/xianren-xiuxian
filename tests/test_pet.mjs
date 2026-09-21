/**
 * tests/test_pet.mjs —— v7.1 Buff 宠物 / 起始关 / 天仙门禁 回归测试
 *
 * ⚠️ 本文件锁的是【需求方的三条 v7 新增规则】，不是某个具体数字：
 *   1. 宠物跳关必须挂在 Buff 宠物上（永久资产，转生保留），
 *      档位只有 0/1/2/4/8/10/20，且必须与第一/第二乘区【相乘】而非相加；
 *   2. 起始关 = 历史最高关 − 1500（固定减，不是一半），>3000 才启用；
 *   3. 通关必须【同时】推满 30000 关 + 到达天仙（第 53 层）。
 *
 * 另外锁死两处跨文件一致性（这类常量最容易各写一份然后悄悄漂移）：
 *   · 00-pet.PET_CFG.SPD_CAP  ⇄  00-rebirth.RATE_CFG.SPD_CAP
 *   · 00-pet 解锁档位集合     ⊆  00-rebirth.RATE_CFG.SKIP_TIERS
 */
import * as N from '../src/00-num.js';
import * as S from '../src/00-stage.js';
import * as E from '../src/00-equip.js';
import * as R from '../src/00-rebirth.js';
import * as RM from '../src/00-realm.js';
import * as P from '../src/00-pet.js';
import * as V from '../src/05-v6.js';

var pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + '  ' + (e || '')); } }

console.log('=== Buff 宠物 / 起始关 / 天仙门禁自测 ===');

/* ── 0. 表格合法性 ───────────────────────────────────────────── */
console.log('\n-- 门控表自检 --');
{
  const inc = (arr) => arr.every((x, i) => i === 0 || x[0] > arr[i - 1][0]);
  t('倍速表门槛严格递增', inc(P.PET_CFG.SPD_STEPS), 'SPD_STEPS=' + JSON.stringify(P.PET_CFG.SPD_STEPS));
  t('跳关表门槛严格递增', inc(P.PET_CFG.SKIP_STEPS), 'SKIP_STEPS=' + JSON.stringify(P.PET_CFG.SKIP_STEPS));
  /* ★ 跨文件一致性：解锁表里出现的每个跳关档位，都必须是 RATE_CFG 认的合法档 */
  const legal = R.RATE_CFG.SKIP_TIERS;
  const badTier = P.PET_CFG.SKIP_STEPS.filter(([, tier]) => legal.indexOf(tier) < 0);
  t('解锁跳关档位 ⊆ RATE_CFG.SKIP_TIERS', badTier.length === 0, 'bad=' + JSON.stringify(badTier));
  t('PET_CFG.SPD_CAP == RATE_CFG.SPD_CAP',
    Math.abs(P.PET_CFG.SPD_CAP - R.RATE_CFG.SPD_CAP) < 1e-12,
    'pet=' + P.PET_CFG.SPD_CAP + ' rate=' + R.RATE_CFG.SPD_CAP);
  /* 最高档必须真的给到上限，否则表格写了一档永远摸不到 */
  const topSkip = P.PET_CFG.SKIP_STEPS[P.PET_CFG.SKIP_STEPS.length - 1][1];
  t('跳关表最高档 == SKIP_CAP', topSkip === P.PET_CFG.SKIP_CAP, 'top=' + topSkip);
  const topSpd = P.PET_CFG.SPD_STEPS[P.PET_CFG.SPD_STEPS.length - 1][1];
  t('倍速表最高档 == SPD_CAP', Math.abs(topSpd - P.PET_CFG.SPD_CAP) < 1e-12, 'top=' + topSpd);
}

/* ── 1. 倍速解锁 ─────────────────────────────────────────────── */
console.log('\n-- 倍速解锁 --');
t('未推关时倍速 = 1', P.unlockedSpeed(0) === 1);
t('499 关还没解锁（门槛 500）', P.unlockedSpeed(499) === 1, 'got ' + P.unlockedSpeed(499));
t('500 关 → ×1.5', P.unlockedSpeed(500) === 1.5);
t('1999 关仍 ×1.5', P.unlockedSpeed(1999) === 1.5);
t('2000 关 → ×2.0', P.unlockedSpeed(2000) === 2.0);
t('6000 关 → ×2.5', P.unlockedSpeed(6000) === 2.5);
t('12000 关 → ×3.0', P.unlockedSpeed(12000) === 3.0);
t('20000 关 → ×3.5（封顶）', P.unlockedSpeed(20000) === 3.5);
t('3 万关也不会超过 3.5', P.unlockedSpeed(999999) === 3.5, 'got ' + P.unlockedSpeed(999999));
t('脏输入（-5 / NaN / undefined）都落到 1',
  P.unlockedSpeed(-5) === 1 && P.unlockedSpeed(NaN) === 1 && P.unlockedSpeed(undefined) === 1);

/* ── 2. 跳关解锁 ─────────────────────────────────────────────── */
console.log('\n-- 宠物跳关解锁 --');
/* ⚠️ v7.9（用户明确要求）：第一档门槛是 0 —— 从第一关开始就能跳。
 * ⚠️ v7.10（实测反馈"永远只跳一关"）：六档门槛整体压缩到前 2000 关内。
 *    旧表第二档要 3000 关，导致 best<3000 时可选集合恒为 {0,1}，
 *    那段赛程里"随机档位"在体感上等于没实现。 */
t('第 1 关就能跳（最高档 = 1）', P.unlockedSkip(0) === 1 && P.unlockedSkip(1) === 1,
  'got ' + P.unlockedSkip(0));
t('120 关 → 最高档 2', P.unlockedSkip(120) === 2, 'got ' + P.unlockedSkip(120));
t('300 关 → 最高档 4', P.unlockedSkip(300) === 4, 'got ' + P.unlockedSkip(300));
t('700 关 → 最高档 8', P.unlockedSkip(700) === 8, 'got ' + P.unlockedSkip(700));
t('1200 关 → 最高档 10', P.unlockedSkip(1200) === 10, 'got ' + P.unlockedSkip(1200));
t('2000 关 → 最高档 20', P.unlockedSkip(2000) === 20, 'got ' + P.unlockedSkip(2000));
t('满图后仍是 20（封顶）', P.unlockedSkip(30000) === 20);
/* ⚠️ 这条是本次反馈的核心回归防线：实测玩家卡在 207 关，必须能掷出【多于一档】 */
t('207 关（实测卡点）已解锁 0/1/2 三档', P.unlockedSkipTiers(207).join(',') === '0,1,2',
  JSON.stringify(P.unlockedSkipTiers(207)));
t('倍速与跳关在同一表内互不串台',
  P.petAssetsFor(500).skip === 4 && Math.abs(P.petAssetsFor(500).gameSpeed - 1.5) < 1e-9,
  JSON.stringify(P.petAssetsFor(500)));

/* ── 2b. 随机抽档（v7.9：不是固定跳，是那几个档里随机） ─────────── */
console.log('\n-- 跳关随机化 --');
{
  const t207 = P.unlockedSkipTiers(207);
  t('207 关的档位池 = [0,1,2]', t207.join(',') === '0,1,2', JSON.stringify(t207));
  t('池子里一定有 0（有可能不跳）', P.unlockedSkipTiers(30000).indexOf(0) === 0);
  t('未解锁档位不会出现在池里',
    t207.every((x) => P.SKIP_TIERS.indexOf(x) >= 0 && x <= 2));

  /* 抽样分布：所有档都要能抽到，且不能抽到池外的值 */
  const seen = new Set(); let outside = 0;
  for (let i = 0; i < 4000; i++) {
    const r = P.rollSkip(30000);
    if (P.SKIP_TIERS.indexOf(r) < 0) outside++;
    seen.add(r);
  }
  t('抽样 4000 次全部落在合法档位内', outside === 0, 'outside=' + outside);
  t('七个档全部出现过（0/1/2/4/8/10/20）', seen.size === 7,
    'seen=' + [...seen].sort((a, b) => a - b).join(','));
  t('不是固定值（抽样出现多于一种结果）', seen.size > 1);

  /* ★ 本次反馈的直接回归：207 关不能再出现「永远只跳 1 关」 */
  const seen207 = new Set();
  for (let i = 0; i < 3000; i++) seen207.add(P.rollSkip(207));
  t('207 关能掷出 0/1/2 三种结果（不再恒定）', seen207.size === 3,
    'seen=' + [...seen207].sort((a, b) => a - b).join(','));
  const cnt = {};
  for (let i = 0; i < 30000; i++) { const v = P.rollSkip(207); cnt[v] = (cnt[v] || 0) + 1; }
  t('207 关三档分布均匀（各占 1/3 ±8%）',
    Object.keys(cnt).length === 3 && Object.values(cnt).every((c) => Math.abs(c / 30000 - 1 / 3) < 0.08),
    JSON.stringify(cnt));

  /* 随机≠失控：实测均值必须收敛到期望值，否则赛程标定无从谈起 */
  const N_SAMP = 200000;
  let acc = 0;
  for (let i = 0; i < N_SAMP; i++) acc += P.rollSkip(30000);
  const mean = acc / N_SAMP, expv = P.skipExpected(30000);
  console.log('  20 万次抽样均值 = ' + mean.toFixed(4) + ' / 理论期望 = ' + expv.toFixed(4));
  t('抽样均值收敛到理论期望（±3%）', Math.abs(mean / expv - 1) < 0.03,
    'mean=' + mean.toFixed(4) + ' exp=' + expv.toFixed(4));

  /* 期望必须是「中位数以上但远低于最高档」——太高等于变相固定给最高档 */
  t('期望 < 最高档的一半（保留不确定性）', expv < P.unlockedSkip(30000) / 2,
    'exp=' + expv.toFixed(3) + ' max=' + P.unlockedSkip(30000));
  t('期望随最高关单调递增',
    P.skipExpected(0) < P.skipExpected(300) && P.skipExpected(300) < P.skipExpected(2000)
    && P.skipExpected(2000) <= P.skipExpected(30000));
  t('第一关的期望 = 0.5（只在 0/1 两档之间掷）', Math.abs(P.skipExpected(0) - 0.5) < 1e-9,
    'got ' + P.skipExpected(0));
  /* v7.9：第一档门槛为 0，所以【任何输入】都至少能掷出 0/1 两档 */
  const bad = [P.rollSkip(-1), P.rollSkip(0), P.rollSkip(NaN), P.rollSkip(undefined)];
  t('脏输入也只出合法档位', bad.every((x) => P.SKIP_TIERS.indexOf(x) >= 0), JSON.stringify(bad));
}

/* 归一化：脏值必须向【保守】方向收敛（宁可少给，不能白送） */
t('normSkipTier(0)=0', P.normSkipTier(0) === 0);
t('normSkipTier(6)→4（向下取合法档）', P.normSkipTier(6) === 4, 'got ' + P.normSkipTier(6));
t('normSkipTier(19)→10', P.normSkipTier(19) === 10, 'got ' + P.normSkipTier(19));
t('normSkipTier(999)→20', P.normSkipTier(999) === 20);
t('normSkipTier(-3 / undefined)→0', P.normSkipTier(-3) === 0 && P.normSkipTier(undefined) === 0);

/* ── 3. UI 钩子：下一档 ──────────────────────────────────────── */
console.log('\n-- 解锁进度 --');
{
  const nx = P.nextUnlock(0);
  /* v7.10: 门槛压缩后，跳关首档(120 关)已经排在倍速首档(500 关)之前 */
  t('0 关时下一档是 120 关处的跳关 2',
    nx && nx.at === 120 && nx.kind === 'skip' && nx.value === 2, JSON.stringify(nx));
  t('remain = 距下一档还差多少关', nx && nx.remain === 120, JSON.stringify(nx));
  const nx2 = P.nextUnlock(2999);
  t('2999 关时下一档是 6000 关处的倍速 2.5',
    nx2 && nx2.at === 6000 && nx2.kind === 'speed', JSON.stringify(nx2));
  t('remain 计算正确（6000−2999）', nx2 && nx2.remain === 3001, JSON.stringify(nx2));
  t('全部解锁后返回 null', P.nextUnlock(30000) === null);
  t('petSummary 可读', P.petSummary(22000).indexOf('跳关 20') >= 0, P.petSummary(22000));
}

/* ── 4. 第三乘区：必须与其他乘区【相乘】 ─────────────────────── */
console.log('\n-- 三乘区纯净性 --');
{
  const ONE = N.ONE;
  const base = N.toNumber(R.pushRate(1, ONE, 0));
  t('裸速率 = 35 关/分 = 0.5833 关/秒', Math.abs(base - 35 / 60) < 1e-9, 'got ' + base);
  const spd = N.toNumber(R.pushRate(3.5, ONE, 0));
  t('仅倍速 ×3.5', Math.abs(spd / base - 3.5) < 1e-9, 'got ' + (spd / base));
  const asp = N.toNumber(R.pushRate(1, N.from(3.0), 0));
  t('仅攻速 ×3.0', Math.abs(asp / base - 3.0) < 1e-9, 'got ' + (asp / base));
  const sk20 = N.toNumber(R.pushRate(1, ONE, 20));
  t('仅跳关 ×21（第三乘区）', Math.abs(sk20 / base - 21) < 1e-9, 'got ' + (sk20 / base));
  const full = N.toNumber(R.pushRate(3.5, N.from(3.0), 20));
  t('满配 = 35/60 × 3.5 × 3.0 × 21 ≈ 128.6 关/秒',
    Math.abs(full - (35 / 60) * 3.5 * 3.0 * 21) < 1e-6, 'got ' + full);
  t('满配 ≈ 7718 关/分（设计文档 §4.3）', Math.abs(full * 60 - 7718) < 2, 'got ' + (full * 60).toFixed(1));
  /* 三个乘区必须是独立相乘，不能是相加：1+1+1 只有 3 倍，相乘是 8 倍 */
  const both = N.toNumber(R.pushRate(2.0, N.from(2.0), 1));
  t('乘区是相乘不是相加（2×2×2=8）', Math.abs(both / base - 8) < 1e-9, 'got ' + (both / base));

  /* ★ v7.10 回归防线：第三乘区必须接受【小数期望值】，不能被 normSkip 折成档位。
   * 曾经的 bug：pushRate 内部对参数调 normSkip，把 E[skip]=6.4286 折成合法档位 4，
   * 于是第三乘区从 7.4286 静默缩到 5 —— 跳关收益凭空少 33%，而 UI 照常显示「跳 ≤20」，
   * 不看数字根本发现不了。这条断言就是钉死这个坑。 */
  const frac = N.toNumber(R.pushRate(1, ONE, 6.4286));
  t('第三乘区接受小数期望值（不被折成档位）',
    Math.abs(frac / base - 7.4286) < 1e-6, 'ratio=' + (frac / base).toFixed(6));
  t('期望 6.4286 不再被折叠成档位 4（那会让乘区变成 5）',
    Math.abs(frac / base - 5) > 1, 'ratio=' + (frac / base).toFixed(6));
  const half = N.toNumber(R.pushRate(1, ONE, 0.5));
  t('期望 0.5（仅解锁 0/1 两档）→ 乘区 1.5', Math.abs(half / base - 1.5) < 1e-9, 'got ' + (half / base));
  t('负数期望被夹到 0（不产生负速率）', Math.abs(N.toNumber(R.pushRate(1, ONE, -3)) / base - 1) < 1e-9);
  t('脏期望值不产生 NaN', isFinite(N.toNumber(R.pushRate(1, ONE, NaN))) &&
    isFinite(N.toNumber(R.pushRate(1, ONE, undefined))));
}

/* ── 5. 授予：棘轮式，只增不减 ───────────────────────────────── */
console.log('\n-- 宠物资产授予 --');
{
  const s = V.newV6();
  t('新状态无跳关无倍速', s.skip === 0 && s.gameSpeed === 1);
  s.bestStage = 22000;
  const changed = V.syncPetAssets(s);
  t('syncPetAssets 报告变化', changed === true);
  t('22000 关授予 跳20 + 倍速3.5', s.skip === 20 && Math.abs(s.gameSpeed - 3.5) < 1e-9,
    'skip=' + s.skip + ' spd=' + s.gameSpeed);
  const again = V.syncPetAssets(s);
  t('重复调用幂等', again === false);
  /* ★ 棘轮：外部把倍速手动压低，同步也【不许】把它拉回去，
   *    因为旧存档/验收脚本可能显式设过值，资产不能倒退。 */
  s.gameSpeed = 3.5;
  s.bestStage = 0;
  V.syncPetAssets(s);
  t('棘轮不回退（bestStage 归零也保留 ×3.5）', Math.abs(s.gameSpeed - 3.5) < 1e-9, 'got ' + s.gameSpeed);
  t('棘轮不回退跳关', s.skip === 20, 'got ' + s.skip);
}

/* ── 6. 存档往返必须带上跳关档位 ─────────────────────────────── */
console.log('\n-- 存档往返 --');
{
  const s = V.newV6();
  s.bestStage = 10000; s.skip = 4; s.gameSpeed = 2.5;
  const rt = V.unpackV6(JSON.parse(JSON.stringify(V.packV6(s))));
  t('跳关档位往返', rt.skip === 4, 'got ' + rt.skip);
  t('倍速往返', Math.abs(rt.gameSpeed - 2.5) < 1e-9, 'got ' + rt.gameSpeed);
  const old = { realm: 3, tp: 0, eq: [1, 2, 3, 4], sp: 0, st: 5, ms: 6, bs: 7, rb: 8, gs: 1.5 };
  const rtOld = V.unpackV6(old);
  t('老存档（无 sk 字段）→ skip 归 0 不报错', rtOld.skip === 0);
  const dirty = V.unpackV6({ ...old, sk: 6 });
  t('脏档位 6 被收敛到 4', dirty.skip === 4, 'got ' + dirty.skip);
}

/* ── 7. 起始关机制 ───────────────────────────────────────────── */
console.log('\n-- 起始关（最高关 − 1500）--');
t('best ≤ 3000 时仍从第 1 关出发', R.startStageFor(0) === 1 && R.startStageFor(3000) === 1);
t('3001 关 → 起始 1501', R.startStageFor(3001) === 1501, 'got ' + R.startStageFor(3001));
t('4500 关 → 起始 3000（固定减 1500，不是一半 2250）',
  R.startStageFor(4500) === 3000, 'got ' + R.startStageFor(4500));
t('10000 关 → 起始 8500', R.startStageFor(10000) === 8500, 'got ' + R.startStageFor(10000));
t('30000 关 → 起始 28500', R.startStageFor(30000) === 28500, 'got ' + R.startStageFor(30000));
t('起始关不超过历史最高（不许白送）', R.startStageFor(1000) <= 1000);
{
  /* ★ 固定量而非比例：offset 与 best 无关，可写成一个恒等式 */
  let ok = true;
  for (const b of [4000, 5000, 9000, 15000, 29999]) {
    if (R.startStageFor(b) !== b - R.START_CFG.OFFSET) ok = false;
  }
  t('任意 best 都严格 = best − 1500', ok);
  t('OFFSET=1500 且 MIN_BEST=3000（需求方指定值）',
    R.START_CFG.OFFSET === 1500 && R.START_CFG.MIN_BEST === 3000);
}

console.log('\n-- 起始关进转生流程 --');
{
  const hi = { realm: 0, equip: E.newEquip(), spirit: N.ZERO,
    stage: 10000, maxStage: 10000, bestStage: 10000, totalPoints: N.ZERO, rebirths: 0 };
  const rb = R.doRebirth(hi);
  t('doRebirth 从起始关出发', rb.state.stage === 8500, 'got ' + rb.state.stage);
  t('doRebirth 回报 startStage', rb.startStage === 8500, 'got ' + rb.startStage);
  t('doRebirth 保留历史最高关', rb.state.bestStage === 10000, 'got ' + rb.state.bestStage);
  t('doRebirth 仍未破境时不改变回起点规则',
    rb.state.maxStage === 0 && rb.state.stage === 8500);

  const lo = { ...hi, stage: 800, maxStage: 800, bestStage: 800 };
  const rb2 = R.doRebirth(lo);
  t('低于启用线仍从第 1 关出发', rb2.state.stage === 1, 'got ' + rb2.state.stage);
}

console.log('\n-- 起始关进 v6 状态机 --');
{
  const s = V.newV6();
  s.bestStage = 5000;
  s.stage = 5000; s.maxStage = 5000;
  const out = V.applyRebirth(s);
  t('applyRebirth 从起始关出发（5000 → 3500）', s.stage === 3500, 'got ' + s.stage);
  t('applyRebirth 回报 startStage', out.startStage === 3500, 'got ' + out.startStage);
  t('起始关后历史最高关并入 5000', s.bestStage === 5000, 'got ' + s.bestStage);
  /* 起始关 ≥ 门槛 → 宠物跳关同步解锁。5000 关：跳关已满档 20，倍速到 ×2 */
  t('起始关同步解锁宠物跳关', s.skip === 20 && Math.abs(s.gameSpeed - 2) < 1e-9,
    'got skip=' + s.skip + ' spd=' + s.gameSpeed);
  const lv = V.live(s);
  /* 速率第三乘区必须用【期望】E[skip] 而不是最高档：
   * 5000 关七档全开 → E = (0+1+2+4+8+10+20)/7 = 6.4286，故 ×7.4286 */
  const expMul = 1 + P.skipExpected(5000);
  t('跳关已计入速率（第三乘区按期望 ×' + expMul.toFixed(4) + '）',
    Math.abs(N.toNumber(lv.rate) / ((35 / 60) * lv.gameSpeed) - expMul) < 1e-9,
    'rate=' + N.toNumber(lv.rate).toFixed(4) + ' spd=' + lv.gameSpeed);
  t('速率用的是期望值而非最高档 20（否则会 ×21）',
    Math.abs(N.toNumber(lv.rate) / ((35 / 60) * lv.gameSpeed) - 21) > 1,
    'ratio=' + (N.toNumber(lv.rate) / ((35 / 60) * lv.gameSpeed)).toFixed(4));
}

/* ── 8. 天仙门禁 ─────────────────────────────────────────────── */
console.log('\n-- 天仙门禁 --');
{
  const mk = (stage, realm) => {
    const s = V.newV6(); s.stage = stage; s.maxStage = stage; s.bestStage = stage; s.realm = realm; return s;
  };
  t('推满 30000 但不是天仙 → 不算通关（门禁成立）', V.isGameCleared(mk(30000, 52)) === false);
  t('推满 30000 + 天仙圆满 → 通关', V.isGameCleared(mk(30000, RM.REALM_MAX)) === true);
  t('天仙圆满但没推满 → 不算通关', V.isGameCleared(mk(29999, RM.REALM_MAX)) === false);
  t('S.isCleared 仍是纯关卡判定（未被门禁污染）', S.isCleared(30000) === true && S.isCleared(29999) === false);

  /* ★ 门禁必须与真实数值【自洽】：系统允许的最高非天仙关卡推不到 30000。
   *   这里不用写死的数，而是直接用满装备面板反解 —— 换 Q 也会跟着变。 */
  const full = { atk: 33000, hp: 33000, def: 33000, aspd: 33000 };
  const reach = (lv) => {
    const eb = E.equipBonus(full);
    const power = N.mul(R.baseStat(lv), N.mul(eb.atk, eb.aspd));
    return S.maxStageFor(power);
  };
  const below = reach(RM.REALM_MAX - 1);
  const at = reach(RM.REALM_MAX);
  console.log('  天仙后期(52) maxReach=' + below.toFixed(0) + ' / 天仙圆满(53) maxReach=' + at.toFixed(0));
  t('天仙后期【确实】推不满 30000（门禁不是摆设）', below < 30000, 'got ' + below.toFixed(0));
  t('天仙圆满【确实】够到 30000（游戏可完成）', at >= 30000, 'got ' + at.toFixed(0));
  t('留出的余量合理（≤600 关，别太轻松）', at - 30000 <= 600, '余 ' + (at - 30000).toFixed(0) + ' 关');

  const pg = V.clearProgress(mk(30000, RM.REALM_MAX));
  t('clearProgress 通关态', pg.cleared === true && pg.realmDone === true, JSON.stringify(pg));
  const pg2 = V.clearProgress(mk(15000, 30));
  t('clearProgress 中途态', pg2.cleared === false && pg2.stagePct > 0 && pg2.stagePct < 1,
    JSON.stringify(pg2));
  t('clearProgress 带境界名（UI 直接显示）',
    typeof pg2.realmName === 'string' && pg2.realmName.length > 0, pg2.realmName);
}

console.log('');
console.log('通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
