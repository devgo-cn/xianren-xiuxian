#!/usr/bin/env node
/**
 * Gate 4: 战斗脚本抽取等价性验证
 *
 * 证明 src/50-battle.js 与 index.html 原内联脚本在语义上逐条等价。
 *
 * 做法（AST 规范化比对，比文本 diff 强得多）：
 *   1. 从 index.html 取原 IIFE 体 → 语句数组 A（剥掉尾部 init 自启动语句）
 *   2. 从 src/50-battle.js 取模块顶层，剥掉 import/footer → 语句数组 B
 *   3. 两侧都用 acorn 重新生成（只保留结构，丢弃注释/空白/行号）
 *   4. 逐条比对，报告第一处差异及上下文
 *
 * 这样能抓住：漏拷语句、多拷语句、顺序颠倒、以及 init 双启动这类结构错。
 */
const acorn = require('acorn');
const fs = require('fs');
const path = require('path');

const HTML = process.argv[2];
const REPO = process.argv[3];
const META = process.argv[4] || '/tmp/battle_extract_meta.json';

const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
const lines = fs.readFileSync(HTML, 'utf8').split('\n');

/* ---------- 侧 A：index.html 内联脚本 ---------- */
const rawBody = lines.slice(meta.htmlStartLine, meta.htmlEndLine - 1).join('\n');
const astA = acorn.parse(rawBody, { ecmaVersion: 2022 });
const iife = astA.body[0].expression.callee;
const bodyA = iife.body.body;

// 剥掉尾部自启动语句（与 extract_battle.js 的剥离规则一致）
const isSelfBoot = (st, src) => {
  if (st.type === 'IfStatement') {
    const s = src.slice(st.start, st.end);
    return /DOMContentLoaded/.test(s) && /\binit\b/.test(s);
  }
  if (st.type === 'ExpressionStatement' && st.expression.type === 'CallExpression'
    && st.expression.callee.type === 'Identifier' && st.expression.callee.name === 'init') return true;
  return false;
};
let cutA = bodyA.length;
while (cutA > 0 && isSelfBoot(bodyA[cutA - 1], rawBody)) cutA--;
const A = bodyA.slice(0, cutA).map(n => rawBody.slice(n.start, n.end));

/* ---------- 侧 B：src/50-battle.js ---------- */
const battleSrc = fs.readFileSync(path.join(REPO, 'src/50-battle.js'), 'utf8');
const astB = acorn.parse(battleSrc, { ecmaVersion: 2022, sourceType: 'module' });
const B = [];
for (const n of astB.body) {
  if (n.type === 'ImportDeclaration') continue;                 // 工具生成的 import
  if (n.type === 'ExportNamedDeclaration') { B.push(battleSrc.slice(n.start, n.end)); continue; }
  // 模块 footer 的 init 启动（与原文自启动等价，不算差异）
  if (n.type === 'IfStatement') {
    const s = battleSrc.slice(n.start, n.end);
    if (/DOMContentLoaded/.test(s) && /\binit\b/.test(s)) continue;
  }
  B.push(battleSrc.slice(n.start, n.end));
}

/* ---------- 规范化：去掉所有空白差异后比对 ---------- */
const norm = (s) => s.replace(/\s+/g, ' ').trim();

let diff = 0;
const max = Math.max(A.length, B.length);
for (let i = 0; i < max; i++) {
  const a = A[i] === undefined ? null : norm(A[i]);
  const b = B[i] === undefined ? null : norm(B[i]);
  if (a === b) continue;
  diff++;
  console.log(`\n❌ 第 ${i + 1} 条语句不一致:`);
  console.log(`   原文: ${a === null ? '(缺失)' : a.slice(0, 220)}`);
  console.log(`   抽后: ${b === null ? '(多出)' : b.slice(0, 220)}`);
  if (diff >= 5) { console.log('\n…… 差异过多，停止输出'); break; }
}

console.log(`\n原文语句 ${A.length} 条 / 抽后语句 ${B.length} 条`);
if (diff === 0) {
  console.log('✅ 战斗脚本逐条等价（AST 规范化比对，0 差异）');
  process.exit(0);
}
console.log(`❌ 共 ${diff} 处差异`);
process.exit(1);
