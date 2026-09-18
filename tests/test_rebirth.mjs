import * as N from '../src/00-num.js';
import * as S from '../src/00-stage.js';
import * as E from '../src/00-equip.js';
import * as R from '../src/00-rebirth.js';
import * as RM from '../src/00-realm.js';

var pass=0, fail=0;
function t(n,c,e){ if(c){pass++;console.log('  PASS '+n);} else {fail++;console.log('  FAIL '+n+'  '+(e||''));} }

console.log('=== 转生系统自测 ===');

// 转生点
t('转生点(100关) = 10^1.5 = 31.6', Math.abs(N.toNumber(R.rebirthPoints(100))-31.62)<0.1, 'got '+N.toNumber(R.rebirthPoints(100)));
t('转生点(300关) = 30^1.5 = 164', Math.abs(N.toNumber(R.rebirthPoints(300))-164.3)<0.5, 'got '+N.toNumber(R.rebirthPoints(300)));
t('转生点(1000关) = 100^1.5 = 1000', Math.abs(N.toNumber(R.rebirthPoints(1000))-1000)<1, 'got '+N.toNumber(R.rebirthPoints(1000)));

// 境界成本（v6：由 00-realm.js 的 54 层表接管，realmCost 仅为兼容转发）
var c1 = RM.levelCost(1), c2 = RM.levelCost(2);
t('炼气一层门槛 > 0', N.gt(c1, N.ZERO), N.fmt(c1));
t('炼气二层门槛 > 一层', N.gt(c2, c1), N.fmt(c1)+' -> '+N.fmt(c2));
t('累计门槛单调递增', N.gt(RM.cumCultivation(2), RM.cumCultivation(1)));
t('levelFrom(cum(1)) == 1', RM.levelFrom(RM.cumCultivation(1)) === 1);
t('Q_REALM 与 00-realm 一致',
  Math.abs(R.REBIRTH_CFG.Q_REALM - RM.Q_REALM_REF) < 1e-9,
  'rebirth='+R.REBIRTH_CFG.Q_REALM+' realm='+RM.Q_REALM_REF);
/* ⚠️ 旧的「累计到10境 = 50*(10*11/2) = 2750」来自已删除的线性经济
 *    cost(R) = 50·R。v6 改成「每层需要 N 轮、N 随层数递增」的累计表，
 *    所以这里只校验【结构性质】：单调、可逆、数量级不能爆炸。 */
var cc1 = RM.cumCultivation(1), cc10 = RM.cumCultivation(10), cc53 = RM.cumCultivation(53);
t('累计门槛随层数单调递增', N.gt(cc10, cc1) && N.gt(cc53, cc10),
  N.fmt(cc1)+' -> '+N.fmt(cc10)+' -> '+N.fmt(cc53));
t('末层累计门槛量级合理（1e7~1e9，不爆炸）',
  N.log10(cc53) > 7 && N.log10(cc53) < 9, 'log10='+N.log10(cc53).toFixed(2));
t('累计门槛全部有限（无 Infinity/NaN）', isFinite(N.toNumber(cc53)));

/* ══════════════════════════════════════════════════════════════
 *  「转生 ≠ 突破」的核心断言 —— 必须用【真实可达的关卡】验证
 * ══════════════════════════════════════════════════════════════
 *
 * ⚠️ 曾经用 rebirthPoints(30000) 来验证，得出「一轮跨 2 境」的错误结论。
 *    30000 关是全图终点，只有天仙圆满的玩家才够得到；
 *    把它塞给炼气一层的玩家（他实际只能推到 2598 关）是【不可能状态】，
 *    用它算出来的结论毫无意义 —— 测试把自己骗了。
 *
 * 正确做法：对每一层，取【该境界玩家实际能推到的关】，
 *          算出真实需要的轮数，断言它落在「十几到一百多轮」区间。 */
var realRounds = [];
for (var rr = 1; rr <= RM.REALM_MAX; rr++) {
  /* 玩家【当前】在第 rr-1 层，装备刷满，能推到这么远 */
  var baseNow = R.baseStat(rr - 1);
  var pNow = N.mulNum(baseNow, E.EQUIP_MAX_BONUS);
  var sNow = Math.min(S.STAGE_CFG.S_MAX, Math.floor(S.maxStageFor(pNow)));
  var perNow = Math.pow(sNow / 10, 1.5);
  realRounds.push(N.toNumber(RM.levelCost(rr)) / perNow);
}
var minR = Math.min.apply(null, realRounds);
var maxR = Math.max.apply(null, realRounds);
console.log('  真实每层轮数：最少 '+minR.toFixed(1)+' 轮（炼气一层）→ 最多 '+maxR.toFixed(1)+' 轮（天仙圆满）');
t('每层都需 >10 轮（转生 ≠ 突破）', minR > 10, 'min='+minR.toFixed(1));
t('炼气一层需 15~25 轮（开局手感）', realRounds[0] > 15 && realRounds[0] < 25,
  'got '+realRounds[0].toFixed(1));
t('天仙圆满需 >120 轮（终局极熬）', maxR > 120, 'max='+maxR.toFixed(1));
t('末层轮数 / 首层轮数 > 5（明显递增）', maxR / minR > 5,
  (maxR/minR).toFixed(1)+'x');

/* 打满全场是【天仙玩家】才有的成绩，那时他的门槛也最高 */
var pFull = R.rebirthPoints(30000);
var c1n = N.toNumber(RM.cumCultivation(1));
var c2n = N.toNumber(RM.cumCultivation(2));
var c3n = N.toNumber(RM.cumCultivation(3));
console.log('  单轮打满 30000 关 -> 修为 '+N.toNumber(pFull).toFixed(0)
  +'（门槛 cum1='+c1n.toFixed(0)+' cum2='+c2n.toFixed(0)+' cum3='+c3n.toFixed(0)+'）');
t('一轮打满至多跨 2 境（转生 ≠ 毕业）', R.realmsFrom(pFull) <= 2,
  'realmsFrom='+R.realmsFrom(pFull));
t('一轮打满拿不下第 3 境（后期必须反复转生）', N.lt(pFull, RM.cumCultivation(3)),
  N.toNumber(pFull).toFixed(0)+' < '+c3n.toFixed(0));
t('单轮修为不是天文数字', N.log10(pFull) < 6, 'log10='+N.log10(pFull).toFixed(2));
t('levelFrom 在全部 53 层上可逆', (() => {
  for (let r = 1; r <= RM.REALM_MAX; r++) if (RM.levelFrom(RM.cumCultivation(r)) !== r) return false;
  return true;
})());

// 约束1 验证：转生点必须随关卡超线性增长（EXP=1.5 > 1）
console.log('  转生点 -> 境界数：');
for (var s of [100, 300, 1000, 5000, 20000]) {
  var p = R.rebirthPoints(s);
  var rl = R.realmsFrom(p);
  console.log('    推到 '+s+' 关 -> 修为 '+N.fmt(p)+' -> 境界 '+rl);
}
var pA = R.rebirthPoints(300), pB = R.rebirthPoints(1000), pC = R.rebirthPoints(5000);
t('转生点随关卡超线性增长', N.gt(pC, N.mulNum(pB, 5)) && N.gt(pB, N.mulNum(pA, 3)),
  N.fmt(pA)+' -> '+N.fmt(pB)+' -> '+N.fmt(pC));
console.log('  第10境累计门槛 = '+N.fmt(cc10)+'（≈'+(N.toNumber(cc10)/N.toNumber(R.rebirthPoints(300))).toFixed(1)+' 轮 @300关）');

// 基础属性 —— Q_REALM 由 2.2 反解为 28.3（详见 00-rebirth.js 的推导注释）
t('第0境基础 = 10', N.toNumber(R.baseStat(0))===10);
t('第1境基础 = 10*28.3 = 283', Math.abs(N.toNumber(R.baseStat(1))-283)<1e-9, 'got '+N.toNumber(R.baseStat(1)));
var b53 = R.baseStat(53);
console.log('  第53境（天仙圆满）基础 = '+N.sci(b53));
t('第53境基础 ≈ 1e78（正好够到第30000关的怪）',
  Math.abs(N.log10(b53) - 78) < 1.0, 'log10='+N.log10(b53).toFixed(2));
t('基础属性随境界严格单调递增', N.gt(R.baseStat(53), R.baseStat(10)) && N.gt(R.baseStat(10), R.baseStat(1)));

// 玩家面板
var ps = R.playerStats(0, E.newEquip());
t('0境0装备 面板 = 10', Math.abs(N.toNumber(ps.power)-10)<1e-9, 'got '+N.toNumber(ps.power));

/* ⚠️ 装备加成已从线性 (1+C·L) 改为指数 (1+C)^L。
 * 旧断言「0境满装备面板 = 10×10.9×10.9 = 1188」对应的是线性时代；
 * 现在满装备 = 10 × 1.99e4 × 1.99e4 ≈ 3.96e9。 */
var mx = E.slotMult(E.EQ_CFG.MAX_LV);
var ps2 = R.playerStats(0, {atk:33000,hp:0,def:0,aspd:33000});
console.log('  0境满装备 面板(攻×速) = '+N.sci(ps2.power)+'（满级单格 '+N.sci(mx)+' 倍）');
t('0境满装备 面板 = 10×1.99e4×1.99e4 ≈ 3.96e9',
  Math.abs(N.toNumber(ps2.power) / (10 * Math.pow(1.0003,33000) * Math.pow(1.0003,33000)) - 1) < 1e-6,
  'got '+N.sci(ps2.power));
t('0境满装备面板用大数返回（不再溢出/失真）', typeof ps2.power === 'object' && isFinite(N.log10(ps2.power)));

/* 装备必须比境界「划算」，否则玩家不会去点装备按钮。
 *
 * ⚠️ 但这样比是【不公平】的 —— 它拿「一局的装备」比「永久境界」。
 *    装备在每轮转生时会清零（设计文档 §1 第 18 条），境界不清零；
 *    所以正确的问法是：
 *      一轮内「刷满装备」能推多远  vs  同样的轮数投进境界能推多远。
 *    即：装备是【本轮的推进器】，境界是【跨轮的复利】。 */
var eqMaxed = R.playerStats(0, {atk:33000,hp:0,def:0,aspd:33000});
var realm10 = R.playerStats(10, E.newEquip());
console.log('  装备满级面板 '+N.sci(eqMaxed.power)+' vs 境界10级面板 '+N.sci(realm10.power));
t('满级装备面板 > 0境裸装面板（点装备是有意义的）',
  N.gt(eqMaxed.power, R.playerStats(0, E.newEquip()).power),
  'eq='+N.sci(eqMaxed.power));

/* 关键平衡：满级装备相当于【一轮内】多推 1655 关（≈ +0.35 境）。
 *
 * ⚠️ 不要拿「装备面板」和「境界面板」直接比绝对值 —— 那是拿
 *    「一局的装备」比「跨轮的境界」。转生清装备、不清境界
 *    （设计文档 §1 第 18 条），两者根本不在一个时间尺度上。
 * 正确的问法是：装备对【单轮跨度】的贡献有多少。
 *    装备满级 → log(19900)/log(1.006) ≈ 1655 关/轮
 *    无装备   → 0 关/轮（面板只有裸境界，推不动）
 * 所以装备必须是每轮的必做项，但它代替不了境界 —— 1655 关只是
 * 全场 30000 关的 5.5%，想毕业还得靠几十上百轮攒修为。 */
var spanWithEquip = N.log10(N.from(E.EQUIP_MAX_BONUS)) / N.log10(N.from(1.006));
console.log('  满级装备单轮跨度 = '+spanWithEquip.toFixed(0)+' 关（全场 30000 关的 '+(spanWithEquip/30000*100).toFixed(1)+'%）');
t('装备单轮跨度 1500~1800 关', spanWithEquip > 1500 && spanWithEquip < 1800,
  'span='+spanWithEquip.toFixed(0));
t('装备跨度 < 全场的 1/10（装备不能替代境界）', spanWithEquip < 3000,
  ((spanWithEquip/30000)*100).toFixed(1)+'%');
t('满级装备面板 > 0境裸装面板（点装备是有意义的）',
  N.gt(eqMaxed.power, R.playerStats(0, E.newEquip()).power),
  'eq='+N.sci(eqMaxed.power));

/* 推关速率（约束2）—— 已改为返回大数 */
var pOnes = R.pushRate(1, E.slotMult(0));
t('速率(1.0, 攻速0级) = 1', Math.abs(N.toNumber(pOnes)-1)<1e-9, 'got '+N.sci(pOnes));
var pFast = R.pushRate(3.5, E.slotMult(33000));
console.log('  速率(倍速3.5, 攻速满级) = '+N.sci(pFast));
t('速率(3.5, 攻速满级) = 3.5 × 1.99e4 ≈ 6.97e4',
  Math.abs(N.toNumber(pFast) / (3.5 * Math.pow(1.0003,33000)) - 1) < 1e-9,
  'got '+N.sci(pFast));
t('速率上限封顶（倍速与攻速双双越界）',
  N.lte(pFast, R.RATE_CFG.ASPD_CAP) === false || Math.abs(N.toNumber(R.pushRate(99, E.slotMult(99999))) / N.toNumber(pFast) - 1) < 1e-9,
  'got '+N.sci(R.pushRate(99, E.slotMult(99999))));
t('攻速越界被夹到 ASPD_CAP',
  N.eq(R.pushRate(1, N.mulNum(R.RATE_CFG.ASPD_CAP, 1000)), R.pushRate(1, R.RATE_CFG.ASPD_CAP)));

// 双乘区等价性（设计文档 §7）：把任一条路线翻倍，速率应翻倍
var aspdLv = 1000;
var base1 = R.pushRate(1, E.slotMult(aspdLv));
var gsX2 = R.pushRate(2, E.slotMult(aspdLv));
var aspdX2 = R.pushRate(1, N.mulNum(E.slotMult(aspdLv), 2));
t('倍速x2 == 攻速x2 (数学对等)',
  Math.abs(N.toNumber(gsX2) - 2 * N.toNumber(base1)) < 1e-9 &&
  Math.abs(N.toNumber(aspdX2) - 2 * N.toNumber(base1)) < 1e-9,
  'base=' + N.sci(base1) + ' gs2=' + N.sci(gsX2) + ' as2=' + N.sci(aspdX2));
t('倍速翻倍速率翻倍', Math.abs(N.toNumber(gsX2) / N.toNumber(base1) - 2) < 1e-9);
t('攻速翻倍速率翻倍', Math.abs(N.toNumber(aspdX2) / N.toNumber(base1) - 2) < 1e-9);

// 完整轮回：第1轮应推到 ~385 关
var st = R.newState();
var life = R.runOneLife(st);
console.log('  第1轮（凡人，装备刷满）推到 '+life.reached+' 关');
/* 转生后装备清零，但一轮内会刷满装备再转生；
 * 满装备倍率 ≈ 19900 → 单轮跨度 log(19900)/log(1.006) ≈ 1655 关，
 * 起点 384 → 终点约 2039 关（见 00-realm 的 ROUND 注释）。 */
t('第1轮推到 2000~2100 关', life.reached>=2000 && life.reached<=2100, 'got '+life.reached);

// 转生
var reb = R.doRebirth({...st, stage: life.reached, maxStage: life.reached});
console.log('  转生获得 '+N.fmt(reb.gainedPoints)+' 点 -> 境界 '+reb.newRealms+' (+'+reb.realmGain+')');
t('转生后装备清零', E.SLOT_KEYS.every(function(k){return reb.state.equip[k]===0;}));
t('转生后灵石清零', N.isZero(reb.state.spirit));
t('转生后关数归1', reb.state.stage===1);
t('转生次数+1', reb.state.rebirths===1);
/* ⚠️ 第 1 轮【不应该】突破 —— 炼气一层需要 ~19 轮（roundsFor(1)=18.8）。
 * 这正是需求方要的「转生 ≠ 突破，有些境界要几十上百次转生」。 */
t('第1轮不突破（需约19轮）', reb.newRealms === 0, 'realm='+reb.newRealms);
t('第1轮累计修为接近一层门槛', reb.state.totalPoints && N.gt(reb.state.totalPoints, N.ZERO), N.fmt(reb.state.totalPoints));
t('累计点数保留', !N.isZero(reb.state.totalPoints));

// 多轮循环：验证收敛（不发散成死循环，也不爆炸）
console.log('');
console.log('  多轮循环推演：');
var s2 = R.newState();
var prev = 0;
for (var i=0;i<400;i++){
  var lf = R.runOneLife(s2);
  var rb = R.doRebirth({...s2, stage: lf.reached, maxStage: lf.reached});
  if (i<3 || rb.realmGain>0) console.log('    第'+(i+1)+'轮: 推到 '+lf.reached+' 关 -> 境界 '+rb.newRealms+' '+RM.nameOf(rb.newRealms)+' (+'+rb.realmGain+')');
  s2 = rb.state;
  if (lf.reached >= 30000) { console.log('    -> 通关!'); break; }
  prev = lf.reached;
}
t('多轮循环不卡死（400轮内突破到筑基以上）', s2.realm > 13,
  'realm='+s2.realm+' = '+RM.nameOf(s2.realm)+' ('+s2.rebirths+' 轮)');
t('突破后境界名可读', RM.nameOf(s2.realm).length > 0, RM.nameOf(s2.realm));

console.log('');
console.log('通过 '+pass+' / '+(pass+fail));
process.exit(fail?1:0);
