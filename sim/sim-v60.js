/* sim-v60.js —— v5.17b 通关节奏模拟器(境界总停留口径)
 * 模型: 境界停留 = 推图卡图期(roundSim 验收中位, MOB_POOLS 未变) + 修为积累期(need/rateNow 1:1)
 * 修为乘区(源码 1:1): rateNow = 4 × (bi+1)^2.05 × artMult × arrMult × buffMult × boostMult
 *   · artMult: 4件品质按 QW_TABLE roll (源码 1:1)
 *   · buffMult: 本境界最高档丹方 × 覆盖率(旋钮 cov, 丹材来自兽潮采集)
 *   · boostMult: 兽潮余威(推图稳定后 48h 内持续 clear 刷新, boost=1.8 满档 → 2.8)
 *   · arrMult: 聚灵阵, 灵石时薪(上轮验收) → 步进升级 ARRAY_COST
 * 用法: node sim-v60.js [N] [cov]   → 输出各境界总停留中位 + 全程
 * 扫描: node sim-v60.js 200 0.6 scan → 对目标曲线反解 REALM_DAYS
 */
"use strict";
const fs = require("fs");
const path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "../src/00-pure.js"), "utf8");
function grab(marker) {
  const i = SRC.indexOf(marker);
  if (i < 0) throw new Error("marker not found: " + marker);
  let start = -1;
  for (let k = i; k < SRC.length; k++) { const c = SRC[k]; if (c === "{" || c === "[") { start = k; break; } }
  const open = SRC[start], close = open === "{" ? "}" : "]";
  let depth = 0, j = start, inStr = null;
  for (; j < SRC.length; j++) {
    const c = SRC[j];
    if (inStr) { if (c === "\\") j++; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "/" && SRC[j + 1] === "/") { while (j < SRC.length && SRC[j] !== "\n") j++; continue; }
    if (c === "/" && SRC[j + 1] === "*") { j = SRC.indexOf("*/", j) + 1; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error("unbalanced");
}
const C = {};
const ev = (m) => { let code = grab(m); code = code.replace(/^const (\w+) =/, "C.$1 =").replace(/^function (\w+)/, "C.$1 = function $1"); eval(code); };
ev("const QUALITY ="); ev("const QW_TABLE ="); ev("const RECIPES ="); ev("const BIGS =");
ev("const REALM_DAYS ="); ev("const SEG_SCALE ="); ev("const ARRAY_COST ="); ev("const arrMult =");
const { QUALITY, QW_TABLE, RECIPES, BIGS, REALM_DAYS, SEG_SCALE, ARRAY_COST, arrMult } = C;
const BIGS_N = BIGS.map(b => b.n);

/* ---- 上轮(v5.17 验收 N=10)推图卡图期中位(h) 与 灵石时薪(均值/h) —— MOB_POOLS 未变, 输入仍有效 ---- */
const PUSH_H  = [0.51, 0.37, 0.37, 0.49, 0.34, 0.17, 0.17, 0.17, 0.13, 0.20, 0.14, 0.17];
const SPIRIT_H = [119464, 137877, 149883, 173348, 191281, 211642, 220130, 242646, 267650, 276057, 315372, 315082];

/* ---- 本境界最高档 buff 类丹方 mult ---- */
const PILL_MULT = [];
{
  const perBig = {};
  for (const key in RECIPES) {
    const r = RECIPES[key];
    if (!r || typeof r !== "object" || !r.eff) continue;
    if (r.eff.k !== "buff" && r.eff.k !== "grand") continue;
    const b = r.big | 0;
    perBig[b] = Math.max(perBig[b] || 1, r.eff.mult || 1);
  }
  for (let bi = 0; bi < 12; bi++) PILL_MULT.push(perBig[bi] || 1);
}

const rnd = Math.random;
/* 品质 roll(源码 1:1) */
function pickQ(bi) {
  const qw = QW_TABLE[Math.min(QW_TABLE.length - 1, bi)];
  let x = rnd() * qw.reduce((s, r) => s + r, 0);
  for (let i = 0; i < QUALITY.length; i++) { x -= qw[i]; if (x <= 0) return i; }
  return 0;
}
/* artMult: 4件按 QW_TABLE roll(境界内前后两套取均值近似持续替换) */
function rollArtMult(bi) {
  let m = 0;
  for (let round = 0; round < 2; round++) {
    let s = 0;
    for (let i = 0; i < 4; i++) s += (QUALITY[pickQ(bi)].mult - 1);
    m += 1 + s * 0.12;
  }
  return m / 2;
}

/* 单次模拟: 返回 12 境界总停留(h) 数组 */
function simulate(cov, RD) {
  const rd = RD || REALM_DAYS;
  const out = [];
  let arrayLv = 0, spirit = 0;
  for (let bi = 0; bi < 12; bi++) {
    /* 推图卡图期 */
    let realmH = PUSH_H[bi];
    spirit += SPIRIT_H[bi] * realmH;
    /* 修为积累期: 数值积分(步长 300s 游戏时间) */
    const needTotal = bi === 0 ? 2500
      : SEG_SCALE * Math.pow(bi + 1, 3.0) * rd[bi] * 86400;
    const artM = rollArtMult(bi);
    const pillM = 1 + (PILL_MULT[bi] - 1) * cov;
    const boostM = 2.8;                     // 推图稳定后兽潮余威满档
    let exp = 0, t = 0;
    const dt = 300;
    while (exp < needTotal && t < 86400 * 400) {
      const rate = 4 * Math.pow(bi + 1, 2.05) * artM * arrMult(arrayLv) * pillM * boostM;
      exp += rate * dt; t += dt;
      spirit += SPIRIT_H[bi] * dt / 3600;
      if (arrayLv < 32 && spirit >= ARRAY_COST(arrayLv + 1)) { spirit -= ARRAY_COST(arrayLv + 1); arrayLv++; }
    }
    realmH += t / 3600;
    out.push({ bi, h: realmH, push: PUSH_H[bi], study: t / 3600, artM, arrM: arrMult(arrayLv), pillM, arrayLv });
  }
  return out;
}

const median = a => { const x = [...a].sort((p, q) => p - q); return x[(x.length / 2) | 0]; };

/* ---- 主入口 ---- */
const N = +(process.argv[2] || 200);
const cov = +(process.argv[3] || 0.6);
const MODE = process.argv[4] || "";
/* 目标曲线(用户锚): 炼气 3.5h 起单调递增 → 天仙 24h */
const TARGET = [0.5, 3.5, 5, 7, 9, 11, 13, 15, 17, 19, 21, 24];

if (MODE === "scan") {
  /* 反解迭代: RD 初值 → 模拟 → 按比例修正 → 3 轮 */
  let RD = [...REALM_DAYS];
  for (let iter = 0; iter < 4; iter++) {
    const all = [];
    for (let i = 0; i < N; i++) all.push(simulate(cov, RD));
    console.log(`\n--- 迭代 ${iter + 1} (cov=${cov}) ---`);
    console.log("境界 | 总停留h(中位) | 推图h | 修为h | 目标h | RD当前");
    let newRD = [...RD];
    for (let bi = 0; bi < 12; bi++) {
      const h = median(all.map(r => r[bi].h));
      const study = median(all.map(r => r[bi].study));
      const ratio = bi === 0 ? 1 : (h - PUSH_H[bi]) / Math.max(0.01, TARGET[bi] - PUSH_H[bi]);
      if (bi > 0) newRD[bi] = Math.max(0.05, RD[bi] / ratio);
      console.log(`${BIGS_N[bi]} | ${h.toFixed(2)} | ${PUSH_H[bi].toFixed(2)} | ${study.toFixed(2)} | ${TARGET[bi]} | ${RD[bi].toFixed(3)}${bi > 0 ? ` → ${newRD[bi].toFixed(3)}` : ""}`);
    }
    const total = median(all.map(r => r.reduce((s, x) => s + x.h, 0)));
    console.log(`全程总停留: 中位 ${total.toFixed(1)}h`);
    RD = newRD;
  }
  console.log("\n=== 收敛后 REALM_DAYS 建议 ===");
  console.log(JSON.stringify(RD.map(v => +v.toFixed(2))));
} else {
  /* 当前源码表跑一遍 */
  const all = [];
  for (let i = 0; i < N; i++) all.push(simulate(cov));
  console.log(`\n=== 当前 REALM_DAYS(源码表) 口径: 境界总停留 = 推图卡图 + 修为积累 (N=${N}, cov=${cov}) ===`);
  console.log("境界 | 总停留h(中位) | 推图h | 修为h | artMult(中位) | arrMult(中位) | 丹方mult | 聚灵阵lv(中位)");
  for (let bi = 0; bi < 12; bi++) {
    const h = median(all.map(r => r[bi].h));
    console.log(`${BIGS_N[bi]} | ${h.toFixed(2)} | ${PUSH_H[bi].toFixed(2)} | ${median(all.map(r => r[bi].study)).toFixed(2)} | ${median(all.map(r => r[bi].artM)).toFixed(2)} | ${median(all.map(r => r[bi].arrM)).toFixed(2)} | ${PILL_MULT[bi]} | ${median(all.map(r => r[bi].arrayLv))}`);
  }
  const total = median(all.map(r => r.reduce((s, x) => s + x.h, 0)));
  console.log(`全程总停留: 中位 ${total.toFixed(1)}h`);
}
