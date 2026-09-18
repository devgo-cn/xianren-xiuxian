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

t('fmt(1.23e52)', N.fmt(N.make(1.23,52)) === '1.23e52', 'got "'+N.fmt(N.make(1.23,52))+'"');
t('fmt(3250) 含万', N.fmt(N.make(3.25,3)).indexOf('万')>=0, 'got "'+N.fmt(N.make(3.25,3))+'"');
t('fmt(0)', N.fmt(N.ZERO) === '0');

var small = N.add(N.from(3), N.from(4));
t('3+4=7', Math.abs(N.toNumber(small)-7)<1e-9);

var bonus = N.add(N.ONE, N.mulNum(N.from(0.0003), 33000));
t('装备满级加成 10.9', Math.abs(N.toNumber(bonus)-10.9)<1e-6, 'got '+N.toNumber(bonus));

console.log('');
console.log('通过 ' + pass + ' / ' + (pass+fail));
process.exit(fail ? 1 : 0);
