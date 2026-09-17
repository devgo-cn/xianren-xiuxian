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
import { state, DIMSTAT, MOB_POOLS } from './00-pure.js';   /* v3.9: 试炼纪录/离线加成写档; 黑屏挂机统计; v7.0: 正规怪物池 */


  const BC = {
    /* 占位怪 demon(妖将)/raptor(妖弓) 已移除 —— 只保留两种有真实素材的怪 */
    playerAtkRange: 75, playerAspd: 1.1, playerSpeed: 42,   /* v4.4: 基础移速 28→42 (×1.5), 走得太慢 */
    spawnInterval: 0.25, enemySpawnOffset: 40, maxAlive: 12, queueGap: 34,   /* v5.1 按频率刷怪: 0.25s/只×120只=30s刷完小怪, 然后BOSS出现; 同屏12 */
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
    trialSecs: 120,       /* 试炼轮时长: 120 秒结算, 击杀数计入纪录 → 离线补偿 */
    /* v5.1 妖潮121只怪池: 120普通+1BOSS, 按序号逐渐增强(T1→T10分段, 每12只一档),
     * 每杀1只+1%离线加成, 杀BOSS+60%, 全杀满累计180%封顶(120+60)。
     * 刷完121只提前结算弹弹窗, 不必等120秒。击杀即刷新(从屏幕左边生成)。 */
    trialPool: {
      totalMobs: 120, bossAt: 121,
      boostPerKill: 0.01, boostPerBoss: 0.60, boostCap: 1.80,
      tierBands: [12, 24, 36, 48, 60, 72, 84, 96, 108, 120],   /* T1@1-12 ... T10@109-120 */
    },
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
  /* v5.0 121只怪池: 按序号返回tier(T1@1-30, T2@31-60, ... T10@271-300) */
  function tierForSpawn(n) {
    const bands = BC.trialPool.tierBands;
    for (let t = 1; t <= 10; t++) { if (n <= bands[t-1]) return t; }
    return 10;
  }

  /* 玩家属性(主游戏 pushBattleStats 注入) —— 战斗内一切数值伤害以此为准 */
  let PST = { lv:1, atk:56, hp:430, def:31, crit:0, critB:0, critD:0, pen:0, dodge:0 };
  /* 掉落系数(服务端可下发覆盖; 断网/离线用内置默认值, 保证照常可玩) */
  const DROP = {
    spiritBase: 30,       // 每杀灵石基数(v5.2: 6→30, 在线打怪灵石产出对齐聚灵阵需求)
    spiritPerLv: 5,       // 每杀灵石 · 每境界级加成(v5.2: 1.2→5)
    spiritRand: 0.4,      // 灵石浮动 ±40%
    equipChance: 0.035,   // 掉法宝概率(装备实际生成在主游戏 makeArt)
    eliteChance: 0.06,    // 精英怪出现率
    eliteMul: 4,          // 精英产出倍率
    eliteHp: 3,           // 精英血量倍率
  };

  if (typeof window !== 'undefined') {
    /* v5.0 强制解冻妖潮倒计时: 不管旧代码残留什么值, 正式游戏必须正常结算。
     * 需要调试冻结时在控制台手动设 window.__trialFreeze=true 后刷新 */
    window.__trialFreeze = false;
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

  const G = {    t:0, kills:0, spirit:0, speedMult:2, speedMultTimer:0, state:'walk', camX:0, paused:false,
    player:null, pets:[], enemies:[], fx:[], dmg:[], drops:[], spawnT:BC.spawnInterval,
    sprite:null, bgImg:null, spriteReady:false, bgReady:false, extraStrike:false,
    speedDodge:0, nextStrikeCrit:0,
    petFoxSprite:null, petFoxReady:false,
    skillSprite:null, skillReady:false,
    bossActive:false,   /* v3.8.2 打满100只小怪才刷BOSS(原10) */
    skillCall:null,          /* 技能名播报槽: 覆盖式大字快闪, {name,t,dur} */
    /* v3.9 试炼轮次: 120秒一场, 怪从T1一路刷到T5; 结算击杀数 → 纪录 → 离线补偿
     * v5.0 121只固定怪池: trialSpawned记录已刷序号, 按序号决定tier, 刷完121只提前结算 */
    trialT: BC.trialSecs, trialKills:0, trialTier:1, trialSettled:false, trialBossDone:false, bossT:0,
    trialSpawned:0, trialBossKilled:false,
  };
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
  function playSfx(name, vol, rate) {
    if (!sfx.ready || !sfx[name]) return;
    if (typeof SND !== 'undefined' && !SND.sfxOn) return;   /* 设置页「音效」开关统一管控战斗音效 */
    const a = sfxGet(name);
    if (!a) return;
    a.volume = vol || 0.6;
    if (rate) { try { a.playbackRate = rate; } catch (e) {} }   /* v6.3: 脚步/同源变调用的变速 */
    try { a.currentTime = 0; } catch (e) {}
    a.play().catch(() => {});
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
    if (typeof SND !== 'undefined' && !SND.sfxOn) return;   /* 同样受设置页「音效」开关管控 */
    const pool = MON_POOL[file] || (MON_POOL[file] = []);
    let a = null;
    for (const x of pool) { if (x.paused || x.ended) { a = x; break; } }
    if (!a) {
      if (pool.length >= 3) return;                          /* 池满且全在播 → 丢弃本次 */
      const src = MON_SRC[file]
        || (MON_SRC[file] = new Audio('assets/sfx/monster/' + file + '.ogg'));
      a = src.cloneNode(); pool.push(a);
    }
    a.volume = vol || 0.5;
    if (rate) { try { a.playbackRate = rate; } catch (e) {} }
    try { a.currentTime = 0; } catch (e) {}
    a.play().catch(() => {});
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

  function fmtNum(n) {
    n = Math.round(n || 0);
    if (n >= 100000000) return (n/100000000).toFixed(2) + '亿';
    if (n >= 10000) return (n/10000).toFixed(n >= 1000000 ? 0 : 1) + '万';
    return String(n);
  }
  /* ---------- 技能读取: 等级与数值的唯一来源是主游戏 SkillAPI ---------- */
  function skVal(id)  { const api = window.SkillAPI; return api ? api.val(id) : null; }   // {chance, dmg, ...} 已按等级插值
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
    /* camX 初值在任何一次 updateCamera 之前是 NaN/undefined —— 而 updateCamera 用的是
     * G.camX += ... 的累加式，NaN 一旦进入就永远收敛不回来，worldToScreen 全变 NaN，
     * 整场黑屏（验收台首次接入时踩到）。这里直接按 updateCamera 的目标式给定值。 */
    G.camX = G.player.x - stageW() * 0.42;
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

  window.BattleAPI = {
    /* v3.2: 统一舞台接入点 ---- 返回 60-stage 契约层对象 { name, draw(ctx,W,H,dt) }。
     * 调用后本层不再自持 rAF，逻辑与绘制都由舞台按统一 30fps 驱动。
     * ⚠️ 舞台传进来的 dt 必须是原始 dt —— 倍速乘法留在 update() 内部。 */
    /* v4.1.2: 舞台接管时必须显式置 _managed —— 此前 initManaged 无人调用,
     * _managed 恒 false, 模块加载自启的独立泵从未停过(双泵: update 双跑=逻辑
     * 双倍速潜伏至今; GL 迁移后独立泵 frame(0,innerH) 可见 = 画面上下抖动)。 */
    createStageLayer: () => { _managed = true; _rafOn = false; trialRestart(); return battleLayer(); },  /* v5.0 FIX: 每次进入战斗重置妖潮状态, 否则上一场结算后trialSettled=true残留, 新一场不倒计时不结算 */
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
    /* v3.2 验收用：直接设定倍速（跳过技能随机 proc），让 A/B 对照可复现。
     * 传 1 即清除加速。 */
    __setSpeedMultForTest: (m, dur) => {
      G.speedMult = Math.max(2, m || 2);
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
    return { x:0,y:laneOff(MID_LANE), lane:MID_LANE, hp:PST.hp,maxHp:PST.hp, atk:PST.atk,aspd:BC.playerAspd, atkRange:BC.playerAtkRange, atkT:Math.random()*0.4, anim:0,hurtT:0, walkT:Math.random()*6.28, moving:1, alive:true, animFrame:0, animTimer:0, attackAnim:false, attackTarget:null, hit1:false, hit2:false, hit3:false, sanlianTriggered:false, atkBuff:0, atkBuffTimer:0, skillAnim:false, skillFrame:0, skillTimer:0, skillHit:false, skillCooldown:0, skillTarget:null };
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
    /* v6.6 怪攻基数斜率 5→15: 玩家血量随装备/法宝成长(每境×2~3), 旧斜率下怪攻成长(×2.2)跟不上,
     * 高境界(渡劫+)血线常年 90%+ 碾压(实测)。斜率15 让怪攻与玩家面板同速 ——
     * 各境界威胁度拉平, 中段实测血线 35~48%(模拟器毕业档定稿)。 */
    let atk = Math.round((8 + 15*lv)  * def.atkK * mul);
    const dfn = Math.round((2 + 2*lv)   * def.defK * mul);
    if (elite) { hp = Math.round(hp*DROP.eliteHp); atk = Math.round(atk*1.2); }
    const lane = Math.random();   /* v5.0: 纵深比例 0~1 连续随机(无道) */
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
      atkRange:def.atkRange, speed:def.speed*(0.9+Math.random()*0.2)*(elite?0.85:1)*spdMul, color:def.color,
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
  function poolFor(lv) {
    const keys = Object.keys(MOB_POOLS).map(Number).sort((a,b) => b-a);
    for (const k of keys) { if (lv >= k) return MOB_POOLS[k]; }
    return MOB_POOLS[1];
  }
  function makePoolEnemy(entry, isBoss) {
    const cfg = BONE_IDX[entry.slug] || {};
    const dh = cfg.drawH || 84;
    const sk = SK_OF[entry.slug];
    /* 骨架数值先走 makeEnemyFrom 通用路径(体型攻距/腿部动画), 再用池表数值整体覆盖 */
    const def = { name: entry.slug.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()),
      role: sk ? 'ranged' : 'melee', atkRange: sk ? 52 : 34, speed: isBoss ? 90 : 120,
      hpK:1, atkK:1, defK:1, crit:entry.crit||0, dodge:entry.dodge||0, pen:entry.pen||0, critRes:entry.critRes||0,
      hasSkill: !!sk, color:'#9aa8b8', bone:entry.slug, tier:1, drawH:dh, hpBarW:Math.max(24, Math.round(dh*0.55)) };
    const e = makeEnemyFrom(def, 1, isBoss ? 'boss' : entry.slug);
    e.hp = e.maxHp = entry.hp;
    e.atk = entry.atk;
    e.def = entry.def;
    e.elite = false;             /* 池表怪不吃随机精英(数值即策划定值) */
    return e;
  }
  function spawnWave() {
    const pool = poolFor(Math.max(1, PST.lv || 1));
    /* BOSS活跃时不刷新小怪 */
    if (G.bossActive) return null;
    /* v7.0 BOSS = 第121只, 120只小怪刷完后出场, 一轮一次。
     * 三重保护: trialBossDone + bossActive + 场上BOSS对象(含死亡动画中), 防双BOSS。
     * 工厂未就绪不创建(否则序列帧兜底与骨骼版双BOSS站一起)。 */
    if (G.trialSpawned >= BC.trialPool.totalMobs && !G.trialBossDone && !G.bossActive && !G.enemies.some(e => e.type === 'boss')) {
      if (!BONES[pool.boss.slug] || !BONES[pool.boss.slug].ready) return null;
      if (G.enemies.filter(x => x.alive && x.dying <= 0).length >= capAlive()) return null;
      const e = makePoolEnemy(pool.boss, true);
      e.x = G.camX + stageW() + BC.enemySpawnOffset;
      e.lane = MID_LANE; e.y = laneOff(MID_LANE);   /* BOSS 固定中道, 突出存在感 */
      G.enemies.push(e);
      G.bossActive = true;
      G.trialBossDone = true;
      G.trialSpawned++;   /* 第121只 */
      G.bossT = pool.boss.time || 30;   /* v7.0 BOSS 30s 限时: 到点打不死 → 重新开始兽潮 */
      return e;
    }
    /* v5.0 121只怪池刷完则停刷(提前结算) */
    if (G.trialSpawned >= BC.trialPool.bossAt) return null;
    /* v7.0 顺序分波: 前10只=波1, 11-20=波2, ... 波次内同种怪, 池表定值, 非随机 */
    const waveIdx = Math.min(11, Math.floor(G.trialSpawned / 10));
    const entry = pool.waves[waveIdx];
    if (!(BONES[entry.slug] && BONES[entry.slug].ready)) return null;   /* 工厂未就绪这一拍不刷(避免占位图) */
    if (G.enemies.filter(x => x.alive && x.dying <= 0).length >= capAlive()) return null;
    const e = makePoolEnemy(entry, false);
    e.x = G.camX + stageW() + BC.enemySpawnOffset;   /* v5.1 击杀即刷新: 从屏幕右边生成 */
    G.enemies.push(e);
    G.trialSpawned++;   /* v5.0 计数已刷怪序号 */
    return e;
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
      G.trialBossKilled = true;   /* v5.0 BOSS被杀标记, 结算时+50% */
    }
    /* v5.0 试炼计数: BOSS和小怪都计入击杀数, 固定怪池不需要按击杀升档 */
    if (!G.trialSettled) {
      G.trialKills++;
      updateHUD();
      /* v5.1 击杀即刷新: 杀一只小怪立即补一只(从右边生成), 避免按频率刷怪排队AOE全死光。
       * 同屏上限12只自动停刷, BOSS被杀不补充, 怪池刷完不补充。 */
      if (!isBoss && G.trialSpawned < BC.trialPool.bossAt) {
        spawnWave();
      }
      /* v5.0 121只全刷完且BOSS已死 → 提前结算弹弹窗 */
      if (G.trialSpawned >= BC.trialPool.bossAt && G.trialBossKilled) {
        settleTrial();
      }
    }
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
    skExpAll(isBoss ? 30 : 2);         // 每杀全体技能+2; BOSS 击杀全体+30
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
    /* v6.5 怪物闪避: 玩家此段落空(不出伤害不消耗追猎), 高 tier 怪开始有 miss */
    if (Math.random()*100 < (target.dodge || 0)) {
      G.dmg.push({ x:target.x, y:target.y-30, val:'闪', crit:false, color:'#cfd8e3', t:0 });
      return;
    }
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
      skExp('hengsao', 2); skillCall('横扫千军');
      G.fx.push({ kind:'hengsao', x:p.x, y:p.y-30, color:'#ffc98a', t:0, dur:0.30, frame:0, startX:p.x, endX:p.x+200 });  /* v3.7.2 y带玩家车道偏移(原固定-30永远画在中道); v2.9 再提速: 0.6→0.38→0.30s, 起手即爆 */
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
      skExp('jianqi', 2); skillCall('剑气斩');
      G.fx.push({ kind:'slash', x:target.x, y:target.y-24, color:'#bfe8ff', t:0, dur:0.28 });
      dealDamage(target, calcDmg(PST.atk, base*(jq.dmg||0)/100, target.def, pen), '#bfe8ff', false);
      if (!target.alive) return;
    }
    /* v5.1 疾风步/缩地成寸: 攻击时概率触发(与破甲/斩杀/剑气斩一致), 不再是击杀后触发 */
    rollSpeedSkill('jifeng');
    rollSpeedSkill('suodi');
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
        G.dmg.push({ x:G.player.x, y:G.player.y-50, val:'+'+Math.round(heal), crit:false, color:'#7fffaa', t:0 });
      }
    }
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
        /* 脚步声同步: walk第18帧(源帧22) */
        if (p.animFrame === 18 && p.moving) playSfx('footstep', 0.5);
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
          p.anim = 1; p.atkT = 1/p.aspd; p.attackAnim = true; p.animFrame = 0; p.animTimer = 0; p.attackTarget = near; p.hit1 = false; p.hit2 = false; p.hit3 = false; p.sanlianTriggered = false;
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
      /* v6.0 无怪时向前推进 —— 防穿越按二维地面距离挑最近的挡路怪。 */
      p.moving = 1; p.walkT += dt*8; p.x += BC.playerSpeed*dt;
      let nearest = Infinity;
      for (const e of G.enemies) {
        if (e.alive && e.dying <= 0 && e.x > p.x - 1 && e.x < nearest) nearest = e.x;
      }
      if (nearest < Infinity) p.x = Math.min(p.x, nearest - PLAYER_HIT_GAP);
    }
  }
  function updatePets(dt) {
    const p = G.player;
    for (const pet of G.pets) {
      if (!pet.alive) continue;
      /* 飞行动画帧更新 */
      pet.flyTimer += dt;
      const frameDur = 1 / 24;
      if (pet.flyTimer >= frameDur) {
        pet.flyTimer -= frameDur;
        pet.flyFrame = (pet.flyFrame + 1) % 32;
      }
      /* 朝向: 仅拾取/携带阶段按移动方向判朝向, 跟随阶段固定朝右(不摆头) */
      const dxFrame = pet.x - (pet.lastX ?? pet.x);
      pet.faceAcc = (pet.faceAcc || 0) + dxFrame;
      const faceThresh = Math.max(0.6, 12 * dt);
      pet.lastX = pet.x;
      /* 拾取装备: 飞行宠物飞向地板掉落, 拾起后缩小带回, 抵达即入包 */
      if (pet.fetch && pet.fetch.state === 'toDrop') {
        const d = pet.fetch.drop;
        if (!d || d.phase === 'done') { pet.fetch.state = 'idle'; pet.fetch.drop = null; }
        else {
          const dx = d.wx - pet.x, dy = (d.y - 16) - pet.y, dist = Math.hypot(dx, dy), spd = 560;
          if (dist <= spd * dt || dist < 10) { pet.x = d.wx; pet.y = d.y - 16; d.phase = 'carry'; d.t2 = 0; pet.fetch.state = 'carry'; }
          else { pet.x += dx / dist * spd * dt; pet.y += dy / dist * spd * dt; }
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
        if (dist <= spd * dt || dist < 8) { pet.x = tx; pet.y = ty; }
        else { pet.x += dx / dist * spd * dt; pet.y += dy / dist * spd * dt; }
        d.x = worldToScreen(pet.x); d.y = pet.y - 6;             // 装备贴在宠物身上
        /* 携带阶段按移动方向判朝向 */
        if (pet.faceAcc > faceThresh) { pet.face = 1; pet.faceAcc = 0; }
        else if (pet.faceAcc < -faceThresh) { pet.face = -1; pet.faceAcc = 0; }
        if (Math.abs(dxFrame) > 4) { pet.face = dxFrame > 0 ? 1 : -1; pet.faceAcc = 0; }
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
      /* 上下浮动(保留计时器, 渲染层用) */
      pet.bobT += dt * 2.5;
      /* 跟随玩家: 左上方, 简单延迟跟随 —— 插值系数小(dt*3.5), 玩家快走时宠物
       * 先愣一下(跟不上), 随后慢慢跟上。不用弹簧/惯性模型, 倍速起来也不乱晃。 */
      const targetX = p.x + pet.offsetX;
      const targetY = floorY() + p.y + pet.offsetY;
      pet.x += (targetX - pet.x) * Math.min(1, dt * 3.5);
      pet.y += (targetY - pet.y) * Math.min(1, dt * 3.5);
      /* 朝向固定朝右(宠物在玩家左侧跟随, 不摆头) */
      pet.face = 1;

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
        if (e.stopX == null || e.x < e.stopX - BC.queueGap) {
          const stopX = Math.max(p.x + (e.atkRange || 0), prevX + BC.queueGap);
          e.stopX = stopX;
        }
        prevX = Math.max(e.x, e.stopX);
      }
    }
    /* v3.8.1 防交错兜底: 排队目标 stopX 恒在玩家右侧, 发现怪被留在 stopX 左侧
     * (玩家推进/移动曾可穿过站位怪)直接拉回站位 —— 杜绝"跑到玩家后面咬空气"。 */
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
          /* 脚步声: walk特定帧, 仅在移动时 */
          if (e.moving) {
            if (e.type === 'slime' && (e.animFrame === 4 || e.animFrame === 20)) playSfx('slime_footstep', 0.4);
            else if (e.type === 'water' && (e.animFrame === 8 || e.animFrame === 24)) playSfx('water_footstep', 0.4);
            /* v6.3 骨骼怪脚步: 复用主角脚步 + 按体型变速(drawH 60~132 → 1.5~0.73 倍),
             * 大体型压低音高显得沉重。存在感本来就低, 不值得每只单独一条音。 */
            else if (e.boneSlug && (e.animFrame === 4 || e.animFrame === 20))
              playSfx('footstep', 0.2, Math.max(0.6, Math.min(1.5, 96 / (e.drawH || 96))));
          }
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
        /* 闪避判定(装备词条 + 身法技能时效加成) —— 落空则不进伤害 */
        if (Math.random()*100 < ((PST.dodge || 0) + G.speedDodge)) {
          G.dmg.push({ x:p.x,y:p.y-40, val:'闪', crit:false, color:'#9fd8ff', t:0 });
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
          G.dmg.push({ x:p.x,y:p.y-40, val:dmg, crit, color: crit ? '#ff5a3c' : '#ff8a7a', t:0 });
          G.fx.push({ kind:'hitSpark', x:p.x,y:p.y-20, color:'#ff8a7a', t:0,dur:0.3 });
          if (p.hp <= 0) {
            /* v5.0 死亡判定: 玩家倒下后妖潮从头开始(清场+重置怪池+回满血) */
            p.hp = p.maxHp;
            for (const e of G.enemies) { e.alive = false; e.dying = 0; despawnEnemy(e); }
            G.enemies.length = 0;
            G.bossActive = false;
            trialRestart();
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
    const targetCam = G.player.x - stageW()*0.42;   // 玩家锁屏中间偏左: 右侧留出更多来怪空间, 推进感更强
    G.camX += (targetCam-G.camX)*Math.min(1, dt*20);   /* v4.4: 平滑系数6→20, 相机更紧密跟随玩家, 背景滚动与玩家移动同步 */
  }
  let _pushT = 0;
  /* ── v3.9 试炼轮次状态机 ──────────────────────────────────────────
   * 120 秒一场, 怪从 T1 妖群一路升到 T5 妖皇; 时间到结算:
   *   本轮击杀 → 与纪录(trialBest)比较 → 按档位给离线游历收益加成(trialBoost)。
   * 【计时器与倍速分离】倒计时吃原始 dt(真实时间); 身法倍速只加速战斗实体 ——
   *   运气好触发倍速多, 同样 120 秒里刷的怪就更多, 击杀数即纯收益。 */
  function updateTrial(dt) {
    if (G.trialSettled) return;          /* 结算面板期间不倒计时、不刷怪 */
    /* v4.6 素材过目: window.__trialFreeze = true 冻结倒计时 —— 120s 看不完 79 只怪,
     * 冻结后不会到点结算清场, 可以慢慢逐只过目。置回 false 即恢复。 */
    if (typeof window !== 'undefined' && window.__trialFreeze) return;
    /* v7.0 BOSS关底战 30s 限时: 杀满120只小怪后 BOSS 出场, 主倒计时冻结, 独立 30s ——
     * 30s 内杀死 BOSS → 提前结算弹面板(+60% 加成); 打不死 → trialRestart 重新开始兽潮 */
    if (G.bossActive) {
      G.bossT -= dt;
      if (G.bossT <= 0) { G.bossT = 0; trialRestart(); }
      return;
    }
    G.trialT -= dt;
    if (G.trialT <= 0) { G.trialT = 0; settleTrial(); }
  }
  /* v5.0 离线加成累计制: 每杀1只+1%, 杀BOSS+60%, 全杀满180%封顶; 48h有效 */
  function settleTrial() {
    G.trialSettled = true;
    const kills = G.trialKills;
    const bossKilled = G.trialBossKilled;
    /* 清场: 轮次结束, 场上怪走死亡动画自然退去(掉落保留让玩家收完) */
    for (const e of G.enemies) { e.alive = false; if (e.dying <= 0) e.dying = 0.4; }
    G.bossActive = false;
    /* 纪录 + 离线加成(写进 state, 随云存档同步) */
    let best = 0, boost = 0, isNew = false;
    try {
      const st = state;
      if (st) {
        best = st.trialBest || 0;
        if (kills > best) {
          best = kills; isNew = true;
          st.trialBest = best;
          try { window.addJournal && window.addJournal({ key: 'trial-' + Date.now(), big: realmName(), kind: '试炼', title: '妖潮试炼', text: `妖潮退去, 此番斩妖 ${kills} 只${bossKilled ? ', 击杀妖王' : ''}, 刷新试炼纪录。` }); } catch (err) {}
        }
        /* v5.0 累计制: 击杀数×1% + BOSS 60%, 封顶180% */
        boost = Math.min(BC.trialPool.boostCap, kills * BC.trialPool.boostPerKill + (bossKilled ? BC.trialPool.boostPerBoss : 0));
        if (boost > 0) {
          st.trialBoost = Math.max(st.trialBoost || 0, boost);
          st.trialBoostUntil = Math.max(st.trialBoostUntil || 0, Date.now() + 48*3600*1000);
        }
      }
    } catch (err) { console.warn('[battle] 试炼结算写档失败', err); }
    /* v5.0 破纪录立即上传服务器, 不等下次自动同步(关键战绩不丢) */
    if (isNew) { try { window.save && window.save(); window.cloudFlush && window.cloudFlush(); } catch (err) {} }
    /* 黑屏挂机统计: 兽潮场次+1 */
    if (DIMSTAT.on) DIMSTAT.trials++;
    /* v5.2 结算小卡片: 遮罩+小卡片, 5秒后自动消失进入下一场 */
    try {
      if (document.hidden || DIMSTAT.on) {
        setTimeout(() => { try { trialRestart(); } catch(err) {} }, 200);
      } else {
        const el = document.getElementById('trialToast');
        if (el) {
          document.getElementById('trialKillsN').textContent = kills + (bossKilled ? '·含妖王' : '');
          document.getElementById('trialBestN').textContent = best + (isNew ? '·新纪录' : '');
          document.getElementById('trialBoostN').textContent = boost > 0 ? `+${Math.round(boost*100)}%` : '—';
          el.classList.add('show');
          setTimeout(() => {
            el.classList.remove('show');
            try { trialRestart(); } catch(err) {}
          }, 5000);
        }
      }
    } catch (err) {}
    updateHUD();
  }
  function trialRestart() {
    document.getElementById('trialToast') && document.getElementById('trialToast').classList.remove('show');
    /* v5.0 FIX: 清场 —— 原trialRestart只重置计数不清场, 死亡/结算后旧BOSS(序列帧史莱姆王)残留,
     * 新BOSS(骨骼九尾狐王)创建后两个BOSS站一起。这里把场上怪全部清除。 */
    for (const e of G.enemies) { e.alive = false; e.dying = 0; if (e.armature) { try { despawnEnemy(e); } catch(err) {} } }
    G.enemies.length = 0;
    G.bossActive = false;
    G.kills = 0;   /* v5.1 结算后HUD击杀数清零(原只重置trialKills, G.kills没重置导致HUD显示不清零) */
    G.trialT = BC.trialSecs; G.trialKills = 0; G.trialTier = 1;
    G.trialSettled = false; G.trialBossDone = false;
    G.trialSpawned = 0; G.trialBossKilled = false;   /* v5.0 重置121只怪池计数 */
    G.bossT = 0;   /* v7.0 BOSS 30s 限时计时归零 */
    G.paused = false;
    updateHUD();
  }
  function realmName() { try { return (typeof window.realm === 'function' && window.realm().big) || ''; } catch (err) { return ''; } }
  function update(dt) {
    if (G.speedMultTimer > 0) {
      G.speedMultTimer -= dt;
      if (G.speedMultTimer <= 0) { G.speedMult = 2; G.speedMultTimer = 0; G.speedDodge = 0; }   // 身法时效到点, 退回基础2倍速, 闪避加成一并散去
    }
    const nowSpeedBuff = G.speedMultTimer > 0;
    if (nowSpeedBuff !== _wasSpeedBuff) { _wasSpeedBuff = nowSpeedBuff; updateHUD(); }
    const sdt = dt * G.speedMult;
    G.t += sdt;
    /* v5.0 FIX: 结算面板已关闭但trialSettled仍为true(玩家关面板没走trialRestart) → 自动重置,
     * 否则新一场妖潮不倒计时不结算。杀BOSS提前结算与120秒结算都设trialSettled=true, 这是冲突根因。 */
    if (G.trialSettled) {
      if (!_trialModalEl) _trialModalEl = document.getElementById('trialToast');
      const modal = _trialModalEl;
      if (!modal || !modal.classList.contains('show')) { trialRestart(); }
    }
    /* v3.9 试炼倒计时: 原始 dt —— 计时器与倍速分离, 倍速只加战斗节奏不加轮时 */
    updateTrial(dt);
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
    if (G.trialSettled) { G.spawnT = spawnGap; }   /* 结算面板期间停刷怪 */
    /* v4.8 弹道验收台: 关掉刷怪，否则试炼波次会往验收台里掺进无关怪
     * （表现为 probe 里冒出 sword_goblin / 第二只同名怪，把画面糊掉）。 */
    else if (window.__skillFreeze) { G.spawnT = spawnGap; }
    else if (G.spawnT <= 0) {
      /* v5.1 击杀即刷新: 开局同屏少于1只时按频率填充(只填1只), 之后靠onKill击杀即刷新补充。
       * 避免按频率刷怪排队AOE全死光。同屏上限12只自动停刷, 怪池121只刷完停刷。 */
      if (aliveCount < 1 && G.trialSpawned < BC.trialPool.bossAt) spawnWave();
      G.spawnT = spawnGap;
    }
    /* 属性/技能等级每 5s 重新取一次(自愈: 即便某次变更没通知到也不会一直用旧值) */
    _pushT -= dt;
    if (_pushT <= 0) { _pushT = 5; if (typeof window.pushBattleStats === 'function') window.pushBattleStats(); }
    updatePlayer(sdt); updatePets(sdt); updateEnemies(sdt); updateFx(sdt); updateDrops(sdt); updateCamera(sdt);
    /* 技能名播报: 独立推进(不吃身法倍速, 固定节奏即隐) */
    if (G.skillCall) { G.skillCall.t += dt; if (G.skillCall.t >= G.skillCall.dur) G.skillCall = null; }
  }

  /* 渲染 */
  let cv, ctx, CW, CH;
  const _drawList = [];   /* 复用: 避免每帧两次分配+两次排序 */
  const _waterMat = new PIXI.Matrix();   /* 复用: 避免水精灵每帧 new Matrix */
  let _wasSpeedBuff = false;   /* 身法状态切换检测: 避免每帧调 updateHUD */
  let _trialModalEl = null;   /* trialModal 元素懒加载缓存 */
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
    } else {
      drawClouds();   /* 背景图未就绪时保留旧的程序云天 */
    }
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
    const oy = e.y - dh * k.alt;
    /* 2 维瞄准: 从发射点朝玩家当前位置算归一化方向向量; 玩家不存在时退化为水平朝向 */
    let dx = dir, dy = 0;
    if (G.player) {
      const tdx = G.player.x - ox;
      const tdy = G.player.y - oy;          /* 均为地板相对坐标, 可直接相减 */
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
    for (let i = 0; i < k.count; i++) SK_LIVE.push(G.fx[G.fx.push(shot(i * (k.gap || 0.08), (i - 1) * 5)) - 1]);
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
        o.spr.anchor.set(f.dir < 0 ? 1 : 0, 0.5);

        /* 位置曲线: v4.9 沿 2 维瞄准方向推进(dx/dy 为发射时朝玩家的归一化方向) */
        const adv = f.travel ? f.travel * Math.min(1, kx / 0.8) : 0;
        let px = sx + (f.dx || f.dir) * adv;
        let py = fy + (f.dy || 0) * adv;
        /* v4.9 弹道追踪: 朝玩家当前位置偏移, 前20%不追踪(避免刚发射就拐弯), 后面逐渐追踪到 track 强度 */
        if (f.track && G.player) {
          const trackAmt = f.track * Math.max(0, (kx - 0.2) / 0.8);
          if (trackAmt > 0) {
            const targetX = G.player.x;
            const targetY = fy + (G.player.y - (f.y || 0));
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
        /* v4.9 spike 素材朝左(尖端在左): 向左打不翻转, 向右打才水平翻转 */
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
    const killsEl = document.getElementById('battleKills');
    const speedEl = document.getElementById('battleSpeed');
    const stateEl = document.getElementById('battleState');
    const spEl = document.getElementById('battleSpirit');
    const trEl = document.getElementById('battleTrial');
    if (killsEl) killsEl.textContent = G.kills;
    if (spEl) spEl.textContent = fmtNum(G.spirit);
    if (speedEl) {
      /* v5.0 基础2倍速为常态隐藏不显示, 技能加速中显示玩家感知的加成倍速(实际mult-1): 疾风步×2, 缩地×3 */
      if (G.speedMultTimer > 0) { speedEl.style.display = ''; speedEl.textContent = '×'+(G.speedMult - 1)+' 倍速 ('+G.speedMultTimer.toFixed(1)+'s)'; }
      else speedEl.style.display = 'none';
    }
    if (stateEl) stateEl.textContent = G.state === 'fight' ? '战斗中' : '推进中';
    /* v3.9 试炼 HUD: 倒计时+档位; 有离线加成时点亮 */
    if (trEl) {
      const td = BC.tier[G.trialTier] || BC.tier[1];
      const m = Math.floor(G.trialT / 60), s = Math.floor(G.trialT % 60);
      /* v4.6 过目模式: 倒计时冻结时加 ⏸ 标记, 免得看着像卡住了 */
      const frozen = (typeof window !== 'undefined' && window.__trialFreeze) ? '⏸ ' : '';
      trEl.textContent = `${frozen}妖潮·${td.name} ${m}:${s < 10 ? '0' : ''}${s}`;
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
