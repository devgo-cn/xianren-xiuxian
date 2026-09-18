const { simulate } = require("./sim-v59.js");
const N = 15;
const all = [];
for (let i = 0; i < N; i++) all.push(simulate({ dt: 0.05, forceFullRed: true }));
const BIGS = ["凡人","炼气","筑基","结丹","元婴","化神","炼虚","合体","大乘","渡劫","真仙","天仙"];
console.log("全红面板 BOSS 斩杀用时(中位, 现血量) → 建议K(锚25s):");
for (let bi = 0; bi < 12; bi++) {
  const rs = all.map(s => s.out[bi]).filter(Boolean);
  if (!rs.length) break;
  const uses = rs.map(r => r.bossUse).filter(u => u > 0).sort((a,b)=>a-b);
  if (!uses.length) { console.log(BIGS[bi] + ": 无数据"); continue; }
  const med = uses[(uses.length/2)|0];
  console.log(BIGS[bi] + ": " + med.toFixed(1) + "s → K=" + (25/med).toFixed(2) + " (锚25s) / K2锚27.5s=" + (27.5/med).toFixed(2));
}
