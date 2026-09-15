/**
 * 怪物注册表 (Monster Registry)
 * ──────────────────────────────────────────────────────────────────────
 * 目的: 把"一个怪物"的定义从散落 5 处收敛成【单一数据源】。
 *
 * 改造前新增一只怪要改 5 个地方:
 *   ① 50-battle.js  enemies 表 (属性)
 *   ② 50-battle.js  const xxxImg = new Image()  + onload
 *   ③ 50-battle.js  G.xxxSprite / G.xxxReady   (硬编码全局字段)
 *   ④ 50-battle.js  drawEnemies 里的 else-if 链 (每段重复一遍绘制逻辑)
 *   ⑤ 50-battle.js  const XXX_SPRITE = {...}   (帧区间写死)
 *
 * 改造后: 只加【一个数据源】—— 见 MONSTER_DEFS。
 *   帧区间优先从 assets/*_meta.json 读取 (素材管线已产出),
 *   读不到时用 MONSTER_DEFS 里的内联回退, 保证离线/首屏即可用。
 *
 * ── 为什么不用 fetch 全量扫 meta ─────────────────────────────────────
 * 纯静态无构建, 没有构建期文件清单, 浏览器也无法列目录。
 * 所以 meta 路径必须显式登记 (MONSTER_DEFS 里的 meta 字段)。
 * fetch 失败自动回退到内联 frames —— 不影响可玩性。
 *
 * ── 与渲染后端的关系 ────────────────────────────────────────────────
 * 本模块【只产出数据】, 不含任何绘制逻辑。
 * drawEnemies 消费 MonsterVisual(reg) 拿到的统一 shape 去画,
 * 后续替换 PixiJS 后端时, 这里无需改动。
 */

/* ── 怪物定义表 (唯一数据源) ─────────────────────────────────────────
 * 字段说明:
 *   key        战斗内 e.type 的取值, 必须唯一
 *   sprite     图集路径
 *   meta       可选, 素材 meta.json 路径 (有则用其中的帧区间覆盖 frames)
 *   frames     内联帧配置 (meta 缺失时的回退, 也是权威默认值)
 *   stats      战斗属性 (原 enemies 表)
 *   visual     渲染参数 (原先硬编码在 drawEnemies 各分支里)
 *   sfx        音效键 (原先是 if (e.type==='slime') 的硬编码分支)
 */
export const MONSTER_DEFS = {
  slime: {
    name: '妖卒',
    sprite: 'assets/monster_001_green_slime.webp',
    meta: 'assets/monster_001_green_slime_meta.json',
    /* 12列8行, walk32+attack51+hurt11 */
    frames: { cols: 12, fw: 240, fh: 128, fps: 24,
              walk: { start: 0, count: 32 }, attack: { start: 32, count: 51 }, hurt: { start: 83, count: 11 } },
    stats:  { role: 'melee', w: 60, atkRange: 30, speed: 120, hpK: 1.0, atkK: 0.55, defK: 0.35, color: '#6fe0a8' },
    visual: { drawHMax: 72, drawHFrac: 0.5, footBase: 120, scaleY: 0.92, skewX: 0, flip: false, shadow: true,
              stepFrames: [4, 20] },
    sfx:    { hurt: 'slime_hurt', attack: 'slime_attack', footstep: 'slime_footstep' },
  },

  water: {
    name: '水灵',
    sprite: 'assets/monster_002_water_sprite.webp',
    meta: 'assets/monster_002_water_sprite_meta.json',
    /* 10列8行, walk32+attack33+hurt13 */
    frames: { cols: 10, fw: 240, fh: 128, fps: 24,
              walk: { start: 0, count: 32 }, attack: { start: 32, count: 33 }, hurt: { start: 65, count: 13 } },
    stats:  { role: 'melee', w: 40, atkRange: 35, speed: 80, hpK: 1.6, atkK: 0.75, defK: 0.60, color: '#6fd0e8' },
    visual: { drawHMax: 70, drawHFrac: 0.5, footBase: 118, scaleY: 0.92, skewX: -0.03, flip: false, shadow: true,
              stepFrames: [8, 24] },
    sfx:    { hurt: 'water_hurt', attack: 'water_attack', footstep: 'water_footstep' },
  },

  boss: {
    name: '史莱姆王',
    sprite: 'assets/monster_003_slime_king.webp',
    /* BOSS 暂无 meta.json (素材存在但未产出 meta), 用内联帧配置
     * 8列8行, 帧0-17漂浮, 帧18-39攻击(内含恢复段) */
    frames: { cols: 8, fw: 240, fh: 200, fps: 8,
              walk: { start: 0, count: 18 }, attack: { start: 18, count: 22 }, hurt: { start: 0, count: 0 } },
    stats:  { role: 'ranged', w: 5, atkRange: 45, speed: 40, hpK: 52, atkK: 3.0, defK: 3.0,
              color: '#a0ff80', isBoss: true },
    /* BOSS 漂浮不踩地板 → 无 footBase/scaleY; sizeMult 2.0 由 floatHeight 体现 */
    visual: { drawHMax: 140, drawHFrac: 0.7, footBase: null, scaleY: 1, skewX: 0, flip: false,
              float: { height: 10, amp: 8, freq: 1.5 }, maskedAttack: true },
    sfx:    { hurt: null, attack: 'boss_attack', attackVol: 0.8, footstep: null },
  },
};

/* ── 运行时注册表 ────────────────────────────────────────────────────
 * 每项: { key, name, sprite(Image), ready, frames, stats, visual, sfx, isBoss }
 */
const _reg = new Map();

/** 图集加载: 立即 registered(ready=false), onload 后 ready 翻 true。
 *  这样调用方永远能拿到对象, 只是 ready 前走占位绘制 —— 与原逻辑等价。 */
function loadSprite(path) {
  const img = new Image();
  const rec = { img, ready: false };
  img.onload = () => { rec.ready = true; };
  img.onerror = () => { rec.ready = false; };
  img.src = path;
  return rec;
}

/** 从 meta.json 覆盖帧区间。失败静默回退 —— meta 是增强, 不是必需。 */
async function applyMeta(def, entry) {
  if (!def.meta) return;
  try {
    const r = await fetch(def.meta, { cache: 'no-cache' });
    if (!r.ok) return;
    const m = await r.json();
    const f = def.frames;
    if (m.frame_size) { f.fw = m.frame_size[0]; f.fh = m.frame_size[1]; }
    if (m.cols) f.cols = m.cols;
    for (const st of ['walk', 'attack', 'hurt']) {
      if (m[st] && typeof m[st].start === 'number') {
        f[st] = { start: m[st].start, count: m[st].count != null ? m[st].count : f[st].count };
        if (m[st].fps) f[st].fps = m[st].fps;
      }
    }
    if (m.base_stats) entry.base_stats = m.base_stats;
    entry.metaLoaded = true;
  } catch (e) {
    /* 离线或 404: 用内联 frames, 完全可玩 */
  }
}

/** 初始化: 把所有定义装载成运行时条目 (同步可用, meta 异步覆盖) */
export function initRegistry() {
  if (_reg.size) return _reg;                 // 幂等
  for (const [key, def] of Object.entries(MONSTER_DEFS)) {
    const entry = {
      key,
      name: def.name,
      isBoss: !!(def.stats && def.stats.isBoss),
      frames: { ...def.frames,
                walk: { ...def.frames.walk }, attack: { ...def.frames.attack }, hurt: { ...def.frames.hurt } },
      stats: { ...def.stats },
      visual: JSON.parse(JSON.stringify(def.visual || {})),
      sfx: { ...(def.sfx || {}) },
      spritePath: def.sprite,
      sprite: loadSprite(def.sprite),        // { img, ready }
      metaLoaded: false,
    };
    _reg.set(key, entry);
    /* meta 异步加载, 到达后原地覆盖帧区间 (不改对象引用, 渲染方无需重取) */
    applyMeta(def, entry);
  }
  return _reg;
}

/** 取一个怪物条目 */
export function getMonster(key) {
  if (!_reg.size) initRegistry();
  return _reg.get(key) || null;
}

/** 全部条目 (按定义顺序) */
export function allMonsters() {
  if (!_reg.size) initRegistry();
  return [..._reg.values()];
}

/** 供 BC.enemies 兼容: 导出 { type: stats } 形态的属性表 */
export function statsTable() {
  const out = {};
  for (const e of allMonsters()) out[e.key] = e.stats;
  return out;
}

/** 供按权重随机: [{type, w}] */
export function weightList(keys) {
  const list = keys || [...(_reg.size ? _reg.keys() : Object.keys(MONSTER_DEFS))];
  return list.map(k => ({ type: k, w: (getMonster(k)?.stats.w) || 1 }));
}

/* ── 帧选择: 三态 (hurt > attack > walk) ────────────────────────────
 * 原逻辑在 slime/water/boss 三处重复了几乎相同的代码, 此处收敛成一处。
 * 返回 { frameIdx, col, row, srcX, srcY, fw, fh }
 */
export function pickFrame(entry, e, now) {
  const F = entry.frames;
  let frameIdx;
  const hurtDur = 0.25;                      // 与 drawEnemies 原逻辑一致

  if (e.hurtT > 0 && F.hurt.count > 0) {
    const p = 1 - (e.hurtT / hurtDur);
    frameIdx = F.hurt.start + Math.min(Math.floor(p * F.hurt.count), F.hurt.count - 1);
  } else if (e.anim > 0 && F.attack.count > 0) {
    const p = 1 - e.anim;
    frameIdx = F.attack.start + Math.min(Math.floor(p * F.attack.count), F.attack.count - 1);
  } else {
    const fps = F.walk.fps || F.fps || 24;
    frameIdx = F.walk.start + (Math.floor(now * fps) % Math.max(1, F.walk.count));
  }

  const col = frameIdx % F.cols;
  const row = Math.floor(frameIdx / F.cols);
  return { frameIdx, col, row, srcX: col * F.fw, srcY: row * F.fh, fw: F.fw, fh: F.fh };
}

/* ── 几何: 从 visual + 画布高度算出绘制尺寸与脚底偏移 ───────────────
 * 原逻辑: slime drawH=min(CH*0.5,72) footOffset=120*(drawH/fh) scaleY=0.92
 *         water drawH=min(CH*0.5,70) footOffset=118*(drawH/fh) scaleY=0.92 skew=-0.03
 *         boss  drawH=min(CH*0.7,140)  漂浮 floatY=10+sin(t*1.5)*8
 */
export function measure(entry, CH, elite, now) {
  const V = entry.visual, F = entry.frames;
  const eliteMul = elite ? 1.28 : 1;         // 精英怪体型 ×1.28 (原逻辑)
  const drawH = Math.min(CH * (V.drawHFrac || 0.5), V.drawHMax || 72) * eliteMul;
  const drawW = drawH * (F.fw / F.fh);
  const scaleY = V.scaleY || 1;
  const footOffset = V.footBase != null ? V.footBase * (drawH / F.fh) : 0;
  const compensatedH = scaleY !== 1 ? drawH / scaleY : drawH;
  let floatY = 0;
  if (V.float) {
    floatY = (V.float.height || 0) + Math.sin(now * (V.float.freq || 1.5)) * (V.float.amp || 0);
  }
  return { drawH, drawW, scaleY, footOffset, compensatedH, floatY, skewX: V.skewX || 0 };
}
