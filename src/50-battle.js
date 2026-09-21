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
import { state, DIMSTAT } from './00-pure.js';
import * as NS_STAGE from './00-stage.js';   /* v6: 关卡数值权威(30k 关公式表) */
import * as NS_NUM from './00-num.js';       /* v6: 大数层 —— 怪血量是可超 1e77 的大数 */


  /* ══════════════════════════════════════════════════════════════════════
   *  v7.9 擂台常量（用户明确要求，勿回退）
   * ──────────────────────────────────────────────────────────────────────
   * 每一关 = 一屏擂台：
   *   · 相机【不再跟随玩家】（updateCamera 直接锁 camX=0）
   *   · 玩家每关从左侧 SPAWN_FRAC 处出生
   *   · 怪从右侧 SPAWN_FRAC 处生成
   *   · 打完一只（=过一关）→ resetStage()：清场 + 玩家回出生点 + 回满血
   *
   * ⚠️ MAX_W 是本设计的关键：所有横向比例都乘 arenaW() 而不是 CW，
   *    宽屏（PC 浏览器）下擂台被压到 MAX_W 并居中，
   *    否则同样是 0.16→0.76，在 1200px 宽屏上要走 440px / 42px每秒 ≈ 10 秒才见到怪，
   *    「走半天」这个吐槽就是这么来的。手机（≤520px）不受影响，arenaW()===CW。
   * ══════════════════════════════════════════════════════════════════════ */
  const ARENA = {
    MAX_W: 520,        /* 擂台宽度上限 —— 超过这个宽度一律按手机尺度布局 */
    LEFT: 0.16,        /* 玩家出生点：擂台 16% 处 */
    RIGHT: 0.76,       /* 怪物生成点：擂台 76% 处（屏幕右侧，可见处出场） */
  };
  function arenaW() { return Math.min(CW || 390, ARENA.MAX_W); }
  function arenaLeft() { return ((CW || 390) - arenaW()) / 2; }   /* 宽屏擂台居中，两侧留背景 */
  function playerSpawnX() { return arenaLeft() + arenaW() * ARENA.LEFT; }
  function enemySpawnX() { return arenaLeft() + arenaW() * ARENA.RIGHT; }

  const BC = {
    /* 占位怪 demon(妖将)/raptor(妖弓) 已移除 —— 只保留两种有真实素材的怪 */
    playerAtkRange: 75, playerAspd: 1.1, playerSpeed: 42,   /* v4.4: 基础移速 28→42 (×1.5), 走得太慢 */
    spawnInterval: 0.25, enemySpawnOffset: 40, maxAlive: 12, queueGap: 34,   /* v5.1 按频率刷怪: 0.25s/只×120只=30s刷完小怪, 然后BOSS出现; 同屏12 */
    /* ⚠️ enemySpawnOffset 自 v7.8 起【已废弃】: 它当年用于把怪生成在屏外
     * (camX+stageW()+offset), 造成"进游戏要等好几秒才看到怪"。
     * 现在生成点改为可视区右缘内侧 stageW()*0.92。保留字段仅为兼容旧引用, 勿再用于生成。 */
    /* ⚠️ v7.10（勿回退）：下面各怪种的 speed 字段【已废弃】。
     * 全体怪现在统一按 BC.playerSpeed 定速，与玩家同轴同速（见 makeEnemyFrom 的 speed 行）。
     * 留着这些数字只是历史痕迹 —— 改它们不会有任何效果，
     * 要调动怪物机动性请改 makeEnemyFrom 里那一处，或调 BC.playerSpeed。 */
    enemies: {
      /* hpK/atkK/defK: 按玩家境界(lv)线性成长 —— 怪只随境界长, 玩家随境界+装备长, 换装即提速。
       * hpK 定"一轮两剑能否收掉": 妖卒约一轮一只(收草手感), 水灵约两轮(略厚)。
       * v3.9 骨骼怪批量接入: bone=BONES slug, drawH=游戏内显示高(px, 素材分辨率无关)。 */
      /* ---- T1 妖群 ---- */
      /* v4.5 远程/近战: 按素材 has_skill 标定 —— jiangshi / slime_flynn /
       * cultist_mage 三只素材自带 Skill 动画, 归为远程(拉开攻距、降速)。 */
      slime: { name:'妖卒', role:'melee', w:60, atkRange:30, speed:120, hpK:1.0, atkK:0.55, defK:0.35, color:'#6fe0a8', tier:1 },
      jiangshi: { name:'僵尸', role:'ranged', w:40, atkRange:52, speed:76, hpK:1.15, atkK:0.6, defK:0.4, color:'#b9d0a8', bone:'jiangshi', drawH:100, hpBarW:30, tier:1 },
      slime_flynn: { name:'弗林', role:'ranged', w:35, atkRange:50, speed:88, hpK:0.85, atkK:0.5, defK:0.25, color:'#8fe8c0', bone:'slime_flynn', drawH:76, hpBarW:26, tier:1 },
      /* ---- T2 妖锐 ---- */
      rat:   { name:'鼠妖', role:'melee', w:35, atkRange:32, speed:150, hpK:0.8, atkK:0.5, defK:0.25, color:'#c9b28f', bone:'ratty', drawH:42, tier:2 },   /* v4.4: 体型缩小一半 84→42 */
      fox:   { name:'妖狐', role:'melee', w:32, atkRange:30, speed:165, hpK:0.85, atkK:0.62, defK:0.28, color:'#e8a86b', bone:'fox', drawH:88, hpBarW:28, tier:2 },
      bee:   { name:'蜂妖', role:'melee', w:28, atkRange:26, speed:175, hpK:0.55, atkK:0.55, defK:0.15, color:'#e8d06b', bone:'bee', drawH:60, hpBarW:24, tier:2 },
      /* ---- T3 妖将 ---- */
      water: { name:'水灵', role:'melee', w:40, atkRange:35, speed:80,  hpK:1.6, atkK:0.75, defK:0.60, color:'#6fd0e8', tier:3 },
      wolf:  { name:'狼妖', role:'melee', w:36, atkRange:34, speed:150, hpK:1.35, atkK:0.85, defK:0.5, color:'#9aa8c0', bone:'wolf', drawH:92, hpBarW:30, tier:3 },
      cultist_mage: { name:'邪修', role:'ranged', w:34, atkRange:54, speed:72, hpK:1.5, atkK:0.95, defK:0.5, color:'#b08ae0', bone:'cultist_mage', drawH:100, hpBarW:30, tier:3 },
      /* ---- T4 妖王 ---- */
      hellhound_garm: { name:'狱犬', role:'melee', w:40, atkRange:36, speed:175, hpK:2.1, atkK:1.1, defK:0.75, color:'#c06a5a', bone:'hellhound_garm', drawH:108, hpBarW:34, tier:4 },
      black_ant_queen: { name:'蚁后', role:'melee', w:42, atkRange:36, speed:85, hpK:2.8, atkK:1.0, defK:1.0, color:'#7a6ae0', bone:'black_ant_queen', drawH:116, hpBarW:36, tier:4 },
      /* v2.6 调参: hpK 80→52(实测过厚约-35%), atkRange 70→45(玩家攻距75, 贴身才能互殴, 修复"剑够不到")
       * v3.9 BOSS 换九尾狐王: giant_kitsune(S 品质, 10 种攻击动作), 骨骼渲染 drawH 110 */
      boss:  { name:'九尾狐王', role:'ranged', w:5,  atkRange:45, speed:40, hpK:52, atkK:4.5, defK:3.0, color:'#e8b06b', isBoss:true, floatHeight:10, sizeMult:2.0, tier:5, bone:'giant_kitsune', drawH:220, hpBarW:60,
               crit:25, dodge:10, pen:40, critRes:60 },  /* v6.6: atkK 3.0×1.5(凹曲线T10满额, ATK_K=1.5 定稿); 四维面板BOSS档 */
    },
    /* v3.9 怪物三维系统: 怪包统一池(每个境界都会刷到全怪种), 三维 = 境界基准 × 怪种K × 波次tier倍率。
     * 波次内从 T1 最弱一路递进到 T5 —— tier 决定刷怪池权重与三维倍率。 */
    /* v5.1 怪物池细分T1-T10: 121只怪池每12只升一档, 小怪强度大幅上调。
     * 倍率控制在1.5~5.0(BOSS强度不变, 仍用自身hpK/atkK), 小怪更耐打 */
    tier: {
      1: { name:'妖群', mul:1.50 },
      2: { name:'妖锐', mul:1.80 },
      3: { name:'妖将', mul:2.10 },
      4: { name:'妖卫', mul:2.45 },
      5: { name:'妖王', mul:2.80 },
      6: { name:'妖皇', mul:3.20 },
      7: { name:'妖尊', mul:3.60 },
      8: { name:'妖圣', mul:4.05 },
      9: { name:'妖神', mul:4.50 },
      10:{ name:'妖帝', mul:5.00 },
    },
    tierNeedBase: 7,      /* 首档升档击杀数: T2@7, T3@9, T4@12, T5@15(累计43) —— 120s 产能约46只, 顶尖玩家压哨进 T5 */
    tierNeedStep: 1.3,    /* 每档所需击杀数递增系数 */
    /* ⚠️ v6: 原「妖潮试炼」已整体拆除 —— 没有 120 秒轮次、没有 121 只怪池、没有 BOSS 限时。
     * 现在是【无尽刷怪】: 杀一只补一只, 怪物强度由 v6 的推关进度(境界/关卡)驱动,
     * 不再靠"本波第几只"分段灌 tier。 */
    /* v5.1 骨骼池怪数值模板大幅上调 —— hpK控制在1.5~4.0, 小怪更耐打 */
    boneTpl: {
      /* v6.6 数值定稿(毕业档+法宝模拟, 二次扫描): atkK 已乘凹曲线 f(t)=1+0.5*((t-1)/9)^1.6
       * (ATK_K=1.5, T10×1.5); 怪攻基数斜率 5→15(见 makeEnemyFrom)。
       *   实测(毕业装备+法宝): 元婴~大乘最低血线 35~48%, 血条有来有回; T1-T5 保护新手段;
       * 四维面板(网游式, 按 tier 线性):
       *   crit 暴击(怪打玩家, ×1.8) / dodge 闪避(玩家打怪 miss) /
       *   pen 破甲(怪无视玩家 def%) / critRes 暴抗(削减玩家暴击与会心率) */
      1: { hpK:1.50, atkK:0.70, defK:0.40, speed:110, crit:2,  dodge:0,   pen:0,  critRes:5  },
      2: { hpK:1.70, atkK:0.76, defK:0.42, speed:130, crit:4,  dodge:0.9, pen:4,  critRes:11 },
      3: { hpK:1.90, atkK:0.86, defK:0.45, speed:155, crit:6,  dodge:1.8, pen:9,  critRes:17 },
      4: { hpK:2.20, atkK:1.00, defK:0.52, speed:140, crit:8,  dodge:2.7, pen:13, critRes:24 },
      5: { hpK:2.50, atkK:1.19, defK:0.62, speed:120, crit:10, dodge:3.6, pen:18, critRes:30 },
      6: { hpK:2.85, atkK:1.41, defK:0.72, speed:135, crit:12, dodge:4.4, pen:22, critRes:36 },
      7: { hpK:3.15, atkK:1.64, defK:0.82, speed:150, crit:14, dodge:5.3, pen:27, critRes:42 },
      8: { hpK:3.45, atkK:1.89, defK:0.92, speed:130, crit:16, dodge:6.2, pen:31, critRes:48 },
      9: { hpK:3.75, atkK:2.15, defK:1.02, speed:110, crit:18, dodge:7.1, pen:36, critRes:54 },
      10:{ hpK:4.00, atkK:2.48, defK:1.12, speed:125, crit:20, dodge:8,   pen:40, critRes:60 },
    },
  };
  /* 玩家属性(主游戏 pushBattleStats 注入) —— 战斗内一切数值伤害以此为准 */
  let PST = { lv:1, atk:56, hp:430, def:31, crit:0, critB:0, critD:0, pen:0, dodge:0 };
  /* 掉落系数(服务端可下发覆盖; 断网/离线用内置默认值, 保证照常可玩) */
  const DROP = {
    spiritBase: 30,       // 每杀灵石基数(v5.2: 6→30, 在线打怪灵石产出对齐聚灵阵需求)
    spiritPerLv: 5,       // 每杀灵石 · 每境界级加成(v5.2: 1.2→5)
    spiritRand: 0.4,      // 灵石浮动 ±40%
    equipChance: 0.035,   // ⚠️ v6: 法宝已删除, 该系数仅保留字段形状(战斗层不再产出装备)
    eliteChance: 0.06,    // 精英怪出现率
    eliteMul: 4,          // 精英产出倍率
    eliteHp: 3,           // 精英血量倍率
  };

  if (typeof window !== 'undefined') {
    /* v4.7 攻距手感旋钮: 0.30~0.70 之间调 —— 调大怪站更远(更不挡人但更不近战),
     * 调小怪贴更近(更近战但大怪可能少量遮住玩家)。改完刷下一只怪即生效。 */
    if (window.__torsoFrac      === undefined) window.__torsoFrac      = 0.45;
  }
  /* 同屏怪上限: 过目模式下由 window.__maxAlive 覆盖, 否则用线上值 */
  function capAlive() {
    const v = (typeof window !== 'undefined' && window.__maxAlive);
    return (typeof v === 'number' && v > 0) ? v : BC.maxAlive;
  }
  /* v4.6: 纯序列帧手配怪的素材就绪判定(slime/water 这类没走骨骼的) ——
   * 素材没好就不刷, 免得开局画成兜底占位椭圆。没列到的类型一律视为就绪。 */
  function spriteReadyFor(t) {
    if (t === 'slime') return !!(G.slimeReady && G.slimeSprite);
    if (t === 'water') return !!(G.waterReady && G.waterSprite);
    return true;
  }

  /* v8.1 基础倍速 2 → 1.5 (用户要求)。
   * 技能 mult 同步下调 1: 疾风步 3→2.5(HUD 仍显示 ×2), 缩地 4→3.5(HUD 仍显示 ×3)。
   * HUD 公式 (mult - 1) 不变, 所以玩家看到的"2倍速/3倍速"说法完全没变,
   * 变的只是底层真实速度 —— 相当于整体降速 25%, 战斗节奏更从容。 */
  const BASE_SPEED_MULT = 1.5;
  /* v6 设计文档 §1 #16：游戏倍速上限 3.5，由 Buff 宠物提供（技能不再给倍速） */
  const BUFF_SPEED_CAP = 3.5;
  const G = {    t:0, kills:0, spirit:0, speedMult:BASE_SPEED_MULT, speedMultTimer:0, state:'walk', camX:0, paused:false,
    player:null, pets:[], enemies:[], fx:[], dmg:[], drops:[], spawnT: 0,
    sprite:null, bgImg:null, spriteReady:false, bgReady:false, extraStrike:false,
    speedDodge:0, nextStrikeCrit:0,   /* speedDodge 恒 0：v6 身法闪避走 buffStats()，字段保留仅为旧引用兜底 */
    /* v6 身法 Buff：各自独立 CD 计时器（不是攻击触发）。key=技能id → { cdLeft, durLeft } */
    skillBuff: {},
    petFoxSprite:null, petFoxReady:false, petEagleSprite:null, petEagleReady:false, petEagleBoltSprite:null, petEagleBoltReady:false, petEagleAtkSprite:null, petEagleAtkReady:false,
    eagleBolts: [],  /* 灵鹰弹幕 */
    skillSprite:null, skillReady:false,
    bossActive:false,   /* v3.8.2 打满100只小怪才刷BOSS(原10) */
    skillCall:null,          /* 技能名播报槽: 覆盖式大字快闪, {name,t,dur} */
    /* ⚠️ v6 无尽刷怪: 无轮次/无结算/无怪池上限。
     * spawned 只用于「本场第一只特判」(生成在玩家眼前, 免去开场空等), 不再是怪池游标。 */
    spawned: 0,
  };
  /* v6.9 PERF: 粒子上限。每次命中/击杀/技能都 push 一个粒子, 同屏激烈时无上限会堆积
   * 几十个 PIXI.Sprite/Graphics, 每帧合成开销线性涨。同屏 80 个粒子已经足够特效密度。
   * v6.12 FIX: 返回新元素索引(模仿 Array.push 返回新长度), 第2931行依赖这个返回值。 */
  G.pushFx = function(o) { if (this.fx.length < 80) return this.fx.push(o); return -1; };
  /* v6.12 PERF: 伤害飘字上限。每条飘字一个 PIXI.Text(canvas→GPU 纹理), 同屏最多 20 个。 */
  G.pushDmg = function(o) { if (this.dmg.length < 20) this.dmg.push(o); };
  let _hudRefreshT = 0;   /* v5.0 定期刷新HUD计时器: 打BOSS期间无击杀, 倒计时显示会卡住 */
  const _spawnEntries = [];   /* 刷怪权重池复用: 避免每次spawnWave新建数组 */

  /* 加载素材 */
  const spriteImg = new Image();
  spriteImg.onload = function() { G.sprite = solidify(spriteImg); G.spriteReady = true; };
  spriteImg.src = 'assets/cultivator_sheet.webp';
  /* 怪物素材: 幽夜森林(像素风, v3.7 换新背景) */
  const bgImg = new Image();
  bgImg.onload = function() { G.bgImg = bgImg; G.bgReady = true; };
  bgImg.src = 'assets/battle-forest-bg.webp';
  /* v4.3 前景遮挡贴图: 水晶(左右下角)抠出 + 底部草沿, 与背景图同尺寸同位对齐,
   * 画在所有实体之上 —— 怪物大模型不再穿透水晶。未就绪时无遮挡(退化原状)。 */
  const fgImg = new Image();
  fgImg.onload = function() { G.fgImg = fgImg; G.fgReady = true; };
  fgImg.src = 'assets/battle-forest-fg.webp';
  /* 怪物素材: 绿色史莱姆 */
  const slimeImg = new Image();
  slimeImg.onload = function() { G.slimeSprite = solidify(slimeImg); G.slimeReady = true; };
  slimeImg.src = 'assets/monster_001_green_slime.webp';
  /* 怪物素材: 水精灵 */
  const waterSpriteImg = new Image();
  waterSpriteImg.onload = function() { G.waterSprite = solidify(waterSpriteImg); G.waterReady = true; };
  waterSpriteImg.src = 'assets/monster_002_water_sprite.webp';
  /* 宠物素材: 灵狐 */
  const petFoxImg = new Image();
  petFoxImg.onload = function() { G.petFoxSprite = solidify(petFoxImg); G.petFoxReady = true; };
  petFoxImg.src = 'assets/pet_fox_sheet.webp';
  /* 灵鹰宠物 */
  const petEagleImg = new Image();
  petEagleImg.onload = function() { G.petEagleSprite = solidify(petEagleImg); G.petEagleReady = true; };
  petEagleImg.src = 'assets/pet_eagle.webp';
  /* 灵鹰弹幕 */
  const petEagleBolt = new Image();
  petEagleBolt.onload = function() { G.petEagleBoltSprite = solidify(petEagleBolt); G.petEagleBoltReady = true; };
  petEagleBolt.src = 'assets/pet_eagle_bolt.webp';
  /* 灵鹰攻击帧 */
  const petEagleAtk = new Image();
  petEagleAtk.onload = function() { G.petEagleAtkSprite = solidify(petEagleAtk); G.petEagleAtkReady = true; };
  petEagleAtk.src = 'assets/pet_eagle_atk.webp';
  /* 技能素材: 剑气月牙 */
  const skillImg = new Image();
  skillImg.onload = function() { G.skillSprite = skillImg; G.skillReady = true; };
  skillImg.src = 'assets/cultivator_skill_sheet.webp';
  /* 技能素材: 横扫千军 */
  const hengsaoImg = new Image();
  hengsaoImg.onload = function() { G.hengsaoSprite = hengsaoImg; G.hengsaoReady = true; };
  hengsaoImg.onerror = function() { G.hengsaoReady = false; console.warn('横扫千军素材加载失败, 走canvas兜底'); };
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
  /* ══════════ v4.4 程序化行走（无 walk 素材的骨骼怪自动摆腿）══════════
   * 背景: monsters/index.json 的 79 只怪里只有 ratty 自带 walk/run 动画, 其余
   * 全部只有 Idle/Attack/Damage 三态 —— boneAnimMap 把 walk 回退成 idle, 于是
   * "怪物有脚却不会走"。实测骨架是有绑腿的(每侧一条 hip→knee→paw 骨链),
   * 所以这里在运行时按正弦驱动腿部骨骼, 现场合成走路循环, 不依赖美术补素材。
   *
   * 关键实现细节(踩过的坑, 勿改):
   *  1) DragonBones 的 bone.offset 是"相对绑定姿势的增量"(offsetMode=Additive,
   *     global = origin + offset + animationPose), 所以每帧必须先还原到绑定姿势
   *     再叠加我们的增量, 否则 offset 会逐帧累积。
   *  2) 只写 offset 不会生效: 必须先置 _localDirty/_transformDirty/_cachedFrameIndex=-1,
   *     再调 bone.update(-1) 才会重算 globalTransformMatrix。
   *  3) 骨骼必须严格【从根到叶】顺序更新 —— 子骨要读父骨刚算好的矩阵。
   *  4) 光更新骨骼还不够: 插槽(slot)持有的是自己那份矩阵, 必须一并 update。
   *  5) 本驱动挂在 advanceRatty 里 advanceTime 之后执行, 覆盖掉 idle 对腿的摆位。 */

  /* 从骨架里自动识别"腿"。不依赖骨骼名(这些素材的骨骼名是乱码, 如
   * "32324343"/"dsdsvccvnbbmnmn", 无法按名字匹配), 改用拓扑+几何特征:
   *   · 骨架根下会挂很多长度为 0 的装饰骨, 先过滤掉 */
  const dbgWalk = (...a) => { if (window.__walkDebug) console.log('[walk]', ...a); };

  /* 腿链识别 —— 两级策略(实测 79 只怪归纳):
   *
   * ① 优先按【骨骼名】匹配(最可靠)。79 只里 36 只的骨架带可读的腿骨名, 命名很统一:
   *    "Left Leg"/"right leg"/"IKLegL"/"IK_Lleg"/"Back leg Left"/"front leg R"/
   *    "LLEG1"/"LegRIK"/"IKFootL" ... 共同特征是名字里含 leg / foot。
   *    命中后取这些骨为"腿根", 各自往下延伸到叶子的那一段就是一条腿链。
   *    这一步能把人形怪的"手臂"和"腿"精确分开 —— 光靠几何分不开(僵尸的
   *    左右胳膊和左右腿下垂量几乎一样), 但名字分得开。
   *
   * ② 名字不可用时(43 只乱码名怪, 如森林狼 "32324343")退回【几何判据】:
   *    叶子 + 长度>0 + 链长≥2 + 下垂量 drop>40。实测四足兽的腿 drop 在 +95~100,
   *    而尾巴/鬃毛/头饰(横向伸展)drop 在 -32~0, 分得很干净。
   *    注意这条对两足人形不可靠(胳膊同样下垂), 所以只作退路, 且此时宁缺毋滥 ——
   *    宁可不动腿, 也不要把胳膊当腿甩。
   */
  const LEG_NAME_RE = /(^|[^a-z])(leg|foot|feet|thigh|shin)([^a-z]|$)/i;
  const isLegName = (n) => LEG_NAME_RE.test(String(n || ''));

  function detectLegs(arm) {
    const bones = arm.getBones();
    const byName = {}; bones.forEach(b => byName[b.name] = b);
    const kids = {};
    bones.forEach(b => {
      const p = b._parent ? b._parent.name : null;
      if (p) (kids[p] || (kids[p] = [])).push(b.name);
    });
    /* 从某个"腿根"沿真实父子链向下走到叶子, 构成一条腿链(只收长度>0 的节) */
    const chainFrom = (rootName) => {
      const names = [];
      let cur = byName[rootName];
      while (cur && cur._boneData && cur._boneData.length > 0) {
        names.push(cur.name);
        const k = kids[cur.name] || [];
        if (!k.length) break;
        /* 若某节分叉出多条子链, 取最长的那个分支(踢掉挂饰/特效骨) */
        let best = null, bestLen = -1;
        for (const c of k) {
          let n = 0, p = byName[c];
          while (p) { n++; const kk = kids[p.name] || []; if (!kk.length) break; p = byName[kk[0]]; }
          if (n > bestLen) { bestLen = n; best = c; }
        }
        cur = byName[best];
      }
      return names;
    };

    /* ---- ① 按名字匹配 ----
     * 注意两个坑(实测):
     *  · 很多怪的 "IKLegL"/"LLEG1"/"RLEG2IK" 是 IK 目标骨, length=0, 不参与形变,
     *    必须靠 length>0 排除(否则会拿 IK 骨当腿, 完全不动)。
     *  · 有单节腿(小怪骨架很简, "Leg Left" 直接就是叶子), 所以链长 >= 1 即可,
     *    不要求 >= 2。 */
    const roots = bones.filter(b => isLegName(b.name) && b._boneData && b._boneData.length > 0);
    if (roots.length) {
      const seen = new Set();
      const out = [];
      roots.forEach(r => {
        if (seen.has(r.name)) return;
        const names = chainFrom(r.name);
        if (!names.length) return;
        names.forEach(n => seen.add(n));
        out.push({ names });
      });
      if (out.length) return normalizeLegs(out, byName);
    }

    /* ---- ② 几何退路 ----
     * 名字不可用时只能靠几何。实测(森林狼)四条真腿的"链根→末端下垂量 drop"
     * 都在 +95~100, 而尾巴/鬃毛/头饰这些横向伸展的链 drop 在 -32~0 —— 用一个
     * drop > 40 的阈值就能把腿和"非腿"干净分开。
     * 注意: 不要试图用"垂直度/漂移比"进一步筛选 —— 实测奔跑姿态下同一条真腿的
     *       漂移比能从 0.11 变到 1.91(腿会前后踢), 该指标无区分力, 反而误杀真腿。
     * 也不限制链长: 四足兽的腿链常见 4~5 节。
     * 局限: 这条对两足人形不可靠(胳膊同样下垂), 故名字匹配才是首选; 若这里
     *       选出的链数 > 6(多半是把一堆尾巴/挂饰都算进来了)则整体放弃, 保守起见
     *       宁可腿不动。 */
    const chains = [];
    bones.forEach(b => {
      if ((kids[b.name] || []).length !== 0) return;       /* 只要叶子 */
      if (!b._boneData || b._boneData.length <= 0) return; /* 装饰骨排除 */
      const names = []; let cur = b;
      while (cur && cur._boneData && cur._boneData.length > 0) { names.unshift(cur.name); cur = cur._parent; }
      if (names.length < 2) return;
      const head = byName[names[0]];
      if (b.global.y - head.global.y <= 40) return;        /* 不下垂 = 尾巴/鬃毛/头饰 */
      chains.push({ names, tipX: b.global.x });
    });
    if (chains.length < 2 || chains.length > 6) return [];
    chains.sort((a, b) => a.tipX - b.tipX);
    return normalizeLegs(chains, byName);
  }

  /* 统一整理: 按左右顺序排 + 分配交替相位(形成对角步态) */
  function normalizeLegs(legs, byName) {
    const withX = legs.map(l => {
      const tip = byName[l.names[l.names.length - 1]];
      return { names: l.names, tipX: tip ? tip.global.x : 0 };
    });
    withX.sort((a, b) => a.tipX - b.tipX);
    withX.forEach((l, i) => { l.phaseOff = (i % 2) ? 0.5 : 0.0; });
    return withX;
  }

  /* 每帧驱动一条腿链。amp 为整体摆幅(0~1), 由怪物移动速度/体型缩放。 */
  function driveLeg(arm, leg, t, amp, refCache) {
    const bones = leg.bones;
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      if (i === 0) {
        const k = i / Math.max(1, bones.length - 1);
        const swing = Math.sin(t + leg.phaseOff * Math.PI * 2) * (0.42 - 0.18 * k) * amp;
        b.offset.rotation = b.__baseR + swing;
      } else {
        const k = i / Math.max(1, bones.length - 1);
        const knee = Math.sin(t + leg.phaseOff * Math.PI * 2 + Math.PI * 1.15) * (0.10 + 0.14 * k) * amp;
        b.offset.rotation = b.__baseR + knee;
      }
    }
    /* 根→叶重算 */
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      b._localDirty = true; b._transformDirty = true; b._cachedFrameIndex = -1;
      b.update(-1);
    }
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
        if (window.__battleDebug) console.log('[battle] 骨骼怪就绪 ' + slug + ' baseH=' + B.baseH.toFixed(1));
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
  /* v7.9: 记录已经发起过加载的 slug, 供突破时补载去重 */
  const _boneLoaded = new Set();
  /* 发起一只怪的骨骼加载(去重): 手配怪与懒加载泵都走这里 */
  function ensureBone(slug, idx) {
    if (!slug || slug === 'ratty' || _boneLoaded.has(slug)) return false;
    const cfg = idx && idx[slug];
    if (!cfg) { console.warn('[battle] index.json 缺怪:', slug); return false; }
    _boneLoaded.add(slug);
    loadBone(slug, { ske:`assets/db/monsters/${slug}/ske.json`, tex:`assets/db/monsters/${slug}/tex.json`, img:`assets/db/monsters/${slug}/tex.webp` }, cfg.armature, cfg.anims);
    return true;
  }
  (function loadBones() {
    if (!window.BattleGL) { console.warn('[battle] BattleGL 未加载, 骨骼怪不可用'); return; }
    loadBone('ratty', { ske:'assets/db/ratty_ske.json', tex:'assets/db/ratty_tex.json', img:'assets/db/ratty_tex.webp' }, 'Ratty',
      ['idle','dead','attack','hurt','walk']);
    fetch('assets/db/monsters/index.json').then(r => r.json()).then(idx => {
      BONE_IDX_ALL = idx;
      const handMade = new Set(Object.values(BC.enemies).map(d => d.bone).filter(Boolean));
      for (const [slug, cfg] of Object.entries(idx)) BONE_IDX[slug] = cfg;
      /* 手配怪(BC.enemies 里带 bone 的): 小体积、开局就要用, 立即加载 */
      for (const slug of [...handMade].filter(b => b && b !== 'ratty')) ensureBone(slug, idx);
      /* tier 分组(仅用于突破时按需补载, 不再驱动开局加载) */
      for (const [slug, cfg] of Object.entries(idx)) {
        if (handMade.has(slug) || slug === 'ratty') continue;
        const t = Math.min(5, Math.max(1, parseInt(String(cfg.tier || 'T1').slice(1)) || 1));
        BONE_POOL[t].push(slug);
      }
      /* ═══ v8.0 核心: 只加载【当前境界实际会用到的怪】, 不再预载全部 79 个包 ═══
       * 设计事实(见 00-pure.js MOB_POOLS): 每大境界 = 12 种怪 × 各10只 + 1 BOSS = 13 个模型。
       * 而 index.json 里有 79 个怪物包 —— 但 12 个境界各不重复, 当前只会用到其中 13 个。
       *
       * ⚠️⚠️ v8.0 致命 BUG 修复(勿回退) —— "一只怪都刷不出来" 的根因:
       * 旧实现写的是 `tierNow = Math.min(5, Math.max(1, PST.lv))`, 然后 `MOB_POOLS[tierNow]`。
       * 这把【段位 lv】当成了【池档位】, 但 MOB_POOLS 的键是【累积段位】(1/2/15/19/.../51), 不是 1~5!
       *   lv=1   → 键 1    ✓ 凡人
       *   lv=2~14→ 键 2    ✓ 炼气
       *   lv=15+ → 被 Math.min 夹成 5 → MOB_POOLS[5] 不存在 → 回退 MOB_POOLS[1] = 凡人怪 ✗
       * 后果: 筑基以上全部加载【凡人】包, 而 spawnWave 要的是当前境界包 → 永远 not ready → 干等,
       * 且 _boneLoaded 去重导致加载过就永不重载 → 整场一只怪都刷不出来。
       *
       * ⚠️ v6: 怪种按【关卡循环轮换】(见 00-stage.js mobFor: (s-1) % 80),
       * 也就是 80 只骨骼怪全都会用到 —— 不再是"本境界 13 只"。所以这里直接铺满
       * MOB_SLUGS, 并按【当前关卡附近要用到的先加载】排序, 保证开局那只一定就绪。
       *
       * 加载顺序: 从当前关起往后取 12 只(覆盖最近要刷的), 剩下的按清单顺序铺。 */
      const order = NS_STAGE.MOB_SLUGS.slice();
      const cur = Math.max(1, v6Progress().stage);
      const prio = [];
      for (let k = 0; k < order.length; k++) prio.push(NS_STAGE.mobFor(cur + k));
      const needed = [];
      const seenNeed = new Set();
      const pushNeed = (slug) => {
        if (slug && slug !== 'ratty' && !handMade.has(slug) && !seenNeed.has(slug) && idx[slug]) { seenNeed.add(slug); needed.push(slug); }
      };
      for (const slug of prio) pushNeed(slug);
      for (const slug of order) pushNeed(slug);
      /* 懒加载泵: 每 1.5s 3 只, 就绪一只即可刷一只。 */
      let i = 0;
      const pump = setInterval(() => {
        const batch = needed.slice(i, i + 3); i += 3;
        for (const slug of batch) ensureBone(slug, idx);
        if (i >= needed.length) clearInterval(pump);
      }, 1500);
    }).catch(err => console.error('[battle] monsters/index.json 加载失败', err));
  })();


  /* 音效加载 */
  /* ⚠️ v6: 旧的"按境界补载怪物包"整套机制已删除(原 v8.0 按 PST.lv 查 poolFor 补载)。
   * 现改为启动时一次性铺开全部 80 只骨骼怪, 见上方 loadBones()。 */
  let BONE_IDX_ALL = null;   /* index.json 原始表 */
  let _bonesTierLoaded = 0;
  /* ⚠️ v6: 80 只骨骼怪在启动时已一次性铺开(见 loadBones), 不再需要"按境界补载"。
   * 保留空壳只为兼容 5s 定时器的旧调用点。 */
  function maybeLoadBonesForTier() { /* v6: 无操作 —— 全量已铺 */ }

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
    if (!a) {
      /* v5.12: 池满不再丢弃, 抢占最旧实例重播(同 playMonSfx 修法) */
      if (pool.length >= 3) a = pool[0];
      else { a = sfx[name].cloneNode(); pool.push(a); }
    }
    return a;
  }
  function playSfx(name, vol, rate) {
    if (!sfx.ready || !sfx[name]) return;
    const a = sfxGet(name);
    if (!a) return;
    /* v6.10: 走 SND 统一播放层(并发限制+同名去抖), 不再直接 a.play() */
    if (typeof SND !== 'undefined') SND.play(a, vol, rate);
  }

  /* ── v6.3 骨骼怪专属音效 ──────────────────────────────────────────────
   * 原素材包(Ækashics Librarium)全系列只发视觉资源(map sprite / 静态立绘 /
   * DragonBones 工程 / 图标), 从不带音频, 所以重下一百遍也没有音效。
   * 这里单独补一套 CC0 素材: OpenGameArt「80 CC0 Creature SFX」(rubberduck, CC0 免署名),
   * 已转单声道 44.1kHz vorbis, 全 77 条合计 ≈700K。
   * MON_ATK: 79 只骨骼怪每只一条专属攻击音(70 条不重复 / 7 条各复用两次)。
   * MON_HURT: 受击音固定这 5 条轮播 —— 受击是高频事件, 每怪再备一条不划算。
   * 不入上面的常驻 sfx 表(那 12 条决定 sfx.ready 开门时间), 走按需懒加载+池化。 */
  const MON_ATK = {
    ancient_automaton: 'weird_01', animated_drill_dwarf: 'alien_04', arcane_golem: 'monster_05',
    axe_goblin: 'cute_07', bee: 'bug_04', black_ant_queen: 'bug_01', bonemask_shadow_creature: 'scream_01',
    clockwork_king: 'troll_01', clockwork_skull: 'troll_03', colossal_crow: 'roar_03',
    continental_turtle_rukkha: 'cute_01', crab_king_karkinos: 'burble_01', cultist_mage: 'cute_05',
    dagger_goblin: 'cough_03', daidarabotchi: 'misc_08', dark_queen_shaccadyoggoth: 'alien_02',
    darkness_titan_ilnoct: 'roar_02', dragon_huanglong: 'monster_01', dryad_queen_rafflesia: 'burble_02',
    dryad_yggdrasil: 'monster_03', eldritch_overmind: 'cute_06', forest_turtle: 'cute_02', fox: 'misc_07',
    ghost: 'cough_01', giant_kitsune: 'barking_01', goblin_machine_gun: 'alien_06',
    god_warrior_dagon: 'monster_02', god_warrior_isis: 'cute_08', god_warrior_osiris: 'cough_02',
    god_warrior_skoll: 'roar_02', goddess_aphrodite: 'roar_01', grand_sorceress_duesa: 'monster_07',
    gun_mimic: 'eat_01', hades: 'eat_03', hellhound_garm: 'barking_02', ice_titan_demeres: 'breath',
    insect_queen: 'bug_02', jiangshi: 'scream_02', jubokko: 'weird_03', king_archial: 'grunt_02',
    legendary_knight_michael: 'burp_01', legendary_knight_regulus: 'misc_02', legendary_knight_remment: 'grunt_05',
    librarium_animated_legendary_knight_pizarro: 'grunt_01', librarium_animated_mechadragon_ladon: 'monster_06',
    librarium_animated_skull_knight_xoer: 'troll_02', light_titan_alfadriel: 'monster_02',
    living_armor: 'alien_05', living_hoard_midas: 'misc_03', mageshroom: 'weird_05',
    magical_girl_goblin: 'cute_09', mecha_rattlesnake: 'weird_04', mechascorpion: 'weird_02',
    mermaid_warrior_undeen: 'spit_02', mimic: 'eat_02', mythical_knight_goldnharl: 'misc_04',
    parrot_king: 'misc_01', poseidon: 'cute_10', radulac_the_voidvod: 'alien_01',
    runic_stone_golem_goliath: 'grunt_04', scorpion: 'bug_03', sea_calamity_urmica: 'roar_01',
    sea_dragon_leviathan: 'monster_03', shaccadyoggoth: 'alien_03', slime_flynn: 'cute_03',
    son_of_valhalla: 'roar_03', spirit_fighter: 'eat_04', sun_goddess: 'misc_05', sword_goblin: 'spit_03',
    tantalus: 'grunt_01', thanatos: 'monster_04', the_fallen: 'monster_01', the_horde: 'grunt_03',
    thunder_titan_dynamo: 'misc_06', unicorn: 'cute_04', witch_baba: 'burp_02', wolf: 'howl',
    zeograth: 'misc_09', zodiac_cancer: 'spit_01',
  };
  const MON_HURT = ['hurt_01', 'hurt_02', 'hurt_03', 'hurt_04', 'hurt_05'];
  let monHurtRot = 0;
  const MON_SRC = Object.create(null), MON_POOL = Object.create(null);
  function playMonSfx(file, vol, rate) {
    if (!file) return;
    const pool = MON_POOL[file] || (MON_POOL[file] = []);
    let a = null;
    for (const x of pool) { if (x.paused || x.ended) { a = x; break; } }
    if (!a) {
      /* v5.12: 池满不再丢弃 —— 单怪节奏下每次攻击/受击都是独立事件, 丢了就是"没声"。
       * 改抢占最旧实例重播(SND.play 会重置 currentTime), 兽潮时也只是旧音被顶掉。 */
      if (pool.length >= 3) a = pool[0];
      else {
        const src = MON_SRC[file]
          || (MON_SRC[file] = new Audio('assets/sfx/monster/' + file + '.ogg'));
        a = src.cloneNode(); pool.push(a);
      }
    }
    /* v6.10: 走 SND 统一播放层 */
    if (typeof SND !== 'undefined') SND.play(a, vol, rate);
  }
  /* 怪的三类发声: 攻击走专属音, 受击轮播 hurt 组, 脚步复用现有 footstep 变调(存在感低, 不值得每人一条) */
  function monAttackSfx(e) {
    if (!e) return;
    if (e.type === 'slime') return playSfx('slime_attack', 0.5);
    if (e.type === 'water') return playSfx('water_attack', 0.5);
    if (e.type === 'boss') return playSfx('boss_attack', 0.8);
    const f = e.boneSlug && MON_ATK[e.boneSlug];
    if (f) playMonSfx(f, 0.5);
  }
  function monHurtSfx(e) {
    if (!e) return;
    if (e.type === 'slime') return playSfx('slime_hurt', 0.5);
    if (e.type === 'water') return playSfx('water_hurt', 0.5);
    playMonSfx(MON_HURT[(monHurtRot++) % MON_HURT.length], 0.45);
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
  /* ══════ v6.1 体型归一: 走路 / 普攻 / 剑气斩 三套帧统一「角色高度 + 脚底贴地」 ══════
   * 症状: 一放技能人就缩小一圈, 而且脚离地。
   * 上一轮「增高」只把渲染基准 drawH 提到 80, 但三套帧一直是【按画布边界】等比缩放的,
   * 于是画出来多大完全取决于素材里角色占画布的比例:
   *   普攻表 cultivator_sheet        408x252  角色内容高 ≈242/252 = 0.960
   *   技能表 cultivator_skill_sheet  480x256  起手段 f0~f8 只有 ≈172/256 = 0.672
   * 同一个 drawH=80 缩下去, 普攻人高 76.8px, 技能起手只剩 53.4px —— 直接小 30%,
   * 看到的就是「一按键人缩了」; 技能表这几帧脚底还画在 y≈219/256(离帧底 37px),
   * 等比渲染后脚悬空 12~19px。f10 起月牙铺满画布(占比 0.92~1.0)视觉才恢复,
   * 所以只有前段突兀 —— 不是走路改了、技能没改, 是两素材的内容占比本来就不同。
   *
   * 修法: 不再按画布缩放, 统一按【内容包围盒】缩放 —— 每帧把角色实际高度归一到同一个
   * BODY_REF_H, 并用内容底边贴地板。走路 / 普攻 / 技能三套同值同源, 一次同时到位,
   * 顺便消掉逐帧内容高抖动带来的「呼吸」感。脚下的悬空比例三套素材是同一套算法,
   * 归一后底边一律贴 sy, 不再各自留出不同高度的空白。
   * 数值由脚本离线逐帧量 AABB(alpha>16)得到, 写死在这里, 运行时零开销。
   * 注: 技能表 f9 是脏点帧(全帧只剩零星像素), 直接用会把缩放算飞, 取 f8/f10 插值。 */
  const BODY_REF_H = 242;                     /* 参考内容高: 普攻表走路帧均值, 帧坐标 */
  const BODY_RATIO = BODY_REF_H / SPRITE.fh;  /* 0.960 —— 画布 252 里角色实际占多少 */
  /* cultivator_sheet 72 帧(走路 0~31 + 普攻 32~71)逐帧内容包围盒: [高, 底边] */
  const SPRITE_BOX_H = [
    240,239,239,240,239,240,241,241,241,242,242,242,
    242,240,239,240,240,240,241,243,245,247,247,245,
    246,246,245,245,244,245,243,241,243,239,236,232,
    232,232,231,232,232,237,237,237,237,238,238,238,
    238,238,238,238,238,238,238,238,238,238,238,238,
    238,238,238,248,248,248,248,246,243,247,247,246
  ];
  const SPRITE_BOX_B = [
    247,247,247,248,247,248,248,247,247,247,247,247,
    248,247,247,247,247,247,247,247,247,248,248,248,
    248,248,247,248,247,248,247,248,248,248,248,248,
    248,248,248,248,248,248,248,248,248,248,248,248,
    248,248,248,248,248,248,248,248,248,248,248,248,
    248,248,248,248,248,248,248,246,245,248,248,246
  ];
  /* cultivator_skill_sheet 24 帧(剑气斩)。
   * v6.2 关键修正: 技能表 f10 起画面里除了人物还有大月牙/圆环特效, 整帧 AABB 被
   * 特效撑到 235~256 —— 上一版按整帧归一, 等于拿月牙当人身高, 月牙一出现人物
   * 又被压小 30%。实测把特效抠掉后, 人物本身全表恒定 ≈172px(含脚下阴影)。
   * 因此这三张表全部只量【人物簇】(按列空隙把右侧特效切开):
   *   BOX_H 人物高 / BOX_B 人物底边(贴地用) / BOX_CX 脚底中心x(锚定玩家脚下来用) */
  const SKILL_BOX_H = [172,171,178,180,181,182,182,183,181,181,181,173,172,173,172,172,172,172,172,172,172,173,173,173];
  const SKILL_BOX_B = [219,218,223,225,226,229,233,234,234,233,232,233,233,235,234,235,236,236,236,231,223,223,237,235];
  const SKILL_BOX_CX = [203,194,213,202,199,196,196,198,204,178,152,138,141,138,140,137,138,138,146,178,190,182,100,107];
  /* 横扫千军特效配置: 7列7行, 49帧, 左右渐现渐隐 */
  const HENGSAO_SPRITE = { cols:7, fw:320, fh:160, count:49, fps:12 };
  /* 史莱姆帧配置: 12列8行, walk32+attack51+hurt11 */
  const SLIME_SPRITE = { cols:12, fw:240, fh:128, walkStart:0, walkCount:32, attackStart:32, attackCount:51, hurtStart:83, hurtCount:11, fps:24 };
  /* 水精灵帧配置: 10列8行, walk32+attack33+hurt13 */
  const WATER_SPRITE = { cols:10, fw:240, fh:128, walkStart:0, walkCount:32, attackStart:32, attackCount:33, hurtStart:65, hurtCount:13, fps:24 };
  const PET_SPRITE = { cols:8, fw:96, fh:80 };

  /* ── 战斗层数字格式化 ──
   * ⚠️ v7.10：原先这里自有一套 fmtNum（万/亿，≥1e12 走科学计数），
   *   与 00-num.js 的 N.fmt 口径不一致——同一个灵石数在顶部 HUD 与左下资源栏
   *   会显示成两个样子（一个是"416万"，一个是"4.16e6"）。
   *   现在整份实现委托给 N.fmt（万/亿/兆/京…），统一为单一事实源，此处不再自有分支。 */
  function fmtNum(n) {
    try { return NS_NUM.fmt(NS_NUM.from(Math.round(n || 0))); }
    catch (e) { return String(Math.round(n || 0)); }
  }
  /* ---------- 技能读取: 等级与数值的唯一来源是主游戏 SkillAPI ---------- */
  function skVal(id)  { const api = window.SkillAPI; return api ? api.val(id) : null; }   // v6: 返回 SKILL_DEFS 常量，非插值
  /* ---------- 技能名播报: 战斗画布中央书法大字, 弹入→停→快淡出(~0.75s 即隐) ----------
   * 覆盖式单槽不叠字; 同名 0.9s 冷却防高频 proc 连刷拖长显示 */
  const _callCd = {};
  function skillCall(name) {
    const now = performance.now();
    if (_callCd[name] && now - _callCd[name] < 900) return;
    _callCd[name] = now;
    G.skillCall = { name, t: 0, dur: 0.68 };   /* v2.9: 0.75→0.68s, 末 18% 淡出 → 实际"看得清"约 0.56s 后瞬间消失 */
  }

  /* ══════════ 标定台专用：静态仿真模式（不影响正式游戏，全部由 window.RANGE_LAB 开关控制）══════════ */
  let LAB = null;   /* { slug, anim, opts } */
  function labActive() { return !!(LAB && typeof window !== 'undefined' && window.RANGE_LAB); }
  /* 玩家固定在屏幕 25% 处；怪摆在「玩家 + 当前攻距」处 ——
   * 站位与攻距直接挂钩，AI 站位的真实含义就是"两锚点相距 atkRange"。 */
  function labLayout() {
    const px = Math.round((CW || 1200) * 0.25);
    const e = G && G.enemies && LAB ? G.enemies.find(x => x.boneSlug === LAB.slug && x.alive) : null;
    const r = e ? Number(e.atkRange) || 100 : 100;
    return { px, ex: px + r, floor: floorY() + laneOff(MID_LANE) };
  }
  function labClearEnemies() {
    /* 标定台必须真空清场 —— 只置 alive=false 是不够的：labActive 时
     * updateEnemies 被 labTick 整个接管，永远不会跑 dying 倒计时把尸体剔除，
     * 于是旧怪一直被 render 画出来（切怪时叠一堆残影）。还要连带清掉
     * 粒子/掉落/伤害数字，否则上一只的技能特效会留在画面上。 */
    if (G.enemies) { for (const e of G.enemies) { e.alive = false; e.dying = 0; } G.enemies.length = 0; }
    if (G.drops) G.drops.length = 0;
    if (G.fx) G.fx.length = 0;
    SK_LIVE.length = 0;   /* 同步清掉技能弹道活引用, 否则 G.fx 清空后 SK_LIVE 成悬空 */
    if (G.dmg) G.dmg.length = 0;
    if (G.pets) G.pets.length = 0;
  }
  function labEnsureEnemy() {
    const wantSlug = LAB.slug;
    const cur = G.enemies.find(e => e.alive && e.dying <= 0 && e.boneSlug === wantSlug && !!e.armature);
    if (cur) { cur.atkRange = LAB.opts.atkRange; cur.role = LAB.opts.role; return cur; }
    labClearEnemies();
    const e = makeBoneEnemy(wantSlug, LAB.opts.tier || 1);
    e.elite = false;
    e.lane = MID_LANE; e.y = laneOff(MID_LANE);
    G.enemies.push(e);
    return e;
  }
  /* v4.8 给验收台用: 读取某只怪骨架工厂是否就绪 */
  window.__boneReady = (slug) => !!(BONES[slug] && BONES[slug].ready);
    /* v4.8 技能弹道验收台：并排摆多只技能怪，让它们真打（不设 atk=0），
   * 用于目视检查 5 类弹道的浓度/尺寸/是否抢画面。不影响正式游戏。 */
  window.__skillTest = (list, opts) => {
    opts = opts || {};
    window.RANGE_LAB = false;              /* 走常规 updateEnemies，怪才会真攻击 */
    LAB = null;
    if (window.__LAB__) { CW = window.__LAB_GW || 1200; CH = window.__LAB_GH || 300; }
    if (!G.player) G.player = makePlayer();
    G.player.x = Math.round((CW || 1200) * 0.25);   /* 玩家钉在左 1/4 */
    /* 全部同一条道 —— 敌人开火条件是 e.lane === p.lane（见 updateEnemies），
     * 分道摆放会导致 3 道里只有 1 只够得着玩家，其余压根不开火。 */
    G.player.lane = MID_LANE; G.player.y = laneOff(MID_LANE);
    G.player.hp = G.player.maxHp = 9e6;
    G.player.atk = 0;                      /* 玩家不还手，怪不会被打死 */
    /* 玩家也必须冻住：正常逻辑里玩家会被推着走、怪追着走，
     * 打几秒后双方位置全漂移，"站在 atkRange 上开火"的前提就失效了。 */
    window.__skillFreeze = true;
    labClearEnemies();
    /* v7.9：相机已锁死 camX=0（updateCamera 每帧赋 0），这里不必再给初值。
     * 旧写法 `camX = player.x - stageW()*0.42` 是给「跟拍式累加」兜底的（防 NaN 进累加），
     * 现在 updateCamera 是赋值而非累加，那行只会让验收台的第一帧画面被平移一次。 */
    const out = [];
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const slug = list[i];
      const e = makeBoneEnemy(slug, opts.tier || 3);
      e.elite = false;
      /* 全部站在玩家纵深线上 —— 分道摆放会导致只有 1 只够得着玩家 */
      e.lane = MID_LANE;
      /* y 上按序号错开：全部同道会叠成一个人形粽。错开量刻意压在半个身位内，
       * 视觉上仍是"站在玩家正前方一排"，但每只都能看清轮廓。 */
      e.y = laneOff(MID_LANE) + (i - (list.length - 1) / 2) * (laneGap() * 0.42);
      /* x 必须严格落在各自的 atkRange 上 —— 开火门限是 |e.x - p.x| <= atkRange + 5，
       * 多推 6px 就会让后面几只永远够不着（首版验收台踩到的坑，表现为
       * 只有第 0 只开火、其余 atkT 一路负下去）。 */
      e.x = G.player.x + (e.atkRange || 120);
      e.hp = e.maxHp = 9e6;
      e.atk = Math.round((PST && PST.maxHp ? PST.maxHp : 2000) * 0.004);  /* 打不死的轻伤 */
      e.atkT = 0;
      e.__skillHold = true;                /* 让 updateEnemies 别推着它往前挪 */
      G.enemies.push(e);
      out.push({ slug, kind: SK_OF[slug] || null, atkRange: e.atkRange });
    }
    return out;
  };
  /* v4.8 弹道验收台的自检快照：G 是模块私有变量，外部看不到，
   * 冒烟测试只能靠这个口子确认"怪到底开火没有"。 */
  /* v6.0 战斗距离自检: 一眼看清"谁够得着谁、差多少"。
   * 判据(response.pairs):
   *   stop    怪站位(锚点距离)      = 玩家半宽 + 怪前伸量  → 不重叠的极限贴合
   *   reachP  玩家前伸量(剑尖)      = BC.playerAtkRange
   *   halfE   怪半宽(实时体型)
   *   pCanHit dist <= reachP + halfE ?  → 玩家够得着怪
   *   eCanHit dist <= enemyReach + 玩家半宽 ? → 怪够得着玩家
   * 两边都是 true 才算这套距离逻辑健康。 */
  window.__rangeProbe = () => {
    const p = G.player;
    const pw = playerHalfW();
    return {
      player: { x: Math.round(p.x), y: Math.round(p.y),
                reach: p.atkRange, half: +pw.toFixed(1), atkAnim: !!p.attackAnim, moving: p.moving },
      pairs: G.enemies.filter(e => e.alive && e.dying <= 0).map(e => {
        const d = groundDist(p, e), he = enemyHalfW(e), er = enemyReach(e);
        return {
          t: e.type, skill: e.skill || 0,
          dist: Math.round(d), stop: e.stopX != null ? Math.round(e.stopX - p.x) : null,
          reachP: p.atkRange, halfE: +he.toFixed(1), reachE: +er.toFixed(1),
          pCanHit: canHit(p, e, p.atkRange),
          eCanHit: canHit(e, p, er),
        };
      }),
      kills: G.kills,
    };
  };
  window.__skillProbe = () => {
    const kinds = {};
    for (const f of G.fx) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
    return {
      enemies: G.enemies.map(e => ({ t: e.type, x: Math.round(e.x), r: e.atkRange,
        lane: e.lane, atkT: +(e.atkT || 0).toFixed(2) })),
      camX: G.camX, playerX: G.player && Math.round(G.player.x),
      fxKinds: kinds, fxCount: G.fx.length,
      live: SK_LIVE.map(f => ({ sk: f.sk, t: +(f.t || 0).toFixed(2), x: Math.round(f.x) })),
      pumpRuns: window.__pumpRuns || 0,
    };
  };
  /* 标定台：设置当前被标定的怪 + 参数（攻距/角色/档位） */
  window.__labSet = (slug, opts) => {
    opts = opts || {};
    LAB = { slug, anim: opts.anim || 'Idle', opts: {
      atkRange: Number(opts.atkRange) || 100,
      role: opts.role || 'melee',
      tier: opts.tier || 1,
      fps: Number(opts.fps) || 8,
      paused: !!opts.paused,
      loop: opts.loop !== false,
    } };
    window.RANGE_LAB = true;
    G.paused = false;                 /* 仿真要跑逻辑，暂停只在 stage 层拦 */
    if (!G.player) { G.player = makePlayer(); }
    G.player.lane = MID_LANE; G.player.y = laneOff(MID_LANE);
    G.player.hp = G.player.maxHp = 99999;
    G.player.atk = 0;                 /* 玩家不还手，怪不会被秒 */
    G.player.atkRange = Number(opts.playerAtkRange) || 75;
    const e = labEnsureEnemy();
    e.hp = e.maxHp = 99999;
    e.atk = 0;                        /* 怪也不掉玩家血，专心看站位 */
    window.__labT = 0;
    return { ok: true, slug, enemies: G.enemies.length, hasArm: !!e.armature };
  };
  window.__labInfo = () => {
    if (!LAB) return null;
    if (window.__LAB__) { CW = window.__LAB_GW || 1200; CH = window.__LAB_GH || 300; }
    const e = G.enemies.find(x => x.boneSlug === LAB.slug && x.alive);
    const B = BONES[LAB.slug];
    if (!e || !e.armature || !B) return { slug: LAB.slug, ready: false };
    const bb = window.BattleGL.armatureAABB(e.armature);
    const def = BC.enemies[e.type] || {};
    const cap = def.isBoss ? CH * 0.7 : CH * 0.5;
    const drawH = Math.min(cap, e.drawH || def.drawH || 84) * laneScale(yToDepth(e.y));
    const s = drawH / Math.max(1, B.baseH || 100);
    const L = labLayout();
    /* 标定台：CW/CH 取横带逻辑尺寸 —— 与舞台模式（60-stage 传 W/bandH）同一套语义 */
    if (window.__LAB__) { CW = window.__LAB_GW || 1200; CH = window.__LAB_GH || 300; }
    /* 屏幕空间：躯干左缘 = 怪锚点x - s*(w/2) */
    const wScreen = s * (bb.maxX - bb.minX);
    const hScreen = s * (bb.maxY - bb.minY);
    const leftEdge = L.ex - wScreen / 2;
    const pHalf = Math.min(CH * 0.5, 72) * laneScale(MID_LANE) * (SPRITE.fw / SPRITE.fh) / 2;
    const playerLeft = L.px - pHalf;
    const playerRight = L.px + pHalf;
    return {
      slug: LAB.slug, ready: true, anim: LAB.anim,
      atkRange: e.atkRange, role: e.role,
      enemyX: Math.round(L.ex), playerX: Math.round(L.px),
      gap: Math.round(L.ex - L.px),                     /* 锚点间距（= atkRange） */
      bodyW: Math.round(wScreen), bodyH: Math.round(hScreen), baseH: Math.round(B.baseH),
      drawH: Math.round(drawH), scale: +s.toFixed(4),
      bodyLeft: Math.round(leftEdge), bodyRight: Math.round(L.ex + wScreen / 2),
      playerLeft: Math.round(playerLeft), playerRight: Math.round(playerRight),
      /* 躯干左缘 相对 玩家右缘 的余量：>0 = 没压到玩家 */
      clear: Math.round(leftEdge - playerRight),
      collide: !!(Math.abs(laneAt(e.y) - laneAt(G.player.y)) <= 1 && Math.abs(L.ex - L.px) <= e.atkRange + 5),
      anims: Object.keys(B.anims).filter(k => B.anims[k]),
      rawAnims: B.rawAnims || [],
      curAnim: LAB.anim,
    };
  };
  /* 标定台：临时改攻距，立刻生效（看挡不挡人） */
  window.__labRange = (v) => {
    const e = G.enemies.find(x => x.boneSlug === LAB.slug && x.alive);
    if (!e) return null;
    e.atkRange = Number(v); return e.atkRange;
  };
  /* ══════════ 自动测距 ══════════
   * 只要骨架能摆出来，帧 AABB 就是可测量的 —— 这就是那把「尺子」。
   * 逐帧扫一个动画，取整段里身体/武器/投射物伸得最远的时刻。
   * 全部换算与 render 一致（scale = drawH / baseH，bbox 中心对齐锚点），
   * 所以测出来的 px 和玩家站位、和 e.atkRange 是同一个坐标系里的数。 */
  function labScaleOf(e, B) {
    const def = BC.enemies[e.type] || {};
    const cap = def.isBoss ? CH * 0.7 : CH * 0.5;
    const drawH = Math.min(cap, e.drawH || def.drawH || 84) * laneScale(yToDepth(e.y));
    return { drawH, s: drawH / Math.max(1, B.baseH || 100) };
  }
  function labPlayerHalf() {
    return Math.min(CH * 0.5, 72) * laneScale(MID_LANE) * (SPRITE.fw / SPRITE.fh) / 2;
  }
  /* 摆到指定动画的指定时刻。
   * 关键：必须用 fadeIn 而不是 play —— DragonBones 里 play() 只重置动画对象，
   * 真正切换状态并驱动骨骼的是 fadeIn（它挂 _isFadeIn，在 advanceTime 里做混合）。
   * 之前用 play() 导致四个动画量出同一份姿势（reach 全等）。
   * 另外 fadeIn 后要先把混合期走完，否则测到的是「上一个动画的残余姿势」。 */
  function labDrive(arm, anim, target) {
    const A = arm.animation;
    if (!A) return false;
    if (!A.hasAnimation || !A.hasAnimation(anim)) return false;
    A.fadeIn(anim, 0, -1);                 /* 0 秒混合 + playTimes=-1 循环，直接切 */
    arm.advanceTime(0);                    /* 让状态机落位 */
    let t = 0;
    const step = 1 / 60;                   /* 固定小步长，保证姿势连续 */
    while (t < target) { const d = Math.min(step, target - t); arm.advanceTime(d); t += d; }
    return true;
  }
  function labMeasure(slug, anim, opts) {
    opts = opts || {};
    const e = G.enemies.find(x => x.boneSlug === slug && x.alive && x.armature);
    if (!e || !e.armature) return null;
    const B = BONES[slug];
    if (!B) return null;
    const A = e.armature.animation;
    if (!A || (A.hasAnimation && !A.hasAnimation(anim))) return null;
    /* 动画时长从骨架数据取。注意：animations 挂在 armature.animation.animations
     * （dragonBones.js: Armature.init 里 this._animation.animations = _armatureData.animations），
     * 且 AnimationData.duration 单位是**秒**，不是帧数 —— 之前当帧数除以 frameRate，
     * 把时长算小了 24 倍，导致采样循环退化到只跑第 0 帧、四个动画量出同一姿势。 */
    const dBag = e.armature.animation && e.armature.animation.animations;
    const animData = dBag ? dBag[anim] : null;
    const fr = (animData && animData.frameRate) || 24;
    const total = (animData && animData.duration > 0) ? animData.duration
                : ((animData && animData.playTimes && animData.duration) || 1);
    if (!(total > 0)) return null;
    const durF = Math.max(1, Math.round(total * fr));
    const sc = labScaleOf(e, B);
    const s = sc.s;
    const px = Math.round((CW || 1200) * 0.25);
    const ex = px + (Number(e.atkRange) || 100);      /* 怪锚点 = 玩家 + 当前攻距 */
    const aabb = window.BattleGL.armatureAABB;
    const step = opts.step || 0.5;                    /* 每 0.5 帧采一次，够密 */
    const N = Math.max(8, Math.min(400, Math.round(durF / step)));
    let best = null;
    for (let i = 0; i < N; i++) {
      const tgt = (i / N) * total;
      if (!labDrive(e.armature, anim, tgt)) return null;
      const bb = aabb ? aabb(e.armature) : null;
      if (!bb || !isFinite(bb.minX) || !isFinite(bb.maxX)) continue;
      const wS = s * (bb.maxX - bb.minX);
      const leftEdge = ex - wS / 2;                   /* 与 render 的中心对齐规则一致 */
      const reach = Math.round(px - leftEdge);        /* 玩家锚点 → 最左沿 */
      const depth = Math.round(s * (bb.maxY - bb.minY));
      if (!best || reach > best.reach) {
        best = { reach, p: +(i / N).toFixed(3), t: +tgt.toFixed(3),
                 wScreen: Math.round(wS), depth, leftEdge: Math.round(leftEdge) };
      }
    }
    if (!best) return null;
    return Object.assign({ slug, anim, durFrames: Math.round(durF), fps: fr,
                           total: +total.toFixed(3), scale: +s.toFixed(4),
                           drawH: Math.round(sc.drawH) }, best);
  }
  /* 扫一只怪的若干候选动画，给出峰值结论 + 建议攻距 */
  window.__labMeasure = (slug, anims, opts) => {
    if (window.__LAB__) { CW = window.__LAB_GW || 1200; CH = window.__LAB_GH || 300; }
    const list = (anims && anims.length) ? anims : ['Idle'];
    const out = {};
    for (const a of list) { const r = labMeasure(slug, a, opts); if (r) out[a] = r; }
    if (!Object.keys(out).length) return null;
    let peak = null, peakAnim = null;
    for (const a in out) if (!peak || out[a].reach > peak.reach) { peak = out[a]; peakAnim = a; }
    const px = Math.round((CW || 1200) * 0.25);
    const pHalf = labPlayerHalf();
    const playerRight = Math.round(px + pHalf);
    /* 峰值帧：怪锚点 ex 固定在 px+atkRange，与站位无关的量是「左缘相对玩家右缘」。
     * 建议攻距 = 让玩家右缘恰好抵住峰值左缘 所需的锚点间距
     *          = (锚点 - 峰值左缘) + 玩家半宽 = peak.reach + pHalf  … 再夹进合法区间。 */
    const rawSuggest = peak.reach + pHalf;
    const suggest = Math.round(Math.max(34, Math.min(130, rawSuggest)));
    const durs = {};
    for (const a in out) durs[a] = out[a].durFrames;
    return { slug, peakAnim, peak, all: out, durFrames: peak.durFrames,
             allDurFrames: durs, playerHalf: Math.round(pHalf),
             playerRight, rawSuggest: Math.round(rawSuggest), suggest };
  };
  /* 标定台：跳到动画进度 p（0~1），暂停下也能定格看某一帧 */
  window.__labSeek = (p) => {
    if (!LAB) return;
    LAB.opts.paused = true; LAB.opts.loop = false;
    LAB.seek = Math.max(0, Math.min(0.999, Number(p)));
    LAB.t = LAB.seek * (LAB._total || 1);
    LAB.opts.loop = false;
    return LAB.seek;
  };
  /* 标定台：恢复播放（拖过进度条后回到循环） */
  window.__labPlay = () => {
    if (!LAB) return null;
    LAB.seek = null; LAB.opts.loop = true; LAB.opts.paused = false;
    return true;
  };
  /* 标定台：切动画 / 进度 */
  window.__labAnim = (anim, opts) => {
    if (!LAB) return null;
    LAB.anim = anim; LAB.t = 0; LAB.seek = null;
    if (opts && opts.atkRange != null) return window.__labRange(opts.atkRange);
    return anim;
  };
  /* 标定台：测完直接把画面定格在峰值帧 —— 用户一眼看到「就是这一帧打到最远」 */
  window.__labMeasureAndSeek = (slug, anims) => {
    const r = window.__labMeasure(slug, anims);
    if (!r) return null;
    LAB.anim = r.peakAnim;
    LAB.opts.paused = true; LAB.opts.loop = false;
    LAB.seek = r.peak.p; LAB.t = 0;
    return r;
  };

  let _deathCb = null;   /* v8.1 死亡回调(06-v6ui 经 BattleAPI.onPlayerDeath 注册) */

  window.BattleAPI = {
    /* v3.2: 统一舞台接入点 —— 返回 60-stage 契约层对象 { name, draw(ctx,W,H,dt) }。
     * 调用后本层不再自持 rAF，逻辑与绘制都由舞台按统一 30fps 驱动。
     * ⚠️ 舞台传进来的 dt 必须是原始 dt —— 倍速乘法留在 update() 内部。 */
    createStageLayer: () => { _managed = true; _rafOn = false; respawnArena(); return battleLayer(); },  /* v6: 每次进入战斗清场重来 */
    getKills: () => G.kills,
    resetKills: () => { G.kills = 0; updateHUD(); },
    setSpeedMult: (mult, duration) => {
      const m = Math.max(BASE_SPEED_MULT, Math.min(BUFF_SPEED_CAP, mult || BASE_SPEED_MULT));
      G.speedMult = m;
      G.speedMultTimer = m > BASE_SPEED_MULT ? (duration || 30) : 0;
      updateHUD();
      return G.speedMult;
    },
    /* 倍速状态快照：给验收脚本读剩余时长用 */
    setStats: (s) => {
      if (!s) return;
      PST = Object.assign(PST, s);
      if (G.player) {
        G.player.atk = PST.atk;
        /* v6.6 血量随面板等比缩放: maxHp 变化(升境/换装/法宝)时按比例换算当前血量 ——
         * 旧逻辑"只裁剪不抬升"有初始化时序 bug: init() 先用默认面板(hp=430)建玩家,
         * 主游戏 setStats 后 maxHp 已 1.3万, hp 还是 430 → 开局 3% 丝血(实测)。
         * 等比换算下 makePlayer(hp=maxHp=100%) → setStats 后仍 100%, 开局必满血。 */
        const oldMax = G.player.maxHp > 0 ? G.player.maxHp : PST.hp;
        G.player.maxHp = PST.hp;
        if (oldMax > 0 && G.player.hp > 0)
          G.player.hp = Math.min(G.player.maxHp, Math.max(1, Math.round(G.player.hp * PST.hp / oldMax)));
        if (G.player.hp > G.player.maxHp) G.player.hp = G.player.maxHp;
        /* v2.5 功法攻速词条: 面板攻速(基础1.1×词条乘区, 主游戏侧已封顶3.0) → 同步进玩家,
         * 战斗节奏 atkT=1/aspd 随之加快; 无词条旧档回落 BC.playerAspd */
        G.player.aspd = Math.min(3, PST.aspd || BC.playerAspd);
      }
      /* v7.9: 境界可能变了(突破) → 按需补载新境界的怪物包。
       * 因为开局只加载"当前境界需要的 13 个", 突破到新境界时必须把新的一批补上,
       * 否则新波次的怪会因骨骼未就绪而一直不刷。内部有去重, 每 5s 调一次无副作用。 */
      maybeLoadBonesForTier();
    },
    getStats: () => Object.assign({}, PST),
    /* 服务端下发掉落系数(每击杀产出) */
    setDropRates: (r) => { if (r) Object.assign(DROP, r); },
    getDropRates: () => Object.assign({}, DROP),
    onDrop: null,      // 主游戏赋值: ({spirit, elite, enemy}) => void
    /* v8.1 死亡接管: 玩家被怪打死 → 冻结战斗并回调; 上层弹「转生/从头开始」面板,
     * 选择后调 respawn() —— 回满血+按(可能已重置的)关卡重刷+解除暂停。 */
    onPlayerDeath: (cb) => { _deathCb = typeof cb === 'function' ? cb : null; },
    setPaused: (on) => { G.paused = !!on; updateHUD(); },
    respawn: () => {
      if (G.player) { G.player.hp = G.player.maxHp; G.player.hurtT = 0; }
      respawnArena();
      /* v8.1: 独立泵模式下 G.paused 期间泵已自退(见 loop), 解冻后必须重启 —— 同 resume() 的 guard */
      if (!_managed && !_rafOn) { _rafOn = true; requestAnimationFrame(loop); }
    },
    getSpirit: () => G.spirit,
    /* v8.0 怪物包诊断口: 定位"一只怪都不出"这类问题 —— 一眼看清
     *   当前 lv / 该用哪个池 / 池里 13 个 slug / 哪些已请求 / 哪些已就绪。
     * 排查口诀: 若"该加载的 13 个"里有 slug 不在"已请求"中 → 加载范围错(loadBones 的池取错);
     *           若"已请求"但长期不在"已就绪" → 是资源 404 / 解析失败, 与刷怪逻辑无关。 */
    getSpeedState: () => ({ mult: G.speedMult, timer: G.speedMultTimer, dodge: G.speedDodge || 0 }),
    /* v6 身法 buff 快照：{ 技能id: { name, cd, dur, cdLeft, durLeft, active } }
     * 验收脚本据此断言「buff 是 CD 触发、冷却期自动释放」。 */
    getSkillBuffs: () => getBuffState(),
    /* v4.1.1 诊断口: 抖动取证 —— managed=true 且 pumpRuns 增长 = 双泵实锤 */
    __setSpeedMultForTest: (m, dur) => window.BattleAPI.setSpeedMult(m, dur),
    /* 主游戏注入玩家三围(境界+装备汇总后的面板值)
     * 注意: 必须同步进 p.atk / p.maxHp —— 战斗逻辑读的是 player 身上的字段,
     * 只更新 PST 会导致"面板数字涨了、打出去还是建号那把剑"(v2.5 回归修复)。 */
    __glDiag: () => ({ managed: _managed, rafOn: _rafOn, pumpRuns: _pumpRuns, paused: G.paused, gl: window.BattleGL ? window.BattleGL.diag : null }),
    /* v4.4 诊断口: 程序化行走自检 —— 列出每只骨骼怪的归一化动画名、是否自带真 walk、
     * 以及检测到的腿链; 以及当前场上每只怪的驱动状态。验收脚本据此断言:
     * ① 有真 walk 的怪(ratty) isRealWalk=true 且不被程序化驱动;
     * ② 其余有腿的怪 hasRealWalk=false 且移动时 __walkT 递增。 */
    __walkDiag: () => {
      const bones = {};
      for (const k in BONES) {
        const it = BONES[k]; if (!it) continue;
        const an = it.anims || {};
        bones[k] = { ready: !!it.ready, idle: an.idle || null, walk: an.walk || null,
                     isRealWalk: !!(an.walk && an.walk !== an.idle) };
      }      const live = (G.enemies || []).filter(e => e.alive && e.armature).map(e => ({
        slug: e.boneSlug, moving: !!e.moving, legs: (e.__legs || []).length,
        legNames: (e.__legs || []).map(l => l.names.join('>')),
        walkT: e.__walkT || 0,
        driving: !!(e.__legs && e.__legs.length && e.moving && e.hurtT <= 0 && e.anim <= 0
                    && !(BONES[e.boneSlug] && BONES[e.boneSlug].anims
                         && BONES[e.boneSlug].anims.walk
                         && BONES[e.boneSlug].anims.walk !== BONES[e.boneSlug].anims.idle))
      }));
      return { bones, live };
    },
    /* v4.5 诊断口: 远程/近战分类总览 —— 按素材 has_skill 给 79 只骨骼怪分档。
     * 返回 { ranged:[], melee:[] } 便于核对"哪些怪被定义为远程怪"。 */
    __roleDiag: () => {
      const ranged = [], melee = [];
      for (const slug in BONE_IDX) {
        const cfg = BONE_IDX[slug] || {};
        (cfg.has_skill ? ranged : melee).push({ slug, tier: cfg.tier, anims: cfg.anims });
      }
      const live = (G.enemies || []).filter(e => e.alive).map(e => ({
        name: e.name, type: e.type, slug: e.boneSlug || null, role: e.role,
        atkRange: e.atkRange, tier: e.tier
      }));
      return { rangedCount: ranged.length, meleeCount: melee.length, ranged, melee, live,
               hand: Object.entries(BC.enemies).map(([k, d]) => ({ key:k, name:d.name, role:d.role, atkRange:d.atkRange })) };
    },
    /* 验收用：直接设定倍速（跳过宠物 proc），让 A/B 对照可复现。传 1 即清除加速。 */

  /* v8.0 怪物包诊断口: 定位"一只怪都不出"这类问题 —— 一眼看清
     *   当前 lv / 该用哪个池 / 池里 13 个 slug / 哪些已请求 / 哪些已就绪。
     * 排查口诀: 若"该加载的 13 个"里有 slug 不在"已请求"中 → 加载范围错(loadBones 的池取错);
     *           若"已请求"但长期不在"已就绪" → 是资源 404 / 解析失败, 与刷怪逻辑无关。 */
    boneDiag: () => {
      const st = v6Progress();
      const wanted = [];
      for (let k = 0; k < 12; k++) wanted.push(NS_STAGE.mobFor(st.stage + k));
      const uniq = [...new Set(wanted)].filter(Boolean);
      const requested = Object.keys(BONES);
      const ready = requested.filter(s => BONES[s] && BONES[s].ready);
      return {
        stage: st.stage,
        curSlug: NS_STAGE.mobFor(st.stage),
        wanted: uniq,
        requested,
        ready,
        missing: uniq.filter(s => !BONES[s]),           /* 要刷却没请求加载 → 加载逻辑漏了 */
        loading: uniq.filter(s => BONES[s] && !BONES[s].ready), /* 请求了但没就绪 → 资源问题 */
        spawned: G.spawned,
      };
    },
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
    respawnArena: () => respawnArena(),
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
    return { x:0,y:laneOff(MID_LANE), lane:MID_LANE, hp:PST.hp,maxHp:PST.hp, atk:PST.atk,aspd:BC.playerAspd, atkRange:BC.playerAtkRange, atkT:Math.random()*0.4, anim:0,hurtT:0, walkT:Math.random()*6.28, moving:1, alive:true, animFrame:0, animTimer:0, attackAnim:false, attackTarget:null, hit1:false, hit2:false, hit3:false, sanlianTriggered:false, atkBuff:0, atkBuffTimer:0, skillAnim:false, skillFrame:0, skillTimer:0, skillHit:false, skillCooldown:0, skillTarget:null };
  }
  /* 怪物成长系统: 三围随玩家境界 lv 线性成长(怪只吃境界, 不吃装备 → 换装备=变快)。
   * v3.9 三维系统: 三围 = 境界基准 × 怪种hpK/atkK/defK × 波次tier倍率 ——
   * 怪包统一池, 每个境界都会刷到全怪种; 同一只怪随境界+波次档位三维缩放。 */
  /* ⚠️ v6: 怪物强度不再来自「妖潮 tier」(本波第几只 → T1..T10 分段), 也不再来自
   * 旧手填表 MOB_POOLS —— 而是由 v6 的【当前关卡】唯一决定, 走 00-stage.js 的公式:
   *   H(s) = H₀ · g^(s-1)   (g=1.006, H₀=10, s ∈ [1,30000])
   * 怪种按 80 个骨骼资源循环轮换(mobFor)。这样"推关"才是唯一的难度轴。 */
  function v6Progress() {
    try {
      const V = (typeof window !== 'undefined') && window.V6;
      if (!V || !V.state) return { realm: 0, stage: 1 };
      const st = V.state();
      return { realm: Math.max(0, st.realm || 0), stage: Math.max(1, st.stage || 1) };
    } catch (e) { return { realm: 0, stage: 1 }; }
  }
  /* v3.9.2 全量接入: makeEnemy 拆两层 —— makeEnemyFrom(合成def) 为实, BC.enemies 手配怪与
   * index.json 骨骼池怪(档位模板数值)共用同一条构造路径。 */
  function makeEnemyFrom(def, tierOverride, key) {
    const elite = Math.random() < DROP.eliteChance;
    /* ⚠️ v6: 怪数值基准改为【当前关卡】(00-stage.js 的 H(s)/A(s)), 不再是
     * (60+26*lv) 这套按战斗层 lv 的旧公式 —— 那套的 lv 现在恒为 1, 完全失效。
     * def.hpK/atkK/defK 仍作为怪种间的相对偏置系数(手配怪/BOSS 用)。 */
    const proto = stageEnemyProto();
    let hp  = Math.round(proto.entry.hp  * (def.hpK  || 1));
    let atk = Math.round(proto.entry.atk * (def.atkK || 1));
    const dfn = Math.round(proto.entry.def * (def.defK || 1));
    if (elite) { hp = Math.round(hp*DROP.eliteHp); atk = Math.round(atk*1.2); }
    /* ⚠️ v7.10（勿回退）：敌人一律生成在【玩家所在的同一条轴】上。
     * 原来是 Math.random() 连续随机纵深 —— 每只怪换一个高度，玩家就得
     * 上下追着跑（"怪生成位置和玩家生成位置放一个轴上"这条反馈的出处）。
     * 现在单轴对撞：开火门限 e.lane === p.lane 天然满足，
     * 表现变成纯粹的左右对撞，站位稳定、不再自己给自己添堵。 */
    const lane = MID_LANE;
    /* v4.6 全局减速旋钮: window.__enemySpeedMul(默认 1) 统一作用于所有怪的移速 ——
     * 走这条构造路径的怪(手配 + 骨骼池)全都会吃到, 调试时改一个数即可。 */
    const spdMul = (typeof window !== 'undefined' && window.__enemySpeedMul) || 1;
    const r = { type:key||def.bone||'bone',name:def.name,role:def.role, elite, lane, y:laneOff(lane), x:0, hp,maxHp:hp, atk, def:dfn,
      tier:tierOverride||def.tier||1, drawH:def.drawH||0, hpBarW:def.hpBarW||0,
      /* v6.5 怪物四维面板实例化: 模板下发(骨骼怪 per-tier / BOSS 档), 手配怪缺省 0; 精英×1.3 */
      crit: Math.min(100, Math.round((def.crit||0)*(elite?1.3:1))),
      dodge: Math.min(60, Math.round((def.dodge||0)*(elite?1.3:1)*10)/10),
      pen: Math.min(90, Math.round((def.pen||0)*(elite?1.3:1))),
      critRes: Math.min(90, Math.round((def.critRes||0)*(elite?1.3:1))),
      atkRange:def.atkRange,
      /* ⚠️ v7.10（勿回退）：怪物移速基准改为【玩家的 BC.playerSpeed】同一个数。
       * 旧表里各怪种自带 120/76/88 —— 是玩家的 2~3 倍，玩家还没走到跟前就被贴脸，
       * 根本不存在"边跑边打"的余地。现在同轴同速，战斗是纯正的左右对撞。
       * 保留 ±6% 个体差异只为避免所有怪动作像复制粘贴，且上限压在 1.0 以下 ——
       * 任何情况下怪都不会反过来比玩家快。
       * 远程怪不必靠"走得慢"拉开梯队：它们的 atkRange 本就更远，stopX 站得更远。 */
      speed: BC.playerSpeed * (0.94 + Math.random() * 0.06) * (elite ? 0.88 : 1) * spdMul,
      color:def.color,
      atkT:Math.random()*0.6, anim:0,hurtT:0, alive:true,dying:0, animFrame:0, animTimer:0, moving:false };
    /* 骨骼怪: 工厂就绪时建一只独立骨架实例(每只怪动画独立推进) */
    if (def.bone) {
      const B = BONES[def.bone];
      if (B && B.ready) {
        try {
          r.armature = B.factory.buildArmature(B.arm);
          r.boneSlug = def.bone; r.boneAnim = 'walk';
          /* v4.4: 建实例时识别一次腿链, 并缓存各腿骨的绑定姿势 offset ——
           * 后续每帧 walk 驱动都从这份绑定姿势出发叠加增量。
           * detectLegs 已按左右排好并分配交替相位(对角步态)。 */
          const legs = detectLegs(r.armature);
          r.__legs = legs.map(leg => {
            const bs = leg.names.map(n => r.armature.getBone(n)).filter(Boolean);
            bs.forEach(b => { if (b.__baseR === undefined) b.__baseR = b.offset.rotation; });
            return { names: leg.names, bones: bs, phaseOff: leg.phaseOff || 0,
                     /* 长链(4~5 节)摆幅收一点, 避免膝盖过弯穿模 */
                     amp: bs.length >= 4 ? 0.85 : 1.0 };
          }).filter(l => l.bones.length >= 1);
          if (r.__legs.length) dbgWalk((def.bone || '') + ' 腿(' + r.__legs.length + '): ' + r.__legs.map(l => l.names.join('>')).join(' | '));
        }
        catch (err) { console.error('[battle] buildArmature 失败', def.bone, err); }
      }
    }
    /* v4.7 体型感知攻距: 骨架已建好, 现在能拿到真实 AABB 了 —— 按体型重算 atkRange,
     * 让大怪自动站远(不穿模挡玩家), 小怪保持贴身。详见 bodyRange 的说明。
     * 非骨骼怪(纯序列帧)没有 armature, 用自己 sprite 帧的宽高比按同一公式算。
     * v4.8 技能怪优先: 29 只技能怪的攻距改为实测值(见 SK_RANGE), 只用体感兜底不覆盖。
     * v6.0 同时缓存体型(半宽), 供 canHit()/enemyHalfW() 做"边缘到边缘"判定 ——
     * 之前只存了 atkRange(混合口径), 判定时拿不到"怪身体多宽", 才会互相够不着。 */
    const sk = SK_OF[r.type];
    const dh0 = r.drawH || def.drawH || 84;
    if (sk && SK_RANGE[r.type]) {
      r.atkRange = SK_RANGE[r.type];
      r.skill = sk;
      r.__skillRange = true;
    } else if (def.bone && r.armature) {
      const bb = armAABB(r.armature);
      if (bb) {
        r.atkRange = bodyRange(bb, dh0, def.role === 'ranged');
        r.__bodyRange = true;
      }
    } else if (!def.bone) {
      /* 序列帧怪: slime / water —— 各自帧的宽高比即体型比(BOSS已移除序列帧兜底, 强制用骨骼giant_kitsune) */
      const sp = (key === 'slime') ? SLIME_SPRITE : (key === 'water') ? WATER_SPRITE : null;
      if (sp && sp.fw > 0 && sp.fh > 0) {
        const dh = Math.min((CH || 306) * 0.5, def.drawH || 84);
        r.atkRange = bodyRangeWH(sp.fw / sp.fh, dh, def.role === 'ranged');
        r.__bodyRange = true;
      }
    }
    /* v6.0 缓存体型, 供边缘判定用。骨骼怪取 AABB 宽高比, 序列帧怪取精灵宽高比。 */
    if (r.armature) {
      const bb2 = armAABB(r.armature);
      if (bb2 && bb2.height > 0) r.__spriteRatio = bb2.width / bb2.height;
    } else {
      const sp2 = (key === 'slime') ? SLIME_SPRITE : (key === 'water') ? WATER_SPRITE : null;
      if (sp2 && sp2.fh > 0) r.__spriteRatio = sp2.fw / sp2.fh;
    }
    r.__halfW = 0;    /* 置 0 让 enemyHalfW() 首次调用时惰性算出真实值 */
    return r;
  }
  function makeEnemy(type, tierOverride) {
    return makeEnemyFrom(BC.enemies[type] || BC.enemies.slime, tierOverride, type);
  }
  /* ══════════ v4.7 体型感知攻击距离（近战怪不再穿模挡住玩家）══════════
   * 问题: 怪的统一攻距只有 34(近战)/52(远程), 但怪的实际渲染宽度是 130~233px ——
   *   大怪的 aabb 含武器/尾巴/翅膀的全展开范围, 停在 34px 处时左边缘跑到
   *   玩家身后 80+px, 整只糊在玩家身上, 玩家被挡得看不见。
   *
   * 为什么不能"统一调大攻距": 79 只怪体型跨度极大(宽高比 0.57~2.64), 实测要让
   *   每只怪的躯干都不越界, 需要的攻距是 78~181px —— 没有任何一个固定值能覆盖,
   *   填最大则小怪退太远(近战打击感消失), 填中间则大怪照样穿模。
   *
   * 方案: 攻距按每只怪的**实际体型**算, 而不是填死一个数 ——
   *   攻距 = 玩家半宽 + 怪躯干半宽
   * 其中"躯干"取 aabb 宽度的 TORSO_FRAC ——aabb 是全展开包围盒, 含挥舞的武器/
   *   尾巴/翅膀, 按 100% 算会把怪推得过远; 取 55% 约等于躯干, 允许四肢和武器与
   *   玩家部分重叠(这反而是打击感), 但躯干主体不会盖住玩家。
   *
   * 小怪体型小 → 攻距自然小 → 照旧贴身互殴; 大怪体型大 → 攻距自动拉开 → 不挡人。
   */
  const TORSO_FRAC = 0.45;    /* aabb 宽度中视为"躯干"的比例 —— 见下方"为什么 0.45" */
  const RANGE_FLOOR = 34;     /* 攻距下限: 再小的怪也不低于原近战攻距 */
  const RANGE_CEIL  = 130;    /* 攻距上限: 避免夸张体型把怪推到画面外 */
  /* 为什么 TORSO_FRAC = 0.45(而不是 1.0 或 0.55):
   *   aabb 是"全展开包围盒"—— 含挥舞的武器、甩开的尾巴、张开的翅膀。
   *   按 1.0 算, 79 只怪的攻距中位会到 126px, 小怪(如鼠妖, aabb 宽高比 2.67
   *   全因尾巴)会被推到 126px 外, 明明是近战却像在隔空挥爪, 手感全无。
   *   按 0.55 算, 仍有相当一批怪站在 110px 开外。
   *   取 0.45: 允许四肢/武器/尾巴与玩家有视觉交叠(这本来就有打击感),
   *   只保证"身体主干不糊在玩家脸上"。经算, 79 只怪躯干左缘均不越过玩家右缘。
   *   (公式: 攻距 = 玩家半宽 + aabb宽×0.45/2, 躯干左缘 = 攻距 - 躯干半宽 = 玩家右缘, 恒等) */
  /* v6.0 playerHalfW() 统一定义在下方"战斗距离"区(原此处副本已删)。
   * 取 72 而非渲染实际用的 80，是为了让 stopPx/SK_RANGE 两张权威表继续对得上。 */
  /* 怪按体型算攻距: 传入骨架 AABB 与本次实际渲染高 */
  function torsoFrac() {
    const v = (typeof window !== 'undefined' && window.__torsoFrac);
    return (typeof v === 'number' && v > 0 && v <= 1.5) ? v : TORSO_FRAC;
  }
  function bodyRange(aabb, drawH, isRanged) {
    let torsoHalf = 0;
    if (aabb && aabb.width > 0 && aabb.height > 0) {
      const w = drawH * (aabb.width / aabb.height) * torsoFrac();
      torsoHalf = w / 2;
    }
    /* 远程怪本来就要站远一点, 在体型结果之上再留一段射程余量 */
    const extra = isRanged ? 18 : 0;
    const r = playerHalfW() + torsoHalf + extra;
    return Math.round(Math.max(RANGE_FLOOR, Math.min(RANGE_CEIL, r)));
  }
  /* v4.7 同上, 但直接给像素宽高比 —— 序列帧怪(没骨架)用自己 sprite 帧的 fw/fh 调用 */
  function bodyRangeWH(ratio, drawH, isRanged) {
    const w = drawH * ratio * torsoFrac();
    const extra = isRanged ? 18 : 0;
    const r = playerHalfW() + w / 2 + extra;
    return Math.round(Math.max(RANGE_FLOOR, Math.min(RANGE_CEIL, r)));
  }
  /* 从已建好的 armature 取 aabb(与渲染同源, 最准); 取不到返回 null */
  function armAABB(arm) {
    try {
      const bb = window.BattleGL.armatureAABB(arm);
      if (bb && bb.maxX > bb.minX) return { width: bb.maxX - bb.minX, height: bb.maxY - bb.minY };
    } catch (err) {}
    return null;
  }

  /* v3.9.2 骨骼池怪: 数值按档位模板(同档同模板, 个体差异靠波次倍率), 名字暂用 slug 标题化(后续汉化) */
  function makeBoneEnemy(slug, tierOverride) {
    const t = tierOverride || 1;
    const tpl = BC.boneTpl[t] || BC.boneTpl[1];
    const cfg = BONE_IDX[slug] || {};
    const dh = cfg.drawH || 84;
    /* v4.5 远程/近战分类: 素材 index.json 的 has_skill 一直标着但从没被代码读过 ——
     * 79 只骨骼怪不论有无技能一律 role:'melee', 24 只自带技能的远程怪特征被丢掉。
     * 现按 has_skill 判定: 有技能 = 远程(ranged), 无技能 = 近战(melee)。
     * 远程怪的三维差异(只给参数, 不改战斗流程):
     *   - atkRange 拉长(34→52): 隔空输出, 玩家得贴身才够得着;
     *   - speed 收窄(×0.8): 站得远, 压迫感靠射程而非速度。 */
    /* v4.8 远程/近战分类: 改用 SK_OF 名单(29 只, 见映射表)判定, 不再读素材的 has_skill。
     * 原因: has_skill 有两处标反 —— goblin_machine_gun / animated_drill_dwarf 手里有枪
     * 却标 false, unicorn 是独角冲撞却标 true; 而真正的远程判定要看骨架里有没有施法器官。
     * 名单内 = 远程(站位由 SK_RANGE 实测决定), 名单外 = 近战。 */
    const skKind = SK_OF[slug];
    const hasSkill = !!skKind;
    const role = hasSkill ? 'ranged' : 'melee';
    /* v4.7 atkRange 先给个占位值, 真正的值在骨架建好后按体型修正(见 makeEnemyFrom
     * 末尾的 bodyRange 调用)——因为体型要从实例的 AABB 量, 构造 def 时还没有实例。 */
    const atkRange = hasSkill ? 52 : 34;
    const speed = Math.round(tpl.speed * (hasSkill ? 0.8 : 1));
    const def = { name: slug.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()),
      role, atkRange, speed, hpK:tpl.hpK, atkK:tpl.atkK, defK:tpl.defK,
      crit:tpl.crit||0, dodge:tpl.dodge||0, pen:tpl.pen||0, critRes:tpl.critRes||0,   /* v6.5 四维面板 */
      hasSkill, color:'#9aa8b8', bone:slug, tier:t, drawH:dh, hpBarW:Math.max(24, Math.round(dh*0.55)) };
    return makeEnemyFrom(def, tierOverride);
  }
  /* ══════════ v7.0 正规怪物池: 每大境界 12 种怪 × 各10只(顺序分波, 非随机) + 1 BOSS ══════════
   * 数值全部来自 00-pure.js 的 MOB_POOLS 手填表(运行时零公式, 调平衡直接改表)。
   * 波次 = 已刷序号: 前10只波1怪, 打完10只换下一种, 曲线逐步上升。
   * 锚定: 本境界毕业玩家(装备不跨境界), 120s 杀满 120 只, BOSS 30s 限时击杀。 */
  /* ⚠️ v6: 旧的 poolFor(lv) 按 PST.lv 选 12 张手填表已废弃 ——
   * 怪数值一律由当前关卡 s 走 00-stage.js 公式生成, 与推关进度严格同步。 */
  function stageEnemyProto() {
    const s = v6Progress().stage;
    const info = NS_STAGE.stageInfo(s);
    const slug = info.slug;
    const cfg = BONE_IDX[slug] || {};
    const dh = cfg.drawH || 84;
    const sk = SK_OF[slug];
    /* 大数 → Number: 00-stage 的血量在第 30000 关可达 1e77, 但战斗层是 Number 域。
     * toNumber 在大数超 Number 上限时返回 Infinity —— 这里夹到 1e308 以内,
     * 与"玩家打不过就推不动"的推关设计一致(玩家面板同样走 toNumber)。 */
    let hp = NS_NUM.toNumber(info.hp);
    let atk = NS_NUM.toNumber(info.atk);
    if (!isFinite(hp) || hp <= 0) hp = 1e300;
    if (!isFinite(atk) || atk <= 0) atk = 1e300;
    return { entry: { slug, hp, atk, def: Math.max(0, Math.round(atk * 0.12)),
                      crit: 0, dodge: 0, pen: 0, critRes: 0 },
             def: { name: slug.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()),
                    role: sk ? 'ranged' : 'melee', atkRange: sk ? 52 : 34, speed: 120,
                    hpK:1, atkK:1, defK:1, crit:0, dodge:0, pen:0, critRes:0,
                    hasSkill: !!sk, color:'#9aa8b8', bone: slug, tier:1,
                    drawH: dh, hpBarW: Math.max(24, Math.round(dh*0.55)) } };
  }
  /* 兼容旧调用签名(池表怪): 仍按 entry 覆盖数值 */
  function makePoolEnemy(entry, isBoss) {
    const cfg = BONE_IDX[entry.slug] || {};
    const dh = cfg.drawH || 84;
    const sk = SK_OF[entry.slug];
    const def = { name: entry.slug.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()),
      role: sk ? 'ranged' : 'melee', atkRange: sk ? 52 : 34, speed: isBoss ? 90 : 120,
      hpK:1, atkK:1, defK:1, crit:entry.crit||0, dodge:entry.dodge||0, pen:entry.pen||0, critRes:entry.critRes||0,
      hasSkill: !!sk, color:'#9aa8b8', bone:entry.slug, tier:1, drawH:dh, hpBarW:Math.max(24, Math.round(dh*0.55)) };
    const e = makeEnemyFrom(def, 1, isBoss ? 'boss' : entry.slug);
    e.hp = e.maxHp = entry.hp;
    e.atk = entry.atk;
    e.def = entry.def;
    e.elite = false;
    return e;
  }
  /* ⚠️ v6 无尽刷怪: 没有怪池游标、没有刷完即停、没有 BOSS 出场条件。
   * 每次调用就生一只 —— 数值完全由当前关卡 s 决定(00-stage.js), 与推关进度严格同步。 */
  function spawnWave() {
    if (G.enemies.filter(x => x.alive && x.dying <= 0).length >= capAlive()) return null;
    const proto = stageEnemyProto();
    const slug = proto.entry.slug;
    if (!(BONES[slug] && BONES[slug].ready)) {
      /* 骨骼没就绪就一直不刷 —— 必须能报出来, 否则表现就是"一只怪都不出"却毫无线索。
       * 卡 8s 以上才告警一次, 避免刷屏。 */
      if (!BONES[slug]) {
        const now = performance.now();
        if (!G._boneMissT || now - G._boneMissT > 8000) {
          G._boneMissT = now;
          console.warn('[battle] 怪物包未加载: ' + slug + ' (stage=' + v6Progress().stage + ')');
        }
      }
      return null;
    }
    const e = makePoolEnemy(proto.entry, false);
    /* 生成新怪 = 开新一关 → 先把擂台清干净（见 resetStage 注释）。
     * 位置必须在 makePoolEnemy 之后：新怪此时还不在 G.enemies 里，不会被一起清掉。 */
    resetStage();
    /* ⚠️ v7.9 擂台化（勿回退）—— 生成点统一为【擂台右侧可见处】enemySpawnX()。
     * 历史沿革：v7.8 曾分「第一只生成在玩家前方 30%、其余生成在屏外 40px」两种，
     *   屏外那只因为看不见，玩家要傻等它走进来；并且两种算法让节奏不统一。
     *   现在一关 = 一屏擂台，怪必须在屏内右侧出场才有「对面来了一只」的读秒感。
     *   e.x 直接给屏幕坐标 —— camX 已锁 0（相机不跟随），worldToScreen 是恒等式。 */
    e.x = enemySpawnX();
    G.enemies.push(e);
    G.spawned = (G.spawned || 0) + 1;
    return e;
  }

  /**
   * 进入下一关：把擂台重置成开局状态。
   *
   * ══════════════════════════════════════════════════════════════════
   *  ⚠️ v7.9 核心改动（用户明确要求，勿回退）
   * ══════════════════════════════════════════════════════════════════
   *  旧版是「一条血打到底」：血量只在死亡/复活时回满，中间连打十几只怪，
   *  攒下来的伤害必然把玩家磨死 —— 表现为「一条血根本打不了几关」。
   *  现在每关都重置：
   *    · 场上残留全部清掉（活着的怪 / 伤害数字 / 技能特效 / 敌方弹道）
   *    · 玩家回到擂台左侧出生点，HP 回满
   *    · 宠物同步拉回出生点附近，不做「跨屏飞行」
   *
   *  ⚠️ 掉落物【不清】：drops 里正飞向 HUD 的灵石/装备是玩家已到手的收益，
   *     清掉会直接吞钱。它们有自己的生命周期（1.5s 展示 + 飞向顶栏），清场不必管。
   */
  function resetStage() {
    /* 敌人：连同 PIXI 实例一起回收，否则只是从数组里摘掉会留在画面上 */
    for (const e of G.enemies) {
      e.alive = false; e.dying = 0;
      if (e.armature) { try { despawnEnemy(e); } catch (err) {} }
    }
    G.enemies.length = 0;
    G.bossActive = false;
    G.spawned = 0;
    /* 特效层：上一只的技能弹道/伤害数字不能飘到下一关 */
    if (G.fx) G.fx.length = 0;
    if (G.dmg) G.dmg.length = 0;
    SK_LIVE.length = 0;   /* 同步清掉技能弹道活引用，否则 G.fx 清空后 SK_LIVE 成悬空 */
    /* 玩家：回出生点 + 回满血 + 复位到中间纵深 */
    if (G.player) {
      G.player.x = playerSpawnX();
      G.player.lane = MID_LANE;
      G.player.y = laneOff(MID_LANE);
      G.player.hp = G.player.maxHp;
      G.player.hurtT = 0;
      G.player.attackAnim = false; G.player.skillAnim = false;
      G.player.attackTarget = null; G.player.skillTarget = null;
      G.player.atkT = 0;
      /* 宠物跟随位同一处理：否则它们要从上一关的击杀点一路插值飞回来 */
      for (const pet of G.pets) if (pet && pet.alive) pet.x = G.player.x + (pet.offsetX || -30);
    }
  }
  /* ---------- 数值伤害 v7.1: 量纲平衡式 dmg = atk²/(atk+有效防御), 破甲按百分比削减防御 ----------
   * 旧式 100/(100+eff) 分母含常数 100, 怪 def 随境界 ×4 后减伤坍缩到 ≈0(高境打不动);
   * 新式只看 def/atk 比例: def=0.5atk→×67%, def=atk→×50%, def=2atk→×33% —— 与怪物毛坯
   * (def ≈ atk 的 12%~42%)的设计意图一致, 全境界物理意义恒定。 */
  function calcDmg(atk, mult, def, pen) {
    const a = Math.max(1, atk||0), eff = Math.max(0, (def||0) * (1 - Math.min(90, pen||0)/100));
    return Math.max(1, Math.round(a * mult * (a/(a+eff))));
  }
  /* 玩家暴击/会心判定: 读装备词条(PST.crit 暴击率 / PST.critB 会心率 / PST.critD 爆伤);
   * kind=2 暴击(×2)、kind=1 会心(×1.5)、mult 含爆伤增幅; bonus 为技能临时加的暴击率 */
  function playerCritRoll(bonus, target) {
    const res = (target && target.critRes) || 0;   /* v6.5 怪物暴抗: 削减玩家暴击/会心率 */
    let kind = 0;
    if (Math.random()*100 < Math.max(0, (PST.crit || 0) + (bonus || 0) - res)) kind = 2;
    else if (Math.random()*100 < Math.max(0, (PST.critB || 0) - res)) kind = 1;
    const cmul = kind === 2 ? 2 : kind === 1 ? 1.5 : 1;
    return { kind, cmul, crit: kind > 0, mult: kind ? cmul * (1 + (PST.critD || 0)/100) : 1 };
  }
  /* ---------- 身法 Buff（疾风步 / 缩地成寸）：独立 CD 计时，不再由攻击触发 ----------
   * ⚠️ v6 契约变更（用户明确要求）：
   *   「加 Buff 类的，Buff 类的要搞 CD，不能攻击触发。」
   *   旧版这两个技能挂在 playerStrike 里按 chance 概率 proc —— 那是"攻击触发族"，
   *   与破甲击/斩杀同类。v6 把 buff 类彻底拆出来：每门身法各有一条独立时间轴，
   *   CD 一到自动释放，与玩家是否出手、是否命中、是否被闪避【完全无关】。
   *   这样斩掉了旧版最恶心的两个 bug（一击必杀时不触发、高档把低档盖掉时长归零）。
   *
   * 模型（每帧推进一步）：
   *   cdLeft -= dt
   *   durLeft -= dt
   *   cdLeft <= 0 → 释放：durLeft = dur, cdLeft = cd
   * 生效条件：durLeft > 0。多门身法【可同时生效】，闪避相加、攻速取乘。
   *
   * ⚠️ 身法【不再改 G.speedMult】—— 游戏倍速由 Buff 宠物提供（上限 3.5，见设计文档 §1 #16）。
   *    旧版疾风步 mult=2.5 / 缩地 mult=3.5 是历史遗留，与宠物倍速重复授予，必须删掉。 */

  /** 释放一次身法 buff（写时间轴 + 播报 + 特效 + 刷新 HUD） */
  function fireSkillBuff(id) {
    const d = skVal(id);
    if (!d || d.kind !== 'buff') return null;
    const st = G.skillBuff[id] || (G.skillBuff[id] = { cdLeft: 0, durLeft: 0 });
    st.durLeft = d.dur || 0;
    st.cdLeft  = d.cd  || 0;
    skillCall(d.name);
    if (G.player) {
      G.pushFx({ kind:'speedBurst', x:G.player.x, y:G.player.y-20,
                 color: id === 'suodi' ? '#a0d8ff' : '#80ffc0', t:0, dur:0.5 });
    }
    updateHUD();
    return id;
  }

  /** 推进所有 buff 类身法的时间轴（由战斗主循环按【原始 dt】调用，
   *  绝不能用 sdt —— 否则倍速会反过来把 CD 也加速，形成正反馈。 */
  function tickSkillBuffs(dt) {
    const api = window.SkillAPI;
    if (!api || !api.defs) return;
    for (const d of api.defs) {
      if (d.kind !== 'buff') continue;
      const st = G.skillBuff[d.id] || (G.skillBuff[d.id] = { cdLeft: d.cd || 0, durLeft: 0 });
      if (st.durLeft > 0) st.durLeft = Math.max(0, st.durLeft - dt);
      if (st.cdLeft  > 0) st.cdLeft  = Math.max(0, st.cdLeft  - dt);
      if (st.cdLeft <= 0) fireSkillBuff(d.id);
    }
  }

  /** 当前生效的身法增益汇总：闪避相加（同为减伤维度），攻速相乘（倍率维度） */
  function buffStats() {
    let dodge = 0, haste = 1, any = false;
    const api = window.SkillAPI;
    if (api && api.defs) {
      for (const d of api.defs) {
        if (d.kind !== 'buff') continue;
        const st = G.skillBuff[d.id];
        if (!st || st.durLeft <= 0) continue;
        dodge += d.dodge || 0;
        haste *= (d.hasted || 1);
        any = true;
      }
    }
    return { dodge, haste, any };
  }

  /** 供 HUD / 验收脚本读的实时快照 */
  function getBuffState() {
    const out = {};
    const api = window.SkillAPI;
    if (api && api.defs) {
      for (const d of api.defs) {
        if (d.kind !== 'buff') continue;
        const st = G.skillBuff[d.id] || { cdLeft: 0, durLeft: 0 };
        out[d.id] = { name: d.name, cd: d.cd, dur: d.dur,
                      cdLeft: st.cdLeft, durLeft: st.durLeft, active: st.durLeft > 0 };
      }
    }
    return out;
  }

  /* ---------- 击杀结算: 灵石 + (装备由主游戏 roll) + 技能经验 + 追猎/加速 ---------- */
  function onKill(e) {
    const isBoss = e.type === 'boss';
    if (isBoss) G.bossActive = false;
    updateHUD();
    /* ⚠️ v6 无尽刷怪: 击杀即刷新 —— 杀一只立即补一只(从右边生成), 下界无尽头。
     * 同屏上限由 spawnWave 内的 capAlive 约束。 */
    spawnWave();
    const mul = e.elite ? DROP.eliteMul : 1;
    const jitter = 1 - DROP.spiritRand + Math.random()*DROP.spiritRand*2;
    /* v2.5 BOSS 专属产出: 灵石在精英倍率上再 ×8 */
    const sp = Math.max(1, Math.round((DROP.spiritBase + DROP.spiritPerLv*(PST.lv||1)) * jitter * mul * (isBoss ? 8 : 1)));
    /* 黑屏挂机统计 */
    if (DIMSTAT.on) {
      DIMSTAT.battles++; DIMSTAT.win++; DIMSTAT.spirit += sp;
      /* 黑屏: 跳过掉落动画, 灵石直接入账, 装备直接入包 */
      G.spirit += sp;
      try { if (window.BattleAPI.onDrop) window.BattleAPI.onDrop({ spirit: sp, elite: !!e.elite, enemy: e.name }); } catch (err) {}
      try {
        const eq = (window.BattleAPI && window.BattleAPI.requestEquipDrop)
          ? window.BattleAPI.requestEquipDrop({ elite: !!e.elite, boss: isBoss, enemy: e.name }) : null;
        if (eq) {
          DIMSTAT.loot.push({ n: eq.name || eq.n || '装备', q: eq.q || 0, qn: (eq.qn || ''), slot: (eq.slot || '') });
          if (window.BattleAPI.onDrop) window.BattleAPI.onDrop({ equip: eq, enemy: e.name });
        }
      } catch (err) {}
    } else {
      spawnSpiritDrop(e, sp, e.elite);
      try {
        const eq = (window.BattleAPI && window.BattleAPI.requestEquipDrop)
          ? window.BattleAPI.requestEquipDrop({ elite: !!e.elite, boss: isBoss, enemy: e.name }) : null;
        if (eq) spawnEquipDrop(e, eq);
      } catch (err) {}
    }
 // 每杀全体技能+2; BOSS 击杀全体+30
    const zl = skVal('zhuilie');       // 追猎: 击杀后立刻再出手一次, 衔尾一击暴击率大增
    if (zl && Math.random()*100 < zl.chance) {
 G.extraStrike = true; G.nextStrikeCrit = zl.crit || 0;
      skillCall('追猎');
    }
  }
  /* ---------- 掉落物: 灵石/装备落在地板; 灵石飞向顶部统计区; 装备由飞行宠物拾取 ---------- */
  const QUALITY_COLOR = ['#aab2c0', '#6b9df5', '#3fc9a2', '#e0b45a', '#c08af0', '#ff5257'];
  function dropRarityColor(q) { return QUALITY_COLOR[Math.max(0, Math.min(5, q | 0))] || '#aab2c0'; }
  function hudTarget() {                          // 灵石飞入锚点 = 战斗区左下角资源栏的数字位置(canvas 局部坐标)
    /* ⚠️ v7.5 (勿回退): 资源栏已从顶部统计区迁到战斗区左下角, 锚点随之改为 #spirit(总灵石)。
     * v7.10: 旧的 #battleSpirit 隐藏锚点节点已随 .kills 容器一并删除,
     *        只认 #spirit 一个目标, 不再留双写时代的 fallback。 */
    const el = document.getElementById('spirit');
    if (el && cv) { const r = el.getBoundingClientRect(), c = cv.getBoundingClientRect(); return { x: r.left + r.width / 2 - c.left, y: r.top + r.height / 2 - c.top }; }
    return { x: CW * 0.5, y: 20 };
  }
  function spawnSpiritDrop(e, val, elite) {
    /* v6: 本场累计产出(统计用) */
    G.spiritGain = (G.spiritGain || 0) + (val || 0);   /* v6: 本场累计产出(统计用) */
    if (G.drops.filter(d => d.kind === 'spirit').length >= 14) {   // 过载: 直接入账, 跳过飞行动画
      G.spirit += val;
      try { if (window.BattleAPI.onDrop) window.BattleAPI.onDrop({ spirit: val, elite: !!elite, enemy: e.name }); } catch (err) {}
      return;
    }
    G.drops.push({ kind: 'spirit', wx: e.x, x: worldToScreen(e.x), y: floorY() + e.y - 12, gy: e.y, vy: -70,
      val, elite: !!elite, enemy: e.name, t: 0, flyAt: 1.0 + Math.random() * 0.8, phase: 'land' });
  }
  function spawnEquipDrop(e, eq) {
    /* v6.15: 装备掉落改成宝箱——掉落后先展示 1.5 秒, 宠物再飞来捡。
     * 宝箱图预加载一次, 所有掉落共享。 */

    if (!spawnEquipDrop._chestImg) {
      spawnEquipDrop._chestImg = new Image();
      spawnEquipDrop._chestImg.src = 'assets/chest.png';
    }
    G.drops.push({ kind: 'equip', wx: e.x, x: worldToScreen(e.x), y: floorY() + e.y - 14, gy: e.y, vy: -80,
      eq, img: spawnEquipDrop._chestImg, t: 0, t2: 0, scale: 0, phase: 'wait', claimed: false,
      showT: 1.5 });   /* v6.15: 落地后展示 1.5 秒宠物才来捡 */
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
          o.g2 = new PIXI.Graphics();          /* 品质色光环(在宝箱后面) */
          o.icon = new PIXI.Sprite();          /* v6.15: 宝箱图, 不再用圆形 mask */
          o.icon.anchor.set(0.5);
          o.body.addChild(o.g2);
          o.body.addChild(o.icon);
          o.c.addChild(o.body);
        }
        o.body.visible = true;
        /* v6.15: 宝箱贴地面(不浮动), 飞行中贴宠物 */
        o.body.y = -16 * sc;
        o.body.scale.set(sc);
        const rc = colorInt(dropRarityColor(d.eq.q));
        o.g2.clear();
        /* 品质色光圈: 半透明圆, 宝箱落地时脉冲 */
        const pulseR = 14 + Math.sin(d.t * 5) * 2;
        o.g2.beginFill(rc, 0.18);
        o.g2.drawCircle(0, 0, pulseR);
        o.g2.endFill();
        o.g2.lineStyle(1.5, rc, 0.6);
        o.g2.drawCircle(0, 0, pulseR);
        o.g2.lineStyle(0);
        if (d.img && d.img.complete && d.img.naturalWidth) {
          o.icon.visible = true;
          o.icon.texture = window.BattleGL.tex(d.img);
          o.icon.width = 28; o.icon.height = 28;
        } else {
          o.icon.visible = false;
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
    /* v6.5 怪物闪避: 玩家此段落空(不出伤害不消耗追猎), 高 tier 怪开始有 miss */
    if (Math.random()*100 < (target.dodge || 0)) {
      G.pushDmg({ x:target.x, y:target.y-30, val:'闪', crit:false, color:'#cfd8e3', t:0 });
      return;
    }
    /* ⚠️ v6: 身法 buff 已从本函数【整个移除】——它改由 tickSkillBuffs 按 CD 触发，
     * 与玩家是否出手、这一击是否命中/是否击杀目标完全无关。
     * 旧版在这里背靠背 roll('suodi')/roll('jifeng') 是"攻击触发"，已被用户明确否掉。 */
    /* v2.8 普攻单段: 主段(seg1)一次全额; 三连斩的 seg2/seg3 是同一轮攻击内的补刀,
     * 各按自己的节奏给倍率, 不再出现"两段各全额"把普攻 DPS 顶到技能之上 */
    let base = seg === 3 ? 1 : seg === 2 ? (0.5 + Math.random()*0.15) : (1.0 + Math.random()*0.25);
    let pen = PST.pen || 0;
    /* 破甲击: 这一击无视目标 Y% 防御 */
    const pj = skVal('pojia');
    if (pj && Math.random()*100 < pj.chance) {
      pen = Math.min(90, pen + pj.pen); skillCall('破甲击');
      G.pushFx({ kind:'hitSpark', x:target.x, y:target.y-20, color:'#ffd76b', t:0, dur:0.3 });
    }
    /* 斩杀: 目标残血(低于 X%)时, 这一击伤害翻倍 */
    const zs = skVal('zhansha');
    if (zs && target.hp / target.maxHp * 100 < zs.threshold) { base *= 2; skillCall('斩杀'); }
    /* 会心(×1.5) / 暴击(×2.0) / 爆伤增幅(critD%); 追猎的衔尾一击额外加暴击率 */
    const critBonus = G.nextStrikeCrit; G.nextStrikeCrit = 0;
    let kind = 0;
    if (seg === 3) {
      /* 三连斩第三段: 补刀必会心(至少×1.5) */
      kind = 1;
    } else if (Math.random()*100 < Math.max(0, (PST.crit || 0) + critBonus - (target.critRes || 0))) kind = 2;
    else if (Math.random()*100 < Math.max(0, (PST.critB || 0) - (target.critRes || 0))) kind = 1;
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
 skillCall('横扫千军');
      G.pushFx({ kind:'hengsao', x:p.x, y:p.y-30, color:'#ffc98a', t:0, dur:0.30, frame:0, startX:p.x, endX:p.x+200 });  /* v3.7.2 y带玩家车道偏移(原固定-30永远画在中道); v2.9 再提速: 0.6→0.38→0.30s, 起手即爆 */
      playSfx('hengsao', 0.8);
      const n = Math.max(1, Math.round(hs.n || 1));
      let hit = 0;
      for (const o of G.enemies) {
        if (hit >= n) break;
        if (o === target || !o.alive || o.dying > 0) continue;
        /* v5.0 剑气横扫改二维: 纵向允许半格(约一个身位)以内的怪被波及,
         * 越界的仍不扫 —— 保留"横扫是横向范围技"的定位, 但不再是同道硬限制。 */
        if (Math.abs(laneAt(o.y) - laneAt(p.y)) > 1.2) continue;
        if (o.x < p.x - 20 || o.x > p.x + 230) continue;
        dealDamage(o, calcDmg(PST.atk, base*(hs.dmg||0)/100, o.def, pen), '#ffc98a', false);
        hit++;
      }
    }
    if (!target.alive) return;
    /* 剑气斩: 追加一段自带攻击力加成的剑气(同样只吃本段基础倍率) */
    const jq = skVal('jianqi');
    if (jq && Math.random()*100 < jq.chance) {
 skillCall('剑气斩');
      G.pushFx({ kind:'slash', x:target.x, y:target.y-24, color:'#bfe8ff', t:0, dur:0.28 });
      dealDamage(target, calcDmg(PST.atk, base*(jq.dmg||0)/100, target.def, pen), '#bfe8ff', false);
      if (!target.alive) return;
    }
  }
  /* ═══════════════ v6.0 战斗距离: 统一为"边缘到边缘" ═══════════════
   *
   * 【为什么要统一】之前玩家和怪各用一套口径，互相打架：
   *   玩家: atkRange = 75，量的精灵是【锚点 -> 剑尖】(实测剑尖前伸 68.6px)
   *   技能怪: stopPx = 58.3 + reachPx，其中
   *           58.3   = 玩家半宽(玩家锚点 -> 玩家身体边缘)
   *           reachPx = 怪锚点 -> 怪前缘
   *   于是 stopPx 是【锚点 -> 怪前缘】的距离，而玩家 75 是【锚点 -> 剑尖】。
   *   两者差一个玩家半宽(58.3)：怪站在 105~210 处，玩家只有 75 的手臂，
   *   永远够不着 —— 这就是"顶着怪就是不出手"的真凶。
   *
   * 【业界标准做法】判定不用"锚点距离 <= 单方攻距"，而是【各自的判定框相交】：
   *   Capcom 格斗: hitbox 与 hurtbox 重叠即命中；
   *   SoR 引擎:    dist <= 攻击半径 + 目标半径(半径之和)；
   *   通用 2D:     分离时用 pushbox 保证不重叠，命中用 hitbox 相交。
   *   即: A 能打到 B  <=>  dist(anchorA, anchorB) <= reachA + halfB
   *
   * 本作照此实现：每方只存【自己的前伸量 + 自己的半宽】，命中判定用两者之和。
   *   玩家: reach = 75(剑尖)          half = 58.3
   *   怪:   reach = atkRange - 58.3    half 由渲染体型实时算
   * 这样谁都不需要知道对方的数值，也不存在"口径不一致"这种事。
   *
   * 【站位由"不重叠"单独决定，不看攻距】
   *   怪停在【自己前缘刚好贴到玩家边缘】处，即 dist = 玩家半宽 + 怪前伸量。
   *   近战怪前伸小 -> 自然贴身；远程怪前伸大 -> 自然站远。
   *   这正是技能包 stopPx 的公式，保留不动 —— 它是"零重叠极限贴合"，
   *   既不会穿模(那是玩家最烦的)，也不会互相够不着。 */
  function groundDist(a, b) {
    const dx = a.x - b.x, dy = (a.y || 0) - (b.y || 0);
    return Math.hypot(dx, dy);
  }
  /* 玩家渲染半宽。与 drawPlayerSprite 同一套算法(drawH = min(CH*0.5, 80))。
   * 技能包算 58.3 时用的是旧基准 min(CH*0.5, 72)，保留 58.3 以保证
   * stopPx / SK_RANGE 两张权威表继续对得上，不再二次改动。 */
  function playerHalfW() {
    const h = Math.min((CH || 306) * 0.5, 72);
    return h * (SPRITE.fw / SPRITE.fh) / 2;
  }
  /* 怪渲染半宽: 骨头怪用骨架 AABB，序列帧怪用精灵帧宽高比，都没有就退回 30。
   * 这是"怪身体占多宽"的实时值，只跟体型有关，跟攻距无关。 */
  function enemyHalfW(e) {
    if (e && e.__halfW > 0) return e.__halfW;
    let w = 0;
    if (e && e.armature) {
      const bb = armAABB(e.armature);
      if (bb && bb.height > 0) w = (e.drawH || 84) * (bb.width / bb.height) * torsoFrac();
    }
    if (!w && e && e.__spriteRatio > 0) w = (e.drawH || 84) * e.__spriteRatio * torsoFrac();
    if (!w) w = 60 * torsoFrac();            /* 兜底: 约等于玩家体宽 */
    if (e) e.__halfW = w / 2;
    return w / 2;
  }
  /* 怪的前伸量(= 怪锚点 -> 怪前缘)。技能怪的 atkRange 含玩家半宽，减掉即得。
   * 非技能怪 atkRange 是旧版的"保守判定半径"，按其语义直接当锚点->边缘用于站位。 */
  function enemyReach(e) {
    if (!e) return 0;
    if (e.__skillRange) return Math.max(0, (e.atkRange || 0) - playerHalfW());
    return Math.max(0, e.atkRange || 0);
  }
  /* v6.1 FIX: 目标半宽必须按【目标自己】的算法取。原先不管打谁都走 enemyHalfW()，
   * 打到玩家时玩家没有 armature/__spriteRatio，直接掉进 30px 兜底 ——
   * 技能怪判定就短了 58.3-27≈31px，必须比站位再近一寸才判命中，
   * 表现正是「远程怪傻站着不放技能，贴脸才出手」。 */
  function halfOf(ent) { return (ent && ent === G.player) ? playerHalfW() : enemyHalfW(ent); }
  /* 命中判定: 边缘到边缘。range 传"攻击方前伸量"，target 的半宽补齐另一半。
   * 这样双方各自只关心自己伸多远，重叠即命中 —— 与 Capcom/SoR 一致。 */
  function canHit(attacker, target, reach) {
    if (!target) return false;
    return groundDist(attacker, target) <= reach + halfOf(target) + 5;
  }
  /* 按二维距离找最近的可攻击目标 —— 取代原来的"同道最近"。 */
  function findNearestEnemy2D(from, maxDist) {
    let best=null, bestD=maxDist||Infinity;
    for (const e of G.enemies) {
      if (!e.alive || e.dying > 0) continue;
      const d = groundDist(from, e);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }
  /* 玩家站位: 走到"剑尖够到怪身体边缘"的位置, 再往前就纯浪费。
   * 与怪的站位(前缘贴玩家边缘)配对 => 互相贴住、零重叠。 */
  const PLAYER_HIT_GAP = 40;   /* 兼容旧引用 */
  function dealDamage(target, amount, color, crit) {
    target.hp -= amount; target.hurtT = 0.25;
    /* v6.4 吸血词条(life): 按造成伤害百分比回血 —— 词条层一直下发(finalStats 返回 life),
     * 但战斗结算层此前从未消费, 属于死词条, 现补上。封顶 maxHp。 */
    if (PST.life > 0 && G.player && G.player.hp < G.player.maxHp) {
      const heal = amount * PST.life / 100;
      if (heal >= 1) {
        G.player.hp = Math.min(G.player.maxHp, G.player.hp + heal);
        G.pushDmg({ x:G.player.x, y:G.player.y-50, val:'+'+Math.round(heal), crit:false, color:'#7fffaa', t:0 });
      }
    }
    G.pushDmg({ x:target.x,y:target.y-40, val:Math.round(amount), crit:crit||false, color:color||'#e8f2fa', t:0, vx:(Math.random()-0.5)*18 });
    G.pushFx({ kind:'hitSpark', x:target.x,y:target.y-20, color:color||'#fff', t:0,dur:0.3 });
    if (target.hp <= 0) {
      target.hp=0; target.alive=false; target.dying=0.4;
      G.kills++;
      G.pushFx({ kind:'death', x:target.x,y:target.y-15, color:target.color, t:0,dur:0.4 });
      onKill(target);
      updateHUD();
    }
  }
  function updatePlayer(dt) {
    const p = G.player;
    if (!p.alive) return;
    p.atkT -= dt; p.anim = Math.max(0, p.anim-dt*1.5); p.hurtT = Math.max(0, p.hurtT-dt);
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
        const r = playerCritRoll(0, p.skillTarget);        // 读装备暴击/会心/爆伤, 主目标暴抗削减(v6.5)
        const atkMult = (1 + (p.atkBuff || 0)) * SKILL.damageMult;
        const dmg = calcDmg(p.atk, atkMult * (0.9 + Math.random()*0.2) * r.mult, p.skillTarget.def, PST.pen || 0);
        dealDamage(p.skillTarget, dmg, '#bfe8ff', r.crit);
        /* v5.0 剑气斩Y轴范围命中: 玩家前方矩形区域, X轴=攻击距离+200, Y轴宽度=120,
         * 能同时命中多只并排/一排的敌人, 主目标全额, 其余70%伤害 */
        const skillRangeX = p.atkRange + 200;
        const skillRangeY = 120;
        for (const o of G.enemies) {
          if (o === p.skillTarget || !o.alive || o.dying > 0) continue;
          const dx = o.x - p.x;
          const dy = Math.abs((o.y || 0) - (p.y || 0));
          if (dx > 0 && dx <= skillRangeX && dy <= skillRangeY) {
            const dmg2 = calcDmg(p.atk, atkMult * 0.7 * (0.9 + Math.random()*0.2), o.def, PST.pen || 0);
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
                                  : 1 / (SPRITE.fps * 1.5);   /* v4.4: 走路动画帧率×1.5(24→36fps), 腿摆动更快, 配合移速×1.5视觉上走得更快 */
    while (p.animTimer >= frameDur) {   /* v5.0 FIX: if→while, 高倍速时一帧内可切多帧, 否则攻速被游戏循环帧率锁死 */
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
          if (canHit(p, p.attackTarget, p.atkRange)) {
            playerStrike(p, p.attackTarget, 1);
            /* 三连斩: 主段命中即 roll 补刀(第二剑 + 第三刀) */
            const sl = skVal('sanlian');
            if (sl && p.attackTarget.alive && Math.random()*100 < sl.chance) {
              p.sanlianTriggered = true;
              skillCall('三连斩');
            }
            /* 主段刺死就收招, 不再补刀 */
            if (!p.attackTarget.alive) {
              p.attackAnim = false; p.animFrame = 0; p.attackTarget = null; p.hit1 = false; p.hit2 = false; p.hit3 = false; p.sanlianTriggered = false;
              /* v2.5 基础攻速: 秒杀中断也吃满攻击间隔 —— 否则高攻秒怪时只剩 ~0.5s/杀的连环速攻 */
              p.atkT = Math.max(p.atkT, 1 / (p.aspd * (buffStats().haste || 1)));   /* v6 身法攻速乘区 */
              if (G.extraStrike) { G.extraStrike = false; p.atkT = 0; }   // 追猎: 立刻再出手(技能特性保留)
            }
          }
        }
        /* 三连斩第二剑: 帧 18, 追加一段(走 seg=2, 非全额基数, 只是补刀的第二下) */
        if (p.animFrame === 18 && p.sanlianTriggered && !p.hit2 && p.attackTarget && p.attackTarget.alive) {
          p.hit2 = true;
          if (canHit(p, p.attackTarget, p.atkRange)) {
            playSfx('attack2', 0.8);
            playerStrike(p, p.attackTarget, 2);
          }
        }
        /* 三连斩补刀(第三刀): 帧 22, 必会心(至少×1.5) */
        if (p.animFrame === 22 && p.sanlianTriggered && !p.hit3 && p.attackTarget && p.attackTarget.alive) {
          p.hit3 = true;
          if (canHit(p, p.attackTarget, p.atkRange)) {
            playerStrike(p, p.attackTarget, 3);
          }
        }
        if (p.animFrame >= SPRITE.attackCount) {
          p.attackAnim = false; p.animFrame = 0; p.attackTarget = null; p.hit1 = false; p.hit2 = false; p.hit3 = false; p.sanlianTriggered = false;
          if (G.extraStrike) { G.extraStrike = false; p.atkT = 0; }        // 追猎: 立刻再出手
        }
      } else {
        p.animFrame = (p.animFrame + 1) % SPRITE.walkCount;
        /* v6.7 PERF: 主角脚步声全关。手机音频硬件频繁唤醒比持续播放还耗电,
         * 走位是自动的, 脚步声信息价值低。攻击/受击/技能声保留, 战斗反馈不受影响。 */
      }
    }
    /* v5.0 无目标时回到中间纵深(视觉均衡)。有目标时由下方的二维追击分支
     * 负责纵向跟进(直接向怪的 y 插值), 不存在"换道"这个动作。 */
    if (!p.attackAnim && !p.skillAnim) {
      const anyAlive = G.enemies.some(e => e.alive && e.dying <= 0);
      if (!anyAlive) p.lane = MID_LANE;
    }
    /* 纵深 y 向目标深度平滑过渡 */
    p.y += (laneOff(p.lane) - p.y) * Math.min(1, dt * 7);

    if (labActive()) return;   /* 标定台: 玩家不追击不出手 —— 位置锁在 labLayout().px */
    if (window.__skillFreeze) { p.moving = 0; return; }   /* v4.8 弹道验收台: 玩家定桩 */

    /* v6.0 二维地面寻敌 + 边缘到边缘判定。
     * 玩家攻距恒为 BC.playerAtkRange(75, 剑尖), 够不着就走过去 —— 不因怪种变。
     * 命中与否交给 canHit(): dist <= 剑尖 + 怪半宽, 见上方"战斗距离"区。 */
    const near = findNearestEnemy2D(p, p.atkRange+200);
    /* 攻击动画播放期间不中断，保持攻击状态 */
    if (p.attackAnim) {
      p.moving = 0;
    } else if (near && canHit(p, near, p.atkRange)) {
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
          p.anim = 1; p.atkT = 1/(p.aspd * (buffStats().haste || 1)); p.attackAnim = true;   /* v6: 出手间隔吃身法攻速乘区 */ p.animFrame = 0; p.animTimer = 0; p.attackTarget = near; p.hit1 = false; p.hit2 = false; p.hit3 = false; p.sanlianTriggered = false;
        }
      }
    } else if (near) {
      /* v6.0 追击: 走到"剑尖刚好够到怪身体边缘"处，再往前是纯浪费。
       * 与怪的站位(dist = 玩家半宽 + 怪前伸量)配对 => 双方互相贴住、零重叠。 */
      p.moving = 1; p.walkT += dt*8;
      const standAt = near.x - (p.atkRange + enemyHalfW(near));
      const spd = BC.playerSpeed*dt;   /* v4.4: 去掉追击1.5倍移速, 统一42px/s, 步幅固定1.17px/帧 */
      p.x += Math.sign(standAt-p.x) * Math.min(Math.abs(standAt-p.x), spd);
      /* 纵向直接向目标怪的纵深靠拢 —— 连续插值, 无换道跳变 */
      const targetDepth = yToDepth(near.y);
      const dD = targetDepth - (p.lane || 0);
      if (Math.abs(dD) > 0.002) {
        p.lane = (p.lane || 0) + Math.sign(dD) * Math.min(Math.abs(dD), 0.8 * dt);   /* v4.4: 纵向速度1.2→0.8 lane/s, 约44px/s与横向42px/s匹配, 转弯不再加速 */
      }
    } else {
      /* v6.0 无怪时向前推进 —— 防穿越按二维地面距离挑最近的挡路怪。
       * ⚠️ v8.2 回退 (勿再改): v8.1 曾把这里的 (nearest - PLAYER_HIT_GAP) 硬卡
       * 改成"按怪半宽刹停", 参与造成了手感变坏。恢复原样 —— 下午的手感就是它。 */
      p.moving = 1; p.walkT += dt*8; p.x += BC.playerSpeed*dt;
      /* ⚠️ v7.9 擂台化：相机不再跟随，玩家一旦走出右侧就再也没人把他拉回来
       * （表现：走到屏幕外继续走，画面上只剩空地、永远等不到下一只怪）。
       * 这里按擂台右缘硬钳住 —— 无怪时玩家停在右侧等刷怪，而不是无限右漂。 */
      p.x = Math.min(p.x, arenaLeft() + arenaW() * 0.88);
      let nearest = Infinity;
      for (const e of G.enemies) {
        if (e.alive && e.dying <= 0 && e.x > p.x - 1 && e.x < nearest) nearest = e.x;
      }
      if (nearest < Infinity) p.x = Math.min(p.x, nearest - PLAYER_HIT_GAP);
    }
  }
  function updatePets(sdt) {   /* v5.11: 形参由 dt 改 sdt —— 战斗计时(施法冷却/动画)与位移(跟随/捡装)全部随倍速加速 */
    const p = G.player;
    for (const pet of G.pets) {
      if (!pet.alive) continue;
      /* 飞行动画帧更新 */
      pet.flyTimer += sdt;
      const frameDur = pet.type === 'eagle' ? 1/20 : 1/24;
      if (pet.flyTimer >= frameDur) {
        pet.flyTimer -= frameDur;
        pet.flyFrame = (pet.flyFrame + 1) % (pet.type === 'eagle' ? 30 : 32);
      }
      /* 朝向: 仅拾取/携带阶段按移动方向判朝向, 跟随阶段固定朝右(不摆头) */
      const dxFrame = pet.x - (pet.lastX ?? pet.x);
      pet.faceAcc = (pet.faceAcc || 0) + dxFrame;
      const faceThresh = Math.max(0.6, 12 * sdt);
      pet.lastX = pet.x;
      /* 拾取装备: 飞行宠物飞向地板掉落, 拾起后缩小带回, 抵达即入包 */
      if (pet.fetch && pet.fetch.state === 'toDrop') {
        const d = pet.fetch.drop;
        if (!d || d.phase === 'done') { pet.fetch.state = 'idle'; pet.fetch.drop = null; }
        else {
          const dx = d.wx - pet.x, dy = (d.y - 16) - pet.y, dist = Math.hypot(dx, dy), spd = 560;
          if (dist <= spd * sdt || dist < 10) { pet.x = d.wx; pet.y = d.y - 16; d.phase = 'carry'; d.t2 = 0; pet.fetch.state = 'carry'; }
          else { pet.x += dx / dist * spd * sdt; pet.y += dy / dist * spd * sdt; }
          /* 拾取阶段按移动方向判朝向 */
          if (pet.faceAcc > faceThresh) { pet.face = 1; pet.faceAcc = 0; }
          else if (pet.faceAcc < -faceThresh) { pet.face = -1; pet.faceAcc = 0; }
          if (Math.abs(dxFrame) > 4) { pet.face = dxFrame > 0 ? 1 : -1; pet.faceAcc = 0; }
          continue;
        }
      }
      if (pet.fetch && pet.fetch.state === 'carry') {
        const d = pet.fetch.drop;
        const tx = p.x + pet.offsetX, ty = floorY() + p.y + pet.offsetY, dx = tx - pet.x, dy = ty - pet.y, dist = Math.hypot(dx, dy), spd = 380;
        if (dist <= spd * sdt || dist < 8) { pet.x = tx; pet.y = ty; }
        else { pet.x += dx / dist * spd * sdt; pet.y += dy / dist * spd * sdt; }
        d.x = worldToScreen(pet.x); d.y = pet.y - 6;             // 装备贴在宠物身上
        /* 携带阶段按移动方向判朝向 */
        if (pet.faceAcc > faceThresh) { pet.face = 1; pet.faceAcc = 0; }
        else if (pet.faceAcc < -faceThresh) { pet.face = -1; pet.faceAcc = 0; }
        if (Math.abs(dxFrame) > 4) { pet.face = dxFrame > 0 ? 1 : -1; pet.faceAcc = 0; }
        if (d.t2 >= 0.7) {
          /* v6.16: 宠物头顶弹装备名(品质色); 没穿上的熔作灵石飘上去 */
          let res = null;
          try { if (window.BattleAPI.applyEquipDrop) res = window.BattleAPI.applyEquipDrop(d.eq.id); } catch (err) {}
          if (res) {
            const qc = QUALITY_COLOR[Math.max(0, Math.min(5, res.q | 0))] || '#aab2c0';
            /* 装备名(品质色)——穿没穿上都弹, 让玩家看到掉了什么 */
            G.pushDmg({ x: pet.x, y: pet.y - 40, val: res.name, color: qc, t: 0, vx: 0 });
            /* 有灵石入账(替换旧装熔旧装 / 新装备评分不够被熔) → 灵石飘上去 */
            if (res.spirit > 0) {
              G.pushDmg({ x: pet.x, y: pet.y - 58, val: '+' + fmtNum(res.spirit) + ' 灵石', color: '#f0c98a', t: 0, vx: 0 });
              /* 熔作灵石: 从宠物位置飘向上角收益区。v6.16 FIX: 必须设 target,
               * 否则 updateDrops fly 阶段读 d.target.x 抛 TypeError → 战斗冻结。 */
              G.drops.push({ kind: 'spirit', wx: pet.x, x: worldToScreen(pet.x), y: pet.y - 10, gy: 0, vy: 0,
                val: res.spirit, elite: false, enemy: '', t: 0, flyAt: 0.05, phase: 'fly', target: hudTarget() });
            }
          }
          d.phase = 'done'; pet.fetch.state = 'idle'; pet.fetch.drop = null;
        }
        continue;
      }
      /* 空闲宠物认领待拾装备 —— 只有灵狐捡, 灵鹰只打怪 */
      if (pet.type !== 'eagle' && (!pet.fetch || pet.fetch.state === 'idle')) {
        const d = G.drops.find(x => x.kind === 'equip' && x.phase === 'wait' && !x.claimed && (!x.showT || x.t >= x.showT));
        if (d) { d.claimed = true; d.phase = 'fetch'; pet.fetch = pet.fetch || { state: 'idle', drop: null }; pet.fetch.state = 'toDrop'; pet.fetch.drop = d; continue; }
      }
      /* 上下浮动(保留计时器, 渲染层用) */
      pet.bobT += sdt * 2.5;
      /* ═══ v8.5 灵鹰独立化(用户明确要求) ═══
       * 灵鹰是【独立的攻击宠】, 不是跟随宠:
       *   ① 不绑玩家: 它自己悬停在战场上方, 玩家推进/后退它不跟着平移
       *   ② 不参与施法: 施法系统(回血/加攻光环)是灵狐的, 灵鹰只打怪
       *   ③ 不捡装备: 已由上面的 pet.type !== 'eagle' 挡住
       * 因此这里给灵鹰单开一条分支, 在它自己处理完攻击后 continue,
       * 不再往下走"跟随玩家 + 施法"那两段共用逻辑。 */
      if (pet.type === 'eagle') {
        updateEagle(sdt, pet, p);
        continue;
      }
      /* 跟随玩家: 左上方, 简单延迟跟随 —— 插值系数小(sdt*3.5), 玩家快走时宠物
       * 先愣一下(跟不上), 随后慢慢跟上。不用弹簧/惯性模型, 倍速起来也不乱晃。 */
      const targetX = p.x + pet.offsetX;
      const targetY = floorY() + p.y + pet.offsetY;
      pet.x += (targetX - pet.x) * Math.min(1, sdt * 3.5);
      pet.y += (targetY - pet.y) * Math.min(1, sdt * 3.5);
      /* 朝向固定朝右(宠物在玩家左侧跟随, 不摆头) */
      pet.face = 1;

      /* 施法系统 —— 【只有灵狐会走到这里】。
       * v8.5: 灵鹰已在上面 continue, 不会进来, 所以它的"施法光环"彻底消失。 */
      if (pet.casting) {
        pet.castAnim += sdt / 1.2;  /* 施法动画1.2秒 */
        pet.effectTimer += sdt;
        /* 施法进行中: 生成治疗/攻击粒子 */
        if (pet.effectTimer >= 0.08) {
          pet.effectTimer = 0;
          if (pet.castType === 'heal') {
            G.pushFx({ kind:'healParticle', x:p.x+(Math.random()-0.5)*30, y:p.y-30-Math.random()*40, vx:(Math.random()-0.5)*10, vy:-20-Math.random()*15, t:0, dur:0.8, color:'#7fffaa' });
          } else if (pet.castType === 'atk') {
            G.pushFx({ kind:'atkParticle', x:p.x+(Math.random()-0.5)*25, y:p.y-20-Math.random()*30, vx:(Math.random()-0.5)*15, vy:-15-Math.random()*10, t:0, dur:0.7, color:'#ffaa55' });
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
            G.pushDmg({ x:p.x, y:p.y-50, val:'+'+healAmt, crit:false, color:'#7fffaa', t:0 });
            G.pushFx({ kind:'healBurst', x:p.x, y:p.y-30, t:0, dur:0.5 });
          } else if (pet.castType === 'atk') {
            /* 加攻击: +30%攻击力, 持续6秒 */
            p.atkBuff = 0.3;
            p.atkBuffTimer = 6;
            G.pushDmg({ x:p.x, y:p.y-50, val:'攻击+30%', crit:false, color:'#ffaa55', t:0 });
            G.pushFx({ kind:'atkBurst', x:p.x, y:p.y-30, t:0, dur:0.5 });
          }
          pet.castType = null;
          pet.castTimer = 8;  /* 8秒后再次施法 */
        }
      } else {
        /* 施法冷却 */
        pet.castTimer -= sdt;
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
      p.atkBuffTimer -= sdt;
      if (p.atkBuffTimer <= 0) { p.atkBuff = 0; p.atkBuffTimer = 0; }
    }
  }

  /* ═══ v8.5 灵鹰: 独立攻击宠 ═══
   * 用户明确要求: "这个鹰它只是个攻击宠, 它是独立的, 也不要绑定在玩家身上"。
   *
   * 定位: 不跟随玩家, 而是【悬停在战场上方】——横向锚在玩家与最前怪之间的空域,
   *       玩家推进它就往右挪一点, 但绝不贴着玩家 (与灵狐的贴身跟随是两种行为)。
   * 职责: 只做一件事 —— 定时朝最近的怪发射追踪弹幕。不捡装备、不施法、不加 buff。
   *
   * 为什么不直接固定世界坐标: 玩家一路向前推进, 固定点很快会被甩到屏幕外,
   * 玩家会觉得"鹰丢了"。所以锚点按战线走, 但保持一个远离玩家的高空站位。 */
  const EAGLE = {
    atkInterval: 2,       /* 发射间隔(秒) */
    boltSpeed: 260,       /* v5.14: 500→260 —— 原速 0.3s 打到, 观感"直接落在怪身上";
                             降到可视速度后弹丸全程可见, 配合残影拖尾有真实弹道轨迹 */
    hoverBack: 150,       /* 站在"最前怪"后方 150px 的空域(不贴玩家) */
    minGapToPlayer: 90,   /* 至少离玩家 90px, 避免看起来还粘在玩家身上 */
    hoverH: 0.30,         /* 高度: 横带高度的 30% 处(高空) */
    /* ⚠️ v8.6 新增(勿删) —— "鹰压根看不到"的根因是它被算到了可视区之外:
     * 旧逻辑 anchorX 取 `front - hoverBack`, 而 front 是【世界坐标下的最前怪】,
     * 这怪常常还在屏幕右缘之外几十~几百像素(它就是刚生成、正走进来的那只),
     * 于是鹰被锚到更右边, 屏幕 x 一路漂到可视区之外 → 玩家反馈"压根看不到鹰"。
     * (鹰的世界 y 也有同类错误, 见 updateEagle 里 baseY 的长注释。)
     * 下面两条是按【屏幕坐标】做的硬钳制: 鹰是给玩家看的单位, 必须始终在视野内。
     *   screenGapL/R: 鹰的屏幕 x 距左右边的安全余量(避免半只鹰挂在边上)。
     * 钳制在【世界坐标】上做(scrMin/scrMax 由 camX 换算), 相机推进时鹰依然跟得住。 */
    screenGapL: 90,
    screenGapR: 140,
  };
  function updateEagle(sdt, pet, p) {   /* v5.11: 形参由 dt 改 sdt —— 攻击间隔/弹幕飞行/站位插值随倍速加速 */
    /* ── 站位 ── */
    let anchorX = p.x + EAGLE.hoverBack;      /* 兜底: 场上没怪时, 玩家前方空域 */
    let front = -Infinity;                    /* 最靠前的怪(离玩家最近) */
    for (const e of G.enemies) {
      if (!e.alive || e.dying > 0) continue;
      if (e.x > p.x && e.x > front) front = e.x;
    }
    if (front > -Infinity) anchorX = front - EAGLE.hoverBack;
    if (anchorX < p.x + EAGLE.minGapToPlayer) anchorX = p.x + EAGLE.minGapToPlayer;
    /* ⚠️ v8.6 屏幕边界钳制 —— 见 EAGLE 注释。把世界锚点收进可视区, 没有这一步,
     * 怪一旦在屏幕外, 鹰就跟着跑到屏幕外(用户反馈"游戏里压根看不到鹰")。
     * scrMax 用 Math.max 兜底: 横带极窄时也保证左右余量之间有正区间, 不出现 scrMin>scrMax。 */
    const scrMin = G.camX + EAGLE.screenGapL;
    const scrMax = G.camX + Math.max(EAGLE.screenGapL + 40, CW - EAGLE.screenGapR);
    if (anchorX < scrMin) anchorX = scrMin;
    if (anchorX > scrMax) anchorX = scrMax;
    /* 平滑靠位(与灵狐同款延迟跟随手感, 但目标是空域锚点而非玩家) */
    pet.x += (anchorX - pet.x) * Math.min(1, sdt * 3.5);
    /* ── 高度: 战场上空, 与玩家无关 ──
     * ⚠️⚠️ v8.6 致命 BUG 修复(勿回退) —— "鹰压根看不到"的真正根因:
     * 渲染层对宠物用的是【绝对屏幕 y】(看 drawPets: `const sy = pet.y;
     * 宠物y坐标已包含offsetY和上下浮动`), 与灵狐保持同一约定 ——
     * 灵狐: `targetY = floorY() + p.y + pet.offsetY`(带 floorY!)。
     * 而灵鹰旧代码写的是 `baseY = -CH * EAGLE.hoverH`, 【完全没加 floorY】,
     * 于是 pet.y ≈ -68 —— 画布 y 的有效范围是 0~CH, 负值等于把鹰画到了画布
     * 上方之外, 精灵 anchor(0.5,1) 又向上生长, 更是彻底出界。
     * 表现就是玩家反馈的"游戏里压根看不到鹰"(对象/纹理/可见性全部正常,
     * 只有坐标在屏幕外, 所以怎么查逻辑都查不出问题)。
     * 正确写法: 以地面 floorY() 为基准, 往上抬 EAGLE.hoverH * CH 的"空域高度",
     * 再减去半个鹰身, 保证整只鹰(含向上的羽翼)都落在画布内。 */
    const eagleH = Math.min(CH * 0.40, 64);          /* 与渲染层 drawH 一致 */
    const baseY = floorY() - CH * EAGLE.hoverH - eagleH * 0.5;
    pet.y += (baseY - pet.y) * Math.min(1, sdt * 3.5);
    pet.face = 1;                             /* 素材默认朝右, 不摆头 */
    pet.boltAnim = Math.max(0, (pet.boltAnim || 0) - sdt);

    /* ── 攻击: 定时朝最近的怪发射追踪弹幕 ── */
    pet.boltTimer = (pet.boltTimer == null ? EAGLE.atkInterval : pet.boltTimer) - sdt;
    if (pet.boltTimer > 0) return;
    pet.boltTimer = EAGLE.atkInterval;
    if (!G.enemies || !G.enemies.some(e => e.alive)) return;
    let target = null, minDist = Infinity;
    for (const e of G.enemies) {
      if (!e.alive) continue;
      const d = Math.abs(e.x - pet.x);
      if (d < minDist) { minDist = d; target = e; }
    }
    if (!target) return;
    /* 发射点: 鹰的爪子下方(不从玩家身上出)。
     * ⚠️ v8.6 坐标统一(勿回退): 弹幕是【屏幕坐标】实体 —— 渲染端直接
     * spr.position.set(b.x, b.y), 既不做 worldToScreen 也不加 floorY。
     * 所以这里必须存屏幕坐标:
     *   x → worldToScreen(pet.x)(pet.x 是世界坐标, 不减 camX 会一路飞偏)
     *   y → pet.y(鹰已是绝对屏幕 y, 再加 10 落到爪子下)
     * 目标点同理: target.y 是【怪的原始车道偏移】, 渲染时是 floorY()+e.y,
     * 这里要补 floorY() 才是屏幕 y; x 也要转屏幕。 */
    G.eagleBolts.push({
      x: worldToScreen(pet.x), y: pet.y + 10,
      tx: worldToScreen(target.x) + 20, ty: floorY() + target.y - 35,
      speed: EAGLE.boltSpeed, t: 0, target,
    });
    pet.boltAnim = 1.2;  /* 播攻击动画 */
  }

  /* 灵鹰弹幕更新(不在宠物循环里, 只执行一次) */
  function updateEagleBolts(sdt) {   /* v5.11: 形参由 dt 改 sdt —— 弹幕飞行随倍速(追踪弹越目标后下帧必命中, 无穿透) */
    if (!G.eagleBolts || G.eagleBolts.length === 0) return;
    for (let i = G.eagleBolts.length - 1; i >= 0; i--) {
      const b = G.eagleBolts[i];
      b.t += sdt;
      if (b.target && b.target.alive) {
        /* ⚠️ v8.6 坐标统一(勿回退): 弹幕全程走【屏幕坐标】, 见发射点处的长注释。
         * 追踪时同样要把怪的世界 x 转屏幕、并把车道偏移加上 floorY() 换成屏幕 y,
         * 否则弹幕会一路飘向错误位置(旧代码直接取 target.x/target.y, 两者都不是屏幕坐标)。 */
        b.tx = worldToScreen(b.target.x);
        b.ty = floorY() + b.target.y;
      }
      const dx = b.tx - b.x, dy = b.ty - b.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > 5) {
        b.x += dx / dist * b.speed * sdt;
        b.y += dy / dist * b.speed * sdt;
        /* v5.14 弹道残影: 每 30ms 在当前位置留一个渐隐残影, 拖出可见轨迹。
         * 硬上限 40 个防堆积(速度极低/卡顿时 shift 丢最老)。 */
        b.trailT = (b.trailT || 0) + sdt;
        if (b.trailT >= 0.03) {
          b.trailT = 0;
          const T = G.eagleTrails || (G.eagleTrails = []);
          T.push({ x: b.x, y: b.y, rot: Math.atan2(dy, dx), a: 0.45 });
          if (T.length > 40) T.shift();
        }
      }
      let hit = false;
      if (dist < 30) {
        const e = b.target;
        if (e && e.alive) {
          const dmg = calcDmg(PST.atk, 0.8, e.def, PST.pen || 0);
          dealDamage(e, dmg, '#7fe0ff', false);
        }
        hit = true;
      }
      if (hit || b.t > 3) G.eagleBolts.splice(i, 1);
    }
  }

  /* v5.14 弹道残影衰减(拖尾渐隐, 约 0.33s 消散) */
  function updateEagleTrails(sdt) {
    const T = G.eagleTrails;
    if (!T || !T.length) return;
    for (let i = T.length - 1; i >= 0; i--) { T[i].a -= sdt * 1.35; if (T[i].a <= 0) T.splice(i, 1); }
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
    /* ⚠️ v8.2 回退 (勿再改) —— v8.1 曾删掉这一行(受击不切 hurt 动画), 理由是
     * "Damage 素材自带骨架位移导致画面横移"。事后证明那是误判: 用户实测的后退
     * 另有其因(玩家被一刀秒后新怪从更远处刷出, 观感像"怪后退")。而删掉这行让
     * 怪挨打时【完全没有受击反馈】, 手感更差。恢复原始行为。 */
    else if (e.hurtT > 0) want = an.hurt;
    else if (e.anim > 0) want = an.attack;
    else if (!e.moving) want = an.idle;
    if (!want || !A.hasAnimation(want)) want = an.idle || an.walk;
    if (want && e.boneAnim !== want) { e.boneAnim = want; A.fadeIn(want, 0.12, (want === 'walk' || want === 'idle') ? 0 : -1); }   /* playTimes=0 强制循环: megapack1 数据自带播1次, -1 会冻结在末帧 */
    /* v5.13 PERF: 骨骼待机跳帧 —— DragonBones 全骨骼 FK+插值解算是战斗 CPU 最大
     * 单项(每怪每帧一次)。站定待机(idle)是慢循环呼吸动画, 累积 2 帧(≈12fps)解算
     * 一次、动画时间照推不丢进度, 肉眼无差; 走路/攻击/受击/死亡/BOSS 保持全帧率,
     * 手感不动。切态瞬间走全帧分支, 积压时间一次补齐, 动画无跳变。 */
    if (!dead && e.anim <= 0 && e.hurtT <= 0 && !e.moving && e.type !== 'boss') {
      e.__boneAcc = (e.__boneAcc || 0) + dt;
      if (e.__boneAcc >= 0.084) { e.armature.advanceTime(e.__boneAcc); e.__boneAcc = 0; }
    } else if (e.__boneAcc) {
      e.armature.advanceTime(e.__boneAcc + dt); e.__boneAcc = 0;
    } else {
      e.armature.advanceTime(dt);
    }
    /* v4.4 程序化行走: 该怪没有 walk 动画(素材缺), 但骨架绑了腿 —— 移动时现场摆腿。
     * 只在"走路态"(非攻击/非受击/非死亡)且确实在移动时驱动, 避免打架: 攻击时腿该
     * 保持攻击姿势, 受击/死亡同理。
     * 关键排除: 若该怪自带真正的 walk 动画(如 ratty), 则动画本身就在摆腿,
     * 再叠加程序化驱动会双重驱动/相位打架 —— 判定方式与 boneAnimMap 的回退一致:
     * walk 与 idle 不是同一支动画, 才说明素材真有 walk。 */
    const hasRealWalk = !!(an.walk && an.walk !== an.idle);
    if (!dead && !hasRealWalk && e.moving && e.hurtT <= 0 && e.anim <= 0 && e.__legs && e.__legs.length) {
      e.__walkT = (e.__walkT || 0) + dt * 2.0;
      const amp = 1.0;
      for (let i = 0; i < e.__legs.length; i++) driveLeg(e.armature, e.__legs[i], e.__walkT, amp * e.__legs[i].amp, null);
    }
  }
  /* 标定台专用：把玩家/怪钉在固定屏幕位，怪只播动画不移动 —— 攻距 = 锚点水平间距。 */
  function labTick(dt) {
    const p = G.player, L = labLayout();
    p.x = G.camX + L.px; p.lane = MID_LANE; p.y = laneOff(MID_LANE);
    const e = G.enemies.find(x => x.boneSlug === LAB.slug && x.alive);
    if (!e) return;
    e.x = G.camX + L.ex; e.lane = MID_LANE; e.y = laneOff(MID_LANE);
    e.hp = e.maxHp; e.atk = 0; e.moving = false;
    if (e.armature) {
      /* 指定动画循环播放；进度由 LAB.t 驱动（受 fps 控制，可冻结）。
       * 必须走 labDrive（fadeIn 语义），play() 切不动动画。 */
      const want = LAB.anim;
      const prev = LAB._cur;
      LAB._cur = want;
      const ad = e.armature.animation && e.armature.animation.animations
        ? e.armature.animation.animations[want] : null;
      const fr = (ad && ad.frameRate) || 24;
      /* AnimationData.duration 单位是秒 */
      const total = (ad && ad.duration > 0) ? ad.duration : 1;
      LAB._total = total;
      if (prev !== want) { LAB.t = 0; }
      if (LAB.seek != null) {
        LAB.t = LAB.seek * total;               /* 定格模式：直接定位（拖进度条用） */
      } else if (!LAB.opts.paused) {
        LAB.t = (LAB.t || 0) + dt * (LAB.opts.fps / 24);
      }
      const ph = LAB.opts.loop === false ? Math.min(total - 1e-4, LAB.t) : (LAB.t % total);
      labDrive(e.armature, want, ph);
    }
  }
  function updateEnemies(dt) {
    const p = G.player;
    if (labActive()) { labTick(dt); return; }   /* 标定台: 不走常规排队/推进 */
    /* v5.0 排队改为按"纵深邻域"聚类: 地面是连续坐标没有道可分组, 于是用
     * 纵深相近(半身位内)且横向投影重叠的怪视为一列, 近的先站位, 后面的后挪。
     * 纵深相差大的怪互不排队 —— 与原来"各道独立"效果一致, 但不依赖离散道。 */
    const groups = [];
    for (const e of G.enemies) {
      if (!e.alive || e.dying > 0) continue;
      if (e.type === 'boss') continue;   /* v5.0 BOSS不参与小怪排队, 有独立站位(攻距决定), 否则被强制站在最后一只狐狸后面 */
      let g = null;
      for (const cand of groups) {
        if (Math.abs(yToDepth(cand.y) - yToDepth(e.y)) * depthPx() < laneGap() * 0.5) { g = cand; break; }
      }
      if (g) g.list.push(e); else groups.push({ y: e.y, list: [e] });
    }
    for (const g of groups) {
      const queue = g.list.sort((a, b) => a.x - b.x);
      let prevX = -1e9;
      for (const e of queue) {
        /* 验收台定桩怪不进队列, 原地开火 */
        if (e.__skillHold) { e.stopX = e.x; prevX = Math.max(prevX, e.x); continue; }
        /* v6.0 站位 = "不重叠"的唯一解, 与攻距无关:
         *   dist(怪, 玩家) = 玩家半宽 + 怪前伸量
         * 即【怪身体前缘刚好贴到玩家身体边缘】—— 玩家最烦的穿模在这里被杜绝,
         * 同时又没有多余间隙(再远一寸就是纯浪费)。近战怪前伸小 -> 自然贴身;
         * 远程怪前伸大 -> 自然站远, "远程"定位自动成立。
         * 技能怪的 atkRange 来自 04_数据/stop_class5.json 的 stopPx(= 58.3 + reachPx),
         * 已含玩家半宽, 故这里直接用即可, 不再做 min/区间之类的人为收窄。 */
        /* ⚠️ v8.2 回退 (勿再改) —— v8.1 曾把这里改成"每帧重算 stopX = p.x + atkRange",
         * 结果手感立刻变坏(用户反馈"怪一直后退/打的是另一只"): 玩家推进时 stopX 跟着涨,
         * 已经站定的怪被持续"往后顶", 加上相机移动, 观感就是怪在不断退后。
         * 用户下午玩的那版(340fd61)本来是好的 —— 恢复原条件: stopX 只在
         * 【怪还没到位】时计算一次, 到位后冻结, 怪就安心站在原地打。
         * 排队后方怪用 prevX + queueGap 保证不重叠。 */
        if (e.stopX == null || e.x < e.stopX - BC.queueGap) {
          const stopX = Math.max(p.x + (e.atkRange || 0), prevX + BC.queueGap);
          e.stopX = stopX;
        }
        prevX = Math.max(e.x, e.stopX);
      }
    }
    /* ⚠️ v8.2 回退 (勿再改) —— v8.1 曾把这条兜底改成"只拦不推", 同样参与了手感变坏。
     * 恢复原始行为: 怪若被留在站位点左侧(玩家推进穿过), 直接拉回站位点。
     * 这是 v3.8.1 起就有的防交错兜底, 下午的手感就是建立在它之上。 */
    for (const e of G.enemies) {
      if (!e.alive || e.dying > 0 || e.stopX == null) continue;
      if (e.__skillHold) continue;           /* v4.8 定桩怪不回拉 */
      if (e.x < e.stopX - 4) e.x = e.stopX;
    }
    for (const e of G.enemies) {
      if (e.dying>0) { e.dying-=dt; if (e.armature) advanceRatty(e, dt, true); continue; }
      if (!e.alive) continue;
      if (e.armature) advanceRatty(e, dt, false);   /* 骨骼怪: 推进动画(吃倍速 dt, 与移动节奏一致) */
      /* v5.0 怪二维寻玩家: 纵深直接向玩家的 y 连续插值 —— 没有"道"可换,
       * 也就没有跳变; 横向由 stopX 控制, 纵向由这条插值控制, 两轴都丝滑。 */
      if (!e.__skillHold) {
        e.y += (p.y - e.y) * Math.min(1, dt * 1.2);
        e.lane = yToDepth(e.y);   /* 兼容字段: 记录当前纵深比例 */
      }
      e.atkT -= dt; e.anim = Math.max(0, e.anim-dt*1.5);
      const wasHurt = e.hurtT > 0;
      e.hurtT = Math.max(0, e.hurtT-dt);
      /* 受击音效: 受击开始时 */
      if (!wasHurt && e.hurtT > 0) monHurtSfx(e);
      /* 动画帧跟踪 */
      e.animTimer += dt;
      const frameDur = 1 / 24;
      if (e.animTimer >= frameDur) {
        e.animTimer -= frameDur;
        if (e.anim > 0) {
          e.animFrame++;
        } else {
          e.animFrame = (e.animFrame + 1) % 32;
          /* v6.7 PERF: 所有怪物脚步声全关(含 slime/water/骨骼怪)。
           * 场上最多 14 只怪同时走, 每秒触发 10+ 次 Audio.play(), 在手机上是音频硬件
           * 频繁唤醒的主要来源。攻击声/受击声/技能声保留, 战斗反馈不受影响。 */
        }
      }
      const stopX = e.stopX != null ? e.stopX : p.x + e.atkRange;
      e.moving = e.x > stopX+2;
      if (e.x > stopX+2) e.x = Math.max(stopX, e.x-e.speed*dt);
      const wasAttacking = e.anim > 0;
      /* v6.0 攻击判定: 边缘到边缘。怪用自己【前伸量】, 玩家半宽补上另一半。
       * 怪的站位就是"前缘贴玩家边缘", 所以站定即命中 —— 距离即攻击。
       * 关于玩家半宽: 技能怪 atkRange 已含 58.3(玩家半宽), 减掉才是纯前伸量;
       * 非技能怪的 atkRange 是旧版保守半径, 其语义已接近"锚点->边缘", 直接用作前伸。 */
      if (canHit(e, p, enemyReach(e)) && e.atkT <= 0) {
        e.anim = 1; e.atkT = 1/(0.8+Math.random()*0.5); e.animFrame = 0;
        /* 攻击音效: 攻击开始时 —— 骨骼怪走各自专属音, 见 MON_ATK */
        if (!wasAttacking) monAttackSfx(e);
        /* 闪避判定(装备词条 + 身法 buff 时效加成) —— 落空则不进伤害。
         * v6: 闪避改从 buffStats() 实时取，不再依赖 G.speedDodge（那是旧倍速技能字段）。 */
        if (Math.random()*100 < ((PST.dodge || 0) + G.speedDodge + buffStats().dodge)) {
          G.pushDmg({ x:p.x,y:p.y-40, val:'闪', crit:false, color:'#9fd8ff', t:0 });
        } else {
          /* v4.8 技能怪: 按 skills5.json 映射发一条程序化弹道。
           * 弹道纯表现层 —— 伤害仍在上面这一帧照常结算, 不参与命中判定,
           * 所以即使弹道被同屏节流丢掉, 战斗数值也不受影响。 */
          const sk = SK_OF[e.type];
          if (sk) spawnSkillFx(e, e, sk, e.x >= p.x ? -1 : 1);
          /* v6.5 怪物破甲: 无视玩家 def 的 pen% ; 怪暴击: 命中×1.8(高 tier/精英/BOSS) */
          const dmg0 = calcDmg(e.atk, 0.85+Math.random()*0.3, PST.def, e.pen || 0);
          const crit = Math.random()*100 < (e.crit || 0);
          const dmg = crit ? Math.round(dmg0*1.8) : dmg0;
          p.hp -= dmg; p.hurtT = 0.25;
          G.pushDmg({ x:p.x,y:p.y-40, val:dmg, crit, color: crit ? '#ff5a3c' : '#ff8a7a', t:0 });
          G.pushFx({ kind:'hitSpark', x:p.x,y:p.y-20, color:'#ff8a7a', t:0,dur:0.3 });
          if (p.hp <= 0) {
            /* v8.1 死亡: 不再原地满血复活 —— 冻结战斗, 弹「转生 / 从头开始」面板。
             * 回调由 06-v6ui 注册(BattleAPI.onPlayerDeath), 选择后经 BattleAPI.respawn 恢复。 */
            p.hp = 0;
            p.hurtT = 0.25;
            G.paused = true;
            if (typeof _deathCb === 'function') { try { _deathCb(); } catch (err) {} }
          }
        }
      }
    }
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      if (!(e.alive || e.dying > 0)) {
        despawnEnemy(e);
        G.enemies[i] = G.enemies[G.enemies.length - 1];
        G.enemies.length--;
      }
    }
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
    for (let i = G.fx.length - 1; i >= 0; i--) {
      if (G.fx[i].t >= G.fx[i].dur) { G.fx[i] = G.fx[G.fx.length - 1]; G.fx.length--; }
    }
    reapSkillFx();                              /* v4.8 标记弹道结束, 释放同屏配额 */
    for (const d of G.dmg) d.t += dt;
    for (let i = G.dmg.length - 1; i >= 0; i--) {
      if (G.dmg[i].t >= 0.9) { G.dmg[i] = G.dmg[G.dmg.length - 1]; G.dmg.length--; }
    }
  }
  function updateCamera(dt) {
    /* ══════════════════════════════════════════════════════════════════
     *  v7.9（勿回退）：相机【不再跟随玩家】，camX 恒为 0。
     * ══════════════════════════════════════════════════════════════════
     *  旧的跟拍式 `camX = player.x - stageW()*0.42` 是为「连续推进的横版跑图」
     *  设计的；现在每一关是一屏擂台（左出生 / 右来怪 / 打完重置），画面本身
     *  就该是固定的舞台。相机再去追玩家，玩家一往前走整个场景跟着平移，
     *  既丢掉「从左往右跑」的位移读数，又让重置时的回退变成一次突兀的全屏甩镜。
     *
     *  camX 保持「存在且为 0」而不是删掉变量：
     *    · worldToScreen(wx) = wx - camX  →  退化为恒等映射，世界坐标即屏幕坐标
     *    · 背景/前景平铺仍然读 camX 算 offset → 天然静止，不再需要改那两处
     *    · 灵鹰的屏幕钳制 scrMin/scrMax 仍成立（0 与 CW）
     *  这样改动面最小，也不会出现某处残留 ++camX 把画面推歪。
     */
    G.camX = 0;
  }
  let _pushT = 0;
  /* ⚠️ v6: 原「妖潮试炼状态机」已整体拆除 ——
   * updateTrial(120s 倒计时) / settleTrial(结算弹窗+纪录+离线加成) / trialRestart(重置怪池)
   * 三个函数连同 trialToast 结算面板一并删除。现在是无尽刷怪, 没有"一轮"这个概念。
   * 唯一保留下来的是「玩家倒下后清场重来」—— 见下面 respawnArena()。 */
  function respawnArena() {
    for (const e of G.enemies) { e.alive = false; e.dying = 0; if (e.armature) { try { despawnEnemy(e); } catch(err) {} } }
    G.enemies.length = 0;
    G.bossActive = false;
    G.spawned = 0;      /* 重来后第一只仍然生成在玩家眼前 */
    /* v7.9：复活也要把玩家放回擂台出生点（相机不再把他送回来） */
    if (G.player) { G.player.x = playerSpawnX(); G.player.lane = MID_LANE; G.player.y = laneOff(MID_LANE); }
    G.paused = false;
    updateHUD();
  }
  function realmName() { try { return (typeof window.realm === 'function' && window.realm().big) || ''; } catch (err) { return ''; } }
  function update(dt) {
    /* v6 倍速来源 = Buff 宠物（外部注入，见 BattleAPI.setSpeedMult），到点回落基础值 */
    if (G.speedMultTimer > 0) {
      G.speedMultTimer -= dt;
      if (G.speedMultTimer <= 0) { G.speedMult = BASE_SPEED_MULT; G.speedMultTimer = 0; }
    }
    const nowSpeedBuff = G.speedMultTimer > 0;
    if (nowSpeedBuff !== _wasSpeedBuff) { _wasSpeedBuff = nowSpeedBuff; updateHUD(); }
    /* ⚠️ v6 身法 Buff 推进必须用【原始 dt】，不能用下面的 sdt ——
     *   否则游戏倍速会反过来把技能 CD 一起加速，形成"倍速越快 CD 越短"的正反馈。 */
    tickSkillBuffs(dt);
    const sdt = dt * G.speedMult;
    G.t += sdt;
    /* v6.10 PERF: 动态帧率。v5.13 扩成三档:
     * 空场(0怪,非BOSS) 66ms≈15fps —— 推图走路段, 画面变化最小(仅玩家走路+背景滚动);
     * 怪少(<5只,无BOSS/倍速) 50ms≈20fps; 激烈(≥5怪/BOSS/倍速中) 42ms≈24fps。
     * 挂机时间大头在低档位区间, CPU/GPU 双降直接换发热下降。 */
    let _aliveCount = 0;
    for (const e of G.enemies) if (e.alive) _aliveCount++;
    G.targetFrameMs = (_aliveCount === 0 && !G.bossActive) ? 66
      : (_aliveCount < 5 && !G.bossActive && G.speedMultTimer <= 0) ? 50 : 42;
    /* v5.0 定期刷新HUD: 打BOSS期间无新击杀/状态不变, 倒计时数字显示会卡住, 每0.25秒刷一次 */
    _hudRefreshT += dt;
    if (_hudRefreshT >= 0.25) { _hudRefreshT = 0; updateHUD(); }
    let aliveCount = 0;
    for (const e of G.enemies) { if (e.alive && e.dying <= 0) aliveCount++; }
    const newState = aliveCount > 0 ? 'fight' : 'walk';
    if (newState !== G.state) { G.state = newState; updateHUD(); }
    G.spawnT -= dt;   /* v5.0 刷怪频率用原始dt, 不受身法倍速影响 —— 倍速只加战斗节奏不加刷怪密度 */
    /* v4.6 刷怪间隔旋钮: window.__spawnSlowMul(默认 1) —— 调大则刷得更稀, 便于逐只端详。 */
    const spawnGap = BC.spawnInterval * ((typeof window !== 'undefined' && window.__spawnSlowMul) || 1);
    /* v4.8 弹道验收台: 关掉刷怪，否则无关怪会掺进验收台把画面糊掉。 */
    if (window.__skillFreeze) { G.spawnT = spawnGap; }
    else if (G.spawnT <= 0) {
      /* ⚠️ v7.8/v7.9 定案 —— 设计意图(用户明确): 同屏基本只留 1 只, 砍死一只→刷新一只。
       * 曾误判 `< 1` 是 bug 并改成填充 6 只, 结果出现"一波十几只、一刀全秒"的过密场面,
       * 与设计冲突, 现已改回。这里的 `< 1` 是【刻意】的: 只在场上彻底空了才补,
       * 与 onKill 里的"击杀即刷新"互为兜底(正常路径靠 onKill 补, 这里防漏)。
       * 不要把它改成 >1 的填充值。 */
      if (aliveCount < 1) spawnWave();   /* v6 无尽刷怪: 场上空了就补, 无怪池上限 */
      G.spawnT = spawnGap;
    }
    /* 属性/技能等级每 5s 重新取一次(自愈: 即便某次变更没通知到也不会一直用旧值) */
    _pushT -= dt;
    if (_pushT <= 0) { _pushT = 5; if (typeof window.pushBattleStats === 'function') window.pushBattleStats(); }
    updatePlayer(sdt); updatePets(sdt); updateEagleBolts(sdt); updateEagleTrails(sdt); updateEnemies(sdt);   /* v5.11: 宠物/鹰弹幕接入倍速 —— 与玩家/怪的 sdt 同源; v5.14: 残影拖尾同倍速 */ updateFx(sdt); updateDrops(dt); updateCamera(sdt);
    /* 技能名播报: 独立推进(不吃身法倍速, 固定节奏即隐) */
    if (G.skillCall) { G.skillCall.t += dt; if (G.skillCall.t >= G.skillCall.dur) G.skillCall = null; }
  }

  /* 渲染 */
  let cv, ctx, CW, CH;
  const _drawList = [];   /* 复用: 避免每帧两次分配+两次排序 */
  const _waterMat = new PIXI.Matrix();   /* 复用: 避免水精灵每帧 new Matrix */
  let _wasSpeedBuff = false;   /* 身法状态切换检测: 避免每帧调 updateHUD */
  function stageW() { return CW; }
  function floorY() { return CH * 0.92; }
  /* v3.7 三车道: lane 0 最近, 1 居中, 2 最远(靠上)。v3.7.1 对齐新背景的石板路:
   * 石板路可站区间约 0.72~0.94 倍横带高(上方是花草丛, 下方是前景草), 三道按
   * 0.74/0.83/0.92 铺进去 —— 间隔用 CH 比例而非固定像素, 任何横带高度都不越界。
   * 实体的 y 字段 = 车道偏移(负值) —— 特效/伤害数字/宠物/掉落全部从实体 y 推导,
   * 因此只要实体带 y, 整条表现链自动跟道, 无需逐处改坐标。 */
  /* v5.0 取消"车道", 地面纵深改为连续坐标(原 3 道 0.74/0.83/0.92 CH)。
   * 原来 lane 是 3 个离散索引, 换道必然跳变; 现在实体的 y 直接是地面纵深像素
   * (0 = 最近/屏幕下方, 负值向上), 位置连续可插值, 移动自然丝滑。
   * 保留 lane 字段仅作兼容(值为由 y 反推的浮点数), 判定一律走二维像素距离。
   *
   * 地面带: 沿用原三车道覆盖的区间 —— 屏幕 y ∈ [0.74CH, 0.92CH], 即偏移
   * y ∈ [-(0.18)CH, 0]。深度用 DEPTH 表示(0 最近, 1 最远), y = -DEPTH * DEPTH_PX。 */
  function laneGap() { return CH * 0.09; }          /* 兼容旧调用: 一个身位的纵深尺度 */
  function depthPx() { return CH * 0.18; }          /* 地面带总深 ≈ 55px(CH=306 时) */
  function depthToY(d) { return -Math.max(0, Math.min(1, d || 0)) * depthPx(); }
  function yToDepth(y) { return Math.max(0, Math.min(1, -(y || 0) / depthPx())); }
  /* 兼容层: laneOff(lane) 把 0~1 的纵深比例映射成 y */
  function laneOff(lane) { return depthToY(typeof lane === 'number' && lane > 1 ? lane / (LANES - 1) : lane); }
  function laneAt(y) { return yToDepth(y); }
  function lanePos(lane) { return Math.max(0, Math.min(1, typeof lane === 'number' && lane > 1 ? lane / (LANES - 1) : (lane || 0))); }
  /* 纵深缩放: 最近 1.0 → 最远 0.86(与原三车道端点一致), 连续插值不再分档 */
  function laneScale(lane) { return 1 - lanePos(lane) * 0.14; }
  const LANES = 2;          /* 兼容占位: 旧的"道数"概念已废弃, 仅防越界引用 */
  const MID_LANE = 0.42;    /* 起始纵深比例(约原中道位置) */
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
    /* v6.7 PERF: 2D 降级路径的 CSS filter 也关掉。
     * 之前误以为 CSS filter 零开销, 实际上它会强制浏览器对该 canvas 做离屏合成 + 每帧
     * GPU 后处理(亮度/饱和度), 高 DPR 屏上像素量 2.25 倍, 是移动端帧率杀手。
     * WebGL canvas 在 v4.4 已移除滤镜, 这里同步关闭 2D 降级路径, 避免切降级时重新出现。 */
    /* cv.style.filter = 'saturate(0.85) brightness(0.93)'; */
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

  function drawBg() {
    /* v3.7 幽夜森林背景: 随摄像机 0.5 视差滚动, 【镜像交替平铺】实现左右无限无缝拼接。
     * v4.0 WebGL: Sprite 池交替正/镜像摆位（scale.x=-1 等价原 translate+scale(-1,1)）。 */
    if (G.bgReady && G.bgImg) {
      const drawH = CH;                           /* 画满整条战斗横带(地板下方延续石板路, 无黑边) */
      const drawW = drawH * (G.bgImg.width / G.bgImg.height);
      const period = drawW * 2;
      const off = ((G.camX * 1.0) % period + period) % period;   /* v4.4: 视差 0.5→1.0, 地面滚动与玩家移速同步, 走路频率/步伐/地图三者归一 */
      const y0 = CH - drawH;
      const n0 = Math.floor(off / drawW);
      const tiles = window.BattleGL.layers.bg._tiles;
      const need = Math.min(8, Math.ceil(CW / drawW) + 2);
      const pool = drawBg._pool || (drawBg._pool = []);
      /* v4.8 FIX: need 只是估算, 实际循环条件由 x > CW 推出 —— 两者在
       * drawW 很小(窄图/大 CH)或 off 靠边界时会差 1~2 个, 直接 pool[k++] 会取到
       * undefined 并在下一行 s.visible 抛错, 整帧渲染中断(画面全黑)。
       * 改为边用边补, 不再依赖预估。 */
      while (pool.length < need + 2) { const s = new PIXI.Sprite(); tiles.addChild(s); pool.push(s); }
      const tex = window.BattleGL.tex(G.bgImg);
      let k = 0;
      for (let n = n0; ; n++) {
        const x = n * drawW - off;
        if (x > CW) break;
        if (k >= 12) break;                                  /* v4.8 硬上限: 再多必然异常 */
        while (pool.length <= k) { const s = new PIXI.Sprite(); tiles.addChild(s); pool.push(s); }
        const s = pool[k++];
        s.visible = true;
        s.texture = tex;
        s.y = y0;
        if (n % 2 === 0) { s.x = x; s.scale.set(drawW / G.bgImg.width, drawH / G.bgImg.height); }
        else { s.x = x + drawW; s.scale.set(-drawW / G.bgImg.width, drawH / G.bgImg.height); }
      }
      for (; k < pool.length; k++) pool[k].visible = false;
    }
    /* v6.8: 程序云已删除。背景图未就绪时由 webgl-battle.js 的 bgGradSprite 渐变兜底,
     * 不在此处补云(用户要求云完全移除, 且云被战斗层盖住根本看不到)。 */
  }

  /* v4.3 前景遮挡层(红线以下视觉遮挡): 专用前景贴图 battle-forest-fg.webp —— 从背景
   * 裁出左右下角水晶区域抠图 + 底部草沿, 拼回与背景同尺寸(1600×800)的整图。
   * 与 drawBg 完全同一套平铺几何(同 0.5 视差/同镜像交替/同拉伸比/同 y=0), 像素级
   * 对齐背景图 —— 水晶"长回"背景上, 压在所有实体之上, 大模型尾巴/腿不再遮挡水晶;
   * 草沿自然盖住实体脚踝, 无硬截断线。
   * 掉落物(drops 层)画在前景之上 —— 水晶躺在前景草上, 永不被实体遮挡。 */
  function drawForeground() {
    if (!G.fgReady || !G.fgImg) return;   // fg 未就绪时跳过(无遮挡, 退化原状)
    const drawH = CH;
    const drawW = drawH * (G.fgImg.width / G.fgImg.height);
    const period = drawW * 2;
    const off = ((G.camX * 1.0) % period + period) % period;   /* v4.4: 视差 0.5→1.0, 与背景同步 */
    const n0 = Math.floor(off / drawW);
    const fgC = window.BattleGL.layers.foreground;
    const need = Math.min(8, Math.ceil(CW / drawW) + 2);
    const pool = drawForeground._pool || (drawForeground._pool = []);
    while (pool.length < need) { const s = new PIXI.Sprite(); fgC.addChild(s); pool.push(s); }
    if (!drawForeground._tex || drawForeground._img !== G.fgImg) {
      drawForeground._tex = window.BattleGL.tex(G.fgImg);
      drawForeground._img = G.fgImg;
    }
    const tex = drawForeground._tex;
    let k = 0;
    for (let n = n0; ; n++) {
      const x = n * drawW - off;
      if (x > CW) break;
      if (k >= 12) break;   /* v4.8 硬上限 */
      while (pool.length <= k) { const s = new PIXI.Sprite(); fgC.addChild(s); pool.push(s); }
      const s = pool[k++];
      s.visible = true;
      s.texture = tex;
      s.y = 0;
      if (n % 2 === 0) { s.x = x; s.scale.set(drawW / G.fgImg.width, drawH / G.fgImg.height); }
      else { s.x = x + drawW; s.scale.set(-drawW / G.fgImg.width, drawH / G.fgImg.height); }
    }
    for (; k < pool.length; k++) pool[k].visible = false;
  }

  /* v4.0 WebGL: 血条/法环 → Pixi Graphics。layerName 指定绘制层(farUI/nearUI/playerUI)，
   * 该层 Graphics 每帧 render 前清空，重画顺序与原 2D 完全一致。
   * 原水平渐变按中点取纯色近似(3px 高的渐变肉眼不可辨)。 */
  const HPBAR_COL = { e: 0xe84038, g: 0x4cd964, y: 0xe4bc54, r: 0xf46050 };   /* v4.4: 玩家高血量绿 0x55cc90(偏青蓝绿)→0x4cd964(标准浅绿) */
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

  /* v2.9 PERF: 横扫千军帧级离屏缓存(左右渐隐贴图), 尺寸固定 280×drawH 故只需按帧号缓存 */
  const HENGSAO_MASK = { frames: null };

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
        const frameIdx = pet.flyFrame % 32;
        /* 渲染尺寸: 宠物较小, 约玩家的60% */
        const drawH = Math.min(CH * 0.35, 52);
        const drawW = drawH * (PET_SPRITE.fw / PET_SPRITE.fh);
        S.main.visible = true;
        S.main.texture = frameTex(G.petFoxSprite, PET_SPRITE.cols, PET_SPRITE.fw, PET_SPRITE.fh, frameIdx);
        /* 向左飞: 水平镜像(素材默认朝右) —— scale.x 取负 */
        S.main.scale.set((drawW / PET_SPRITE.fw) * (pet.face === -1 ? -1 : 1), drawH / PET_SPRITE.fh);
        S.main.position.set(sx, sy);
      }
      /* 灵鹰 sprite 渲染 */
      else if (G.petEagleReady && G.petEagleSprite && pet.type === 'eagle') {
        const EAGLE_SPRITE = { cols: 10, fw: 704, fh: 580 };
        const EAGLE_ATK = { cols: 8, fw: 719, fh: 505 };
        /* 发射弹幕时播攻击帧, 否则飞行动画 */
        const isAttacking = pet.boltAnim > 0;
        const frameIdx = isAttacking
          ? (16 - Math.ceil(pet.boltAnim / 0.075))  /* 攻击16帧, 0.075秒/帧 */
          : pet.flyFrame % 30;
        const drawH = Math.min(CH * 0.40, 64);
        const drawW = isAttacking
          ? drawH * (EAGLE_ATK.fw / EAGLE_ATK.fh)
          : drawH * (EAGLE_SPRITE.fw / EAGLE_SPRITE.fh);
        S.main.visible = true;
        S.main.texture = isAttacking
          ? frameTex(G.petEagleAtkSprite, EAGLE_ATK.cols, EAGLE_ATK.fw, EAGLE_ATK.fh, frameIdx)
          : frameTex(G.petEagleSprite, EAGLE_SPRITE.cols, EAGLE_SPRITE.fw, EAGLE_SPRITE.fh, frameIdx);
        S.main.scale.set((drawW / (isAttacking ? EAGLE_ATK.fw : EAGLE_SPRITE.fw)) * (pet.face === -1 ? -1 : 1), drawH / (isAttacking ? EAGLE_ATK.fh : EAGLE_SPRITE.fh));
        S.main.position.set(sx, sy);
        /* ⚠️ v8.5 移除(勿加回): 这里原本是"施法特效光环"(pet.casting → heal/atk 柔光)。
         * 那是灵狐的施法系统, 灵鹰继承了它才冒出一圈光环。灵鹰只攻击, 不施法。 */
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

    /* v5.14 渲染弹道残影(拖尾) —— 与弹幕同贴图, ADD 混合, alpha 渐隐, 比弹体细一档 */
    if (G.petEagleBoltReady && G.petEagleBoltSprite && G.eagleTrails && G.eagleTrails.length) {
      if (!G._boltTrailPool) G._boltTrailPool = [];
      const tn = G.eagleTrails.length;
      while (G._boltTrailPool.length < tn) {
        const spr = new PIXI.Sprite(window.BattleGL.tex(G.petEagleBoltSprite));
        spr.anchor.set(0.5, 0.5);
        spr.blendMode = PIXI.BLEND_MODES.ADD;
        window.BattleGL.layers.fx.addChild(spr);   /* 与弹幕同层: near 之上、text 之下 */
        G._boltTrailPool.push(spr);
      }
      for (let i = 0; i < G._boltTrailPool.length; i++) {
        const spr = G._boltTrailPool[i];
        if (i < tn) {
          const tr = G.eagleTrails[i];
          spr.visible = true;
          spr.position.set(tr.x, tr.y);
          spr.rotation = tr.rot;
          spr.alpha = tr.a;
          const tex = spr.texture;
          if (tex && tex.width && tex.height) {
            const ar = tex.width / tex.height;
            spr.height = 12;
            spr.width = 12 * ar;
          } else { spr.width = 56; spr.height = 26; }
        } else {
          spr.visible = false;
        }
      }
    } else if (G._boltTrailPool) {
      for (const spr of G._boltTrailPool) spr.visible = false;
    }

    /* 渲染灵鹰弹幕(对象池复用) */
    if (G.petEagleBoltReady && G.petEagleBoltSprite && G.eagleBolts) {
      if (!G._boltPool) G._boltPool = [];
      const needed = G.eagleBolts.length;
      /* 补足池 */
      while (G._boltPool.length < needed) {
        /* ⚠️ v8.3 致命 BUG 修复(勿回退) —— "卡屏 + 技能放不出来" 的根因:
         * 旧实现写的是 `new PIXI.Sprite(G.petEagleBoltSprite)`, 直接把 solidify()
         * 返回的【canvas】当参数传了。PIXI.Sprite 首参只认 Texture, 传 canvas 会在
         * 构造器内部解构纹理帧时报 `Cannot read properties of undefined (reading 'x')`
         * → 异常从 drawPets 抛出 → render 中断 → 整个 tick 循环挂掉。
         * 表现就是用户说的"卡屏 + 技能也放不出来"(update/render 都不再推进)。
         * 正确做法: 先 BattleGL.tex(canvas) 转纹理, 再构造 Sprite —— 与宝箱 icon
         * (1728 行 o.icon.texture = BattleGL.tex(...)) 用的是同一套约定。 */
        const spr = new PIXI.Sprite(window.BattleGL.tex(G.petEagleBoltSprite));
        /* ⚠️ v8.3 修复(勿回退): 旧代码写 `window.BattleGL.stage.addChild(spr)`,
         * 但 BattleGL 对外【没有 stage 这个属性】(内部场景根叫 root, 私有),
         * 属性为 undefined → `.addChild` 抛 TypeError → 中断 render 循环。
         * 弹幕属于"飞出去的攻击特效", 挂在 fx 层 —— 与所有 skillShot/粒子一致,
         * z 序也在 near 之上、text 之下, 不会被怪挡住。
         * 另: 构造器首参必须是【Texture】。旧代码传的是 solidify() 的 canvas,
         * PIXI 解构纹理帧时会抛 `Cannot read properties of undefined`, 即"卡屏"根因
         * (见 1728 行宝箱 icon 的同一套约定: 一律先 BattleGL.tex() 转纹理)。 */
        spr.anchor.set(0.5, 0.5);
        window.BattleGL.layers.fx.addChild(spr);
        G._boltPool.push(spr);
      }
      /* 更新位置 + 朝向校正 */
      for (let i = 0; i < G._boltPool.length; i++) {
        const spr = G._boltPool[i];
        if (i < needed) {
          const b = G.eagleBolts[i];
          spr.visible = true;
          spr.position.set(b.x, b.y);
          spr.alpha = 0.9;
          /* ⚠️ v8.7 靶向校正(勿删) —— 弹幕要"看着是朝目标飞"。
           * 素材原图是 1024×1024 无透明通道的 RGB, 黑底直接当弹幕用了(豆包没抠图)。
           * 处理成两步, 都在素材侧做掉, 代码只留一个纯旋转:
           *   ① 抠图: 按亮度(A近黑底, 弹体亮)生成 alpha 通道, 再取最大连通域去掉
           *      零星噪点。素材是"拖尾暗、弹头亮"的能量箭, 亮度即天然的遮罩。
           *   ② 摆正: 原图构图是 45° 对角(拖尾左上/弹头右下), 已预旋转 45° 使其
           *      【默认朝右】, 实测主轴由 45.1° 变成 180.0°(水平)、光心偏右 +189px、
           *      亮度峰值在右端 —— 确认箭头朝右。裁紧后 1320×314(约 4.2:1 长条)。
           * 因为素材已经摆正, 这里只需要 rotation = 飞行方向角, 不再有 45° 偏置。
           * 换素材时重测"主轴角/箭头端"即可, 若新素材自带偏置就在此减掉。 */
          const dx = (b.tx - b.x), dy = (b.ty - b.y);
          spr.rotation = Math.atan2(dy, dx);
          /* 尺寸按素材真实宽高比展开(旧代码写死 60×30, 与素材比例完全不符会被压扁)。
           * 素材摆正后是 1320×314 的长条(约 4.2:1), 以【短边】为基准定档再按比例推长边,
           * 这样不管素材多长, 视觉"粗细"都稳定, 不会被拉伸成一根细线。 */
          const BOLT_THICK = 16;                      /* 弹幕短边(垂直飞行方向上的宽度) */
          const tex = spr.texture;
          if (tex && tex.width && tex.height) {
            const ar = tex.width / tex.height;        /* >1, 长条 */
            spr.height = BOLT_THICK;
            spr.width  = BOLT_THICK * ar;
          } else {
            spr.width = 74; spr.height = 34;
          }
        } else {
          spr.visible = false;
        }
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
  function drawEnemies(startIdx, endIdx, batch) {
    const batchC = window.BattleGL.layers[batch === 'near' ? 'near' : 'far'];
    const uiLayer = batch === 'near' ? 'nearUI' : 'farUI';
    /* v5.0 同层内按纵深排序绘制(近盖远): 原按数组顺序画, 同层怪互相重叠时
     * 遮挡关系取决于入队顺序而非前后位置。地面已是连续纵深, 直接按 y 降序
     * (y 大 = 靠屏幕下方 = 更近 = 后画) 即为正确的画家顺序。 */
    for (let li = startIdx; li < endIdx; li++) {
      const e = _drawList[li];
      const sx = worldToScreen(e.x); const sy = floorY() + e.y;   /* v3.7: 怪站自己的车道 */
      /* v3.9 通用骨骼怪分支(链最前): 所有带 armature 的怪 —— 鼠妖/僵尸/妖狐/…/骨骼BOSS 统一走这。
       * 体型缩放用 idle 基准高(BONES.baseH 建厂时测定, 避免动画间呼吸式缩放);
       * 落地对齐用当前姿态 AABB 底边中心; drawH/血条宽 per-怪配置(素材分辨率无关)。 */
      if (e.armature && e.boneSlug && BONES[e.boneSlug] && BONES[e.boneSlug].ready) {
        const B = BONES[e.boneSlug];
        const def = BC.enemies[e.type] || {};
        const cap = def.isBoss ? CH * 0.7 : CH * 0.5;
        const drawH = Math.min(cap, e.drawH || def.drawH || 84) * (def.isBoss ? 1 : (e.elite ? 1.28 : 1)) * laneScale(yToDepth(e.y));
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
        const drawH = Math.min(CH * 0.5, 72) * (e.elite ? 1.28 : 1) * laneScale(yToDepth(e.y));
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
        /* 渲染尺寸: 适配战斗区高度(v3.7: 随车道纵深缩放) */
        const drawH = Math.min(CH * 0.5, 70) * (e.elite ? 1.28 : 1) * laneScale(yToDepth(e.y));
        const drawW = drawH * (WATER_SPRITE.fw / WATER_SPRITE.fh);
        /* 脚底在帧中的y=118(距底部10px) */
        const footOffset = 118 * (drawH / WATER_SPRITE.fh);
        const spr = enemySpriteGL(e, batchC);
        spr.texture = frameTex(G.waterSprite, WATER_SPRITE.cols, WATER_SPRITE.fw, WATER_SPRITE.fh, frameIdx);
        /* 原变换链(压缩0.92 + skewX(-0.03) 校正)线性合成 —— canvas 矩阵语义
         * x'=(dw/fw)x - 0.03·(drawH/fh)y + sx - dw/2 + 0.03·0.92·fo ; y'=(drawH/fh)y + sy - fo */
        _waterMat.set(drawW / WATER_SPRITE.fw, 0,
          -0.03 * drawH / WATER_SPRITE.fh, drawH / WATER_SPRITE.fh,
          sx - drawW / 2 + 0.03 * 0.92 * footOffset, sy - footOffset);
        spr.transform.setFromMatrix(_waterMat);
        enemyFxGL(spr, e);
        /* 水精灵面朝左, 素材本身就是面朝左, 不需要翻转 */
        if (e.elite && e.alive) drawEliteRing(uiLayer, sx, sy, 16);
        if (e.alive) drawHpBar(uiLayer, sx, sy - footOffset - 4, 28, e.hp, e.maxHp, true);
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

  /* ══ v4.8 技能怪弹道系统 ═══════════════════════════════════════════════
   * 素材包( Aekashics Librarium )是纯角色动画包, 不含任何飞行物特效 ——
   * 所以 29 只技能怪的弹道全部由本段程序化生成, 零图片资源。
   *
   * 【不抢画面的四条硬约束】
   *  1. 尺寸克制   : 弹体高度一律 <= 14px, 约玩家身高的 1/5, 绝不盖住角色
   *  2. 不透明度   : 峰值 alpha <= 0.85, 且用 ADD 加法混合 —— 压在角色身上是"透亮"而非"盖色"
   *  3. 配色同源   : 每类一个签名色(见 SKILL_KIND.rgb), 全场只有 5 种技能色, 不跳色
   *  4. 寿命极短   : 单体弹 <= 0.55s, 落柱/地刺 <= 0.45s; 同屏同时最多 6 条弹道
   *
   * 每类只生成 4 张底图(形状源), 运行时靠缩放/拉伸/帧序做出"花样"
   * —— 花样是参数化的, 不是画出来的, 这样既省资源又不会视觉过载。
   *
   * ⚠️ 首版踩过的三个坑(已修, 别再改回去):
   *   a. def.color 对 79 只怪池是 undefined(monsters_flat.json 里根本没这个字段),
   *      于是 skillTint(undefined) 让全部 29 只弹道都变成同一个灰蓝 ——
   *      现在改为按【技能类】取签名色, 不再读 def.color。
   *   b. 光柱底图被横向拉伸后, 两端的淡出被压成硬直角, 画面上是一个"灰白方框"。
   *      现在 column 的横向淡出只占 18%, 且弹体额外叠一层 core 柔光收口。
   *   c. 弹道 y 用了 e.y - drawH*0.42, 对高个怪直接飘到半空。
   *      现在按 floorY 与怪身高的实际比例定位, 近地技能贴地、空中技能才上浮。
   * ──────────────────────────────────────────────────────────────────── */

  /* 色相派生: 从给定色算出一个"同色系但更亮"的技能色, 保证不跳色。
   * 注意入参是【技能类签名色】, 不是 def.color —— 见上方坑 a。 */
  function skillTint(hex, up = 1.0) {
    const h = (hex || '#8899aa').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
    const r = Math.min(255, ((n >> 16) & 255) * up + 40);
    const g = Math.min(255, ((n >> 8) & 255) * up + 40);
    const b = Math.min(255, (n & 255) * up + 40);
    return `${r | 0},${g | 0},${b | 0}`;
  }
  function tintToInt(rgb) {
    const [r, g, b] = rgb.split(',').map(Number);
    return (r << 16) | (g << 8) | b;
  }

  /* ---- 底图: v4.9 改用生图模型生成的素材(替代代码绘制的程序化贴图) ----
   * shard = 光球(通用, tint变橙黄/金白/青绿), spike = 尖锥朝右(通用, tint变暗紫/青蓝)
   * 纯黑底 + ADD 混合 = 黑色不可见, 发光部分透亮, 正好适合弹道特效。 */
  const SK_TEX = {
    shard: 'assets/skill_orb.webp',
    spike: 'assets/skill_spike.webp',
  };

  /* 5 类技能的参数表 —— 改这里就能调手感, 不用碰绘制代码。
   * rgb  = 该类签名色(全 29 只共用 5 种色, 这是"控制花样"的关键:
   *        花样靠尺寸/时序/条数变化, 不靠颜色堆砌)
   * alt  = 近地高度系数(0=贴地, 1=怪身高处), 决定弹道从怪的哪个部位射出
   * len/thick 是【基准像素】, 且会被参照玩家身高放大到 minLenPx 以上 ——
   *        首版 len 26/thick 9 在 1200x300 的画面里只有 29x9px, 峰值 alpha 0.78
   *        也救不回来, 实测肉眼完全看不见("发了但没看见"的第二个原因)。
   *        现在按 玩家身高 的比例给下限, 保证"看得见"这个底线先满足。 */
  const PLAYER_H = 92;                     /* 玩家基准身高(与 SPRITE 尺寸同量级) */
  const SKILL_KIND = {
    /* v4.9 全部统一为 3 连发飞行弹机制(原 2/3 类原地光柱/藤蔓用户不满意),
     * 各类靠颜色+形态+尺寸区分, 不再有"不飞"的技能。
     * track = 追踪强度(0~1), 弹道朝玩家位置偏移, 前20%不追踪避免刚发射就拐弯。 */
    /* 1 暗影弹: 3连发, 暗紫尖锥 */
    1: { tex: 'spike', blend: 'ADD', rgb: '#a06ae8', len: 40, thick: 14, minLen: 0.40, dur: 0.46,
         speedK: 1.0, alpha: 0.88, spread: 0.08, count: 3, trail: 0.45, gap: 0.07, alt: 0.62, track: 0.35 },
    /* 2 神光弹: 3连发, 金白光球, 更大更亮 */
    2: { tex: 'shard', blend: 'ADD', rgb: '#ffd98a', len: 26, thick: 26, minLen: 0.26, dur: 0.46,
         speedK: 1.05, alpha: 0.90, spread: 0.08, count: 3, trail: 0.30, gap: 0.07, alt: 0.65, track: 0.30 },
    /* 3 藤蔓弹: 3连发, 青绿光球 */
    3: { tex: 'shard', blend: 'ADD', rgb: '#6ad89a', len: 22, thick: 22, minLen: 0.22, dur: 0.46,
         speedK: 1.1, alpha: 0.85, spread: 0.10, count: 3, trail: 0.35, gap: 0.075, alt: 0.58, track: 0.40 },
    /* 4 弹幕扫射: 3连发, 橙黄小子弹(用户满意, 保持不变) */
    4: { tex: 'shard', blend: 'ADD', rgb: '#ffb45c', len: 22, thick: 22, minLen: 0.22, dur: 0.46,
         speedK: 1.15, alpha: 0.85, spread: 0.10, count: 3, trail: 0.35, gap: 0.075, alt: 0.58, track: 0.25 },
    /* 5 吐息弹: 3连发, 青蓝尖锥, 更大 */
    5: { tex: 'spike', blend: 'ADD', rgb: '#5cd0ff', len: 52, thick: 18, minLen: 0.52, dur: 0.48,
         speedK: 0.95, alpha: 0.82, spread: 0.06, count: 3, trail: 0.40, gap: 0.08, alt: 0.68, track: 0.30 },
  };

  /* 弹道存活表 —— 同屏节流, 保证画面干净 */
  const SK_LIVE = [];
  const SK_MAX_LIVE = 6;

  /* 怪种 → 技能类(1暗影弹 2神光柱 3自然藤蔓 4弹幕扫射 5巨型吐息)。
   * 由 /workspace/技能怪映射表.md 生成, 只列 29 只技能怪; 其余怪种走普通近战表现。 */
  const SK_OF = {
    ancient_automaton: 2, animated_drill_dwarf: 4, arcane_golem: 2,
    bonemask_shadow_creature: 1, clockwork_skull: 2, cultist_mage: 1,
    dragon_huanglong: 5, dryad_queen_rafflesia: 3, eldritch_overmind: 5,
    goblin_machine_gun: 4, god_warrior_dagon: 2, god_warrior_osiris: 2,
    goddess_aphrodite: 2, grand_sorceress_duesa: 1, gun_mimic: 4,
    jiangshi: 3, jubokko: 3, king_archial: 4,
    librarium_animated_mechadragon_ladon: 5, mageshroom: 3,
    mecha_rattlesnake: 4, mermaid_warrior_undeen: 4, poseidon: 4,
    slime_flynn: 1, son_of_valhalla: 5, the_fallen: 1,
    the_horde: 5, thunder_titan_dynamo: 5, witch_baba: 1,
  };
  /* 29 只技能怪的实测攻距(px)。来源: /workspace/技能怪映射表.md
   * 算法 = 玩家半宽 58.3 + 该怪技能姿态的前伸量(逐帧量骨架, 按身高归一化后乘渲染高)。
   * 两张手工修正: god_warrior_dagon 357→173(dark star 脱离身体), 
   *              mecha_rattlesnake 263→147(蜷曲蛇身, 骨链平铺虚长)。 */
  const SK_RANGE = {
    ancient_automaton: 174, animated_drill_dwarf: 174, arcane_golem: 170,
    bonemask_shadow_creature: 146, clockwork_skull: 122, cultist_mage: 112,
    dragon_huanglong: 144, dryad_queen_rafflesia: 143, eldritch_overmind: 154,
    goblin_machine_gun: 147, god_warrior_dagon: 173, god_warrior_osiris: 167,
    goddess_aphrodite: 129, grand_sorceress_duesa: 172, gun_mimic: 137,
    jiangshi: 105, jubokko: 115, king_archial: 151,
    librarium_animated_mechadragon_ladon: 112, mageshroom: 124,
    mecha_rattlesnake: 147, mermaid_warrior_undeen: 147, poseidon: 158,
    slime_flynn: 108, son_of_valhalla: 191, the_fallen: 210,
    the_horde: 181, thunder_titan_dynamo: 127, witch_baba: 126,
  };

  /* 由怪种 + 技能类发一条弹道。v4.9 从怪身前胸口发射, 2 维瞄准玩家, 飞行中弱追踪。 */
  function spawnSkillFx(e, def, kind, dir) {
    if (SK_LIVE.length >= SK_MAX_LIVE) SK_LIVE.shift();   /* 超限丢最老的, 不排队 */
    const k = SKILL_KIND[kind] || SKILL_KIND[1];
    const dh = def.drawH || 84;
    /* 起点: 怪身前一点(不是身内, 否则弹道从怪身上"长"出来), 高度由 alt 决定(胸口附近) */
    const ox = e.x + dir * dh * 0.16;
    /* v5.12 FIX: 发射口不高于玩家胸口 —— 敌方全是地面单位, dh*alt 对高个怪/BOSS 会算到
     * 60~88px(玩家胸口=46px), 同车道时 tdy 恒 +6~+42px, 弹道永久俯射(BOSS 实测 ~19°)。
     * clamp 后 tdy≤0: 只平射或微仰, 与"地面互射"观感一致; 矮怪(dh*alt<46)不受影响,
     * 保留自然仰射。弹道纯表现层(伤害发射帧已结算), 数值零影响。 */
    const oy = e.y - Math.min(dh * k.alt, PLAYER_H * 0.5);
    /* 2 维瞄准: 从发射点朝玩家当前位置算归一化方向向量; 玩家不存在时退化为水平朝向。
     * v5.11 FIX: 目标点取玩家【胸口】(脚底减半身高) 而非脚底 —— 旧代码发射点在怪胸口
     * (oy = e.y - dh*alt, 高于地面), 目标却是玩家脚底(车道偏移), tdy 恒为正 ≈ dh*alt,
     * 弹道永远向下倾斜(近距时低达 30~40°), 表现为"远程怪往下攻击"。两侧同高后弹道水平。 */
    let dx = dir, dy = 0;
    if (G.player) {
      const tdx = G.player.x - ox;
      const tdy = (G.player.y - PLAYER_H * 0.5) - oy;   /* 均为地板相对坐标, 可直接相减 */
      const dist = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
      dx = tdx / dist; dy = tdy / dist;
    }
    const rgb = skillTint(k.rgb, 1.0);
    const shot = (delay, spreadY) => ({
      kind: 'skillShot', sk: kind, rgb, tex: k.tex, blend: k.blend,
      x: ox, y: oy + spreadY, dir, dx, dy,
      len: Math.max(k.len, (k.minLen || 0) * PLAYER_H), thick: k.thick,
      travel: (e.atkRange || 120) * k.speedK,
      t: -delay, dur: k.dur + delay,
      a0: k.alpha, trail: k.trail, spread: k.spread, track: k.track || 0,
    });
    /* v4.9 所有技能均为 3 连发: 错开时间 + 轻微纵向散, 做出"连点"感 */
    for (let i = 0; i < k.count; i++) SK_LIVE.push(G.fx[G.pushFx(shot(i * (k.gap || 0.08), (i - 1) * 5)) - 1]);
  }
  /* 回收: 弹道走完从存活表移除 */
  function reapSkillFx() {
    for (let i = SK_LIVE.length - 1; i >= 0; i--) if (SK_LIVE[i].t >= SK_LIVE[i].dur) SK_LIVE.splice(i, 1);
  }
  /* 验收台重置用：G.fx 被清空后 SK_LIVE 里的记录就成了悬空引用，
   * 会一直占着同屏配额（最多 6 条）导致新弹道刚发就被 shift 掉。 */
  window.__clearSkillLive = () => { SK_LIVE.length = 0; };

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
  /* 玩家渲染对象组: 主 Sprite + ADD 柔光 + 占位 Graphics */
  function playerGL() {
    const S = drawPlayerSprite._st;
    if (S) return S;
    const C = window.BattleGL.layers.player;
    const st = { main: new PIXI.Sprite(), glow: new PIXI.Sprite(), place: new PIXI.Graphics() };
    st.glow.anchor.set(0.5);
    st.glow.blendMode = PIXI.BLEND_MODES.ADD;
    C.addChild(st.glow);
    C.addChild(st.place);
    C.addChild(st.main);
    return drawPlayerSprite._st = st;
  }
  function drawPlayerSprite() {
    const p = G.player;
    const sx = Math.round(worldToScreen(p.x));   /* v4.4: 取整消除亚像素采样导致的边缘软化 */
    const sy = Math.round(floorY() + p.y);   /* v3.7: 玩家随车道(y 为车道偏移, 平滑过渡); v4.4: 取整 */
    const S = playerGL();
    S.main.visible = S.glow.visible = S.place.visible = false;
    const hurtOn = false;   /* v5.0 关掉玩家受击闪烁(alpha正弦+黑白filter), 用户反馈闪来闪去太晃 */
    /* v6.1 三套帧共用的「角色目标视觉高」: 旧渲染里 drawH 是画布高, 真正的人物高度
     * = drawH × 内容占比(普攻 0.960 / 技能起手仅 0.672), 两套素材不一样才导致换动作
     * 就变形。这里先算出统一的人高, 再由每帧内容高反推该帧应该画多大的画布。 */
    const ls = laneScale(yToDepth(p.y));
    const bodyH = Math.min(CH * 0.5, 80) * BODY_RATIO * ls;

    /* 技能动画渲染 (剑气斩) */
    if (p.skillAnim && G.skillReady && G.skillSprite) {
      const frameIdx = Math.min(p.skillFrame, SKILL.count - 1);
      const boxH = SKILL_BOX_H[frameIdx] || 172;
      const boxB = SKILL_BOX_B[frameIdx] || 234;
      const boxCX = SKILL_BOX_CX[frameIdx] || 180;
      const sk = bodyH / boxH;                  /* 帧像素 → 游戏像素 */
      S.main.visible = true;
      S.main.texture = frameTex(G.skillSprite, SKILL.cols, SKILL.fw, SKILL.fh, frameIdx);
      /* 锚点 = 人物脚底中心(BOX_CX), 与走路渲染的脚底锚定同口径:
       * 人物钉在 sx 不横跳, 月牙特效按帧内原始相对位置跟随, 跟着一起变大。 */
      S.main.position.set(sx - boxCX * sk, sy - boxB * sk);
      S.main.scale.set(sk, sk);
      S.main.alpha = 1; S.main.filters = null;
      if (hurtOn) { S.main.alpha = 0.5+0.5*Math.sin(p.hurtT*40); S.main.filters = [window.BattleGL.Filters.playerHurt]; }
      /* 技能发光效果(原 shadowBlur 青蓝光) → ADD 柔光垫底
       * v6.1: 光晕/血条统一挂在「人高」上, 与普攻完全同口径, 不再跟着画布高抖。 */
      S.glow.visible = true;
      S.glow.texture = window.BattleGL.tex(GLOW.skill);
      S.glow.position.set(sx, sy - bodyH * 0.5);
      S.glow.width = S.glow.height = bodyH * 1.6;
      S.glow.alpha = 0.45;
      drawHpBar('playerUI', sx, sy - bodyH - 10, 36, p.hp, p.maxHp);
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
    /* v6.1 同样按内容包围盒渲染: 人高锁定 bodyH, 画布高由该帧内容高反推,
     * 底边贴 sy。基准仍是 min(CH*0.5,80)(v4.4 高清素材), 数值与旧渲染只差 1~2%。 */
    const boxH = SPRITE_BOX_H[frameIdx] || BODY_REF_H;
    const boxB = SPRITE_BOX_B[frameIdx] || SPRITE.fh;
    const bs = bodyH / boxH;
    const drawW = SPRITE.fw * bs;
    S.main.visible = true;
    S.main.texture = frameTex(G.sprite, SPRITE.cols, SPRITE.fw, SPRITE.fh, frameIdx);
    /* 用内容底边贴地板(旧版是画布底边贴地, 素材里脚下方留白不同就一高一低) */
    S.main.position.set(sx - drawW*0.35, sy - boxB * bs);
    S.main.scale.set(bs, bs);
    S.main.alpha = 1; S.main.filters = null;
    if (hurtOn) { S.main.alpha = 0.5+0.5*Math.sin(p.hurtT*40); S.main.filters = [window.BattleGL.Filters.playerHurt]; }
    /* 攻击buff/加速光晕(原 shadowBlur) → ADD 柔光垫底 */
    let glowTex = null, glowA = 0;
    if (p.atkBuff > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(G.t * 6);
      glowTex = GLOW.atk; glowA = 0.15 + pulse*0.10;
    }
    if (G.speedMult > 1) {
      glowTex = GLOW.speed3 ? (G.speedMult >= 3 ? GLOW.speed3 : GLOW.speed1) : GLOW.speed1;
      glowA = Math.max(glowA, G.speedMult >= 3 ? 0.4 : 0.3);
    }
    if (glowTex) {
      S.glow.visible = true;
      S.glow.texture = window.BattleGL.tex(glowTex);
      S.glow.position.set(sx - drawW*0.35 + drawW/2, sy - bodyH/2);
      S.glow.width = S.glow.height = bodyH * 1.5;
      S.glow.alpha = glowA;
    }
    /* 血条: 挂人头顶, 与技能态同口径 */
    drawHpBar('playerUI', sx, sy - bodyH - 10, 36, p.hp, p.maxHp);
  }

  function drawFx() {
    /* v4.0 WebGL: 矢量特效(每 f 一个池化 Graphics 每帧重画) + Sprite 特效(掩码帧/柔光)。
     * 速度线: fx 层共享 Graphics。shadowBlur(发灰且费性能)一律由 ADD 柔光或直接略去。 */
    const fxC = window.BattleGL.layers.fx;
    const pool = drawFx._pool || (drawFx._pool = []);
    for (const o of pool) o.__used = false;
    /* 加速期间屏幕速度线: 横向线条从左向右流动(方向修正) */
    const lines = drawFx._lines || (drawFx._lines = (() => { const g = new PIXI.Graphics(); fxC.addChild(g); return g; })());
    lines.clear();
    if (G.speedMult > 1) {
      lines.lineStyle(1, G.speedMult >= 3 ? 0xa0b4ff : 0x80ffc0, 0.15 + (G.speedMult - 1) * 0.1);
      const lineCount = G.speedMult >= 3 ? 12 : 8;
      for (let i = 0; i < lineCount; i++) {
        const y = (i / lineCount) * CH + (G.t * 200 * G.speedMult + i * 37) % CH;
        const x = CW - (G.t * 300 * G.speedMult + i * 53) % CW;
        const len = 30 + Math.random() * 50;
        lines.moveTo(x, y);
        lines.lineTo(x + len, y);
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
          /* v2.9 PERF: 左右渐现渐隐掩码帧按帧号缓存 */
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
        } else {
          /* v5.0 兜底: 素材加载失败时用Graphics画一道金色弧光, 保证特效可见 */
          if (o.spr) o.spr.visible = false;
          o.g.visible = true; g.clear();
          const moveX = (f.startX || f.x) + ((f.endX || f.x+120) - (f.startX || f.x)) * k;
          const sx = worldToScreen(moveX);
          let alpha = k < 0.15 ? k/0.15 : (k < 0.6 ? 1.0 : (1-k)/0.4);
          g.lineStyle(3, 0xffc98a, Math.max(0, alpha*0.9));
          g.arc(sx, fy, 40 + k*30, -0.8, 0.8);
          g.lineStyle(1.5, 0xffffff, Math.max(0, alpha*0.5));
          g.arc(sx, fy, 35 + k*25, -0.6, 0.6);
        }
      } else if (f.kind === 'skillShot') {
        /* v4.8 技能弹道: 全部程序化贴图 + ADD 混合。三条不抢画面的做法:
         *  - 尺寸 <= 16px, 用 sprite 缩放而不是大图
         *  - alpha 峰值 <= 0.78, 且前 20% 渐入 / 后 35% 渐出, 不做突兀消失
         *  - 弹体只有一个 sprite, 直接复用特效池对象, 绝不额外开 Graphics */
        if (f.t < 0) { g.visible = false; continue; }   /* 连发延迟期: 不画 */
        const kx = f.t / f.dur;

        if (!o.spr) { o.spr = new PIXI.Sprite(); fxC.addChild(o.spr); }
        o.g.visible = false;
        o.spr.visible = true;
        o.spr.texture = window.BattleGL.tex(SK_TEX[f.tex]);

        o.spr.blendMode = f.blend === 'NORMAL' ? PIXI.BLEND_MODES.NORMAL : PIXI.BLEND_MODES.ADD;
        /* v5.11 弹道修正(对齐鹰弹 v8.7 先例): spike 素材原弹头朝【左下 27°】(PCA 实测),
         * 已在素材侧预旋转掰正为"默认朝左"(轴水平、弹头在左端中线), 代码不再需要角度偏置。
         * 这里只按飞行方向做纯旋转: v5.12 发射口已 clamp 到玩家胸口, 弹道基本水平
         * (dy≈0 → 无旋转), 仅跨车道透视与追踪时弹头小幅跟随。
         * orb 光球各向同性, 不旋转。 */
        const isSpike = f.tex === 'spike';
        o.spr.anchor.set(f.dir < 0 ? 1 : 0, 0.5);
        o.spr.rotation = isSpike
          ? Math.atan2(f.dy || 0, f.dx || f.dir) - (f.dir < 0 ? Math.PI : 0)
          : 0;

        /* 位置曲线: v4.9 沿 2 维瞄准方向推进(dx/dy 为发射时朝玩家的归一化方向) */
        const adv = f.travel ? f.travel * Math.min(1, kx / 0.8) : 0;
        let px = sx + (f.dx || f.dir) * adv;
        let py = fy + (f.dy || 0) * adv;
        /* v4.9 弹道追踪: 朝玩家当前位置偏移, 前20%不追踪(避免刚发射就拐弯), 后面逐渐追踪到 track 强度。
         * v5.11 FIX: 追踪目标同步改玩家胸口(与发射瞄准一致, 旧口径追脚底会把弹道越追越往下)。 */
        if (f.track && G.player) {
          const trackAmt = f.track * Math.max(0, (kx - 0.2) / 0.8);
          if (trackAmt > 0) {
            const targetX = G.player.x;
            const targetY = fy + (G.player.y - PLAYER_H * 0.5) - (f.y || 0);
            px += (targetX - px) * trackAmt;
            py += (targetY - py) * trackAmt;
          }
        }

        /* 尺寸: 横向类长边= len(含拖尾拉伸), 纵向类(光柱)长边= 成长高度。
         * cone(吐息) 让粗端留在近处、远端收细 —— 靠 thick 的二次衰减做锥形,
         * 而不是把三角贴图整体拉长(那样尖端会被拉平成矩形)。 */
        const breathe = (f.sk === 5 || f.sk === 3) ? 1 + Math.sin(kx * Math.PI) * 0.14 : 1;
        const L = f.len * (1 + (f.trail || 0) * kx) * breathe;
        const taper = (1 - kx * 0.22);
        const W = f.thick * taper * breathe;
        o.spr.width = L;
        o.spr.height = W;
        /* v5.11: spike 素材已预旋转摆正(弹头朝左), 水平镜像仅负责"向右发射"换向;
         * rotation(上方)跟随飞行方向, 二者叠加后弹头始终指向飞行方向 */
        o.spr.scale.x = Math.abs(o.spr.scale.x) * (f.dir < 0 ? 1 : -1);
        o.spr.position.set(px, py);

        const fadeIn = Math.min(1, kx / 0.20), fadeOut = Math.min(1, (1 - kx) / 0.35);
        o.spr.alpha = f.a0 * Math.min(fadeIn, fadeOut);
        o.spr.tint = tintToInt(f.rgb);
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
        const fc = colorInt(f.color);
        /* 冲击波圆环: 从中心向外扩散 */
        g.lineStyle(2, fc, (1-k) * 0.6);
        g.drawCircle(0, 0, 5 + k*35);
        /* 向后气流线: 8条, 从中心向后扩散 */
        g.lineStyle(1.8, fc, (1-k) * 0.9);
        for (let i=0; i<8; i++) {
          const ang = Math.PI + (i/7 - 0.5) * 1.2;  /* 向后扇形扩散 */
          const r1 = 3 + k*8, r2 = 12 + k*40;
          g.moveTo(Math.cos(ang)*r1, Math.sin(ang)*r1);
          g.lineTo(Math.cos(ang)*r2, Math.sin(ang)*r2);
        }
        /* 粒子飞溅: 6个小光点向后飞 */
        g.lineStyle(0);
        g.beginFill(fc, (1-k) * 0.7);
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
        /* v5.13 PERF: TextStyle 按组合缓存共享 —— 每条新飘字 new 一个 TextStyle
         * 纯浪费, 颜色×暴击组合总数 ≤ 10。Text.destroy 不销毁共享 style, 安全。 */
        const key = (d.crit ? 'c|' : 'n|') + (d.color || '#eaf2fb');
        let style = drawDmg._st && drawDmg._st.get(key);
        if (!style) {
          style = new PIXI.TextStyle({
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
          (drawDmg._st || (drawDmg._st = new Map())).set(key, style);
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
  function render() {
    /* UI 层共享 Graphics 每帧 clear 重画(2D 时代靠清屏自然清, GL 必须显式清,
     * 否则血条/法环矩形逐帧累积成满屏红条 —— 首轮冒烟实锤) */
    const GL = window.BattleGL;
    if (GL && GL.ready) {
      GL.layers.farUI._gfx.clear();
      GL.layers.playerUI._gfx.clear();
      GL.layers.nearUI._gfx.clear();
    }
    drawBg();
    /* v3.8.2 遮挡分层: 远道怪 → 玩家 → 宠物 → 近道怪(近盖远, 画家算法)
     * v4.2: 前景遮挡条带压住全部实体(脚踝在草后) → 掉落物画在前景之上 */
    /* v5.0 分层切换点加半身位迟滞: 怪与玩家纵深几乎相同(同一水平线)时判为远景,
     * 避免怪恰好站在玩家所在线上时把玩家整个盖住 —— 玩家永远可见。 */
    const splitY = G.player.y + laneGap() * 0.5;
    /* 复用 _drawList: 全量填充+排序一次, 再按 splitY 分界分 far/near 两段绘制 */
    _drawList.length = 0;
    for (const e of G.enemies) {
      if (!e.alive && e.dying <= 0) continue;
      _drawList.push(e);
    }
    _drawList.sort((a, b) => (a.y || 0) - (b.y || 0));
    let splitIdx = 0;
    while (splitIdx < _drawList.length && (_drawList[splitIdx].y || 0) < splitY) splitIdx++;
    drawEnemies(0, splitIdx, 'far');
    drawPlayerSprite(); drawPets();
    drawEnemies(splitIdx, _drawList.length, 'near');
    drawForeground(); drawDrops();
    drawFx(); drawDmg(); drawSkillCall();
    if (labActive()) drawLabOverlay();
  }

  /* 标定台叠层：锚点竖线 + 玩家缘 / 怪躯干缘标记 + 间距数值 —— 一眼看出"挡没挡住" */
  function drawLabOverlay() {
    const GL = window.BattleGL;
    if (!GL || !GL.ready) return;
    const C = drawLabOverlay._g || (drawLabOverlay._g = (() => { const g = new PIXI.Graphics(); GL.layers.text.addChild(g); return g; })());
    const T = drawLabOverlay._t || (drawLabOverlay._t = (() => {
      const t = new PIXI.Text('', { fontFamily: 'monospace', fontSize: 13, fill: 0x7ef0b0, stroke: 'rgba(0,0,0,.85)', strokeThickness: 3 });
      t.anchor.set(0.5, 1); GL.layers.text.addChild(t); return t;
    })());
    const g = C; g.clear();
    const L = labLayout();
    const e = G.enemies.find(x => x.boneSlug === LAB.slug && x.alive);
    const B = BONES[LAB.slug];
    if (!e || !e.armature || !B) { T.visible = false; return; }
    const bb = GL.armatureAABB(e.armature);
    const def = BC.enemies[e.type] || {};
    const cap = def.isBoss ? CH * 0.7 : CH * 0.5;
    const drawH = Math.min(cap, e.drawH || def.drawH || 84) * laneScale(yToDepth(e.y));
    const s = drawH / Math.max(1, B.baseH || 100);
    const wS = s * (bb.maxX - bb.minX);
    const baseY = L.floor;
    const DASH = 6;
    /* 地面基线 */
    g.lineStyle(1, 0x445566, 0.9);
    g.moveTo(L.px - 160, baseY); g.lineTo(L.ex + 180, baseY);
    /* 玩家锚点线 */
    g.lineStyle(2, 0x66d9ff, 0.95);
    for (let y = baseY - 190; y < baseY; y += DASH * 2) g.moveTo(L.px, y).lineTo(L.px, Math.min(baseY, y + DASH));
    /* 玩家左右缘 */
    const pH = Math.min(CH * 0.5, 72) * laneScale(MID_LANE);
    const pW = pH * (SPRITE.fw / SPRITE.fh);
    g.lineStyle(1, 0x2f88b8, 0.8);
    g.moveTo(L.px - pW / 2, baseY - pH); g.lineTo(L.px - pW / 2, baseY);
    g.moveTo(L.px + pW / 2, baseY - pH); g.lineTo(L.px + pW / 2, baseY);
    /* 怪锚点线与躯干缘（躯干 = aabb 宽 × torsoFrac） */
    g.lineStyle(2, 0xff8a5c, 0.95);
    for (let y = baseY - 210; y < baseY; y += DASH * 2) g.moveTo(L.ex, y).lineTo(L.ex, Math.min(baseY, y + DASH));
    const tf = (typeof window.__torsoFrac === 'number' ? window.__torsoFrac : 0.45);
    const torsoW = wS * tf;
    const tL = L.ex - torsoW / 2, tR = L.ex + torsoW / 2;
    g.lineStyle(2, 0xffe066, 0.95);
    g.moveTo(tL, baseY - drawH); g.lineTo(tL, baseY);
    g.moveTo(tR, baseY - drawH); g.lineTo(tR, baseY);
    /* 全展开包围盒（含武器/尾巴/翅膀） */
    g.lineStyle(1, 0xffffff, 0.28);
    g.drawRect(L.ex - wS / 2, baseY - drawH, wS, drawH);
    /* 间距标注线：怪锚点 ↔ 玩家锚点 */
    g.lineStyle(2, 0x7ef0b0, 1);
    g.moveTo(L.px, baseY - 226); g.lineTo(L.ex, baseY - 226);
    g.moveTo(L.px, baseY - 232); g.lineTo(L.px, baseY - 220);
    g.moveTo(L.ex, baseY - 232); g.lineTo(L.ex, baseY - 220);

    const info = window.__labInfo();
    T.visible = true;
    T.position.set((L.px + L.ex) / 2, baseY - 240);
    T.text = `攻距 ${info.gap}px　躯干左缘 ${info.bodyLeft} / 玩家右缘 ${info.playerRight} → 余量 ${info.clear}px`;
    T.style.fill = info.clear >= 0 ? 0x7ef0b0 : 0xff6b6b;
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
    const buffEl = document.getElementById('battleBuff');
    /* ⚠️ v7.10 所有权拆分（勿回退）——这里曾经是「三个读数互相打架」的现场：
     *   · #battleTrial  与 stage-bar 的 #sbStage 重复显示关卡（屏幕上三个关卡）
     *     → 重复节点已删，关卡的唯一权威是 stage-bar。
     *   · #battleSpeed  被两个模块双写：本文件写「倍速+身法」，06-v6ui.js 写「倍速+跳关」，
     *     两者每帧互相覆盖 → 那个"跳来跳去"的现象。
     *     → 现在【本文件只写战斗内的临时状态】，永久资产一律归 06-v6ui.js：
     *         battleBuff  ← 本文件（身法剩余秒，战斗临时 buff）
     *         battleSpeed ← 06-v6ui.js（宠物永久倍速）
     *         battleSkip  ← 06-v6ui.js（宠物跳关）
     * 战斗层已经没有自己的倍速概念了（v6 起倍速只剩 Buff 宠物），
     * 原先这里读的 G.speedMult 是废弃的旧遗留，故一并去掉，避免与真实倍速打架。 */
    if (buffEl) {
      const bs = buffStats();
      if (bs.any) {
        let left = 0;
        for (const k in G.skillBuff) { const b = G.skillBuff[k]; if (b.durLeft > left) left = b.durLeft; }
        buffEl.style.display = '';
        const t = '身法 ' + left.toFixed(1) + 's';
        if (buffEl.textContent !== t) buffEl.textContent = t;
      } else if (buffEl.style.display !== 'none') {
        buffEl.style.display = 'none';
      }
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
  /* v6.9 PERF: 30fps → 24fps。素材 walk/attack 都是 24fps, 30fps 每帧多画 25% 纯浪费。
   * 降帧后 CPU 跑 update + GPU 提交几何的频率直接降 20%, 视觉无差(素材上限就在这)。 */
  const BATTLE_FRAME_MS = 42;   // ≈24fps
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
    update(dt); render();   /* 独立模式：自己就是画布主人，清屏透出底下 #bg */
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
        if (G.paused) return;                 /* 真暂停: 逻辑和渲染都停 */
        /* ⚠️ dt 是【原始 dt】。倍速乘法在 update() 第一行完成，舞台绝不代劳。 */
        update(dt);
        /* 黑屏挂机: 逻辑跑完但不渲染(省GPU), DIMSTAT由onKill/onExp等累加 */
        if (typeof DIMSTAT !== 'undefined' && DIMSTAT.on) return;
        const band = (typeof window !== 'undefined' && window.__stageBand)
          ? window.__stageBand()
          : { top: 92, height: Math.max(1, 0.56 * H - 176) };
        const savedCW = CW, savedCH = CH;
        CW = W; CH = band.height;
        try {
          render();   /* 画进 GL 横带本地坐标 */
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
    G.player = makePlayer(); G.player.x = playerSpawnX();   /* v7.9: 手机尺度的左侧出生点（原硬编码 100px） */
    /* ═══ 默认宠物: 灵狐(跟随+拾取+施法) / 灵鹰(独立攻击) ═══
     * ⚠️ v8.5 二者彻底解耦(用户明确要求): 灵鹰不绑玩家、不拾取、不施法。
     * 因此灵鹰【不再带 offsetX/offsetY】(那是"相对玩家的跟随偏移", 对独立宠无意义),
     * 也【不再带 castTimer/casting/castType】(那是灵狐的施法系统, 灵鹰继承了会冒光环)。
     * 灵鹰只用: x/y(自身世界坐标)、boltTimer(开火节奏)、flyFrame/flyTimer(扇翅)、bobT。 */
    G.pets.push({
      id: 'pet_fox', name: '灵狐', type: 'fox',
      atk: 0, aspd: 0, atkRange: 0, hp: 999, maxHp: 999,
      offsetX: -65, offsetY: -70,
      x: 35, y: 0, atkT: 0, anim: 0, hurtT: 0, alive: true,
      flyFrame: 0, flyTimer: 0, bobT: 0,
      fetch: { state: 'idle', drop: null },
      castTimer: 4, casting: false, castAnim: 0, castType: null, effectTimer: 0
    });
    G.pets.push({
      id: 'pet_eagle', name: '灵鹰', type: 'eagle',
      atk: 0, aspd: 0, atkRange: 0, hp: 999, maxHp: 999,
      /* 初始站位: 玩家前上方空域(首个 updateEagle 会平滑归位到锚点) */
      x: 240, y: 0, atkT: 0, anim: 0, hurtT: 0, alive: true,
      flyFrame: 0, flyTimer: 0, bobT: 0,
      boltTimer: 2,      /* 开火计时 */
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
 * 00-pure/10-base/30-systems，故 init() 执行时 $ / state 等已就绪。
 */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
