#!/usr/bin/env node
/**
 * 最终切分器 v2：按【拓扑层】切分（保证无环），层聚合成有语义的文件组。
 *
 * 为什么按层而不是按业务功能：
 *   实测 game.js 是 11 层完美分层的 DAG（层内零依赖、跨层全部单向）。
 *   任何"按业务功能"的切法都必然横切多层 → 产生模块环（已验证会形成 1 个含 11 模块的巨环）。
 *   按层切 → 数学上保证无环，import 顺序天然正确，零风险。
 *   文件名用"层段"语义命名，兼顾可读性。
 */
const fs = require('fs');
const path = require('path');

const REPO = process.argv[2];
const OUT = process.argv[3];
const DRY = process.argv.includes('--dry');

const code = fs.readFileSync(path.join(REPO, 'game.js'), 'utf8');
const analyze = JSON.parse(fs.readFileSync('/tmp/analyze.json', 'utf8'));
const layersData = JSON.parse(fs.readFileSync('/tmp/layers.json', 'utf8'));
const declByName = new Map(analyze.decls.map(d => [d.name, d]));
const layerOf = new Map(layersData.decls.map(d => [d.name, d.layer]));
const MAX_L = layersData.layers.length - 1;

/* ---------- 层段 → 文件 ----------
 * 注意 L 上界：匿名副作用语句的层号可能超过声明的最大层
 * （如 `setTimeout(boot,0)` 依赖 boot(L10) → L11）。故末段用 Infinity 兜底。
 */
const SEGMENTS = [
  { file: 'src/00-pure.js', from: 0, to: 0, desc: '纯数据与零依赖常量（境界/法宝/材料/丹方/剧情文案/颜色表）' },
  { file: 'src/10-base.js', from: 1, to: 2, desc: '基础工具与协议（编码/存档编解码/排名标签/数值基础/公式）' },
  { file: 'src/20-core.js', from: 3, to: 4, desc: '核心服务（本地存档读写/云存档传输/境界推进/主界面刷新）' },
  { file: 'src/30-systems.js', from: 5, to: 7, desc: '玩法系统（云游/丹房/装备/巡猎/里程碑/心跳）' },
  { file: 'src/40-app.js', from: 8, to: Infinity, desc: '应用装配（云引导/开屏门禁/启动/主循环/顶层副作用语句）' },
];

// 校验层段覆盖全部层
{
  const seen = new Set();
  for (const s of SEGMENTS) {
    const hi = s.to === Infinity ? MAX_L + 5 : s.to;
    for (let l = s.from; l <= hi; l++) seen.add(l);
  }
  for (let l = 0; l <= MAX_L; l++) if (!seen.has(l)) {
    console.error(`层段未覆盖 L${l}`); process.exit(1);
  }
}

const declSeg = new Map();   // decl名 -> segment
for (const d of analyze.decls) {
  const l = layerOf.get(d.name);
  const seg = SEGMENTS.find(s => l >= s.from && l <= s.to);
  if (!seg) { console.error(`无法归属 L${l} (${d.name})`); process.exit(1); }
  declSeg.set(d.name, seg);
}

/* ---------- 模块级依赖 + 无环校验 ---------- */
const segDeps = new Map(SEGMENTS.map(s => [s.file, new Set()]));
const segEdges = [];
for (const d of analyze.decls) {
  const from = declSeg.get(d.name).file;
  for (const r of d.refs) {
    if (!declByName.has(r)) continue;
    const to = declSeg.get(r).file;
    if (to && to !== from) {
      segDeps.get(from).add(to);
      segEdges.push({ from, to, fromSym: d.name, toSym: r });
    }
  }
}

// 拓扑排序校验
const order = [], mark = new Map();
function visit(f, stack) {
  if (mark.get(f) === 2) return true;
  if (mark.get(f) === 1) {
    console.error(`❌ 层段间循环: ${stack.concat(f).join(' → ')}`);
    return false;
  }
  mark.set(f, 1);
  for (const d of segDeps.get(f)) if (!visit(d, stack.concat(f))) return false;
  mark.set(f, 2); order.push(f);
  return true;
}
let ok = true;
for (const s of SEGMENTS) if (!visit(s.file, [])) ok = false;
if (!ok) process.exit(1);

/* ---------- 统计 ---------- */
console.log(`game.js ${analyze.totalLines} 行 / ${analyze.decls.length} 声明 / L0~L${MAX_L}\n`);
console.log('=== 切分结果（按拓扑层段）===');
for (const s of SEGMENTS) {
  const ds = analyze.decls.filter(d => declSeg.get(d.name).file === s.file);
  const ls = ds.map(d => layerOf.get(d.name));
  const dep = [...segDeps.get(s.file)].map(f => path.basename(f)).join(', ') || '(无)';
  console.log(`  ${s.file.padEnd(20)} L${String(Math.min(...ls)).padStart(2)}~L${String(Math.max(...ls)).padStart(2)}  ${String(ds.length).padStart(3)}个`);
  console.log(`    ${s.desc}`);
  console.log(`    依赖: ${dep}`);
}
console.log(`\n拓扑序: ${order.map(f => path.basename(f)).join(' → ')}  ✅ 无环`);

/* ---------- 生成文件（按"语句单元"输出，避免多声明语句被重复切片）---------- */
// unit 归属层段：
//  - 有声明名的 unit → 用其名字的层（若多名字跨层，取最低层，保证被依赖方先出现）
//  - 匿名副作用语句 → 用 layers.js 算出的 anonUnits.layer（= 1 + max(依赖层)）
const anonLayer = new Map((layersData.anonUnits || []).map(a => [a.id, a.layer]));

const unitSeg = new Map();
for (const u of analyze.units) {
  let l;
  if (u.names.length) {
    const lls = u.names.map(n => layerOf.get(n)).filter(x => x !== undefined);
    l = lls.length ? Math.min(...lls) : 0;
  } else {
    l = anonLayer.has(u.id) ? anonLayer.get(u.id) : 0;
  }
  const seg = SEGMENTS.find(s => l >= s.from && l <= s.to);
  if (!seg) { console.error(`unit ${u.id} (行${u.line}) 层 ${l} 无法归属`); process.exit(1); }
  unitSeg.set(u.id, seg);
}

// 同一个 unit 内的名字若被分到不同层段，说明该语句跨层——必须整体放在最高层段，
// 否则低段里的名字会引用不到高段；这里直接取"最高段"以保守保证依赖完整。
let bumped = 0;
for (const u of analyze.units) {
  if (u.names.length < 2) continue;
  const lls = u.names.map(n => layerOf.get(n)).filter(x => x !== undefined);
  if (!lls.length) continue;
  const hi = SEGMENTS.find(s => Math.max(...lls) >= s.from && Math.max(...lls) <= s.to);
  if (hi && hi.file !== unitSeg.get(u.id).file) { unitSeg.set(u.id, hi); bumped++; }
}
if (bumped) console.log(`注: ${bumped} 条多声明语句因跨层被提升到较高层段`);

/* ---------- 可变状态枢纽（ES Module 只读绑定问题的结构性解法）----------
 *
 * 问题：`let _traceT = 0` 声明在 00-pure.js，20-core.js 里写 `_traceT = Date.now()`。
 *   ES Module 的 import 是【只读绑定】，赋值直接抛 "Assignment to constant variable"。
 *   本文件 39 个顶层 let/var 中有 27 个存在跨模块赋值。
 *
 * 三种解法对比：
 *   A. 逐点改成命名空间 `NS._traceT = ...` → 需改 362 读点 + 45 写点，源码面目全非。
 *   B. 把变量全塞回同一模块 → 写点分散在 5 个模块，会退回单文件、破坏分层。
 *   C. 【采用】独立枢纽模块 + 只改写 45 个写点（hub.js 已完成重写）
 *      - 读：`export let _traceT`，消费方 `import { _traceT }` 照常，读语义不变。
 *      - 写：hub.js 已把 `_traceT = e` 改写为 `__set_traceT(e)`，赋值搬进枢纽模块内部。
 *      ES Module 只禁止"赋值给 import 的绑定"，不禁止"调用函数改模块内部状态"。
 *
 * 因此本步骤只需：
 *   1. 确认哪些符号真的跨模块（决定是否搬进枢纽）；
 *   2. 生成 05-mut.js（声明 + setter）；
 *   3. 各模块 import 时补上对应的 setter 名。
 */
// 1) 收集顶层 let/var 声明
const mutNames = new Map();  // name -> { declareSeg, assigns:Set<segFile> }
for (const d of analyze.decls) {
  if (d.declKind !== 'let' && d.declKind !== 'var') continue;
  const seg = unitSeg.get(d.unit);
  if (!seg) continue;
  mutNames.set(d.name, { declareSeg: seg.file, assigns: new Set() });
}

// 2) hub.js 已把写点重写为 __set_xxx(...) 调用。这里的 refs 是重写后源码的分析结果，
//    所以"哪些模块调用了本符号的 setter"可以从 refs 直接读出。
//    同时也兜住极少数未被 hub.js 覆盖的写法（如解构赋值改写），用 AST 再扫一遍。
{
  const acorn = require('acorn');
  const ast = acorn.parse(code, { ecmaVersion: 2022, locations: true });
  const segOfPos = (pos) => {
    let lo = 0, hi = analyze.units.length - 1, hit = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const u = analyze.units[mid];
      if (pos < u.start) hi = mid - 1;
      else if (pos >= u.end) lo = mid + 1;
      else { hit = u; break; }
    }
    if (!hit) return null;
    const s = unitSeg.get(hit.id);
    return s ? s.file : null;
  };
  const scan = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'AssignmentExpression' && n.left && n.left.type === 'Identifier' && mutNames.has(n.left.name)) {
      const f = segOfPos(n.start);
      if (f) mutNames.get(n.left.name).assigns.add(f);
    }
    if (n.type === 'UpdateExpression' && n.argument && n.argument.type === 'Identifier' && mutNames.has(n.argument.name)) {
      const f = segOfPos(n.start);
      if (f) mutNames.get(n.argument.name).assigns.add(f);
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(scan);
      else if (v && typeof v.type === 'string') scan(v);
    }
  };
  scan(ast);
}

// hub.js 的 setter 命名规则（必须与 hub.js 保持一致）
const setterOf = (n) => '__set' + (n.startsWith('_') ? '' : '_') + n;

/* 3) 谁调用了某个 setter。
 * ⚠️ setter 在原源码里只是【调用点】，不是【声明】—— 分析器不会为它建 decl 记录，
 *    所以必须自己扫源码找 `__set_xxx(` 的出现位置，再定位其所属模块。
 *    （首版误用 decls 匹配 ^__set，导致恒为 0 条。）
 */
const setterCallers = new Map();   // symbolName -> Set<segFile>
{
  const acorn = require('acorn');
  const ast = acorn.parse(code, { ecmaVersion: 2022, locations: true });
  const mutSetNames = new Set(mutNames.keys());
  const segOfPos = (pos) => {
    let lo = 0, hi = analyze.units.length - 1, hit = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const u = analyze.units[mid];
      if (pos < u.start) hi = mid - 1;
      else if (pos >= u.end) lo = mid + 1;
      else { hit = u; break; }
    }
    if (!hit) return null;
    const s = unitSeg.get(hit.id);
    return s ? s.file : null;
  };
  // 反向表：setter 名 -> 原始符号名
  const origOf = new Map();
  for (const nm of mutSetNames) origOf.set(setterOf(nm), nm);

  const scan = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression' && n.callee && n.callee.type === 'Identifier' && origOf.has(n.callee.name)) {
      const orig = origOf.get(n.callee.name);
      const f = segOfPos(n.start);
      if (f) {
        if (!setterCallers.has(orig)) setterCallers.set(orig, new Set());
        setterCallers.get(orig).add(f);
      }
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(scan);
      else if (v && typeof v.type === 'string') scan(v);
    }
  };
  scan(ast);
}

// 4) 判定：凡"setter 调用发生在声明模块之外"的符号，才需要搬进枢纽。
//    （理论上 hub.js 只改写了跨模块写点，这里做一次独立复核。）
const mutNeed = new Map();
for (const [name, info] of mutNames) {
  const callers = setterCallers.get(name) || new Set();
  const cross = [...callers].filter(f => f !== info.declareSeg);
  if (cross.length) mutNeed.set(name, { declareSeg: info.declareSeg, callers });
}
console.log(`\n=== 可变状态枢纽 ===`);
console.log(`顶层 let/var: ${mutNames.size} 个，其中 ${mutNeed.size} 个跨模块写入`);
console.log('  setter 生成于各自声明模块（不建独立枢纽文件）');
if (mutNeed.size) console.log('  ' + [...mutNeed.keys()].sort().join(', '));


/* 全局桥接名单 —— 需在生成 export 前算好，故提前定义 */
const GLOBAL_BRIDGE = [...new Set(
  analyze.decls
    .map(d => d.name)
    /* 跳过明显是内部实现细节的短名/临时名，避免污染 window 造成难以排查的冲突。
     * 保留规则：长度 ≥ 2 且不是纯下划线开头的单字母，或原本就被外部使用
     * （外部使用名单由 tests/平台脚本已知需求 + 常见命名约定给出）。 */
    .filter(n => n.length >= 2)
)].sort();


const files = new Map();
const hubSet = new Set(mutNeed.keys());   // 需要搬进枢纽的符号名

/* 枢纽模块的声明体：从原源码里把这些符号的"声明语句片段"抽出来，逐字保留。
 * 注意：一条 `let a = 1, b = 2;` 可能只有 a 需要进枢纽、b 不需要。
 * 这类情况直接整条搬进枢纽（b 也跟着进去，值不变、语义不变），
 * 避免拆语句带来的风险。下面的 unit 归属逻辑已保证"整条语句只出现在一个模块"。
 */
/* 关键决策：不建独立枢纽文件，而是把 setter 追加到【声明所在的原模块】。
 *
 * 为什么 ——
 *   首版把 27 个可变绑定集中放进独立的 src/05-mut.js，放在所有模块之前。
 *   结果运行期报 `AURA_COLORS is not defined`：
 *   枢纽里 `let _auraColor = AURA_COLORS[0].slice()` 依赖 00-pure.js 的常量，
 *   而枢纽排在 00-pure 之前 → 反向依赖。
 *   若把枢纽排到 00-pure 之后，00-pure 自己又读 state/_rate/_srvOffset → 成环。
 *   单文件枢纽在拓扑分层下无解。
 *
 *   而"setter 与声明同模块"天然无环：
 *     - setter 体内赋值，绑定在同一模块内 → ES Module 合法；
 *     - setter 属于声明所在模块，不引入任何新的跨模块依赖；
 *     - 声明语句留在原地，语句级等价性完全不变。
 *   唯一代价：消费方 import setter 时改指声明模块（不是新文件），
 *   这一步在生成 import 时按 setter→声明模块 反查即可，纯机械。
 */
/* ⚠️ setter 清单 ≠ hubSet。
 * hub.js 会把**所有**顶层 let/var 的裸赋值改写成 __set_xxx(...)，
 * 不只是跨模块那些。例如 _auraCv/_auraCtx 的写点就在它自己的声明模块 10-base.js 里
 * （技术上无需 setter 也能编译），但源码已被改写成 setter 调用，
 * 若不生成对应 setter 就会运行期 "__set_auraCv is not defined"。
 *
 * 所以判定标准是【源码里是否真的出现了 __set_xxx( 调用】，而不是【是否跨模块】。
 * hubSet 只用于"是否需要提示用户注意跨模块可变状态"，不参与 setter 生成。 */
const setterHome = new Map();     // setter 名 -> 声明所在模块
const setterOwner = new Map();    // setter 名 -> 原始绑定名
{
  const usedSetters = new Set();
  {
    const re = /__set(_?)([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(code))) usedSetters.add('__set' + m[1] + m[2]);
  }
  for (const [name, info] of mutNames) {
    const st = setterOf(name);
    if (!usedSetters.has(st)) continue;
    setterHome.set(st, info.declareSeg);
    setterOwner.set(st, name);
  }
  console.log(`  实际需生成 setter: ${setterHome.size} 个（源码中确有 __set_xxx 调用）`);
}

const hubUnits = new Set();       // 不再搬运任何 unit
const hubDeclNames = new Set();   // 不再有"枢纽专属声明"
const movedUnits = hubUnits;

for (const s of SEGMENTS) {
  const us = analyze.units.filter(u => unitSeg.get(u.id).file === s.file && !movedUnits.has(u.id))
    .sort((a, b) => a.start - b.start);
  const ownNames = new Set(us.flatMap(u => u.names));
  // 本模块仍然"看得见"所有同层段的符号（含被搬走的，它们通过 import 拿回）
  const visibleOwn = new Set(analyze.units.filter(u => unitSeg.get(u.id).file === s.file).flatMap(u => u.names));

  // 需要的外部符号，按拓扑序分组（匿名语句也要算，否则引用会缺失）
  const need = new Map();
  const addNeed = (refs) => {
    for (const r of refs) {
      if (visibleOwn.has(r) || !declByName.has(r)) continue;
      // 枢纽符号一律从 05-mut.js 取，不走原模块 —— 否则会生成重复 import（SyntaxError）
      if (hubDeclNames.has(r)) continue;
      const tgt = unitSeg.get(declByName.get(r).unit).file;
      if (tgt === s.file) continue;
      if (!need.has(tgt)) need.set(tgt, new Set());
      need.get(tgt).add(r);
    }
  };
  for (const u of us) {
    if (u.names.length) {
      for (const n of u.names) addNeed(declByName.get(n).refs);
    } else {
      // 匿名语句：扫源码取被引用的名字
      const seg = code.slice(u.start, u.end);
      const used = [];
      for (const m of seg.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
        if (declByName.has(m[1]) && !visibleOwn.has(m[1])) used.push(m[1]);
      }
      addNeed(used);
    }
  }

  /* setter 由"声明所在模块"导出，故消费方要 import setter 时，
   * 目标模块 = setterHome.get(setter名)。把这些 setter 并入对应模块的 need 集合，
   * 与普通符号走同一套 import 生成逻辑即可（自动去重、自动算相对路径）。 */
  const myCode = us.map(u => code.slice(u.start, u.end)).join('\n');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [st, home] of setterHome) {
    if (home === s.file) continue;                     // 本模块自己声明的 setter，无需 import
    if (!new RegExp(`\\b${esc(st)}\\b`).test(myCode)) continue;
    if (!need.has(home)) need.set(home, new Set());
    need.get(home).add(st);
  }

  const imports = [];
  for (const f of order) {
    if (!need.has(f)) continue;
    const rel = path.relative(path.dirname(s.file), f).replace(/\\/g, '/');
    imports.push(`import { ${[...need.get(f)].sort().join(', ')} } from '${rel.startsWith('.') ? rel : './' + rel}';`);
  }

  const declCount = analyze.decls.filter(d => unitSeg.get(d.unit).file === s.file).length;
  const ls = analyze.decls.filter(d => unitSeg.get(d.unit).file === s.file).map(d => layerOf.get(d.name));
  const header = [
    '/**',
    ` * ${s.desc}`,
    ' *',
    ` * 拓扑层 L${Math.min(...ls)}~L${Math.max(...ls)}，${declCount} 个顶层声明。`,
    ' * 由 tools/split2.js 从 game.js 自动切分（纯搬迁，语句源码逐字保留，逻辑零改动）。',
    ' * 重建: node tools/split2.js <repo> <out>',
    ' */',
    '',
  ].join('\n');

  const body = imports.length ? imports.join('\n') + '\n\n' : '\n';

  /* 每个模块末尾追加精确的 export 清单（只导出被其他段引用到的符号）。
   * 不能依赖"顶层声明自动成为 export"—— ES Module 没有这种语义，必须显式导出。
   * 导出名与声明名一致，故用 `export { a, b, c };` 形式，避免逐个改源码。
   *
   * 注意：判定依据是"本模块最终源码里是否真的声明了该名字" ——
   * 被搬进枢纽的 unit 已不在本模块，不能导出（否则 export 未声明变量直接 SyntaxError）。
   */
  const declaredHere = new Set();
  for (const u of us) u.names.forEach(n => declaredHere.add(n));
  const exportNames = new Set();
  // 反向：遍历所有其他段的 unit，看它们引用了本段哪些名字
  for (const u of analyze.units) {
    const segOfU = unitSeg.get(u.id);
    if (segOfU.file === s.file) continue;
    const used = u.names.length
      ? u.names.flatMap(n => declByName.get(n).refs)
      : (() => {
        const seg = code.slice(u.start, u.end);
        const out = [];
        for (const m of seg.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) if (declByName.has(m[1])) out.push(m[1]);
        return out;
      })();
    for (const r of used) {
      if (!declByName.has(r)) continue;
      if (unitSeg.get(declByName.get(r).unit).file !== s.file) continue;
      if (declaredHere.has(r)) exportNames.add(r);
    }
  }

  /* 另需导出"全局桥接"要挂到 window 的名字 ——
   * 它们在模块内部可能无人 import（如 doBreak/craftPill 只被本模块调用），
   * 但外部脚本/测试/调试命令按经典脚本习惯直接访问 `doBreak(...)`。
   * 不导出的话垫片取到 undefined，外部能力静默失效（T7 回归就是这么暴露的）。 */
  for (const nm of GLOBAL_BRIDGE) {
    if (declaredHere.has(nm)) exportNames.add(nm);
  }

  const exportLine = exportNames.size
    ? '\n' + (exportNames.size > 8
      ? 'export {\n  ' + [...exportNames].sort().join(',\n  ') + ',\n};\n'
      : `export { ${[...exportNames].sort().join(', ')} };\n`)
    : '';

  files.set(s.file, header + body + us.map(u => code.slice(u.start, u.end)).join('\n\n') + '\n' + exportLine);
}

/* ---------- 把 setter 追加到各模块（无独立枢纽文件）----------
 * setter 必须定义在"绑定声明所在的模块"里，原因见前面 setterHome 的注释。
 * 生成规则：本模块声明了哪些横跨模块写入的可变绑定，就为哪些生成 setter。
 */
{
  // 源码里真正被调用过的 setter（避免生成死代码）
  const usedSetters = new Set();
  {
    const re = /__set(_?)([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(code))) usedSetters.add('__set' + m[1] + m[2]);
  }

  for (const s of SEGMENTS) {
    const mine = [...setterHome.entries()]
      .filter(([, home]) => home === s.file)
      .map(([st]) => st)
      .filter(st => usedSetters.has(st))
      .sort();
    if (!mine.length) continue;

    const cur = files.get(s.file);
    const setterBlock = [
      '',
      '/* ── 可变状态写入口（由 tools/split2.js 自动生成）────────────────',
      ' * 为什么需要 setter ——',
      ' *   ES Module 的 import 是【只读绑定】：别的模块 `import { _traceT }` 后',
      ' *   再写 `_traceT = Date.now()` 会直接抛 "Assignment to constant variable"。',
      ' *   本模块是这些绑定的声明方，在此提供 setter，让赋值发生在模块内部：',
      ' *     消费方 import { __set__traceT } → __set__traceT(v)',
      ' *   复合赋值（++ / +=）已在 hub.js 重写阶段降级为"读旧值 + 写新值"，',
      ' *   故 setter 只需单一赋值语义。返回值即写入值，可作为表达式使用。',
      ' * ---',
      ' * ⚠️ 本段由工具生成，手改会在下次重建时丢失。',
      ' */',
      /* 绑定名从 setterHome 反查，不做字符串裁剪 ——
       * 首版用 st.replace(/^__set_?/, '') 生成绑定名，
       * `__set__traceT` 会被吃成 `traceT`（少一个下划线）→ "traceT is not defined"。
       * 字符串裁剪在 `_` 前缀上极易出错，直接查表最稳。 */
      ...mine.map(st => `export function ${st}(v) { ${setterOwner.get(st)} = v; return v; }`),
      '',
    ].join('\n');
    files.set(s.file, cur + setterBlock);
  }
}

/* ---------- 兼容垫片 ----------
 * index.html 用普通 <script src="game.js"> 动态注入（非 type="module"），
 * 经典脚本里不能写静态 import。因此垫片必须：
 *   1. 自己判断"当前是否已处于 module 上下文"
 *   2. 用动态 import() 按拓扑序串行加载各段（经典脚本合法，且保证顺序）
 *   3. 在主游戏代码开始执行前，先把 window.APP_VER 等已注入的全局暴露给模块
 * 这样 index.html / OTA 清单 / 平台注入脚本一律无需改动。
 */
/* ---------- 全局桥接（恢复"经典脚本"的可观察语义）----------
 *
 * 拆分带来一个容易被忽略但真实存在的行为差异：
 *   index.html 用 <script src="game.js"> 注入，是【经典脚本】。
 *   经典脚本里顶层 `const SND = ...` / `function boot(){}` 会自动成为
 *   window 上的属性（全局词法环境的对象记录），外部代码可直接 `SND.xxx` 访问。
 *   而拆分后每个文件是 ES Module，模块顶层声明【只在本模块内可见】，
 *   于是 `window.SND` 变成 undefined —— 平台注入脚本、外部测试、调试命令
 *   全部失效（回归脚本第一句 `ReferenceError: SND is not defined` 就是这么暴露的）。
 *
 * 修法：垫片加载完全部模块后，把"原经典脚本会泄漏到全局的名字"显式挂回 window。
 *   - 只挂 window 上尚不存在的名字（不覆盖平台已注入的同名全局）；
 *   - 通过 getter 动态取值，保证取到的是模块内最新绑定（含 setter 改过的值）；
 *   - 失败不影响主流程（名称可能在打包裁剪后不存在）。
 *
 * 这一步等价于"把经典脚本的隐式全局行为补回来"，而非引入新功能。
 */
// 额外确保这几个被外部脚本/测试/平台明确依赖的名字一定在桥上
for (const must of ['SND', 'SkillAPI', 'EquipAPI', 'AlchemyAPI', 'CloudAPI', 'TravelAPI',
  'BattleAPI', 'state', 'GAME_VER', 'CACHE_VER', 'SAVE_KEY', '$', 'boot']) {
  if (!GLOBAL_BRIDGE.includes(must) && declByName.has(must)) GLOBAL_BRIDGE.push(must);
}

/* 每个桥接名字要指明"从哪个模块的命名空间对象取"。
 * ⚠️ 不能写成裸标识符 `return SND;` ——
 *   垫片本身是经典脚本，裸名解析走全局对象 window，
 *   而 window.SND 正是本 getter 自己 → 无限递归（首版当场爆栈）。
 *   正确做法：动态 import() 返回模块命名空间对象，用 ns.SND 取值，
 *   命名空间属性是模块内绑定的实时视图，既避开递归又能反映 setter 写入的最新值。 */
const BRIDGE_NS = new Map();   // 名字 -> 模块路径
for (const nm of GLOBAL_BRIDGE) {
  const d = declByName.get(nm);
  if (!d) continue;
  const seg = unitSeg.get(d.unit);
  if (seg) BRIDGE_NS.set(nm, seg.file);
}
const nsVarOf = (file) => 'NS_' + file.replace(/[^A-Za-z0-9]/g, '_');

/* ---------- 入口文件 src/main.js ----------
 *
 * ⚠️ v3.1 关键修正：为什么不再用「经典脚本 + 动态 import(带 query)」
 *
 * v3.0 的垫片是经典脚本，用 `await import('./src/10-base.js?v=3.0')` 串行加载。
 * 但模块之间是【静态 import】（`import { SND } from './10-base.js'`，不带 query）。
 * 浏览器把 `10-base.js?v=3.0` 和 `10-base.js` 视为【两个不同的模块标识】，
 * 于是同一份代码被实例化两遍：state / SND / 各级缓存各有一份。
 * 症状：战斗模块 import 到"无 query"那份 SND，外部 setSfx(false) 落在"有 query"
 * 那份上 → 音效开关失效（T3 回归 0 → 13 次播放）。这只是最容易被观测到的一处，
 * 双实例还会让 rAF / 事件监听 / 定时器重复注册。
 *
 * 修法：不再由垫片决定模块 URL。整个 src/ 用【唯一入口 + 全静态 import】：
 *   index.html:  <script type="module" src="./src/main.js?v=APP_VER"></script>
 *   模块之间:     import { x } from './10-base.js'   ← 全部不带 query
 * 于是模块图里每个文件只有一个 URL，实例唯一。
 *
 * 缓存失效不再靠 query：
 *   - App/平台端：本来就由 ota/manifest.json 的 rev 驱动（与 query 无关）
 *   - 浏览器端：由 HTTP Cache-Control 负责（部署侧配置）
 * query 只保留在 index.html 的入口 URL 上，用于让入口自身失效。
 */
const shim = [
  '/**',
  ' * src/main.js —— 游戏入口（ES Module 唯一入口）',
  ' *',
  ` * 原单文件 game.js 已按拓扑层拆入同目录 *-*.js（共 ${SEGMENTS.length} 段，依赖单向、无环）。`,
  ' * 本文件只做两件事：',
  ' *   1. 静态 import 全部模块段（编译期即确定求值顺序，被依赖者先求值）',
  ' *   2. 把"原经典脚本会泄漏到 window 的名字"桥接回 window',
  ' *',
  ' * 为什么要桥接：index.html 原本用经典脚本加载 game.js，经典脚本的顶层',
  ' *   `const SND = ...` / `function boot(){}` 会自动成为 window 属性；ES Module 不会。',
  ' *   不补这一步，平台注入脚本 / 外部测试 / 调试命令里的 `SND.xxx` 全部失效。',
  ' *',
  ' * 为什么全局只有这一个入口：模块图必须每个文件唯一 URL，否则同一模块被实例化两遍，',
  ' *   共享状态（state / SND / 缓存）分裂成两份（v3.0 的 ?v= 混用就是这么出的问题）。',
  ' */',
  ...SEGMENTS.filter(s => files.has(s.file)).map(s => {
    const ns = nsVarOf(s.file);
    return `import * as ${ns} from './${s.file.replace(/^src\//, '')}';`;
  }),
  '',
  '/* 把模块内声明桥接到 window（只补缺失的，不覆盖已有全局）*/',
  'const BRIDGE = {',
  ...GLOBAL_BRIDGE.map(n => {
    const ns = BRIDGE_NS.get(n);
    return ns
      ? `  ${JSON.stringify(n)}: function () { return ${nsVarOf(ns)}[${JSON.stringify(n)}]; },`
      : `  ${JSON.stringify(n)}: function () { return void 0; },`;
  }),
  '};',
  'for (const k in BRIDGE) {',
  '  if (Object.prototype.hasOwnProperty.call(window, k)) continue;',
  '  try {',
  '    Object.defineProperty(window, k, { get: BRIDGE[k], configurable: true });',
  '  } catch (e) { /* 某些名字可能已被平台以不可配置方式定义，跳过即可 */ }',
  '}',
  '',
  '/* ── 战斗模块（由 index.html 内联脚本抽取，见 tools/extract_battle.js）─────────',
  ' * 用动态 import 而不是顶部静态 import，只为「顺序」：战斗模块求值时立刻 init()，',
  ' * 会读 window.BattleAPI 的挂接方（20-core/40-app 的 bindBattleHooks 虽在轮询，',
  ' * 但先桥接后加载能让首帧就拿到正确属性，少 300ms 的兜底等待）。',
  ' * ⚠️ 这里【不能】带 ?v= query —— 一带就与模块间静态 import 解析出的 URL 不同，',
  ' *    同一文件被实例化两遍，SND/state 分裂（v3.0 的坑）。缓存由 HTTP 层负责。',
  ' */',
  "import('./50-battle.js');",
  '',
].join('\n');

/* ---------- 产物统计 ---------- */
console.log('\n=== 产物 ===');
let tot = 0;
// 按拓扑序输出（枢纽在最前）
const orderedFiles = SEGMENTS.map(s => s.file).filter(f => files.has(f));
for (const f of orderedFiles) {
  const c = files.get(f);
  const n = c.split('\n').length;
  tot += n;
  console.log(`  ${f.padEnd(22)} ${String(n).padStart(5)} 行`);
}
console.log(`  ${'src/main.js (入口)'.padEnd(21)} ${String(shim.split('\n').length).padStart(5)} 行`);
console.log(`  ${'合计'.padEnd(21)} ${String(tot + shim.split('\n').length).padStart(5)} 行   (原 ${analyze.totalLines} 行)`);

if (!DRY) {
  fs.rmSync(path.join(OUT, 'src'), { recursive: true, force: true });
  for (const [f, c] of files) {
    const full = path.join(OUT, f);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, c, 'utf8');
  }
  fs.writeFileSync(path.join(OUT, 'src/main.js'), shim, 'utf8');
  console.log(`\n已写入 ${OUT}/`);
}
