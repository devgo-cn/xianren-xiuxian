import * as N from '../src/00-num.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '  ' + (extra||'')); }
}

console.log('=== 大数层自测 ===');

t('from(1.234e79) 归一化', (function(){var a=N.from(1.234e79); return Math.abs(a.m-1.234)<1e-9 && a.e===79;})());
t('from(0) 为零', N.isZero(N.from(0)));
t('from(1000) -> m=1,e=3', (function(){var a=N.from(1000); return a.m===1&&a.e===3;})());

var big = N.from(1e79);
var sum = N.add(big, N.ONE);
t('1e79 + 1 量级不丢', sum.e === 79 && Math.abs(sum.m-1)<1e-6, 'got '+N.sci(sum));

var a1 = N.make(3, 79), a2 = N.make(4, 79);
var s2 = N.add(a1, a2);
t('3e79 + 4e79 = 7e79', s2.e===79 && Math.abs(s2.m-7)<1e-9, 'got '+N.sci(s2));

var m1 = N.mul(N.from(1e40), N.from(1e39));
t('1e40 x 1e39 = 1e79', m1.e===79 && Math.abs(m1.m-1)<1e-9, 'got '+N.sci(m1));

var g = N.from(1.006);
var p = N.pow(g, 30000);
var expectLog = 30000*Math.log10(1.006);
t('1.006^30000 量级正确', Math.abs(N.log10(p)-expectLog) < 0.01, 'got 1e'+N.log10(p).toFixed(2));

t('1e79 > 1e78', N.gt(N.from(1e79), N.from(1e78)));
t('1e79 > 5e78', N.gt(N.from(1e79), N.from(5e78)));
t('3e79 > 1e79', N.gt(N.make(3,79), N.make(1,79)));
t('1e79 == 1e79', N.eq(N.from(1e79), N.from(1e79)));
t('1e78 < 1e79', N.lt(N.from(1e78), N.from(1e79)));

var d1 = N.div(N.from(1e79), N.from(1e39));
t('1e79 / 1e39 = 1e40', d1.e===40 && Math.abs(d1.m-1)<1e-9, 'got '+N.sci(d1));

var val = N.from(1e79);
var stg = N.log10(val) / Math.log10(1.006);
t('1e79 对应关卡约 30000 级', Math.abs(stg-30200)<300, 'got '+stg.toFixed(0));

/* ── v7.10: 显示口径改为【中文万进单位】──
 * 以前这里断言 '1.23e52'，但那正是玩家看不懂的写法（"灵石显示科学计数不对吧"）。
 * 现在全游戏统一为 万/亿/兆/京/…/无量/大数，只有超出单位表才回退 e。 */
t('fmt(1.23e52) → 1.23恒河沙', N.fmt(N.make(1.23,52)) === '1.23恒河沙', 'got "'+N.fmt(N.make(1.23,52))+'"');
t('fmt(3250) 一万以下直接数字', N.fmt(N.make(3.25,3)) === '3250', 'got "'+N.fmt(N.make(3.25,3))+'"');
t('fmt(999) 不进单位', N.fmt(N.from(999)) === '999', 'got "'+N.fmt(N.from(999))+'"');
t('fmt(1000) 不再被误当成 1万', N.fmt(N.from(1000)) === '1000', 'got "'+N.fmt(N.from(1000))+'"');
t('fmt(416万) —— 实测反馈的那条读数', N.fmt(N.from(4.16e6)) === '416万', 'got "'+N.fmt(N.from(4.16e6))+'"');
t('fmt(12亿)', N.fmt(N.from(1.2e9)) === '12亿', 'got "'+N.fmt(N.from(1.2e9))+'"');
t('fmt(3.5兆)', N.fmt(N.from(3.5e12)) === '3.5兆', 'got "'+N.fmt(N.from(3.5e12))+'"');
t('fmt(7京)', N.fmt(N.from(7e16)) === '7京', 'got "'+N.fmt(N.from(7e16))+'"');
t('全程不再出现 e 记法', !/e[+\-]?\d/.test(N.fmt(N.from(1e72))), 'got "'+N.fmt(N.from(1e72))+'"');
t('单位单调递增且可读', (() => {
  const units = ['万','亿','兆','京','垓','秭','穰','沟','涧','正'];
  for (let i = 0; i < units.length; i++) {
    const v = N.from(Math.pow(10, 4 * (i + 1)));
    if (N.fmt(v) !== '1' + units[i]) return false;
  }
  return true;
})());
t('负号保留', N.fmt(N.from(-4.16e6)) === '-416万', 'got "'+N.fmt(N.from(-4.16e6))+'"');
t('fmt(0)', N.fmt(N.ZERO) === '0');

var small = N.add(N.from(3), N.from(4));
t('3+4=7', Math.abs(N.toNumber(small)-7)<1e-9);

/* ⚠️ 装备加成是【指数】(1+0.0003)^33000 ≈ 1.99e4，不是线性 1+0.0003×33000 = 10.9。
 * 这里验证大数层能正确承载指数运算，具体数值由 test_equip.mjs 断言。 */
var lin = N.add(N.ONE, N.mulNum(N.from(0.0003), 33000));
t('线性公式算得 10.9（已被淘汰，仅作对照）', Math.abs(N.toNumber(lin) - 10.9) < 1e-6, 'got ' + N.toNumber(lin));

var bonus = N.pow(N.from(1.0003), 33000);
console.log('  装备满级加成（指数）= ' + N.sci(bonus) + '；旧线性版 = 10.9');
t('指数加成 ≈ 1.99e4', Math.abs(N.log10(bonus) - Math.log10(Math.pow(1.0003, 33000))) < 1e-9,
  'got ' + N.sci(bonus));
t('指数加成 > 1000（远大于线性上限）', N.gt(bonus, N.from(1000)), 'got ' + N.sci(bonus));
t('大数 pow 不溢出（有限且量级正确）', isFinite(N.log10(bonus)) && Math.abs(N.log10(bonus) - 4.299) < 0.01,
  'log10=' + N.log10(bonus).toFixed(3));

console.log('');
console.log('通过 ' + pass + ' / ' + (pass+fail));
process.exit(fail ? 1 : 0);
