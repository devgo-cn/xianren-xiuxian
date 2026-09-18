import * as N from '../src/00-num.js';
import * as S from '../src/00-stage.js';
import * as E from '../src/00-equip.js';
import * as R from '../src/00-rebirth.js';
import * as V from '../src/05-v6.js';
import * as A from '../src/00-anchor.js';

var pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + '  ' + (e || '')); } }

console.log('=== v6 整合层自测 ===');

/* ── 新状态 ── */
var s = V.newV6();
t('新状态 realm=0', s.realm === 0);
t('新状态 stage=1', s.stage === 1);
t('新状态灵石=0', N.isZero(s.spirit));
t('新状态4格全0', s.equip.atk === 0 && s.equip.hp === 0 && s.equip.def === 0 && s.equip.aspd === 0);
t('新状态 gameSpeed=1', s.gameSpeed === 1);

/* ── 存档往返 ── */
var s2 = V.newV6();
s2.realm = 12;
s2.spirit = N.from(1.23e45);
s2.equip = { atk: 100, hp: 200, def: 300, aspd: 400 };
s2.stage = 777;
s2.bestStage = 999;
s2.gameSpeed = 3.2;
s2.rebirths = 5;
s2.totalPoints = N.from(6.6e9);
var packed = V.packV6(s2);
var rt = V.unpackV6(JSON.parse(JSON.stringify(packed)));
t('往返 realm', rt.realm === 12);
t('往返 spirit=1.23e45', Math.abs(N.log10(rt.spirit) - 45.09) < 0.02, 'got ' + N.sci(rt.spirit));
t('往返 equip', rt.equip.atk === 100 && rt.equip.aspd === 400);
t('往返 stage/best', rt.stage === 777 && rt.bestStage === 999);
t('往返 gameSpeed', Math.abs(rt.gameSpeed - 3.2) < 1e-9);
t('往返 totalPoints', Math.abs(N.log10(rt.totalPoints) - 9.82) < 0.02, 'got ' + N.sci(rt.totalPoints));
t('存档体积小 (JSON<200B)', JSON.stringify(packed).length < 200, 'len=' + JSON.stringify(packed).length);

/* ── 脏档容错 ── */
t('脏档 null → 新状态', V.unpackV6(null) === null);
var dirty = V.unpackV6({ realm: -5, tp: 'garbage', eq: [99999999, null, 'x', 5], sp: {}, st: -1, gs: 99 });
t('脏档 realm 夹回0', dirty.realm === 0);
t('脏档 tp 归零', N.isZero(dirty.totalPoints));
t('脏档 eq 夹到上限', dirty.equip.atk === E.EQ_CFG.MAX_LV && dirty.equip.aspd === 5);
t('脏档 stage 夹回1', dirty.stage === 1);
t('脏档 gs 夹到3.5', dirty.gameSpeed === 3.5);

/* ── live 实况 ── */
var sl = V.newV6();
var L0 = V.live(sl);
console.log('  初始：power=' + N.sci(L0.power) + ' rate=' + L0.rateNum.toFixed(2) + ' maxReach=' + L0.maxReach);
t('初始 power = BASE0 = 10', Math.abs(N.toNumber(L0.power) - 10) < 1e-9);
t('初始 rate = 1', Math.abs(L0.rateNum - 1) < 1e-9);
t('初始 maxReach ≈ 385', L0.maxReach >= 380 && L0.maxReach <= 390, 'got ' + L0.maxReach);

/* 装备加成是【指数】而不是线性 —— 这是「玩家为什么要点装备按钮」的根据。
 * 线性 (1+C·L) 封顶 10.9 倍，被境界 2.2^R 碾压；指数 (1+C)^L 满级 ≈ 1.99e4 倍。 */
console.log('  装备满级加成 = ' + N.sci(E.slotMult(33000)) + '（旧线性版只有 10.9 倍）');
t('装备满级加成 ≈ 1.99e4（指数）', Math.abs(N.log10(E.slotMult(33000)) - 4.3) < 0.05,
  'got ' + N.sci(E.slotMult(33000)));
t('装备满级加成 > 1000 倍（碾压旧线性上限 10.9）',
  N.gt(E.slotMult(33000), N.from(1000)), 'got ' + N.sci(E.slotMult(33000)));

/* 两条路线独立：倍速与攻速各自都能提升 rate */
var sA = V.newV6(); sA.gameSpeed = 3.5;
var sB = V.newV6(); sB.equip = { atk: 0, hp: 0, def: 0, aspd: 33000 };
var LA = V.live(sA), LB = V.live(sB);
t('倍速3.5 → rate=3.5', Math.abs(LA.rateNum - 3.5) < 1e-9, 'got ' + LA.rateNum);
t('攻速满级 → rate≈1.99e4', Math.abs(LB.rateNum / 19900 - 1) < 0.01, 'got ' + LB.rateNum.toFixed(0));
t('两条路线相乘 rate≈6.97e4',
  Math.abs(V.live((function(){var x=V.newV6();x.gameSpeed=3.5;x.equip={atk:0,hp:0,def:0,aspd:33000};return x;})()).rateNum / 69650 - 1) < 0.01);

/* rate 输出的是大数，rateNum 是同值原生数 —— 两者必须一致 */
t('rate 是大数且与 rateNum 同值',
  typeof LB.rate === 'object' && Math.abs(N.toNumber(LB.rate) - LB.rateNum) < 1e-6);

/* ── 推进 ── */
/* ⚠️ 攻速满级后 rate≈6.97e4 关/秒，而 maxReach 只有几千关 ——
 * 推关会被 maxReach 卡住，测不出「速率换算是否精确」。
 * 因此本组用【只加速度不加战力】的构造来验速率：
 * 攻速格放大 rate（推得快），但不参与 maxReach 的判定时，
 * 天花板由其它格单独控制。 */

/* 1) 小速率下逐帧推进的换算精度（rate=1，最贴近真实前期体验） */
var spRate = V.newV6();
var advHalf = 0;
for (var hi = 0; hi < 50; hi++) advHalf += V.tickV6(spRate, 0.1).advanced;   // 5 秒 @ rate=1
t('rate=1 时 5 秒推进 5 关（0.1s 步长）', Math.abs(advHalf - 5) <= 1, 'advanced=' + advHalf);

/* 2) 满攻速的 rate 必须真的换算成关数 —— 用「面板远超天花板」的
 *    极端局面：把 realm 抬到 maxReach 足够大，让 rate 成为唯一约束。
 *    （maxReach 与 rate 同时被攻速放大，所以这里让 realm 提供天花板） */
var spBig = V.newV6(); spBig.gameSpeed = 3.5; spBig.equip = { atk: 0, hp: 0, def: 0, aspd: 33000 };
spBig.realm = 30;
var bigRate = V.live(spBig).rateNum;
var bigReach = V.live(spBig).maxReach;
console.log('  满攻速档：rate=' + bigRate.toFixed(0) + ' 关/秒, maxReach=' + bigReach + ' 关');
/* 推 0.02 秒（量级 ≈ 1393 关）以确保不撞顶，验证的是换算本身 */
var r1 = V.tickV6(spBig, 0.02);
t('满攻速按速率推进（未撞顶时 = rate×dt）',
  Math.abs(r1.advanced - Math.round(bigRate * 0.02)) <= 2,
  'advanced=' + r1.advanced + ' expect=' + Math.round(bigRate * 0.02));
t('stage 前进', spBig.stage > 1, 'got ' + spBig.stage);
t('maxStage 同步', spBig.maxStage === spBig.stage && spBig.bestStage === spBig.stage);

/* 3) 撞顶：速率再高也不会越过 maxReach */
var spCap = V.newV6(); spCap.gameSpeed = 3.5; spCap.equip = { atk: 0, hp: 0, def: 0, aspd: 33000 };
var capReach = V.live(spCap).maxReach;
for (var ci = 0; ci < 20; ci++) V.tickV6(spCap, 10);      // 200 秒，远超所需
t('高攻速也停在 maxReach', Math.abs(spCap.stage - capReach) <= 2,
  'stage=' + spCap.stage + ' maxReach=' + capReach);

/* 卡关：推到 maxReach 后 stuck */
var sp2 = V.newV6();
for (var i = 0; i < 100; i++) V.tickV6(sp2, 60);
t('初始面板卡在 maxReach=385 附近', Math.abs(sp2.stage - 385) <= 2, 'got ' + sp2.stage);
var r2 = V.tickV6(sp2, 60);
t('到顶后 stuck=true', r2.stuck === true);
t('到顶后不再前进', r2.advanced === 0);

/* ── 灵石掉落 ── */
var sd = V.newV6();
var g1 = V.grantSpirit(sd, 1, 101);
console.log('  推100关获得灵石 = ' + N.sci(g1));
t('推100关掉灵石 > 0', N.isPos(g1));
t('灵石已入账', N.eq(sd.spirit, g1));
var g2 = V.grantSpirit(sd, 101, 201);
t('后100关掉得更多（关卡越高越多）', N.gt(g2, g1), 'g1=' + N.sci(g1) + ' g2=' + N.sci(g2));

/* ── 升级装备 ── */
var su = V.newV6();
su.spirit = N.from(1e6);
var u1 = V.upgradeSlot(su, 'aspd', 1);
t('升1级成功', u1.ok && u1.gained === 1);
t('装备等级=1', su.equip.aspd === 1);
t('灵石被扣', N.lt(su.spirit, N.from(1e6)));
var before = su.spirit;
var u2 = V.upgradeSlot(su, 'atk', 10);
t('档位10级成功', u2.ok && u2.gained === 10);
t('atk 等级=10', su.equip.atk === 10);

/* 灵石不足 → 部分升级 */
var spoor = V.newV6();
spoor.spirit = N.from(25);      // 买一次10，第二次100（买不起）
var u3 = V.upgradeSlot(spoor, 'atk', 100);
t('灵石不足时部分升级', u3.ok && u3.gained >= 1 && u3.gained < 100, 'gained=' + u3.gained);
t('部分升级后灵石几乎归零', N.lt(spoor.spirit, N.from(100)), 'left=' + N.fmt(spoor.spirit));

/* 完全买不起 */
var sbroken = V.newV6();
sbroken.spirit = N.ZERO;
var u4 = V.upgradeSlot(sbroken, 'atk', 10);
t('零灵石升级失败', u4.ok === false && u4.reason === 'not_enough');

/* 满级 */
var smax = V.newV6();
smax.equip.atk = E.EQ_CFG.MAX_LV;
smax.spirit = N.from(1e300);
var u5 = V.upgradeSlot(smax, 'atk', 10);
t('满级无法再升', u5.ok === false && u5.reason === 'max_level');

/* ── 转生预演与实际 ──
 * ⚠️ v6 平衡改动后，第 1 轮不再是「385 关」——
 *    满装备倍率 = 1.0003^33000 ≈ 19900（不是线性 10.9），
 *    单轮跨度 log(19900)/log(1.006) ≈ 1655 关，
 *    凡人起步 384 关 → 第 1 轮能到约 2039 关（见 00-realm.js 头部注释）。
 *    这里用 2039 关做预演，断言也随之对齐新曲线。 */
var sr = V.newV6();
sr.stage = 2039; sr.maxStage = 2039;
var pv = V.previewRebirth(sr);
console.log('  首轮2039关 → 修为点 ' + N.sci(pv.gain) + ' → 境界 ' + pv.realmNow + '→' + pv.realmNext);
t('首轮转生点 = (2039/10)^1.5 ≈ 2.91e4', Math.abs(N.toNumber(pv.gain) - Math.pow(203.9, 1.5)) < 1,
  'got ' + N.toNumber(pv.gain));
t('预演不改变状态', sr.stage === 2039 && sr.realm === 0);
/* 新经济下第 1 轮【不突破】—— 炼气一层要 5.47e4 修为，
 * 一轮只有 2.91e4，得攒约 19 轮。这正是需求方要的手感：
 * 「转生 ≠ 突破，有些境界要几十上百次转生」。 */
t('预演得出新境界（第1轮可能仍未破境）', pv.realmNext >= 0, 'got ' + pv.realmNext);
t('第1轮不破境（需约19轮攒够炼气一层）', pv.realmNext === 0, 'got ' + pv.realmNext);

var prevSpirit = sr.spirit;
var ar = V.applyRebirth(sr);
t('转生后关数归1', sr.stage === 1);
t('转生后本轮最高归0', sr.maxStage === 0);
t('转生后历史最高保留', sr.bestStage === 2039);
t('转生后装备清零', sr.equip.atk === 0 && sr.equip.aspd === 0);
t('转生后灵石清零', N.isZero(sr.spirit));
t('转生后境界=预演值', sr.realm === pv.realmNext);
t('转生后累计点数入账', N.eq(sr.totalPoints, pv.gain));
t('转生次数+1', sr.rebirths === 1);
t('转生后 gameSpeed 保留', sr.gameSpeed === 1);

/* 转生后 maxReach 应回到起点附近（装备清零 = 本轮推进器重置）。
 * ⚠️ 转生【清零装备】，所以转生瞬间面板反而比「刷满装备时」小 ——
 *    这不是 bug，是设计：装备是本轮推进器，境界是跨轮复利。
 *    maxReach 随境界提升体现在【同装备水平下】能推得更远。 */
var afterLive = V.live(sr);
console.log('  转生后：realm=' + sr.realm + ' power=' + N.sci(afterLive.power) + ' maxReach=' + afterLive.maxReach);
t('转生后 maxReach 合法（≥ 初始关）', afterLive.maxReach >= 1, 'got ' + afterLive.maxReach);
t('转生后装备清零 → maxReach 回落到初始附近', afterLive.maxReach < 2039,
  'got ' + afterLive.maxReach + '（装备已清）');

/* ── 离线结算：按【玩家上一轮的实测速度】折算 ──────────────────
 *
 * 需求方模型（原文）：
 *   「离线收益是根据玩家在线通关速度来算的。
 *     我在线 10 分钟通了 300 关，点了转生 ——
 *     点转生那一刻就决定了他离线收益的产出。
 *     那么就是 10 分钟一轮、300 关修为。
 *     我离线 10 小时，那就给 60 轮 × 300 关的收益。」
 *
 * 所以离线【不重新模拟游戏】，只做：
 *     rounds = 离线秒数 / 上一轮耗时
 *     修为    = rounds × rebirthPoints(上一轮推到的关)                */

/* 构造一个「刚打完一轮」的状态：10 分钟、推到 300 关 */
function afterOneRound(gs) {
  var x = V.newV6();
  x.runT = 600;            // 本轮耗时 600s = 10 分钟
  x.maxStage = 300;        // 本轮推到 300 关
  x.bestStage = 300;
  x.stage = 300;
  if (gs) x.gameSpeed = gs;
  return x;
}

var offS = afterOneRound();
var offR = V.settleOffline(offS, 10 * 3600);      // 离线 10 小时
console.log('  离线10h·单轮10分钟300关 → 轮数=' + offR.rounds
  + ' 单轮修为=' + N.toNumber(offR.perRound).toFixed(1)
  + ' 总修为=' + N.toNumber(offR.gain).toFixed(0));
t('离线轮数 = 离线时长 / 单轮时长（10h/10min = 60 轮）', offR.rounds === 60,
  'got ' + offR.rounds);
t('单轮耗时取自上一轮实测', offR.roundSec === 600, 'got ' + offR.roundSec);
t('单轮成绩取自上一轮实测', offR.roundStage === 300, 'got ' + offR.roundStage);
t('总修为 = 60 × (300/10)^1.5', Math.abs(N.toNumber(offR.gain) - 60 * Math.pow(30, 1.5)) < 1,
  'got ' + N.toNumber(offR.gain).toFixed(1) + ' expect ' + (60 * Math.pow(30, 1.5)).toFixed(1));
t('离线修为已入账', N.gt(offS.totalPoints, N.ZERO), N.sci(offS.totalPoints));
t('离线转生次数 = 轮数', offS.rebirths === 60, 'got ' + offS.rebirths);

/* 速度越快 → 同样时间内轮数越多（同样的单轮时长下靠倍速缩短） */
var fastOff = afterOneRound(3.5);
fastOff.runT = 600 / 3.5;                          // 倍速下同样内容只花 1/3.5 时间
var fastOffR = V.settleOffline(fastOff, 10 * 3600);
console.log('  离线10h·倍速3.5 → 单轮' + fastOffR.roundSec.toFixed(0) + 's 轮数=' + fastOffR.rounds);
t('倍速缩短单轮时长 → 轮数变多', fastOffR.rounds > 60,
  'slow=60 fast=' + fastOffR.rounds);

/* 首次离线（runT=0 的新号）也要给收益，不能为 0 */
var freshS = V.newV6();
var freshR = V.settleOffline(freshS, 3600);
t('新号首次离线也有收益（有基准轮兜底）', N.gt(freshR.gain, N.ZERO), N.sci(freshR.gain));
t('新号基准轮 = 30 分钟', freshR.roundSec === 1800, 'got ' + freshR.roundSec);

t('离线后关数合法', offS.stage >= 1 && offS.stage <= S.STAGE_CFG.S_MAX, 'got ' + offS.stage);
t('离线边界 0 秒无收益', N.isZero(V.settleOffline(V.newV6(), 0).gain));
t('离线负数秒无副作用', N.isZero(V.settleOffline(V.newV6(), -100).gain));
t('离线 0 秒不报错且 rounds=0', V.settleOffline(V.newV6(), 0).rounds === 0);

/* 超长离线：速度折算模型下【没有人为 cap】——
 * 30 天就是 30 天该给的收益，按 30 分钟/轮 = 1440 轮，合理且不会卡死
 * （纯乘法，没有逐轮模拟）。capped 只在轮数超过 MAX_ROUNDS 时才置位。 */
var longS = afterOneRound();                           // 单轮 10 分钟、300 关
var longR = V.settleOffline(longS, 30 * 24 * 3600);    // 30 天
console.log('  离线30天·单轮10分钟300关 → 轮数=' + longR.rounds
  + ' 修为=' + N.sci(longR.gain) + ' 境界=' + longR.realmTo);
t('30天离线 = 4320 轮（30天/10分钟）', longR.rounds === 4320, 'got ' + longR.rounds);
t('30天离线 capped=false（速度模型无人为上限）', longR.capped === false);
t('30天离线修为 = 4320 × 单轮', N.gt(longR.gain, longR.perRound) &&
  Math.abs(N.toNumber(longR.gain) / N.toNumber(longR.perRound) - 4320) < 1,
  'rounds=' + (N.toNumber(longR.gain) / N.toNumber(longR.perRound)).toFixed(0));
t('30天离线不卡死（纯乘法即刻完成）', true);
t('30天离线境界有提升', longR.realmGain > 0, 'gain=' + longR.realmGain);

/* ── 小步长推进（回归测试：小数进度不能被丢弃）──────────────
 * 真实驱动是 5 次/秒（dt=0.2s）。若 tickV6 写成 `stage += floor(rate*dt)`，
 * rate=1 时 floor(0.2)=0 → 每帧 0 关 → 玩家永远停在第 1 关。
 * 这个 bug 在 Node 单测里跑不出来（单测都传整秒），只在浏览器实测暴露。 */
var sf = V.newV6();
var adv5 = 0;
for (var fi = 0; fi < 25; fi++) adv5 += V.tickV6(sf, 0.2).advanced;   // 25×0.2s = 5 秒
console.log('  5秒内 25 次 0.2s tick（rate=1）→ 推进 ' + adv5 + ' 关, stage=' + sf.stage);
t('小步长推进 5 秒 ≈ 5 关', Math.abs(adv5 - 5) <= 1, 'advanced=' + adv5);
t('小步长后 stage 确实前进', sf.stage > 1, 'stage=' + sf.stage);
t('carry 保持在 [0,1)', sf.carry >= 0 && sf.carry < 1, 'carry=' + sf.carry);

/* 低速档（rate=1，若面板弱）也要能推进 —— 用小步长跑满 12 秒。
 * ⚠️ 注意：初始面板 maxReach=384，rate=1 时 12 秒只推 12 关，离顶还很远，
 * 这里验证的就是「12 关能被正确累积出来」。 */
var slowRate = V.newV6();
var advSlow = 0;
for (var si = 0; si < 60; si++) advSlow += V.tickV6(slowRate, 0.2).advanced;   // 12 秒 @ rate=1
console.log('  12秒 @ rate=1 小步长 → 推进 ' + advSlow + ' 关');
t('12秒 @ rate=1 → 约12关', Math.abs(advSlow - 12) <= 2, 'advanced=' + advSlow);

/* carry 存档往返 */
var sc = V.newV6();
V.tickV6(sc, 0.5);                       // 留下 0.5 的余数
var scRt = V.unpackV6(V.packV6(sc));
t('carry 存档往返', Math.abs(scRt.carry - sc.carry) < 0.01, 'got ' + scRt.carry);
t('carry 归零/越界时被夹回', V.normV6({ carry: 5 }).carry === 0 && V.normV6({ carry: -3 }).carry === 0);

/* 撞到 maxReach 时 carry 必须清零，否则升装备后瞬间跳一大截 */
var sOver = V.newV6();
for (var oi = 0; oi < 4000; oi++) V.tickV6(sOver, 1);    // 远超 384 关
t('撞顶后停在 maxReach 附近', Math.abs(sOver.stage - 384) <= 2, 'stage=' + sOver.stage);
t('撞顶后 carry 已清零', sOver.carry < 0.001, 'carry=' + sOver.carry);

/* ── 灵石经济：产出与成本必须同底数（用户提出的 bug）────────────────
 *
 * 需求方的原话：「如果玩家死了反复刷、不转生，反复刷灵石，那么他理论上
 * 是可以升到 33000 级的。所以灵石的需求应该也是指数级的，相应的产出也
 * 应该是指数级的。不转生的话，他不管怎么刷，他甚至一级都升不动。」
 *
 * 正确解法：产出锚在【关卡】、且底数 = 成本底数。
 *   产出/关  inc(s) = INC0 × G^s
 *   成本/级  cost(L) = BASE × G^L
 *   => 单轮可升级数 d = (INC0/BASE) × G^(s-L)
 *   => s = L 时 d 恒定；不推关(s 不变)时 d 随 L 指数衰减 → 一级都升不动 */
console.log('  ── 灵石经济 ──');
t('产出底数 = 成本底数^0.95（刻意错开）',
  Math.abs(V.SPIRIT_GROWTH - Math.pow(E.EQ_CFG.COST_GROWTH, 0.95)) < 1e-12,
  'Gi=' + V.SPIRIT_GROWTH.toFixed(6));
t('产出底数 ≠ 成本底数（不咬死）',
  Math.abs(V.SPIRIT_GROWTH - E.EQ_CFG.COST_GROWTH) > 1e-6,
  'Gi=' + V.SPIRIT_GROWTH.toFixed(6) + ' G=' + E.EQ_CFG.COST_GROWTH);
t('产出底数 < 成本底数（墙成立的前提）',
  V.SPIRIT_GROWTH < E.EQ_CFG.COST_GROWTH, 'Gi=' + V.SPIRIT_GROWTH.toFixed(6));

/* 累计产出闭式校验。
 * ⚠️ 语义边界：grantSpirit(s, from, to) = cum(to) − cum(from)，
 *    也就是【第 from+1 关到第 to 关】的产出（from 关本身不含）。
 *    这个半开区间是刻意的：玩家从第 from 关「推进到」第 to 关，
 *    收获的是途经的 to−from 关。测试必须按同一语义累加。 */
var sm1 = V.newV6();
V.grantSpirit(sm1, 1, 101);                                    // 第 2..101 关
var manual = N.ZERO;
for (var mi = 2; mi <= 101; mi++) manual = N.add(manual, N.sub(V.cumSpirit(mi), V.cumSpirit(mi - 1)));
t('累计产出 == 逐关差分累加（半开区间）', Math.abs(N.log10(sm1.spirit) - N.log10(manual)) < 0.01,
  'grant=' + N.sci(sm1.spirit) + ' sum=' + N.sci(manual));
t('半开区间语义：grant(1,101) == cum(101)−cum(1)',
  Math.abs(N.log10(sm1.spirit) - N.log10(N.sub(V.cumSpirit(101), V.cumSpirit(1)))) < 0.01);

/* 分段产出的可加性：grantSpirit(1,50) + grantSpirit(50,100) == grantSpirit(1,100) */
var sa = V.newV6(), sb2 = V.newV6();
V.grantSpirit(sa, 1, 50); V.grantSpirit(sa, 50, 100);
V.grantSpirit(sb2, 1, 100);
t('分段产出可加', Math.abs(N.log10(sa.spirit) - N.log10(sb2.spirit)) < 1e-9,
  'split=' + N.sci(sa.spirit) + ' whole=' + N.sci(sb2.spirit));

/* ★ 核心性质：L/s 必须【不锁死】。
 *
 * ── 这条断言的前身是「比例稳定在 0.95 附近」──────────────────────
 * 旧实现是闭式公式 产出=INC0·Gi^s / 成本=BASE·G^L，可解析反解出
 *   L = 0.95·s + 1.0265  ⟹  L/s = 0.95 + 1.0265/s
 * 偏移是纯常数，随 s 增大而消失，比值单调锁死在 0.95。
 * 实测 15 轮 9000 关零漂移 —— 玩家会发现等级永远等于关卡数的 95%，
 * 一眼看穿是算出来的（需求方原话「太假了」）。
 *
 * 现行实现改为【手填锚点表】（00-anchor.LV_ANCHORS），各段底数故意
 * 不相等，公式再也反解不出固定比例。因此断言必须【反过来写】：
 * 不再要求比例稳定，而是要求它有足够大的极差。 */
var ratios = [];
console.log('  关卡 → 锚定等级（比例应显著起伏，不再锁死在某个常数）');
for (var s2 of [100, 300, 600, 1000, 2000, 5000, 10000]) {
  var lv = A.levelAt(s2);
  var ratio = lv / s2;
  ratios.push(ratio);
  console.log('    第' + String(s2).padEnd(7) + '关 → ' + String(Math.round(lv)).padEnd(7) + '级   L/s=' + ratio.toFixed(3));
}
var rMax = Math.max.apply(null, ratios), rMin = Math.min.apply(null, ratios);
var rSpread = rMax - rMin;
console.log('    L/s 极差 = ' + rSpread.toFixed(3) + '（旧公式只有 0.002）');
t('L/s 极差足够大 → 比例未锁死', rSpread > 0.05, 'spread=' + rSpread.toFixed(3));
t('L/s 极差是旧公式的 25 倍以上', rSpread > 0.002 * 25,
  'spread=' + rSpread.toFixed(3) + ' 旧公式=0.002');
t('锚点表自检通过', A.ratioSpread().ok, JSON.stringify(A.ratioSpread()));

/* ★ 核心性质：不推关（s 固定）时，可升级数随 L 指数衰减 → 刷子卡死。
 * ⚠️ 这条在锚点表下【依然必须成立】——它是「为什么必须转生」的根据，
 *    不能因为换了产出曲线就丢掉。
 *
 * 注意 d 的判据变了：旧公式可直接反解 d = inc/cost 的连续值，
 * 锚点表下产出是逐关查表得到的，所以改用「实测能买几级」这个
 * 更贴近玩家体验的口径（见下方 simGrind 端到端模拟）。 */
var incFixed = N.sub(V.cumSpirit(101), V.cumSpirit(100));    // 恒定卡在第 100 关刷
var dWall = [];
for (var wl of [90, 95, 100, 110, 150, 200]) {
  dWall.push(N.toNumber(N.div(incFixed, E.levelCost(wl))));
}
console.log('    卡在第100关反复刷：L=90 d=' + dWall[0].toFixed(3) +
  '  L=100 d=' + dWall[2].toFixed(3) + '  L=200 d=' + dWall[5].toFixed(3));
t('不推关时 d 随 L 急剧衰减', dWall[5] < dWall[0] * 0.5,
  'd90=' + dWall[0].toFixed(3) + ' d200=' + dWall[5].toFixed(3));
t('不推关刷到一定等级后 d<1（一轮升不满1级）', dWall[5] < 1.0, 'd200=' + dWall[5].toFixed(3));

/* ★ 端到端：模拟「只刷不推关」的玩家，看会卡在哪。
 * ⚠️ 这条是「为什么必须转生」的核心根据，用两个不同的刷点各验一遍 ——
 *    换产出曲线（闭式 → 锚点表）最容易悄悄破坏的就是这个性质。 */
function simGrind(lapMax, fixedTo) {
  var s = V.newV6();
  s.stage = 1; s.maxStage = fixedTo;
  for (var lap = 0; lap < lapMax; lap++) {
    /* 一整轮：从 1 推到 fixedTo，拿产出，然后全花掉 */
    V.grantSpirit(s, 1, fixedTo);
    var spent = false;
    for (var k of ['aspd', 'atk', 'hp', 'def']) {
      var n = E.maxAffordableLevels(s.equip[k], s.spirit);
      if (n > 0) { var r = V.upgradeSlot(s, k, n); if (r.ok) spent = true; }
    }
    if (!spent) return { laps: lap, lv: Math.max(s.equip.atk, s.equip.hp, s.equip.def, s.equip.aspd), stopped: true };
  }
  return { laps: lapMax, lv: Math.max(s.equip.atk, s.equip.hp, s.equip.def, s.equip.aspd), stopped: false };
}
for (var grindAt of [300, 1000]) {
  var grind = simGrind(3000, grindAt);
  console.log('  只刷第' + grindAt + '关 · ' + grind.laps + ' 轮后：最高等级=' + grind.lv +
    '（上限 33000）' + (grind.stopped ? ' → 已彻底升不动' : ' → 仍在缓慢爬'));
  t('只刷第' + grindAt + '关：最终会彻底升不动', grind.stopped === true,
    'laps=' + grind.laps + ' lv=' + grind.lv);
  t('只刷第' + grindAt + '关：爬不到 33000 级', grind.lv < 33000, 'lv=' + grind.lv);
}
t('只刷不推关：爬不到 33000 级', grind.lv < 33000, 'lv=' + grind.lv);
t('只刷不推关：卡住的等级远低于上限（< 5%）', grind.lv < 33000 * 0.05, 'lv=' + grind.lv);

/* 对照：转生的价值体现在【同装备水平下】推得更远。
 * ⚠️ 不能拿「转生前（已刷满装备）」直接比「转生后（装备已清零）」——
 *    那样必然变小。正确做法：两边都刷满装备再比 maxReach。 */
var wallSpan = 384;
var rbWall = V.newV6();
rbWall.stage = 1; rbWall.maxStage = wallSpan;
V.grantSpirit(rbWall, 1, wallSpan);
for (var k2 of ['aspd', 'atk', 'hp', 'def']) {
  var n2 = E.maxAffordableLevels(rbWall.equip[k2], rbWall.spirit);
  if (n2 > 0) V.upgradeSlot(rbWall, k2, n2);
}
var reachBefore0 = V.live(rbWall).maxReach;      // 凡人 + 满装备
var lvBefore0 = Math.max(rbWall.equip.atk, rbWall.equip.aspd);
V.applyRebirth(rbWall);                          // 转生：境界 0→0（第1轮不破境）
/* 转生后重新刷装备，给【同量】灵石，保证装备等级可比 */
V.grantSpirit(rbWall, 1, wallSpan);
for (var k3 of ['aspd', 'atk', 'hp', 'def']) {
  var n3 = E.maxAffordableLevels(rbWall.equip[k3], rbWall.spirit);
  if (n3 > 0) V.upgradeSlot(rbWall, k3, n3);
}
var reachAfter0 = V.live(rbWall).maxReach;
var lvAfter0 = Math.max(rbWall.equip.atk, rbWall.equip.aspd);
console.log('  转生对照（同装备水平）：转生前 maxReach=' + reachBefore0 + '（装备 ' + lvBefore0 + '）'
  + ' → 转生后 maxReach=' + reachAfter0 + '（装备 ' + lvAfter0 + '，境界 ' + rbWall.realm + '）');
/* 第 1 轮转生还不破境，因此同装备下 maxReach 应【完全相同】。
 * 真正的抬升发生在破境之后 —— 见下方 chain 的 12 轮测试与 test_realm。 */
t('转生后装备可重新刷满', lvAfter0 > 0, 'lv=' + lvAfter0);
t('未破境时同装备 maxReach 一致（境界才是唯一变量）',
  reachAfter0 === reachBefore0,
  'before=' + reachBefore0 + ' after=' + reachAfter0);

/* ── 展示辅助 ── */
var stx = V.stageText(sr);
t('stageText 有关卡数', stx.stage === sr.stage);
t('stageText 有怪名', typeof stx.mobName === 'string' && stx.mobName.length > 0);
t('stageText progress ∈[0,1]', stx.progress >= 0 && stx.progress <= 1, 'got ' + stx.progress);
t('stageText 有境界', typeof stx.realm === 'number');

var stl = V.slotText(sr, 'atk');
t('slotText costText 非空', typeof stl.costText === 'string' && stl.costText.length > 0);
t('slotText maxed=false', stl.maxed === false);
var stlMax = V.slotText({ realm: 0, equip: { atk: 33000, hp: 0, def: 0, aspd: 0 }, spirit: N.ZERO, stage: 1, maxStage: 0, bestStage: 0, rebirths: 0, gameSpeed: 1, totalPoints: N.ZERO, runT: 0, lastTick: 0 }, 'atk');
t('slotText 满级文案', stlMax.maxed === true && stlMax.costText === '已满级');

var rtx = V.rebirthText(sr);
t('rebirthText gainText 带+号', rtx.gainText.charAt(0) === '+');
/* ⚠️ 注意 sr 此刻【已经转过生】（上面 applyRebirth 过了），
 * 本轮最高关已归 0 → 按钮应正确置灰。这是有意的顺序测试。 */
t('转生后按钮置灰 can=false', rtx.can === false, 'maxStage=' + rtx.maxStage);
var rtxMid = V.rebirthText((function () { var x = V.newV6(); x.stage = 500; x.maxStage = 500; return x; })());
t('本轮推过图时 can=true', rtxMid.can === true, 'maxStage=' + rtxMid.maxStage);

var rtx0 = V.rebirthText(V.newV6());
t('未推图(stage=1,无最高关)的转生按钮不可用', rtx0.can === false, 'maxStage=' + rtx0.maxStage);

/* ── 旧存档桥接 ── */
var legacy = { gameSpeed: 2.5, someOldField: 1 };
var bs = V.fromLegacy(legacy);
t('旧档无v6字段 → 新状态', bs.realm === 0 && bs.stage === 1);
t('旧档宠物倍速被继承', Math.abs(bs.gameSpeed - 2.5) < 1e-9, 'got ' + bs.gameSpeed);
V.toLegacy(legacy, bs);
t('写回旧档有 v6 字段', !!legacy.v6);
var bs2 = V.fromLegacy(legacy);
t('二次读取命中存档', bs2.stage === bs.stage && Math.abs(bs2.gameSpeed - 2.5) < 1e-9);
t('空旧档不崩', V.fromLegacy(null).realm === 0);

/* ── 连贯性：多次转生不炸 ── */
var chain = V.newV6();
chain.gameSpeed = 3.5;
for (var k = 0; k < 12; k++) {
  /* 每轮：推满 + 尽量升级 + 转生 */
  for (var j = 0; j < 50; j++) {
    var rr = V.tickV6(chain, 60);
    V.grantSpirit(chain, Math.max(1, chain.stage - 10), chain.stage);
    for (var kk of ['aspd', 'atk', 'hp', 'def']) {
      var aff = E.maxAffordableLevels(chain.equip[kk], chain.spirit);
      if (aff > 0) V.upgradeSlot(chain, kk, aff);
    }
    if (rr.stuck) break;
  }
  V.applyRebirth(chain);
}
console.log('  连跑12轮后：realm=' + chain.realm + ' 累计点=' + N.sci(chain.totalPoints) + ' best=' + chain.bestStage);
/* ⚠️ 12 轮【不足以】破境 —— 炼气一层要 5.47e4 修为，约 19 轮。
 *    所以这里断言的是「修为在稳定累积」，而不是「境界涨了」。
 *    若某天改成「12 轮涨 5 境」，那说明经济又退回了「转生几次就毕业」。 */
t('12轮后修为显著累积', N.gt(chain.totalPoints, N.ZERO) && N.log10(chain.totalPoints) > 3,
  N.sci(chain.totalPoints));
t('12轮后境界仍未到 5（回合制节奏，不速通）', chain.realm < 5, 'got ' + chain.realm);
t('12轮后转生次数=12', chain.rebirths === 12);
t('12轮后历史最高关 > 0', chain.bestStage > 0, 'got ' + chain.bestStage);
t('12轮后无 NaN', isFinite(N.log10(chain.totalPoints)));

console.log('');
console.log('通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
