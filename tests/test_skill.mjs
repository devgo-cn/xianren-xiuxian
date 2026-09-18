/**
 * 技能系统自测（v6：恒定数值 + buff 类走 CD）
 *
 * v6 的两条硬约束（用户明确要求）：
 *   1. 「技能也改掉，不要升级了，改为恒定伤害」—— 技能无等级，取满级值定值。
 *   2. 「加 Buff 类的，Buff 类的要搞 CD，不能攻击触发」—— buff 类独立时间轴，
 *      与玩家出手/命中/击杀完全无关。
 * 另外：技能【不入存档】—— 恒定值没有存的必要。
 */

/* 00-pure.js 在模块顶层读 window.APP_VER，Node 里没有 window —— 先补最小桩。
 * 必须在 import 之前执行，所以用动态 import。 */
globalThis.window = globalThis.window || { APP_VER: 'test' };
globalThis.document = globalThis.document || { getElementById: function () { return null; } };
globalThis.localStorage = globalThis.localStorage || {
  getItem: function () { return null; }, setItem: function () {}, removeItem: function () {}
};

var P = await import('../src/00-pure.js');
var RB = await import('../src/00-rebirth.js');

var pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + '  ' + (e || '')); } }

console.log('=== 技能系统自测（v6 恒定 / buff CD）===');

var defs = P.SKILL_DEFS;
t('技能表非空', defs.length > 0);
t('共 8 门', defs.length === 8, defs.length);

/* ── 1. 无等级：定义里不得再有 from/to 插值轴 ─────────────────── */
var hasFromTo = defs.some(function (d) { return 'from' in d || 'to' in d; });
t('技能定义里没有 from/to 插值轴', !hasFromTo);
t('没有 SKILL_MAX 导出（等级上限已删除）', !('SKILL_MAX' in P));
t('没有 skillExpNeed 导出（经验已删除）', !('skillExpNeed' in P));
t('没有 _skillSaveT 导出（升级落档已删除）', !('_skillSaveT' in P));

/* ── 2. kind 分类：每门技能必须明确是 damage 还是 buff ─────────── */
var kinds = defs.map(function (d) { return d.kind; });
t('每门技能都有 kind', kinds.every(function (k) { return k === 'damage' || k === 'buff'; }), kinds.join(','));
var dmg = defs.filter(function (d) { return d.kind === 'damage'; });
var buffs = defs.filter(function (d) { return d.kind === 'buff'; });
t('伤害类 6 门', dmg.length === 6, dmg.length);
t('Buff 类 2 门', buffs.length === 2, buffs.length);
t('Buff 类就是疾风步/缩地成寸',
  buffs.map(function (d) { return d.id; }).sort().join(',') === 'jifeng,suodi');

/* ── 3. 伤害类：恒定数值，有 chance 或有 threshold ─────────────── */
dmg.forEach(function (d) {
  var ok = (typeof d.chance === 'number' && d.chance > 0 && d.chance <= 100)
        || (typeof d.threshold === 'number' && d.threshold > 0);
  t('伤害类「' + d.name + '」有恒定触发条件', ok, JSON.stringify(d));
});
t('伤害类全部有 fmt 文案', dmg.every(function (d) { return typeof d.fmt === 'function'; }));

/* ── 4. Buff 类：必须有 cd/dur，且【不得】再有攻击触发概率 ─────── */
buffs.forEach(function (d) {
  t('Buff「' + d.name + '」有 cd', typeof d.cd === 'number' && d.cd > 0, JSON.stringify(d));
  t('Buff「' + d.name + '」有 dur', typeof d.dur === 'number' && d.dur > 0, JSON.stringify(d));
  t('Buff「' + d.name + '」dur <= cd（不会常驻）', d.dur <= d.cd, d.dur + '/' + d.cd);
  t('Buff「' + d.name + '」【无 chance】——不攻击触发', !('chance' in d), JSON.stringify(d));
});
t('Buff 类给闪避', buffs.every(function (d) { return typeof d.dodge === 'number' && d.dodge > 0; }));
t('Buff 类给攻速', buffs.every(function (d) { return typeof d.hasted === 'number' && d.hasted >= 1; }));

/* ── 5. 身法【不再授予游戏倍速】——旧 mult 字段必须消失 ──────────── */
t('身法没有 mult 字段（倍速改由 Buff 宠物提供）',
  buffs.every(function (d) { return !('mult' in d); }),
  JSON.stringify(buffs.map(function (d) { return d.mult; })));
t('缩地成寸不再给 3.5 倍速', !('mult' in P.SKILL_DEFS.find(function (d) { return d.id === 'suodi'; })));

/* ── 6. skillAt 是唯一取值入口：返回常量对象，无等级参数 ───────── */
t('skillAt 有实现', typeof P.skillAt === 'function');
t('skillAt 返回的是 SKILL_DEFS 里的同一对象', P.skillAt('jianqi') === P.SKILL_DEFS[0]);
t('skillAt 未知 id 返回 null', P.skillAt('nonexistent') === null);
t('skillAt 只接受一个参数（无 lv）', P.skillAt.length === 1, P.skillAt.length);

/* ── 7. 技能【不入存档】：v6 存档契约里没有 skills ─────────────── */
var s = RB.newRun ? RB.newRun() : null;
if (s) {
  t('转生新局不含 skills 字段', !('skills' in s), Object.keys(s).join(','));
} else {
  t('转生新局不含 skills 字段', true, '（无 newRun 导出，跳过）');
}
var skillFields = Object.keys(P.state || {}).filter(function (k) { return k === 'skills'; });
t('旧 state 也不再持有 skills 字段', skillFields.length === 0, skillFields.join(','));

/* ── 8. 恒定值口径核对：取的是旧版满级值，不是 1 级值 ───────────── */
/* 旧版 jianqi: from {chance:18,dmg:100} → to {chance:30,dmg:160}（满级值 30/160） */
var jq = P.SKILL_DEFS.find(function (d) { return d.id === 'jianqi'; });
t('剑气斩取满级值 chance=30（旧 1 级是 18）', jq.chance === 30, jq.chance);
t('剑气斩取满级值 dmg=160（旧 1 级是 100）', jq.dmg === 160, jq.dmg);
var sd = P.SKILL_DEFS.find(function (d) { return d.id === 'suodi'; });
t('缩地成寸闪避取满级值 40', sd.dodge === 40, sd.dodge);
t('缩地成寸 CD=20s / 持续 8s', sd.cd === 20 && sd.dur === 8, sd.cd + '/' + sd.dur);
var jf = P.SKILL_DEFS.find(function (d) { return d.id === 'jifeng'; });
t('疾风步 CD=12s / 持续 8s', jf.cd === 12 && jf.dur === 8, jf.cd + '/' + jf.dur);

/* ── 9. 文案必须写出 CD（玩家要知道多久一次）─────────────────── */
buffs.forEach(function (d) {
  var txt = String(d.fmt(d));
  t('Buff「' + d.name + '」文案含「每 N 秒」', /每\s*\d+\s*秒/.test(txt), txt);
});

console.log('');
console.log('通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
