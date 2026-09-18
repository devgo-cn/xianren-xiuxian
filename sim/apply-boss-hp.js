// 逐境界把 BOSS hp 锚定到 "全红面板 25s 斩杀" 的 2 倍厚度（K = 2 × 25 / 实测全红斩杀秒数）
// 扫描定档: bossK=2 → 全程8.9h(基线5.5h), 后期全红通关率43~60%, 前期51~54轮防过早通关
const fs = require("fs");
const P = __dirname + "/../src/00-pure.js";
let src = fs.readFileSync(P, "utf8");

// 实测全红面板 BOSS 斩杀用时中位数（旧血量, measure-run.js 产出）
const MED = [8.4, 6.5, 6.3, 4.5, 6.3, 7.0, 5.8, 5.2, 6.4, 5.6, 5.5, 5.3];
const NAMES = ["凡人","炼气","筑基","结丹","元婴","化神","炼虚","合体","大乘","渡劫","真仙","天仙"];
// 旧 hp 与行内锚点（slug 唯一）
const BOSSES = [
  ["giant_kitsune",        11900],
  ["jubokko",              47500],
  ["ancient_automaton",   190000],
  ["king_archial",        761000],
  ["radulac_the_voidvod",3040000],
  ["god_warrior_dagon",  12200000],
  ["god_warrior_osiris", 48600000],
  ["poseidon",          195000000],
  ["goddess_aphrodite", 779000000],
  ["sun_goddess",      3120000000],
  ["hades",           12500000000],
  ["the_fallen",      49700000000],
];

console.log("境界 | 旧hp | K=2×25/med | 新hp");
let miss = 0;
BOSSES.forEach(([slug, oldHp], bi) => {
  const K = 2 * 25 / MED[bi];
  // 取整到 3 位有效数字
  const mag = Math.pow(10, Math.floor(Math.log10(oldHp * K)) - 2);
  const newHp = Math.round((oldHp * K) / mag) * mag;
  const oldPat = `slug:'${slug}', hp:${oldHp},`;
  const newPat = `slug:'${slug}', hp:${newHp},`;
  const cnt = src.split(oldPat).length - 1;
  if (cnt !== 1) { console.log(`!! ${NAMES[bi]} 匹配 ${cnt} 处, 跳过`); miss++; return; }
  src = src.replace(oldPat, newPat);
  console.log(`${NAMES[bi]} | ${oldHp.toExponential(3)} | ×${K.toFixed(2)} | ${newHp.toExponential(3)}`);
});
if (miss) { console.log("有未匹配项, 不写回"); process.exit(1); }
fs.writeFileSync(P, src);
console.log("已写回 " + P);
