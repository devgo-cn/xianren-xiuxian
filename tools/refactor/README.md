# refactor —— 单文件拆分工具链

把 5451 行的 `game.js` 和 `index.html` 里 1535 行的内联战斗脚本，按**拓扑层**
自动拆成一组 ES Module。一次性使用，但保留在仓库里，因为：

- 拆分结论可复现、可审计（每个门禁都是可重跑的脚本，不是人工核对）
- 以后再拆（例如把 `40-app.js` 再细分）时，工具直接复用

## 结果

| 产物 | 行数 | 内容 |
|---|---|---|
| `src/00-pure.js` | 2918 | 纯数据/常量（L0） |
| `src/10-base.js` | 1154 | 基础工具与协议（L1~2） |
| `src/20-core.js` | 575 | 核心服务（L3~4） |
| `src/30-systems.js` | 524 | 玩法系统（L5~7） |
| `src/40-app.js` | 754 | 应用装配与顶层副作用（L8~14） |
| `src/50-battle.js` | 1553 | 战斗系统（自 `index.html` 内联脚本抽取） |
| `src/main.js` | 394 | 唯一入口：静态 import + 全局桥接 |

依赖严格单向：`00-pure ← 10-base ← 20-core ← 30-systems ← 40-app`，另有
`50-battle → 10-base`（只依赖 `SND`）。无环。

## 为什么是"按拓扑层"而不是按功能

先测出来 `game.js` 的顶层声明构成一张有向图，`layer(n) = 1 + max(layer(deps))`，
实测 11 层、**层内零依赖**、最大强连通分量只有 1 个符号 —— 也就是说这张图
是一张**完美分层的 DAG**。

于是"把同一层的语句放一个文件"这个切法**在数学上保证不会产生循环 import**。
按功能切则需要反复试错、必要时引入中间层打破环，且没有正确性保证。

## 可变共享状态怎么处理

`state`、`_auraT` 等 29 个顶层 `let` 被跨模块读写。ES Module 的 import 绑定是
**只读**的，`import { state }` 之后写 `state.x = 1` 合法（改属性），但
`state = {...}` 会抛 `Assignment to constant variable`。

工具的做法（`hub.js`）：**把 setter 定义在该变量的声明模块里**，
`export function __set_state(v) { state = v; return v; }`，然后
把所有跨模块的写操作改写成 `__set_state(...)` 调用。

为什么 setter 必须和声明同模块：如果单独建一个"枢纽文件"集中放 setter，
它就要反向依赖 `00-pure.js`（因为 setter 体里要读原值），
而 `00-pure.js` 又依赖它 —— 成环。放进声明模块本身，边就只有一个方向。

## 门禁（每道都是脚本，可重跑）

```bash
bash build.sh <原始game.js> <仓库根> [原始index.html]
```

| 门禁 | 脚本 | 通过标准 |
|---|---|---|
| 1 | `verify_equiv.js` | 语句级双向比对：0 缺失 / 0 多余 / 0 重复次数不符（377→377） |
| 2 | `verify_links.js` | import/export 图完全闭合，无未导出、无重复 import |
| 3 | `verify_battle.js` | 战斗脚本 AST 规范化逐条比对：111→111，0 差异 |
| 4 | `verify_phase2.py` | 真实浏览器 E2E 13 项全过 + 0 console error |

## 一个踩过的坑：模块 URL 必须唯一

v3.0 的入口是**经典脚本**，用 `await import('./src/10-base.js?v=3.0')` 串行加载；
而模块之间是**静态 import**（`import { SND } from './10-base.js'`，不带 query）。
浏览器把这两个 URL 当成**两个不同的模块**，于是同一份代码被实例化两遍，
`state` / `SND` 各有一份。

症状：战斗模块 import 到"无 query"那份 `SND`，外部 `setSfx(false)` 落在
"有 query"那份上 → **音效开关失效**（E2E 里表现为关音效后仍有 13 次播放）。
这只是最容易观测到的一处；双实例还会让 rAF、事件监听、定时器重复注册。

v3.1 的修法：`index.html` 直接 `<script type="module" src="./src/main.js?v=APP_VER">`，
**模块之间一律不带 query**（URL 唯一 → 实例唯一）。`?v=` 只留在入口 URL 上，
用于入口自身的 HTTP 缓存失效。

> 顺带一提：`import map` **做不到**这件事。它的映射值必须是合法 URL 前缀，
> 塞 query 进去（`"./src/": "./src/?v=3.0&"`）会被浏览器判定为
> `blocked by a null value`。别在这上面浪费时间。
