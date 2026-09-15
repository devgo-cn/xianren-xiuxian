#!/usr/bin/env node
/**
 * game.js 结构分析器（基于 acorn 真正的 AST 解析，非正则）
 *
 * 产出：
 *  1. 顶层声明表（含每个声明的精确源码范围、是否含副作用）
 *  2. 每个声明的"自由变量"（它引用了哪些别的顶层符号）
 *  3. 区块边界（用 /* === 注释划分）
 *  4. 循环依赖矩阵
 *
 * 这是拆分工具链的第一环：没有精确的符号表，任何切分都是猜。
 */
const fs = require('fs');
const acorn = require('acorn');

const SRC = process.argv[2] || 'game.js';
const code = fs.readFileSync(SRC, 'utf8');

const ast = acorn.parse(code, {
  ecmaVersion: 2022,
  sourceType: 'module',
  locations: true,
  ranges: true,
});

// ---------- 1. 收集顶层声明 ----------
/**
 * 切分单元 = 一个"顶层语句"。
 *
 * 关键修正：`let a = 1, b = 2;` 是一条 VariableDeclaration 含两个 declarator，
 * 若按 declarator 各自切片会重复输出整条语句（首版 bug：_dsp 被输出两次导致重声明）。
 * 因此这里以 **语句** 为单位切片，语句内的所有 declarator 共享同一个 slice。
 */
const decls = [];           // 每个"名字"一条记录（用于符号表/依赖分析）
const units = [];           // 每个"顶层语句"一条记录（用于生成代码）

function patternNames(p, out) {
  if (!p) return;
  switch (p.type) {
    case 'Identifier': out.push(p.name); break;
    case 'ObjectPattern': p.properties.forEach(x => patternNames(x.value || x.argument, out)); break;
    case 'ArrayPattern': p.elements.forEach(x => x && patternNames(x, out)); break;
    case 'AssignmentPattern': patternNames(p.left, out); break;
    case 'RestElement': patternNames(p.argument, out); break;
    default: break;
  }
}

for (const n of ast.body) {
  const names = [];
  if (n.type === 'FunctionDeclaration') { if (n.id) names.push(n.id.name); }
  else if (n.type === 'ClassDeclaration') { if (n.id) names.push(n.id.name); }
  else if (n.type === 'VariableDeclaration') {
    for (const d of n.declarations) patternNames(d.id, names);
  } else {
    // 非声明语句（如 IIFE 立即执行、if 块）—— 单独成一个单元，无导出名
    units.push({ start: n.start, end: n.end, line: n.loc.start.line, names: [], node: n });
    continue;
  }
  const uid = units.length;
  for (const nm of names) {
    decls.push({
      name: nm, kind: n.type, declKind: n.type === 'VariableDeclaration' ? n.kind : null,
      start: n.start, end: n.end,
      line: n.loc.start.line, node: n, unit: uid,
    });
  }
  units.push({ start: n.start, end: n.end, line: n.loc.start.line, names, node: n });
}

const declByName = new Map();
for (const d of decls) declByName.set(d.name, d);
const allNames = new Set(declByName.keys());

// ---------- 2. 通用 AST 遍历 ----------
function walk(node, visit, parent) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'range' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach(c => walk(c, visit, node));
    else if (v && typeof v.type === 'string') walk(v, visit, node);
  }
}

// ---------- 3. 真正的词法作用域解析 ----------
/**
 * 关键：不能用"声明名集合"去近似局部绑定 —— 那会把任意嵌套函数里的形参
 * （比如到处都是的 `id` `m` `i` `state`）误判成遮蔽全局，导致自由变量表有大量噪声。
 * 正确做法是模拟 JS 作用域链：从引用点向上逐层查找最近的绑定。
 */
const FUNC_TYPES = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
]);
const BLOCK_SCOPED = new Set(['let', 'const']);

function patternNamesSet(p, out) {
  if (!p) return;
  switch (p.type) {
    case 'Identifier': out.add(p.name); break;
    case 'ObjectPattern':
      p.properties.forEach(x => patternNamesSet(x.value || x.argument, out));
      break;
    case 'ArrayPattern':
      p.elements.forEach(x => x && patternNamesSet(x, out));
      break;
    case 'AssignmentPattern': patternNamesSet(p.left, out); break;
    case 'RestElement': patternNamesSet(p.argument, out); break;
    default: break;
  }
}

/**
 * 为一个顶层声明收集"自由变量"：
 * 遍历其子树，对每个 Identifier 引用点，向父链回溯，找到最近的定义作用域；
 * 若最近绑定就在该声明内部 → 是局部，忽略；若一直回溯到声明之外 → 是自由变量。
 *
 * 实现方式：先把整棵子树里"所有绑定"按(作用域节点 → 绑定名)建表，
 * 再对每个引用判断它所在的最内层作用域链上是否有同名绑定。
 */
function freeRefsOf(node, selfName) {
  // scopeNode -> Set(names)。scopeNode 为 null 表示"顶层(声明之外)"
  const scopeBinds = new Map();
  const bind = (scopeNode, names) => {
    if (!scopeBinds.has(scopeNode)) scopeBinds.set(scopeNode, new Set());
    const s = scopeBinds.get(scopeNode);
    names.forEach(n => s.add(n));
  };

  // 建立作用域树：记录每个节点的父节点 + 该节点是否创建新作用域
  const parentOf = new Map();
  const scopeOfNode = new Map();   // node -> 它所属的作用域节点（最内层）
  const createsScope = new Set();

  // 声明所在的作用域节点 = node 自身（顶层声明内部的一切都在该声明作用域下）
  scopeOfNode.set(node, null);

  const build = (n, curScope) => {
    let scope = curScope;
    // 函数体创建新作用域
    if (FUNC_TYPES.has(n.type) && n !== node) {
      scope = n;
      createsScope.add(n);
    } else if (n.type === 'BlockStatement' || n.type === 'ForStatement' ||
      n.type === 'ForInStatement' || n.type === 'ForOfStatement' ||
      n.type === 'CatchClause' || n.type === 'SwitchStatement') {
      scope = n;
      createsScope.add(n);
    }
    scopeOfNode.set(n, scope);

    // 绑定收集
    if (FUNC_TYPES.has(n.type)) {
      const names = new Set();
      n.params.forEach(p => patternNamesSet(p, names));
      if (n.id && n.type === 'FunctionExpression') names.add(n.id.name);
      if (names.size) bind(n, names);
    }
    if (n.type === 'VariableDeclaration') {
      const names = new Set();
      n.declarations.forEach(d => patternNamesSet(d.id, names));
      if (names.size) bind(scope, names);
    }
    if (n.type === 'ClassDeclaration' || n.type === 'ClassExpression') {
      if (n.id) bind(scope, new Set([n.id.name]));
    }
    if (n.type === 'CatchClause' && n.param) {
      const names = new Set(); patternNamesSet(n.param, names);
      if (names.size) bind(n, names);
    }

    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => { if (c && typeof c.type === 'string') { parentOf.set(c, n); build(c, scope); } });
      else if (v && typeof v.type === 'string') { parentOf.set(v, n); build(v, scope); }
    }
  };
  build(node, node);

  // 判断引用点是否被局部遮蔽
  const isShadowed = (refNode, name) => {
    let s = scopeOfNode.get(refNode);
    while (s !== null && s !== undefined) {
      const b = scopeBinds.get(s);
      if (b && b.has(name)) return true;
      s = scopeOfNode.get(s) === s ? parentScopeOf(s) : scopeOfNode.get(s);
      // 沿作用域链向上：找到 s 的父作用域
      s = parentScopeOf(s);
    }
    return false;
  };
  const parentScopeOf = (scopeNode) => {
    let p = parentOf.get(scopeNode);
    while (p !== undefined && p !== null) {
      if (createsScope.has(p) || p === node) return p;
      p = parentOf.get(p);
    }
    return null;
  };

  const refs = new Set();

  /**
   * v2.9 FIX: 受控遍历需要"只跳过非引用子节点"，而不是"跳过整棵子树"。
   * 旧实现里 `Property` 分支直接 return —— 于是 `{ agg: fxAgg(arts) }` 这种
   * "键是字面量、值是调用表达式" 的属性，其 value 子树整棵被丢弃，
   * 导致 fxAgg 这类依赖漏检（表现为运行期 fxAgg is not defined）。
   *
   * 正确策略：用 skipCallback 决定某个子键是否下钻，遍历本身永不停。
   */
  const shouldSkipChild = (n, key) => {
    // 静态属性名 / 字面量键：不是引用
    if (n.type === 'MemberExpression' && !n.computed && key === 'property') return true;
    if (n.type === 'Property' && !n.computed && n.value !== n.key && key === 'key') return true;
    if (n.type === 'MethodDefinition' && !n.computed && key === 'key') return true;
    if (n.type === 'PropertyDefinition' && !n.computed && key === 'key') return true;
    // 函数/类自身的声明名：由 allNames 剪枝处理，此处不下钻无副作用
    return false;
  };

  const tv = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Identifier') {
      const nm = n.name;
      if (nm === selfName) return;
      if (!allNames.has(nm)) return;
      if (isShadowed(n, nm)) return;
      refs.add(nm);
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      if (shouldSkipChild(n, k)) continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => tv(c));
      else if (v && typeof v.type === 'string') tv(v);
    }
  };
  tv(node);

  return refs;
}

for (const d of decls) {
  d.refs = [...freeRefsOf(d.node, d.name)].sort();
}

// ---------- 4. 区块边界（注释驱动）----------
const lines = code.split('\n');
const blockMarks = [];
lines.forEach((ln, i) => {
  const m = ln.match(/^\/\*\s*=+\s*(.*?)\s*=*\s*$/);
  if (m && m[1]) blockMarks.push({ line: i + 1, title: m[1].replace(/\s*=+\s*\/?\s*$/, '').trim() });
});
blockMarks.push({ line: lines.length + 1, title: '__EOF__' });

for (let i = 0; i < blockMarks.length - 1; i++) {
  blockMarks[i].endLine = blockMarks[i + 1].line;
}
blockMarks.pop();

for (const b of blockMarks) b.decls = [];
for (const d of decls) {
  for (let i = blockMarks.length - 1; i >= 0; i--) {
    if (d.line >= blockMarks[i].line) { blockMarks[i].decls.push(d.name); break; }
  }
}

// ---------- 5. 输出 ----------
const out = {
  file: SRC,
  totalLines: lines.length,
  totalDecls: decls.length,
  blocks: blockMarks.map(b => ({
    title: b.title,
    line: b.line,
    endLine: b.endLine,
    decls: b.decls,
    declCount: b.decls.length,
  })),
  decls: decls.map(d => ({
    name: d.name,
    kind: d.kind,
    declKind: d.declKind,
    line: d.line,
    start: d.start,
    end: d.end,
    unit: d.unit,
    refs: d.refs,
  })),
  units: units.map((u, i) => ({ id: i, line: u.line, start: u.start, end: u.end, names: u.names })),
  totalLines: lines.length,
};

fs.writeFileSync('/tmp/analyze.json', JSON.stringify(out, null, 1), 'utf8');

console.log(`解析 ${SRC}: ${lines.length} 行, ${decls.length} 个顶层声明, ${blockMarks.length} 个区块`);
console.log(`输出: /tmp/analyze.json`);
console.log();

// 枢纽符号
const refCount = new Map();
for (const d of decls) for (const r of d.refs) refCount.set(r, (refCount.get(r) || 0) + 1);
console.log('=== 被引用最多的符号 TOP 20 ===');
[...refCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  .forEach(([n, c]) => console.log(`  ${n.padEnd(24)} ${c}`));

console.log();
console.log('=== 零依赖声明（可安全移出）===');
const zeroDep = decls.filter(d => d.refs.length === 0);
console.log(`  ${zeroDep.length} 个: ${zeroDep.slice(0, 12).map(d => d.name).join(', ')}${zeroDep.length > 12 ? ' …' : ''}`);
