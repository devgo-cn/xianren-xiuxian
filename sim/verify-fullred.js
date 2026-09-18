// 验证: 新 BOSS 血量(逐境界锚全红25s斩杀)下的通关表现
const { simulate } = require("./sim-v59.js");
const N = 30;
const all = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) all.push(simulate({ dt: 0.05 }));
console.error(`(${N} 次全境界模拟, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
console.log("===== 新BOSS血量(锚全红25s) 现状跑 =====");
console.log("境界 | 通关轮数(中位) | 耗时h(中位) | 全红通关率 | 平均玄天件数 | 失败率");
let gw = [];
for (let bi = 0; bi < 12; bi++) {
  const rs = all.map(s => s.out[bi]).filter(Boolean);
  if (!rs.length) break;
  const med = (f) => { const a = rs.map(f).sort((x, y) => x - y); return a[(a.length / 2) | 0]; };
  let fullRed = 0, redSum = 0;
  for (const r of rs) {
    const qs = (r.qAtExit || "").split(",").map(Number);
    redSum += qs.filter(q => q === 5).length / qs.length;
    if (qs.every(q => q === 5)) fullRed++;
  }
  const fail = all.filter(s => s.out[bi] && s.out[bi].failed).length;
  gw.push(med(r => r.wallH));
  console.log(rs[0].name + " | " + med(r => r.rounds) + " | " + med(r => r.wallH).toFixed(2) + " | " + (fullRed / rs.length * 100).toFixed(0) + "% | " + (redSum / rs.length * 4).toFixed(2) + " | " + (fail / N * 100).toFixed(0) + "%");
}
const g = all.map(s => s.grandWallH).sort((x, y) => x - y);
console.log("全程耗时h(中位): " + g[(g.length / 2) | 0].toFixed(2) + "  (v5.9减半后旧血量为 5.5h)");
