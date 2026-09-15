#!/usr/bin/env node
/**
 * 拓扑分层：把 363 个顶层声明按依赖深度分层。
 * DAG 无环 → 每层可以独立成为模块，层内符号互不依赖。
 */
const fs = require('fs');
const SRC = process.argv[2] || '/root/.codebuddy/artifact/xianren-repo/xianren-xiuxian/game.js';
const srcText = fs.readFileSync(SRC, 'utf8');
const data = JSON.parse(fs.readFileSync('/tmp/analyze.json', 'utf8'));
const names = data.decls.map(d => d.name);
const idx = new Map(names.map((n, i) => [n, i]));
/* 注意: 用 Array.from 保证稠密 —— map/filter 在稀疏数组上会跳过空位 */
const refs = Array.from({ length: data.decls.length }, (_, i) =>
  data.decls[i].refs.map(r => idx.get(r)).filter(j => j !== undefined));

/* ---------- 顶层"副作用语句"（无声明名）的处理 ----------
 * 这类语句在加载时立即执行（如 `SND.initFiles()`、`window.SkillAPI = {...}`），
 * 它们自身不产生可被引用的名字，但**依赖别的符号**。
 * 若把它们当 L0，就会排到依赖之前 → "SND is not defined"。
 * 正确做法：给它们一个虚拟节点，层号 = 1 + max(其引用的符号层)。
 */
const nameSet = new Set(names);
const anonUnits = [];
if (data.units) {
  for (const u of data.units) {
    if (u.names.length) continue;
    // 匿名语句的引用：直接扫它的源码里的标识符
    const seg = srcText.slice(u.start, u.end);
    const used = new Set();
    for (const m of seg.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      const nm = m[1];
      if (nameSet.has(nm)) used.add(nm);
    }
    const deps = [...used].map(n => idx.get(n)).filter(j => j !== undefined);
    anonUnits.push({ ...u, deps });
  }
}

// 虚拟节点统一排在真实声明之后参与分层
const ANON_BASE = data.decls.length;
const allRefs = refs.concat(anonUnits.map(a => a.deps));
const N = allRefs.length;

const memo = new Map();
function layer(i, seen = new Set()) {
  if (memo.has(i)) return memo.get(i);
  if (seen.has(i)) return 0;          // 防御：真出现环就截断
  seen.add(i);
  let L = 0;
  for (const j of allRefs[i]) L = Math.max(L, layer(j, seen) + 1);
  seen.delete(i);
  memo.set(i, L);
  return L;
}

const layers = [];
data.decls.forEach((d, i) => {
  const L = layer(i);
  (layers[L] = layers[L] || []).push(d.name);
});

/* 匿名副作用语句：层号 = 1 + max(依赖层)，用于把它们排到依赖之后 */
const anonLayers = anonUnits.map((a, k) => {
  const i = ANON_BASE + k;
  return { unit: a, layer: layer(i) };
});


console.log('拓扑层数:', layers.length);
console.log();
layers.forEach((ns, L) => {
  if (!ns) return;
  const pad = String(L).padStart(2, ' ');
  const head = ns.slice(0, 10).join(', ');
  console.log(`  L${pad} ${String(ns.length).padStart(3)}个 | ${head}${ns.length > 10 ? ' …' : ''}`);
});

// 导出：为下一阶段的模块聚类提供分层数据
const out = data.decls.map((d, i) => ({ name: d.name, layer: memo.get(i), refs: refs[i], block: null }));
fs.writeFileSync('/tmp/layers.json', JSON.stringify({
  layers,
  decls: out,
  anonUnits: anonLayers.map(a => ({ id: a.unit.id, line: a.unit.line, layer: a.layer })),
}, null, 1), 'utf8');
console.log();
console.log('匿名副作用语句 ' + anonLayers.length + ' 条，层号分布: ' +
  JSON.stringify(anonLayers.reduce((o,a)=>{o['L'+a.layer]=(o['L'+a.layer]||0)+1;return o;},{})));
console.log();
console.log('已写 /tmp/layers.json');
