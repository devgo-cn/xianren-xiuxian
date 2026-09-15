#!/usr/bin/env node
/**
 * 可变状态枢纽生成器（ES Module 只读绑定问题的结构性解法）
 *
 * ── 问题 ────────────────────────────────────────────────────────────
 * 拆分 game.js 后，`let _traceT = 0` 在 00-pure.js，而 20-core.js 里写
 * `_traceT = Date.now()`。ES Module 的 import 是【只读绑定】，
 * 于是抛 "Assignment to constant variable"。同理 27 个顶层可变量都中招。
 *
 * ── 三种解法对比 ────────────────────────────────────────────────────
 * A. 逐点改成 `NS._traceT = ...`
 *    需改 362 个读点 + 43 个写点，源码面目全非，"逐字搬迁"的可验证性彻底丢失。
 * B. 把变量全塞回同一个模块
 *    会破坏拓扑分层（写点分散在 5 个模块），退回单文件。
 * C. 【采用】独立枢纽模块 + 只改写 43 个写点
 *    - 读：`export let _traceT`，消费方照常 `import { _traceT }`，读语义不变、源码不改。
 *    - 写：改为调用枢纽导出的 setter `set_traceT(v)`，把赋值搬进枢纽模块内部。
 *      ES Module 规则只禁止"赋值给 import 的绑定"，不禁止"调用函数改模块内部状态"。
 *    → 改动面从 405 点降到 43 点，且全部集中在赋值表达式，机械可验证。
 *
 * ── 为什么 setter 用 `v => (_traceT = v)` 而不是 `_traceT = v` 函数体 ──
 *   写点里有 `_hbFails++`、`_equipId++`、`_hudAcc += x` 这类复合赋值。
 *   统一降级为"读旧值 + 写新值"：`set_hbFails(_hbFails + 1)`。
 *   这样 setter 只需一个赋值语义，43 个写点全部可机械转换，无需为每种运算符生成 setter。
 *
 * ── 副作用（必须确认）──────────────────────────────────────────────
 *   复合赋值 `x += e` 降级为 `set_x(x + e)` 后，`x` 被读两次→求值两次。
 *   本文件中 27 个枢纽符号全部是 number / object / array 引用，读取无副作用
 *   （不会触发 getter、不会推进迭代器），因此语义等价。已逐符号核对。
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const SRC = process.argv[2];
const OUTJSON = process.argv[3] || '/tmp/hub.json';
/* 仓库根目录（含 bg.js / fx2d.js）。
 * 不能从 SRC 推断 —— SRC 常是 /tmp/game.js.orig 这类临时副本，
 * 其同级目录里并没有这些运行时资源，会导致路径修正静默失效。 */
const ROOT_DIR = process.argv[4] || path.dirname(path.resolve(SRC));

const code = fs.readFileSync(SRC, 'utf8');
const ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module', locations: true });

/* ---------- 1. 找出所有顶层 let/var 声明名 ---------- */
const mutNames = new Map();      // name -> { kind, unitStart, node }
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
ast.body.forEach((n, i) => {
  if (n.type !== 'VariableDeclaration' || (n.kind !== 'let' && n.kind !== 'var')) return;
  const names = [];
  n.declarations.forEach(d => patNames(d.id, names));
  for (const nm of names) mutNames.set(nm, { kind: n.kind, bodyIdx: i, node: n });
});

/* ---------- 2. 找出所有"裸标识符赋值/自增"点 ---------- */
const writes = [];
const scan = (n) => {
  if (!n || typeof n.type !== 'string') return;
  if (n.type === 'AssignmentExpression' && n.left && n.left.type === 'Identifier' && mutNames.has(n.left.name)) {
    writes.push({ kind: 'assign', name: n.left.name, op: n.operator, start: n.start, end: n.end, node: n });
  }
  if (n.type === 'UpdateExpression' && n.argument && n.argument.type === 'Identifier' && mutNames.has(n.argument.name)) {
    writes.push({ kind: 'update', name: n.argument.name, op: n.operator, prefix: n.prefix, start: n.start, end: n.end, node: n });
  }
  for (const k of Object.keys(n)) {
    if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v.type === 'string') scan(v);
  }
};
scan(ast);

/* ---------- 2b. 相对路径修正（拆分带来的目录变化）----------
 * 原 game.js 位于仓库根目录，代码里的 `import("./fx2d.js")`、`import("./bg.js")`
 * 相对根目录解析，正好命中同级的 fx2d.js / bg.js。
 * 拆分后这些语句落在 src/ 子目录里，同一个字符串会解析成 src/fx2d.js → 404。
 *
 * 修法：把这类"引用仓库根目录同级文件"的相对路径升一级为 '../xxx.js'。
 * 只改动态 import / new Worker / fetch 等**字符串字面量恰好是 './名字.js'** 的场景，
 * 且只针对确实存在于仓库根目录的文件名，不做全局替换（避免误伤模块间 import）。
 */
const ROOT_SIBLINGS = new Set(
  fs.existsSync(ROOT_DIR)
    ? fs.readdirSync(ROOT_DIR).filter(n => n.endsWith('.js')).map(n => './' + n)
    : []
);
const pathEdits = [];
(function scanPaths(n) {
  if (!n || typeof n.type !== 'string') return;
  // import("./x.js") / import("./x.js?v=" + VER)
  if (n.type === 'ImportExpression' && n.source) {
    const src2 = n.source;
    /* ⚠️ 查询串常常写在字面量【内部】：`import("./fx2d.js?v=" + CACHE_VER)`
     * 这里字面量值是 "./fx2d.js?v="，直接拿去比同级文件表会永远不匹配（首版踩过）。
     * 正确做法：先剥掉 "?" 之后的部分，得到真正裸文件名再判定，
     * 改写时只替换文件名那一段，保留原有的 ?v= 查询串。 */
    const matchSibling = (lit) => {
      if (!lit || lit.type !== 'Literal' || typeof lit.value !== 'string') return null;
      const raw = lit.value;
      const q = raw.indexOf('?');
      const bare = q >= 0 ? raw.slice(0, q) : raw;
      if (!ROOT_SIBLINGS.has(bare)) return null;
      return { bare, tail: raw.slice(bare.length) };
    };
    // 纯字面量：import("./x.js") 或 import("./x.js?v=")
    {
      const hit = matchSibling(src2);
      if (hit) pathEdits.push({ start: src2.start, end: src2.end, repl: "'../" + hit.bare.slice(2) + "'", from: hit.bare, to: '../' + hit.bare.slice(2) });
    }
    // 拼接：import("./x.js" + qs) —— 左侧字面量含文件名（可能自带 ?v=）
    if (src2.type === 'BinaryExpression') {
      const hit = matchSibling(src2.left);
      if (hit) pathEdits.push({ start: src2.left.start, end: src2.left.end, repl: "'../" + hit.bare.slice(2) + hit.tail + "'", from: hit.bare + hit.tail, to: '../' + hit.bare.slice(2) + hit.tail });
    }
  }
  for (const k of Object.keys(n)) {
    if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach(scanPaths);
    else if (v && typeof v.type === 'string') scanPaths(v);
  }
})(ast);

/* ---------- 3. 生成 setter 名 ---------- */
// 统一前缀 `__set_`，避免与源码里任何标识符撞名，也避免 `set`+`state`→`setstate` 这种黏连。
// `_traceT` → `__set__traceT`; `state` → `__set_state`
const setterOf = (n) => '__set' + (n.startsWith('_') ? '' : '_') + n;

/* ---------- 4. 按"从后往前"顺序重写（保证偏移量不失效）---------- */
// 赋值重写 + 相对路径修正一起按位置倒序应用（保证偏移不失效）
const allEdits = [
  ...writes.map(w => ({ kind: 'write', start: w.start, end: w.end, w })),
  ...pathEdits.map(e => ({ kind: 'path', start: e.start, end: e.end, e })),
].sort((a, b) => b.start - a.start);

let out = code;
const report = { total: writes.length, byName: {}, rewritten: [], pathFixed: [] };

/* 统一编辑循环：从后往前应用，避免前一次替换影响后一次的偏移。
 * 两类编辑共用一套流程：
 *   - write：裸赋值 → setter 调用（ES Module 只读绑定限制）
 *   - path ：相对路径 './x.js' → '../x.js'（拆分后代码从根目录搬进 src/）
 */
for (const ed of allEdits) {
  if (ed.kind === 'path') {
    out = out.slice(0, ed.start) + ed.e.repl + out.slice(ed.end);
    report.pathFixed.push(`L${ed.e.from ? '' : ''}${ed.e.from} → ${ed.e.to}`);
    continue;
  }
  const w = ed.w;
  const src = code.slice(w.start, w.end);
  let repl;
  if (w.kind === 'assign') {
    switch (w.op) {
      case '=':   repl = `${setterOf(w.name)}(${code.slice(w.node.right.start, w.node.right.end)})`; break;
      case '+=':  repl = `${setterOf(w.name)}(${w.name} + (${code.slice(w.node.right.start, w.node.right.end)}))`; break;
      case '-=':  repl = `${setterOf(w.name)}(${w.name} - (${code.slice(w.node.right.start, w.node.right.end)}))`; break;
      case '*=':  repl = `${setterOf(w.name)}(${w.name} * (${code.slice(w.node.right.start, w.node.right.end)}))`; break;
      case '/=':  repl = `${setterOf(w.name)}(${w.name} / (${code.slice(w.node.right.start, w.node.right.end)}))`; break;
      case '||=': repl = `${setterOf(w.name)}(${w.name} || (${code.slice(w.node.right.start, w.node.right.end)}))`; break;
      case '&&=': repl = `${setterOf(w.name)}(${w.name} && (${code.slice(w.node.right.start, w.node.right.end)}))`; break;
      case '??=': repl = `${setterOf(w.name)}(${w.name} ?? (${code.slice(w.node.right.start, w.node.right.end)}))`; break;
      default: throw new Error('未支持的赋值运算符 ' + w.op + ' @L' + w.node.loc.start.line);
    }
  } else {
    // `x++` / `++x` / `x--` / `--x`
    const d = w.op === '++' ? '+ 1' : '- 1';
    repl = `${setterOf(w.name)}(${w.name} ${d})`;
  }
  out = out.slice(0, w.start) + repl + out.slice(w.end);
  report.byName[w.name] = (report.byName[w.name] || 0) + 1;
  report.rewritten.push({ line: w.node.loc.start.line, name: w.name, op: w.op, before: src.trim(), after: repl.trim() });
}

report.rewritten.sort((a, b) => a.line - b.line);
fs.writeFileSync(OUTJSON, JSON.stringify(report, null, 1), 'utf8');

/* ---------- 5. 生成枢纽模块源码 ---------- */
// 枢纽只放"被跨模块赋值"的符号；输入由 split2.js 决定，这里输出全部可变符号的 setter，
// 由 split2.js 过滤出实际需要的子集。
const setterSrc = [...mutNames.keys()].sort().map(n =>
  `export function ${setterOf(n)}(v) { ${n} = v; return v; }`
).join('\n');

console.log(`裸赋值/自增点: ${report.total} 个`);
for (const [n, c] of Object.entries(report.byName).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.padEnd(18)} ${c} 处`);
}
console.log(`\n重写报告: ${OUTJSON}`);
console.log(`将生成 ${mutNames.size} 个 setter`);

fs.writeFileSync('/tmp/hub-setters.txt', setterSrc, 'utf8');
fs.writeFileSync('/tmp/game.hub.js', out, 'utf8');
console.log('重写后源码: /tmp/game.hub.js');
