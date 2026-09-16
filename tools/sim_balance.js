/**
 * 闲人修仙 v5.0 数值平衡模拟
 * 验证: 装备境界×品级矩阵、极品词条、阿青评分、妖潮离线加成
 * 用法: node tools/sim_balance.js
 */

// ── 复刻游戏核心数值 (从 src/00-pure.js / 10-base.js / 30-systems.js 提取) ──

const BIGS = [
  { n: "凡人", segs: 1 }, { n: "炼气", segs: 13 }, { n: "筑基", segs: 4 },
  { n: "结丹", segs: 4 }, { n: "元婴", segs: 4 }, { n: "化神", segs: 4 },
  { n: "炼虚", segs: 4 }, { n: "合体", segs: 4 }, { n: "大乘", segs: 4 },
  { n: "渡劫", segs: 4 }, { n: "真仙", segs: 4 }, { n: "天仙", segs: 4 },
];

const QUALITY = [
  { name: "粗制", w: 50, mult: 1.10 },
  { name: "法器", w: 20, mult: 1.30 },
  { name: "灵器", w: 15, mult: 1.58 },
  { name: "古宝", w: 9,  mult: 2.00 },
  { name: "灵宝", w: 5,  mult: 2.70 },
  { name: "玄天", w: 1,  mult: 3.80 },
];

function eqMult(q) { return QUALITY[q].mult; }

// 品质roll (v5.0 去掉境界锁, 全6级按权重)
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

// 词条roll (v5.0 含极品词条)
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

// 装备属性 (境界lv × 品级q)
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

// 生成一件装备
function makeArt(kind, realmIdx) {
  const lv = realmIdx + 1;
  const q = pickQ();
  const art = { kind, q, lv, fx: rollFx(kind, q) };
  attrAssign(art, kind, q, lv);
  return art;
}

// 阿青评分 (v5.0 极品词条×1.3)
function artScore(a, realmIdx) {
  const lv = (realmIdx || 0) + 1;
  let base = (a.a || 0) + 3 * (a.d || 0) + (a.h || 0) / 30;
  const atkRef = 10 + 46 * lv, hpRef = 100 + 330 * lv, defRef = 5 + 26 * lv;
  let fx = 0;
  for (const f of (a.fx || [])) {
    const p = f.v / 100;
    let val = 0;
    if (f.k === "atk") val = p * atkRef;
    else if (f.k === "hp") val = p * hpRef / 30;
    else if (f.k === "dfn") val = p * defRef * 3;
    else if (f.k === "crit") val = p * atkRef * 0.55;
    else if (f.k === "critB") val = p * atkRef * 1.0;
    else if (f.k === "critD") val = p * atkRef * 0.15;
    else if (f.k === "pen") val = p * atkRef * 0.35;
    else if (f.k === "dodge") val = p * defRef * 1.4;
    else if (f.k === "life") val = p * atkRef * 0.5;
    else if (f.k === "aspd") val = p * atkRef * 0.8;
    fx += val * (f.legendary ? 1.3 : 1);
  }
  const STEP = [32, 38, 44, 50, 56, 62];
  const q = Math.max(0, Math.min(5, a.q | 0));
  const anchor = lv * STEP.slice(0, q).reduce((s, x) => s + x, 0);
  return Math.round(anchor + Math.min(lv * STEP[q], (base + fx) * 0.32));
}

// ── 模拟 ──

const N = 10000;
const realms = [1, 2, 3, 5, 8, 11]; // 炼气/筑基/结丹/元婴/合体/真仙 (realmIdx)
const kinds = ["w", "a", "p"];

console.log("=".repeat(70));
console.log("闲人修仙 v5.0 数值平衡模拟 (N=" + N + ")");
console.log("=".repeat(70));

// 1. 品质分布 (各境界出各品级概率)
console.log("\n【1】装备品质分布 (各境界roll出各品级概率%)");
console.log("-".repeat(70));
const qHeader = "境界".padEnd(6) + QUALITY.map(q => q.name.padEnd(6)).join("") + "玄天率";
console.log(qHeader);
for (const ri of realms) {
  const qCount = Array(6).fill(0);
  for (let i = 0; i < N; i++) { qCount[pickQ()]++; }
  const row = BIGS[ri].n.padEnd(6) + qCount.map(c => (c / N * 100).toFixed(1).padEnd(6)).join("") + (qCount[5] / N * 100).toFixed(1) + "%";
  console.log(row);
}

// 2. 极品词条出现率
console.log("\n【2】极品词条出现率 (每件装备至少1条极品的概率%)");
console.log("-".repeat(70));
console.log("境界".padEnd(6) + QUALITY.map(q => q.name.padEnd(6)).join(""));
for (const ri of realms) {
  const legByQ = Array(6).fill(0);
  const totalByQ = Array(6).fill(0);
  for (let i = 0; i < N; i++) {
    const q = pickQ();
    totalByQ[q]++;
    const fx = rollFx("w", q);
    if (fx.some(f => f.legendary)) legByQ[q]++;
  }
  const row = BIGS[ri].n.padEnd(6) + legByQ.map((c, i) => totalByQ[i] ? (c / totalByQ[i] * 100).toFixed(1).padEnd(6) : "0.0".padEnd(6)).join("");
  console.log(row);
}

// 3. 装备三围 (炼气期玄天 vs 结丹期粗制, 验证不破坏平衡)
console.log("\n【3】装备三围对比 (攻击均值, 验证境界×品级矩阵)");
console.log("-".repeat(70));
console.log("组合".padEnd(16) + "攻击".padEnd(10) + "防御".padEnd(10) + "生命".padEnd(10) + "评分");
const combos = [
  { ri: 1, q: 5, label: "炼气·玄天" },
  { ri: 1, q: 0, label: "炼气·粗制" },
  { ri: 3, q: 0, label: "结丹·粗制" },
  { ri: 3, q: 5, label: "结丹·玄天" },
  { ri: 5, q: 0, label: "元婴·粗制" },
  { ri: 11, q: 5, label: "真仙·玄天" },
];
for (const combo of combos) {
  let sa = 0, sd = 0, sh = 0, ss = 0;
  for (let i = 0; i < N; i++) {
    const lv = combo.ri + 1;
    const art = { q: combo.q, lv, fx: rollFx("w", combo.q) };
    attrAssign(art, "w", combo.q, lv);
    sa += art.a; sd += art.d; sh += art.h; ss += artScore(art, combo.ri);
  }
  console.log(combo.label.padEnd(16) + Math.round(sa/N).toString().padEnd(10) + Math.round(sd/N).toString().padEnd(10) + Math.round(sh/N).toString().padEnd(10) + Math.round(ss/N));
}

// 4. 妖潮离线加成分布
console.log("\n【4】妖潮离线加成分布 (301只怪池, 每只+1%, BOSS+50%, 封顶350%)");
console.log("-".repeat(70));
const killScenarios = [50, 100, 150, 200, 250, 300, 301];
console.log("击杀数".padEnd(8) + "含BOSS".padEnd(8) + "加成%".padEnd(10) + "说明");
for (const k of killScenarios) {
  const boss = k >= 301;
  const boost = Math.min(3.5, k * 0.01 + (boss ? 0.5 : 0));
  const note = k === 301 ? "全杀满(300+BOSS)" : k === 300 ? "杀满300普通未杀BOSS" : "";
  console.log(k.toString().padEnd(8) + (boss ? "是" : "否").padEnd(8) + (boost * 100).toFixed(0).padEnd(10) + note);
}

// 5. 怪物池T1-T10倍率
console.log("\n【5】怪物池T1-T10倍率 (301只怪池每30只升一档)");
console.log("-".repeat(70));
const tiers = [
  { t: 1, name: "妖群", mul: 1.00, range: "1-30" },
  { t: 2, name: "妖锐", mul: 1.20, range: "31-60" },
  { t: 3, name: "妖将", mul: 1.45, range: "61-90" },
  { t: 4, name: "妖卫", mul: 1.75, range: "91-120" },
  { t: 5, name: "妖王", mul: 2.10, range: "121-150" },
  { t: 6, name: "妖皇", mul: 2.50, range: "151-180" },
  { t: 7, name: "妖尊", mul: 2.95, range: "181-210" },
  { t: 8, name: "妖圣", mul: 3.45, range: "211-240" },
  { t: 9, name: "妖神", mul: 4.00, range: "241-270" },
  { t: 10, name: "妖帝", mul: 4.60, range: "271-300" },
];
console.log("档位".padEnd(6) + "名称".padEnd(8) + "倍率".padEnd(8) + "怪序号".padEnd(10) + "相对T1");
for (const t of tiers) {
  console.log(("T" + t.t).padEnd(6) + t.name.padEnd(8) + t.mul.toFixed(2).padEnd(8) + t.range.padEnd(10) + (t.mul / 1.0).toFixed(2) + "x");
}
console.log("BOSS".padEnd(6) + "妖王".padEnd(8) + "-".padEnd(8) + "301".padEnd(10) + "击杀+50%加成");

// 6. 技能Y轴命中范围
console.log("\n【6】技能Y轴命中范围");
console.log("-".repeat(70));
console.log("X轴范围: 攻击距离+200px (玩家前方)");
console.log("Y轴宽度: 120px (能同时命中并排/一排敌人)");
console.log("主目标: 全额伤害");
console.log("其余目标: 70%伤害 (原50%)");

console.log("\n" + "=".repeat(70));
console.log("模拟完成");
console.log("=".repeat(70));
