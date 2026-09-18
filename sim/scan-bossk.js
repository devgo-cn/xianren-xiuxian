// 扫描 bossK(在新血量基础上再乘): 找"通关轮数↑ + 全红通关率↑ + 时长可控"的平衡点
const { simulate } = require("./sim-v59.js");
function run(tag, opt) {
  const N = 30, all = [];
  for (let i = 0; i < N; i++) all.push(simulate(opt));
  console.log("\n===== " + tag + " =====");
  console.log("境界 | 通关轮数(中位) | 耗时h(中位) | 全红通关率 | 平均玄天件数 | 失败率");
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
    console.log(rs[0].name + " | " + med(r => r.rounds) + " | " + med(r => r.wallH).toFixed(2) + " | " + (fullRed / rs.length * 100).toFixed(0) + "% | " + (redSum / rs.length * 4).toFixed(2) + " | " + (fail / N * 100).toFixed(0) + "%");
  }
  const g = all.map(s => s.grandWallH).sort((x, y) => x - y);
  console.log("全程耗时h(中位): " + g[(g.length / 2) | 0].toFixed(2));
}
run("bossK=2 (≈旧血×6~11)", { bossK: 2 });
run("bossK=3 (≈旧血×9~17)", { bossK: 3 });
run("bossK=4.5(≈旧血×13~25)", { bossK: 4.5 });
