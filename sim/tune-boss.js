const { simulate } = require("./sim-v59.js");
function run(tag, opt) {
  const N = 25, all = [];
  for (let i = 0; i < N; i++) all.push(simulate(opt));
  console.log("\n===== " + tag + " =====");
  console.log("境界 | 通关轮数(中位) | 耗时h(中位) | 全红通关率 | 平均玄天件数 | 失败率");
  let gw = [];
  for (let bi = 0; bi < 12; bi++) {
    const rs = all.map(s => s.out[bi]).filter(Boolean);
    if (!rs.length) break;
    const med = (f) => { const a = rs.map(f).sort((x,y)=>x-y); return a[(a.length/2)|0]; };
    let fullRed = 0, redSum = 0;
    for (const r of rs) {
      const qs = (r.qAtExit||"").split(",").map(Number);
      redSum += qs.filter(q=>q===5).length / qs.length;
      if (qs.every(q=>q===5)) fullRed++;
    }
    const fail = all.filter(s => s.out[bi] && s.out[bi].failed).length;
    gw.push(med(r=>r.wallH));
    console.log(rs[0].name + " | " + med(r=>r.rounds) + " | " + med(r=>r.wallH).toFixed(2) + " | " + (fullRed/rs.length*100).toFixed(0) + "% | " + (redSum/rs.length*4).toFixed(2) + " | " + (fail/N*100).toFixed(0) + "%");
  }
  console.log("全程耗时h(中位): " + (()=>{const a=all.map(s=>s.grandWallH).sort((x,y)=>x-y);return a[(a.length/2)|0];})().toFixed(2));
}
run("BOSS血×4.5 + 玄天下调", { bossK: 4.5, qnerf: true });
run("BOSS血×5.5 + 玄天下调", { bossK: 5.5, qnerf: true });
