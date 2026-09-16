/**
 * 妖潮击杀模拟: 120秒内各境界玩家实际能杀多少只怪
 * 用法: node tools/sim_trial_kills.js
 */

// 怪物池T1-T10
const TIERS = [
  { t: 1, name: "妖群", mul: 1.00, hpK: 0.95 },
  { t: 2, name: "妖锐", mul: 1.20, hpK: 0.90 },
  { t: 3, name: "妖将", mul: 1.45, hpK: 0.85 },
  { t: 4, name: "妖卫", mul: 1.75, hpK: 1.10 },
  { t: 5, name: "妖王", mul: 2.10, hpK: 1.45 },
  { t: 6, name: "妖皇", mul: 2.50, hpK: 1.80 },
  { t: 7, name: "妖尊", mul: 2.95, hpK: 2.20 },
  { t: 8, name: "妖圣", mul: 3.45, hpK: 2.50 },
  { t: 9, name: "妖神", mul: 4.00, hpK: 2.80 },
  { t: 10, name: "妖帝", mul: 4.60, hpK: 3.20 },
];
const TIER_BANDS = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300];

function tierForSpawn(n) {
  for (let t = 1; t <= 10; t++) { if (n <= TIER_BANDS[t-1]) return t; }
  return 10;
}

// 怪物血量: (60 + 26*lv) * hpK * mul
function mobHp(lv, tierIdx) {
  const t = TIERS[tierIdx - 1];
  return Math.round((60 + 26 * lv) * t.hpK * t.mul);
}

// BOSS血量 (约5倍T10)
function bossHp(lv) {
  return Math.round((60 + 26 * lv) * 3.20 * 4.60 * 5);
}

// 玩家DPS估算
function playerDPS(lv, equipFactor) {
  // 基础攻击 = 10 + 46*lv
  const baseAtk = 10 + 46 * lv;
  // 装备攻击 = 基础 × equipFactor (炼气0.3, 高境界0.8)
  const equipAtk = baseAtk * equipFactor;
  const totalAtk = baseAtk + equipAtk;
  // 攻速1.1, 暴击+技能综合倍率1.3
  const aspd = 1.1;
  const critSkillMult = 1.3;
  return totalAtk * aspd * critSkillMult;
}

// 模拟一场妖潮 (120秒)
function simulateTrial(lv, equipFactor, N) {
  const results = [];
  for (let sim = 0; sim < N; sim++) {
    const dps = playerDPS(lv, equipFactor);
    const batchInterval = 1.5;  // v5.0 秒/批
    const batchSize = 5;        // v5.0 只/批
    const maxAlive = 20;        // v5.0 同屏上限
    const duration = 120;

    let time = 0;
    let spawnTimer = 0;
    let spawned = 0;
    let kills = 0;
    let bossKilled = false;
    let bossSpawned = false;
    const alive = [];  // {hp, maxHp, tier, isBoss}

    while (time < duration) {
      const dt = 0.1;  // 100ms步长
      time += dt;

      // 分批刷怪: 每1.5秒刷5只
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

      // 玩家输出 (优先打血最少的)
      if (alive.length > 0) {
        alive.sort((a, b) => a.hp - b.hp);
        const target = alive[0];
        target.hp -= dps * dt;
        if (target.hp <= 0) {
          kills++;
          if (target.isBoss) bossKilled = true;
          alive.shift();
        }
      }
    }

    results.push({ kills, bossKilled, bossSpawned, spawned, aliveCount: alive.length });
  }
  return results;
}

// ── 运行模拟 ──
const N = 2000;
const scenarios = [
  { lv: 2, name: "炼气期", equipFactor: 0.3 },
  { lv: 3, name: "筑基期", equipFactor: 0.4 },
  { lv: 4, name: "结丹期", equipFactor: 0.5 },
  { lv: 6, name: "元婴期", equipFactor: 0.6 },
  { lv: 7, name: "化神期", equipFactor: 0.7 },
  { lv: 9, name: "合体期", equipFactor: 0.8 },
  { lv: 12, name: "真仙期", equipFactor: 1.0 },
];

console.log("=".repeat(80));
console.log("妖潮击杀模拟 (120秒, N=" + N + ", 1.5s/批×5只, 同屏上限20, 90s刷完300只留30s打BOSS)");
console.log("=".repeat(80));
console.log("");
console.log("境界".padEnd(8) + "DPS".padEnd(8) + "平均击杀".padEnd(10) + "中位数".padEnd(8) + "见BOSS率".padEnd(10) + "杀BOSS率".padEnd(10) + "离线加成");
console.log("-".repeat(80));

for (const sc of scenarios) {
  const results = simulateTrial(sc.lv, sc.equipFactor, N);
  const kills = results.map(r => r.kills).sort((a, b) => a - b);
  const avg = kills.reduce((s, k) => s + k, 0) / N;
  const median = kills[Math.floor(N / 2)];
  const bossSeenRate = results.filter(r => r.bossSpawned).length / N * 100;
  const bossKillRate = results.filter(r => r.bossKilled).length / N * 100;
  const dps = playerDPS(sc.lv, sc.equipFactor);
  const avgBoost = Math.min(3.5, avg * 0.01 + (bossKillRate > 50 ? 0.5 : 0));

  console.log(
    sc.name.padEnd(8) +
    Math.round(dps).toString().padEnd(8) +
    avg.toFixed(1).padEnd(10) +
    median.toString().padEnd(8) +
    bossSeenRate.toFixed(0) + "%".padEnd(9) +
    bossKillRate.toFixed(0) + "%".padEnd(9) +
    "+" + Math.round(avgBoost * 100) + "%"
  );
}

console.log("");
console.log("=".repeat(80));
console.log("关键结论");
console.log("=".repeat(80));

const allMedians = scenarios.map(sc => {
  const results = simulateTrial(sc.lv, sc.equipFactor, N);
  const kills = results.map(r => r.kills).sort((a, b) => a - b);
  const bossRate = results.filter(r => r.bossKilled).length / N * 100;
  return { name: sc.name, median: kills[Math.floor(N / 2)], bossRate, avg: kills.reduce((s,k)=>s+k,0)/N };
});

console.log("");
console.log("大部分玩家(中位数)妖潮击杀数:");
for (const m of allMedians) {
  const boost = Math.min(3.5, m.median * 0.01 + (m.bossRate > 50 ? 0.5 : 0));
  console.log(`  ${m.name}: ${m.median}只, 杀BOSS率${m.bossRate.toFixed(0)}% → 离线加成 +${Math.round(boost*100)}%`);
}

console.log("");
console.log("设计验证:");
console.log("  90秒 × (5只/1.5秒) = 300只普通怪, 第91秒出BOSS, 留29秒输出");
console.log("  低境界玩家: DPS不足清不完300只, 见不到BOSS, 加成约+50~100%");
console.log("  中境界玩家: 刚好清完300只, 见到BOSS但可能打不完, 加成约+150~250%");
console.log("  高境界玩家: DPS溢出, 轻松清完300只+BOSS, 加成+350%封顶");
console.log("  → 301只怪池对高境界玩家可达, 低境界玩家有成长目标");
