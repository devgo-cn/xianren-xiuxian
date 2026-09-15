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
| `src/60-stage.js` | 176 | **v3.2 统一舞台层**：把 4 张 canvas 合成 1 张 |

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


---

## v3.2 统一舞台层（`src/60-stage.js`）

### 问题

v3.1 之前有 **4 张各自独立的 canvas**，各自跑一个 `requestAnimationFrame` 循环：

| canvas | z-index | 尺寸 | 刷新率 | 内容 |
|---|---|---|---|---|
| `#bg` | 0 | 全屏 0.36 MPx | ~24fps | 雾霭 / 星点 / 银河 / 纸月 / 流云 |
| `#battleCanvas` | 1 | 条带 0.13 MPx | ~24fps | 战斗（裁剪到 battle-stage 横带） |
| `#aura` | 3 | 全屏 0.36 MPx | ~18fps | 灵气粒子，且带 `mix-blend-mode:screen` |
| `#burst` | 30 | 全屏 0.36 MPx | ~22fps | 点击 / 渡劫爆发粒子 |
| **合计** | | **1.21 MPx/帧** | **4 份调度** | **4 次全屏合成** |

三个开销点：① 4 次全屏位图混合；② `mix-blend-mode:screen` 会强制 `#aura` 走
**独立合成通道**，无法并入轻量合成路径；③ 4 个 rAF 相位不齐（24/18/24/22fps），
限帧逻辑各自实现，白白多跑。

### 做法

合并为 `1 张 #stage`、`1 个 ticker`、`1 次合成`，混合在绘制期用
`globalCompositeOperation = "lighter"` 完成。像素量 **1.21 → 0.36 MPx（降 70%）**。

绘制顺序由**代码顺序**保证，不再依赖 z-index：

```
bg  →  battle（clip 到横带）  →  aura（加法）  →  burst（加法）
```

### 铁律：ticker 只管「何时调用」，不管「传什么 dt」

每一层自己算自己的 dt，**ticker 一律传原始 dt**。

这不是风格问题，是**倍速不泄漏**的正确性约束：

> 战斗层的「疾风步 / 缩地成寸」会让战斗实体按 `dt × speedMult` 推进。
> 该乘法**必须留在 `50-battle.js` 的 `update()` 内部第一行**
> （`const sdt = dt * G.speedMult;`）。一旦提到 ticker 里统一乘，
> 背景 / 灵气 / 爆发粒子就会跟着一起加速 —— 那是错误的。

同理，战斗层内部这些**刻意不吃倍速**的量也必须保持不变（它们都用原始 `dt`）：

- `_pushT` —— 每 5s 拉取一次玩家属性
- `G.skillCall.t` —— 技能名播报节奏（注释明写"不吃身法倍速"）

### 验收

`verify_speed_scope.py` 用 `60-stage.js` 暴露的 `setDiag()` 钩子逐层记录
每层实际收到的 `dt`，强制把 `speedMult` 设成 1 / 2 对照：

| 指标 | ×1 | ×2 |
|---|---|---|
| 各层收到的 dt（中位） | 0.03340 | **0.03340（一字不差）** |
| 战斗世界时钟 `G.t` | 1.995 世界秒/真实秒 | **3.912（≈1.96×）** |

即：加速确实生效在战斗内部，渲染层 dt 分毫未动。

### 各层接口

```js
// 60-stage 契约
{ name, draw(ctx, W, H, dt, now), resize?(W, H) }

// 加层 / 插层（战斗层是动态 import 的，就绪比 bg 晚）
stage.addLayer(L)
stage.insertLayerBefore("aura", L)
```

各层的独立运行模式（`initFx` / `initDeepSpace(canvas)` / `initAura()` 无参）
**全部保留**，供单独调试页使用；主流程走 `managed` / `createFxLayer()` 分支。

---

## v3.3 —— 用户实测反馈的三处修正

v3.2 推上 main 后用户真机实测：「瞬间流畅了很多」，但报了三件事。
三件事根因各不相同，都记在这里以免以后重蹈。

### ① 绿闪：混合模式用错了

用户反馈：「几处大区域内不停闪烁的绿光」。

**根因**：v3.2 首版在 `30-systems.js` 的 `tickAura` 里，把原来靠 CSS
`mix-blend-mode:screen` 做的画布级合成，改成在绘制期用 `globalCompositeOperation`
复现 —— 但错用了 `"lighter"`（加法）并配了 1.75× 的 alpha 补偿。

| 模式 | 公式 | 行为 |
|---|---|---|
| `lighter` 加法 | `a + b` | 叠得越多越"曝"，大面积会糊成一片 |
| `screen` 滤色 | `1-(1-a)(1-b)` | 永远比原色**更亮**、不会变浓 |

凡人境的灵气色是 `AURA_COLORS[0] = [103,201,171]`（青绿），而 aura 的 4 个光团
半径达 `0.4~0.6 × 屏短边` —— 加法混合下整片区域泛绿且随呼吸脉动。

**修正**：改回 `"screen"`（与 CSS 语义一致），删掉 `aScale` 补偿。

### ② 月亮消失：被战斗层的 `clearRect` 擦掉了

用户反馈：「右上角的月亮效果没有了……挂上一盏月亮吧」。

这个查了三层，前两层是障眼法：

1. ~~sprite 里月轮太小~~ —— `rr = c*0.30` 而 sprite 被拉到 216px，月轮只占可见直径
   30%，其余是弥散外晕，看起来像灰雾。**确实要改**（已改为实心轮体），但不是主因。
2. ~~混合模式不对~~ —— `screen` 把轮体和背景一起推白。**也要改**（已改回
   `source-over`，让 sprite 的实心轮体原样呈现），但也不是主因。
3. **真凶**：`50-battle.js` 的 `render()` 第一行
   ```js
   ctx.clearRect(0, 0, CW, CH);   // ← 舞台模式下 ctx 是【共享】舞台 ctx
   ```
   舞台模式里 `CW = W = 420`、`CH = band.height = 306`，于是每帧
   `clearRect(0,0,420,306)` **擦掉共享画布一大片**（含月亮所在的 y=209）。

   逐层采样取证（月亮中心 336,209）：
   ```
   ['bg',     0,   0,   0]     ← bg 开始前
   ['battle', 248, 245, 234]   ← bg 画完，月亮是亮的！
   ['aura',   0,   0,   0]     ← battle 画完，被擦成黑
   ```
   clearRect 探针：`{'args':[0,0,420,306], 'before':[248,245,233], 'canvas':'stage'}`

**修正**：`render(clear)` 增加一个参数区分两种模式 ——

| 模式 | 行为 |
|---|---|
| 独立模式 `render(true)` | `clearRect(0,0,CW,CH)`，透出底下 `#bg` |
| 舞台模式 `render(false)` | **不清屏**，改为在横带自己坐标系里铺一层不透明夜空底色（视觉等价、但裁剪区外一个像素都不动） |

**顺带修正月亮位置**：`MOON.fy` 从 `0.24` → `0.135`。
因为 v3.2 起战斗层是一条固定横带（`top=92, height=0.56*vh-176`），
`fy=0.24` 在 860 高屏上 ≈ y207，正好落进横带被底色压住。上移后月亮稳定待在
横带之上的纯净夜空里。

### ③ 旋臂🌀 → 只留丹田

用户反馈：「漩涡🌀现在看不到效果了，但我发现没有它更好看一点……
保留它的中心点，有一个发光的中心点，就是他的丹田，那个可以调出来。」

**为何看不到**：`createFxLayer`（fx2d.js 的旋臂星点带）**从未被 `mountStage()` 调用**
—— v3.2 合并时只挂了 bg/battle/aura/burst 四层，漏了 fx2d。

**处理**：按用户意见整条移除，只保留金丹。`fx2d.js` 里删掉了
`buildParticles` / `starBurst` / `softDot` 星点贴图 / `dust` 星尘 / 旋臂几何常数，
`REALM_VIS` 也从 12 组「粒子数+转速+调色板」简化为 12 组「丹田两色」。

### ④ 丹田不能画在 `#stage` 上（这一条最容易踩）

第一版把 dantian 挂成 `#stage` 的普通层，实测中心只有 `(94,109,126)` —— 那是袍子
本身的颜色，不是丹田的光。原因：

```
#stage          z-index: 0    ← 舞台
.stage / #cult  z-index: 5    ← 角色贴图，整个盖住 #stage
```

**丹田是"长在人物身上"的光，必须在角色之上。**
做法：`mountDantianOverlay()` 给 `#cult` 插一张同尺寸的 overlay canvas
（`#cultDantian`, `z-index:3`），每帧 `getBoundingClientRect()` 对齐角色框、
按 DPR 设 backing store。fx2d 通过 `setOverlayMode(true)` 切到 overlay 坐标系
（锚点 = `(W/2, H*0.40)`，`R = H`），绘制代码一行没改。

于是可见画布从 1 张变回 **2 张**（`stage` + `cultDantian`）—— 这是有意为之，
`verify_stage.py` / `verify_stage_extra.py` 的断言已相应更新。

**几何比例**（都相对角色框高度，`height = min(44vh, 350px)`）：

| 常量 | 值 | 860 高屏实测 |
|---|---|---|
| `CORE_K` | 0.030 | 丹体半径 ≈ 10.5px |
| `HALO_K` | 0.075 | 外晕半径 ≈ 26px |

> ⚠️ 外晕不要贪大。首版用 `HALO_K=0.115` + 中心 alpha `0.26`，
> 结果剖面 `-50..+50` 全是 218~229，整块糊成平光，**看不出中间有颗丹田**。
> 收窄到 0.075 且中心 alpha 压到 0.16，才保住单峰。
> 实测剖面：`0 → 204 → 235 → 255 → 234 → 191 → 0`。

### ⑤ `verify_speed_scope.py` 的误报（测试自身的坑）

改完之后倍速验收开始**间歇性报"存在泄漏"**，`×2` 的中位 dt 从 0.0334 跳到 0.0500。

排查结论：**不是泄漏，是断言选错了统计量。**
`60-stage.js` 的 dt 有硬上限 `Math.min(0.05, ...)` —— ×2 倍速下战斗逻辑更重，
舞台一帧超 50ms 时 dt 就**贴顶 0.05**。贴顶值恒等于 0.05、与 `speedMult` 无关，
但会把中位数和均值整体抬起来，表现为"×2 的 dt 比 ×1 大 50%"。

**修正**：改用 **p25（尾部四分位）** 比较 —— 它落在未贴顶的区段，
真正反映"喂给各层 dt 里有没有混进 speedMult"。同时打印各轮的**贴顶率**，
贴顶率高只说明"这一轮舞台掉到 20fps 以下了"，不影响判定。

连跑 4 次：`×1 p25 = ×2 p25 = 0.03330`，相对差 **0.00%**，稳定通过。

### v3.3 验收汇总

| 项目 | 结果 |
|---|---|
| 层顺序 | `bg → battle → aura → burst → dantian`（dantian 仅借 ticker，输出到 overlay） |
| 丹田 overlay 贴合角色框 | ✅ 346×350 严丝合缝 |
| 丹田中心亮度 | ✅ 255，剖面 `0→204→235→255→234→191→0` 单峰 |
| 外圈无旋臂星点 | ✅ max = 0（半径 105px 处全黑） |
| 月亮可见 | ✅ avg = 231.2，30 帧 min 230.7 / max 231.7（稳定不闪） |
| 绿闪 | ✅ 40 点 × 40 帧扫描，未发现 |
| 倍速作用域 | ✅ ×1 p25 = ×2 p25 = 0.03330，相对差 0.00% |
| 13 项 E2E | ✅ result: PASS，console_errors: [] |
| 像素量 | 1.212 MPx/帧 → 0.361 MPx/帧（**降 70%**） |
