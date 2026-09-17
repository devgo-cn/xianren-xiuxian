# 《闲人修仙》前端代码审查报告

**审查日期**: 2026-09-17
**审查范围**: src/ 目录全部 8 个 JS 文件（约 560KB / 10500 行）
**审查方式**: 5 路并行逐行精读 + src/ 全目录全局调用点搜索
**审查维度**: 性能 / 内存泄露 / 死代码 / 无效注释 / 逻辑问题 / 省电

---

## 一、问题总览

| 严重程度 | 数量 | 说明 |
|---------|------|------|
| 🔴 严重 | 9 | 崩溃风险、线上行为错误、热路径性能瓶颈 |
| 🟡 中等 | 36 | 死代码、可优化性能、省电遗漏、逻辑缺陷 |
| 🟢 轻微 | 28 | 代码风格、微优化、注释清理 |
| **合计** | **73** | |

**按文件分布**:

| 文件 | 严重 | 中等 | 轻微 | 小计 |
|------|------|------|------|------|
| 00-pure.js | 1 | 5 | 2 | 8 |
| 10-base.js | 2 | 5 | 3 | 10 |
| 20-core.js | 1 | 4 | 4 | 9 |
| 30-systems.js | 2 | 3 | 3 | 8 |
| 40-app.js | 1 | 4 | 3 | 8 |
| 50-battle.js（逻辑） | 2 | 8 | 8 | 18 |
| 50-battle.js（渲染） | 3 | 9 | 4 | 16 |
| 60-stage.js / main.js | 0 | 0 | 1 | 1 |

---

## 二、严重问题（9项，必须修复）

### S1. 调试减速默认开启，全怪移速被砍到 35%
- **文件**: 50-battle.js
- **行号**: 124（生效点 1119-1124）
- **类别**: 逻辑
- **问题**: `if (window.__enemySpeedMul === undefined) window.__enemySpeedMul = 0.35;` 给生产环境默认 0.35。注释写明"v4.6 素材过目模式（当前默认开启，过目完删掉即恢复线上节奏）"——这段调试代码从未删除。
- **影响**: 线上所有新刷怪物移速只有设计值的 35%，与"线上节奏"严重背离；1119 行注释还写着"默认 1"，与实际矛盾。
- **修复**: 删除第 124 行（或将默认改为 1），清理 22-26、115-122 行过目模式注释；保留 `window.__enemySpeedMul` 读取供控制台临时调试。

### S2. closeOffline() 缺少空引用保护，可致白屏崩溃
- **文件**: 10-base.js
- **行号**: 492
- **类别**: 逻辑
- **问题**: `function closeOffline() { $("offlineModal").classList.remove("show"); }` 直接链式调用，无 null 守卫。同文件其他 close 函数均带 `if (m)` 检查。
- **影响**: 若 `#offlineModal` 元素不存在，玩家点击「收下机缘」时抛 TypeError，离线收益弹窗无法关闭，页面卡死。该函数由 index.html:704 onclick 直接绑定，属用户必经路径。
- **修复**: `const m = $("offlineModal"); if (m) m.classList.remove("show");`

### S3. initFxDiag 永久 setInterval 未清理，后台持续耗电
- **文件**: 00-pure.js
- **行号**: 2466-2487
- **类别**: 省电 / 内存泄露
- **问题**: `setInterval(..., 3500)` 每 3.5 秒检查 `window.__fxMode` 和 `window.__fxErr`，从未 clear，无 visibilitychange 处理。
- **影响**: 挂机或切后台后仍以 3.5s 频率唤醒 JS 引擎。本游戏主打挂机，长时运行叠加其他定时器是不必要的电量消耗。闭包持有 DOM 元素引用不释放。
- **修复**: ① interval 句柄存模块变量，enterDim 时 clear、exitDim 时重启；② 或至少 `if (document.hidden) return;` 跳过函数体。

### S4. update 循环每帧分配 5 个数组（filter 全量复制）
- **文件**: 50-battle.js
- **行号**: 2221（G.enemies.filter）、2238（G.fx.filter）、2241（G.dmg.filter）、2340/2353（alive 计数 filter ×2）
- **类别**: 性能
- **问题**: 每帧对活数组整体复制新数组；update 里两次 filter 只取 `.length` 纯为计数。
- **影响**: 12 怪 + 30~50 dmg + 几十个 fx，每帧约 5 次 O(n) 数组复制，每秒 ~300 次短命数组分配，拉高 Minor GC 频率，移动端周期性掉帧。
- **修复**: 数组清理改原地 swap-remove（倒序遍历，末尾交换后 length--）；aliveCount 用计数器维护（击杀/生成时增减），消除两次 filter。预期消除每帧约 80% 短命数组分配。

### S5. buffMult() 每帧多次数组分配，位于主循环热路径
- **文件**: 10-base.js
- **行号**: 344-366
- **类别**: 性能
- **问题**: 每次调用执行 `state.buffs.filter()` → 构建 by 对象 → `Object.keys().map()` → `Math.max(...state.buffs.map())`，创建 3+ 临时数组。通过 `rateNow()` 在 `loop(dt)` 中每帧调用（60fps），updateHUD 中也调用。
- **影响**: 60fps 下每秒约 180 次临时数组/对象分配，增加 GC 压力，低端 Android WebView 偶发掉帧。
- **修复**: 增加模块级 `_buffCache`，pushBuff/buffMult 修改 buffs 后失效缓存，buffMult 读缓存；或将 rateNow 调用从每帧降为与 HUD 同频（100ms）。

### S6. drawEnemies 每帧双遍历+双数组分配+双排序
- **文件**: 50-battle.js
- **行号**: 2672-2678；调用点 3392、3394
- **类别**: 性能
- **问题**: render() 中对 far 和 near 各调用一次 drawEnemies，每帧遍历 G.enemies 两遍、新建两个临时数组、排序两次。
- **影响**: 同屏怪物多时每帧产生 2 个短命数组 + 2 次排序，移动端隐性开销。
- **修复**: 模块级复用排序缓冲数组 `_drawList`，每帧清空填充后只排序一次，按 y 切分 far/near 两段绘制。

### S7. 调试探针 __skDrawn/__skLast 每帧分配对象
- **文件**: 50-battle.js
- **行号**: 3240-3243
- **类别**: 性能
- **问题**: drawFx 的 skillShot 分支中，每帧每条弹道新建含 7 字段的对象字面量写入 `window.__skLast`，含 Math.round/toFixed 字符串操作。
- **影响**: 同屏最多 6 条弹道，每秒约 13 次对象分配/弹道，30fps 循环中不必要的内存 churn，且写入 window 全局破坏封装。
- **修复**: 整段删除，或用 `if (window.__SK_DEBUG)` 条件包裹。

### S8. 水精灵每帧 new PIXI.Matrix()
- **文件**: 50-battle.js
- **行号**: 2758-2761
- **类别**: 性能
- **问题**: 水精灵敌人渲染时每帧每只 `new PIXI.Matrix(...)` 创建 4×4 浮点数矩阵对象。
- **影响**: Matrix 创建+GC 在高频循环中累积，妖潮中多只水精灵时每帧多次分配。
- **修复**: 模块级缓存复用 Matrix 实例 `const _m = new PIXI.Matrix(); _m.set(...); spr.transform.setFromMatrix(_m);`

### S9. bindBattleHooks 无上限轮询，战斗模块加载失败时永久空转
- **文件**: 40-app.js
- **行号**: 667-674
- **类别**: 内存泄露 / 省电
- **问题**: `bindBattleHooks()` 在 `window.BattleAPI` 不存在时每 300ms 递归重试，无最大重试次数上限。同文件 pollBattleLayer 有 10 秒超时保护。
- **影响**: 50-battle.js 加载失败（断网/404）时定时器永久运行，每 300ms 触发回调，后台也不停止，长期驻留持续消耗 CPU/电量。
- **修复**: 加计数器上限：`let _bindPoll = 0; if (++_bindPoll > 50) return;`（15s 后放弃）。

---

## 三、中等问题（36项，建议修复）

### 性能类（12项）

| # | 文件 | 行号 | 问题 | 修复方案 |
|---|------|------|------|---------|
| M1 | 10-base.js | 475-490 | tickBurst() 每帧 filter 分配临时数组，即使粒子为空 | 先检查 `if (!parts.length) return;` |
| M2 | 30-systems.js | 103 | updateHUD() 每 100ms 无条件写 innerHTML="突破"，内容未变化 | 加 textContent 比较或初始化时设一次 |
| M3 | 30-systems.js | 84-125 | updateHUD() 重复 DOM 查询（6+次 getElementById）+ rateNow 重复计算 2 次 | 模块加载时缓存 DOM 引用，rateNow 结果缓存复用 |
| M4 | 30-systems.js | 193-194 | renderStory() O(n×m) 嵌套遍历 journal | 先用 Set 构建存在性集合 |
| M5 | 20-core.js | 148 | storyLoadMore() 每次滚动全量 filter+reverse journal | showChapter 时一次性过滤反转存入缓存 |
| M6 | 20-core.js | 254 | 心跳中 JSON.parse(JSON.stringify(state)) 深拷贝，每 2-5s 一次 | 浅拷贝+手动覆盖关键字段，或 structuredClone |
| M7 | 20-core.js | 456-483 | licSync() 每次 ~10 次 querySelector，装备切换时全部重查 | licBuild 时缓存子元素引用 |
| M8 | 50-battle.js | 1314-1337 | 每次刷怪重建 ~130 项权重池（每杀一只怪触发） | 工厂就绪时增量维护可用怪池模块级数组 |
| M9 | 50-battle.js | 2596 | PET_SPRITE 常量对象写在循环体内，每帧分配 | 移到模块顶层 |
| M10 | 50-battle.js | 3258,3261,3270 | colorInt(f.color) 在 speedBurst 中重复调用 3 次 | 分支开头缓存 `const fc = colorInt(f.color)` |
| M11 | 50-battle.js | 2322-2326 | 身法 buff 期间每帧调用 updateHUD() 写 DOM，最长数秒 | 只在进入/退出身法态时调一次 |
| M12 | 50-battle.js | 2331-2334 | 结算面板期间每帧 getElementById('trialModal') 轮询 | 模块级缓存 DOM 引用 |

### 死代码类（14项）

| # | 文件 | 行号 | 问题 | 修复方案 |
|---|------|------|------|---------|
| M13 | 40-app.js | 9,11 | 导入 5 个已废弃函数从未调用（initAura/initBg/initFxLayer/tickBurst/tickAura） | 从 import 移除 |
| M14 | 40-app.js | 691 | _stageLayers 对象定义后从未使用 | 删除 |
| M15 | 10-base.js | 84-88 | SND 对象中 mute() 与 muted getter 重复定义各两次 | 删除重复定义 |
| M16 | 00-pure.js | 2566-2579 | SKILLS 数组从未被使用（已被 SKILL_DEFS 取代） | 删除定义+export+30-systems import |
| M17 | 00-pure.js | 2612 | EQUIP_CELLPOS 导入但从未引用 | 删除定义+export+两个 import |
| M18 | 00-pure.js | 2547,2535,2531,2689 | MAIL_BTN_PATH/PAGE_RATE/TRAVEL_SPAN_MAILS/hashRand 四个导出符号无调用点 | 删除定义和 export |
| M19 | 00-pure.js | 2602 | autoHuntOn() 硬编码 return false，自动战斗分支已死 | 确认废弃后删除相关函数和按钮，或标注预留 |
| M20 | 30-systems.js | 61 | maxQIdx 死函数，全局无调用 | 删除定义+export+main.js BRIDGE |
| M21 | 30-systems.js | 398-428 | craftAreaHTML 死函数（30行），全局无调用 | 删除定义+export+main.js BRIDGE |
| M22 | 50-battle.js | 94,1668,1744,618,665 | 5 个死函数：tierNeed/findNearestEnemy/inRange/skLv/labPose | 全部删除 |
| M23 | 50-battle.js | 151,155,192,1125,2072-2073 | 8 个幽灵字段：bossSpawnEvery/smallKillsSinceBoss/tierKills/trialRound/hengsaoFailed/reach/__walkRate/__walkAmp | 删除字段及 trialRestart 中 G.trialRound++ |
| M24 | 50-battle.js | 2368 | stageH() 死函数，从未被调用 | 删除 |
| M25 | 50-battle.js | 2824-2828 | makeTex() 死函数，v4.9 后程序化贴图废弃 | 删除 |
| M26 | 50-battle.js | 2746-2748 | 水精灵 col/row 计算后即 void（死变量） | 删除三行 |

### 逻辑类（4项）

| # | 文件 | 行号 | 问题 | 修复方案 |
|---|------|------|------|---------|
| M27 | 10-base.js | 308-314 | cldFlash() 快速连续调用时定时器竞态，文本提前还原 | 用模块变量保存 timeout 并 clearTimeout |
| M28 | 20-core.js | 64,80 | save()/load() 空 catch 吞掉存档错误，玩家丢档无感知 | save 加 console.warn/UI 提示；load 保留 raw 到 .bak 备份 |
| M29 | 50-battle.js | 1125,1775,2207 | stun 眩晕机制空转：受击置 stun=0.5 并衰减，但无任何处读取来打断攻击/移动 | 要么 updatePlayer 开头加 stun 判断让硬直生效，要么删除三处 stun 代码 |
| M30 | 50-battle.js | 3203-3235,2939 | 'column'/cone/ground/drop 分支不可达（SK_TEX 只有 shard/spike），v4.9 改飞行弹后旧分支未清理 | 删除 col 变量及所有 col? 三元分支，删除 f.cone/f.ground/f.drop 相关逻辑 |

### 省电/内存类（4项）

| # | 文件 | 行号 | 问题 | 修复方案 |
|---|------|------|------|---------|
| M31 | 40-app.js | 309,313,343 | 后台时 save(30s)/stayMailCheck(60s)/云存兜底(20s) 3 个 setInterval 未做 document.hidden 短路 | 加 `if (document.hidden) return;` |
| M32 | 20-core.js | 386-393 | setInterval(traceBeat, 2500) 后台空转，功能已退化（唯一职责每 150s 调 traceRefresh） | 合并到 40-app.js 已有心跳，或 setTimeout 递归+visibilitychange 暂停 |
| M33 | 40-app.js | 646,655 | _equipQueue 掉落未拾取时永久残留（只入不出边界场景） | load() 时清空或定期清理超 5 分钟项 |
| M34 | 50-battle.js | 2947-2952/649 | 标定台重置时 SK_LIVE 未同步清理，导致弹道配额泄漏（悬空引用占满 6 槽） | labClearEnemies 中 G.fx.length=0 后追加 SK_LIVE.length=0 |

### 无效注释类（2项）

| # | 文件 | 行号 | 问题 | 修复方案 |
|---|------|------|------|---------|
| M35 | 50-battle.js | 95,154,1281,1285,2261,2282,692,711,1119 | 过时注释：301只/350% 与现行 121只/180% 不符；车道开火条件已改 2D canHit | 统一改 121/180%，删改过时描述 |
| M36 | 50-battle.js | 3377 | render(clear) 参数从未使用（v4.0 后清屏由 GL 接管） | 移除 clear 参数 |

---

## 四、轻微问题（28项，可选修复）

### 性能微优化（6项）
- L1: 50-battle.js:1880,1892,1927 — 每帧 3 遍全量扫怪 + 冗余 Math.hypot，改用平方距离比较
- L2: 50-battle.js:1982 — 宠物每帧 G.drops.find，维护 pendingEquipDrops 数组
- L3: 50-battle.js:2680,2688 等 — floorY()/depthPx() 每帧每实体重复调用，函数开头缓存
- L4: 40-app.js:763 — mountDantianOverlay 每帧 getBoundingClientRect 触发布局，改用 ResizeObserver
- L5: 50-battle.js:379 — ~79 条工厂就绪 console.log，降级 console.debug 或加门控
- L6: 10-base.js:285-289 — cldChip() 冗余包装函数，内联为 $("cloudTxt")

### 逻辑/规范（8项）
- L7: 30-systems.js:99-100 — $("btnBreak") 无空值保护，元素不存在时 TypeError 中断 updateHUD
- L8: 30-systems.js:474 — var _detRows 块级作用域泄漏，改 const
- L9: 20-core.js:497-499 — skillAddExp 浮点累加精度偏差，比较前 round 保留两位小数
- L10: 10-base.js:928 — artCtx() 中多余 typeof 运行时检查，直接调用 equipBonus()
- L11: 50-battle.js:1384 vs 1393-1395 — rollSpeedSkill 重复施加倍速，删除 1393-1395 三行
- L12: 50-battle.js:1619-1625 vs 1352-1358 — playerStrike 重复实现暴击判定，改用 playerCritRoll
- L13: 50-battle.js:2266-2269 — 结算清场跳过死亡动画，清场只设 alive=false 让怪自然走完
- L14: 50-battle.js:3103 — 速度线 Math.random() 每帧抖动，预计算固定长度数组

### 内存（有界，3项）
- L15: 40-app.js:109,115,327,328 — 4 个全局事件监听器无 removeEventListener（单页应用可接受）
- L16: 20-core.js:336-342 — document 级 pointer/touch 监听器永不移除，非拖拽也触发回调
- L17: 50-battle.js:2426 — resize 事件监听潜在重复绑定，用标记位防重

### 代码风格/死代码残留（4项）
- L18: 00-pure.js:1038 — stray semicolon 孤立分号
- L19: 10-base.js:921 — 注释掉的 fireEvent() 调用残留
- L20: 00-pure.js:1100 — MIGRATIONS 中注释示例代码（空对象+注释示例）
- L21: 10-base.js 多处 — 7+ 处 try/catch 空块吞错误无日志

### 注释清理（7项）
- L22: 00-pure.js/10-base.js — 版本历史注释堆积（50+处），保留设计意图删除旧 bug 流水账
- L23: 20-core.js/30-systems.js — 数十处版本号历史注释堆积
- L24: 40-app.js/60-stage.js — 版本号历史注释堆积 + split2.js 拆分工具说明过时
- L25: 50-battle.js 全文 — v2~v6 版本变更流水账堆积
- L26: 50-battle.js:2370-2381,3362-3376 等 — 渲染层版本历史注释（v3.7车道/2D清屏/已修坑）
- L27: 40-app.js:5-6 — 文件头 split2.js 重建说明已过时
- L28: 50-battle.js:2419-2420 — "2D 画布仍保留以兼容独立模式"注释已过时（render 零 2D 调用）

---

## 五、修复优先级排序

### 第一优先级（立即修复，9项严重）
1. S1 — 调试减速默认 0.35（线上行为错误）
2. S2 — closeOffline 空引用崩溃
3. S9 — bindBattleHooks 无上限轮询
4. S3 — initFxDiag 永久定时器后台耗电
5. S4 — 每帧 5 次数组 filter 全量复制
6. S5 — buffMult 每帧数组分配
7. S6 — drawEnemies 双遍历双排序
8. S7 — 调试探针每帧分配对象
9. S8 — 水精灵每帧 new PIXI.Matrix

### 第二优先级（本轮修复，36项中等）
- 死代码清理（M13-M26，14项）— 低风险高收益，批量删除
- 性能优化（M1-M12，12项）— DOM 缓存、数组原地清理、深拷贝优化
- 逻辑修复（M27-M30，4项）— cldFlash 竞态、存档错误处理、stun 机制、死分支
- 省电/内存（M31-M34，4项）— 后台定时器短路、队列清理
- 注释修正（M35-M36，2项）— 过时数值注释

### 第三优先级（后续迭代，28项轻微）
- 性能微优化、代码规范、注释清理等，可在后续版本中逐步处理

---

## 六、验证结论

### 已确认正确的实现（无需修改）
- ✅ 40-app.js 主循环后台降频正确（30fps→1fps，只跑修为结算）
- ✅ 60-stage.js ticker 后台暂停正确（onVis 取消 rAF + clearTimeout）
- ✅ 开屏进度条/splash 清理正确（均有 clearInterval）
- ✅ stayMailCheck 超时清理正确（成功/失败路径均 clearTimeout）
- ✅ G.enemies/fx/dmg/drops 均有清理路径，Audio 池均有 ≤3 上限
- ✅ 骨骼 armature 经 despawnEnemy 正确 release
- ✅ 妖潮 121只/180% 现行实现正确（仅注释未跟进）
- ✅ cloudPullNow/manualBreak/doCraft 在 index.html 有 onclick 绑定，非死代码

### 内存泄露总体评估
未发现"只加不清"的真实泄露点。所有数组均有上限或清理路径，Audio 对象池有 ≤3 上限，PIXI 对象经 despawn 正确 release。仅有的有界常驻（MON_SRC ~79 条 Audio、_callCd 冷却表）属于设计上的缓存，风险可控。

---

*报告生成时间: 2026-09-17*
*审查工具: 5 路并行子代理逐行审查 + 全局调用点交叉验证*
