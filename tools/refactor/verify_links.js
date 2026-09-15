#!/usr/bin/env node
/**
 * 静态导入/导出链路校验（第 3 道闸门）
 *
 * 为什么需要它：等价性验证只证明"语句没丢"，无法发现
 *   - import 了一个对方没 export 的名字（运行期 SyntaxError，整包挂掉）
 *   - 同一模块重复 import 同名（SyntaxError）
 *   - export 了一个本模块没声明的名字（SyntaxError）
 * 这三类问题在浏览器里表现为"白屏 + 控制台一行报错"，定位成本高。
 * 静态校验能在构建期一次性拦下。
 */
const acorn = require('acorn');
const fs = require('fs'), path = require('path');
const DIR = process.argv[2] || '/tmp/outtest';

/* 只看切分产物目录 <DIR>/src/ —— bg.js / fx2d.js 等独立文件不参与本校验 */
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(path.relative(DIR, p));
  }
})(path.join(DIR, 'src'));

const decls = new Map(), exps = new Map(), imports = [];
const addDecl = (dd, set) => {
  if (!dd) return;
  if (dd.type === 'FunctionDeclaration' && dd.id) set.add(dd.id.name);
  if (dd.type === 'ClassDeclaration' && dd.id) set.add(dd.id.name);
  if (dd.type === 'VariableDeclaration') dd.declarations.forEach(x => { if (x.id.type === 'Identifier') set.add(x.id.name); });
};
for (const f of files) {
  const ast = acorn.parse(fs.readFileSync(path.join(DIR, f), 'utf8'), { ecmaVersion: 2022, sourceType: 'module', locations: true });
  const d = new Set(), e = new Set();
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') {
      n.specifiers.forEach(s => {
        // namespace import (import * as ns) 不引用具体导出名，只校验模块存在
        if (s.type === 'ImportNamespaceSpecifier') { imports.push({ file: f, name: null, line: n.loc.start.line, src: n.source.value }); return; }
        imports.push({ file: f, name: s.local.name, line: n.loc.start.line, src: n.source.value });
      });
      continue;
    }
    if (n.type === 'ExportNamedDeclaration') {
      addDecl(n.declaration, d);
      addDecl(n.declaration, e);
      (n.specifiers || []).forEach(s => e.add(s.local.name));
      continue;
    }
    addDecl(n, d);
  }
  decls.set(f, d); exps.set(f, e);
}

let bad = 0, dup = 0;
for (const [f, set] of exps) for (const nm of set) if (!decls.get(f).has(nm)) { console.log(`❌ 导出未声明: ${f} -> ${nm}`); bad++; }
for (const im of imports) {
  const tgt = path.normalize(path.join(path.dirname(im.file), im.src.replace(/\?.*$/, '')));
  if (!exps.has(tgt)) { console.log(`❌ 找不到模块: ${im.file} -> ${im.src}`); bad++; continue; }
  if (im.name === null) continue;   // namespace import：只要求模块存在
  if (!exps.get(tgt).has(im.name)) { console.log(`❌ 未导出: ${im.file}:${im.line} 需要 ${im.name} 来自 ${tgt}`); bad++; }
}
const seen = new Set();
for (const im of imports) {
  // namespace import 没有具体名，去重键用 local 名由 specifier 位置决定，这里跳过
  if (im.name === null) continue;
  const k = im.file + '|' + im.name;
  if (seen.has(k)) { console.log(`❌ 重复 import: ${k}`); dup++; }
  seen.add(k);
}

console.log(`模块 ${files.length} 个，import ${imports.length} 条`);
if (bad === 0 && dup === 0) { console.log('✅ 导入/导出链路完全闭合'); process.exit(0); }
console.log(`❌ ${bad} 处缺失 / ${dup} 处重复`);
process.exit(1);
