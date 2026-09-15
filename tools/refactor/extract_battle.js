#!/usr/bin/env node
/**
 * 抽取 index.html 内联战斗脚本 → src/50-battle.js（ES Module）
 *
 * 背景：index.html 第 758~2294 行有一个 1537 行的 IIFE 战斗脚本。
 *   它是【经典脚本】，顶层通过 window.BattleAPI / window.pushBattleStats 对外暴露，
 *   内部直接读写 game.js 的全局（state / SND / pushBattleStats / SkillAPI）。
 *
 * 抽取要解决三件事：
 *   1. 从 IIFE 变为 ES Module —— 但保留其"副作用注册"性质（加载即初始化）
 *   2. 外部依赖从"裸全局"变为显式 import（state / SND / pushBattleStats）
 *      · state 是可变绑定 → 读用 import，写走 __set_state（见 hub.js 的说明）
 *      · SkillAPI 来自 window.SkillAPI，保留 window 访问即可
 *   3. 模块需要在 game.js 之后加载（它依赖 game.js 提供的这些符号）
 *
 * ⚠️ 不改变任何战斗逻辑：脚本源码逐字保留，只做
 *    - 去掉外层 IIFE 包装与"DOMContentLoaded 自行触发 init"
 *    - 改写对外部符号的裸引用为 import 绑定
 *    - 追加 export（供垫片/其他模块使用）
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const HTML = process.argv[2];      // index.html 路径
const OUTDIR = process.argv[3];    // 仓库根目录
const analyze = JSON.parse(fs.readFileSync('/tmp/analyze.json', 'utf8'));
const declByName = new Map(analyze.decls.map(d => [d.name, d]));
const layersData = JSON.parse(fs.readFileSync('/tmp/layers.json', 'utf8'));
const layerOf = new Map(layersData.decls.map(d => [d.name, d.layer]));

const html = fs.readFileSync(HTML, 'utf8');
const lines = html.split('\n');

/* ---------- 1. 定位内联战斗脚本 ---------- */
// 找形如 <script>\n/* ... 战斗系统 ... */ 的块
let start = -1, end = -1;
for (let i = 0; i < lines.length; i++) {
  if (!/^\s*<script>\s*$/.test(lines[i])) continue;
  // 向下找第一个 </script>
  let j = i + 1;
  while (j < lines.length && !/^\s*<\/script>\s*$/.test(lines[j])) j++;
  const body = lines.slice(i + 1, j).join('\n');
  if (/战斗系统/.test(body)) { start = i; end = j; break; }
}
if (start < 0) { console.error('❌ 未找到内联战斗脚本'); process.exit(1); }

const rawBody = lines.slice(start + 1, end).join('\n');
console.log(`内联战斗脚本: index.html 第 ${start + 2}~${end} 行，${end - start - 1} 行`);

/* ---------- 2. 解析并定位 IIFE ---------- */
const ast = acorn.parse(rawBody, { ecmaVersion: 2022, locations: true, ranges: true });
if (ast.body.length !== 1) {
  console.error(`❌ 预期 1 条顶层语句，实际 ${ast.body.length} 条`); process.exit(1);
}
const top = ast.body[0];
if (top.type !== 'ExpressionStatement' || top.expression.type !== 'CallExpression') {
  console.error('❌ 预期 IIFE 调用表达式'); process.exit(1);
}
const iife = top.expression;
const fn = iife.callee;
if (!fn || (fn.type !== 'FunctionExpression' && fn.type !== 'ArrowFunctionExpression')) {
  console.error('❌ 预期函数表达式作为 IIFE'); process.exit(1);
}
console.log(`IIFE: ${fn.type}，参数 ${fn.params.length} 个，函数体 ${fn.body.body.length} 条语句`);

/* ---------- 3. 统计外部符号的裸引用 ---------- */
// 战斗脚本内部自己声明的名字（顶层 + 所有嵌套），用于排除自声明
const local = new Set();
(function collect(n, depth) {
  if (!n || typeof n.type !== 'string') return;
  if (n.type === 'VariableDeclaration') {
    const pn = (p) => {
      if (!p) return;
      if (p.type === 'Identifier') local.add(p.name);
      if (p.type === 'ObjectPattern') p.properties.forEach(x => pn(x.value || x.argument));
      if (p.type === 'ArrayPattern') p.elements.forEach(x => pn(x));
      if (p.type === 'AssignmentPattern') pn(p.left);
      if (p.type === 'RestElement') pn(p.argument);
    };
    n.declarations.forEach(d => pn(d.id));
  }
  if (n.type === 'FunctionDeclaration' && n.id) local.add(n.id.name);
  if (n.type === 'FunctionExpression' && n.id) local.add(n.id.name);
  if (n.type === 'ClassDeclaration' && n.id) local.add(n.id.name);
  if ((n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'FunctionDeclaration') && n.params) {
    n.params.forEach(p => {
      if (p.type === 'Identifier') local.add(p.name);
      if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') local.add(p.left.name);
      if (p.type === 'ObjectPattern') p.properties.forEach(x => { if (x.value && x.value.type === 'Identifier') local.add(x.value.name); });
    });
  }
  if (n.type === 'CatchClause' && n.param && n.param.type === 'Identifier') local.add(n.param.name);
  for (const k of Object.keys(n)) {
    if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach(c => collect(c));
    else if (v && typeof v.type === 'string') collect(v);
  }
})(fn.body, 0);

/* 用 AST 收集"被当作自由变量读取的标识符"（排除注释、字符串、成员属性名）。
 * 这是判断是否需要 import 的唯一可信依据 —— 正则会被注释骗到。 */
const freeRefs = new Set();
(function walk(n, key) {
  if (!n || typeof n.type !== 'string') return;
  if (n.type === 'Identifier') {
    // 处于成员访问的属性位（a.b 的 b）不算引用
    freeRefs.add(n.name);
    return;
  }
  for (const k of Object.keys(n)) {
    if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
    if (k === 'property' && n.type === 'MemberExpression' && !n.computed) continue;
    if (k === 'key' && (n.type === 'Property' || n.type === 'MethodDefinition' || n.type === 'PropertyDefinition') && !n.computed) continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach(c => walk(c));
    else if (v && typeof v.type === 'string') walk(v);
  }
})(fn.body);

const bareHits = (src, name) => (freeRefs.has(name) ? 1 : 0);

// 战斗脚本引用的、且不在 local 里的模块级符号
const EXTERNAL = [];
for (const nm of new Set([...declByName.keys()])) {
  if (local.has(nm)) continue;
  // 只在 AST 自由变量里出现才算真依赖；注释/字符串里的提及一律忽略
  const used = freeRefs.has(nm);
  if (!used) continue;
  const hits = (rawBody.match(new RegExp(`(?<![.\\w$])${nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`, 'g')) || []).length;
  EXTERNAL.push({ name: nm, hits, used });
}
EXTERNAL.sort((a, b) => b.hits - a.hits);
console.log(`\n战斗脚本的自由变量（需 import）:`);
EXTERNAL.forEach(e => console.log(`  ★ ${e.name.padEnd(20)} L${layerOf.get(e.name)}`));

/* ---------- 4. 生成模块源码 ---------- */
// 模块头 + 函数体（去 IIFE 包装）+ 尾部初始化调用
//
// ⚠️ 关键：IIFE 函数体的最后两条语句往往是
//      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
//      else init();
//   这是经典脚本"自行启动"的写法。若原样保留，再追加一次模块级 init 调用，
//   会导致 init() 被执行两次 → 双份 rAF 循环（画面双速、双倍 CPU）。
//   因此在 AST 层面把它们从 body 末尾剥掉，由 footer 统一启动一次。
const tailStmts = fn.body.body;
const isSelfBoot = (st) => {
  // 形态 A: if (...) <addEventListener DOMContentLoaded> else ...
  if (st.type === 'IfStatement') {
    const src = rawBody.slice(st.start, st.end);
    return /DOMContentLoaded/.test(src) && /\binit\b/.test(src);
  }
  // 形态 B: 单独的 init();
  if (st.type === 'ExpressionStatement' && st.expression.type === 'CallExpression'
    && st.expression.callee.type === 'Identifier' && st.expression.callee.name === 'init') {
    return true;
  }
  return false;
};
let cut = tailStmts.length;
while (cut > 0 && isSelfBoot(tailStmts[cut - 1])) cut--;
const stripped = tailStmts.length - cut;
const bodyEnd = stripped > 0 ? tailStmts[cut - 1].end : fn.body.end - 1;
const bodyCode = rawBody.slice(fn.body.start + 1, bodyEnd);
console.log(`剥离 IIFE 尾部自启动语句 ${stripped} 条（由模块 footer 统一启动）`);

// 逐符号计算 import 来源（复用 split2 的层段规则）
const SEGMENTS = [
  { file: 'src/00-pure.js', from: 0, to: 0 },
  { file: 'src/10-base.js', from: 1, to: 2 },
  { file: 'src/20-core.js', from: 3, to: 4 },
  { file: 'src/30-systems.js', from: 5, to: 7 },
  { file: 'src/40-app.js', from: 8, to: Infinity },
];
const segOf = (name) => {
  const l = layerOf.get(name);
  if (l === undefined) return null;
  return SEGMENTS.find(s => l >= s.from && l <= s.to);
};

// 找出所有 setter 调用（__set_xxx）判断哪些需要 import setter
const usedSetters = new Set();
{
  const re = /__set(_?)([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(rawBody))) usedSetters.add('__set' + m[1] + m[2]);
}
const setterOf = (n) => '__set' + (n.startsWith('_') ? '' : '_') + n;


const byModule = new Map();
for (const e of EXTERNAL) {
  const seg = segOf(e.name);
  if (!seg) { console.log(`  ⚠️ ${e.name} 无归属模块，跳过`); continue; }
  if (!byModule.has(seg.file)) byModule.set(seg.file, new Set());
  byModule.get(seg.file).add(e.name);
  // 若该符号的 setter 被调用，也要 import（setter 与声明同模块）
  const st = setterOf(e.name);
  if (usedSetters.has(st)) byModule.get(seg.file).add(st);
}
// 也覆盖"未被读取但被 setter 写入"的符号
for (const st of usedSetters) {
  const orig = st.replace(/^__set_?/, '');
  if (!declByName.has(orig)) continue;
  const seg = segOf(orig);
  if (!seg) continue;
  if (!byModule.has(seg.file)) byModule.set(seg.file, new Set());
  byModule.get(seg.file).add(st);
  // 复合赋值降级后仍需读原值
  const re = new RegExp(`(?<![.\\w$])${orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`, 'g');
  if (re.test(rawBody)) byModule.get(seg.file).add(orig);
}

const imports = [];
for (const f of ['src/00-pure.js', 'src/10-base.js', 'src/20-core.js', 'src/30-systems.js', 'src/40-app.js']) {
  if (!byModule.has(f)) continue;
  const rel = path.relative(path.dirname('src/50-battle.js'), f).replace(/\\/g, '/');
  imports.push(`import { ${[...byModule.get(f)].sort().join(', ')} } from '${rel.startsWith('.') ? rel : './' + rel}';`);
}

const header = `/**
 * 战斗系统（无尽边界式横向推进战斗）
 * 接入真实素材: cultivator_sheet.png(玩家) + main-bg.jpg(背景)
 *
 * 由 tools/extract_battle.js 从 index.html 内联 <script> 抽取（逻辑零改动）。
 * 原为经典脚本 IIFE，现改为 ES Module：
 *   - 原来直接读写的全局 state / SND / pushBattleStats 改为显式 import；
 *   - window.BattleAPI / window.pushBattleStats 仍显式挂载，外部接口不变；
 *   - 模块加载即初始化（保留原 IIFE 的副作用语义）。
 *
 * ⚠️ 本文件由工具生成，手改会在下次重建时丢失。
 */

`;

const footer = `
/* ── 模块加载即初始化（保留原 IIFE 的副作用语义，仅执行一次）─────────
 * 原脚本在 IIFE 末尾自行判断 DOMContentLoaded 后调用 init()，
 * 抽取时已剥离那段尾部语句，在此统一启动，避免双份 rAF 循环。
 * 加载序：game.js 垫片先载入并 bridge 全局 → 再 import 本模块 → 本模块 import
 * 00-pure/10-base/30-systems，故 init() 执行时 $ / state / makeArt 均已就绪。
 */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
`;

const out = header + imports.join('\n') + '\n\n' + bodyCode + '\n' + footer;

fs.writeFileSync(path.join(OUTDIR, 'src/50-battle.js'), out, 'utf8');
console.log(`\n已写入 src/50-battle.js  ${out.split('\n').length} 行`);

/* ---------- 5. 输出"要替换的 html 区间"，供调用方处理 ---------- */
fs.writeFileSync('/tmp/battle_extract_meta.json', JSON.stringify({
  htmlStartLine: start + 1,      // 1-based：<script>
  htmlEndLine: end + 1,          // 1-based：</script>
  bodyLines: end - start - 1,
  outLines: out.split('\n').length,
  imports: [...byModule.entries()].map(([f, s]) => ({ file: f, names: [...s].sort() })),
}, null, 1), 'utf8');
