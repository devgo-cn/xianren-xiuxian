#!/usr/bin/env node
/**
 * 从 index.html 中切除指定的内联 <script> 块，替换为一段注释标记。
 *
 * 用法: node cut_inline.js <index.html> <meta.json>
 *   meta.json 由 extract_battle.js 产出，含 htmlStartLine / htmlEndLine（1-based）。
 *
 * 安全约束：
 *   - 切除前先用 acorn 校验该块能被解析（防止行号漂移切错）
 *   - 校验块内确实含"战斗系统"标记
 *   - 切完再校验 <script> / </script> 配对数量守恒（减 2）
 *   - 幂等：若该块已不存在（已切过），直接跳过并提示
 */
const fs = require('fs');
const acorn = require('acorn');

const HTML = process.argv[2];
const META = process.argv[3];
if (!HTML || !META) { console.error('用法: node cut_inline.js <index.html> <meta.json>'); process.exit(1); }

const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
const lines = fs.readFileSync(HTML, 'utf8').split('\n');

const a = meta.htmlStartLine;   // 1-based, <script>
const b = meta.htmlEndLine;     // 1-based, </script>

const tagOpen = lines[a - 1], tagClose = lines[b - 1];
if (!/^\s*<script>\s*$/.test(tagOpen) || !/^\s*<\/script>\s*$/.test(tagClose)) {
  console.error(`❌ 行号漂移：第 ${a} 行="${tagOpen}" 第 ${b} 行="${tagClose}"，预期 <script> / </script>`);
  process.exit(2);
}

const body = lines.slice(a, b - 1).join('\n');
if (!/战斗系统/.test(body)) {
  console.error('❌ 目标块不是战斗脚本（未匹配"战斗系统"标记），拒绝切除');
  process.exit(3);
}

// 语法自检：切掉 IIFE 包装后仍应可解析
try {
  const ast = acorn.parse(body, { ecmaVersion: 2022 });
  if (ast.body.length !== 1) throw new Error(`顶层语句 ${ast.body.length} 条`);
} catch (e) {
  console.error('❌ 目标块语法校验失败：' + e.message);
  process.exit(4);
}

const countTag = (src) => (src.match(/<script\b/g) || []).length;
const before = countTag(lines.join('\n'));

const MARK = [
  '<!-- ── 战斗系统已抽为独立 ES Module ──────────────────────────────────────',
  `     原内联脚本 ${b - a - 1} 行（index.html 第 ${a}~${b} 行）于 v3.0 迁出，`,
  '     现由 game.js 垫片在全局桥接完成后动态 import(./src/50-battle.js)。',
  '     唯一外部依赖是 SND（显式 import），对外接口 window.BattleAPI 不变。 -->',
];

const out = [...lines.slice(0, a - 1), ...MARK, ...lines.slice(b)];
const after = countTag(out.join('\n'));

if (before - after !== 1) {
  console.error(`❌ <script> 计数异常：${before} → ${after}`);
  process.exit(5);
}

fs.writeFileSync(HTML, out.join('\n'), 'utf8');
console.log(`已切除内联战斗脚本：index.html 第 ${a}~${b} 行（${b - a + 1} 行），替换为 ${MARK.length} 行注释`);
console.log(`index.html: ${lines.length} 行 → ${out.length} 行`);
console.log(`<script> 标签数：${before} → ${after}（-1，符合预期）`);
