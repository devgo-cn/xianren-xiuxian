#!/usr/bin/env node
/**
 * 等价性验证器 —— 拆分是否"纯搬迁"的硬证明。
 *
 * 原理：把生成的所有模块拼回来，剥离 import 头与文件头注释，
 * 按"顶层语句源码文本"归一化后与原 game.js 的语句集合做双向比对：
 *   - 原文件每条语句必须在新产物中出现（无遗漏）
 *   - 新产物每条语句必须来自原文件（无凭空捏造）
 *   - 语句计数一致（无重复）
 *
 * 这比"跑一遍没报错"强得多：它能发现"某段代码被静默丢掉"这类致命但运行时不易暴露的问题。
 *
 * ⚠️ 关于"可变状态枢纽"带来的差异 ——
 *   hub.js 会把 `_hbFails = 0` 改写成 `__set__hbFails(0)`（ES Module 只读绑定限制）。
 *   这是**唯一**被允许的语义调整，且已在 hub.js 里逐符号核对过等价性。
 *   因此本验证器不直接比对原文，而是先对【原文件】套用同一套改写，
 *   再与产物比对 —— 这样能把"枢纽改写"从"真实丢失/篡改"里剥离出来。
 *   非枢纽部分仍然要求逐字一致。
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { execFileSync } = require('child_process');

const ORIG = process.argv[2];
const OUT = process.argv[3];
const USE_HUB = !process.argv.includes('--no-hub');

// 复现 hub.js 的改写（保证两边口径一致）
const setterOf = (n) => '__set' + (n.startsWith('_') ? '' : '_') + n;
// 与 hub.js 保持一致的相对路径改写（拆分后代码从仓库根搬到 src/）
function applyPathRewrite(src, rootDir) {
  if (!rootDir) return src;
  const fs2 = require('fs');
  if (!fs2.existsSync(rootDir)) return src;
  const sib = new Set(fs2.readdirSync(rootDir).filter(n => n.endsWith('.js')).map(n => './' + n));
  const ast = acorn.parse(src, { ecmaVersion: 2022, ranges: true, locations: true });
  const edits = [];
  const matchSibling = (lit) => {
    if (!lit || lit.type !== 'Literal' || typeof lit.value !== 'string') return null;
    const raw = lit.value;
    const q = raw.indexOf('?');
    const bare = q >= 0 ? raw.slice(0, q) : raw;
    if (!sib.has(bare)) return null;
    return { bare, tail: raw.slice(bare.length) };
  };
  (function scanPaths(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'ImportExpression' && n.source) {
      const hit = matchSibling(n.source);
      if (hit) edits.push({ start: n.source.start, end: n.source.end, repl: "'../" + hit.bare.slice(2) + "'" });
      if (n.source.type === 'BinaryExpression') {
        const h2 = matchSibling(n.source.left);
        if (h2) edits.push({ start: n.source.left.start, end: n.source.left.end, repl: "'../" + h2.bare.slice(2) + h2.tail + "'" });
      }
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(scanPaths);
      else if (v && typeof v.type === 'string') scanPaths(v);
    }
  })(ast);
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.repl + out.slice(e.end);
  return out;
}

function applyHubRewrite(src) {
  const ast = acorn.parse(src, { ecmaVersion: 2022, ranges: true, locations: true });
  const mutNames = new Set();
  const patNames = (p, out) => {
    if (!p) return;
    switch (p.type) {
      case 'Identifier': out.push(p.name); break;
      case 'ObjectPattern': p.properties.forEach(x => patNames(x.value || x.argument, out)); break;
      case 'ArrayPattern': p.elements.forEach(x => x && patNames(x, out)); break;
      case 'AssignmentPattern': patNames(p.left, out); break;
      case 'RestElement': patNames(p.argument, out); break;
    }
  };
  for (const n of ast.body) {
    if (n.type !== 'VariableDeclaration' || (n.kind !== 'let' && n.kind !== 'var')) continue;
    const names = [];
    n.declarations.forEach(d => patNames(d.id, names));
    names.forEach(x => mutNames.add(x));
  }
  const edits = [];
  (function scan(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'AssignmentExpression' && n.left && n.left.type === 'Identifier' && mutNames.has(n.left.name)) {
      const rhs = src.slice(n.right.start, n.right.end);
      let repl;
      switch (n.operator) {
        case '=':  repl = `${setterOf(n.left.name)}(${rhs})`; break;
        case '+=': repl = `${setterOf(n.left.name)}(${n.left.name} + (${rhs}))`; break;
        case '-=': repl = `${setterOf(n.left.name)}(${n.left.name} - (${rhs}))`; break;
        case '*=': repl = `${setterOf(n.left.name)}(${n.left.name} * (${rhs}))`; break;
        case '/=': repl = `${setterOf(n.left.name)}(${n.left.name} / (${rhs}))`; break;
        case '||=': repl = `${setterOf(n.left.name)}(${n.left.name} || (${rhs}))`; break;
        case '&&=': repl = `${setterOf(n.left.name)}(${n.left.name} && (${rhs}))`; break;
        case '??=': repl = `${setterOf(n.left.name)}(${n.left.name} ?? (${rhs}))`; break;
        default: repl = src.slice(n.start, n.end);
      }
      edits.push({ start: n.start, end: n.end, repl });
    }
    if (n.type === 'UpdateExpression' && n.argument && n.argument.type === 'Identifier' && mutNames.has(n.argument.name)) {
      const d = n.operator === '++' ? '+ 1' : '- 1';
      edits.push({ start: n.start, end: n.end, repl: `${setterOf(n.argument.name)}(${n.argument.name} ${d})` });
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(scan);
      else if (v && typeof v.type === 'string') scan(v);
    }
  })(ast);
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.repl + out.slice(e.end);
  return out;
}

function topLevelStatements(src) {
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module', ranges: true, locations: true });
  return ast.body.map(n => {
    const t = src.slice(n.start, n.end).replace(/\s+/g, ' ').trim();
    return { text: t, line: n.loc.start.line, type: n.type };
  });
}

const rawOrig = fs.readFileSync(ORIG, 'utf8');
const ROOT_DIR = process.argv[4] || null;
let origSrc = USE_HUB ? applyHubRewrite(rawOrig) : rawOrig;
origSrc = applyPathRewrite(origSrc, ROOT_DIR);
const orig = topLevelStatements(origSrc);

/* 收集产物 —— 只看切分产物目录。
 * ⚠️ 不能扫整个 OUT：仓库里还有 bg.js（背景绘制）、fx2d.js（特效）等
 *    与本拆分无关的独立文件，它们不属于 game.js 的搬迁范围，
 *    混进来会造成大量假"多余"告警（首版踩过）。
 *    split2.js 的产物固定在 <OUT>/src/ 下。 */
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(path.join(OUT, 'src'));

/* ⚠️ 本校验只回答一个问题："原 game.js 的语句有没有原样搬过来"。
 *    因此下列产物不属于比对范围，必须排除，否则全是假"多余"：
 *      - 50-battle.js  由 index.html 内联脚本抽取（另一条来源，另有 verify_battle.js 把关）
 *      - main.js       入口/桥接器（生成物）*/
const EXCLUDE = new Set(['50-battle.js', 'main.js']);

let newStmts = [];
for (const f of files.sort()) {
  if (EXCLUDE.has(path.basename(f))) continue;
  const src = fs.readFileSync(f, 'utf8');
  const st = topLevelStatements(src);
  for (const s of st) {
    // 生成物：跳过 import / export（它们不是原文件内容）
    if (s.type === 'ImportDeclaration') continue;
    if (s.type.startsWith('Export')) continue;
    if (/^export\s*\{/.test(s.text)) continue;
    // 枢纽模块的 setter 定义是新增产物，不是搬迁内容
    if (/^export function __set_?\w+\(v\) \{/.test(s.text)) continue;
    newStmts.push({ ...s, file: path.relative(OUT, f) });
  }
}

console.log(`原文件顶层语句: ${orig.length}${USE_HUB ? '（已套用枢纽改写）' : ''}`);
console.log(`产物顶层语句:   ${newStmts.length}  (来自 ${files.length} 个文件)\n`);

// 多重集比较
const key = s => s.text;
const cnt = (arr) => { const m = new Map(); for (const s of arr) m.set(key(s), (m.get(key(s)) || 0) + 1); return m; };
const mc = cnt(orig), mn = cnt(newStmts);

const missing = [], extra = [], dupMismatch = [];
for (const [k, v] of mc) {
  const w = mn.get(k) || 0;
  if (w === 0) missing.push(k);
  else if (w !== v) dupMismatch.push({ k, orig: v, neu: w });
}
for (const [k, v] of mn) {
  if (!mc.has(k)) extra.push(k);
}

console.log('=== 比对结果 ===');
console.log(`  缺失语句: ${missing.length}`);
console.log(`  多余语句: ${extra.length}`);
console.log(`  重复次数不符: ${dupMismatch.length}`);

const show = (t, arr) => {
  if (!arr.length) return;
  console.log(`\n--- ${t} ---`);
  arr.slice(0, 8).forEach(x => {
    const s = typeof x === 'string' ? x : x.k;
    console.log('  ' + s.slice(0, 150) + (s.length > 150 ? ' …' : ''));
  });
  if (arr.length > 8) console.log(`  … 另有 ${arr.length - 8} 条`);
};
show('缺失', missing);
show('多余', extra);
show('重复不符', dupMismatch);

const ok = !missing.length && !extra.length && !dupMismatch.length;
console.log(`\n${ok ? '✅ 等价性验证通过：产物是原文件的完整、无重复、无遗漏搬迁' : '❌ 等价性验证失败'}`);
process.exit(ok ? 0 : 1);
