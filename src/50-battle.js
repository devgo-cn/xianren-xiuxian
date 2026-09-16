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


  const BC = {
    /* 占位怪 demon(妖将)/raptor(妖弓) 已移除 —— 只保留两种有真实素材的怪 */
    playerAtkRange: 75, playerAspd: 1.1, playerSpeed: 28,
    spawnInterval: 1.0, enemySpawnOffset: 40, maxAlive: 14, queueGap: 34,
    enemies: {
      /* hpK/atkK/defK: 按玩家境界(lv)线性成长 —— 怪只随境界长, 玩家随境界+装备长, 换装即提速。
       * hpK 定"一轮两剑能否收掉": 妖卒约一轮一只(收草手感), 水灵约两轮(略厚)。 */
      slime: { name:'妖卒', role:'melee', w:60, atkRange:30, speed:120, hpK:1.0, atkK:0.55, defK:0.35, color:'#6fe0a8' },
      water: { name:'水灵', role:'melee', w:40, atkRange:35, speed:80,  hpK:1.6, atkK:0.75, defK:0.60, color:'#6fd0e8' },
      /* v3.6 骨骼怪: 鼠妖 —— DragonBones 骨骼动画(assets/db/)经 Canvas2D 桥实时渲染,
       * 与序列帧怪并存。bone 字段 = 骨架名(Ratty 包内 armature 名), 有 bone 字段即走骨骼管线。 */
      rat:   { name:'鼠妖', role:'melee', w:35, atkRange:32, speed:150, hpK:0.8, atkK:0.5, defK:0.25, color:'#c9b28f', bone:'Ratty' },
      /* v2.6 调参: hpK 80→52(实测过厚约-35%), atkRange 70→45(玩家攻距75, 贴身才能互殴, 修复"剑够不到") */
      boss:  { name:'史莱姆王', role:'ranged', w:5,  atkRange:45, speed:40, hpK:52, atkK:3.0, defK:3.0, color:'#a0ff80', isBoss:true, floatHeight:10, sizeMult:2.0 },
    },
  };

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
    smallKillsSinceBoss:0, bossActive:false, bossSpawnEvery:10,
    skillCall:null,          /* 技能名播报槽: 覆盖式大字快闪, {name,t,dur} */
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
   * Ratty 骨骼包(_ske.json + _tex.json + _tex.png)预构建一个工厂,
   * 每只鼠妖 makeEnemy 时 buildArmature 出独立骨架实例(动画互不干扰)。
   * 桥/UMD 由 index.html 以经典脚本先于模块加载 —— 失败则鼠妖自动走兜底占位渲染。 */
  const RATTY = { ready:false, factory:null, anims:{}, baseH:0, armName:'Ratty' };
  (function loadRatty() {
    if (!window.CanvasDragonBones) { console.warn('[battle] CanvasDragonBones 未加载, 鼠妖走兜底渲染'); return; }
    const img = new Image();
    let ske = null, tex = null;
    const tryBuild = () => {
      if (!ske || !tex || !img.naturalWidth || RATTY.ready) return;
      try {
        RATTY.factory = window.CanvasDragonBones.buildFactory(ske, tex, img);
        /* 探针骨架: 确认动画齐备 + 记录 idle 姿态的基准高度(渲染缩放用, 避免动画间呼吸式缩放) */
        const probe = RATTY.factory.buildArmature(RATTY.armName);
        const A = probe.animation;
        for (const n of ['idle','dead','attack','hurt','walk']) RATTY.anims[n] = A.hasAnimation(n);
        const bb = window.CanvasDragonBones.armatureAABB(probe);
        RATTY.baseH = Math.max(1, bb.maxY - bb.minY);
        probe.dispose();
        RATTY.ready = true;
        console.log('[battle] 鼠妖骨骼工厂就绪 baseH=' + RATTY.baseH.toFixed(1) + ' anims=' + JSON.stringify(RATTY.anims));
      } catch (err) { console.error('[battle] Ratty 骨骼工厂构建失败', err); }
    };
    fetch('assets/db/ratty_ske.json').then(r => r.json()).then(j => { ske = j; tryBuild(); }).catch(err => console.error('[battle] ratty_ske 加载失败', err));
    fetch('assets/db/ratty_tex.json').then(r => r.json()).then(j => { tex = j; tryBuild(); }).catch(err => console.error('[battle] ratty_tex 加载失败', err));
    img.onload = tryBuild;
    img.src = 'assets/db/ratty_tex.png';
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
    createStageLayer: () => battleLayer(),
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
    /* v2.9: 暂停时清掉限帧 sleep 句柄 —— 否则那枚 setTimeout 醒来时 G.paused 已为 true,
     * 会直接 return 且把 _rafOn 留成 true, 导致 resume 认为"泵还在跑"而不重启(死锁)。 */
    pause: () => { G.paused = true; if (_sleepT) { clearTimeout(_sleepT); _sleepT = 0; } _rafOn = false; },
    resume: () => { G.paused = false; lastT = performance.now(); _lastPaint = 0; if (_sleepT) { clearTimeout(_sleepT); _sleepT = 0; } if (!_rafOn) { _rafOn = true; requestAnimationFrame(loop); } },
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
  /* 怪物成长系统: 三围随玩家境界 lv 线性成长(怪只吃境界, 不吃装备 → 换装备=变快) */
  function makeEnemy(type) {
    const def = BC.enemies[type] || BC.enemies.slime;
    const lv = Math.max(1, PST.lv || 1);
    const elite = Math.random() < DROP.eliteChance;
    let hp  = Math.round((60 + 26*lv) * def.hpK);
    let atk = Math.round((8 + 5*lv)   * def.atkK);
    const dfn = Math.round((2 + 2*lv)   * def.defK);
    if (elite) { hp = Math.round(hp*DROP.eliteHp); atk = Math.round(atk*1.2); }
    const lane = (Math.random() * LANES) | 0;   /* v3.7: 三车道随机刷怪 */
    const r = { type,name:def.name,role:def.role, elite, lane, y:laneOff(lane), x:0, hp,maxHp:hp, atk, def:dfn,
      atkRange:def.atkRange, speed:def.speed*(0.9+Math.random()*0.2)*(elite?0.85:1), color:def.color,
      atkT:Math.random()*0.6, anim:0,hurtT:0,stun:0, alive:true,dying:0,reach:1, animFrame:0, animTimer:0, moving:false };
    /* 骨骼怪: 工厂就绪时建一只独立骨架实例(每只怪动画独立推进) */
    if (def.bone && RATTY.ready && def.bone === RATTY.armName) {
      try { r.armature = RATTY.factory.buildArmature(def.bone); r.boneAnim = 'walk'; } catch (err) { console.error('[battle] buildArmature 失败', err); }
    }
    return r;
  }
  function spawnWave() {
    /* BOSS活跃时不刷新小怪 */
    if (G.bossActive) return null;
    /* 每60只小怪刷一只BOSS */
    if (G.smallKillsSinceBoss >= G.bossSpawnEvery) {
      if (G.enemies.filter(x => x.alive && x.dying <= 0).length >= BC.maxAlive) return null;
      const e = makeEnemy('boss');
      e.x = G.camX + stageW() + BC.enemySpawnOffset;
      e.elite = true;  /* BOSS标记为精英 */
      e.lane = 1; e.y = laneOff(1);   /* BOSS 固定中道, 突出存在感 */
      G.enemies.push(e);
      G.bossActive = true;
      G.smallKillsSinceBoss = 0;
      return e;
    }
    const types = Object.keys(BC.enemies).filter(t => t !== 'boss');
    const tw = types.reduce((s,t) => s + (BC.enemies[t].w || 1), 0);
    let r = Math.random()*tw, type = types[0];
    for (const t of types) { r -= (BC.enemies[t].w || 1); if (r <= 0) { type = t; break; } }
    if (G.enemies.filter(x => x.alive && x.dying <= 0).length >= BC.maxAlive) return null;
    const e = makeEnemy(type);
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
  function drawGem(x, y, r, fill, hi) {
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.72, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.72, y); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.72, y); ctx.lineTo(x, y); ctx.closePath(); ctx.fillStyle = hi; ctx.fill();
  }
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
  function drawDrops() {
    for (const d of G.drops) {
      if (d.phase === 'done') continue;
      if (d.kind === 'spirit') {
        ctx.save(); ctx.translate(d.x, d.y);
        const pulse = 1 + Math.sin(d.t * 6) * 0.08;
        ctx.globalAlpha = d.phase === 'fly' ? 0.92 : 1;
        ctx.fillStyle = 'rgba(103,201,171,0.28)';
        ctx.beginPath(); ctx.arc(0, 0, 9 * pulse, 0, Math.PI * 2); ctx.fill();
        drawGem(0, 0, 7 * pulse, '#67c9ab', '#b7ecda');
        ctx.restore();
      } else {
        const sc = d.scale; if (sc <= 0.02) continue;
        /* 贴地阴影(未起飞时) */
        if (d.phase === 'wait' || d.phase === 'fetch' || d.phase === 'land') {
          ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = '#000';
          ctx.beginPath(); ctx.ellipse(d.x, floorY() + (d.gy || 0) - 4, 10 * sc, 3 * sc, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
        ctx.save(); ctx.translate(d.x, d.y - 14 * sc); ctx.scale(sc, sc);
        ctx.globalAlpha = 0.5; ctx.strokeStyle = dropRarityColor(d.eq.q); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        if (d.img && d.img.complete && d.img.naturalWidth) {
          ctx.save();                              /* 图标裁成圆形宝珠(素材自带深色方底) */
          ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.clip();
          ctx.drawImage(d.img, -12, -12, 24, 24);
          ctx.restore();
        }
        else { ctx.fillStyle = dropRarityColor(d.eq.q); ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(-11, -11, 22, 22, 4) : ctx.rect(-11, -11, 22, 22)); ctx.fill(); }
        ctx.restore();
      }
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
      /* 无怪，向前推进 */
      p.moving = 1; p.walkT += dt*8; p.x += BC.playerSpeed*dt;
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
  /* 骨骼怪动画状态机: 游戏状态(hurt/anim/moving/dying) → Ratty 动作, fadeIn 平滑过渡。
   * playTimes=-1 走动画数据自带循环设置(循环动作无限循环, attack/hurt/dead 播一次定格)。 */
  function advanceRatty(e, dt, dead) {
    const A = e.armature.animation;
    let want = 'walk';
    if (dead && RATTY.anims.dead) want = 'dead';
    else if (e.hurtT > 0 && RATTY.anims.hurt) want = 'hurt';
    else if (e.anim > 0 && RATTY.anims.attack) want = 'attack';
    else if (!e.moving && RATTY.anims.idle) want = 'idle';
    if (!A.hasAnimation(want)) want = 'walk';
    if (e.boneAnim !== want) { e.boneAnim = want; A.fadeIn(want, 0.12, -1); }
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
    for (const e of G.enemies) {
      if (e.dying>0) { e.dying-=dt; if (e.armature) advanceRatty(e, dt, true); continue; }
      if (!e.alive) continue;
      if (e.armature) advanceRatty(e, dt, false);   /* 骨骼怪: 推进动画(吃倍速 dt, 与移动节奏一致) */
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
    G.enemies = G.enemies.filter(e => e.alive || e.dying>0);
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
  function update(dt) {
    if (G.speedMultTimer > 0) {
      G.speedMultTimer -= dt;
      if (G.speedMultTimer <= 0) { G.speedMult = 1; G.speedMultTimer = 0; G.speedDodge = 0; }   // 身法时效到点, 闪避加成一并散去
      updateHUD();
    }
    const sdt = dt * G.speedMult;
    G.t += sdt;
    const aliveEnemies = G.enemies.filter(e => e.alive && e.dying<=0);
    const newState = aliveEnemies.length > 0 ? 'fight' : 'walk';
    if (newState !== G.state) { G.state = newState; updateHUD(); }
    G.spawnT -= sdt;
    if (G.spawnT <= 0) { spawnWave(); G.spawnT = BC.spawnInterval; }
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
  /* 纵深缩放: 越远的道越小一档(0.88/0.94/1.0), 强化三车道空间感 */
  /* v3.8 纵深差加大: 0.88/0.94/1.0 肉眼难辨, 改 0.80/0.90/1.0 —— 远道明显更小更远 */
  function laneScale(lane) { return 1 - (LANES - 1 - lane) * 0.10; }
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
  function drawCloudShape(x, y, s, alpha) {
    /* 一朵云 = 4 个椭圆拼的云团(同一路径一次填充, 重叠处不会加深) */
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = '#d8e4f0';
    ctx.beginPath();
    ctx.ellipse(x, y, 70 * s, 13 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 40 * s, y + 4 * s, 32 * s, 8 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 42 * s, y + 5 * s, 28 * s, 7 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 8 * s, y - 9 * s, 34 * s, 9 * s, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.restore();
  }
  function drawClouds() {
    /* 三层视差云: 远层慢而淡、近层快而实; 随摄像机视差滚动 + 自身缓慢漂移 + 上下浮动 */
    const t = G.t;
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
        drawCloudShape(sx, cy, L.sc * (0.8 + r * 0.45), L.alpha);
      }
    }
  }
  function drawGround() {
    /* 地面带 + 1:1 滚动刻度/碎石 —— 推进感的主要参照物 */
    const fy = floorY();
    const g = ctx.createLinearGradient(0, fy, 0, fy + 16);
    g.addColorStop(0, 'rgba(180,170,140,0.10)');
    g.addColorStop(1, 'rgba(180,170,140,0.02)');
    ctx.fillStyle = g; ctx.fillRect(0, fy, CW, 16);
    /* 刻度斜线: 世界坐标每 56px 一条, 随 camX 滚动 */
    const gap = 56, off = ((G.camX % gap) + gap) % gap;
    ctx.strokeStyle = 'rgba(180,170,140,0.16)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = gap - off; x < CW + gap; x += gap) { ctx.moveTo(x, fy + 3); ctx.lineTo(x - 6, fy + 11); }
    ctx.stroke();
    /* 碎石点: 按世界格索引取确定性伪随机, 高低错落 */
    const gap2 = 23, start = Math.floor(G.camX / gap2) - 1, end = start + Math.ceil(CW / gap2) + 3;
    ctx.fillStyle = 'rgba(200,190,160,0.13)';
    for (let i = start; i < end; i++) {
      const r = hash01(i * 2654435761);
      ctx.fillRect(i * gap2 - G.camX, fy + 4 + r * 9, 2, 1.5);
    }
  }
  function drawBg() {
    /* v3.7 幽夜森林背景: 随摄像机 0.5 视差滚动, 【镜像交替平铺】实现左右无限无缝拼接。
     * 手法: 把图按宽度切成份, 全局份序号奇偶交替 —— 偶数份原图、奇数份水平翻转。
     * 任何图与自身镜像在边缘处像素级对称(数学保证), 相邻份交接处必然无缝,
     * 不要求素材本身可循环平铺。周期 = 2×drawW(正+反一循环)。 */
    const fy = floorY();
    if (G.bgReady && G.bgImg) {
      const drawH = CH;                           /* 画满整条战斗横带(地板下方延续石板路, 无黑边) */
      const drawW = drawH * (G.bgImg.width / G.bgImg.height);
      const period = drawW * 2;
      const off = ((G.camX * 0.5) % period + period) % period;   // 远景半速视差
      const y0 = CH - drawH;
      const n0 = Math.floor(off / drawW);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, CW, CH); ctx.clip();
      for (let n = n0; ; n++) {
        const x = n * drawW - off;
        if (x > CW) break;
        if (n % 2 === 0) {
          ctx.drawImage(G.bgImg, x, y0, drawW, drawH);
        } else {
          ctx.save(); ctx.translate(x + drawW, y0); ctx.scale(-1, 1);
          ctx.drawImage(G.bgImg, 0, 0, drawW, drawH);
          ctx.restore();
        }
      }
      ctx.restore();
    } else {
      drawClouds();   /* 背景图未就绪时保留旧的程序云天 */
    }
  }

  function drawEliteRing(x, y, r) {          // 精英怪: 脚下金色法环
    ctx.save(); ctx.translate(x, y); ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#e8c46b'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, r, r*0.3, 0, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }
  /* v2.6 PERF: 血条渐变按(宽度,配色桶)缓存 —— 原实现每条血条每帧新建 LinearGradient
   * (满屏怪 + 玩家 + BOSS 可达十几条/帧)。渐变用相对坐标, 绘制前 translate 到位 */
  const HPBAR_GRAD = {};
  function drawHpBar(x, y, w, hp, maxHp, isEnemy) {
    const p = Math.max(0, hp/maxHp); const h = 3;
    ctx.fillStyle = 'rgba(8,12,20,0.6)';
    roundRect(x-w/2, y, w, h, 1.5); ctx.fill();
    const bucket = isEnemy ? 'e' : (p > 0.5 ? 'g' : p > 0.25 ? 'y' : 'r');
    const key = w + bucket;
    let grad = HPBAR_GRAD[key];
    if (!grad) {
      grad = ctx.createLinearGradient(-w/2, 0, w/2, 0);
      if (bucket === 'e') { grad.addColorStop(0,'#ff6050'); grad.addColorStop(1,'#d82020'); }
      else if (bucket === 'g') { grad.addColorStop(0,'#6fe0a8'); grad.addColorStop(1,'#3ab878'); }
      else if (bucket === 'y') { grad.addColorStop(0,'#f0d070'); grad.addColorStop(1,'#d8a838'); }
      else { grad.addColorStop(0,'#ff8070'); grad.addColorStop(1,'#e84030'); }
      HPBAR_GRAD[key] = grad;
    }
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = grad;
    roundRect(-w/2, 0, w*p, h, 1.5); ctx.fill();
    ctx.restore();
  }
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w/2, h/2);
    ctx.beginPath(); ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r); ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r); ctx.arcTo(x, y, x+w, y, r); ctx.closePath();
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

  function drawPlayerSprite() {
    const p = G.player;
    const sx = worldToScreen(p.x);
    const sy = floorY() + p.y;   /* v3.7: 玩家随车道(y 为车道偏移, 平滑过渡) */

    /* 技能动画渲染 (剑气斩) */
    if (p.skillAnim && G.skillReady && G.skillSprite) {
      const frameIdx = Math.min(p.skillFrame, SKILL.count - 1);
      const col = frameIdx % SKILL.cols;
      const row = Math.floor(frameIdx / SKILL.cols);
      const srcX = col * SKILL.fw;
      const srcY = row * SKILL.fh;
      /* 渲染尺寸: 适配战斗区高度(v3.7: 随车道纵深缩放) */
      const drawH = Math.min(CH * 0.55, 80) * laneScale(p.lane);
      const drawW = drawH * (SKILL.fw / SKILL.fh);
      ctx.save();
      ctx.translate(sx, sy);
      if (p.hurtT > 0) { ctx.globalAlpha = 0.5+0.5*Math.sin(p.hurtT*40); ctx.filter = 'brightness(2.2) saturate(0.3)'; }
      /* 技能发光效果 */
      ctx.shadowColor = 'rgba(150,220,255,0.6)';
      ctx.shadowBlur = 12;
      /* 技能帧中角色脚底在 y=250(帧高256), 偏移对齐地板 */
      const footOffset = (SKILL.fh - 250) / SKILL.fh * drawH;
      /* 角色中心在帧中 x≈200/480≈0.42, 水平对齐 */
      ctx.drawImage(G.skillSprite, srcX, srcY, SKILL.fw, SKILL.fh, -drawW*0.42, -drawH + footOffset, drawW, drawH);
      ctx.restore();
      drawHpBar(sx, sy-drawH*0.7-10, 36, p.hp, p.maxHp);
      return;
    }

    if (!G.spriteReady || !G.sprite) {
      /* 素材未加载时用占位图形 */
      ctx.save(); ctx.translate(sx, sy);
      if (p.hurtT > 0) { ctx.globalAlpha = 0.5+0.5*Math.sin(p.hurtT*40); ctx.filter = 'brightness(2.2) saturate(0.3)'; }
      const bodyH = Math.min(40, CH*0.3);
      ctx.fillStyle = '#e8eef5';
      ctx.beginPath(); ctx.moveTo(-10,-bodyH); ctx.lineTo(10,-bodyH); ctx.lineTo(13,-4); ctx.lineTo(-13,-4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f0d8c0'; ctx.beginPath(); ctx.arc(0,-bodyH-6,7,0,Math.PI*2); ctx.fill();
      ctx.restore();
      drawHpBar(sx, sy-bodyH-20, 32, p.hp, p.maxHp);
      return;
    }
    /* 真实 sprite 渲染 */
    /* 计算帧索引和位置 */
    let frameIdx;
    if (p.attackAnim) frameIdx = SPRITE.attackStart + ATTACK_MAP[Math.min(p.animFrame, ATTACK_MAP.length - 1)];
    else frameIdx = SPRITE.walkStart + (p.animFrame % SPRITE.walkCount);
    const col = frameIdx % SPRITE.cols;
    const row = Math.floor(frameIdx / SPRITE.cols);
    const srcX = col * SPRITE.fw;
    const srcY = row * SPRITE.fh;
    /* 渲染尺寸: 适配战斗区高度(v3.7: 随车道纵深缩放; v3.8: 80→72, 新素材角色满帧高,
     * 同基准下视觉会大 13%, 回调保持体型延续) */
    const drawH = Math.min(CH * 0.5, 72) * laneScale(p.lane);
    const drawW = drawH * (SPRITE.fw / SPRITE.fh);
    /* 疾风步/缩地成寸残影: 加速期间玩家身后显示3个半透明残影, 倍速越高残影越多 */
    if (G.speedMult > 1 && !p.attackAnim) {
      const trailCount = G.speedMult >= 3 ? 4 : 3;
      for (let i = trailCount; i >= 1; i--) {
        ctx.save();
        ctx.translate(sx - i * 10, sy);  /* 向后偏移, 距离递增 */
        ctx.globalAlpha = 0.12 * (trailCount + 1 - i) / trailCount;  /* 透明度递减 */
        /* 残影轻微水平拉伸, 增强速度感 */
        ctx.scale(1 + i * 0.03, 1);
        ctx.drawImage(G.sprite, srcX, srcY, SPRITE.fw, SPRITE.fh, -drawW*0.35, -drawH, drawW, drawH);
        ctx.restore();
      }
    }
    ctx.save();
    ctx.translate(sx, sy);
    if (p.hurtT > 0) { ctx.globalAlpha = 0.5+0.5*Math.sin(p.hurtT*40); ctx.filter = 'brightness(2.2) saturate(0.3)'; }
    /* 攻击buff视觉: 橙色光晕 */
    if (p.atkBuff > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(G.t * 6);
      ctx.shadowColor = `rgba(255,170,85,${0.5 + pulse*0.3})`;
      ctx.shadowBlur = 10 + pulse*6;
    }
    /* 加速期间玩家发光: 疾风步青绿, 缩地成寸蓝紫 */
    if (G.speedMult > 1) {
      const glowColor = G.speedMult >= 3 ? 'rgba(160,180,255,0.8)' : 'rgba(128,255,192,0.7)';
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = G.speedMult >= 3 ? 16 : 12;
    }
    ctx.drawImage(G.sprite, srcX, srcY, SPRITE.fw, SPRITE.fh, -drawW*0.35, -drawH, drawW, drawH);
    ctx.restore();
    /* 血条 */
    drawHpBar(sx, sy - drawH - 8, 36, p.hp, p.maxHp);
  }

  function drawPets() {
    for (const pet of G.pets) {
      if (!pet.alive) continue;
      const sx = worldToScreen(pet.x);
      const sy = pet.y;  /* 宠物y坐标已包含offsetY和上下浮动 */
      /* 灵狐真实 sprite 渲染 */
      if (G.petFoxReady && G.petFoxSprite && pet.type === 'fox') {
        const PET_SPRITE = { cols:8, fw:96, fh:80 };
        const frameIdx = pet.flyFrame % 32;
        const col = frameIdx % PET_SPRITE.cols;
        const row = Math.floor(frameIdx / PET_SPRITE.cols);
        const srcX = col * PET_SPRITE.fw;
        const srcY = row * PET_SPRITE.fh;
        /* 渲染尺寸: 宠物较小, 约玩家的60% */
        const drawH = Math.min(CH * 0.35, 52);
        const drawW = drawH * (PET_SPRITE.fw / PET_SPRITE.fh);
        ctx.save();
        ctx.translate(sx, sy);
        if (pet.face === -1) ctx.scale(-1, 1);   /* 向左飞: 水平镜像(素材默认朝右) */
        /* v2.6.2 施法特效: lighter 柔光垫底(呼吸幅度收小), 替代大光圈脉冲 + 浓 shadowBlur 投影(整只狐糊一圈彩光, 又脏又糊) */
        if (pet.casting) {
          const pulse = 0.5 + 0.5 * Math.sin(pet.castAnim * Math.PI * 3);
          const img = pet.castType === 'heal' ? GLOW.heal : GLOW.atk;
          const glowR = drawH * (0.68 + pulse * 0.14);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.3 + pulse * 0.18;
          ctx.drawImage(img, -glowR, -drawH*0.55 - glowR, glowR*2, glowR*2);
          ctx.restore();
        }
        /* v3.4: 删掉了"待机微光"常亮垫底。
         * 用户反馈"没放技能的时候也在发光" —— 真凶就是这里的 else 分支：
         * 每帧都拿 GLOW.heal(青绿) 以 lighter 叠 0.16 alpha，×2/×3 倍速下
         * 每帧叠加次数翻倍，整只狐就常年泛着一层绿光，看着像一直在施法。
         * 现在灵狐本体只在 casting 期间发光，待机即干净贴图。 */
        ctx.drawImage(G.petFoxSprite, srcX, srcY, PET_SPRITE.fw, PET_SPRITE.fh, -drawW*0.5, -drawH, drawW, drawH);
        ctx.restore();
      } else {
        /* 其他宠物占位 */
        ctx.save(); ctx.translate(sx, sy);
        if (pet.hurtT > 0) { ctx.globalAlpha = 0.6; ctx.filter = 'brightness(2)'; }
        const r = Math.min(8, CH*0.07);
        ctx.fillStyle = pet.color || '#ffd76b'; ctx.beginPath(); ctx.arc(0,-r,r,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = '#1a1a2a'; ctx.beginPath(); ctx.arc(-2.5,-r-1,1.2,0,Math.PI*2); ctx.arc(2.5,-r-1,1.2,0,Math.PI*2); ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawEnemies() {
    for (const e of G.enemies) {
      if (!e.alive && e.dying <= 0) continue;
      const sx = worldToScreen(e.x); const sy = floorY() + e.y;   /* v3.7: 怪站自己的车道 */
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
        const col = frameIdx % SLIME_SPRITE.cols;
        const row = Math.floor(frameIdx / SLIME_SPRITE.cols);
        const srcX = col * SLIME_SPRITE.fw;
        const srcY = row * SLIME_SPRITE.fh;
        /* 渲染尺寸: 到玩家肩膀高度(精英怪体型 ×1.28) */
        const drawH = Math.min(CH * 0.5, 72) * (e.elite ? 1.28 : 1) * laneScale(e.lane);
        const drawW = drawH * (SLIME_SPRITE.fw / SLIME_SPRITE.fh);
        /* 脚底在帧中的y=120(距底部8px), 用这个偏移让脚底踩在地板上 */
        const footOffset = 120 * (drawH / SLIME_SPRITE.fh);
        ctx.save();
        ctx.translate(sx, sy);
        /* 变形纠正: 轻微垂直压缩(scaleY=0.92)让底部变平贴合地板, 同时补偿高度 */
        const scaleY = 0.92;
        const compensatedH = drawH / scaleY;
        ctx.translate(0, -footOffset * (1 - scaleY));
        ctx.scale(1, scaleY);
        if (e.dying > 0) ctx.globalAlpha = e.dying/0.4;
        if (e.hurtT > 0) { ctx.globalAlpha *= 0.7; ctx.filter = 'brightness(1.8)'; }
        /* 史莱姆面朝左, 素材本身就是面朝左, 不需要翻转 */
        ctx.drawImage(G.slimeSprite, srcX, srcY, SLIME_SPRITE.fw, SLIME_SPRITE.fh, -drawW*0.5, -footOffset, drawW, compensatedH);
        ctx.restore();
        if (e.elite && e.alive) drawEliteRing(sx, sy, 16);
        if (e.alive) drawHpBar(sx, sy - footOffset - 4, 28, e.hp, e.maxHp, true);
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
        const srcX = col * WATER_SPRITE.fw;
        const srcY = row * WATER_SPRITE.fh;
        const drawH = Math.min(CH * 0.5, 70) * (e.elite ? 1.28 : 1) * laneScale(e.lane);
        const drawW = drawH * (WATER_SPRITE.fw / WATER_SPRITE.fh);
        /* 脚底在帧中的y=118(距底部10px) */
        const footOffset = 118 * (drawH / WATER_SPRITE.fh);
        ctx.save();
        ctx.translate(sx, sy);
        /* 变形纠正: 轻微垂直压缩(scaleY=0.92)让底部变平贴合地板 + 轻微倾斜校正 */
        const scaleY = 0.92;
        const compensatedH = drawH / scaleY;
        ctx.translate(0, -footOffset * (1 - scaleY));
        /* 水精灵身体微微向右倾斜, 用skew校正(-0.03弧度约-1.7度) */
        ctx.transform(1, 0, -0.03, 1, 0, 0);
        ctx.scale(1, scaleY);
        if (e.dying > 0) ctx.globalAlpha = e.dying/0.4;
        if (e.hurtT > 0) { ctx.globalAlpha *= 0.7; ctx.filter = 'brightness(1.8)'; }
        /* 水精灵面朝左, 素材本身就是面朝左, 不需要翻转 */
        ctx.drawImage(G.waterSprite, srcX, srcY, WATER_SPRITE.fw, WATER_SPRITE.fh, -drawW*0.5, -footOffset, drawW, compensatedH);
        ctx.restore();
        if (e.elite && e.alive) drawEliteRing(sx, sy, 16);
        if (e.alive) drawHpBar(sx, sy - footOffset - 4, 28, e.hp, e.maxHp, true);
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
        const srcX = col * BOSS_SPRITE.fw;
        const srcY = row * BOSS_SPRITE.fh;
        /* BOSS 2倍大, 漂浮不踩地板 */
        const drawH = Math.min(CH * 0.7, 140) * laneScale(e.lane);
        const drawW = drawH * (BOSS_SPRITE.fw / BOSS_SPRITE.fh);
        const floatY = BOSS_SPRITE.floatHeight + Math.sin(G.t * 1.5) * 8;  /* 漂浮上下浮动 */
        ctx.save();
        ctx.translate(sx, sy - floatY);  /* 漂浮在地板上方 */
        if (e.dying > 0) ctx.globalAlpha = e.dying/0.4;
        if (e.hurtT > 0) { ctx.globalAlpha *= 0.7; ctx.filter = 'brightness(1.8)'; }
        /* 攻击帧左侧特效渐隐: 预渲染掩码帧直接贴图(原每帧离屏重建, 见 bossMaskedFrame) */
        if (e.anim > 0) {
          const fi = Math.min(frameIdx - BOSS_SPRITE.attackStart, BOSS_SPRITE.attackCount - 1);
          const off = bossMaskedFrame(fi, drawW, drawH);
          if (off) ctx.drawImage(off, -drawW*0.5, -drawH, drawW, drawH);
        } else {
          /* 漂浮帧直接绘制 */
          ctx.drawImage(G.bossSprite, srcX, srcY, BOSS_SPRITE.fw, BOSS_SPRITE.fh, -drawW*0.5, -drawH, drawW, drawH);
        }
        ctx.restore();
        /* BOSS血条在头顶, 右移对齐头部 */
        if (e.alive) drawHpBar(sx + drawW*0.2, sy - floatY - drawH - 8, 50, e.hp, e.maxHp, true);
      } else if (e.type === 'rat' && e.armature && window.CanvasDragonBones) {
        /* v3.6 骨骼怪(鼠妖): DragonBones→Canvas2D 桥实时渲染, 非序列帧。
         * 体型缩放用 idle 基准高度(RATTY.baseH, 建工厂时测定) —— 避免不同姿态 AABB 高度变化导致呼吸式缩放;
         * 落地对齐用当前姿态 AABB 底边中心 —— 任何动画下脚底都踩地板。素材面朝左, 与其它怪一致不翻转。
         * v3.6.1 调参: 基准高 76→56(Ratty 无帧留白, 同基准下视觉比史莱姆大半档); 素材色彩
         * 偏亮偏饱和, 整体 saturate(0.85)+brightness(0.93) 轻压融入夜色(0.72/0.85 灰暗感像半透, 已回调), 受击白闪保留。 */
        const drawH = Math.min(CH * 0.5, 56) * (e.elite ? 1.28 : 1) * laneScale(e.lane);
        const s = drawH / Math.max(1, RATTY.baseH || 100);
        const bb = window.CanvasDragonBones.armatureAABB(e.armature);
        ctx.save();
        ctx.translate(sx, sy);
        if (e.dying > 0) ctx.globalAlpha = e.dying/0.4;
        ctx.filter = e.hurtT > 0 ? 'saturate(0.85) brightness(1.8)' : 'saturate(0.85) brightness(0.93)';
        ctx.scale(s, s);
        ctx.translate(-(bb.minX + bb.maxX) / 2, -bb.maxY);
        window.CanvasDragonBones.drawArmature(ctx, e.armature);
        ctx.restore();
        if (e.elite && e.alive) drawEliteRing(sx, sy, 16);
        if (e.alive) drawHpBar(sx, sy - drawH - 4, 28, e.hp, e.maxHp, true);
      } else {
        /* 素材未就绪时的兜底占位(正常不会走到这里) */
        ctx.save(); ctx.translate(sx, sy);
        if (e.dying > 0) ctx.globalAlpha = e.dying/0.4;
        if (e.hurtT > 0) { ctx.globalAlpha *= 0.6; ctx.filter = 'brightness(2)'; }
        const bodyH = Math.min(25, CH*0.2);
        ctx.fillStyle = e.color; ctx.beginPath(); ctx.ellipse(0,-bodyH/2,10,bodyH/2,0,0,Math.PI*2); ctx.fill();
        ctx.restore();
        if (e.alive) drawHpBar(sx, sy-35, 24, e.hp, e.maxHp, true);
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
  const GLOW = { heal: makeGlow('120,255,175'), atk: makeGlow('255,175,95') };

  function drawFx() {
    /* 加速期间屏幕速度线: 横向线条从右向左流动, 增强速度感 */
    if (G.speedMult > 1) {
      ctx.save();
      ctx.globalAlpha = 0.15 + (G.speedMult - 1) * 0.1;
      ctx.strokeStyle = G.speedMult >= 3 ? 'rgba(160,180,255,0.5)' : 'rgba(128,255,192,0.5)';
      ctx.lineWidth = 1;
      const lineCount = G.speedMult >= 3 ? 12 : 8;
      for (let i = 0; i < lineCount; i++) {
        const y = (i / lineCount) * CH + (G.t * 200 * G.speedMult + i * 37) % CH;
        const x = (G.t * 300 * G.speedMult + i * 53) % CW;
        const len = 30 + Math.random() * 50;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - len, y);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const f of G.fx) {
      /* v2.6 FIX: f.y 是相对地板线的偏移(敌人/玩家 y=0), 屏幕坐标须加 floorY(); 原直接当屏幕 y 画到了画布顶外, 特效从未显示 */
      const k = f.t/f.dur; const sx = worldToScreen(f.x); const fy = floorY() + f.y;
      if (f.kind === 'hitSpark') {
        /* 受击火花: 不旋转, 4条向外扩散的短线 */
        ctx.save(); ctx.translate(sx, fy);
        ctx.strokeStyle = f.color; ctx.globalAlpha = 1-k; ctx.lineWidth = 1.2;
        for (let i=0; i<4; i++) {
          const ang = i * Math.PI/2 + Math.PI/4;
          const r1 = 2 + k*4, r2 = 6 + k*8;
          ctx.beginPath(); ctx.moveTo(Math.cos(ang)*r1, Math.sin(ang)*r1); ctx.lineTo(Math.cos(ang)*r2, Math.sin(ang)*r2); ctx.stroke();
        }
        ctx.restore();
      } else if (f.kind === 'slash') {                    // 剑气斩: 一道横掠的剑气
        ctx.save(); ctx.translate(sx, fy); ctx.globalAlpha = 1-k;
        ctx.strokeStyle = f.color; ctx.lineWidth = 2; ctx.lineCap = 'round';
        const w = 26 + k*34;
        ctx.beginPath(); ctx.moveTo(-w*0.5, 6+k*4); ctx.lineTo(w*0.5, -2-k*6); ctx.stroke();
        ctx.restore();
      } else if (f.kind === 'hengsao') {                    // 横扫千军: sprite特效, 从左向右扫, 快速淡出
        if (G.hengsaoReady && G.hengsaoSprite) {
          const frameIdx = Math.min(f.frame, HENGSAO_SPRITE.count - 1);
          const col = frameIdx % HENGSAO_SPRITE.cols;
          const row = Math.floor(frameIdx / HENGSAO_SPRITE.cols);
          const srcX = col * HENGSAO_SPRITE.fw;
          const srcY = row * HENGSAO_SPRITE.fh;
          /* v3.8: 剑气贴合本道高度 —— 原 drawW=280(drawH≈140) 在横带里横跨约两条道,
           * 素材内容又偏帧下部, 视觉重心砸在最下道: 换道释放也像一直在最下道放。
           * 缩到≈玩家身高(drawH=100), 配合 y 已带车道偏移, 剑气完整落在玩家本道。 */
          const drawW = 200;
          const drawH = drawW * (HENGSAO_SPRITE.fh / HENGSAO_SPRITE.fw);
          /* 特效从左向右移动: startX到endX插值 */
          const moveX = (f.startX || f.x) + ((f.endX || f.x+120) - (f.startX || f.x)) * k;
          const moveSx = worldToScreen(moveX);
          ctx.save();
          ctx.translate(moveSx, fy);
          /* 透明度曲线: 前15%快速渐入, 中间保持最亮, 后40%快速淡出 */
          let alpha;
          if (k < 0.15) alpha = k / 0.15;
          else if (k < 0.6) alpha = 1.0;
          else alpha = (1 - k) / 0.4;
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
          /* v2.9 PERF: 左右渐现渐隐的离屏合成原为**每帧重建**(createElement+渐变+destination-in),
           * 横扫 0.38s≈12帧就重建 12 次, 是纯浪费。改为按帧号缓存(同 BOSS_MASK 模式),
           * 首次播放时建一次, 后续直接复用 —— 视觉完全一致。 */
          if (!HENGSAO_MASK.frames) HENGSAO_MASK.frames = [];
          let off = HENGSAO_MASK.frames[frameIdx];
          if (!off) {
            off = document.createElement('canvas');
            off.width = drawW; off.height = drawH;
            const octx = off.getContext('2d');
            octx.drawImage(G.hengsaoSprite, srcX, srcY, HENGSAO_SPRITE.fw, HENGSAO_SPRITE.fh, 0, 0, drawW, drawH);
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
          ctx.drawImage(off, -drawW*0.5, -drawH*0.5);
          ctx.restore();
        }
      } else if (f.kind === 'sweep') {                    // 横扫千军: 一道贴地弧光(兜底)
        ctx.save(); ctx.translate(sx, fy); ctx.globalAlpha = (1-k)*0.9;
        ctx.strokeStyle = f.color; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(0, 0, 18 + k*46, -Math.PI*0.15, Math.PI*0.42); ctx.stroke();
        ctx.restore();
      } else if (f.kind === 'death') {
        ctx.save(); ctx.translate(sx, fy);
        for (let i=0; i<8; i++) {
          const ang = i/8*6.28, r = k*15;
          ctx.fillStyle = f.color; ctx.globalAlpha = (1-k)*0.9;
          ctx.beginPath(); ctx.arc(Math.cos(ang)*r, Math.sin(ang)*r, 1.8*(1-k)+0.5, 0, 6.28); ctx.fill();
        }
        ctx.restore();
      } else if (f.kind === 'speedBurst') {
        /* 身法触发: 速度爆发 —— 冲击波圆环 + 向后气流线 + 粒子飞溅 */
        ctx.save(); ctx.translate(sx, fy - 25);
        /* 冲击波圆环: 从中心向外扩散 */
        ctx.globalAlpha = (1-k) * 0.6;
        ctx.strokeStyle = f.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 5 + k*35, 0, Math.PI*2); ctx.stroke();
        /* 向后气流线: 8条, 从中心向后扩散 */
        ctx.globalAlpha = (1-k) * 0.9;
        ctx.lineWidth = 1.8; ctx.lineCap = 'round';
        ctx.shadowColor = f.color; ctx.shadowBlur = 6;
        for (let i=0; i<8; i++) {
          const ang = Math.PI + (i/7 - 0.5) * 1.2;  /* 向后扇形扩散 */
          const r1 = 3 + k*8, r2 = 12 + k*40;
          ctx.beginPath();
          ctx.moveTo(Math.cos(ang)*r1, Math.sin(ang)*r1);
          ctx.lineTo(Math.cos(ang)*r2, Math.sin(ang)*r2);
          ctx.stroke();
        }
        /* 粒子飞溅: 6个小光点向后飞 */
        ctx.shadowBlur = 0;
        for (let i=0; i<6; i++) {
          const ang = Math.PI + (Math.random()-0.5)*1.5;
          const r = 8 + k*45;
          ctx.globalAlpha = (1-k) * 0.7;
          ctx.fillStyle = f.color;
          ctx.beginPath(); ctx.arc(Math.cos(ang)*r, Math.sin(ang)*r, 1.5*(1-k)+0.5, 0, Math.PI*2); ctx.fill();
        }
        ctx.restore();
      } else if (f.kind === 'healParticle' || f.kind === 'atkParticle') {
        /* v2.6.2: 柔光粒子(lighter 加法发光) —— 压在角色身上是"透亮"而非"盖色", 去掉发灰的 shadowBlur */
        const img = f.kind === 'healParticle' ? GLOW.heal : GLOW.atk;
        const r = (2.2 + (1-k)*2.6) * 2.4;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1-k) * 0.7;
        ctx.drawImage(img, sx - r, fy - r, r*2, r*2);
        ctx.restore();
      } else if (f.kind === 'healBurst' || f.kind === 'atkBurst') {
        /* v2.6.2: 施法完成 → 一团柔光从角色胸口绽开(lighter), 替代硬描边圆环 */
        const img = f.kind === 'healBurst' ? GLOW.heal : GLOW.atk;
        const r = 14 + k * 40;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1-k) * 0.75;
        ctx.drawImage(img, sx - r, fy - r, r*2, r*2);
        ctx.restore();
      }
    }
  }

  /* 现代游戏伤害飘字: 暴击放大+金光描边, 快速浮现→上浮→渐隐, 横向随机漂移避免堆叠 */
  function drawDmg() {
    for (const d of G.dmg) {
      const k = Math.min(1, d.t / 0.95);
      const a = k < 0.12 ? k/0.12 : 1 - (k-0.12)/0.88;     // 起手快现, 之后渐隐
      const sx = worldToScreen(d.x) + (d.vx || 0) * k;
      const sy = floorY() + d.y - 40 * k;                     // v2.6 FIX: d.y 相对地板线(原直接当屏幕y, 飘字画在画布顶外从未显示)
      const pop = d.crit ? 1 + 0.6*Math.max(0, 1-k*2.2) : 1 + 0.35*Math.max(0, 1-k*3);
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.translate(sx, sy); ctx.scale(pop, pop);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.font = `bold ${d.crit ? 19 : 12}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.lineWidth = d.crit ? 4 : 3;
      ctx.strokeStyle = 'rgba(6,10,18,0.95)';
      ctx.strokeText(d.val, 0, 0);
      if (d.crit) { ctx.shadowColor = 'rgba(255,196,80,0.9)'; ctx.shadowBlur = 10; }
      ctx.fillStyle = d.color || '#eaf2fb';
      ctx.fillText(d.val, 0, 0);
      ctx.restore();
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
  function render(clear) {
    /* v3.6: 每帧强制归位 —— 上帧任何残留 alpha/混合模式都不许带进来 */
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (clear) {
      ctx.clearRect(0, 0, CW, CH);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, CH);
      g.addColorStop(0, '#070b16');
      g.addColorStop(0.72, '#060912');
      g.addColorStop(1, '#050810');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CW, CH);
    }
    drawBg(); drawEnemies(); drawDrops(); drawPlayerSprite(); drawPets(); drawFx(); drawDmg(); drawSkillCall();
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
   *       淡出窗口收到末 18% —— 前半段"看得清", 后半段"秒没", 不拖泥带水。 */
  function drawSkillCall() {
    const c = G.skillCall; if (!c) return;
    const k = c.t / c.dur;
    let scale;
    if (k < 0.16) scale = 0.46 + (k / 0.16) * 0.66;          // 0.46 → 1.12 弹入
    else if (k < 0.3) scale = 1.12 - ((k - 0.16) / 0.14) * 0.10;   // 回落到 1.02
    else scale = 1.02;
    const fade = k < 0.82 ? 1 : Math.max(0, 1 - (k - 0.82) / 0.18);
    const rise = k < 0.82 ? 0 : (k - 0.82) * 46;
    /* 字号: 屏宽 3.4% 起, 夹在 15~24px —— 手机上既醒目又不糊成一团 */
    const size = Math.round(Math.max(15, Math.min(CW * 0.034, 24)));
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(CW / 2, CH * 0.30 - rise);
    ctx.scale(scale, scale);
    ctx.font = '600 ' + size + 'px "Kaiti SC","STKaiti","KaiTi","DFKai-SB","BiauKai",serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2.2, size * 0.15);
    ctx.strokeStyle = 'rgba(18,12,4,.9)';
    ctx.strokeText(c.name, 0, 0);
    const grad = ctx.createLinearGradient(0, -size * 0.6, 0, size * 0.6);
    grad.addColorStop(0, '#ffe9b0'); grad.addColorStop(1, '#f0b95a');
    ctx.fillStyle = grad;
    ctx.fillText(c.name, 0, 0);
    ctx.restore();
  }

  function updateHUD() {
    const killsEl = document.getElementById('battleKills');
    const speedEl = document.getElementById('battleSpeed');
    const stateEl = document.getElementById('battleState');
    const spEl = document.getElementById('battleSpirit');
    if (killsEl) killsEl.textContent = G.kills;
    if (spEl) spEl.textContent = fmtNum(G.spirit);
    if (speedEl) {
      if (G.speedMult > 1) { speedEl.style.display = ''; speedEl.textContent = '×'+G.speedMult+' 倍速 ('+G.speedMultTimer.toFixed(1)+'s)'; }
      else speedEl.style.display = 'none';
    }
    if (stateEl) stateEl.textContent = G.state === 'fight' ? '战斗中' : '推进中';
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
  function loop(t) {
    if (G.paused) { _rafOn = false; lastT = t; return; }   // 停泵: 下一帧不再续 rAF, resume 负责重启
    _rafOn = true;
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
  }

  /* v3.2: 交给 60-stage 的层对象，绘制顺序排在 bg 之后、aura 之前 */
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
        const savedCtx = ctx, savedCW = CW, savedCH = CH;
        CW = W; CH = band.height; ctx = targetCtx;
        /* v3.6 纵深防御：舞台画布由 bg/aura/burst 共享，任何一层泄漏
         * globalAlpha / GCO / filter 都会让战斗层全体"半透明"（bg 层
         * lighter 泄漏正是真机全员半透明的根因）。进入前强制归位。 */
        targetCtx.globalAlpha = 1;
        targetCtx.globalCompositeOperation = 'source-over';
        try { targetCtx.filter = 'none'; } catch (err) {}
        /* 逻辑坐标系仍是"整屏宽 × 横带高"，与原来独立画布完全一致；
         * 只是绘制被 clip 到横带、并平移到横带顶端。 */
        targetCtx.save();
        try {
          targetCtx.beginPath();
          targetCtx.rect(0, band.top, W, band.height);
          targetCtx.clip();
          targetCtx.translate(0, band.top);
          render(false);   /* 舞台模式：只铺自己那条横带，绝不清共享画布 */
        } finally {
          /* try/finally：render 内若抛异常，restore 也必须执行 ——
           * 否则 clip/translate 残留会把后续帧的绘制区域越裁越小。 */
          targetCtx.restore();
          ctx = savedCtx; CW = savedCW; CH = savedCH;
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
    if (!_managed) requestAnimationFrame(loop);
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
