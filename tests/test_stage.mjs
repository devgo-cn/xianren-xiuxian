import * as N from '../src/00-num.js';
import * as S from '../src/00-stage.js';

var pass=0, fail=0;
function t(n, c, e){ if(c){pass++;console.log('  PASS '+n);} else {fail++;console.log('  FAIL '+n+'  '+(e||''));} }

console.log('=== 关卡系统自测 ===');

t('第1关 HP = 1.0055', Math.abs(N.toNumber(S.stageHp(1))-1.0055)<1e-9, 'got '+N.sci(S.stageHp(1)));
t('第2关 HP = 1.0055*1.006', Math.abs(N.toNumber(S.stageHp(2))-1.0055*1.006)<1e-9, 'got '+N.toNumber(S.stageHp(2)));

var h300 = S.stageHp(300);
console.log('  第300关 HP = ' + N.sci(h300));
t('第300关 量级合理 (1e1~1e2)', N.log10(h300) > 0.5 && N.log10(h300) < 2.5, 'log10='+N.log10(h300).toFixed(2));

var h30000 = S.stageHp(30000);
console.log('  第30000关 HP = ' + N.sci(h30000));
t('第30000关 量级 ~1e78', Math.abs(N.log10(h30000)-77.94) < 0.5, 'log10='+N.log10(h30000).toFixed(2));

// 反解一致性：stageHp(maxStageFor(P)) ≈ P
for (var e of [1,2,3,6,12,40,79]) {
  var P = N.from(Math.pow(10,e));
  var s = S.maxStageFor(P);
  var hpAtS = S.stageHp(Math.floor(s));
  var ratio = N.toNumber(N.div(hpAtS, P));
  t('反解一致 P=1e'+e+' -> 第'+s.toFixed(0)+'关 (hp/P='+ratio.toFixed(3)+')',
    ratio > 0.99 && ratio <= 1.006, 'ratio='+ratio);
}

t('canClear(第300关HP, 300) = true', S.canClear(S.stageHp(300), 300));
t('canClear(第300关HP, 301) = false', !S.canClear(S.stageHp(300), 301));

t('怪物循环绑定: 1 与 80 同怪 (79只循环)', S.mobFor(1) === S.mobFor(80));
t('怪物总数 79', S.MOB_SLUGS.length === 79, 'got '+S.MOB_SLUGS.length);

var info = S.stageInfo(1000);
t('stageInfo 结构完整', info.stage===1000 && info.slug && !info.isBoss);

t('stageLabel', S.stageLabel(123) === '第 123 / 30000 关', S.stageLabel(123));
t('isCleared(30000)', S.isCleared(30000));

console.log('');
console.log('通过 '+pass+' / '+(pass+fail));
process.exit(fail?1:0);
