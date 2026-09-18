import * as N from '../src/00-num.js';
import * as S from '../src/00-stage.js';
import * as E from '../src/00-equip.js';
import * as R from '../src/00-rebirth.js';

var pass=0, fail=0;
function t(n,c,e){ if(c){pass++;console.log('  PASS '+n);} else {fail++;console.log('  FAIL '+n+'  '+(e||''));} }

console.log('=== 转生系统自测 ===');

// 转生点
t('转生点(100关) = 10^1.5 = 31.6', Math.abs(N.toNumber(R.rebirthPoints(100))-31.62)<0.1, 'got '+N.toNumber(R.rebirthPoints(100)));
t('转生点(300关) = 30^1.5 = 164', Math.abs(N.toNumber(R.rebirthPoints(300))-164.3)<0.5, 'got '+N.toNumber(R.rebirthPoints(300)));
t('转生点(1000关) = 100^1.5 = 1000', Math.abs(N.toNumber(R.rebirthPoints(1000))-1000)<1, 'got '+N.toNumber(R.rebirthPoints(1000)));

// 境界成本
var c0 = R.realmCost(0), c1 = R.realmCost(1);
t('第0->1境成本 = 50', N.toNumber(c0)===50, 'got '+N.toNumber(c0));
t('第1->2境成本 = 100', N.toNumber(c1)===100, 'got '+N.toNumber(c1));
var cc10 = R.cumulativeCost(10);
t('累计到10境 = 50*(10*11/2) = 2750', Math.abs(N.toNumber(cc10)-2750)<1e-6, 'got '+N.toNumber(cc10));

// 约束1 验证：qc=1.0 时必须能持续涨境（不死循环）
console.log('  验证约束1（qc=1.0 < 1.5）：转生点 -> 境界数');
for (var s of [100, 300, 1000, 5000, 20000]) {
  var p = R.rebirthPoints(s);
  var rl = R.realmsFrom(p);
  console.log('    推到 '+s+' 关 -> 点 '+N.fmt(p)+' -> 境界 '+rl);
}
var r1 = R.realmsFrom(R.rebirthPoints(300));
var r2 = R.realmsFrom(R.rebirthPoints(1000));
var r3 = R.realmsFrom(R.rebirthPoints(5000));
t('境界随关卡单调递增', r1 < r2 && r2 < r3, r1+','+r2+','+r3);
t('关卡涨5倍境界涨超1倍(超线性)', r3 > r1*2, 'r1='+r1+' r3='+r3);

// 基础属性
t('第0境基础 = 10', N.toNumber(R.baseStat(0))===10);
t('第1境基础 = 22', Math.abs(N.toNumber(R.baseStat(1))-22)<1e-9, 'got '+N.toNumber(R.baseStat(1)));
var b10 = R.baseStat(10);
console.log('  第10境基础 = '+N.sci(b10));
t('第10境基础 = 10*2.2^10', Math.abs(N.log10(b10)-Math.log10(10*Math.pow(2.2,10)))<1e-9);

// 玩家面板
var ps = R.playerStats(0, E.newEquip());
t('0境0装备 面板 = 10', Math.abs(N.toNumber(ps.power)-10)<1e-9, 'got '+N.toNumber(ps.power));
var ps2 = R.playerStats(0, {atk:33000,hp:0,def:0,aspd:33000});
t('0境满装备 面板 = 10*10.9*10.9 = 1188', Math.abs(N.toNumber(ps2.power)-10*10.9*10.9)<1e-6, 'got '+N.toNumber(ps2.power));

// 推关速率（约束2）
t('速率(1.0, 1.0) = 1', R.pushRate(1,1)===1);
t('速率(3.5, 10.9) = 38.15', Math.abs(R.pushRate(3.5,10.9)-38.15)<1e-9, 'got '+R.pushRate(3.5,10.9));
t('速率上限封顶', Math.abs(R.pushRate(99,99)-3.5*10.9)<1e-9, 'got '+R.pushRate(99,99));

// 双乘区等价性（设计文档 §7）
t('倍速x2 == 攻速x2 (数学对等)', Math.abs(R.pushRate(2,1)-R.pushRate(1,2))<1e-9);

// 完整轮回：第1轮应推到 ~385 关
var st = R.newState();
var life = R.runOneLife(st);
console.log('  第1轮（0境0装备）推到 '+life.reached+' 关');
t('第1轮推到 380~390 关', life.reached>=380 && life.reached<=390, 'got '+life.reached);

// 转生
var reb = R.doRebirth({...st, stage: life.reached, maxStage: life.reached});
console.log('  转生获得 '+N.fmt(reb.gainedPoints)+' 点 -> 境界 '+reb.newRealms+' (+'+reb.realmGain+')');
t('转生后装备清零', E.SLOT_KEYS.every(function(k){return reb.state.equip[k]===0;}));
t('转生后灵石清零', N.isZero(reb.state.spirit));
t('转生后关数归1', reb.state.stage===1);
t('转生次数+1', reb.state.rebirths===1);
t('境界提升', reb.newRealms > 0, 'realm='+reb.newRealms);
t('累计点数保留', !N.isZero(reb.state.totalPoints));

// 多轮循环：验证收敛（不发散成死循环，也不爆炸）
console.log('');
console.log('  多轮循环推演：');
var s2 = R.newState();
var prev = 0;
for (var i=0;i<12;i++){
  var lf = R.runOneLife(s2);
  var rb = R.doRebirth({...s2, stage: lf.reached, maxStage: lf.reached});
  console.log('    第'+(i+1)+'轮: 推到 '+lf.reached+' 关 -> 境界 '+rb.newRealms+' (+'+rb.realmGain+')');
  s2 = rb.state;
  if (lf.reached >= 30000) { console.log('    -> 通关!'); break; }
  prev = lf.reached;
}
t('多轮循环不卡死（境界持续增长）', s2.realm > 5, 'realm='+s2.realm);

console.log('');
console.log('通过 '+pass+' / '+(pass+fail));
process.exit(fail?1:0);
