const { simulate } = require("./sim-v59.js");
const N = 30, all = [];
for (let i = 0; i < N; i++) all.push(simulate({ dt: 0.05 }));
const QN = ["粗制","法器","灵器","古宝","灵宝","玄天"];
console.log("通关时四槽品质(每境界30样本):");
for (let bi = 0; bi < 12; bi++) {
  const rs = all.map(s => s.out[bi]).filter(Boolean);
  if (!rs.length) break;
  const cnt = [0,0,0,0,0,0];
  const slotQ = [0,0,0,0,0,0];
  let fullRed = 0;
  for (const r of rs) {
    const qs = (r.qAtExit || "").split(",").map(Number);
    const red = qs.filter(q => q === 5).length;
    cnt[red]++;
    if (red === 4) fullRed++;
    for (const q of qs) slotQ[q]++;
  }
  const tot = rs.length * 4;
  const nm = rs[0].name;
  console.log(nm + ": 全红通关率 " + (fullRed/tot*100).toFixed(0) + "% | 四槽玄天数 0/1/2/3/4 = " + cnt.join("/")
    + " | 槽位品质: 粗" + (slotQ[0]/tot*100).toFixed(0) + "% 法" + (slotQ[1]/tot*100).toFixed(0) + "% 灵" + (slotQ[2]/tot*100).toFixed(0)
    + "% 古" + (slotQ[3]/tot*100).toFixed(0) + "% 宝" + (slotQ[4]/tot*100).toFixed(0) + "% 红" + (slotQ[5]/tot*100).toFixed(0) + "%");
}
