/**
 * 擂台化战斗自测（v7.9）
 *
 * 覆盖用户这次提的四条硬要求里的前两条：
 *   ① 打完一关就重置地图和血量
 *   ② 出生点在屏幕左侧 / 角色从左往右跑 / 怪从屏幕右边生成
 *      —— 且所有坐标按【手机尺度】生成，不得随 PC 宽屏一起放大
 *
 * ⚠️ 50-battle.js 是模块加载即初始化的 IIFE（要 window/document/PIXI），
 *    Node 里没法直接 import。所以这里用两段手段：
 *     A) 纯数学部分：把 ARENA 常量块从源码里抽出来 new Function 求值 —— 测的是真代码，不是复制品；
 *        CW 由外部注入，用来对比「手机宽度」与「PC 宽屏」两套布局。
 *     B) 结构与行为部分：对关键函数体做源码级断言，防止有人把相机跟拍 / 一条血打到底改回来。
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

var pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + '  ' + (e || '')); } }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BATTLE = readFileSync(join(ROOT, 'src', '50-battle.js'), 'utf8');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const V6UI = readFileSync(join(ROOT, 'src', '06-v6ui.js'), 'utf8');

console.log('=== 擂台化战斗自测 (v7.9) ===');

/* ── 抽出 ARENA 常量块 + 四个布局函数：注入 CW，得到该宽度下的真实布局 ── */
const arenaSrc = BATTLE.match(/const ARENA = \{[\s\S]*?function enemySpawnX\(\)[^\n]*\n/);
t('源码中存在 ARENA 擂台常量块', !!arenaSrc);
const layout = (cw) => new Function('CW', arenaSrc[0] + '\nreturn {ARENA, arenaW, arenaLeft, playerSpawnX, enemySpawnX};')(cw);

/* ── 从 BC 里抠出移速/攻距，避免测试里写死数字 ── */
/** 去掉注释再断言结构：源码里那几段「为什么这么改」的长注释会提到被删掉的老写法 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const num = (key) => parseFloat(BATTLE.match(new RegExp(key + ':\\s*(-?[\\d.]+)'))[1]);
const SPEED = num('playerSpeed');
const ATKRANGE = num('playerAtkRange');
console.log('  读取常量: playerSpeed=' + SPEED + 'px/s  playerAtkRange=' + ATKRANGE + 'px');

/* ────────────────────────────────────────────────────────────
 * 1. 手机尺度：擂台即整屏，出生点左、怪在右
 * ──────────────────────────────────────────────────────────── */
console.log('');
console.log('-- 手机宽度：arenaW === CW --');
const PHONES = [320, 360, 375, 390, 412, 414, 428, 520];
for (const cw of PHONES) {
  const L = layout(cw);
  t('CW=' + cw + ' 擂台宽=整屏', L.arenaW() === cw, 'got ' + L.arenaW());
  t('CW=' + cw + ' 擂台左边=0（不居中）', L.arenaLeft() === 0, 'got ' + L.arenaLeft());
  t('CW=' + cw + ' 玩家出生在 16%', Math.abs(L.playerSpawnX() - cw * 0.16) < 1e-9, 'got ' + L.playerSpawnX().toFixed(1));
  t('CW=' + cw + ' 怪物出生在 76%', Math.abs(L.enemySpawnX() - cw * 0.76) < 1e-9, 'got ' + L.enemySpawnX().toFixed(1));
  t('CW=' + cw + ' 玩家在左、怪在右', L.playerSpawnX() < L.enemySpawnX());
  t('CW=' + cw + ' 两者都在屏内', L.playerSpawnX() >= 0 && L.enemySpawnX() <= cw);
}

/* ────────────────────────────────────────────────────────────
 * 2. PC 宽屏：擂台锁 520 并居中 —— 「不要以 PC 浏览器的宽屏去生成」
 *    这条是整个改动的关键，手机 = 整屏，宽屏 = 固定的 520 擂台居中。
 * ──────────────────────────────────────────────────────────── */
console.log('');
console.log('-- PC 宽屏：擂台锁 MAX_W 并居中，坐标不随宽屏放大 --');
const WIDES = [540, 640, 768, 1024, 1280, 1440, 1920, 2560];
for (const cw of WIDES) {
  const L = layout(cw);
  const base = layout(L.ARENA.MAX_W);
  t('CW=' + cw + ' 擂台宽封顶 ' + L.ARENA.MAX_W, L.arenaW() === L.ARENA.MAX_W, 'got ' + L.arenaW());
  t('CW=' + cw + ' 擂台居中 left=(CW-W)/2', Math.abs(L.arenaLeft() - (cw - L.ARENA.MAX_W) / 2) < 1e-9);
  /* 绝对 x 会因居中而平移，但【擂台内相对坐标】必须与 CW=520 完全相同 —— 这才是「iPhone 与
     桌面浏览器手感一致」的真正判据：玩家在擂台里要走的路程不随浏览器宽度变化。 */
  t('CW=' + cw + ' 擂台内相对布局与 CW=520 一致',
    Math.abs((L.playerSpawnX() - L.arenaLeft()) - base.playerSpawnX()) < 1e-9 &&
    Math.abs((L.enemySpawnX() - L.arenaLeft()) - base.enemySpawnX()) < 1e-9);
}
t('MAX_W 是手机上限（≥主流手机宽）', layout(1920).ARENA.MAX_W >= 428, 'MAX_W=' + layout(1920).ARENA.MAX_W);
t('arenaLeft 随 CW 单调不减', layout(520).arenaLeft() <= layout(768).arenaLeft() &&
  layout(768).arenaLeft() <= layout(1920).arenaLeft());

/* ────────────────────────────────────────────────────────────
 * 3. 「不要走半天」：横向奔袭距离/耗时必须与屏幕宽度无关
 * ──────────────────────────────────────────────────────────── */
console.log('');
console.log('-- 接敌距离：任何屏宽下一致且够短 --');
/** 玩家要走到能砍到怪的位置，还要扣掉双方体型；这里按犹卒半宽 30 估算 */
const reach = (cw) => {
  const L = layout(cw);
  return (L.enemySpawnX() - L.playerSpawnX()) - ATKRANGE - 30;
};
const dRef = reach(390);
console.log('  参考值 CW=390：奔袭 ' + dRef.toFixed(1) + 'px，' + (dRef / SPEED).toFixed(2) + 's（' + (dRef / (SPEED * 3.5)).toFixed(2) + 's @ ×3.5 倍速）');
t('参考奔袭距离为正（怪在攻击范围外）', dRef > 0, 'got ' + dRef.toFixed(1));
for (const cw of PHONES.concat(WIDES)) {
  const d = reach(cw);
  t('CW=' + cw + ' 奔袭距离 ≤ 240px', d <= 240, 'got ' + d.toFixed(1) + 'px');
  t('CW=' + cw + ' 满倍速接敌 < 3s', d / (SPEED * 3.5) < 3, 'got ' + (d / (SPEED * 3.5)).toFixed(2) + 's');
  t('CW=' + cw + ' 基础移速接敌 < 8s', d / SPEED < 8, 'got ' + (d / SPEED).toFixed(2) + 's');
}
/* 反证：旧写法（比例直接乘 CW）在 1920 宽屏上会怎样 */
t('【回归防线】若按 CW 直接取比例，1920 屏奔袭会超过 1000px',
  (1920 * 0.6 - ATKRANGE - 30) > 1000, '对比 ' + (1920 * 0.6 - ATKRANGE - 30).toFixed(0) + 'px');

/* ────────────────────────────────────────────────────────────
 * 4. 相机不再跟随（用户追加确认：对，相机不需要跟随玩家了）
 * ──────────────────────────────────────────────────────────── */
console.log('');
console.log('-- 相机锁定 --');
const camBody = BATTLE.match(/function updateCamera\([^)]*\)\s*\{[\s\S]*?\n  \}/);
t('存在 updateCamera', !!camBody);
if (camBody) {
  const body = stripComments(camBody[0]);
  t('updateCamera 赋值为常数 0', /G\.camX\s*=\s*0\s*;/.test(body), body.replace(/\s+/g, ' ').slice(0, 120));
  t('updateCamera 不再做累加式跟拍', !/G\.camX\s*\+?=/.test(body.replace(/G\.camX\s*=\s*0\s*;/, '')));
  t('updateCamera 不读 player.x（不跟随）', !/player\.x/.test(body));
  t('updateCamera 不读 stageW（不再锚 0.42）', !/stageW\(\)/.test(body));
}
t('worldToScreen 退化为恒等式 wx - camX', /function worldToScreen\(wx\)\s*\{\s*return wx - G\.camX;\s*\}/.test(BATTLE));
t('全文件无残留 camX 自增/自减', !/camX\s*\+=|camX\s*-=/.test(BATTLE));
t('唯一的 camX 写入点就是 updateCamera 的 0', (BATTLE.match(/G\.camX\s*=/g) || []).length === 1,
  '出现 ' + (BATTLE.match(/G\.camX\s*=/g) || []).length + ' 次');

/* ────────────────────────────────────────────────────────────
 * 5. 每关重置地图与血量（用户：一条血打到底打不了几关）
 * ──────────────────────────────────────────────────────────── */
console.log('');
console.log('-- 每关重置：清场 + 回出生点 + 回满血 --');
const rsBody = BATTLE.match(/function resetStage\(\s*\)\s*\{[\s\S]*?\n  \}/);
t('存在 resetStage', !!rsBody);
if (rsBody) {
  const b = rsBody[0];
  t('清掉全部存活敌人', /G\.enemies\.length\s*=\s*0/.test(b));
  t('敌人连同 PIXI 骨骼一起回收', /despawnEnemy\(e\)/.test(b));
  t('重置波次计数 G.spawned = 0', /G\.spawned\s*=\s*0/.test(b));
  t('清掉 BOSS 标记', /G\.bossActive\s*=\s*false/.test(b));
  t('玩家回到左侧出生点', /G\.player\.x\s*=\s*playerSpawnX\(\)/.test(b));
  t('玩家回到中间纵深', /G\.player\.lane\s*=\s*MID_LANE/.test(b));
  t('【核心】玩家回满血', /G\.player\.hp\s*=\s*G\.player\.maxHp/.test(b));
  t('攻击/技能状态一并复位', /attackAnim\s*=\s*false/.test(b) && /skillAnim\s*=\s*false/.test(b) && /G\.player\.atkT\s*=\s*0/.test(b));
  t('宠物拉回出生点，不做跨屏飞行', /pet\.x\s*=\s*G\.player\.x/.test(b));
  t('特效层清空（伤害数字/弹道不跨关）', /G\.fx\.length\s*=\s*0/.test(b) && /G\.dmg\.length\s*=\s*0/.test(b) && /SK_LIVE\.length\s*=\s*0/.test(b));
  t('【重要】不清 G.drops —— 飞行中的掉落是已到手收益', !/G\.drops/.test(b));
}

const swBody = BATTLE.match(/function spawnWave\([^)]*\)\s*\{[\s\S]*?\n  \}/);
t('存在 spawnWave', !!swBody);
if (swBody) {
  const b = stripComments(swBody[0]);
  t('刷怪 = 开新关，先调 resetStage', /resetStage\(\);/.test(b));
  t('重置发生在 makePoolEnemy 之后（新怪不被一起清掉）',
    b.indexOf('makePoolEnemy') < b.indexOf('resetStage()'));
  t('重置发生在 push 进 G.enemies 之前',
    b.indexOf('resetStage()') < b.indexOf('G.enemies.push'));
  t('【核心】怪物统一出生在擂台右侧', /e\.x\s*=\s*enemySpawnX\(\);/.test(b));
  t('不再有「第一只怪放玩家前方 30%」的特例分支', !/0\.3\s*\*/.test(b) && !/前方 30%/.test(b));
  t('不再使用已废弃的屏外生成 offset', !/enemySpawnOffset/.test(b));
}

t('init 时玩家就在左侧出生点', /G\.player\s*=\s*makePlayer\(\);[\s\S]{0,120}G\.player\.x\s*=\s*playerSpawnX\(\);/.test(BATTLE));
t('respawnArena 后玩家同样回左侧出生点', (() => {
  const rb = BATTLE.match(/function respawnArena\(\s*\)\s*\{[\s\S]*?\n  \}/);
  return !!rb && /G\.player\.x\s*=\s*playerSpawnX\(\);/.test(rb[0]);
})());
t('无目标时玩家位置被钳在擂台内（不会向右跑出画）',
  /p\.x\s*=\s*Math\.min\(p\.x,\s*arenaLeft\(\)\s*\+\s*arenaW\(\)\s*\*\s*0\.88\)/.test(BATTLE));

/* ────────────────────────────────────────────────────────────
 * 6. 单轴对撞 + 移速同档（实测反馈：怪与玩家不同轴 / 怪太快）
 * ──────────────────────────────────────────────────────────── */
console.log('');
console.log('-- 单轴对撞与移速 --');
{
  const B = stripComments(BATTLE);
  const mk = B.match(/function makeEnemyFrom\([^)]*\)\s*\{[\s\S]*?\n  \}/);
  t('存在 makeEnemyFrom', !!mk);
  const body = mk ? mk[0] : '';
  t('【核心】怪 lane 固定为 MID_LANE（不再 Math.random 连续随机）',
    /const lane = MID_LANE;/.test(body), body.match(/const lane = [^;]*;/));
  t('lane 赋值处不再出现 Math.random', !/const lane = Math\.random/.test(body));
  t('怪 y 由 laneOff(lane) 推导（与玩家用同一套纵深换算）', /y:laneOff\(lane\)/.test(body));
  t('【核心】怪移速基准 = BC.playerSpeed（与玩家同速）',
    /speed:\s*BC\.playerSpeed\s*\*/.test(body), (body.match(/speed:[^,]*/) || [''])[0]);
  t('怪移速不再取 def.speed（各怪种自带 120/76/88 已废弃）', !/speed:\s*def\.speed/.test(body));
  t('全文件已无 def.speed 参与移速', !/speed:\s*def\.speed/.test(B), '仍有残留');
  /* 个体差异必须压在 1.0 以下：任何怪都不该比玩家跑得快 */
  const mul = body.match(/BC\.playerSpeed \* \(([^)]*)\)/);
  t('个体差异系数上限 ≤ 1.0（怪不会比玩家快）',
    !!mul && /0\.9[0-9]\s*\+/.test(mul[1]) && !/\+\s*Math\.random\(\)\s*\*\s*0\.1[1-9]/.test(mul[1]),
    JSON.stringify(mul && mul[1]));
  const spd = num('playerSpeed');
  t('玩家基础移速 42px/s（BC 常量）', spd === 42, 'got ' + spd);
  t('怪物模板表已标注 speed 字段废弃', /speed 字段【已废弃】|已废弃/.test(BATTLE));
}
console.log('');
console.log('-- 战斗区「修为/秒」已移除 --');
const CSS = stripComments(HTML);   /* HTML 里的 /*...*\/ 注释同样会提到被删的老选择器 */

/* ── HUD 去重与所有权（实测反馈：三个关卡 / 读数跳来跳去）── */
console.log('');
console.log('-- HUD 去重与所有权 --');
{
  const B = stripComments(BATTLE);
  const U = stripComments(V6UI);
  t('index.html 已删除重复的 #battleTrial 节点', !/id="battleTrial"/.test(HTML));
  t('index.html 已删除为空的 #battleSpirit 锚点', !/id="battleSpirit"/.test(HTML));
  t('关卡读数在页面内唯一（只有一处 "第 <b id=sbStage>"）',
    (HTML.match(/id="sbStage"/g) || []).length === 1 &&
    (HTML.match(/第 <b id="sbStage">/g) || []).length === 1,
    'sbStage 出现 ' + (HTML.match(/id="sbStage"/g) || []).length + ' 次');
  t('推进状态已并入关卡行（#battleState 落在 .sb-main 内）',
    /sb-main[\s\S]{0,320}id="battleState"/.test(HTML));
  t('顶部 HUD 改 flex-end（旧的 space-between 会把唯一项甩到画面正中）',
    /\.battle-hud\{[^}]*justify-content:flex-end/.test(CSS));
  t('.battle-hud 只剩一条定义（无重复声明）',
    (CSS.match(/\.battle-hud\{/g) || []).length === 1,
    '出现 ' + (CSS.match(/\.battle-hud\{/g) || []).length + ' 次');
  t('已删除 .battle-hud .trial 死样式', !/\.battle-hud \.trial/.test(CSS));

  /* ★ 双写防线：一个节点只能有一个模块负责 */
  t('【核心】50-battle.js 不再写 #battleSpeed（交还 06-v6ui）',
    !/getElementById\('battleSpeed'\)/.test(B));
  t('【核心】06-v6ui.js 不再碰 #battleBuff（战斗内临时 buff 归 50-battle）',
    !/battleBuff/.test(U));
  t('50-battle.js 负责写 #battleBuff（身法剩余秒）',
    /getElementById\('battleBuff'\)/.test(B));
  t('06-v6ui.js 负责写 #battleSpeed（宠物永久倍速）', /el\('battleSpeed'\)/.test(U));
  t('06-v6ui.js 负责写 #battleSkip（跳关档位）', /el\('battleSkip'\)/.test(U));
  t('两模块写的节点集合无交集', !/battleBuff/.test(U) && !/battleSkip/.test(B));
  t('跳关显示为「跳 ≤N」（与实际随机抽档语义一致，不谎称固定跳 N）',
    /'跳 ≤'/.test(U));
  t('50-battle.js 不再自行渲染关卡文案（权威归 stage-bar）',
    !/battleTrial/.test(B));
}

t('index.html 中 #rateText 节点已删除', !/id="rateText"/.test(HTML));
t('index.html 中 .res-bar 内只剩灵石一项', (HTML.match(/class="res-bar">[\s\S]*?<\/div>\s*<\/div>/) || [''])[0].split('<div class=').length - 1 === 1);
t('index.html 已无 .res-bar .rate 规则', !/\.res-bar \.rate[^\w]/.test(CSS));
t('.spirit 的 flex 布局选择器完好（未被删成无主声明）', /\.res-bar \.spirit\{display:flex/.test(CSS));
t('CSS 里不留无主声明（上一条规则必须以 } 收尾）', !/\}\s*\n\s*[a-z-]+:\s*[^;{]*;\s*\n\s*[a-z-]+:/.test(CSS));
t('06-v6ui.js 不再写 #rateText', !/rateText/.test(stripComments(V6UI)));
t('30-systems.js / main.js 也不再写 #rateText',
  !/getElementById\('rateText'\)|\$\('rateText'\)|querySelector\('#rateText'\)/.test(
    readFileSync(join(ROOT, 'src', '30-systems.js'), 'utf8') +
    readFileSync(join(ROOT, 'src', 'main.js'), 'utf8')));

console.log('');
console.log('通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
