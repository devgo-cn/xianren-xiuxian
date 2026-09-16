/**
 * 战斗系统（无尽边界式横向推进战斗）
 * 接入真实素材: cultivator_sheet.png(玩家) + main-bg.jpg(背景)
 *
 * 由 tools/extract_battle.js 从 index.html 内联 <script> 抽取（逻辑零改动）。
 * 原为经典脚本 IIFE，现改为 ES Module：
 *   - 原来直接读写的全局 state / SND / pushBattleStats 改为显式 import；
 *   - window.BattleAPI / window.pushBattleStats 仍显式挂载，外部接口不变；
 *   - 模块加载即初始化（保留原 IIFE 的副作用语义）。
 *
 * ⚠️ 本文件由工具生成，手改会在下次重建时丢失。
 */

import { SND } from './10-base.js';
import { state } from './00-pure.js';   /* v3.9: 试炼纪录/离线加成写档 */


  const BC = {
    /* 占位怪 demon(妖将)/raptor(妖弓) 已移除 —— 只保留两种有真实素材的怪 */
    playerAtkRange: 75, playerAspd: 1.1, playerSpeed: 28,
    spawnInterval: 2.6, enemySpawnOffset: 40, maxAlive: 9, queueGap: 34,   /* v3.8.2 刷怪降密: 1.0s/只→2.6s/只, 同屏 14→9 —— 站桩硬撸改推进节奏 */
    enemies: {
      /* hpK/atkK/defK: 按玩家境界(lv)线性成长 —— 怪只随境界长, 玩家随境界+装备长, 换装即提速。
       * hpK 定"一轮两剑能否收掉": 妖卒约一轮一只(收草手感), 水灵约两轮(略厚)。
       * v3.9 骨骼怪批量接入: bone=BONES slug, drawH=游戏内显示高(px, 素材分辨率无关)。 */
      /* ---- T1 妖群 ---- */
      slime: { name:'妖卒', role:'melee', w:60, atkRange:30, speed:120, hpK:1.0, atkK:0.55, defK:0.35, color:'#6fe0a8', tier:1 },
      jiangshi: { name:'僵尸', role:'melee', w:40, atkRange:32, speed:95, hpK:1.15, atkK:0.6, defK:0.4, color:'#b9d0a8', bone:'jiangshi', drawH:100, hpBarW:30, tier:1 },
      slime_flynn: { name:'弗林', role:'melee', w:35, atkRange:28, speed:110, hpK:0.85, atkK:0.5, defK:0.25, color:'#8fe8c0', bone:'slime_flynn', drawH:76, hpBarW:26, tier:1 },
      /* ---- T2 妖锐 ---- */
      rat:   { name:'鼠妖', role:'melee', w:35, atkRange:32, speed:150, hpK:0.8, atkK:0.5, defK:0.25, color:'#c9b28f', bone:'ratty', drawH:84, tier:2 },
      fox:   { name:'妖狐', role:'melee', w:32, atkRange:30, speed:165, hpK:0.85, atkK:0.62, defK:0.28, color:'#e8a86b', bone:'fox', drawH:88, hpBarW:28, tier:2 },
      bee:   { name:'蜂妖', role:'melee', w:28, atkRange:26, speed:175, hpK:0.55, atkK:0.55, defK:0.15, color:'#e8d06b', bone:'bee', drawH:60, hpBarW:24, tier:2 },
      /* ---- T3 妖将 ---- */
      water: { name:'水灵', role:'melee', w:40, atkRange:35, speed:80,  hpK:1.6, atkK:0.75, defK:0.60, color:'#6fd0e8', tier:3 },
      wolf:  { name:'狼妖', role:'melee', w:36, atkRange:34, speed:150, hpK:1.35, atkK:0.85, defK:0.5, color:'#9aa8c0', bone:'wolf', drawH:92, hpBarW:30, tier:3 },
      cultist_mage: { name:'邪修', role:'melee', w:34, atkRange:38, speed:90, hpK:1.5, atkK:0.95, defK:0.5, color:'#b08ae0', bone:'cultist_mage', drawH:100, hpBarW:30, tier:3 },
      /* ---- T4 妖王 ---- */
      hellhound_garm: { name:'狱犬', role:'melee', w:40, atkRange:36, speed:175, hpK:2.1, atkK:1.1, defK:0.75, color:'#c06a5a', bone:'hellhound_garm', drawH:108, hpBarW:34, tier:4 },
      black_ant_queen: { name:'蚁后', role:'melee', w:42, atkRange:36, speed:85, hpK:2.8, atkK:1.0, defK:1.0, color:'#7a6ae0', bone:'black_ant_queen', drawH:116, hpBarW:36, tier:4 },
      /* v2.6 调参: hpK 80→52(实测过厚约-35%), atkRange 70→45(玩家攻距75, 贴身才能互殴, 修复"剑够不到")
       * v3.9 BOSS 换九尾狐王: giant_kitsune(S 品质, 10 种攻击动作), 骨骼渲染 drawH 110 */
      boss:  { name:'九尾狐王', role:'ranged', w:5,  atkRange:45, speed:40, hpK:52, atkK:3.0, defK:3.0, color:'#e8b06b', isBoss:true, floatHeight:10, sizeMult:2.0, tier:5, bone:'giant_kitsune', drawH:220, hpBarW:60 },
    },
    /* v3.9 怪物三维系统: 怪包统一池(每个境界都会刷到全怪种), 三维 = 境界基准 × 怪种K × 波次tier倍率。
     * 波次内从 T1 最弱一路递进到 T5 —— tier 决定刷怪池权重与三维倍率。 */
    tier: {
      1: { name:'妖群', mul:1.00 },
      2: { name:'妖锐', mul:1.30 },
      3: { name:'妖将', mul:1.75 },
      4: { name:'妖王', mul:2.40 },
      5: { name:'妖皇', mul:3.20 },
    },
    tierNeedBase: 7,      /* 首档升档击杀数: T2@7, T3@9, T4@12, T5@15(累计43) —— 120s 产能约46只, 顶尖玩家压哨进 T5 */
    tierNeedStep: 1.3,    /* 每档所需击杀数递增系数 */
    trialSecs: 120,       /* 试炼轮时长: 120 秒结算, 击杀数计入纪录 → 离线补偿 */
    /* v3.9.2 骨骼池怪数值模板(按档位) —— 全量 79 只不再逐怪手配, 个体差异靠波次倍率+精英 roll */
    boneTpl: {
      1: { hpK:0.95, atkK:0.55, defK:0.30, speed:110 },
      2: { hpK:0.85, atkK:0.62, defK:0.28, speed:155 },
      3: { hpK:1.45, atkK:0.85, defK:0.50, speed:120 },
      4: { hpK:2.20, atkK:1.05, defK:0.80, speed:150 },
      5: { hpK:2.80, atkK:1.20, defK:1.00, speed:110 },
    },
  };
  /* 升档所需击杀数: base × step^(t-1) */
  function tierNeed(t) { return Math.round(BC.tierNeedBase * Math.pow(BC.tierNeedStep, (t||1) - 1)); }

  /* 玩家属性(主游戏 pushBattleStats 注入) —— 战斗内一切数值伤害以此为准 */
  let PST = { lv:1, atk:56, hp:430, def:31, crit:0, critB:0, critD:0, pen:0, dodge:0 };
  /* 掉落系数(服务端可下发覆盖; 断网/离线用内置默认值, 保证照常可玩) */
  const DROP = {
    spiritBase: 6,        // 每杀灵石基数
    spiritPerLv: 1.2,     // 每杀灵石 · 每境界级加成
    spiritRand: 0.4,      // 灵石浮动 ±40%
    equipChance: 0.035,   // 掉法宝概率(装备实际生成在主游戏 makeArt)
    eliteChance: 0.06,    // 精英怪出现率
    eliteMul: 4,          // 精英产出倍率
    eliteHp: 3,           // 精英血量倍率
  };

  const G = {
    t:0, kills:0, spirit:0, speedMult:1, speedMultTimer:0, state:'walk', camX:0, paused:false,
    player:null, pets:[], enemies:[], fx:[], dmg:[], drops:[], spawnT:BC.spawnInterval,
    sprite:null, bgImg:null, spriteReady:false, bgReady:false, extraStrike:false,
    speedDodge:0, nextStrikeCrit:0,
    petFoxSprite:null, petFoxReady:false,
    skillSprite:null, skillReady:false,
    smallKillsSinceBoss:0, bossActive:false, bossSpawnEvery:100,   /* v3.8.2 打满100只小怪才刷BOSS(原10) */
    skillCall:null,          /* 技能名播报槽: 覆盖式大字快闪, {name,t,dur} */
    /* v3.9 试炼轮次: 120秒一场, 怪从T1一路刷到T5; 结算击杀数 → 纪录 → 离线补偿 */
    trialT: BC.trialSecs, trialKills:0, trialTier:1, tierKills:0, trialSettled:false, trialRound:0, trialBossDone:false,
  };

  /* 加载素材 */
  const spriteImg = new Image();
  spriteImg.onload = function() { G.sprite = solidify(spriteImg); G.spriteReady = true; };
  spriteImg.src = 'assets/cultivator_sheet.webp';
  /* 怪物素材: 幽夜森林(像素风, v3.7 换新背景) */
  const bgImg = new Image();
  bgImg.onload = function() { G.bgImg = bgImg; G.bgReady = true; };
  bgImg.src = 'assets/battle-forest-bg.webp';
  /* 怪物素材: 绿色史莱姆 */
  const slimeImg = new Image();
  slimeImg.onload = function() { G.slimeSprite = solidify(slimeImg); G.slimeReady = true; };
  slimeImg.src = 'assets/monster_001_green_slime.webp';
  /* 怪物素材: 水精灵 */
  const waterSpriteImg = new Image();
  waterSpriteImg.onload = function() { G.waterSprite = solidify(waterSpriteImg); G.waterReady = true; };
  waterSpriteImg.src = 'assets/monster_002_water_sprite.webp';
  /* BOSS素材: 史莱姆王(飘着, 2倍大) */
  const bossSpriteImg = new Image();
  bossSpriteImg.onload = function() { G.bossSprite = solidify(bossSpriteImg); G.bossReady = true; };
  bossSpriteImg.src = 'assets/monster_003_slime_king.webp';
  /* 宠物素材: 灵狐 */
  const petFoxImg = new Image();
  petFoxImg.onload = function() { G.petFoxSprite = solidify(petFoxImg); G.petFoxReady = true; };
  petFoxImg.src = 'assets/pet_fox_sheet.webp';
  /* 技能素材: 剑气月牙 */
  const skillImg = new Image();
  skillImg.onload = function() { G.skillSprite = skillImg; G.skillReady = true; };
  skillImg.src = 'assets/cultivator_skill_sheet.webp';
  /* 技能素材: 横扫千军 */
  const hengsaoImg = new Image();
  hengsaoImg.onload = function() { G.hengsaoSprite = hengsaoImg; G.hengsaoReady = true; };
  hengsaoImg.src = 'assets/skill_hengsao_sheet.webp';

  /* ---------- 骨骼怪(DragonBones → Canvas2D 桥) ----------
   * v3.9 BONES 注册表: 按 assets/db/monsters/index.json 按需加载怪工厂 ——
   * 每怪 {ske.json, tex.json, tex.webp} 预构建一个 factory, makeEnemy 时 buildArmature
   * 出独立骨架实例(动画互不干扰)。ratty 是老素材路径特例(assets/db/ratty_*),
   * 新怪全部走 monsters/<slug>/。桥/UMD 由 index.html 以经典脚本先于模块加载,
   * 失败则骨骼怪自动走兜底占位渲染。
   * animMap: index.json 动画名(Attack A/Damage/Idle...) → 状态机五态(idle/hurt/attack/walk/dead),
   * 缺态自动回退(idle→attack, dead→damage, walk→idle), 保证 fadeIn 永远有动画可切。 */
  const BONES = {};   /* slug -> {ready, factory, anims:{idle,hurt,attack,walk,dead}, baseH, arm} */
  function boneAnimMap(list) {
    const low = (list || []).map(a => String(a).toLowerCase());
    const pick = (cands) => {
      for (const c of cands) { const i = low.findIndex(a => a.includes(c)); if (i >= 0) return list[i]; }
      return null;
    };
    const idle = pick(['idle']);
    const hurt = pick(['damage', 'hurt']) || idle;
    const attack = pick(['attack']) || idle;
    const walk = pick(['walk']) || idle;
    const dead = pick(['dead', 'die']) || hurt;
    const skill = pick(['skill']) || attack;
    return { idle, hurt, attack, walk, dead, skill };
  }
  function loadBone(slug, urls, armName, animList, onReady) {
    if (!window.BattleGL || BONES[slug]) return;
    const B = BONES[slug] = { ready:false, factory:null, anims:boneAnimMap(animList), baseH:0, arm:armName, pool:[] };
    let ske = null, tex = null;
    const img = new Image();
    const tryBuild = () => {
      if (!ske || !tex || !img.naturalWidth || B.ready) return;
      try {
        B.factory = window.BattleGL.buildFactory(ske, tex, img);
        const probe = B.factory.buildArmature(armName);
        const bb = window.BattleGL.armatureAABB(probe);
        B.baseH = Math.max(1, bb.maxY - bb.minY);
        probe.dispose();
        B.ready = true;
        console.log('[battle] 骨骼怪就绪 ' + slug + ' baseH=' + B.baseH.toFixed(1));
        if (onReady) onReady();
      } catch (err) { console.error('[battle] ' + slug + ' 骨骼工厂构建失败', err); }
    };
    fetch(urls.ske).then(r => r.json()).then(j => { ske = j; tryBuild(); }).catch(err => console.error('[battle] ' + slug + ' ske 加载失败', err));
    fetch(urls.tex).then(r => r.json()).then(j => { tex = j; tryBuild(); }).catch(err => console.error('[battle] ' + slug + ' tex 加载失败', err));
    img.onload = tryBuild;
    img.src = urls.img;
  }
  /* 按需加载清单: BC.enemies 中带 bone 字段的怪(ratty 老路径特例) + v3.9.2 全量池:
   * index.json 全部 slug 进懒加载队列(1.5s/3只错峰, 工厂就绪一只就能刷一只)。
   * BC.bonePool = {tier:[slug...]} —— spawnWave 按当前档从池里挑(排除手配怪与BOSS)。 */
  const BONE_POOL = { 1:[], 2:[], 3:[], 4:[], 5:[] };
  const BONE_IDX = {};   /* slug -> index.json cfg(armature/anims/tier/drawH) —— makeBoneEnemy 取 drawH 用 */
  (function loadBones() {
    if (!window.BattleGL) { console.warn('[battle] BattleGL 未加载, 骨骼怪不可用'); return; }
    loadBone('ratty', { ske:'assets/db/ratty_ske.json', tex:'assets/db/ratty_tex.json', img:'assets/db/ratty_tex.png' }, 'Ratty',
      ['idle','dead','attack','hurt','walk']);
    fetch('assets/db/monsters/index.json').then(r => r.json()).then(idx => {
      const handMade = new Set(Object.values(BC.enemies).map(d => d.bone).filter(Boolean));
      for (const [slug, cfg] of Object.entries(idx)) BONE_IDX[slug] = cfg;
      /* 优先加载手配怪(BC.enemies 里的 bone) */
      const need = [...handMade].filter(b => b && b !== 'ratty');
      for (const slug of need) {
        const cfg = idx[slug];
        if (!cfg) { console.warn('[battle] index.json 缺怪:', slug); continue; }
        loadBone(slug, { ske:`assets/db/monsters/${slug}/ske.json`, tex:`assets/db/monsters/${slug}/tex.json`, img:`assets/db/monsters/${slug}/tex.webp` }, cfg.armature, cfg.anims);
      }
      /* 全量池: 排除手配/BOSS/老路径, 按文档 tier 分组 */
      const queue = [];
      for (const [slug, cfg] of Object.entries(idx)) {
        if (handMade.has(slug) || slug === 'ratty') continue;
        const t = Math.min(5, Math.max(1, parseInt(String(cfg.tier || 'T1').slice(1)) || 1));
        BONE_POOL[t].push(slug);
        queue.push(slug);
      }
      /* 懒加载队列: 错峰构建工厂(每 1.5s 3 只), 就绪一只入池一只 */
      let i = 0;
      const pump = setInterval(() => {
        const batch = queue.slice(i, i + 3); i += 3;
        for (const slug of batch) {
          const cfg = idx[slug];
          loadBone(slug, { ske:`assets/db/monsters/${slug}/ske.json`, tex:`assets/db/monsters/${slug}/tex.json`, img:`assets/db/monsters/${slug}/tex.webp` }, cfg.armature, cfg.anims);
        }
        if (i >= queue.length) clearInterval(pump);
      }, 1500);
    }).catch(err => console.error('[battle] monsters/index.json 加载失败', err));
  })();


  /* 音效加载 */
  const sfx = {
    footstep: new Audio('assets/sfx/footstep.ogg'),
    attack1: new Audio('assets/sfx/attack1.ogg'),
    attack2: new Audio('assets/sfx/attack2.ogg'),
    skill_attack: new Audio('assets/sfx/skill_attack.ogg'),
    slime_footstep: new Audio('assets/sfx/slime_footstep.ogg'),
    slime_attack: new Audio('assets/sfx/slime_attack.ogg'),
    slime_hurt: new Audio('assets/sfx/slime_hurt.ogg'),
    water_footstep: new Audio('assets/sfx/water_footstep.ogg'),
    water_attack: new Audio('assets/sfx/water_attack.ogg'),
    water_hurt: new Audio('assets/sfx/water_hurt.ogg'),
    boss_attack: new Audio('assets/sfx/boss_attack.ogg'),
    hengsao: new Audio('assets/sfx/hengsao.ogg'),
    ready: false
  };
  let sfxLoaded = 0;
  const sfxTotal = 12;
  for (const key of ['footstep', 'attack1', 'attack2', 'skill_attack', 'slime_footstep', 'slime_attack', 'slime_hurt', 'water_footstep', 'water_attack', 'water_hurt', 'boss_attack', 'hengsao']) {
    sfx[key].addEventListener('canplaythrough', () => {
      sfxLoaded++;
      if (sfxLoaded >= sfxTotal) sfx.ready = true;
    });
    sfx[key].load();
  }
  /* v2.6 PERF: 音频池化 —— 原每次 cloneNode 新建 Audio(攻击期每秒6~8实例+GC抖动), 改为每音效预池≤3实例复用 */
  const SFX_POOL = {};
  function sfxGet(name) {
    const pool = SFX_POOL[name] || (SFX_POOL[name] = []);
    let a = null;
    for (const x of pool) { if (x.paused || x.ended) { a = x; break; } }
    if (!a && pool.length < 3) { a = sfx[name].cloneNode(); pool.push(a); }
    return a;   // 池满且全部在播 → 丢弃本次(可接受, 密集音效本就会叠一起)
  }
  function playSfx(name, vol) {
    if (!sfx.ready || !sfx[name]) return;
    if (typeof SND !== 'undefined' && !SND.sfxOn) return;   /* 设置页「音效」开关统一管控战斗音效 */
    const a = sfxGet(name);
    if (!a) return;
    a.volume = vol || 0.6;
    try { a.currentTime = 0; } catch (e) {}
    a.play().catch(() => {});
  }

  /* Sprite 帧配置: 玩家 */
  /* v3.8 素材重抠接入: 高清版 cultivator_sheet(8列9行, 帧408x252, walk32+attack40,
   * 帧序与旧素材一致——实测两剑刺出峰 5~6/20~23 完全吻合)。ATTACK_MAP/判定帧不动:
   * 第二下刺 = 攻击段源帧21 全刺(抽帧后 animFrame 18 起刺判定)。
   * 质心 x=0.35 与渲染锚点 -drawW*0.35 匹配; 角色满帧高(0.95 vs 旧 0.84),
   * drawH 基准 80→72 补偿, 视觉体型与旧版持平。 */
  const SPRITE = { cols:8, fw:408, fh:252, walkStart:0, walkCount:32, attackStart:32, attackCount:24, fps:24 };
  /* v2.8 攻击动画抽帧映射(24 帧): 素材攻击段 0..39(源帧32..71), 冗余在"起手抬剑 8 帧 + 收势长尾 11 帧"。
   * 节奏: 0~3 抬剑 → 4~12 第一剑刺出(帧12 命中判定, 对齐源帧39 剑尖最远) → 13~17 收剑 →
   *       18~21 第二剑(源帧51~53, 向左下扫, 帧18 判定) → 22~23 补刀收势(帧22 判定) */
  const ATTACK_MAP = [0, 2, 4, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 8, 9, 10, 11, 13, 19, 20, 21, 21, 21, 24];
  /* 技能: 剑气斩 (24帧, 1秒, 6列x4行, 480x256每帧) */
  const SKILL = { name:'剑气斩', cols:6, fw:480, fh:256, count:24, fps:24, hitFrame:12, damageMult:2.5, cooldown:4.0, triggerChance:0.3 };
  /* 横扫千军特效配置: 7列7行, 49帧, 左右渐现渐隐 */
  const HENGSAO_SPRITE = { cols:7, fw:320, fh:160, count:49, fps:12 };
  /* 史莱姆帧配置: 12列8行, walk32+attack51+hurt11 */
  const SLIME_SPRITE = { cols:12, fw:240, fh:128, walkStart:0, walkCount:32, attackStart:32, attackCount:51, hurtStart:83, hurtCount:11, fps:24 };
  /* 水精灵帧配置: 10列8行, walk32+attack33+hurt13 */
  const WATER_SPRITE = { cols:10, fw:240, fh:128, walkStart:0, walkCount:32, attackStart:32, attackCount:33, hurtStart:65, hurtCount:13, fps:24 };
  /* BOSS史莱姆王: 飘着的, 2倍大, 帧0-17漂浮, 帧18-39攻击, 帧40-47恢复 */
  const BOSS_SPRITE = { cols:8, fw:240, fh:200, walkStart:0, walkCount:18, attackStart:18, attackCount:22, hurtStart:0, hurtCount:0, fps:8, isBoss:true, floatHeight:10, sizeMult:2.0 };

  function fmtNum(n) {
    n = Math.round(n || 0);
    if (n >= 100000000) return (n/100000000).toFixed(2) + '亿';
    if (n >= 10000) return (n/10000).toFixed(n >= 1000000 ? 0 : 1) + '万';
    return String(n);
  }
  /* ---------- 技能读取: 等级与数值的唯一来源是主游戏 SkillAPI ---------- */
  function skVal(id)  { const api = window.SkillAPI; return api ? api.val(id) : null; }   // {chance, dmg, ...} 已按等级插值
  function skLv(id)   { const api = window.SkillAPI; return api ? api.lv(id) : 1; }
  function skExp(id,n){ const api = window.SkillAPI; if (api) api.addExp(id, n); }
  /* ---------- 技能名播报: 战斗画布中央书法大字, 弹入→停→快淡出(~0.75s 即隐) ----------
   * 覆盖式单槽不叠字; 同名 0.9s 冷却防高频 proc 连刷拖长显示 */
  const _callCd = {};
  function skillCall(name) {
    const now = performance.now();
    if (_callCd[name] && now - _callCd[name] < 900) return;
    _callCd[name] = now;
    G.skillCall = { name, t: 0, dur: 0.68 };   /* v2.9: 0.75→0.68s, 末 18% 淡出 → 实际"看得清"约 0.56s 后瞬间消失 */
  }
  function skExpAll(n){ const api = window.SkillAPI; if (api) api.addExpAll(n); }

  window.BattleAPI = {
    /* v3.2: 统一舞台接入点 ---- 返回 60-stage 契约层对象 { name, draw(ctx,W,H,dt) }。
     * 调用后本层不再自持 rAF，逻辑与绘制都由舞台按统一 30fps 驱动。
     * ⚠️ 舞台传进来的 dt 必须是原始 dt —— 倍速乘法留在 update() 内部。 */
    /* v4.1.2: 舞台接管时必须显式置 _managed —— 此前 initManaged 无人调用,
     * _managed 恒 false, 模块加载自启的独立泵从未停过(双泵: update 双跑=逻辑
     * 双倍速潜伏至今; GL 迁移后独立泵 frame(0,innerH) 可见 = 画面上下抖动)。 */
    createStageLayer: () => { _managed = true; _rafOn = false; return battleLayer(); },
    getKills: () => G.kills,
    resetKills: () => { G.kills = 0; },
    /* v3.4: 统一走 applySpeedBuff 的叠加规则（取 max 倍率 + 重置时长），
     * 不能再无条件赋值 —— 否则 ×3 期间被一个 ×2 直接顶掉，违反用户规则。 */
    triggerSpeedSkill: (mult, duration) => { if (mult<=1) return true; applySpeedBuff(mult, duration||5, 0); return true; },
    /* 倍速状态快照：给验收脚本读剩余时长用 */
    getSpeedState: () => ({ mult: G.speedMult, timer: G.speedMultTimer, dodge: G.speedDodge || 0 }),
    /* 兼容旧接口: 加速现在由「疾风步/缩地成寸」两个技能驱动 */
    trySpeedSkill: () => {
      const a = rollSpeedSkill('jifeng'), b = rollSpeedSkill('suodi');
      const hit = a || b;
      return hit ? { name: hit, mult: G.speedMult, duration: G.speedMultTimer } : null;
    },
    getSpeedMult: () => G.speedMult,
    /* v4.1.1 诊断口: 抖动取证 —— managed=true 且 pumpRuns 增长 = 双泵实锤 */
    __glDiag: () => ({ managed: _managed, rafOn: _rafOn, pumpRuns: _pumpRuns, paused: G.paused, gl: window.BattleGL ? window.BattleGL.diag : null }),
    /* v3.2 验收用：直接设定倍速（跳过技能随机 proc），让 A/B 对照可复现。
     * 传 1 即清除加速。 */
    __setSpeedMultForTest: (m, dur) => {
      G.speedMult = Math.max(1, m || 1);
      G.speedMultTimer = G.speedMult > 1 ? (dur || 30) : 0;
      if (G.speedMult <= 1) { G.speedDodge = 0; }
      updateHUD();
      return G.speedMult;
    },
    /* 主游戏注入玩家三围(境界+装备汇总后的面板值)
     * 注意: 必须同步进 p.atk / p.maxHp —— 战斗逻辑读的是 player 身上的字段,
     * 只更新 PST 会导致"面板数字涨了、打出去还是建号那把剑"(v2.5 回归修复)。 */
    setStats: (s) => {
      if (!s) return;
      PST = Object.assign(PST, s);
      if (G.player) {
        G.player.atk = PST.atk;
        G.player.maxHp = PST.hp;
        if (G.player.hp > PST.hp) G.player.hp = PST.hp;
        /* v2.5 功法攻速词条: 面板攻速(基础1.1×词条乘区, 主游戏侧已封顶3.0) → 同步进玩家,
         * 战斗节奏 atkT=1/aspd 随之加快; 无词条旧档回落 BC.playerAspd */
        G.player.aspd = Math.min(3, PST.aspd || BC.playerAspd);
      }
    },
    getStats: () => Object.assign({}, PST),
    /* 服务端下发掉落系数(每击杀产出) */
    setDropRates: (r) => { if (r) Object.assign(DROP, r); },
    getDropRates: () => Object.assign({}, DROP),
    onDrop: null,      // 主游戏赋值: ({spirit, elite, enemy}) => void
    getSpirit: () => G.spirit,
    /* 调参用调试口(只读快照) */
    debug: () => ({
      enemies: G.enemies.filter(e => e.alive && e.dying <= 0)
        .sort((a, b) => a.x - b.x).map(e => ({ t: e.type, x: Math.round(e.x), hp: Math.round(e.hp), maxHp: e.maxHp, elite: !!e.elite })),
      playerX: G.player ? Math.round(G.player.x) : 0, dodge: G.speedDodge, nextCrit: G.nextStrikeCrit,
      pAtk: G.player ? Math.round(G.player.atk) : 0, pMaxHp: G.player ? G.player.maxHp : 0,
      /* 只读攻击段状态(回归测试探针: 验证普攻单段/三连斩补刀/技能节拍) */
      anim: G.player ? {
        attacking: !!G.player.attackAnim, frame: G.player.animFrame,
        hit1: !!G.player.hit1, hit2: !!G.player.hit2, hit3: !!G.player.hit3,
        sanlian: !!G.player.sanlianTriggered, count: SPRITE.attackCount,
        skillAnim: !!G.player.skillAnim,
      } : null,
    }),
    addPet: (petDef) => {
      const pet = { id:petDef.id||'pet_'+Date.now(), name:petDef.name||'宠物', atk:petDef.atk||5, aspd:petDef.aspd||1.0, atkRange:petDef.atkRange||50, hp:petDef.hp||80, maxHp:petDef.hp||80, color:petDef.color||'#ffd76b', offsetX:petDef.offsetX||-30, offsetY:petDef.offsetY||0, x:0,y:0, atkT:Math.random()*0.5, anim:0, hurtT:0, alive:true };
      G.pets.push(pet); return pet;
    },
    removePet: (petId) => { G.pets = G.pets.filter(p => p.id !== petId); },
    getPets: () => G.pets,
    spawnWave: () => spawnWave(),
    /* v3.9 试炼轮次: 结算面板「再战一轮」入口 */
    trialRestart: () => trialRestart(),
    /* v2.9: 暂停时清掉限帧 sleep 句柄 —— 否则那枚 setTimeout 醒来时 G.paused 已为 true,
     * 会直接 return 且把 _rafOn 留成 true, 导致 resume 认为"泵还在跑"而不重启(死锁)。 */
    pause: () => { G.paused = true; if (_sleepT) { clearTimeout(_sleepT); _sleepT = 0; } _rafOn = false; },
    /* v4.0.1: _managed guard —— 舞台模式下 resume 只解 paused, 绝不重启独立泵。
     * 否则黑屏挂机(enterDim/exitDim)走一次 pause/resume 后, 独立 loop 与 60-stage
     * 双泵并存: 独立泵 frame(0, innerHeight) 把内容画到屏幕顶部, 60-stage 又画回
     * 横带 —— 战斗画面在顶部与横带间抖动(真机实测), 且 update 双跑=逻辑双倍速。
     * 2D 时代独立泵画的是 display:none 的 #battleCanvas, 该 bug 一直潜伏不可见。 */
    resume: () => { G.paused = false; lastT = performance.now(); _lastPaint = 0; if (_sleepT) { clearTimeout(_sleepT); _sleepT = 0; } if (!_managed && !_rafOn) { _rafOn = true; requestAnimationFrame(loop); } },
    getState: () => ({ kills:G.kills, spirit:G.spirit, speedMult:G.speedMult, state:G.state, playerHp:G.player?G.player.hp:0, pets:G.pets.length, enemies:G.enemies.filter(e=>e.alive).length }),
    /* v3.2 验收探针：战斗世界的内部时钟。
     * G.t 由 `G.t += dt * G.speedMult` 推进 —— 它是"倍速确实生效"的最直接证据，
     * 且与渲染解耦（渲染层收到的永远是原始 dt）。 */
    worldTime: () => G.t,
    camX: () => G.camX,
  };

  function makePlayer() {
    return { x:0,y:laneOff(1), lane:1, hp:PST.hp,maxHp:PST.hp, atk:PST.atk,aspd:BC.playerAspd, atkRange:BC.playerAtkRange, atkT:Math.random()*0.4, anim:0,hurtT:0,stun:0, walkT:Math.random()*6.28, moving:1, alive:true, animFrame:0, animTimer:0, attackAnim:false, attackTarget:null, hit1:false, hit2:false, hit3:false, sanlianTriggered:false, atkBuff:0, atkBuffTimer:0, skillAnim:false, skillFrame:0, skillTimer:0, skillHit:false, skillCooldown:0, skillTarget:null };
  }
  /* 怪物成长系统: 三围随玩家境界 lv 线性成长(怪只吃境界, 不吃装备 → 换装备=变快)。
   * v3.9 三维系统: 三围 = 境界基准 × 怪种hpK/atkK/defK × 波次tier倍率 ——
   * 怪包统一池, 每个境界都会刷到全怪种; 同一只怪随境界+波次档位三维缩放。 */
  function tierMul(t) { const d = BC.tier[t || G.trialTier || 1]; return d ? d.mul : 1; }
  /* v3.9.2 全量接入: makeEnemy 拆两层 —— makeEnemyFrom(合成def) 为实, BC.enemies 手配怪与
   * index.json 骨骼池怪(档位模板数值)共用同一条构造路径。 */
  function makeEnemyFrom(def, tierOverride, key) {
    const lv = Math.max(1, PST.lv || 1);
    const elite = Math.random() < DROP.eliteChance;
    const mul = tierMul(tierOverride);
    let hp  = Math.round((60 + 26*lv) * def.hpK * mul);
    let atk = Math.round((8 + 5*lv)   * def.atkK * mul);
    const dfn = Math.round((2 + 2*lv)   * def.defK * mul);
    if (elite) { hp = Math.round(hp*DROP.eliteHp); atk = Math.round(atk*1.2); }
    const lane = (Math.random() * LANES) | 0;   /* v3.7: 三车道随机刷怪 */
    const r = { type:key||def.bone||'bone',name:def.name,role:def.role, elite, lane, y:laneOff(lane), x:0, hp,maxHp:hp, atk, def:dfn,
      tier:tierOverride||def.tier||1, drawH:def.drawH||0, hpBarW:def.hpBarW||0,
      atkRange:def.atkRange, speed:def.speed*(0.9+Math.random()*0.2)*(elite?0.85:1), color:def.color,
      atkT:Math.random()*0.6, anim:0,hurtT:0,stun:0, alive:true,dying:0,reach:1, animFrame:0, animTimer:0, moving:false };
    /* 骨骼怪: 工厂就绪时建一只独立骨架实例(每只怪动画独立推进) */
    if (def.bone) {
      const B = BONES[def.bone];
      if (B && B.ready) {
        try { r.armature = B.factory.buildArmature(B.arm); r.boneSlug = def.bone; r.boneAnim = 'walk'; }
        catch (err) { console.error('[battle] buildArmature 失败', def.bone, err); }
      }
    }
    return r;
  }
  function makeEnemy(type, tierOverride) {
    return makeEnemyFrom(BC.enemies[type] || BC.enemies.slime, tierOverride, type);
  }
  /* v3.9.2 骨骼池怪: 数值按档位模板(同档同模板, 个体差异靠波次倍率), 名字暂用 slug 标题化(后续汉化) */
  function makeBoneEnemy(slug, tierOverride) {
    const t = tierOverride || 1;
    const tpl = BC.boneTpl[t] || BC.boneTpl[1];
    const cfg = BONE_IDX[slug] || {};
    const dh = cfg.drawH || 84;
    const def = { name: slug.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()),
      role:'melee', atkRange:34, speed:tpl.speed, hpK:tpl.hpK, atkK:tpl.atkK, defK:tpl.defK,
      color:'#9aa8b8', bone:slug, tier:t, drawH:dh, hpBarW:Math.max(24, Math.round(dh*0.55)) };
    return makeEnemyFrom(def, tierOverride);
  }
  function spawnWave() {
    /* BOSS活跃时不刷新小怪 */
    if (G.bossActive) return null;
    /* v3.9 试炼轮: BOSS = T5 妖皇波次的守关演出(120s 杀不满旧门槛100只, 改按档位触发);
     * 一轮只出一次 —— trialBossDone 拦重复, restart 时清零。 */
    if (G.smallKillsSinceBoss >= G.bossSpawnEvery || (G.trialTier >= 5 && !G.trialBossDone)) {
      if (G.enemies.filter(x => x.alive && x.dying <= 0).length >= BC.maxAlive) return null;
      const e = makeEnemy('boss');
      e.x = G.camX + stageW() + BC.enemySpawnOffset;
      e.elite = true;  /* BOSS标记为精英 */
      e.lane = 1; e.y = laneOff(1);   /* BOSS 固定中道, 突出存在感 */
      G.enemies.push(e);
      G.bossActive = true;
      G.smallKillsSinceBoss = 0;
      G.trialBossDone = true;
      return e;
    }
    /* v3.9 怪包统一池 = 手配怪(BC.enemies, 自带 w 权重) + 骨骼池怪(BONE_POOL, 全量 79 只按文档档位)。
     * 池 = tier<=当前档的全部怪; 当前档怪权重 ×3(主流), 低档怪保底出现(越打怪越杂越强)。
     * 骨骼池怪统一 w=10 —— 池子大, 单只出现频率低但种类多, 全量怪都能刷到。 */
    const cur = G.trialTier || 1;
    const entries = [];
    for (const [t, d] of Object.entries(BC.enemies)) {
      if (t === 'boss' || !d || (d.tier || 1) > cur) continue;
      entries.push({ kind:'hand', key:t, w:(d.w || 1) * ((d.tier || 1) === cur ? 3 : 1) });
    }
    for (let t = 1; t <= cur; t++) {
      const mul = (t === cur) ? 3 : 1;
      for (const slug of BONE_POOL[t]) entries.push({ kind:'bone', key:slug, w:10 * mul });
    }
    const twAll = entries.reduce((s,e2) => s + e2.w, 0);
    let rr = Math.random() * twAll, pick2 = entries[0];
    for (const e2 of entries) { rr -= e2.w; if (rr <= 0) { pick2 = e2; break; } }
    if (G.enemies.filter(x => x.alive && x.dying <= 0).length >= BC.maxAlive) return null;
    const e = pick2.kind === 'bone' ? makeBoneEnemy(pick2.key, G.trialTier) : makeEnemy(pick2.key, G.trialTier);   /* v3.9 三维: 小怪按当前档位缩放 */
    e.x = G.camX + stageW() + BC.enemySpawnOffset;
    G.enemies.push(e);
    return e;
  }
  /* ---------- 数值伤害: 减伤系数 100/(100+有效防御), 破甲按百分比削减防御 ---------- */
  function calcDmg(atk, mult, def, pen) {
    const eff = Math.max(0, (def||0) * (1 - Math.min(90, pen||0)/100));
    return Math.max(1, Math.round(atk * mult * (100/(100+eff))));
  }
  /* 玩家暴击/会心判定: 读装备词条(PST.crit 暴击率 / PST.critB 会心率 / PST.critD 爆伤);
   * kind=2 暴击(×2)、kind=1 会心(×1.5)、mult 含爆伤增幅; bonus 为技能临时加的暴击率 */
  function playerCritRoll(bonus) {
    let kind = 0;
    if (Math.random()*100 < (PST.crit || 0) + (bonus || 0)) kind = 2;
    else if (Math.random()*100 < (PST.critB || 0)) kind = 1;
    const cmul = kind === 2 ? 2 : kind === 1 ? 1.5 : 1;
    return { kind, cmul, crit: kind > 0, mult: kind ? cmul * (1 + (PST.critD || 0)/100) : 1 };
  }
  /* ---------- 倍速叠加唯一入口（v3.4）----------------------------------
   * 用户规则原文：
   *   「二倍速、三倍速持续期间也可以获得 buff，只不过会把时间重置。
   *     二倍速期间也可以获得三倍速 buff，但不要叠加成 5 倍。
   *     三倍速同样道理，也可以获得后重置。」
   *
   * 提炼成两条不变量，所有授予倍速的路径都必须走这里：
   *   1) 倍率 = max(当前, 新的)   —— 单调不减，永远不存在 ×5（2×3 是乘法的错）
   *   2) 时长 = 本次技能满时长     —— "重置"而非"延长"，不吃 max 叠加
   *
   * 为什么把 dodge 也收进来：身法是"倍率+闪避"一体的，闪避同样只取高者，
   * 免得出现"倍率被 ×3 盖住、闪避却按 ×2 挂着"的精神分裂状态。 */
  function applySpeedBuff(mult, dur, dodge) {
    G.speedMult = Math.max(G.speedMult, mult || 1);
    G.speedDodge = Math.max(G.speedDodge || 0, dodge || 0);
    G.speedMultTimer = dur;        /* 重置时间轴，不做 max 延长 */
    return G.speedMult;
  }

  /* ---------- 身法技能(疾风步 2x / 缩地成寸 3x): 独立 roll, 取高者, 时长可刷新 ----------
   * 身法不是光环: 只在生效的那几秒里加闪避(身形飘忽), 时效一到即散, 不进面板属性 */
  function rollSpeedSkill(id) {
    const s = skVal(id);
    if (!s || Math.random()*100 >= s.chance) return null;
    skExp(id, 3);
    applySpeedBuff(s.mult, s.dur, s.dodge);
    /* v3.4 倍速叠加规则（用户明确要求）：
     *   · ×2 生效期间【也能】触发 ×2 → 时长重置（回满 dur），倍率不变，不会变成 ×4
     *   · ×2 生效期间【也能】触发 ×3 → 取高者，直接升到 ×3，但【绝不叠成 ×5】
     *   · ×3 期间触发 ×2 → 已被更高的盖住，倍率保持 ×3，但时长照样重置
     *   · ×3 期间触发 ×3 → 时长重置
     * 一句话：倍率永远取 max(旧, 新)，时长永远重置为本次技能满时长。
     * 旧代码用 `s.mult >= G.speedMult || G.speedMultTimer <= 0` 做门槛，会导致
     * ×2 期间再触发 ×2 被静默丢弃（buff 白放）；现在改为无条件取 max。 */
    G.speedMult = Math.max(G.speedMult, s.mult);
    G.speedDodge = Math.max(G.speedDodge || 0, s.dodge || 0);
    G.speedMultTimer = s.dur;   /* 重置时间，而不是 max 延长 */
    skillCall(id === 'jifeng' ? '疾风步' : '缩地成寸');   /* 身法播报 */
    /* 身法触发特效: 玩家位置速度爆发 */
    if (G.player) {
      G.fx.push({ kind:'speedBurst', x:G.player.x, y:G.player.y-20, color: id==='suodi' ? '#a0d8ff' : '#80ffc0', t:0, dur:0.5 });  /* v3.7.2 y带玩家车道偏移 */
    }
    updateHUD();
    return id;
  }
  /* ---------- 击杀结算: 灵石 + (装备由主游戏 roll) + 技能经验 + 追猎/加速 ---------- */
  function onKill(e) {
    const isBoss = e.type === 'boss';
    /* BOSS/小怪击杀计数 */
    if (isBoss) {
      G.bossActive = false;
      G.smallKillsSinceBoss = 0;
    } else {
      G.smallKillsSinceBoss++;
    }
    /* v3.9 试炼计数: 轮内击杀推进波次档位(T1→T5), 结算进纪录 */
    if (!isBoss && !G.trialSettled) {
      G.trialKills++; G.tierKills++;
      const need = tierNeed(G.trialTier);
      if (G.trialTier < 5 && G.tierKills >= need) {
        G.tierKills = 0; G.trialTier++;
        const td = BC.tier[G.trialTier];
        skillCall('妖潮 · ' + td.name);
      }
      updateHUD();
    }
    const mul = e.elite ? DROP.eliteMul : 1;
    const jitter = 1 - DROP.spiritRand + Math.random()*DROP.spiritRand*2;
    /* v2.5 BOSS 专属产出: 灵石在精英倍率上再 ×8 */
    const sp = Math.max(1, Math.round((DROP.spiritBase + DROP.spiritPerLv*(PST.lv||1)) * jitter * mul * (isBoss ? 8 : 1)));
    spawnSpiritDrop(e, sp, e.elite);                       // 灵石落在地板, 隔1~2秒飞向顶部统计区
    /* 装备掉落: 先在游戏侧 roll 出具体部件(图标/品质), 由飞行宠物飞去拾取入包
     * v2.5 BOSS 必掉一件(品质照常按境界权重 roll, 不保底——BOSS 刷新频繁, 保底会灌金装) */
    try {
      const eq = (window.BattleAPI && window.BattleAPI.requestEquipDrop)
        ? window.BattleAPI.requestEquipDrop({ elite: !!e.elite, boss: isBoss, enemy: e.name }) : null;
      if (eq) spawnEquipDrop(e, eq);
    } catch (err) {}
    skExpAll(isBoss ? 30 : 2);         // 每杀全体技能+2; BOSS 击杀全体+30
    rollSpeedSkill('jifeng');
    rollSpeedSkill('suodi');
    const zl = skVal('zhuilie');       // 追猎: 击杀后立刻再出手一次, 衔尾一击暴击率大增
    if (zl && Math.random()*100 < zl.chance) {
      skExp('zhuilie', 3); G.extraStrike = true; G.nextStrikeCrit = zl.crit || 0;
      skillCall('追猎');
    }
  }
  /* ---------- 掉落物: 灵石/装备落在地板; 灵石飞向顶部统计区; 装备由飞行宠物拾取 ---------- */
  const QUALITY_COLOR = ['#aab2c0', '#6b9df5', '#3fc9a2', '#e0b45a', '#c08af0', '#ff5257'];
  function dropRarityColor(q) { return QUALITY_COLOR[Math.max(0, Math.min(5, q | 0))] || '#aab2c0'; }
  function hudTarget() {                          // 顶部统计区"灵石"数字位置(canvas 局部坐标)
    const el = document.getElementById('battleSpirit');
    if (el && cv) { const r = el.getBoundingClientRect(), c = cv.getBoundingClientRect(); return { x: r.left + r.width / 2 - c.left, y: r.top + r.height / 2 - c.top }; }
    return { x: CW * 0.5, y: 20 };
  }
  function spawnSpiritDrop(e, val, elite) {
    if (G.drops.filter(d => d.kind === 'spirit').length >= 14) {   // 过载: 直接入账, 跳过飞行动画
      G.spirit += val;
      try { if (window.BattleAPI.onDrop) window.BattleAPI.onDrop({ spirit: val, elite: !!elite, enemy: e.name }); } catch (err) {}
      return;
    }
    G.drops.push({ kind: 'spirit', wx: e.x, x: worldToScreen(e.x), y: floorY() + e.y - 12, gy: e.y, vy: -70,
      val, elite: !!elite, enemy: e.name, t: 0, flyAt: 1.0 + Math.random() * 0.8, phase: 'land' });
  }
  function spawnEquipDrop(e, eq) {
    const img = new Image(); img.src = eq.icon; img.onerror = function () {};
    G.drops.push({ kind: 'equip', wx: e.x, x: worldToScreen(e.x), y: floorY() + e.y - 14, gy: e.y, vy: -80,
      eq, img, t: 0, t2: 0, scale: 0, phase: 'wait', claimed: false });
  }
  function updateDrops(dt) {
    for (let i = G.drops.length - 1; i >= 0; i--) {
      const d = G.drops[i];
      d.t += dt;
      if (d.kind === 'spirit') {
        if (d.phase === 'land') {
          d.x = worldToScreen(d.wx); d.y += d.vy * dt; d.vy += 320 * dt;
          const fy = floorY() + (d.gy || 0) - 12;   /* v3.7: 落在自己车道上 */
          if (d.y >= fy) { d.y = fy; d.vy = 0; d.phase = 'wait'; }
        } else if (d.phase === 'wait') {
          d.x = worldToScreen(d.wx);
          if (d.t >= d.flyAt) { d.phase = 'fly'; d.target = hudTarget(); }
        } else if (d.phase === 'fly') {
          const tx = d.target.x, ty = d.target.y, dx = tx - d.x, dy = ty - d.y, dist = Math.hypot(dx, dy);
          const sp = 460;
          if (dist <= sp * dt || dist < 12) {
            G.spirit += d.val;
            try { if (window.BattleAPI.onDrop) window.BattleAPI.onDrop({ spirit: d.val, elite: d.elite, enemy: d.enemy }); } catch (err) {}
            G.drops.splice(i, 1);
          } else { d.x += dx / dist * sp * dt; d.y += dy / dist * sp * dt; }
        }
      } else {                                    // equip
        if (d.phase === 'done') { G.drops.splice(i, 1); continue; }
        if (d.phase === 'wait' || d.phase === 'fetch') {
          d.x = worldToScreen(d.wx);
          if (d.phase === 'wait') d.scale = Math.min(1, d.scale + dt * 5);
          if (d.t > 15) {                         // 安全兜底: 长时间无人拾取直接入包
            try { if (window.BattleAPI.applyEquipDrop) window.BattleAPI.applyEquipDrop(d.eq.id); } catch (err) {}
            d.phase = 'done'; G.drops.splice(i, 1);
          }
        } else if (d.phase === 'carry') {
          d.scale = Math.max(0.12, d.scale - dt * 1.2); d.t2 += dt;
        }
      }
    }
  }
  /* v4.0 WebGL: '#rrggbb' → 0xRRGGBB（带缓存） */
  function colorInt(css) {
    const c = colorInt._c || (colorInt._c = {});
    let v = c[css];
    if (v === undefined) {
      let s = css.replace('#', '');
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      v = c[css] = parseInt(s, 16) | 0;
    }
    return v;
  }
  function drawGem(g, x, y, r, fill, hi) {
    g.beginFill(fill, 1);
    g.moveTo(x, y - r); g.lineTo(x + r * 0.72, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.72, y); g.closePath();
    g.endFill();
    g.beginFill(hi, 1);
    g.moveTo(x, y - r); g.lineTo(x + r * 0.72, y); g.lineTo(x, y); g.closePath();
    g.endFill();
  }
  function drawDrops() {
    /* v4.0 WebGL: 每个掉落一个池化 Container（跟随 d 生命周期 destroy）。
     * spirit = Graphics 脉冲重画; equip = 阴影 Graphics + body(描边圈/圆裁图标)。 */
    const dropsC = window.BattleGL.layers.drops;
    const pool = drawDrops._pool || (drawDrops._pool = []);
    for (const o of pool) o.__used = false;
    for (const d of G.drops) {
      if (d.phase === 'done') continue;
      let o = d.__gl;
      if (!o) {
        o = d.__gl = { __used: true, c: new PIXI.Container(), g: new PIXI.Graphics() };
        o.c.addChild(o.g);
        dropsC.addChild(o.c);
        pool.push(o);
      }
      o.__used = true;
      o.c.visible = true;
      o.c.position.set(d.x, d.y);
      o.c.alpha = 1;
      o.g.clear();
      if (d.kind === 'spirit') {
        const pulse = 1 + Math.sin(d.t * 6) * 0.08;
        o.c.alpha = d.phase === 'fly' ? 0.92 : 1;
        o.g.beginFill(0x67c9ab, 0.28);
        o.g.drawCircle(0, 0, 9 * pulse);
        o.g.endFill();
        drawGem(o.g, 0, 0, 7 * pulse, 0x67c9ab, 0xb7ecda);
      } else {
        const sc = d.scale;
        if (sc <= 0.02) { o.c.visible = false; continue; }
        /* 贴地阴影(未起飞时) —— 画在容器外那层, 阴影不随本体缩放/浮起 */
        if (d.phase === 'wait' || d.phase === 'fetch' || d.phase === 'land') {
          o.g.beginFill(0x000000, 0.22);
          o.g.drawEllipse(0, floorY() + (d.gy || 0) - 4 - d.y, 10 * sc, 3 * sc);
          o.g.endFill();
        }
        if (!o.body) {
          o.body = new PIXI.Container();
          o.g2 = new PIXI.Graphics();
          o.iconMask = new PIXI.Graphics();
          o.iconMask.beginFill(0xffffff).drawCircle(0, 0, 12).endFill();
          o.icon = new PIXI.Sprite();
          o.icon.anchor.set(0.5);
          o.icon.width = 24; o.icon.height = 24;
          o.body.addChild(o.g2);
          o.body.addChild(o.iconMask);
          o.body.addChild(o.icon);
          o.icon.mask = o.iconMask;   /* 图标裁成圆形宝珠(素材自带深色方底) */
          o.c.addChild(o.body);
        }
        o.body.visible = true;
        o.body.y = -14 * sc;
        o.body.scale.set(sc);
        const rc = colorInt(dropRarityColor(d.eq.q));
        o.g2.clear();
        o.g2.lineStyle(2, rc, 0.5);
        o.g2.drawCircle(0, 0, 14);
        o.g2.lineStyle(0);
        if (d.img && d.img.complete && d.img.naturalWidth) {
          o.icon.visible = true;
          o.icon.texture = window.BattleGL.tex(d.img);
        } else {
          o.icon.visible = false;
          o.g2.beginFill(rc, 1);
          o.g2.drawRoundedRect(-11, -11, 22, 22, 4);
          o.g2.endFill();
        }
      }
    }
    /* 对账回收: 掉落已被 splice 的池对象销毁(防 GL 显存泄漏) */
    for (let i = pool.length - 1; i >= 0; i--) {
      const o = pool[i];
      if (o.__used) continue;
      o.c.destroy({ children: true });
      pool.splice(i, 1);
    }
  }
  /* ---------- 玩家一次命中(段1/段2)的全部技能判定 ----------
   * 技能的加成只作用于"打出去的那一下": 攻击倍率 / 会心 / 暴击 / 破甲 ——
   * 一律不写回面板属性(不做常驻光环), 攻防血仍只由境界与装备决定。 */
  function playerStrike(p, target, seg) {
    if (!target || !target.alive) return;
    /* v2.8 普攻单段: 主段(seg1)一次全额; 三连斩的 seg2/seg3 是同一轮攻击内的补刀,
     * 各按自己的节奏给倍率, 不再出现"两段各全额"把普攻 DPS 顶到技能之上 */
    let base = seg === 3 ? 1 : seg === 2 ? (0.5 + Math.random()*0.15) : (1.0 + Math.random()*0.25);
    let pen = PST.pen || 0;
    /* 破甲击: 这一击无视目标 Y% 防御 */
    const pj = skVal('pojia');
    if (pj && Math.random()*100 < pj.chance) {
      pen = Math.min(90, pen + pj.pen); skExp('pojia', 2); skillCall('破甲击');
      G.fx.push({ kind:'hitSpark', x:target.x, y:target.y-20, color:'#ffd76b', t:0, dur:0.3 });
    }
    /* 斩杀: 目标残血(低于 X%)时, 这一击伤害翻倍 */
    const zs = skVal('zhansha');
    if (zs && target.hp / target.maxHp * 100 < zs.threshold) { base *= 2; skExp('zhansha', 2); skillCall('斩杀'); }
    /* 会心(×1.5) / 暴击(×2.0) / 爆伤增幅(critD%); 追猎的衔尾一击额外加暴击率 */
    const critBonus = G.nextStrikeCrit; G.nextStrikeCrit = 0;
    let kind = 0;
    if (seg === 3) {
      /* 三连斩第三段: 补刀必会心(至少×1.5) */
      kind = 1;
    } else if (Math.random()*100 < (PST.crit || 0) + critBonus) kind = 2;
    else if (Math.random()*100 < (PST.critB || 0)) kind = 1;
    const cmul = kind === 2 ? 2 : kind === 1 ? 1.5 : 1;
    /* 三连斩第三段伤害倍率: sl.dmg 是"这一补刀相对本段的加成", 不是整段倍率替代 */
    const sl = seg === 3 ? skVal('sanlian') : null;
    const slMult = sl ? (sl.dmg || 0) / 100 : 1;
    const mult = base * slMult * (kind ? cmul * (1 + (PST.critD || 0)/100) : 1);
    const big = kind === 2;
    dealDamage(target, calcDmg(PST.atk, mult, target.def, pen), seg === 3 ? '#ffe7a8' : (kind ? '#ffd76b' : '#7fe0ff'), big);
    /* 横扫千军: 普攻命中即触发, 即使目标被打死也播放特效波及周围。
     * v2.9 FIX: 横扫走"本段基础倍率"(base), 不再叠乘会心/爆伤/三连斩加成 ——
     * 原实现沿用 mult 导致每段命中都再乘一次会心/补刀倍率, 一轮三连斩里横扫触发 2~3 次、
     * 单轮总伤冲到 12x 攻击力(实测), 反超技能单发, 这才是"技能没普攻伤害高"的真凶。 */
    const hs = skVal('hengsao');
    if (hs && Math.random()*100 < hs.chance) {
      skExp('hengsao', 2); skillCall('横扫千军');
      G.fx.push({ kind:'hengsao', x:p.x, y:p.y-30, color:'#ffc98a', t:0, dur:0.30, frame:0, startX:p.x, endX:p.x+200 });  /* v3.7.2 y带玩家车道偏移(原固定-30永远画在中道); v2.9 再提速: 0.6→0.38→0.30s, 起手即爆 */
      playSfx('hengsao', 0.8);
      const n = Math.max(1, Math.round(hs.n || 1));
      let hit = 0;
      for (const o of G.enemies) {
        if (hit >= n) break;
        if (o === target || !o.alive || o.dying > 0) continue;
        /* v3.7.2 三车道: 剑气只扫玩家本道, 扫程与特效一致(起手前20px~扫末230px); 原按全场x距离跨道波及 */
        if (o.lane !== p.lane) continue;
        if (o.x < p.x - 20 || o.x > p.x + 230) continue;
        dealDamage(o, calcDmg(PST.atk, base*(hs.dmg||0)/100, o.def, pen), '#ffc98a', false);
        hit++;
      }
    }
    if (!target.alive) return;
    /* 剑气斩: 追加一段自带攻击力加成的剑气(同样只吃本段基础倍率) */
    const jq = skVal('jianqi');
    if (jq && Math.random()*100 < jq.chance) {
      skExp('jianqi', 2); skillCall('剑气斩');
      G.fx.push({ kind:'slash', x:target.x, y:target.y-24, color:'#bfe8ff', t:0, dur:0.28 });
      dealDamage(target, calcDmg(PST.atk, base*(jq.dmg||0)/100, target.def, pen), '#bfe8ff', false);
      if (!target.alive) return;
    }
  }
  /* v3.7: 寻怪限定车道 —— 同道才算"可打目标"; 跨道由玩家换道解决(见 updatePlayer 寻道块) */
  function findNearestEnemy(lane, fromX, maxDist) {
    let best=null, bestD=maxDist||Infinity;
    for (const e of G.enemies) { if (!e.alive||e.dying>0||e.lane!==lane) continue; const d=Math.abs(e.x-fromX); if (d<bestD){bestD=d;best=e;} }
    return best;
  }
  function dealDamage(target, amount, color, crit) {
    target.hp -= amount; target.hurtT = 0.25;
    G.dmg.push({ x:target.x,y:target.y-40, val:Math.round(amount), crit:crit||false, color:color||'#e8f2fa', t:0, vx:(Math.random()-0.5)*18 });
    G.fx.push({ kind:'hitSpark', x:target.x,y:target.y-20, color:color||'#fff', t:0,dur:0.3 });
    if (target.hp <= 0) {
      target.hp=0; target.alive=false; target.dying=0.4;
      G.kills++;
      G.fx.push({ kind:'death', x:target.x,y:target.y-15, color:target.color, t:0,dur:0.4 });
      onKill(target);
      updateHUD();
    }
  }
  function updatePlayer(dt) {
    const p = G.player;
    if (!p.alive) return;
    p.atkT -= dt; p.anim = Math.max(0, p.anim-dt*1.5); p.hurtT = Math.max(0, p.hurtT-dt); p.stun = Math.max(0, p.stun-dt*3);
    p.skillCooldown = Math.max(0, p.skillCooldown - dt);

    /* 技能动画更新 (剑气斩) */
    if (p.skillAnim) {
      p.skillTimer += dt;
      const skillFrameDur = 1 / SKILL.fps;
      while (p.skillTimer >= skillFrameDur) {
        p.skillTimer -= skillFrameDur;
        p.skillFrame++;
      }
      /* 技能伤害判定: 第12帧 (剑气月牙出现时) */
      if (p.skillFrame >= SKILL.hitFrame && !p.skillHit && p.skillTarget && p.skillTarget.alive) {
        p.skillHit = true;
        playSfx('skill_attack', 0.9);  /* 剑气斩专属攻击音效 */
        const r = playerCritRoll(0);                       // 读装备暴击/会心/爆伤
        const atkMult = (1 + (p.atkBuff || 0)) * SKILL.damageMult;
        const dmg = calcDmg(p.atk, atkMult * (0.9 + Math.random()*0.2) * r.mult, p.skillTarget.def, PST.pen || 0);
        dealDamage(p.skillTarget, dmg, '#bfe8ff', r.crit);
        /* 剑气斩范围伤害: 波及本道周围敌人(剑气只在玩家所在车道, 原按全场x距离跨道波及) */
        for (const o of G.enemies) {
          if (o === p.skillTarget || !o.alive || o.dying > 0) continue;
          if (o.lane !== p.lane) continue;
          if (Math.abs(o.x - p.x) <= p.atkRange + 80) {
            const dmg2 = calcDmg(p.atk, atkMult * 0.5 * (0.9 + Math.random()*0.2), o.def, PST.pen || 0);
            dealDamage(o, dmg2, '#bfe8ff', false);
          }
        }
      }
      /* 技能动画结束 */
      if (p.skillFrame >= SKILL.count) {
        p.skillAnim = false; p.skillFrame = 0; p.skillTimer = 0; p.skillHit = false; p.skillTarget = null;
        p.skillCooldown = SKILL.cooldown;
      }
      return;  /* 技能动画期间不执行普通攻击逻辑 */
    }

    /* 动画帧更新 + 双段攻击伤害判定 */
    /* v2.6 攻速生效: 攻击动画帧速率随攻速等比加快(以基础 1.1 为锚点)。
     * 否则 40帧@24fps≈1.67s 的固定动画时长主导实际出手节奏, 攻速词条形同虚设;
     * 按锚点缩放后实际出手周期 = 1.67/aspd, 基础节奏不变, 高攻速真实变快 */
    p.animTimer += dt;
    const frameDur = p.attackAnim ? 1 / (SPRITE.fps * (p.aspd || 1.1) / 1.1)
                                  : 1 / SPRITE.fps;
    if (p.animTimer >= frameDur) {
      p.animTimer -= frameDur;
      if (p.attackAnim) {
        p.animFrame++;
        /* v2.8 攻击动画抽帧: 原 40 帧(起手8 + 首剑刺出10~26 + 收势26~39, 末段 11 帧纯收势)裁到 24 帧。
         * 普攻 = 起手(0~9) + 第一剑刺出(10~13) + 收剑(14~23) 一段判定;
         * 三连斩触发时在收剑段插入第二剑 + 补刀(帧 18 / 22), 观感"一剑+补两刀", 不再有两段全额伤害。 */
        if (p.animFrame === 8) playSfx('attack1', 0.7);
        /* 普攻主段: 第一剑刺出, 帧 12 判定一次(全额) */
        if (p.animFrame === 12 && !p.hit1 && p.attackTarget && p.attackTarget.alive) {
          p.hit1 = true;
          if (Math.abs(p.attackTarget.x - p.x) <= p.atkRange + 15) {
            playerStrike(p, p.attackTarget, 1);
            /* 三连斩: 主段命中即 roll 补刀(第二剑 + 第三刀) */
            const sl = skVal('sanlian');
            if (sl && p.attackTarget.alive && Math.random()*100 < sl.chance) {
              p.sanlianTriggered = true;
              skExp('sanlian', 2);
              skillCall('三连斩');
            }
            /* 主段刺死就收招, 不再补刀 */
            if (!p.attackTarget.alive) {
              p.attackAnim = false; p.animFrame = 0; p.attackTarget = null; p.hit1 = false; p.hit2 = false; p.hit3 = false; p.sanlianTriggered = false;
              /* v2.5 基础攻速: 秒杀中断也吃满攻击间隔 —— 否则高攻秒怪时只剩 ~0.5s/杀的连环速攻 */
              p.atkT = Math.max(p.atkT, 1 / p.aspd);
              if (G.extraStrike) { G.extraStrike = false; p.atkT = 0; }   // 追猎: 立刻再出手(技能特性保留)
            }
          }
        }
        /* 三连斩第二剑: 帧 18, 追加一段(走 seg=2, 非全额基数, 只是补刀的第二下) */
        if (p.animFrame === 18 && p.sanlianTriggered && !p.hit2 && p.attackTarget && p.attackTarget.alive) {
          p.hit2 = true;
          if (Math.abs(p.attackTarget.x - p.x) <= p.atkRange + 15) {
            playSfx('attack2', 0.8);
            playerStrike(p, p.attackTarget, 2);
          }
        }
        /* 三连斩补刀(第三刀): 帧 22, 必会心(至少×1.5) */
        if (p.animFrame === 22 && p.sanlianTriggered && !p.hit3 && p.attackTarget && p.attackTarget.alive) {
          p.hit3 = true;
          if (Math.abs(p.attackTarget.x - p.x) <= p.atkRange + 15) {
            playerStrike(p, p.attackTarget, 3);
          }
        }
        if (p.animFrame >= SPRITE.attackCount) {
          p.attackAnim = false; p.animFrame = 0; p.attackTarget = null; p.hit1 = false; p.hit2 = false; p.hit3 = false; p.sanlianTriggered = false;
          if (G.extraStrike) { G.extraStrike = false; p.atkT = 0; }        // 追猎: 立刻再出手
        }
      } else {
        p.animFrame = (p.animFrame + 1) % SPRITE.walkCount;
        /* 脚步声同步: walk第18帧(源帧22) */
        if (p.animFrame === 18 && p.moving) playSfx('footstep', 0.5);
      }
    }
    /* v3.7 三车道寻道: 攻击/技能动画不打断; 本道还有活怪就就地清, 清空了才换到
     * "最近有怪"的车道; 三道全清回中道(中间起步位, 视觉均衡)。
     * 换道只改 p.lane, 纵向位移由下面的 y 平滑过渡完成 —— 走位感而不是瞬移。 */
    if (!p.attackAnim && !p.skillAnim) {
      const sameLaneAlive = G.enemies.some(e => e.alive && e.dying <= 0 && e.lane === p.lane);
      if (!sameLaneAlive) {
        let best = -1, bestD = Infinity;
        for (let L = 0; L < LANES; L++) {
          if (L === p.lane) continue;
          const e = findNearestEnemy(L, p.x, Infinity);
          if (e) { const d = Math.abs(e.x - p.x); if (d < bestD) { bestD = d; best = L; } }
        }
        p.lane = best >= 0 ? best : 1;
      }
    }
    /* 车道 y 平滑过渡(带轻微跳跃弧线: 换道时先快后慢) */
    p.y += (laneOff(p.lane) - p.y) * Math.min(1, dt * 7);

    const near = findNearestEnemy(p.lane, p.x, p.atkRange+200);
    /* 攻击动画播放期间不中断，保持攻击状态 */
    if (p.attackAnim) {
      p.moving = 0;
    } else if (near && Math.abs(near.x-p.x) <= p.atkRange+5) {
      /* 进入攻击范围，开始攻击（触发时不立即造成伤害，伤害在动画帧中触发） */
      p.moving = 0;
      if (p.atkT <= 0) {
        /* 出手前判定: 到出手时机, 先掷技能(冷却好+概率), 中了走技能, 否则走普攻。
         * 两者互斥二选一 —— 干净、可预期, 一次出手对应一次判定。 */
        if (p.skillCooldown <= 0 && G.skillReady && Math.random() < SKILL.triggerChance) {
          p.skillAnim = true; p.skillFrame = 0; p.skillTimer = 0; p.skillHit = false; p.skillTarget = near;
          p.attackAnim = false; p.animFrame = 0;
          skillCall(SKILL.name);          /* 大技能播报 */
        } else {
          p.anim = 1; p.atkT = 1/p.aspd; p.attackAnim = true; p.animFrame = 0; p.animTimer = 0; p.attackTarget = near; p.hit1 = false; p.hit2 = false; p.hit3 = false; p.sanlianTriggered = false;
        }
      }
    } else if (near) {
      /* 有怪但不在攻击范围，向怪移动 */
      p.moving = 1; p.walkT += dt*8;
      const targetX = near.x - p.atkRange*0.85;
      p.x += Math.sign(targetX-p.x)*Math.min(Math.abs(targetX-p.x), BC.playerSpeed*1.5*dt);
    } else {
      /* v3.8.1 无怪(攻击视野内)时向前推进 —— 防穿越: 玩家若从站位怪身上走过,
       * 怪会留在玩家左侧(面朝左)永远"对着空气咬"。推进不许越过本道任何活怪。 */
      p.moving = 1; p.walkT += dt*8; p.x += BC.playerSpeed*dt;
      let nearest = Infinity;
      for (const e of G.enemies) {
        if (e.alive && e.dying <= 0 && e.lane === p.lane && e.x > p.x - 1 && e.x < nearest) nearest = e.x;
      }
      if (nearest < Infinity) p.x = Math.min(p.x, nearest - p.atkRange*0.5);
    }
  }
  function updatePets(dt) {
    const p = G.player;
    for (const pet of G.pets) {
      if (!pet.alive) continue;
      /* 朝向: 按水平移动方向决定是否镜像(素材默认头朝右)
       * v3.4 bugfix —— 旧代码用固定阈值 0.4px 判方向：
       *   pet.x > lastX + 0.4 → face=1
       *   平稳跟随阶段每帧位移只有 0.2~0.5px（临界），于是"向左飞"经常够不到
       *   0.4 这个门限，face 就卡在上一帧的值不动 —— 表现为"归位后朝向随机不对"。
       * 现在改成：累积位移跨过门限才转向，并且【位移足够大时直接把朝向钉死】。
       * 门限同时按 dt 缩放，保证不同帧率下手感一致。 */
      const dxFrame = pet.x - (pet.lastX ?? pet.x);
      pet.faceAcc = (pet.faceAcc || 0) + dxFrame;
      const faceThresh = Math.max(0.6, 12 * dt);   /* 约 12px/秒 的死区，足够小到不迟钝 */
      if (pet.faceAcc > faceThresh) { pet.face = 1; pet.faceAcc = 0; }         /* 向右 → 原素材 */
      else if (pet.faceAcc < -faceThresh) { pet.face = -1; pet.faceAcc = 0; }  /* 向左 → 镜像 */
      /* 瞬时大位移（拾取飞扑/瞬移归位）直接钉朝向，不等累积 */
      if (Math.abs(dxFrame) > 4) { pet.face = dxFrame > 0 ? 1 : -1; pet.faceAcc = 0; }
      pet.lastX = pet.x;
      /* 飞行动画帧更新 */
      pet.flyTimer += dt;
      const frameDur = 1 / 24;
      if (pet.flyTimer >= frameDur) {
        pet.flyTimer -= frameDur;
        pet.flyFrame = (pet.flyFrame + 1) % 32;
      }
      /* 拾取装备: 飞行宠物飞向地板掉落, 拾起后缩小带回, 抵达即入包 */
      if (pet.fetch && pet.fetch.state === 'toDrop') {
        const d = pet.fetch.drop;
        if (!d || d.phase === 'done') { pet.fetch.state = 'idle'; pet.fetch.drop = null; }
        else {
          const dx = d.wx - pet.x, dy = (d.y - 16) - pet.y, dist = Math.hypot(dx, dy), spd = 560;
          if (dist <= spd * dt || dist < 10) { pet.x = d.wx; pet.y = d.y - 16; d.phase = 'carry'; d.t2 = 0; pet.fetch.state = 'carry'; }
          else { pet.x += dx / dist * spd * dt; pet.y += dy / dist * spd * dt; }
          continue;
        }
      }
      if (pet.fetch && pet.fetch.state === 'carry') {
        const d = pet.fetch.drop;
        const tx = p.x + pet.offsetX, ty = floorY() + p.y + pet.offsetY, dx = tx - pet.x, dy = ty - pet.y, dist = Math.hypot(dx, dy), spd = 380;
        if (dist <= spd * dt || dist < 8) { pet.x = tx; pet.y = ty; }
        else { pet.x += dx / dist * spd * dt; pet.y += dy / dist * spd * dt; }
        d.x = worldToScreen(pet.x); d.y = pet.y - 6;             // 装备贴在宠物身上
        if (d.t2 >= 0.7) {
          try { if (window.BattleAPI.applyEquipDrop) window.BattleAPI.applyEquipDrop(d.eq.id); } catch (err) {}
          d.phase = 'done'; pet.fetch.state = 'idle'; pet.fetch.drop = null;
        }
        continue;
      }
      /* 空闲宠物认领待拾装备 */
      if (!pet.fetch || pet.fetch.state === 'idle') {
        const d = G.drops.find(x => x.kind === 'equip' && x.phase === 'wait' && !x.claimed);
        if (d) { d.claimed = true; d.phase = 'fetch'; pet.fetch = pet.fetch || { state: 'idle', drop: null }; pet.fetch.state = 'toDrop'; pet.fetch.drop = d; continue; }
      }
      /* 上下浮动 */
      pet.bobT += dt * 2.5;
      /* 跟随玩家: 左上方, 平滑跟随 (v3.7: 跟玩家所在车道, 不是固定地板) */
      const targetX = p.x + pet.offsetX;
      const targetY = floorY() + p.y + pet.offsetY + Math.sin(pet.bobT) * 3;
      pet.x += (targetX - pet.x) * Math.min(1, dt * 6);
      pet.y += (targetY - pet.y) * Math.min(1, dt * 6);

      /* 施法系统 */
      if (pet.casting) {
        pet.castAnim += dt / 1.2;  /* 施法动画1.2秒 */
        pet.effectTimer += dt;
        /* 施法进行中: 生成治疗/攻击粒子 */
        if (pet.effectTimer >= 0.08) {
          pet.effectTimer = 0;
          if (pet.castType === 'heal') {
            G.fx.push({ kind:'healParticle', x:p.x+(Math.random()-0.5)*30, y:p.y-30-Math.random()*40, vx:(Math.random()-0.5)*10, vy:-20-Math.random()*15, t:0, dur:0.8, color:'#7fffaa' });
          } else if (pet.castType === 'atk') {
            G.fx.push({ kind:'atkParticle', x:p.x+(Math.random()-0.5)*25, y:p.y-20-Math.random()*30, vx:(Math.random()-0.5)*15, vy:-15-Math.random()*10, t:0, dur:0.7, color:'#ffaa55' });
          }
        }
        /* 施法完成: 触发效果 */
        if (pet.castAnim >= 1) {
          pet.casting = false;
          pet.castAnim = 0;
          if (pet.castType === 'heal') {
            /* 回血: 恢复20%最大生命 */
            const healAmt = Math.round(p.maxHp * 0.2);
            p.hp = Math.min(p.maxHp, p.hp + healAmt);
            G.dmg.push({ x:p.x, y:p.y-50, val:'+'+healAmt, crit:false, color:'#7fffaa', t:0 });
            G.fx.push({ kind:'healBurst', x:p.x, y:p.y-30, t:0, dur:0.5 });
          } else if (pet.castType === 'atk') {
            /* 加攻击: +30%攻击力, 持续6秒 */
            p.atkBuff = 0.3;
            p.atkBuffTimer = 6;
            G.dmg.push({ x:p.x, y:p.y-50, val:'攻击+30%', crit:false, color:'#ffaa55', t:0 });
            G.fx.push({ kind:'atkBurst', x:p.x, y:p.y-30, t:0, dur:0.5 });
          }
          pet.castType = null;
          pet.castTimer = 8;  /* 8秒后再次施法 */
        }
      } else {
        /* 施法冷却 */
        pet.castTimer -= dt;
        if (pet.castTimer <= 0) {
          /* 随机选择施法类型: 60%回血, 40%加攻击 */
          pet.casting = true;
          pet.castAnim = 0;
          pet.castType = Math.random() < 0.6 ? 'heal' : 'atk';
          pet.effectTimer = 0;
        }
      }
    }

    /* 玩家攻击buff计时 */
    if (p.atkBuffTimer > 0) {
      p.atkBuffTimer -= dt;
      if (p.atkBuffTimer <= 0) { p.atkBuff = 0; p.atkBuffTimer = 0; }
    }
  }
  /* 骨骼怪动画状态机: 游戏状态(hurt/anim/moving/dying) → 动作, fadeIn 平滑过渡。
   * playTimes=-1 走动画数据自带循环设置(循环动作无限循环, attack/hurt/dead 播一次定格)。
   * v3.9 通用化: 动画名从 BONES[e.boneSlug].anims 查(加载时已归一化+回退), 永远有效。 */
  function advanceRatty(e, dt, dead) {
    const B = BONES[e.boneSlug];
    if (!B || !B.ready) return;
    const A = e.armature.animation;
    const an = B.anims;
    let want = an.walk;
    if (dead) want = an.dead;
    else if (e.hurtT > 0) want = an.hurt;
    else if (e.anim > 0) want = an.attack;
    else if (!e.moving) want = an.idle;
    if (!want || !A.hasAnimation(want)) want = an.idle || an.walk;
    if (want && e.boneAnim !== want) { e.boneAnim = want; A.fadeIn(want, 0.12, (want === 'walk' || want === 'idle') ? 0 : -1); }   /* playTimes=0 强制循环: megapack1 数据自带播1次, -1 会冻结在末帧 */
    e.armature.advanceTime(dt);
  }
  function updateEnemies(dt) {
    const p = G.player;
    /* v3.7 排队按车道分组: 每条车道独立排队 —— 近的先站位, 后面的依次后挪一个身位。
     * 不同车道互不影响(各道都有一列纵队向玩家逼近)。 */
    for (let L = 0; L < LANES; L++) {
      const queue = G.enemies.filter(e => e.alive && e.dying <= 0 && e.lane === L).sort((a, b) => a.x - b.x);
      let prevX = -1e9;
      for (const e of queue) {
        const stopX = Math.max(p.x + e.atkRange, prevX + BC.queueGap);
        e.stopX = stopX;
        prevX = Math.max(e.x, stopX);
      }
    }
    /* v3.8.1 防交错兜底: 排队目标 stopX 恒在玩家右侧, 发现怪被留在 stopX 左侧
     * (玩家推进/移动曾可穿过站位怪)直接拉回站位 —— 杜绝"跑到玩家后面咬空气"。 */
    for (const e of G.enemies) {
      if (!e.alive || e.dying > 0 || e.stopX == null) continue;
      if (e.x < e.stopX - 4) e.x = e.stopX;
    }
    for (const e of G.enemies) {
      if (e.dying>0) { e.dying-=dt; if (e.armature) advanceRatty(e, dt, true); continue; }
      if (!e.alive) continue;
      if (e.armature) advanceRatty(e, dt, false);   /* 骨骼怪: 推进动画(吃倍速 dt, 与移动节奏一致) */
      /* v3.9.1 怪寻玩家: 玩家不在本道累计计时, 超 2.5s 换道追击。
       * BOSS 旧版(史莱姆王, 远程漂浮)曾固定中道 —— 现换九尾狐王地面怪, 同样追击, 不再豁免。 */
      if (e.lane !== p.lane) {
        e.chaseT = (e.chaseT || 0) + dt;
        if (e.chaseT >= 2.5) { e.chaseT = 0; e.lane = p.lane; }
      } else if (e.chaseT) e.chaseT = 0;
      /* 车道 y 平滑过渡(与玩家同参), 换道是走位感而非瞬移 */
      e.y += (laneOff(e.lane) - e.y) * Math.min(1, dt * 7);
      e.atkT -= dt; e.anim = Math.max(0, e.anim-dt*1.5);
      const wasHurt = e.hurtT > 0;
      e.hurtT = Math.max(0, e.hurtT-dt);
      /* 受击音效: 受击开始时 */
      if (!wasHurt && e.hurtT > 0) {
        if (e.type === 'slime') playSfx('slime_hurt', 0.5);
        else if (e.type === 'water') playSfx('water_hurt', 0.5);
      }
      /* 动画帧跟踪 */
      e.animTimer += dt;
      const frameDur = 1 / 24;
      if (e.animTimer >= frameDur) {
        e.animTimer -= frameDur;
        if (e.anim > 0) {
          e.animFrame++;
        } else {
          e.animFrame = (e.animFrame + 1) % 32;
          /* 脚步声: walk特定帧, 仅在移动时 */
          if (e.moving) {
            if (e.type === 'slime' && (e.animFrame === 4 || e.animFrame === 20)) playSfx('slime_footstep', 0.4);
            else if (e.type === 'water' && (e.animFrame === 8 || e.animFrame === 24)) playSfx('water_footstep', 0.4);
          }
        }
      }
      const stopX = e.stopX != null ? e.stopX : p.x + e.atkRange;
      e.moving = e.x > stopX+2;
      if (e.x > stopX+2) e.x = Math.max(stopX, e.x-e.speed*dt);
      const wasAttacking = e.anim > 0;
      /* v3.7 攻击判定加同道条件: 不同车道的怪贴得再近也打不到玩家(各道独立交战) */
      if (e.lane === p.lane && Math.abs(e.x-p.x) <= e.atkRange+5 && e.atkT <= 0) {
        e.anim = 1; e.atkT = 1/(0.8+Math.random()*0.5); e.animFrame = 0;
        /* 攻击音效: 攻击开始时 */
        if (!wasAttacking) {
          if (e.type === 'slime') playSfx('slime_attack', 0.5);
          else if (e.type === 'water') playSfx('water_attack', 0.5);
          else if (e.type === 'boss') playSfx('boss_attack', 0.8);
        }
        /* 闪避判定(装备词条 + 身法技能时效加成) —— 落空则不进伤害 */
        if (Math.random()*100 < ((PST.dodge || 0) + G.speedDodge)) {
          G.dmg.push({ x:p.x,y:p.y-40, val:'闪', crit:false, color:'#9fd8ff', t:0 });
        } else {
          const dmg = calcDmg(e.atk, 0.85+Math.random()*0.3, PST.def, 0);
          p.hp -= dmg; p.hurtT = 0.25; p.stun = 0.5;
          G.dmg.push({ x:p.x,y:p.y-40, val:dmg, crit:false, color:'#ff8a7a', t:0 });
          G.fx.push({ kind:'hitSpark', x:p.x,y:p.y-20, color:'#ff8a7a', t:0,dur:0.3 });
          if (p.hp <= 0) p.hp = p.maxHp;              // 收草节奏: 主角不死, 倒下即刻重整旗鼓
        }
      }
    }
    G.enemies = G.enemies.filter(e => { if (!(e.alive || e.dying > 0)) despawnEnemy(e); return e.alive || e.dying > 0; });
  }
  function updateFx(dt) {
    for (const f of G.fx) {
      f.t += dt;
      /* 横扫千军帧更新: 帧序号按 f.t/f.dur 线性映射到 49 帧 —— 特效时长缩短后自动加速,
       * 无需改精灵配置(v2.9: dur 0.38→0.30s, 剑气扫出更干脆) */
      if (f.kind === 'hengsao') {
        f.frame = Math.min(HENGSAO_SPRITE.count - 1, Math.floor(f.t / f.dur * HENGSAO_SPRITE.count));
      }
      /* 粒子运动 */
      if (f.kind === 'healParticle' || f.kind === 'atkParticle') {
        f.x += (f.vx || 0) * dt;
        f.y += (f.vy || 0) * dt;
        if (f.vy) f.vy += 30 * dt;  /* 轻微重力 */
      }
    }
    G.fx = G.fx.filter(f => f.t < f.dur);
    for (const d of G.dmg) d.t += dt;
    G.dmg = G.dmg.filter(d => d.t < 0.9);
  }
  function updateCamera(dt) {
    const targetCam = G.player.x - stageW()*0.42;   // 玩家锁屏中间偏左: 右侧留出更多来怪空间, 推进感更强
    G.camX += (targetCam-G.camX)*Math.min(1, dt*6);
  }
  let _pushT = 0;
  /* ── v3.9 试炼轮次状态机 ──────────────────────────────────────────
   * 120 秒一场, 怪从 T1 妖群一路升到 T5 妖皇; 时间到结算:
   *   本轮击杀 → 与纪录(trialBest)比较 → 按档位给离线游历收益加成(trialBoost)。
   * 【计时器与倍速分离】倒计时吃原始 dt(真实时间); 身法倍速只加速战斗实体 ——
   *   运气好触发倍速多, 同样 120 秒里刷的怪就更多, 击杀数即纯收益。 */
  function updateTrial(dt) {
    if (G.trialSettled) return;          /* 结算面板期间不倒计时、不刷怪 */
    G.trialT -= dt;
    if (G.trialT <= 0) { G.trialT = 0; settleTrial(); }
  }
  /* 离线补偿档位: 纪录越高加成越大; 48h 有效, 刷新纪录即续期升档 */
  function trialBoostFor(k) { return k >= 45 ? .20 : k >= 35 ? .15 : k >= 20 ? .10 : k >= 10 ? .05 : 0; }
  function settleTrial() {
    G.trialSettled = true;
    const kills = G.trialKills;
    /* 清场: 轮次结束, 场上怪与投射特效退去(掉落保留让玩家收完) */
    for (const e of G.enemies) { e.alive = false; e.dying = 0; }
    for (const e of G.enemies) despawnEnemy(e);   /* v4.0: GL 资源同步回收 */
    G.enemies.length = 0;
    G.bossActive = false; G.smallKillsSinceBoss = 0;
    /* 纪录 + 离线加成(写进 state, 随云存档同步) */
    let best = 0, boost = 0, isNew = false;
    try {
      const st = state;
      if (st) {
        best = st.trialBest || 0;
        if (kills > best) {
          best = kills; isNew = true;
          st.trialBest = best;
          try { window.addJournal && window.addJournal({ key: 'trial-' + Date.now(), big: realmName(), kind: '试炼', title: '妖潮试炼', text: `妖潮退去, 此番斩妖 ${kills} 只, 刷新试炼纪录。` }); } catch (err) {}
        }
        boost = trialBoostFor(best);
        if (boost > 0) {
          st.trialBoost = Math.max(st.trialBoost || 0, boost);
          st.trialBoostUntil = Math.max(st.trialBoostUntil || 0, Date.now() + 48*3600*1000);
        }
      }
    } catch (err) { console.warn('[battle] 试炼结算写档失败', err); }
    /* 结算面板 */
    try {
      const el = document.getElementById('trialModal');
      if (el) {
        document.getElementById('trialKillsN').textContent = kills;
        document.getElementById('trialTierN').textContent = (BC.tier[G.trialTier] || BC.tier[1]).name;
        document.getElementById('trialBestN').textContent = best + (isNew ? '（新纪录！）' : '');
        const bEl = document.getElementById('trialBoostN');
        bEl.textContent = boost > 0 ? `离线游历所得 +${Math.round(boost*100)}%（48 时辰内有效）` : '再接再厉，10 只起有加成';
        el.classList.add('show');
      }
    } catch (err) {}
    updateHUD();
  }
  function trialRestart() {
    document.getElementById('trialModal') && document.getElementById('trialModal').classList.remove('show');
    G.trialT = BC.trialSecs; G.trialKills = 0; G.tierKills = 0; G.trialTier = 1;
    G.trialSettled = false; G.trialRound++; G.trialBossDone = false;
    G.paused = false;
    updateHUD();
  }
  function realmName() { try { return (typeof window.realm === 'function' && window.realm().big) || ''; } catch (err) { return ''; } }
  function update(dt) {
    if (G.speedMultTimer > 0) {
      G.speedMultTimer -= dt;
      if (G.speedMultTimer <= 0) { G.speedMult = 1; G.speedMultTimer = 0; G.speedDodge = 0; }   // 身法时效到点, 闪避加成一并散去
      updateHUD();
    }
    const sdt = dt * G.speedMult;
    G.t += sdt;
    /* v3.9 试炼倒计时: 原始 dt —— 计时器与倍速分离, 倍速只加战斗节奏不加轮时 */
    updateTrial(dt);
    const aliveEnemies = G.enemies.filter(e => e.alive && e.dying<=0);
    const newState = aliveEnemies.length > 0 ? 'fight' : 'walk';
    if (newState !== G.state) { G.state = newState; updateHUD(); }
    G.spawnT -= sdt;
    if (G.trialSettled) { G.spawnT = BC.spawnInterval; }   /* 结算面板期间停刷怪 */
    else if (G.spawnT <= 0) { spawnWave(); G.spawnT = BC.spawnInterval; }
    /* 属性/技能等级每 5s 重新取一次(自愈: 即便某次变更没通知到也不会一直用旧值) */
    _pushT -= dt;
    if (_pushT <= 0) { _pushT = 5; if (typeof window.pushBattleStats === 'function') window.pushBattleStats(); }
    updatePlayer(sdt); updatePets(sdt); updateEnemies(sdt); updateFx(sdt); updateDrops(sdt); updateCamera(sdt);
    /* 技能名播报: 独立推进(不吃身法倍速, 固定节奏即隐) */
    if (G.skillCall) { G.skillCall.t += dt; if (G.skillCall.t >= G.skillCall.dur) G.skillCall = null; }
  }

  /* 渲染 */
  let cv, ctx, CW, CH;
  function stageW() { return CW; }
  function stageH() { return CH; }
  function floorY() { return CH * 0.92; }
  /* v3.7 三车道: lane 0 最近, 1 居中, 2 最远(靠上)。v3.7.1 对齐新背景的石板路:
   * 石板路可站区间约 0.72~0.94 倍横带高(上方是花草丛, 下方是前景草), 三道按
   * 0.74/0.83/0.92 铺进去 —— 间隔用 CH 比例而非固定像素, 任何横带高度都不越界。
   * 实体的 y 字段 = 车道偏移(负值) —— 特效/伤害数字/宠物/掉落全部从实体 y 推导,
   * 因此只要实体带 y, 整条表现链自动跟道, 无需逐处改坐标。 */
  const LANES = 3;
  function laneGap() { return CH * 0.09; }
  function laneOff(lane) { return -(LANES - 1 - lane) * laneGap(); }
  /* 纵深缩放: 越远的道越小一档, 强化三车道空间感 */
  /* v3.8.1 层次感回调: 0.10 差距过大(0.80/0.90/1.0 模型大小悬殊), 收敛到 0.86/0.93/1.0 */
  function laneScale(lane) { return 1 - (LANES - 1 - lane) * 0.07; }
  /* v3.7.1 素材实化: 部分序列帧素材的像素 alpha 不满(实测玩家表均值仅 ~219),
   * 黑底时代看不出来, 换亮背景后角色透出背景纹理。加载时一次性处理:
   * alpha≥200 拉满 255, 30~200 线性拉伸保留软边防锯齿, <30 不动(淡出边缘)。
   * 返回离屏 canvas —— drawImage 兼容, 运行时零额外成本。 */
  function solidify(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    try {
      const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
      const softT = 30, hardT = 200, range = hardT - softT;
      for (let i = 3; i < d.length; i += 4) {
        const a = d[i];
        if (a >= hardT) d[i] = 255;
        else if (a > softT) d[i] = (a - softT) * 255 / range | 0;
      }
      g.putImageData(id, 0, 0);
    } catch (e) { return img; }   /* getImageData 被跨域污染时退回原图 */
    return c;
  }
  function initCanvas() {
    cv = document.getElementById('battleCanvas');
    if (!cv) return false;
    ctx = cv.getContext('2d');
    /* v4.0 WebGL: GL 战斗层 canvas 挂 body(全屏 z:1), 不依赖 #battleCanvas 尺寸;
     * 2D 画布仍保留以兼容独立模式与 resize 逻辑。 */
    if (window.BattleGL) window.BattleGL.init();
    /* 常态调色移到 CSS 合成层(GPU, 零 canvas 开销) —— ctx.filter 会让每个 drawImage
     * 走滤镜管线, 在 mesh 逐三角/多怪同屏时是移动端帧率杀手之一 */
    cv.style.filter = 'saturate(0.85) brightness(0.93)';
    resize();
    window.addEventListener('resize', resize);
    return true;
  }
  function resize() {
    const rect = cv.parentElement.getBoundingClientRect();
    CW = rect.width; CH = rect.height;
    /* v2.9 PERF: DPR 封顶 1.5 —— 原 dpr=3 手机按 9× 像素渲染(战斗层是唯一未收敛的画布,
     * bg.js/fx2d.js 早已封顶 1.5)。GPU 填充率随像素数线性上升, 这是 App 端发烫的最大单点。
     * 1.5x 在手机上肉眼无差(行业通行做法), 像素量降至 1/4。 */
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    cv.width = CW*dpr; cv.height = CH*dpr;
    cv.style.width = CW+'px'; cv.style.height = CH+'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function worldToScreen(wx) { return wx - G.camX; }

  function hash01(n) { return ((Math.imul(n | 0, 1103515245) + 12345) >>> 8) % 1000 / 1000; }
  function drawCloudShape(g, x, y, s, alpha) {
    /* 一朵云 = 4 个椭圆拼的云团(同一路径一次填充, 重叠处不会加深) */
    g.beginFill(0xd8e4f0, alpha);
    g.drawEllipse(x, y, 70 * s, 13 * s);
    g.drawEllipse(x - 40 * s, y + 4 * s, 32 * s, 8 * s);
    g.drawEllipse(x + 42 * s, y + 5 * s, 28 * s, 7 * s);
    g.drawEllipse(x + 8 * s, y - 9 * s, 34 * s, 9 * s);
    g.endFill();
  }
  function drawClouds() {
    /* 三层视差云: 远层慢而淡、近层快而实; 随摄像机视差滚动 + 自身缓慢漂移 + 上下浮动
     * v4.0 WebGL: 画进 bg 层共享 Graphics（每帧 clear 重画, 仅 bgImg 未就绪时走此路径） */
    const t = G.t;
    const g = window.BattleGL.layers.bg._clouds;
    g.clear();
    const layers = [
      { par: 0.12, n: 5, gap: 540, alpha: 0.045, sc: 0.72, yBase: 0.10, spd: 3 },
      { par: 0.28, n: 4, gap: 660, alpha: 0.062, sc: 1.0,  yBase: 0.21, spd: 6 },
      { par: 0.52, n: 3, gap: 840, alpha: 0.08,  sc: 1.38, yBase: 0.34, spd: 10 },
    ];
    for (const L of layers) {
      const total = L.n * L.gap;
      for (let i = 0; i < L.n; i++) {
        const wx = i * L.gap + hash01(i * 31 + L.n * 7) * 260;
        let sx = (((wx - G.camX * L.par - t * L.spd) % total) + total) % total - 320;
        if (sx > CW + 320) continue;
        const r = hash01(i * 57 + L.n * 13);
        const cy = CH * (L.yBase + r * 0.09) + Math.sin(t * 0.5 + i * 1.7) * 4;
        drawCloudShape(g, sx, cy, L.sc * (0.8 + r * 0.45), L.alpha);
      }
    }
  }
  function drawBg() {
    /* v3.7 幽夜森林背景: 随摄像机 0.5 视差滚动, 【镜像交替平铺】实现左右无限无缝拼接。
     * v4.0 WebGL: Sprite 池交替正/镜像摆位（scale.x=-1 等价原 translate+scale(-1,1)）。 */
    if (G.bgReady && G.bgImg) {
      window.BattleGL.layers.bg._clouds.clear();   // 平铺生效时清掉云兜底
      const drawH = CH;                           /* 画满整条战斗横带(地板下方延续石板路, 无黑边) */
      const drawW = drawH * (G.bgImg.width / G.bgImg.height);
      const period = drawW * 2;
      const off = ((G.camX * 0.5) % period + period) % period;   // 远景半速视差
      const y0 = CH - drawH;
      const n0 = Math.floor(off / drawW);
      const tiles = window.BattleGL.layers.bg._tiles;
      const need = Math.min(8, Math.ceil(CW / drawW) + 2);
      const pool = drawBg._pool || (drawBg._pool = []);
      while (pool.length < need) { const s = new PIXI.Sprite(); tiles.addChild(s); pool.push(s); }
      const tex = window.BattleGL.tex(G.bgImg);
      let k = 0;
      for (let n = n0; ; n++) {
        const x = n * drawW - off;
        if (x > CW) break;
        const s = pool[k++];
        s.visible = true;
        s.texture = tex;
        s.y = y0;
        if (n % 2 === 0) { s.x = x; s.scale.set(drawW / G.bgImg.width, drawH / G.bgImg.height); }
        else { s.x = x + drawW; s.scale.set(-drawW / G.bgImg.width, drawH / G.bgImg.height); }
      }
      for (; k < pool.length; k++) pool[k].visible = false;
    } else {
      drawClouds();   /* 背景图未就绪时保留旧的程序云天 */
    }
  }

  /* v4.0 WebGL: 血条/法环 → Pixi Graphics。layerName 指定绘制层(farUI/nearUI/playerUI)，
   * 该层 Graphics 每帧 render 前清空，重画顺序与原 2D 完全一致。
   * 原水平渐变按中点取纯色近似(3px 高的渐变肉眼不可辨)。 */
  const HPBAR_COL = { e: 0xe84038, g: 0x55cc90, y: 0xe4bc54, r: 0xf46050 };
  function drawEliteRing(layerName, x, y, r) {   // 精英怪: 脚下金色法环
    const g = window.BattleGL.layers[layerName]._gfx;
    g.lineStyle(1.5, 0xe8c46b, 0.5);
    g.drawEllipse(x, y, r, r * 0.3);
  }
  function drawHpBar(layerName, x, y, w, hp, maxHp, isEnemy) {
    const p = Math.max(0, hp/maxHp); const h = 3;
    const g = window.BattleGL.layers[layerName]._gfx;
    g.lineStyle(0);
    g.beginFill(0x080c14, 0.6);
    g.drawRoundedRect(x - w/2, y, w, h, 1.5);
    g.endFill();
    const bucket = isEnemy ? 'e' : (p > 0.5 ? 'g' : p > 0.25 ? 'y' : 'r');
    g.beginFill(HPBAR_COL[bucket], 1);
    if (w * p > 0.01) g.drawRoundedRect(x - w/2, y, w * p, h, 1.5);
    g.endFill();
  }

  /* v2.6 PERF: BOSS 攻击帧"左侧渐隐"掩码按帧预渲染 —— 原实现攻击期间每帧新建
   * 离屏 canvas + 渐变(60fps 下每秒 60 次分配), 现在只在尺寸变化时重建 22 张 */
  const BOSS_MASK = { w: 0, h: 0, frames: null };
  /* v2.9 PERF: 横扫千军帧级离屏缓存(左右渐隐贴图), 尺寸固定 280×drawH 故只需按帧号缓存 */
  const HENGSAO_MASK = { frames: null };
  function bossMaskedFrame(fi, drawW, drawH) {
    if (!BOSS_MASK.frames || BOSS_MASK.w !== drawW || BOSS_MASK.h !== drawH) {
      BOSS_MASK.w = drawW; BOSS_MASK.h = drawH;
      const cw = Math.max(1, Math.ceil(drawW)), chh = Math.max(1, Math.ceil(drawH));
      BOSS_MASK.frames = [];
      for (let i = 0; i < BOSS_SPRITE.attackCount; i++) {
        const src = BOSS_SPRITE.attackStart + i;
        const off = document.createElement('canvas');
        off.width = cw; off.height = chh;
        const octx = off.getContext('2d');
        octx.drawImage(G.bossSprite, (src % BOSS_SPRITE.cols) * BOSS_SPRITE.fw,
          Math.floor(src / BOSS_SPRITE.cols) * BOSS_SPRITE.fh, BOSS_SPRITE.fw, BOSS_SPRITE.fh, 0, 0, cw, chh);
        octx.globalCompositeOperation = 'destination-in';
        const grad = octx.createLinearGradient(0, 0, cw * 0.4, 0);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,1)');
        octx.fillStyle = grad;
        octx.fillRect(0, 0, cw, chh);  /* 必须填充整个画布, 否则右侧变透明 */
        BOSS_MASK.frames.push(off);
      }
    }
    return BOSS_MASK.frames[fi] || null;
  }

  function drawPets() {
    const C = window.BattleGL.layers.pets;
    const ensure = (pet) => {
      if (pet.__gl) return pet.__gl;
      const o = { main: new PIXI.Sprite(), glow: new PIXI.Sprite(), place: new PIXI.Graphics() };
      o.main.anchor.set(0.5, 1);   /* 原版 translate 后 drawImage(-w/2,-h) → anchor(0.5,1) 等价 */
      o.glow.anchor.set(0.5);
      o.glow.blendMode = PIXI.BLEND_MODES.ADD;
      C.addChild(o.glow); C.addChild(o.place); C.addChild(o.main);
      return pet.__gl = o;
    };
    for (const pet of G.pets) {
      if (!pet.alive) continue;
      const sx = worldToScreen(pet.x);
      const sy = pet.y;  /* 宠物y坐标已包含offsetY和上下浮动 */
      const S = ensure(pet);
      S.main.visible = S.glow.visible = S.place.visible = false;
      /* 灵狐真实 sprite 渲染 */
      if (G.petFoxReady && G.petFoxSprite && pet.type === 'fox') {
        const PET_SPRITE = { cols:8, fw:96, fh:80 };
        const frameIdx = pet.flyFrame % 32;
        /* 渲染尺寸: 宠物较小, 约玩家的60% */
        const drawH = Math.min(CH * 0.35, 52);
        const drawW = drawH * (PET_SPRITE.fw / PET_SPRITE.fh);
        S.main.visible = true;
        S.main.texture = frameTex(G.petFoxSprite, PET_SPRITE.cols, PET_SPRITE.fw, PET_SPRITE.fh, frameIdx);
        /* 向左飞: 水平镜像(素材默认朝右) —— scale.x 取负 */
        S.main.scale.set((drawW / PET_SPRITE.fw) * (pet.face === -1 ? -1 : 1), drawH / PET_SPRITE.fh);
        S.main.position.set(sx, sy);
        /* 施法特效: lighter 柔光垫底(呼吸幅度收小) */
        if (pet.casting) {
          const pulse = 0.5 + 0.5 * Math.sin(pet.castAnim * Math.PI * 3);
          const img = pet.castType === 'heal' ? GLOW.heal : GLOW.atk;
          const glowR = drawH * (0.68 + pulse * 0.14);
          S.glow.visible = true;
          S.glow.texture = window.BattleGL.tex(img);
          S.glow.position.set(sx, sy - drawH * 0.55);
          S.glow.width = S.glow.height = glowR * 2;
          S.glow.alpha = 0.3 + pulse * 0.18;
        }
      } else {
        /* 其他宠物占位 */
        S.place.visible = true;
        S.place.clear();
        S.place.position.set(sx, sy);
        S.place.alpha = pet.hurtT > 0 ? 0.6 : 1;
        const r = Math.min(8, CH*0.07);
        S.place.beginFill(colorInt(pet.color || '#ffd76b'), 1);
        S.place.drawCircle(0, -r, r);
        S.place.endFill();
        S.place.beginFill(0x1a1a2a, 1);
        S.place.drawCircle(-2.5, -r-1, 1.2);
        S.place.drawCircle(2.5, -r-1, 1.2);
        S.place.endFill();
      }
    }
  }

  /* v3.8.2 遮挡分层: 接收 lane 过滤器 —— render 拆两批调用, 远于玩家的怪先画
   * (被玩家盖), 近于玩家的怪最后画(盖玩家), 三车道遮挡关系明确(画家算法)。
   * v4.0 WebGL: uiLayer('far'/'near') 指定批次 —— 怪挂 far/near 容器, 血条/法环
   * 挂 farUI/nearUI 的共享 Graphics。容器内 addChild 置顶保持批次内遍历序=遮挡序。 */
  /* v4.0 WebGL: 怪离场回收 —— 骨骼 display 是持久 addChild(非每帧重建),
   * 怪被 G.enemies 移除后若不同步出列, far/near 容器里就留下永生幽灵怪。
   * 在两个移除点(死亡 filter / 试炼清场)调用; 骨架回池复用(build 不便宜)。 */
  function despawnEnemy(e) {
    const GL = window.BattleGL;
    if (!GL || !GL.ready) return;
    if (e.armature && e.boneSlug && BONES[e.boneSlug]) {
      GL.releaseArmature(BONES[e.boneSlug], e.armature);
      e.armature = null;
    }
    if (e.__spr) { e.__spr.destroy(); e.__spr = null; }
    if (e.__placeG) { e.__placeG.destroy(); e.__placeG = null; }
  }

  /* v4.0 WebGL: 序列帧怪的共享 Sprite（per-enemy 懒建），挂本批容器并置顶 */
  function enemySpriteGL(e, layer) {
    let s = e.__spr;
    if (!s) { s = e.__spr = new PIXI.Sprite(); layer.addChild(s); }
    layer.addChild(s);
    s.visible = true;
    return s;
  }
  /* 序列帧怪受击/死亡的公共 alpha+filter */
  function enemyFxGL(spr, e) {
    spr.alpha = (e.dying > 0 ? Math.max(0, e.dying / 0.4) : 1) * (e.hurtT > 0 ? 0.7 : 1);
    spr.filters = e.hurtT > 0 ? [window.BattleGL.Filters.hurt] : null;
  }
  function drawEnemies(laneFilter, batch) {
    const batchC = window.BattleGL.layers[batch === 'near' ? 'near' : 'far'];
    const uiLayer = batch === 'near' ? 'nearUI' : 'farUI';
    for (const e of G.enemies) {
      if (laneFilter && !laneFilter(e)) continue;
      if (!e.alive && e.dying <= 0) continue;
      const sx = worldToScreen(e.x); const sy = floorY() + e.y;   /* v3.7: 怪站自己的车道 */
      /* v3.9 通用骨骼怪分支(链最前): 所有带 armature 的怪 —— 鼠妖/僵尸/妖狐/…/骨骼BOSS 统一走这。
       * 体型缩放用 idle 基准高(BONES.baseH 建厂时测定, 避免动画间呼吸式缩放);
       * 落地对齐用当前姿态 AABB 底边中心; drawH/血条宽 per-怪配置(素材分辨率无关)。 */
      if (e.armature && e.boneSlug && BONES[e.boneSlug] && BONES[e.boneSlug].ready) {
        const B = BONES[e.boneSlug];
        const def = BC.enemies[e.type] || {};
        const cap = def.isBoss ? CH * 0.7 : CH * 0.5;
        const drawH = Math.min(cap, e.drawH || def.drawH || 84) * (def.isBoss ? 1 : (e.elite ? 1.28 : 1)) * laneScale(e.lane);
        const s = drawH / Math.max(1, B.baseH || 100);
        const bb = window.BattleGL.armatureAABB(e.armature);
        /* v4.0 WebGL: 2D 的 translate(sx,sy)·scale(s)·translate(-cx,-maxY) 在
         * display 上等价于 pos=(sx-s·cx, sy-s·maxY)+scale(s)。蒙皮顶点在
         * armature.display 的骨架局部空间, 与 2D drawArmature 同一坐标系。 */
        const d = e.armature.display;
        batchC.addChild(d);   // reparent 到本批容器 + 置顶(遍历序=遮挡序)
        d.visible = true;
        d.position.set(sx - s * (bb.minX + bb.maxX) / 2, sy - s * bb.maxY);
        d.scale.set(s);
        d.alpha = e.dying > 0 ? Math.max(0, e.dying/0.4) : 1;
        d.filters = e.hurtT > 0 ? [window.BattleGL.Filters.hurt] : null;
        if (e.elite && e.alive) drawEliteRing(uiLayer, sx, sy, 16);
        if (e.alive) drawHpBar(uiLayer, sx, sy - drawH - 4, def.hpBarW || 28, e.hp, e.maxHp, true);
      }
      /* 史莱姆真实 sprite 渲染 */
      if (G.slimeReady && G.slimeSprite && e.type === 'slime') {
        /* 根据状态选择帧 */
        let frameIdx;
        if (e.hurtT > 0) {
          /* 受击动画: hurtT从0.25递减到0, 映射到hurt帧范围 */
          const hurtProgress = 1 - (e.hurtT / 0.25);
          frameIdx = SLIME_SPRITE.hurtStart + Math.min(Math.floor(hurtProgress * SLIME_SPRITE.hurtCount), SLIME_SPRITE.hurtCount-1);
        } else if (e.anim > 0) {
          /* 攻击动画: anim从1递减到0, 映射到attack帧范围 */
          const atkProgress = 1 - e.anim;
          frameIdx = SLIME_SPRITE.attackStart + Math.min(Math.floor(atkProgress * SLIME_SPRITE.attackCount), SLIME_SPRITE.attackCount-1);
        } else {
          /* 走路/待机循环: 用时间驱动 */
          frameIdx = SLIME_SPRITE.walkStart + (Math.floor(G.t * SLIME_SPRITE.fps) % SLIME_SPRITE.walkCount);
        }
        /* 渲染尺寸: 到玩家肩膀高度(精英怪体型 ×1.28) */
        const drawH = Math.min(CH * 0.5, 72) * (e.elite ? 1.28 : 1) * laneScale(e.lane);
        const drawW = drawH * (SLIME_SPRITE.fw / SLIME_SPRITE.fh);
        /* 脚底在帧中的y=120(距底部8px), 用这个偏移让脚底踩在地板上 */
        const footOffset = 120 * (drawH / SLIME_SPRITE.fh);
        const spr = enemySpriteGL(e, batchC);
        spr.texture = frameTex(G.slimeSprite, SLIME_SPRITE.cols, SLIME_SPRITE.fw, SLIME_SPRITE.fh, frameIdx);
        /* 原变换链(压缩0.92+高度补偿)线性合成后 == 直接贴 (sx-dw/2, sy-fo, dw, drawH) */
        spr.position.set(sx - drawW / 2, sy - footOffset);
        spr.scale.set(drawW / SLIME_SPRITE.fw, drawH / SLIME_SPRITE.fh);
        enemyFxGL(spr, e);
        /* 史莱姆面朝左, 素材本身就是面朝左, 不需要翻转 */
        if (e.elite && e.alive) drawEliteRing(uiLayer, sx, sy, 16);
        if (e.alive) drawHpBar(uiLayer, sx, sy - footOffset - 4, 28, e.hp, e.maxHp, true);
      } else if (G.waterReady && G.waterSprite && e.type === 'water') {
        /* 水精灵真实 sprite 渲染 */
        let frameIdx;
        if (e.hurtT > 0) {
          const hurtProgress = 1 - (e.hurtT / 0.25);
          frameIdx = WATER_SPRITE.hurtStart + Math.min(Math.floor(hurtProgress * WATER_SPRITE.hurtCount), WATER_SPRITE.hurtCount-1);
        } else if (e.anim > 0) {
          const atkProgress = 1 - e.anim;
          frameIdx = WATER_SPRITE.attackStart + Math.min(Math.floor(atkProgress * WATER_SPRITE.attackCount), WATER_SPRITE.attackCount-1);
        } else {
          frameIdx = WATER_SPRITE.walkStart + (Math.floor(G.t * WATER_SPRITE.fps) % WATER_SPRITE.walkCount);
        }
        const col = frameIdx % WATER_SPRITE.cols;
        const row = Math.floor(frameIdx / WATER_SPRITE.cols);
        void col; void row;   /* v4.0: 切帧由 frameTex 完成, 保留帧选择逻辑不变 */
        /* 渲染尺寸: 适配战斗区高度(v3.7: 随车道纵深缩放) */
        const drawH = Math.min(CH * 0.5, 70) * (e.elite ? 1.28 : 1) * laneScale(e.lane);
        const drawW = drawH * (WATER_SPRITE.fw / WATER_SPRITE.fh);
        /* 脚底在帧中的y=118(距底部10px) */
        const footOffset = 118 * (drawH / WATER_SPRITE.fh);
        const spr = enemySpriteGL(e, batchC);
        spr.texture = frameTex(G.waterSprite, WATER_SPRITE.cols, WATER_SPRITE.fw, WATER_SPRITE.fh, frameIdx);
        /* 原变换链(压缩0.92 + skewX(-0.03) 校正)线性合成 —— canvas 矩阵语义
         * x'=(dw/fw)x - 0.03·(drawH/fh)y + sx - dw/2 + 0.03·0.92·fo ; y'=(drawH/fh)y + sy - fo */
        spr.transform.setFromMatrix(new PIXI.Matrix(
          drawW / WATER_SPRITE.fw, 0,
          -0.03 * drawH / WATER_SPRITE.fh, drawH / WATER_SPRITE.fh,
          sx - drawW / 2 + 0.03 * 0.92 * footOffset, sy - footOffset));
        enemyFxGL(spr, e);
        /* 水精灵面朝左, 素材本身就是面朝左, 不需要翻转 */
        if (e.elite && e.alive) drawEliteRing(uiLayer, sx, sy, 16);
        if (e.alive) drawHpBar(uiLayer, sx, sy - footOffset - 4, 28, e.hp, e.maxHp, true);
      } else if (G.bossReady && G.bossSprite && e.type === 'boss') {
        /* BOSS史莱姆王: 飘着的, 2倍大, 攻击/漂浮分帧 */
        let frameIdx;
        if (e.anim > 0) {
          const atkProgress = 1 - e.anim;
          frameIdx = BOSS_SPRITE.attackStart + Math.min(Math.floor(atkProgress * BOSS_SPRITE.attackCount), BOSS_SPRITE.attackCount-1);
        } else {
          frameIdx = BOSS_SPRITE.walkStart + (Math.floor(G.t * BOSS_SPRITE.fps) % BOSS_SPRITE.walkCount);
        }
        const col = frameIdx % BOSS_SPRITE.cols;
        const row = Math.floor(frameIdx / BOSS_SPRITE.cols);
        void col; void row;
        /* BOSS 2倍大, 漂浮不踩地板 */
        const drawH = Math.min(CH * 0.7, 140) * laneScale(e.lane);
        const drawW = drawH * (BOSS_SPRITE.fw / BOSS_SPRITE.fh);
        const floatY = BOSS_SPRITE.floatHeight + Math.sin(G.t * 1.5) * 8;  /* 漂浮上下浮动 */
        const spr = enemySpriteGL(e, batchC);
        enemyFxGL(spr, e);
        /* 攻击帧左侧特效渐隐: 预渲染掩码帧直接贴图(原每帧离屏重建, 见 bossMaskedFrame) */
        if (e.anim > 0) {
          const fi = Math.min(frameIdx - BOSS_SPRITE.attackStart, BOSS_SPRITE.attackCount - 1);
          const off = bossMaskedFrame(fi, drawW, drawH);
          if (off) {
            spr.texture = window.BattleGL.tex(off);
            spr.position.set(sx - drawW * 0.5, sy - floatY - drawH);
            spr.scale.set(1);
          }
        } else {
          /* 漂浮帧直接绘制 */
          spr.texture = frameTex(G.bossSprite, BOSS_SPRITE.cols, BOSS_SPRITE.fw, BOSS_SPRITE.fh, frameIdx);
          spr.position.set(sx - drawW * 0.5, sy - floatY - drawH);
          spr.scale.set(drawW / BOSS_SPRITE.fw, drawH / BOSS_SPRITE.fh);
        }
        /* BOSS血条在头顶, 右移对齐头部 */
        if (e.alive) drawHpBar(uiLayer, sx + drawW*0.2, sy - floatY - drawH - 8, 50, e.hp, e.maxHp, true);
      } else if (!(e.armature && e.boneSlug && BONES[e.boneSlug] && BONES[e.boneSlug].ready)) {
        /* 素材未就绪时的兜底占位(骨骼怪工厂未就绪/序列帧怪素材缺失) —— 已由通用骨骼分支画过的不再进这里 */
        let pg = e.__placeG;
        if (!pg) { pg = e.__placeG = new PIXI.Graphics(); }
        batchC.addChild(pg);
        pg.visible = true;
        pg.clear();
        pg.position.set(sx, sy);
        pg.alpha = (e.dying > 0 ? Math.max(0, e.dying / 0.4) : 1) * (e.hurtT > 0 ? 0.6 : 1);
        pg.filters = e.hurtT > 0 ? [window.BattleGL.Filters.hurt] : null;
        const bodyH = Math.min(25, CH*0.2);
        pg.beginFill(colorInt(e.color || '#888899'), 1);
        pg.drawEllipse(0, -bodyH/2, 10, bodyH/2);
        pg.endFill();
        if (e.alive) drawHpBar(uiLayer, sx, sy-35, 24, e.hp, e.maxHp, true);
      }
    }
  }

  /* v2.6.2 柔光贴图: 预渲染 radial-gradient 中心亮→边缘透, 供加法混合(lighter)绘制 ——
     替代 arc 实心点+shadowBlur(高斯投影发灰发"脏", 且每粒子实时模糊费性能) */
  function makeGlow(rgb) {
    const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
    gr.addColorStop(0, `rgba(${rgb},0.85)`);
    gr.addColorStop(0.3, `rgba(${rgb},0.32)`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    return c;
  }
  const GLOW = { heal: makeGlow('120,255,175'), atk: makeGlow('255,175,95'),
                 speed1: makeGlow('128,255,192'), speed3: makeGlow('160,180,255'), skill: makeGlow('150,220,255') };

  /* v4.0 WebGL: 精灵表切帧纹理缓存（frame → PIXI.Texture frame 引用同 baseTexture） */
  const _frameCache = new Map();
  function frameTex(img, cols, fw, fh, fi) {
    let per = _frameCache.get(img);
    if (!per) { per = { map: [], cols, fw, fh }; _frameCache.set(img, per); }
    let t = per.map[fi];
    if (!t) {
      const base = window.BattleGL.tex(img);
      t = per.map[fi] = new PIXI.Texture(base,
        new PIXI.Rectangle((fi % cols) * fw, Math.floor(fi / cols) * fh, fw, fh));
    }
    return t;
  }
  /* 玩家渲染对象组: 主 Sprite + 4 残影 + ADD 柔光 + 占位 Graphics（懒建单例） */
  function playerGL() {
    const S = drawPlayerSprite._st;
    if (S) return S;
    const C = window.BattleGL.layers.player;
    const st = { main: new PIXI.Sprite(), trails: [], glow: new PIXI.Sprite(), place: new PIXI.Graphics() };
    st.glow.anchor.set(0.5);
    st.glow.blendMode = PIXI.BLEND_MODES.ADD;
    C.addChild(st.glow);
    C.addChild(st.place);
    C.addChild(st.main);
    for (let i = 0; i < 4; i++) { const t = new PIXI.Sprite(); t.visible = false; C.addChild(t); st.trails.push(t); }
    return drawPlayerSprite._st = st;
  }
  function drawPlayerSprite() {
    const p = G.player;
    const sx = worldToScreen(p.x);
    const sy = floorY() + p.y;   /* v3.7: 玩家随车道(y 为车道偏移, 平滑过渡) */
    const S = playerGL();
    S.main.visible = S.glow.visible = S.place.visible = false;
    for (const t of S.trails) t.visible = false;
    const hurtOn = p.hurtT > 0;

    /* 技能动画渲染 (剑气斩) */
    if (p.skillAnim && G.skillReady && G.skillSprite) {
      const frameIdx = Math.min(p.skillFrame, SKILL.count - 1);
      /* 渲染尺寸: 适配战斗区高度(v3.7: 随车道纵深缩放) */
      const drawH = Math.min(CH * 0.55, 80) * laneScale(p.lane);
      const drawW = drawH * (SKILL.fw / SKILL.fh);
      /* 技能帧中角色脚底在 y=250(帧高256), 偏移对齐地板 */
      const footOffset = (SKILL.fh - 250) / SKILL.fh * drawH;
      S.main.visible = true;
      S.main.texture = frameTex(G.skillSprite, SKILL.cols, SKILL.fw, SKILL.fh, frameIdx);
      S.main.position.set(sx - drawW*0.42, sy - drawH + footOffset);
      S.main.scale.set(drawW / SKILL.fw, drawH / SKILL.fh);
      S.main.alpha = 1; S.main.filters = null;
      if (hurtOn) { S.main.alpha = 0.5+0.5*Math.sin(p.hurtT*40); S.main.filters = [window.BattleGL.Filters.playerHurt]; }
      /* 技能发光效果(原 shadowBlur 青蓝光) → ADD 柔光垫底 */
      S.glow.visible = true;
      S.glow.texture = window.BattleGL.tex(GLOW.skill);
      S.glow.position.set(sx, sy - drawH * 0.5);
      S.glow.width = S.glow.height = drawH * 1.6;
      S.glow.alpha = 0.45;
      drawHpBar('playerUI', sx, sy-drawH*0.7-10, 36, p.hp, p.maxHp);
      return;
    }

    if (!G.spriteReady || !G.sprite) {
      /* 素材未加载时用占位图形 */
      S.place.visible = true;
      S.place.clear();
      S.place.position.set(sx, sy);
      S.place.alpha = hurtOn ? 0.5+0.5*Math.sin(p.hurtT*40) : 1;
      const bodyH = Math.min(40, CH*0.3);
      S.place.beginFill(0xe8eef5, 1);
      S.place.moveTo(-10,-bodyH); S.place.lineTo(10,-bodyH); S.place.lineTo(13,-4); S.place.lineTo(-13,-4); S.place.closePath();
      S.place.endFill();
      S.place.beginFill(0xf0d8c0, 1);
      S.place.drawCircle(0, -bodyH-6, 7);
      S.place.endFill();
      drawHpBar('playerUI', sx, sy-bodyH-20, 32, p.hp, p.maxHp);
      return;
    }
    /* 真实 sprite 渲染 */
    let frameIdx;
    if (p.attackAnim) frameIdx = SPRITE.attackStart + ATTACK_MAP[Math.min(p.animFrame, ATTACK_MAP.length - 1)];
    else frameIdx = SPRITE.walkStart + (p.animFrame % SPRITE.walkCount);
    /* 渲染尺寸: 适配战斗区高度(v3.7: 随车道纵深缩放; v3.8: 80→72) */
    const drawH = Math.min(CH * 0.5, 72) * laneScale(p.lane);
    const drawW = drawH * (SPRITE.fw / SPRITE.fh);
    /* 疾风步/缩地成寸残影: 加速期间玩家身后显示3个半透明残影, 倍速越高残影越多 */
    if (G.speedMult > 1 && !p.attackAnim) {
      const trailCount = G.speedMult >= 3 ? 4 : 3;
      const ftex = frameTex(G.sprite, SPRITE.cols, SPRITE.fw, SPRITE.fh, frameIdx);
      for (let i = trailCount; i >= 1; i--) {
        const t = S.trails[i - 1];
        t.visible = true;
        t.texture = ftex;
        t.alpha = 0.12 * (trailCount + 1 - i) / trailCount;
        t.position.set(sx - i * 10, sy);
        t.scale.set((drawW / SPRITE.fw) * (1 + i * 0.03), drawH / SPRITE.fh);
      }
    }
    S.main.visible = true;
    S.main.texture = frameTex(G.sprite, SPRITE.cols, SPRITE.fw, SPRITE.fh, frameIdx);
    S.main.position.set(sx - drawW*0.35, sy - drawH);
    S.main.scale.set(drawW / SPRITE.fw, drawH / SPRITE.fh);
    S.main.alpha = 1; S.main.filters = null;
    if (hurtOn) { S.main.alpha = 0.5+0.5*Math.sin(p.hurtT*40); S.main.filters = [window.BattleGL.Filters.playerHurt]; }
    /* 攻击buff/加速光晕(原 shadowBlur) → ADD 柔光垫底 */
    let glowTex = null, glowA = 0;
    if (p.atkBuff > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(G.t * 6);
      glowTex = GLOW.atk; glowA = 0.35 + pulse*0.25;
    }
    if (G.speedMult > 1) {
      glowTex = GLOW.speed3 ? (G.speedMult >= 3 ? GLOW.speed3 : GLOW.speed1) : GLOW.speed1;
      glowA = Math.max(glowA, G.speedMult >= 3 ? 0.4 : 0.3);
    }
    if (glowTex) {
      S.glow.visible = true;
      S.glow.texture = window.BattleGL.tex(glowTex);
      S.glow.position.set(sx - drawW*0.35 + drawW/2, sy - drawH/2);
      S.glow.width = S.glow.height = drawH * 1.5;
      S.glow.alpha = glowA;
    }
    /* 血条 */
    drawHpBar('playerUI', sx, sy - drawH - 8, 36, p.hp, p.maxHp);
  }

  function drawFx() {
    /* v4.0 WebGL: 矢量特效(每 f 一个池化 Graphics 每帧重画) + Sprite 特效(掩码帧/柔光)。
     * 速度线: fx 层共享 Graphics。shadowBlur(发灰且费性能)一律由 ADD 柔光或直接略去。 */
    const fxC = window.BattleGL.layers.fx;
    const pool = drawFx._pool || (drawFx._pool = []);
    for (const o of pool) o.__used = false;
    /* 加速期间屏幕速度线: 横向线条从右向左流动, 增强速度感 */
    const lines = drawFx._lines || (drawFx._lines = (() => { const g = new PIXI.Graphics(); fxC.addChild(g); return g; })());
    lines.clear();
    if (G.speedMult > 1) {
      lines.lineStyle(1, G.speedMult >= 3 ? 0xa0b4ff : 0x80ffc0, 0.15 + (G.speedMult - 1) * 0.1);
      const lineCount = G.speedMult >= 3 ? 12 : 8;
      for (let i = 0; i < lineCount; i++) {
        const y = (i / lineCount) * CH + (G.t * 200 * G.speedMult + i * 37) % CH;
        const x = (G.t * 300 * G.speedMult + i * 53) % CW;
        const len = 30 + Math.random() * 50;
        lines.moveTo(x, y);
        lines.lineTo(x - len, y);
      }
    }
    for (const f of G.fx) {
      /* v2.6 FIX: f.y 是相对地板线的偏移(敌人/玩家 y=0), 屏幕坐标须加 floorY() */
      const k = f.t/f.dur; const sx = worldToScreen(f.x); const fy = floorY() + f.y;
      let o = f.__gl;
      if (!o) {
        o = f.__gl = { __used: true, g: new PIXI.Graphics(), spr: null };
        fxC.addChild(o.g);
        pool.push(o);
      }
      o.__used = true;
      o.g.visible = true;
      if (o.spr) o.spr.visible = false;
      const g = o.g;
      g.clear();
      g.position.set(sx, fy);
      g.alpha = 1; g.filters = null;
      if (f.kind === 'hitSpark') {
        /* 受击火花: 不旋转, 4条向外扩散的短线 */
        g.lineStyle(1.2, colorInt(f.color), 1-k);
        for (let i=0; i<4; i++) {
          const ang = i * Math.PI/2 + Math.PI/4;
          const r1 = 2 + k*4, r2 = 6 + k*8;
          g.moveTo(Math.cos(ang)*r1, Math.sin(ang)*r1);
          g.lineTo(Math.cos(ang)*r2, Math.sin(ang)*r2);
        }
      } else if (f.kind === 'slash') {                    // 剑气斩: 一道横掠的剑气
        g.lineStyle(2, colorInt(f.color), 1-k);
        const w = 26 + k*34;
        g.moveTo(-w*0.5, 6+k*4);
        g.lineTo(w*0.5, -2-k*6);
      } else if (f.kind === 'hengsao') {                  // 横扫千军: sprite特效, 从左向右扫, 快速淡出
        if (G.hengsaoReady && G.hengsaoSprite) {
          const frameIdx = Math.min(f.frame, HENGSAO_SPRITE.count - 1);
          /* v3.8: 剑气贴合本道高度, 缩到≈玩家身高, 配合 y 已带车道偏移 */
          const drawW = 200;
          const drawH = drawW * (HENGSAO_SPRITE.fh / HENGSAO_SPRITE.fw);
          /* 特效从左向右移动: startX到endX插值 */
          const moveX = (f.startX || f.x) + ((f.endX || f.x+120) - (f.startX || f.x)) * k;
          const moveSx = worldToScreen(moveX);
          /* 透明度曲线: 前15%快速渐入, 中间保持最亮, 后40%快速淡出 */
          let alpha;
          if (k < 0.15) alpha = k / 0.15;
          else if (k < 0.6) alpha = 1.0;
          else alpha = (1 - k) / 0.4;
          /* v2.9 PERF: 左右渐现渐隐掩码帧按帧号缓存(同 BOSS_MASK 模式) */
          if (!HENGSAO_MASK.frames) HENGSAO_MASK.frames = [];
          let off = HENGSAO_MASK.frames[frameIdx];
          if (!off) {
            off = document.createElement('canvas');
            off.width = drawW; off.height = drawH;
            const octx = off.getContext('2d');
            octx.drawImage(G.hengsaoSprite, (frameIdx % HENGSAO_SPRITE.cols) * HENGSAO_SPRITE.fw,
              Math.floor(frameIdx / HENGSAO_SPRITE.cols) * HENGSAO_SPRITE.fh, HENGSAO_SPRITE.fw, HENGSAO_SPRITE.fh, 0, 0, drawW, drawH);
            octx.globalCompositeOperation = 'destination-in';
            /* 左侧20%渐现, 右侧20%渐隐, 中间保持不透明 */
            const grad = octx.createLinearGradient(0, 0, drawW, 0);
            grad.addColorStop(0, 'rgba(0,0,0,0)');
            grad.addColorStop(0.2, 'rgba(0,0,0,1)');
            grad.addColorStop(0.8, 'rgba(0,0,0,1)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            octx.fillStyle = grad;
            octx.fillRect(0, 0, drawW, drawH);
            HENGSAO_MASK.frames[frameIdx] = off;
          }
          if (!o.spr) { o.spr = new PIXI.Sprite(); o.spr.anchor.set(0.5); fxC.addChild(o.spr); }
          o.g.visible = false;
          o.spr.visible = true;
          o.spr.texture = window.BattleGL.tex(off);
          o.spr.position.set(moveSx, fy);
          o.spr.alpha = Math.max(0, Math.min(1, alpha));
        }
      } else if (f.kind === 'sweep') {                    // 横扫千军: 一道贴地弧光(兜底)
        g.lineStyle(2.5, colorInt(f.color), (1-k)*0.9);
        g.arc(0, 0, 18 + k*46, -Math.PI*0.15, Math.PI*0.42);
      } else if (f.kind === 'death') {
        g.beginFill(colorInt(f.color), (1-k)*0.9);
        for (let i=0; i<8; i++) {
          const ang = i/8*6.28, r = k*15;
          g.drawCircle(Math.cos(ang)*r, Math.sin(ang)*r, 1.8*(1-k)+0.5);
        }
        g.endFill();
      } else if (f.kind === 'speedBurst') {
        /* 身法触发: 速度爆发 —— 冲击波圆环 + 向后气流线 + 粒子飞溅(原 shadowBlur 略去) */
        g.position.set(sx, fy - 25);
        /* 冲击波圆环: 从中心向外扩散 */
        g.lineStyle(2, colorInt(f.color), (1-k) * 0.6);
        g.drawCircle(0, 0, 5 + k*35);
        /* 向后气流线: 8条, 从中心向后扩散 */
        g.lineStyle(1.8, colorInt(f.color), (1-k) * 0.9);
        for (let i=0; i<8; i++) {
          const ang = Math.PI + (i/7 - 0.5) * 1.2;  /* 向后扇形扩散 */
          const r1 = 3 + k*8, r2 = 12 + k*40;
          g.moveTo(Math.cos(ang)*r1, Math.sin(ang)*r1);
          g.lineTo(Math.cos(ang)*r2, Math.sin(ang)*r2);
        }
        /* 粒子飞溅: 6个小光点向后飞 */
        g.lineStyle(0);
        g.beginFill(colorInt(f.color), (1-k) * 0.7);
        for (let i=0; i<6; i++) {
          const ang = Math.PI + (Math.random()-0.5)*1.5;
          const r = 8 + k*45;
          g.drawCircle(Math.cos(ang)*r, Math.sin(ang)*r, 1.5*(1-k)+0.5);
        }
        g.endFill();
      } else if (f.kind === 'healParticle' || f.kind === 'atkParticle') {
        /* v2.6.2: 柔光粒子(ADD 加法发光) —— 压在角色身上是"透亮"而非"盖色" */
        const img = f.kind === 'healParticle' ? GLOW.heal : GLOW.atk;
        const r = (2.2 + (1-k)*2.6) * 2.4;
        if (!o.spr) { o.spr = new PIXI.Sprite(); o.spr.anchor.set(0.5); o.spr.blendMode = PIXI.BLEND_MODES.ADD; fxC.addChild(o.spr); }
        o.g.visible = false;
        o.spr.visible = true;
        o.spr.texture = window.BattleGL.tex(img);
        o.spr.position.set(sx, fy);
        o.spr.width = o.spr.height = r * 2;
        o.spr.alpha = (1-k) * 0.7;
      } else if (f.kind === 'healBurst' || f.kind === 'atkBurst') {
        /* v2.6.2: 施法完成 → 一团柔光从角色胸口绽开(ADD) */
        const img = f.kind === 'healBurst' ? GLOW.heal : GLOW.atk;
        const r = 14 + k * 40;
        if (!o.spr) { o.spr = new PIXI.Sprite(); o.spr.anchor.set(0.5); o.spr.blendMode = PIXI.BLEND_MODES.ADD; fxC.addChild(o.spr); }
        o.g.visible = false;
        o.spr.visible = true;
        o.spr.texture = window.BattleGL.tex(img);
        o.spr.position.set(sx, fy);
        o.spr.width = o.spr.height = r * 2;
        o.spr.alpha = (1-k) * 0.75;
      }
    }
    /* 对账回收: fx 已被 splice 的池对象销毁 */
    for (let i = pool.length - 1; i >= 0; i--) {
      const o = pool[i];
      if (o.__used) continue;
      o.g.destroy();
      if (o.spr) o.spr.destroy();
      pool.splice(i, 1);
    }
  }

  /* 现代游戏伤害飘字: 暴击放大+金光描边, 快速浮现→上浮→渐隐, 横向随机漂移避免堆叠
   * v4.0 WebGL: 每条飘字一个 PIXI.Text(跟随 d 生命周期创建/销毁, 同屏量小)。 */
  function drawDmg() {
    const textC = window.BattleGL.layers.text;
    const pool = drawDmg._pool || (drawDmg._pool = []);
    for (const o of pool) o.__used = false;
    for (const d of G.dmg) {
      const k = Math.min(1, d.t / 0.95);
      const a = Math.max(0, Math.min(1, k < 0.12 ? k/0.12 : 1 - (k-0.12)/0.88));  // 起手快现, 之后渐隐
      const sx = worldToScreen(d.x) + (d.vx || 0) * k;
      const sy = floorY() + d.y - 40 * k;
      const pop = d.crit ? 1 + 0.6*Math.max(0, 1-k*2.2) : 1 + 0.35*Math.max(0, 1-k*3);
      let o = d.__gl;
      if (!o) {
        const style = new PIXI.TextStyle({
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          fontSize: d.crit ? 19 : 12,
          fontWeight: 'bold',
          fill: d.color || '#eaf2fb',
          stroke: 'rgba(6,10,18,0.95)',
          strokeThickness: d.crit ? 4 : 3,
          lineJoin: 'round'
        });
        if (d.crit) {
          style.dropShadow = true;
          style.dropShadowColor = 'rgba(255,196,80,0.9)';
          style.dropShadowBlur = 10;
          style.dropShadowDistance = 0;
          style.dropShadowAlpha = 0.9;
        }
        const t = new PIXI.Text(String(d.val), style);
        t.anchor.set(0.5);   // textAlign center + textBaseline middle
        o = d.__gl = { __used: true, t: t };
        textC.addChild(t);
        pool.push(o);
      }
      o.__used = true;
      o.t.visible = true;
      o.t.alpha = a;
      o.t.position.set(sx, sy);
      o.t.scale.set(pop);
    }
    /* 对账回收: 飘字已被 splice 的 Text 销毁(Text 位图纹理必须显式释放) */
    for (let i = pool.length - 1; i >= 0; i--) {
      const o = pool[i];
      if (o.__used) continue;
      o.t.destroy();
      pool.splice(i, 1);
    }
  }

  /* 战斗层清屏 —— v3.2 关键修正
   *
   * 独立模式（自己就是 #battleCanvas 的主人）：必须 clearRect，直接透出底下的 #bg。
   *
   * 舞台模式（本层被 60-stage 驱动，ctx 指向【共享舞台画布】）：
   *   ⚠️ 绝不能 clearRect —— 60-stage.tick() 每帧已经 clearRect 整屏一次，而这里
   *      CW/CH 是「横带自身的宽高」，直接擦就是擦共享画布上 (0,0,CW,CH) 那一块，
   *      会顺手把【横带下方/上方其它层已画好的东西】一起擦掉（实测每天擦掉 y<306
   *      以内的一切，月亮被擦成黑洞就是这么来的）。
   *   改成在【横带自己的坐标系里】铺一层不透明底色：视觉上与"擦出一个干净条带"
   *   完全等价（横带内所有像素回到夜空底色），但裁剪区域外的像素一个都不动。
   *   save/restore 保证底色只作用于横带内部，也不会污染 worldToScreen 平移。 */
  /* v4.0 WebGL: 全部内容画进 BattleGL 的 Pixi 容器（横带本地坐标）——
   * 2D 清屏/底色渐变由 bgGradSprite 接管（GL canvas 是透明层，每帧全量重建，
   * 无 clearRect 概念）；ctx 参数仅保留签名兼容，绘制链路零 2D 调用。 */
  function render(clear) {
    /* UI 层共享 Graphics 每帧 clear 重画(2D 时代靠清屏自然清, GL 必须显式清,
     * 否则血条/法环矩形逐帧累积成满屏红条 —— 首轮冒烟实锤) */
    const GL = window.BattleGL;
    if (GL && GL.ready) {
      GL.layers.farUI._gfx.clear();
      GL.layers.playerUI._gfx.clear();
      GL.layers.nearUI._gfx.clear();
    }
    drawBg();
    /* v3.8.2 遮挡分层: 远道怪 → 掉落 → 玩家 → 宠物 → 近道怪(近盖远, 画家算法) */
    drawEnemies(e => e.y < G.player.y, 'far');
    drawDrops(); drawPlayerSprite(); drawPets();
    drawEnemies(e => e.y >= G.player.y, 'near');
    drawFx(); drawDmg(); drawSkillCall();
  }

  /* v3.2 舞台模式绘制：把战斗画到统一舞台画布的一条横带上。
   *
   * 关键：只有【绘制】被限制在横带内，游戏逻辑仍在整屏宽坐标系里跑
   * （floorY = CH*0.82 用的 CH 是横带自身高度，与原来独立画布完全一致），
   * 所以合并不会改变任何运动学数值。
   *
   * ⚠️ dt 必须由调用方传入【原始 dt】——倍速乘法只发生在 update() 第一行。
   * 见下方 battleLayer()。
   */

  /* ---------- 技能名播报绘制: 书法字金渐变+深描边, 弹入→稳住→末段快淡出上飘(瞬间隐藏) ----------
   * v2.9: 字号放大到战斗动画区可读(原 12.5px 太小, 看不出在播报什么);
   *       淡出窗口收到末 18% —— 前半段"看得清", 后半段"秒没", 不拖泥带水。
   * v4.0 WebGL: 单例 PIXI.Text 挂 text 层 —— fill 数组即竖向线性渐变
   *       (TextStyle 原生支持, 等价 canvas createLinearGradient 两档 stop)。 */
  function drawSkillCall() {
    const textC = window.BattleGL.layers.text;
    if (!drawSkillCall._t) {
      drawSkillCall._t = new PIXI.Text('', {
        fontFamily: '"Kaiti SC","STKaiti","KaiTi","DFKai-SB","BiauKai",serif',
        fontWeight: '600',
        fill: ['#ffe9b0', '#f0b95a'],
        stroke: 'rgba(18,12,4,.9)',
        strokeThickness: 4,
        lineJoin: 'round'
      });
      drawSkillCall._t.anchor.set(0.5);
      textC.addChild(drawSkillCall._t);
    }
    const t = drawSkillCall._t;
    const c = G.skillCall;
    if (!c) { t.visible = false; return; }
    const k = c.t / c.dur;
    let scale;
    if (k < 0.16) scale = 0.46 + (k / 0.16) * 0.66;          // 0.46 → 1.12 弹入
    else if (k < 0.3) scale = 1.12 - ((k - 0.16) / 0.14) * 0.10;   // 回落到 1.02
    else scale = 1.02;
    const fade = k < 0.82 ? 1 : Math.max(0, 1 - (k - 0.82) / 0.18);
    const rise = k < 0.82 ? 0 : (k - 0.82) * 46;
    /* 字号: 屏宽 3.4% 起, 夹在 15~24px —— 手机上既醒目又不糊成一团 */
    const size = Math.round(Math.max(15, Math.min(CW * 0.034, 24)));
    if (t.text !== c.name) t.text = c.name;
    if (t.style.fontSize !== size) t.style.fontSize = size;
    const st = Math.max(2.2, size * 0.15);
    if (t.style.strokeThickness !== st) t.style.strokeThickness = st;
    t.visible = true;
    t.alpha = fade;
    t.position.set(CW / 2, CH * 0.30 - rise);
    t.scale.set(scale);
  }

  function updateHUD() {
    const killsEl = document.getElementById('battleKills');
    const speedEl = document.getElementById('battleSpeed');
    const stateEl = document.getElementById('battleState');
    const spEl = document.getElementById('battleSpirit');
    const trEl = document.getElementById('battleTrial');
    if (killsEl) killsEl.textContent = G.kills;
    if (spEl) spEl.textContent = fmtNum(G.spirit);
    if (speedEl) {
      if (G.speedMult > 1) { speedEl.style.display = ''; speedEl.textContent = '×'+G.speedMult+' 倍速 ('+G.speedMultTimer.toFixed(1)+'s)'; }
      else speedEl.style.display = 'none';
    }
    if (stateEl) stateEl.textContent = G.state === 'fight' ? '战斗中' : '推进中';
    /* v3.9 试炼 HUD: 倒计时+档位; 有离线加成时点亮 */
    if (trEl) {
      const td = BC.tier[G.trialTier] || BC.tier[1];
      const m = Math.floor(G.trialT / 60), s = Math.floor(G.trialT % 60);
      trEl.textContent = `妖潮·${td.name} ${m}:${s < 10 ? '0' : ''}${s}`;
      try {
        if (state && state.trialBoost > 0 && (state.trialBoostUntil || 0) > Date.now()) trEl.classList.add('boosted');
        else trEl.classList.remove('boosted');
      } catch (err) {}
    }
  }

  /* v2.6 PERF: ① 30fps 限帧(素材24fps, 高刷屏不再全速空转省电) ② 暂停放泵 —— G.paused 时不再空转 rAF, 由 BattleAPI.resume 重启
   * v3.2: 调度权交给 60-stage（统一 ticker）。
   *   独立模式（standalone，旧行为）走 runLoop；
   *   舞台模式只暴露 step(dt) —— 由 60-stage 按统一 30fps 调用，
   *   本层不再自持 rAF、不再自己限帧。 */
  let lastT = 0;
  let _rafOn = false;
  let _lastPaint = 0;
  let _sleepT = 0;              /* v2.9: 限帧 setTimeout 句柄 —— 暂停/恢复时必须清掉, 否则双链跑帧 */
  const BATTLE_FRAME_MS = 33;   // ≈30fps
  let _managed = false;         // v3.2: true = 由 60-stage 驱动
  let _pumpRuns = 0;            // v4.1.1: 独立泵实际执行帧数(诊断口)
  function loop(t) {
    if (_managed || G.paused) { _rafOn = false; lastT = t; return; }   // v4.1.2: 舞台接管/暂停 → 停泵
    _rafOn = true; _pumpRuns++;
    const wait = BATTLE_FRAME_MS - (t - _lastPaint);
    if (wait > 4) {
      /* v2.9 PERF: 限帧期间真正让出主线程 —— 原先无条件续 rAF, 高刷屏上按屏幕刷新率
       * (实测 110fps)空转, 白烧 ~3.7× 合成开销。改为睡到下一帧时间点。
       * 阈值 >4ms 才睡: 余量过小 setTimeout 会立即返回, 退化成紧凑循环。 */
      _sleepT = setTimeout(() => { _sleepT = 0; if (!G.paused) requestAnimationFrame(loop); else _rafOn = false; }, wait);
      return;
    }
    requestAnimationFrame(loop);
    _lastPaint = t;
    const dt = Math.min(0.05, (t-lastT)/1000); lastT = t;
    update(dt); render(true);   /* 独立模式：自己就是画布主人，清屏透出底下 #bg */
    /* v4.0 WebGL: 独立模式横带=全屏（band 语义与 stage 一致） */
    { const GL = window.BattleGL; if (GL && GL.ready) GL.frame(0, window.innerHeight, 'standalone-loop'); }
  }

  /* v3.2: 交给 60-stage 的层对象，绘制顺序排在 bg 之后、aura 之前
   * v4.0 WebGL: 本层不再往 2D ctx 画任何东西 —— render 全量走 BattleGL，
   *   末尾 frame(band.top, band.height) 同步横带平移+遮罩+渲染。
   *   ctx 仅在暂停/未就绪分支之外做形参接住（签名兼容），2D 画布零触摸。 */
  function battleLayer() {
    return {
      name: 'battle',
      resize() { /* 几何由 battleBand() 决定，随舞台尺寸即时计算 */ },
      draw(targetCtx, W, H, dt) {
        if (!G || !G.player) return;
        if (G.paused) return;                 /* 黑屏挂机：逻辑也停 */
        /* ⚠️ dt 是【原始 dt】。倍速乘法在 update() 第一行完成，舞台绝不代劳。 */
        update(dt);
        const band = (typeof window !== 'undefined' && window.__stageBand)
          ? window.__stageBand()
          : { top: 92, height: Math.max(1, 0.56 * H - 176) };
        const savedCW = CW, savedCH = CH;
        CW = W; CH = band.height;
        try {
          render(false);   /* 画进 GL 横带本地坐标 */
          const GL = window.BattleGL;
          if (GL && GL.ready) GL.frame(band.top, band.height, '60-stage');   /* root.y 平移 + 遮罩 + app.render() */
        } finally {
          CW = savedCW; CH = savedCH;
        }
      },
    };
  }

  function init() {
    if (!initCanvas()) { setTimeout(init, 200); return; }
    G.player = makePlayer(); G.player.x = 100;
    /* 默认宠物: 灵狐, 在玩家左上方飞行跟随 */
    G.pets.push({
      id: 'pet_fox', name: '灵狐', type: 'fox',
      atk: 0, aspd: 0, atkRange: 0, hp: 999, maxHp: 999,
      offsetX: -65, offsetY: -70,
      x: 35, y: 0, atkT: 0, anim: 0, hurtT: 0, alive: true,
      flyFrame: 0, flyTimer: 0, bobT: 0,
      fetch: { state: 'idle', drop: null },   /* 拾取装备状态 */
      /* 施法系统 */
      castTimer: 4,       /* 首次施法4秒后 */
      casting: false,
      castAnim: 0,        /* 施法动画进度 0-1 */
      castType: null,     /* 'heal' | 'atk' */
      effectTimer: 0      /* 特效粒子计时 */
    });
    updateHUD();
    if (typeof window.pushBattleStats === 'function') window.pushBattleStats();
    /* v3.2: 舞台模式下由 60-stage 驱动，自己不启 rAF */
    /* v4.1.2: 不自动启泵 —— 主游戏必走 60-stage(createStageLayer 已置 _managed);
     * 独立调试页显式调 BattleAPI.resume() 启泵(其 guard 放行 !_managed)。
     * 自动启泵 + 接管时序竞争 = 双泵抖动根因, 见 createStageLayer 注释。 */
  }

  /* v3.2: 初始化但不启动自持循环（舞台模式） */
  function initManaged() {
    _managed = true;
    let tries = 0;
    return new Promise((resolve) => {
      const go = () => {
        if (document.getElementById('battleCanvas')) { init(); resolve(battleLayer()); return; }
        if (++tries > 50) { resolve(null); return; }
        setTimeout(go, 100);
      };
      go();
    });
  }

/* ── 模块加载即初始化（保留原 IIFE 的副作用语义，仅执行一次）─────────
 * 原脚本在 IIFE 末尾自行判断 DOMContentLoaded 后调用 init()，
 * 抽取时已剥离那段尾部语句，在此统一启动，避免双份 rAF 循环。
 * 加载序：game.js 垫片先载入并 bridge 全局 → 再 import 本模块 → 本模块 import
 * 00-pure/10-base/30-systems，故 init() 执行时 $ / state / makeArt 均已就绪。
 */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
