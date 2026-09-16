/**
 * 妖潮击杀模拟 v2: 完整计算6件装备+词条+8技能+身法倍速
 * 用法: node tools/sim_trial_kills_v2.js
 */

// ── 怪物池T1-T10 (与游戏同步) ──
const TIERS = [
  { t: 1, name: "妖群", mul: 1.00, hpK: 0.95 },
  { t: 2, name: "妖锐", mul: 1.15, hpK: 0.90 },
  { t: 3, name: "妖将", mul: 1.35, hpK: 0.85 },
  { t: 4, name: "妖卫", mul: 1.55, hpK: 1.00 },
  { t: 5, name: "妖王", mul: 1.80, hpK: 1.20 },
  { t: 6, name: "妖皇", mul: 2.05, hpK: 1.45 },
  { t: 7, name: "妖尊", mul: 2.35, hpK: 1.65 },
  { t: 8, name: "妖圣", mul: 2.65, hpK: 1.85 },
  { t: 9, name: "妖神", mul: 2.90, hpK: 2.00 },
  { t: 10, name: "妖帝", mul: 3.20, hpK: 2.20 },
];
const TIER_BANDS = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300];
function tierForSpawn(n) { for (let t = 1; t <= 10; t++) { if (n <= TIER_BANDS[t-1]) return t; } return 10; }

// 怪物血量
function mobHp(lv, tierIdx) {
  const t = TIERS[tierIdx - 1];
  return Math.round((60 + 26 * lv) * t.hpK * t.mul);
}
function bossHp(lv) {
  return Math.round((60 + 26 * lv) * 2.20 * 3.20 * 5);
}

// ── 品质 & 装备 ──
const QUALITY = [
  { name: "粗制", w: 50, mult: 1.10 },
  { name: "法器", w: 20, mult: 1.30 },
  { name: "灵器", w: 15, mult: 1.58 },
  { name: "古宝", w: 9,  mult: 2.00 },
  { name: "灵宝", w: 5,  mult: 2.70 },
  { name: "玄天", w: 1,  mult: 3.80 },
];
function eqMult(q) { return QUALITY[q].mult; }
function pickQ() {
  const t = QUALITY.reduce((s, r) => s + r.w, 0);
  let x = Math.random() * t;
  for (let i = 0; i < QUALITY.length; i++) { x -= QUALITY[i].w; if (x <= 0) return i; }
  return 0;
}

// 词条数值
function fxValue(key, q) {
  const t = q >= 3, r = Math.random;
  if (key === "atk" || key === "hp" || key === "dfn") return 3 + ((r() * 3) | 0) + (t ? 2 : 0);
  if (key === "crit") return (t ? 2 : 1) + ((r() * 2) | 0);
  if (key === "critB") return (t ? 5 : 3) + ((r() * 3) | 0);
  if (key === "critD") return (t ? 10 : 6) + ((r() * 5) | 0);
  if (key === "pen") return (t ? 4 : 2) + ((r() * 3) | 0);
  if (key === "dodge") return (t ? 2 : 1) + ((r() * 2) | 0);
  if (key === "aspd") return (t ? 5 : 3) + ((r() * 3) | 0);
  return (t ? 2 : 1) + (r() < 0.5 ? 1 : 0);
}
function fxCount(q) { let n = ([1, 1, 2, 2, 3, 3][q] || 1); if (q >= 2 && Math.random() < 0.35) n++; return Math.min(4, n); }

const FX_POOL = {
  w: ["atk", "crit", "critB", "critD", "pen", "life"],
  s: ["atk", "crit", "critB", "critD", "pen", "life"],
  a: ["hp", "dfn", "dodge", "crit", "critD", "life"],
  p: ["hp", "dfn", "dodge", "crit", "critD", "life"],
};

function rollFx(kind, q) {
  const pool = (FX_POOL[kind] || FX_POOL.w).slice();
  const n = fxCount(q);
  const f = [];
  const legChance = 0.03 + q * 0.035;
  if (kind === "s") {
    const v = fxValue("aspd", q);
    const leg = Math.random() < legChance;
    f.push({ k: "aspd", v: leg ? Math.round(v * 1.8) : v, legendary: leg });
  }
  for (let i = f.length; i < n && pool.length; i++) {
    const key = pool.splice((Math.random() * pool.length) | 0, 1)[0];
    const v = fxValue(key, q);
    const leg = Math.random() < legChance;
    f.push({ k: key, v: leg ? Math.round(v * 1.8) : v, legendary: leg });
  }
  return f;
}

function attrAssign(art, kind, q, lv) {
  const M = eqMult(q);
  if (kind === "w") {
    art.a = Math.round((4 + Math.random() * 15) * lv * M);
    art.d = Math.round((1 + Math.random() * 3) * lv * M);
    art.h = Math.round((20 + Math.random() * 60) * lv * M);
  } else if (kind === "a") {
    art.a = Math.round((1 + Math.random() * 4) * lv * M);
    art.d = Math.round((3 + Math.random() * 8) * lv * M);
    art.h = Math.round((40 + Math.random() * 100) * lv * M);
  } else {
    art.a = Math.round((2 + Math.random() * 6) * lv * M);
    art.d = Math.round((2 + Math.random() * 5) * lv * M);
    art.h = Math.round((30 + Math.random() * 80) * lv * M);
  }
}

// 生成一套6件装备 (兵/护/佩/功法 + 2件随机)
function makeEquipSet(lv, realmIdx) {
  const kinds = ["w", "a", "p", "s", "w", "p"]; // 兵器x2, 护具, 佩饰x2, 功法
  const arts = [];
  for (const kind of kinds) {
    const q = pickQ();
    const art = { kind, q, lv, fx: rollFx(kind, q) };
    attrAssign(art, kind, q, lv);
    arts.push(art);
  }
  return arts;
}

// 计算玩家总属性
function calcPlayerStats(lv, arts) {
  const baseAtk = 10 + 46 * lv;
  const baseHp = 100 + 330 * lv;
  const baseDef = 5 + 26 * lv;

  let flatAtk = 0, flatDef = 0, flatHp = 0;
  let pctAtk = 0, crit = 0, critB = 0, critD = 50, aspd = 0, pen = 0;

  for (const a of arts) {
    flatAtk += a.a || 0;
    flatDef += a.d || 0;
    flatHp += a.h || 0;
    for (const f of a.fx || []) {
      if (f.k === "atk") pctAtk += f.v;
      else if (f.k === "crit") crit += f.v;
      else if (f.k === "critB") critB += f.v;
      else if (f.k === "critD") critD += f.v;
      else if (f.k === "aspd") aspd += f.v;
      else if (f.k === "pen") pen += f.v;
    }
  }

  const totalAtk = Math.round((baseAtk + flatAtk) * (1 + pctAtk / 100));
  const totalAspd = 1.1 * (1 + aspd / 100);
  // 暴击期望倍率 = 1 + 暴击率×(暴击伤害-1) + 会心率×0.5
  const critMult = 1 + (crit / 100) * (critD / 100) + (critB / 100) * 0.5;

  return { atk: totalAtk, aspd: totalAspd, critMult, pen, hp: baseHp + flatHp, def: baseDef + flatDef };
}

// ── 8个技能对DPS的提升 (取中等等级: lv=5/10) ──
// 技能等级5时的数值 (from和to的中间值)
const SKILL_LV5 = {
  jianqi:  { chance: 17.5, dmg: 110 },   // 剑气斩: 17.5%概率, ×110%伤害
  sanlian: { chance: 14.5, dmg: 90 },     // 三连斩: 14.5%概率补刀, ×90%伤害必会心
  hengsao: { chance: 17, n: 3.5, dmg: 60 }, // 横扫: 17%概率, 波及3.5个, ×60%
  zhansha: { threshold: 15 },              // 斩杀: 残血15%以下伤害翻倍
  jifeng:  { chance: 35, dur: 6, mult: 2 }, // 疾风步: 击杀35%概率, 2倍速6秒
  suodi:   { chance: 6, dur: 3, mult: 3 },  // 缩地: 击杀6%概率, 3倍速3秒
  pojia:   { chance: 15, pen: 50 },        // 破甲: 15%概率无视50%防御
  zhuilie: { chance: 17.5, crit: 60 },     // 追猎: 击杀17.5%概率再击一次, +60%暴击
};

// 计算技能DPS加成 (不含身法倍速, 身法单独算)
function skillDpsMult(stats) {
  let mult = 1;
  const s = SKILL_LV5;

  // 剑气斩: 额外一次攻击
  mult += (s.jianqi.chance / 100) * (s.jianqi.dmg / 100) * stats.critMult;

  // 三连斩: 普攻后补刀 (必会心=×1.5)
  mult += (s.sanlian.chance / 100) * (s.sanlian.dmg / 100) * 1.5;

  // 横扫千军: 范围伤害 (平均波及3.5个, 但玩家通常只打1个主目标, 额外目标算0.5权重)
  mult += (s.hengsao.chance / 100) * (s.hengsao.dmg / 100) * (1 + (s.hengsao.n - 1) * 0.5);

  // 斩杀: 残血翻倍 (约10%的攻击发生在残血阶段)
  mult += 0.10 * 1.0; // 残血时伤害从1→2, 提升1倍, 发生概率10%

  // 破甲击: 无视防御 (怪防御约减伤30%, 无视50%防御≈增伤15%)
  mult += (s.pojia.chance / 100) * 0.15;

  // 追猎: 击杀后再击一次 (每次击杀17.5%概率额外一次攻击)
  // 这个在击杀循环里体现, 这里不算

  return mult;
}

// 身法倍速期望 (基于击杀频率)
function speedMultExpectation(killsPerSec) {
  if (killsPerSec <= 0) return 1;
  const avgKillInterval = 1 / killsPerSec;
  const s = SKILL_LV5;

  // 疾风步: 击杀后35%概率2倍速6秒
  const jifengCoverage = Math.min(1, (s.jifeng.dur * s.jifeng.chance / 100) / avgKillInterval);
  const jifengMult = 1 + jifengCoverage * (s.jifeng.mult - 1);

  // 缩地: 击杀后6%概率3倍速3秒
  const suodiCoverage = Math.min(1, (s.suodi.dur * s.suodi.chance / 100) / avgKillInterval);
  const suodiMult = 1 + suodiCoverage * (s.suodi.mult - 1);

  // 两个加速不叠加(取高的), 近似 = jifengMult * 0.8 + suodiMult * 0.2
  return jifengMult * 0.85 + suodiMult * 0.15;
}

// ── 妖潮模拟 ──
function simulateTrial(lv, realmIdx, N) {
  const results = [];
  for (let sim = 0; sim < N; sim++) {
    // 生成装备
    const arts = makeEquipSet(lv, realmIdx);
    const stats = calcPlayerStats(lv, arts);

    // 基础DPS
    const baseDps = stats.atk * stats.aspd * stats.critMult;
    const skillMult = skillDpsMult(stats);

    // 刷怪参数
    const batchInterval = 1.5;
    const batchSize = 5;
    const maxAlive = 20;
    const duration = 120;

    let time = 0;
    let spawnTimer = 0;
    let spawned = 0;
    let kills = 0;
    let bossKilled = false;
    let bossSpawned = false;
    const alive = [];

    // 身法倍速状态
    let speedTimer = 0;
    let speedMult = 1;

    while (time < duration) {
      const dt = 0.1;
      time += dt;

      // 身法倍速倒计时
      if (speedTimer > 0) {
        speedTimer -= dt;
        if (speedTimer <= 0) { speedMult = 1; speedTimer = 0; }
      }

      // 分批刷怪
      spawnTimer += dt;
      if (spawnTimer >= batchInterval && alive.length < maxAlive && spawned < 301) {
        spawnTimer = 0;
        for (let b = 0; b < batchSize && spawned < 301 && alive.length < maxAlive; b++) {
          spawned++;
          if (spawned === 301) {
            alive.push({ hp: bossHp(lv), maxHp: bossHp(lv), tier: 99, isBoss: true });
            bossSpawned = true;
          } else {
            const tier = tierForSpawn(spawned);
            alive.push({ hp: mobHp(lv, tier), maxHp: mobHp(lv, tier), tier });
          }
        }
      }

      // 玩家输出 (当前DPS = 基础DPS × 技能加成 × 身法倍速)
      const currentDps = baseDps * skillMult * speedMult;
      if (alive.length > 0) {
        alive.sort((a, b) => a.hp - b.hp);
        const target = alive[0];
        target.hp -= currentDps * dt;
        if (target.hp <= 0) {
          kills++;
          if (target.isBoss) bossKilled = true;
          alive.shift();

          // 击杀后触发身法技能
          const s = SKILL_LV5;
          if (Math.random() < s.jifeng.chance / 100) {
            speedMult = s.jifeng.mult;
            speedTimer = s.jifeng.dur;
          } else if (Math.random() < s.suodi.chance / 100) {
            speedMult = s.suodi.mult;
            speedTimer = s.suodi.dur;
          }

          // 追猎: 击杀后17.5%概率再击一次 (立即对下一个目标造成伤害)
          if (Math.random() < s.zhuilie.chance / 100 && alive.length > 0) {
            alive.sort((a, b) => a.hp - b.hp);
            alive[0].hp -= currentDps * 0.5; // 追猎伤害算半次攻击
            if (alive[0].hp <= 0) {
              kills++;
              if (alive[0].isBoss) bossKilled = true;
              alive.shift();
            }
          }
        }
      }
    }

    results.push({ kills, bossKilled, bossSpawned, spawned, dps: Math.round(baseDps * skillMult) });
  }
  return results;
}

// ── 运行 ──
const N = 1000;
const scenarios = [
  { lv: 2, name: "炼气期", realmIdx: 1 },
  { lv: 3, name: "筑基期", realmIdx: 2 },
  { lv: 4, name: "结丹期", realmIdx: 3 },
  { lv: 6, name: "元婴期", realmIdx: 5 },
  { lv: 7, name: "化神期", realmIdx: 6 },
  { lv: 9, name: "合体期", realmIdx: 8 },
  { lv: 12, name: "真仙期", realmIdx: 11 },
];

console.log("=".repeat(85));
console.log("妖潮击杀模拟 v2 (120秒, N=" + N + ", 1.5s/批×5只, 同屏20, 完整装备+8技能+身法)");
console.log("=".repeat(85));
console.log("");
console.log("境界".padEnd(8) + "基础DPS".padEnd(10) + "含技能DPS".padEnd(12) + "平均击杀".padEnd(10) + "中位数".padEnd(8) + "见BOSS".padEnd(8) + "杀BOSS".padEnd(8) + "离线加成");
console.log("-".repeat(85));

for (const sc of scenarios) {
  const results = simulateTrial(sc.lv, sc.realmIdx, N);
  const kills = results.map(r => r.kills).sort((a, b) => a - b);
  const avg = kills.reduce((s, k) => s + k, 0) / N;
  const median = kills[Math.floor(N / 2)];
  const bossSeenRate = results.filter(r => r.bossSpawned).length / N * 100;
  const bossKillRate = results.filter(r => r.bossKilled).length / N * 100;
  const avgDps = results.reduce((s, r) => s + r.dps, 0) / N;
  const avgBoost = Math.min(3.5, avg * 0.01 + (bossKillRate > 50 ? 0.5 : 0));

  console.log(
    sc.name.padEnd(8) +
    Math.round(avgDps / 1.9).toString().padEnd(10) +  // 粗略还原基础DPS
    Math.round(avgDps).toString().padEnd(12) +
    avg.toFixed(1).padEnd(10) +
    median.toString().padEnd(8) +
    bossSeenRate.toFixed(0) + "%".padEnd(7) +
    bossKillRate.toFixed(0) + "%".padEnd(7) +
    "+" + Math.round(avgBoost * 100) + "%"
  );
}

console.log("");
console.log("=".repeat(85));
console.log("结论");
console.log("=".repeat(85));
console.log("");
console.log("DPS构成: 基础攻击×攻速×暴击 ≈ baseDps, 8技能提升约×1.9, 身法倍速击杀后触发");
console.log("疾风步(击杀35%→2倍速6s)是核心: 杀得越快→加速覆盖率越高→DPS越高, 正反馈");
console.log("");
const allMedians = scenarios.map(sc => {
  const results = simulateTrial(sc.lv, sc.realmIdx, N);
  const kills = results.map(r => r.kills).sort((a, b) => a - b);
  const bossRate = results.filter(r => r.bossKilled).length / N * 100;
  return { name: sc.name, median: kills[Math.floor(N / 2)], bossRate };
});
console.log("大部分玩家(中位数):");
for (const m of allMedians) {
  const boost = Math.min(3.5, m.median * 0.01 + (m.bossRate > 50 ? 0.5 : 0));
  console.log(`  ${m.name}: ${m.median}只, 杀BOSS率${m.bossRate.toFixed(0)}% → +${Math.round(boost*100)}%`);
}
