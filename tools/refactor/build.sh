#!/bin/bash
# 一键重建管线：原始 game.js + index.html → 模块化 src/*.js + 单入口 src/main.js
#
# 用法: ./build.sh <原始game.js> <输出目录> [原始index.html]
#
# 产物：
#   <OUT>/src/00-pure.js     纯数据/常量
#   <OUT>/src/10-base.js     基础工具
#   <OUT>/src/20-core.js     核心服务
#   <OUT>/src/30-systems.js  游戏系统
#   <OUT>/src/40-app.js      应用装配
#   <OUT>/src/50-battle.js   ← 由 index.html 内联脚本抽取（不是从 game.js 来）
#   <OUT>/src/main.js        唯一入口：静态 import 全部模块 + 全局桥接
set -e
SRC="${1:-/tmp/game.js.orig}"
OUT="${2:-/tmp/outtest}"
HTML="${3:-/root/.codebuddy/artifact/xianren-repo/xianren-xiuxian/index.html}"
T="$(cd "$(dirname "$0")" && pwd)"

echo "── 1/7 可变状态枢纽重写 ──────────────────────"
# 第 4 个参数是仓库根目录：hub.js 用它识别 bg.js / fx2d.js 等同级运行时资源，
# 以便把拆分后失效的 "./x.js" 动态引用改写成 "../x.js"
node "$T/hub.js" "$SRC" /tmp/hub.json "$OUT" | tail -6

echo
echo "── 2/7 AST 分析（基于重写后源码）────────────"
mkdir -p /tmp/origrepo && cp /tmp/game.hub.js /tmp/origrepo/game.js
node "$T/analyze.js" /tmp/origrepo/game.js 2>&1 | grep -E '^解析|^输出'

echo
echo "── 3/7 拓扑分层 ──────────────────────────────"
node "$T/layers.js" /tmp/origrepo/game.js 2>&1 | grep -E '^拓扑层数|^已写'

echo
echo "── 4/7 按层切分 ──────────────────────────────"
node "$T/split2.js" /tmp/origrepo "$OUT"

echo
echo "── 5/7 抽取内联战斗脚本 → src/50-battle.js ───"
node "$T/extract_battle.js" "$HTML" "$OUT"

echo
echo "── 6/7 等价性验证（语句级）───────────────────"
node "$T/verify_equiv.js" "$SRC" "$OUT" "$OUT" 2>&1 | tail -14

echo
echo "── 7/7 导入/导出链路校验 + 战斗抽取等价性 ────"
node "$T/verify_links.js" "$OUT"
if [ -f /tmp/battle_extract_meta.json ]; then
  node "$T/verify_battle.js" "$HTML" "$OUT" /tmp/battle_extract_meta.json
fi
