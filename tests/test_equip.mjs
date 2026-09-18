import * as N from '../src/00-num.js';
import * as E from '../src/00-equip.js';

var pass=0, fail=0;
function t(n,c,e){ if(c){pass++;console.log('  PASS '+n);} else {fail++;console.log('  FAIL '+n+'  '+(e||''));} }

console.log('=== 装备系统自测 ===');

var eq = E.newEquip();
t('空装备四格为0', E.SLOT_KEYS.every(function(k){return eq[k]===0;}));
t('4 个格子', E.SLOTS.length===4);
t('格子顺序 攻/血/防/速', E.SLOT_KEYS.join(',')==='atk,hp,def,aspd', E.SLOT_KEYS.join(','));

t('0级加成 = 1.0', E.slotMult(0)===1);
t('满级加成 = 10.9', Math.abs(E.slotMult(33000)-10.9)<1e-9, 'got '+E.slotMult(33000));
t('超出上限被夹', Math.abs(E.slotMult(99999)-10.9)<1e-9, 'got '+E.slotMult(99999));

var bonus = E.equipBonus({atk:33000,hp:1000,def:0,aspd:33000});
t('equipBonus 结构', Math.abs(bonus.atk-10.9)<1e-9 && Math.abs(bonus.def-1)<1e-9);

// 消耗
var c0 = E.levelCost(0);
t('0级升1级消耗 = 10', N.toNumber(c0)===10, 'got '+N.toNumber(c0));
var c100 = E.levelCost(100);
console.log('  100级升1级消耗 = '+N.sci(c100));
t('消耗随等级增长', N.gt(c100, c0));

var cU = E.upgradeCost(0, 10);
console.log('  0->10级总消耗 = '+N.sci(cU));
t('升级10级消耗 = 等比求和', Math.abs(N.toNumber(cU) - 10*(Math.pow(1.05,10)-1)/0.05) < 1e-6, 'got '+N.toNumber(cU));

var cU2 = E.upgradeCost(0, 10000);
console.log('  0->10000级总消耗 = '+N.sci(cU2));
t('大步长不卡死（闭式公式）', N.log10(cU2) > 200, 'log10='+N.log10(cU2).toFixed(1));

// 升级
var r1 = E.tryUpgrade(E.newEquip(), N.from(1000), 'atk', 10);
t('灵石充足可升10级', r1.ok && r1.gained===10, JSON.stringify(r1.reason));
t('升级后等级正确', r1.equip.atk===10);
t('扣灵石正确', Math.abs(N.toNumber(r1.spirit) - (1000 - N.toNumber(cU))) < 1e-6);

var r2 = E.tryUpgrade(E.newEquip(), N.from(5), 'hp', 10);
t('灵石不足降级购买', !r2.ok || r2.gained < 10, 'gained='+r2.gained+' reason='+r2.reason);
t('灵石不足时不给负数', !N.isNeg(r2.spirit));

var r3 = E.tryUpgrade(E.newEquip(), N.from(0), 'def', 1);
t('零灵石不升级', !r3.ok && r3.gained===0);

var maxed = E.normEquip({atk:33000});
var r4 = E.tryUpgrade(maxed, N.from(1e300), 'atk', 1);
t('满级不再升', !r4.ok && r4.reason==='max_level');

// maxAffordableLevels 反解正确性
var bigSpirit = N.pow(N.from(10), 500);
var aff = E.maxAffordableLevels(0, bigSpirit);
var costAff = E.upgradeCost(0, aff);
var costMore = E.upgradeCost(0, aff+1);
t('maxAffordableLevels 反解: 买得起 '+aff+' 级', N.lte(costAff, bigSpirit), 'cost='+N.sci(costAff));
t('maxAffordableLevels 反解: 买不起 '+(aff+1)+' 级', N.gt(costMore, bigSpirit), 'cost='+N.sci(costMore));

// 步长档位
t('步长档位 1/10/100/1000/10000', E.EQ_CFG.STEPS.join(',')==='1,10,100,1000,10000');

// 大数场景：33000 级满级需要的总灵石
var total = E.upgradeCost(0, 33000);
console.log('  0->33000级总灵石 = '+N.sci(total));
t('满级总消耗量级合理 (1e680+)', N.log10(total) > 600, 'log10='+N.log10(total).toFixed(0));

console.log('');
console.log('通过 '+pass+' / '+(pass+fail));
process.exit(fail?1:0);
