# 《闲人修仙》横版推进战斗系统规范（v1.0）

> 版本 v1.0 · 2026-09-14 · 依据 v2.4 现行实现（`index.html` 战斗 IIFE）与 `assets/*_meta.json` 素材契约。
> 本文档是**战斗区（`#battleStage`）后续开发的唯一行为基准**：任何 agent/开发者改战斗代码前必读，改完对齐本文。
> 与 `docs/save-system.md`（存档权威）、`docs/versioning.md`（版本权威）、`DESIGN.md`（视觉权威）同级。

---

## 〇、设计立场（先读这个）

1. **这是表演层战斗，不是数值层战斗**。战斗区位于 HUD 下方、修仙立绘上方，是**无限横向推进的自动战斗表演**。它**不产生任何收益**（无掉落、无修为），收益仍归离线结算（`offlineFightWin`）与云游系统。**禁止**在战斗区里发放任何资源。
2. **零输入**。玩家在战斗中**不做任何操作**。所有"策略"在战前（装备/境界），战斗中一切自动。战斗区所有元素 `pointer-events:none`，**绝不拦截任何点击**（见 §7 血泪教训）。
3. **数据驱动，素材契约优先**。角色与怪物的动画参数**必须**来自对应 `*_meta.json`，**禁止**在代码里硬编码帧数/尺寸（历史事故见 §7）。代码只负责"按契约播放"。
4. **表现与逻辑分离**。`update*` 只改状态，`draw*` 只读状态。禁止在渲染函数里改游戏状态。
5. **不阻塞主线程**。战斗区是背景装饰，掉帧不能影响主游戏。素材未加载时**必须**有占位降级（§6.3）。

---

## 一、系统边界

```
┌─────────────────────────────────────────────┐
│  index.html（单文件，自包含 IIFE）             │
│                                              │
│  <div class="battle-stage" id="battleStage"> │  ← 定位容器（fixed，z-index:1）
│    <canvas id="battleCanvas">                │  ← 全部战斗渲染
│    <div class="battle-hud">                  │  ← 击杀 / 倍速 / 状态
│  </div>                                      │
│                                              │
│  <script> (function(){ ... })() </script>    │  ← 战斗 IIFE（约 460 行）
└─────────────────────────────────────────────┘
```

| 项 | 规定 |
|---|---|
| 宿主 | `index.html` 内联 IIFE，**不拆文件**（与项目"零依赖、无构建"一致） |
| 对外接口 | `window.BattleAPI`（**唯一**合法耦合点，见 §5） |
| 定位 | `position:fixed; top:92px; bottom:calc(44vh + 84px); z-index:1` |
| 交互 | `pointer-events:none !important`（容器 + 全部子元素，见 §7） |
| 存档 | **不入档**。战斗是瞬态表演，不写 `state`、不上云 |
| 依赖 | 仅 `assets/cultivator_sheet.png` + `assets/main-bg.jpg`（+ 未来怪物 sprite） |

---

## 二、坐标系与几何规范

> 横版推进战斗的**一切定位**都建立在世界坐标（world X）+ 摄像机（camX）之上。这是最容易出错的地方，必须严格约定。

### 2.1 坐标定义

| 概念 | 定义 | 说明 |
|---|---|---|
| **世界坐标 `x`** | 角色在"世界"中的横坐标，只增不减 | 玩家持续向 `+x` 推进 |
| **摄像机 `camX`** | 视口左边缘对应的世界坐标 | `camX = player.x - stageW()*0.28` |
| **屏幕坐标 `sx`** | `sx = worldToScreen(x) = x - camX` | 唯一渲染入口 |
| **地面线 `floorY()`** | `CH * 0.82` | 所有角色的**脚底**落在此线上 |
| **垂直坐标 `y`** | 相对地面的偏移（绘制时 `translate(sx, floorY())`） | **不要**用绝对 Y 定位角色 |

**铁律**：所有角色逻辑坐标只用**世界 X**；一切绘制必须经 `worldToScreen()`。**禁止**在逻辑里混入屏幕坐标。

### 2.2 摄像机

```js
function updateCamera(dt) {
  const targetCam = G.player.x - stageW()*0.28;   // 主角恒定在视口 28% 处
  G.camX += (targetCam - G.camX) * Math.min(1, dt*6);  // 阻尼跟随，不硬切
}
```

| 参数 | 值 | 含义 |
|---|---|---|
| 主角屏幕锚点 | `28%` | 主角永远显示在视口左侧 28% 位置 |
| 跟随阻尼 | `dt*6` | 平滑跟随；数值越大越"硬"，越小越"飘" |

> **相机滞后原则**：`Math.min(1, dt*6)` 保证掉帧时不会"跳跃追帧"，这对移动端低帧率至关重要。

### 2.3 攻击范围（`atkRange`）—— **核心规范**

攻击范围是**世界坐标下的水平距离**，判定与移动都用它。**不是**像素包围盒，是**一维水平距离**。

| 实体 | `atkRange` | 语义 |
|---|---|---|
| 玩家 | `75` | 剑锋可及的左右各 75 世界单位 |
| 妖卒 slime（近战） | `30` | 贴身才打得到 |
| 妖将 demon（近战） | `35` | 略长 |
| 妖弓 raptor（远程） | `110` | 远程压制 |
| 宠物（默认） | `50` | `addPet` 可覆盖 |

**判定公式（四个关键常数，必须记住）**：

```js
// ① 进入攻击：距离 ≤ atkRange + BC.attackEnter
if (near && Math.abs(near.x - p.x) <= p.atkRange + BC.attackEnter) { /* 起手攻击 */ }

// ② 停下推进：敌人停在玩家 atkRange 处
const stopX = p.x + e.atkRange;
if (e.x > stopX + BC.stopMargin) e.x = Math.max(stopX, e.x - e.speed*dt);

// ③ 攻击命中：距离 ≤ atkRange + BC.hitMargin  （比"进入"宽 10，容错，防走位抖动导致空刀）
if (Math.abs(p.attackTarget.x - p.x) <= p.atkRange + BC.hitMargin) { /* 结算伤害 */ }

// ④ 索敌搜索范围：视野比攻击范围大得多，避免"看不到近处的怪"
findNearestEnemy(p.x, p.atkRange + BC.vision);
```

| 常量 | 值 | 作用 | 为什么这么设 |
|---|---|---|---|
| `BC.attackEnter` | `+5` | 判定"进入攻击距离" | 略宽于 atkRange，避免边界抖动反复切状态 |
| `BC.hitMargin` | `+15` | 判定"这一刀打中" | 比 ENTER 再宽 10：起手到出招有个动画延迟（帧10/帧26），角色可能已轻微错位 |
| `BC.vision` | `+200` | 索敌搜索半径 | 保证"看得见"屏幕边缘刚刷出的怪 |
| `BC.stopMargin` | `+2` | 敌人停步阈值 | 防止 `e.x == stopX` 处抖动 |

> **⚠️ 距离判定必须用 `atkRange + margin`，绝不能用固定像素值。** 新怪物接入时按其 `meta.base_stats.atkRange` 走同一套 margin。

**⚠️ `atkRange` 与视觉必须对得上（§7.1）**：`atkRange` 是**世界单位**，与 sprite 尺寸完全解耦。
换素材、改 `target_ratio`、改画布高度都**不会**改变判定距离。
反过来，如果美术把武器画长了 30%，`atkRange` 就该按同样比例调——否则刀尖明明碰到敌人却不掉血。

### 2.3.1 表现尺寸与对齐（视觉不穿帮的另一半）

| 规则 | 实现 |
|---|---|
| 尺寸基准 | `content_h × (min(CH × target_ratio, max_px) / content_h)`，即按**身高等比**缩放 |
| 不再用"内容高度"当绘制高度 | 否则矮胖史莱姆会被拉成与人等高（§11.1） |
| 脚底对齐 | `dy = -box.h * k`，其中 `k = hitH / box.h` |
| 水平居中 | `dx = -box.w * k / 2`，按**该帧实测内容框**居中 |
| 逐帧独立 | 每帧姿态不同 → 框不同 → 血条与命中位置都跟着变 |

**尺寸分级**：人物 `target_ratio 0.62 / max_px 110`；小怪 `0.34 / 60`。
新怪按 `tier` 给档：tier1 走 `0.34`，体型更大的精英怪另定，**不要临时写死像素**。

### 2.4 移动与推进

```js
// 玩家三种状态（优先级从高到低）
1. 攻击中（p.attackAnim）         → moving=0，原地出招，不中断
2. 有怪进入攻击距离                → moving=0，站定（等 atkT 冷却后起手）
3. 有怪但不在攻击距离              → moving=1，向怪走：targetX = near.x - atkRange*0.85
4. 无怪                          → moving=1，匀速前进：x += playerSpeed*dt
```

| 实体 | 速度 | 说明 |
|---|---|---|
| 玩家 `playerSpeed` | `28` | 推进速度慢，营造"漫步"感 |
| 玩家追击 | `playerSpeed*1.5` | 追怪时 1.5 倍速（`42`） |
| 妖卒 | `120` | 冲向玩家 |
| 妖将 | `95` | 稍慢 |
| 妖弓 | `70` | 最慢（远程） |

**敌人速度抖动**：`speed * (0.9 + random*0.2)` → 同类敌人有 ±10% 速度差，避免"整齐划一"的机械感。

---

## 三、时间与节拍

### 3.1 帧循环

```js
let lastT = 0;
function loop(t) {
  if (G.paused) { lastT = t; requestAnimationFrame(loop); return; }  // 暂停时不推进时间
  const dt = Math.min(0.05, (t - lastT)/1000);   // ① 钳制 dt 上限 50ms
  lastT = t;
  update(dt); render();
  requestAnimationFrame(loop);
}
```

| 规定 | 值 | 理由 |
|---|---|---|
| `dt` 上限 | `0.05s`（20fps） | 切后台回来时 `dt` 会暴增，钳制防止"瞬移穿怪" |
| 暂停语义 | `G.paused=true` 时**只跳过 update**，仍继续 rAF | 恢复时 `lastT` 重置，不补帧 |

### 3.2 倍速（speedMult）

```js
const sdt = dt * G.speedMult;   // ← 所有 update 用 sdt，渲染用 dt
```

**铁律**：**逻辑推进用 `sdt`（受倍速影响），渲染/动画计时用 `dt`（不受影响）**。当前实现中 `update()` 内一律传 `sdt`。

| 倍速技能 | 倍率 | 时长 | 触发概率 |
|---|---|---|---|
| double | 2x | 5s | 8% |
| triple | 3x | 3s | 3% |

> 倍速通过 `BattleAPI.trySpeedSkill()` 触发（当前**不自动调用**，接口预留给后续玩法）。HUD 显示 `×N 倍速 (剩余秒数)`。

### 3.3 动画帧推进

```js
p.animTimer += dt;                    // ← 用 dt，不用 sdt（动画不随倍速加速）
const frameDur = 1 / SPRITE.fps;      // 24fps → 41.67ms
if (p.animTimer >= frameDur) { p.animTimer -= frameDur; /* 推一帧 */ }
```

**累积器写法**：`animTimer -= frameDur`（不是 `=0`），保证低帧率下动画时序不漂移。

### 3.4 生成节拍

| 参数 | 值 | 说明 |
|---|---|---|
| `spawnInterval` | `1.4s` | 波次间隔（受倍速影响，用 `sdt` 递减） |
| `enemySpawnOffset` | `40` | 生成在屏幕右缘外 40 单位 |

```js
e.x = G.camX + stageW() + BC.enemySpawnOffset;   // 屏幕右外侧
G.spawnT -= sdt; if (G.spawnT <= 0) { spawnWave(); G.spawnT = BC.spawnInterval; }
```

---

## 四、伤害与判定

> 本作战斗区是**表演性战斗**：敌我血量刻意设成"一刀秒/几刀秒"，追求节奏感而非数值深度（`playerAtk:2`、`enemy.hp:1`）。

### 4.1 玩家攻击：双段分帧判定

**这是本系统的核心表现机制**：一次挥剑动画触发**两次**独立判定。

```js
// 攻击动画 40 帧（帧 0..39），命中判定在两个特定帧触发
帧 10 → 第一段（刺剑）：判定 → 命中则伤害
帧 26 → 第二段（刺剑）：判定 → 命中则伤害
```

| 段 | 触发帧 | 攻击系数 | 暴击率 | 暴击倍率 | 伤害色 | 说明 |
|---|---|---|---|---|---|---|
| 第一段 | `10` | `0.9~1.1` | `8%` | `1.8x` | `#7fe0ff` | 主刺 |
| 第二段 | `26` | `0.95~1.2` | `10%` | `2.0x` | `#a0e8ff` | 补刺（略强） |

**伤害公式**：
```js
dmg = p.atk * (base + random()*var) * (crit ? critMult : 1)
// 第一段 base=0.9 var=0.2；第二段 base=0.95 var=0.25
```

**🎯 死亡中断铁律（网游判定）**：
```js
// 第一段把目标打死了 → 立即中断，不刺第二下
if (!p.attackTarget.alive) { p.attackAnim=false; p.animFrame=0; p.attackTarget=null; ... }
```
> 这是"网游死亡判定"：**目标已死则不再补刀**。任何多段攻击都必须遵守。同时攻击动画**播放期间不可被新目标打断**（`if (p.attackAnim) p.moving=0;`）。

### 4.2 攻击间隔

```js
p.atkT = 1 / p.aspd;   // 冷却 = 1/攻速
```

| 实体 | `aspd` | 间隔 |
|---|---|---|
| 玩家 | `1.1` | ~0.91s |
| 宠物（默认） | `1.0` | 1.0s |
| 敌人 | `0.8 + random*0.5` | 0.8~1.3 次/秒（**随机化，避免齐攻**） |

### 4.3 敌人攻击

敌人攻击**同样是分帧判定**：先起手，动画推进到出手帧才结算伤害。

```js
// 1) 起手（updateEnemies）：走到范围内且冷却好 → 播放 attack 动画
if (Math.abs(e.x - p.x) <= e.atkRange + BC.attackEnter && e.atkT <= 0) {
  e.atkT = 1 / (e.aspd || (0.8 + Math.random()*0.5));
  e.attackAnim = true; e.animFrame = 0; e.hitFired = false;
}

// 2) 出手（动画推进）：到攻击动画的 55% 处结算，只结算一次
const hitAt = Math.round(ec.attackCount * BC.enemyHitRatio);   // enemyHitRatio = 0.55
if (!e.hitFired && e.animFrame >= hitAt) {
  e.hitFired = true;
  if (Math.abs(e.x - p.x) <= e.atkRange + BC.hitMargin) {     // 判定阈 +15
    p.hp -= e.atk * (0.85 + Math.random()*0.3);               // 敌人伤害 ±15% 浮动
    p.hurtT = HURT_FLASH; p.stun = 0.5;
  }
}
```

| 关键点 | 规定 |
|---|---|
| 出手帧 | `attackCount × 0.55`——**抬手到一半**结算，不是收招时（视觉与判定对得上） |
| 只结算一次 | `hitFired` 锁；每次起手重置 |
| 冷却与动画解耦 | 起手条件**不含** `!e.attackAnim`。否则动画播完到冷却结束之间出现空窗，表现为**怪站着不动不还手** |
| 判定阈 | 起手用 `atkRange + attackEnter(+5)`，出手用 `atkRange + hitMargin(+15)`——起手后玩家最多再走远 15px 仍算命中 |
| 攻击中可移动 | 怪物攻击动画**不锁移动**（与玩家相反），保证"边追边打"的压迫感 |

> **玩家不会死**：`if (p.hp <= 0) p.hp = p.maxHp;`（满血复活）。这是**有意设计**——战斗区是表演，不能让背景装饰打断主游戏。

### 4.4 索敌

```js
function findNearestEnemy(fromX, maxDist) {
  // 跳过死亡/正在死亡的敌人；返回 maxDist 范围内最近的一个
}
```

**规定**：
- 索敌只看**水平距离**，不看垂直（本系统无纵向机动）
- **死怪不可选中**（`if (!e.alive || e.dying > 0) continue;`）
- `dying` 是"死亡动画播放中"状态：已 `alive=false`，但仍留在场上播消散，此时不可被选中
- 索敌半径 = `atkRange + BC.vision(200)`——**视野 > 攻击范围**，怪在视野内够不着时向目标移动，够得着才起手

### 4.5 判定边距总表（**改数值只改这里**）

| 常量 | 值 | 作用 |
|---|---|---|
| `BC.vision` | 200 | 索敌视野外扩 |
| `BC.attackEnter` | 5 | 起手容差（敌我通用） |
| `BC.hitMargin` | 15 | 出手命中容差 |
| `BC.stopMargin` | 2 | 怪物停步死区（防抖动） |
| `BC.enemyHitRatio` | 0.55 | 怪物出手进度 |
| `BC.hurtFlash` | 0.25 s | 受击白闪时长 |
| `BC.deathFade` | 0.4 s | 死亡消散时长 |

> 代码里**不得**再出现裸数字 `5` / `15` / `200` / `0.55`——全部走 `BC.*`。

---

## 五、对外接口 `window.BattleAPI`（唯一耦合点）

> 主游戏（`game.js`）只能通过 `BattleAPI` 与战斗区交互。**禁止**直接操作 `G`/`BC`。

| 方法 | 签名 | 作用 | 调用方约束 |
|---|---|---|---|
| `getKills()` | `→ number` | 当前击杀数 | — |
| `resetKills()` | `→ void` | 清零击杀 | 换境界/重置时调用 |
| `triggerSpeedSkill(mult, dur)` | `→ bool` | 直接触发倍速 | `mult<=1` 返回 false |
| `trySpeedSkill()` | `→ {name,mult,duration}\|null` | 按概率随机触发倍速 | 由主循环按需调用 |
| `getSpeedMult()` | `→ number` | 当前倍速 | — |
| `addPet(def)` | `→ pet` | 挂载宠物 | `def` 见 §5.1 |
| `removePet(id)` | `→ void` | 卸下宠物 | — |
| `getPets()` | `→ Pet[]` | 宠物列表 | — |
| `spawnWave()` | `→ void` | 立即刷一波 | — |
| `pause()` / `resume()` | `→ void` | 暂停/恢复（**主游戏弹窗时必须 pause**） | 见 §7.2 |
| `getState()` | `→ {kills,speedMult,state,playerHp,pets,enemies}` | 状态快照（调试/测试） | — |
| `getAssetContract()` | `→ {id: {...}}` | **只读**素材合同（`ready`/`cols`/`frame`/`fps`/`facing`/`measured`/片段） | 只读，给 CI/美术校验 |
| `debugClips()` | `→ {...}` | **只读**诊断快照（帧表、`rendered`、`history` 帧带、`enemies` 内部状态） | 只读，不得用于游戏逻辑 |

> 后两个是**诊断接口**，职责是"让改动自证"，不承担玩法。任何玩法逻辑调用它们都算越界。

### 5.1 宠物定义 schema

```js
BattleAPI.addPet({
  id, name,
  atk: 5, aspd: 1.0, atkRange: 50, hp: 80,
  color: '#ffd76b',
  offsetX: -30, offsetY: 0,     // 相对玩家的偏移（负值=在玩家身后）
});
```

> 宠物是**预留接口**，当前默认不挂载。宠物跟随玩家（阻尼插值 `dt*8`），自动攻击最近敌人。

---

## 六、素材契约（**本规范的核心**）

> **一切动画参数以 `assets/*_meta.json` 为唯一来源。** 代码里的 `SPRITE`/`BC` 只能作为**默认值兜底**，真实值应从 meta 读取。

### 6.1 Sprite Sheet 通用规格

| 项 | 规定 |
|---|---|
| 布局 | 等宽等高的网格：`宽 = cols × frame_w`，`高 = rows × frame_h` |
| 帧序 | **行优先**（row-major）：`row = ⌊idx / cols⌋`，`col = idx % cols` |
| 帧寻址 | **必须用 `frames[]` 绝对帧号数组**，不用 `srcFrame + start` 的矩形假设（见下） |
| 朝向 | 由 `facing` 声明（玩家 `right`，怪物 `left`）；与站位需求不一致时 `ctx.scale(-1,1)` 镜像 |
| 帧率 | `24 fps`（`frameDur = 1/24`），逐角色从注册表读，禁止写死 |
| 锚点 | 脚底对齐 `floorY()`，水平按**该帧实测内容框**居中 |
| 对齐 | 所有帧按**内容框**脚底对齐（见 §7.3 抖动事故） |

**帧寻址公式（唯一正确算法）**：

```js
const absFrame = c.clipFrames[clip][i];        // ← 权威：来自 manifest 的实测绝对帧号
const col = absFrame % c.cols;
const row = (absFrame / c.cols) | 0;
const srcX = col * c.fw, srcY = row * c.fh;
```

**口径纠偏（2026-09-14 二次实测，结论已推翻早期判断）**：

> `meta.start/count` **本身就是贴图内的绝对帧号，直接用，不做任何偏移。**
> `meta.src_frames` 是源视频帧号，**仅供溯源，与贴图无关**。

早期曾认为需要 `SHEET_SHIFT = +4`（因为玩家源帧号 4 恰好也是有效帧，属于巧合）。该偏移是**误判**，
且后果严重：`hurt` 段被算到贴图外 → **受击动画永远不播**。现已从代码与生成器中彻底移除，**禁止再引入任何偏移**。

逐帧扫描贴图可自证：三张贴图的有内容帧分别落在 `0..71` / `0..93` / `0..77`，与 `total_frames` 一致。

**另一个必须防的坑**：一旦 `absFrame` 是 `NaN`，`NaN % cols` 仍是 `NaN`，`drawImage` 静默不画，
表现为"随机几帧消失"。`absFrameOf` / `drawFrame` 均已加 `Number.isFinite` 兜底。

`frames[]`（而非 `start + i`）之所以是权威：只有逐帧实测数组能表达**尾部空帧**与**非矩形片段**；
生成器在逐帧裁内容框时会自然截断空帧，运行时不必再猜。

### 6.2 动画段（`walk` / `attack` / `hurt`）

每个实体至少定义三段动画，**每段都是 `{index, count, loop, frames[], boxes[]}`**：

| 段 | loop | 用途 | 结束行为 |
|---|---|---|---|
| `walk` | `true` | 移动/待机 | 循环 |
| `attack` | `false` | 出招 | 播完回到 walk |
| `hurt` | `false` | 受击 | 播完回 walk（优先级高于 attack） |

> `src_frames` 是生成 sprite 时的**源帧溯源记录**（pipeline 用）；运行时用 manifest 里换算好的 `frames[]`。

**`assets/sprite-manifest.json`（运行时唯一素材合同）**

由 `tools/gen_sprite_manifest.py` 从各 `*_meta.json` + 贴图像素合成，随 OTA 资源清单发布。每个角色：

```json
{
  "id": "monster_001",
  "sprite": "assets/monster_001_green_slime.webp",
  "cols": 12, "rows": 8, "frame_size": [240, 128], "fps": 24, "facing": "left",
  "content_h": 98,          // 全片段内容高度中位数 → 表现尺寸基准
  "target_ratio": 0.34,     // 屏幕高度占比（人物 0.62 / 小怪 0.34）
  "max_px": 60,             // 像素上限，防大屏拉飞
  "correct": { "scaleY": 0.92 },   // 形态校正，见 §6.6
  "clips": {
    "walk":   { "index": 0,  "count": 32, "loop": true,  "frames": [0, ...], "boxes": [{"x":96,"y":61,"w":48,"h":43}, ...] },
    "attack": { "index": 32, "count": 51, "loop": false, "frames": [32, ...], "boxes": [...] },
    "hurt":   { "index": 83, "count": 11, "loop": false, "frames": [83, ...], "boxes": [...] }
  }
}
```

> **`boxes[]` 是像素级对齐的关键**：每帧的真实内容框。绘制时按 `k = hitH / box.h` 缩放、
> `dx = -box.w*k/2, dy = -box.h*k` 定位 → 脚底贴地、左右居中，且**不同动作幅度不会被拉伸变形**。
> 三个角色（玩家 + 2 只怪）**均已实测出 `boxes`**，走同一条对齐路径，不存在降级特例。

### 6.3 现有契约清单

**当前实测契约（2026-09-14 重生成，口径：无偏移绝对帧号）**

| id | 贴图（`.webp`） | cols | content_h | ratio | facing | walk | attack | hurt | correct |
|---|---|---|---|---|---|---|---|---|---|
| `cultivator` | `cultivator_sheet.webp` | 9 | 107 | 0.62 | right | 32（0–31） | 40（32–71） | — | 无 |
| `monster_001` | `monster_001_green_slime.webp` | 12 | 98 | 0.34 | left | 32（0–31） | 51（32–82） | 11（83–93） | `scaleY 0.92` |
| `monster_002` | `monster_002_water_sprite.webp` | 10 | 67 | 0.34 | left | 32（0–31） | 33（32–64） | 13（65–77） | `scaleY 0.92 / skewX -0.03` |

> 贴图已于 2026-09-14 全量转 **WebP** 并删除 PNG（体积 −30%），`meta.sprite` 与 manifest 同步指向 `.webp`。
> 换格式后**必须重跑 `tools/gen_sprite_manifest.py`**：内容框是逐像素实测的，编码一变就可能偏移。

**历史错判留档（防第三次踩）**：一度实测出"怪物 attack 只有 35 帧、hurt 0 帧"，
根源是那次扫描用了 `src_frames + SHEET_SHIFT` 的错误口径，把尾巴扫到了贴图外。
按绝对帧号重扫后，attack 51 帧、hurt 11 帧**完整存在**。

**降级路径**：素材未加载/不存在时，玩家画火柴人、怪物画统一占位椭圆（不再按 `type` 分支），
保证战斗画面永远能画出来。**新角色接入只需在 manifest 加一条，绘制代码零改动。**

### 6.4 怪物 meta schema 说明

`monster_001_green_slime_meta.json` 已确立**怪物素材契约**，后续怪物**必须**遵守同样字段：

```json
{
  "id": "monster_001", "serial": 1, "name": "绿色史莱姆", "name_en": "Green Slime",
  "type": "monster", "role": "melee", "facing": "left", "tier": 1,
  "sprite": "assets/monster_001_green_slime.png",
  "walk":   { "start": 0,  "count": 32, "fps": 24, "loop": true, "src_frames": [4, ...] },
  "attack": { "start": 32, "count": 51, "fps": 24, "loop": false, "phases": ["蜷缩蓄力","恢复","伸出手攻击"] },
  "hurt":   { "start": 83, "count": 11, "fps": 24, "loop": false },
  "frame_size": [240, 128], "cols": 12, "rows": 8, "total_frames": 94,
  "base_stats": { "hp": 1, "atk": 2, "speed": 60, "atkRange": 25, "aspd": 0.8 },
  "pipeline": "...",
  "created_at": "2026-09-14"
}
```

**字段规定**：

| 字段 | 规定 |
|---|---|
| `id` | **必须存在**，且等于代码 `BC.enemies[type].sprite` 引用的键（当前 `monster_001`） |
| `sprite` | **必须存在**，贴图相对仓库根的路径（`assets/xxx.png`）。缺这两个字段 manifest 会跳过该角色 |
| `role` | `melee` \| `range`，决定 AI 行为（远程用大 `atkRange`） |
| `facing` | 素材本身朝向；`left` 表示生成时已镜像，运行时按需再翻转 |
| `tier` | 弱→强排序，对应境界阶段 |
| `base_stats.atkRange` | **必须**与代码 `BC.enemies[type].atkRange` 一致（见 §7.1 事故） |
| `base_stats.aspd` | 攻击频率（次/秒），代码取其倒数作冷却 |
| `base_stats.speed` | 移动速度（世界单位/秒） |
| `count` | **模型声明值仅供参考**，实测值以 manifest 的 `frames.length` 为准 |

> **数值口径**：`base_stats` 里的数值是**怪物原始基准值**，代码可加随机抖动（如 `speed*(0.9+r*0.2)`）但**不得改变量级**。

### 6.5 素材生成流水线（`tools/build_sprite_sheet.py`）

已固化的处理链（**新怪物素材必须走同一脚本**）：

```
视频 → 抽帧(24fps) → flood fill 去背景(保护眼睛) → fixed crop window
     → top 25% 头部检测 → median filter(消异常值) → integer pixel alignment
     → target_height=85 → 网格拼图(cols×rows) → 生成 meta
```

| 步骤 | 作用 | 为什么 |
|---|---|---|
| `flood fill 去背景` | 抠图 | **保护眼睛**（纯色键控会误伤眼白） |
| `fixed crop window` | 固定裁剪框 | 避免每帧独立裁 bbox 导致"横跳" |
| `top 25% 头部检测` | 检测头顶中心 | 消除走路时的头部抖动 |
| `median filter` | 中值滤波 | 剔除异常帧 |
| `integer pixel alignment` | 整数像素对齐 | 消除亚像素漂移 |

**流水线产出后的第二步（必做）**：`python3 tools/gen_sprite_manifest.py`

它做四件事，缺一不可：
1. 固化**"start 即贴图绝对帧号、无偏移"**这一口径，运行时不再各自猜（见 §6.1）；
2. 实测每帧**内容框** `boxes[]`（alpha > 24 的 bbox），供像素级对齐；
3. 剔除**越界帧与尾部空帧**，让 `count` 反映素材真实长度；
4. 输出**形态校正** `correct`（见 §6.6）。

真实项目里这一步应挂在 `ota/` 资源清单构建流程上，做到"素材一进来，合同就刷新"。
当前它已被 `tools/ota-manifest.py` 连带收录（`INCLUDE_DIRS = ["assets"]`），
但**仍是手工触发**——换素材后要自己跑，别指望 CI 替你记着。

### 6.6 形态校正 `correct`（**禁止在绘制分支里写死**）

素材画扁、画歪，是美术流水线的产物问题，**不是战斗逻辑该管的事**。
曾经这类修正是直接写在绘制分支里的：

```js
// ❌ 反例：为某一种怪写死校正，加一种怪就要复制一遍
} else if (e.type === 'water') {
  ctx.transform(1, 0, -0.03, 1, 0, 0);
  ctx.scale(1, 0.92);
```

一旦绘制走统一路径（CHARS 注册表），这类分支就无处安放，而且会随素材迭代腐烂。
规范：**校正值进素材合同，由 `drawFrame` 统一施加。**

| 字段 | 含义 | 当前值 |
|---|---|---|
| `scaleY` | 纵向压缩（<1 让底部变平贴地），**总高由绘制自动补偿，不会变矮** | 史莱姆/水精灵 `0.92` |
| `skewX` | 横向斜切，修正身体倾斜（负=向左倾，`-0.03` ≈ −1.7°） | 水精灵 `-0.03` |

**几何约定**：变换基准点就是脚底 `(0,0)`。因此 `drawFrame` 只需把 `dh`/`dy` 预先除以 `scaleY`，
再 `ctx.scale(1, scaleY)`，最终总高仍等于 `hitH`、脚底仍贴在 `y=0`——**压平不等于压矮**。

```js
if (csk) ctx.transform(1, 0, csk, 1, 0, 0);
if (csy !== 1) { ctx.scale(1, csy); dh /= csy; dy /= csy; }
```

**优先级**：`meta.correct` > 生成器内 `CORRECT_DEFAULTS` > 无校正。
**合并陷阱**：`loadManifest` 用 `Object.assign` 把 manifest 整条覆盖到兜底表上时，会**冲掉 manifest 里没写的 `correct`**。
所以 `correct` 必须**深合并**——回归脚本里有专门一条断言守着（"manifest 生效后形态校正未被覆盖丢失"）。

---

## 七、血泪教训（**必读，防重蹈**）

### 7.1 攻击距离与视觉不符

**事故**：`feat: 双段攻击分帧触发+网游死亡判定+攻击距离修正`。
**教训**：攻击判定用 `atkRange + margin`（世界坐标距离），**不是** sprite 的视觉宽度。新素材换了尺寸/比例后，**判定距离不会自动变**——必须检查 `meta.base_stats.atkRange` 与代码 `BC.enemies[type].atkRange` 是否同步。

### 7.2 弹窗点不动（z-index 血案）

**事故链**：
1. 战斗区 `z-index:6` 曾**盖住** UI → 所有弹窗点击被战斗 canvas 拦截。
2. 修 `bd42ec2`：战斗 canvas 显式 `pointer-events:none`。
3. 修 `2de73b6`：战斗区 **z-index 从 6 降到 1**（低于所有 UI），且**全部子元素** `pointer-events:none !important`。
4. 我修 `89f64b4`：`.modal` 补 `pointer-events:auto`（另一条独立链路）。

**铁律（不可违反）**：

```css
.battle-stage       { z-index: 1;          /* 必须低于所有 UI（UI 最低 z-index 是 5） */ }
.battle-stage *     { pointer-events: none !important; }
.battle-stage canvas{ pointer-events: none !important; }
```

> **战斗区永远是"背景层"**：它不接收任何点击，也永不遮挡 UI。新加战斗子元素时，`pointer-events:none !important` 自动继承，但**新增独立 fixed 定位元素要复查 z-index**。

**另一条铁律**：**主游戏打开任何弹窗时，必须 `BattleAPI.pause()`**（`6ee8d9b: 离线收益弹窗时暂停战斗动画循环，修复滑动不流畅`），关闭后 `resume()`。暂停能显著降低弹窗滑动时的掉帧。

### 7.3 角色抽搐/横跳（对齐事故）

**事故链**（连续 6 个提交才修复）：
1. `c7d05a1` 角色左右横跳 → 用**角色中心点**对齐替代水平居中
2. `196153d` 回退方案 → 固定裁剪窗口，**不每帧独立裁 bbox**（后处理零偏移）
3. `a8b4f3e` 脚底中心对齐 → 走路只有腿部动，**无整体位移**
4. `3a4f4ec` 头部中心对齐 → 头顶固定，**消除抽搐**
5. `75c8895` 顶部 20% 纯头部检测 + 中值滤波 → 所有帧头心差 ≤1px

**根因**：**逐帧独立裁剪 bbox 会让角色位置随动作漂移**（手臂伸展 → bbox 变宽 → 中心偏移 → 角色左跳）。

**铁律**：
- 生成 sprite 时**必须**用**固定裁剪窗口** + **中心点对齐**（脚底 X 中心 / 头顶 X 中心二选一，全身一致）
- **禁止**逐帧独立裁 bbox
- 对齐后**必须**验证：walk 循环播放时，角色某个参考点（头顶或脚底）在所有帧中**位移 ≤1px**

### 7.4 走路循环不流畅

**事故**：`walk` 16 帧改 32 帧完整循环（源帧 4-35），首尾帧衔接才顺。
**铁律**：循环动画首尾帧**必须**动作连贯（首帧≈尾帧姿态），否则循环点会"跳一下"。生成后需**验证首尾帧相似度**。

### 7.5 素材未加载时白屏

**铁律**：所有 sprite 渲染**必须**有降级路径。参考 `drawPlayerSprite()`：`if (!G.spriteReady || !G.sprite) { /* 画占位图形 */ return; }`。新怪物接入同样处理。

---

## 八、代码规范

### 8.1 结构

```
(function(){
  const BC = { ... };          // 平衡配置（可调数值集中于此）
  const G  = { ... };          // 运行时状态（不入档）
  const SPRITE = { ... };      // 玩家 sprite 契约（应从 meta 读取，见 §6）

  // 素材加载（带 ready 标志 + 降级）
  // window.BattleAPI = { ... }  // 对外接口
  // makePlayer/makeEnemy/spawnWave/findNearestEnemy/dealDamage
  // updatePlayer/updatePets/updateEnemies/updateFx/updateCamera/update
  // drawBg/drawHpBar/drawPlayerSprite/drawPets/drawEnemies/drawFx/drawDmg/render
  // updateHUD / loop / init
})();
```

### 8.2 命名约定

| 前缀 | 含义 | 示例 |
|---|---|---|
| `update*` | 推进状态（可改 `G`） | `updatePlayer` |
| `draw*` | 绘制（**只读** `G`） | `drawEnemies` |
| `make*` | 构造实体 | `makeEnemy` |
| `drawXxxHpBar` | 血条 | `drawHpBar` |
| `BC.*` | 平衡常量 | `BC.playerSpeed` |
| `G.*` | 运行时状态 | `G.camX` |

### 8.3 数值调整纪律

- **所有**可调数值集中在 `BC`（或怪物 `meta.base_stats`）。**禁止**把魔法数字散落在 `update*` 里。
- 改数值后必须验证：**击杀节奏**（当前约 `spawnInterval 1.4s` 刷一波）、**玩家推进速度**（不能快过怪物刷新）。
- `BC.enemies` 的每个 `atkRange/speed/atk` **必须**与对应怪物 `meta.base_stats` 一致。

### 8.4 渲染规范

- 颜色取 `DESIGN.md` 的色板（墨夜/旧金/朱砂/黛青），**禁止**霓虹色
- 战斗区背景**完全透明**（叠加在 `canvas#bg` 墨夜星空上），只画云层（低 alpha）+ 地面线
- 血条：`hp>50%` 绿 / `>25%` 黄 / 否则红；宽 3px 圆角
- 伤害飘字：`0.9s` 生命，向上飘 + 淡出；暴击放大 1.25x + 加粗

---

## 九、性能预算

| 项 | 预算 | 说明 |
|---|---|---|
| Canvas DPR | `devicePixelRatio` 自适应 | `resize()` 中 `ctx.setTransform(dpr,...)` |
| 同屏敌人 | ≤ 10 | 超过会开始拥挤；`spawnInterval` 控制 |
| 特效粒子 | 死亡 8 粒 / 命中 4 笔 | 单次特效 ≤ 12 个图元 |
| 飘字 | ≤ 存活 0.9s | 自动清理 |
| 弹窗时 | **必须 pause** | 见 §7.2 |
| 后台时 | 由主游戏统一管理 | 战斗区不自行监听 visibilitychange |

**降级策略**：
1. 素材未加载 → 画占位图形（不报错、不白屏）
2. 设备低端 → 减少云层数量（当前 5 层可降为 2 层）
3. 主游戏弹窗 → `pause()`

---

## 十、测试清单（改动后必跑）

| # | 检查项 | 方法 |
|---|---|---|
| 1 | 战斗区不拦截点击 | 打开每个弹窗，点关闭按钮，必须生效 |
| 2 | 弹窗滑动流畅 | 打开离线弹窗，上下滑动不卡 |
| 3 | 玩家动画不抽搐 | 观察 walk，头顶/脚底位移 ≤1px |
| 4 | 双段攻击 | 打怪时能看到两次数值跳出 |
| 5 | 死亡不补刀 | 第一段秒杀后，第二段不触发 |
| 6 | 攻击距离合理 | 怪物在剑锋可及处停下，不重叠、不隔空 |
| 7 | 素材未加载降级 | 临时改 sprite 路径，应显示占位图形 |
| 8 | 倍速不改变动画 | `triggerSpeedSkill` 后逻辑加速但动画帧率不变 |
| 9 | `BattleAPI` 契约 | `getState()` 返回结构不变 |
| 10 | 数值与 meta 一致 | 逐个怪物核对 `atkRange/speed/atk` |

---

## 十一、待办与已知缺口

> 更新于 2026-09-14：怪物 sprite 已接入（含逐帧内容框对齐），以下为**剩余**缺口。

| # | 事项 | 优先级 | 说明 |
|---|---|---|---|
| 1 | ~~玩家 `boxes` 接入~~ | ✅ 已解决 | `cultivator_meta.json` 已补 `id`/`sprite`，玩家已进 manifest 并实测出 `boxes` |
| 2 | ~~怪物 `hurt` 素材补拍~~ | ✅ 已解决 | 不是素材缺失，是帧寻址口径错了；按绝对帧号重扫后 hurt 11/13 帧完整可播 |
| 3 | 多怪物类型 sprite | 中 | `slime`/`demon`/`raptor` 三种都映射到 `monster_001`，靠 `defaultSpriteByRole` 兜底；`water` 已用 `monster_002` |
| 4 | `hurt` 优先级细则 | 中 | 当前 hurt 会**打断** attack 显示；需决定长前摇怪是否允许"受击打断出招"（影响平衡） |
| 5 | manifest 挂到 OTA 构建 | 中 | manifest 已被 `ota-manifest.py` 收录，但**仍需手工先跑生成器**；应在构建脚本里串成一步 |
| 6 | `speedSkill` 自动触发接线 | 低 | 接口已备，`trySpeedSkill` 需由玩法层调用 |
| 7 | 宠物实体 sprite | 低 | 接口已备，当前画圆形 |
| 8 | 形态校正尚缺像素级自证 | 低 | `correct` 已进合同并有回归断言，但"总高未被压矮"目前靠几何恒等式保证，未做画布像素校验 |

### 11.1 本轮修复的真实缺陷（留档防回归）

| 缺陷 | 症状 | 根因 | 修法 |
|---|---|---|---|
| 帧寻址用了错误偏移 | 怪物**完全不显示**，随后演变成 hurt **永远不播** | 先误判需要 `SHEET_SHIFT=4`（源帧 4 恰好有效，纯属巧合），把 `hurt` 段推出贴图外 | 移除全部偏移：`absFrame = start + i`；逐帧扫描自证贴图内容落在 `0..93` |
| `NaN` 帧号 | 怪物**随机几帧消失** | `Math.floor(NaN) % n` → `NaN`，`drawImage` 静默失败 | `absFrameOf` / `drawFrame` 双 `Number.isFinite` 兜底 |
| `NaN` 帧号 | 怪物**随机几帧消失** | `Math.floor(NaN) % n` → `NaN`，`drawImage` 静默失败 | `absFrameOf` / `drawFrame` 双 `Number.isFinite` 兜底 |
| 怪物攻击动画永不触发 | 怪**站着不动不还手** | 起手条件带 `&& !e.attackAnim`，动画播完到冷却结束之间存在空窗 | 去掉该条件；`atkT` 独立计时，动画与冷却解耦 |
| 血条与怪物错位 | 血条飘在**几十像素高的空中** | 血条用常量 `35`，与实际绘制高度无关 | `enemyTopH(e)` 取**当前帧**内容高度 |
| 敌人尺寸失控 | 小怪被拉得**与人等高** | 用"内容高度"当绘制高度，矮胖体型被拉伸 | `content_h × (target_ratio × CH) / content_h`，按身高等比 |

### 11.2 诊断接口（改动后自证用）

`window.BattleAPI` 暴露两个只读诊断口，**不含游戏逻辑**，仅用于回归验证：

| 接口 | 用途 |
|---|---|
| `getAssetContract()` | 各角色 `ready`/`cols`/`frame`/`fps`/`facing`/`measured`/`correct` 与片段 `count`/`first` |
| `debugClips()` | `stage`、`drawH`、各角色帧表、`rendered`（最近一帧）、`history`（600 帧帧带）、`enemies`（内部状态快照） |
| `debugClips().rendered.byClip` | **按"角色 + 片段"分别记最近一帧**。只按角色 id 记会被场上同 id 的其他怪覆盖，表现为"attackAnim 明明是 true，诊断却看不到 attack 帧" |
| `spawnWave()` | 手动刷怪，用于稳定复现战斗画面 |

`history` 帧带是**帧覆盖度自证工具**：跑一段后取 `history['monster_001']` 去重，
即可确认 `walk` 是否跑满 32 帧、`attack` 是否真正播到过 59–93 区间——不用肉眼看截图猜。

---

## 十二、文件清单

| 文件 | 作用 |
|---|---|
| `index.html`（战斗 IIFE，~660 行） | 战斗系统全部实现 |
| `assets/sprite-manifest.json` | **运行时唯一素材合同**（帧号 + 内容框 + 尺寸基准），随 OTA 发布 |
| `assets/cultivator_meta.json` | 玩家 sprite 契约（已补 `id`/`sprite`，否则会被生成器跳过） |
| `assets/cultivator_sheet.webp` | 玩家 sprite（2160×1024，9 列×8 行，72 帧） |
| `assets/monster_001_green_slime_meta.json` | 怪物素材契约范本 |
| `assets/monster_001_green_slime.webp` | 绿色史莱姆 sprite（2880×1024，12 列×8 行，94 帧） |
| `assets/monster_002_water_sprite.webp` | 水精灵 sprite（2400×1024，10 列×8 行，78 帧） |
| `ota/manifest.json` | OTA 资源清单（含 `sprite-manifest.json`，由 `tools/ota-manifest.py` 生成） |
| `tools/gen_sprite_manifest.py` | **素材合同生成器**（meta + 像素 → manifest），新素材必跑 |
| `tools/build_sprite_sheet.py` | sprite 生成流水线（新素材复用） |
| `docs/combat-system.md` | **本文档** |
| `docs/save-system.md` / `docs/versioning.md` / `DESIGN.md` | 同级权威文档 |

### 12.1 改动工作流（**必须遵守**）

```bash
# 1) 先拉：本仓库有并发智能体在操作
git pull --ff-only

# 2) 改代码 / 换素材
#    - 换素材后必须重跑合同生成器，否则运行时读到的还是旧帧表
python3 tools/gen_sprite_manifest.py

# 3) 语法自检
python3 -c "import re;s=open('index.html',encoding='utf-8').read();open('/tmp/j.js','w').write(max(re.findall(r'<script>(.*?)</script>',s,re.S),key=len))"
node --check /tmp/j.js

# 4) 起独立验证服务器（禁止占用 /workspace，禁止 pkill）
cd /root/.codebuddy/artifact/xianren-repo/xianren-xiuxian && python3 -m http.server 8091

# 5) 跑诊断自证（帧带覆盖度 + 战斗状态 + 无页面错误），再截图肉眼确认

# 6) 推
git commit && git push
```

> **铁律**：`git pull` 永远在 `git push` 之前。并发智能体与本智能体共享同一 remote，
> 漏拉一次就可能覆盖对方提交。

---

## 附录 A：关键常数速查

```js
// —— 平衡（BC）——
playerAtk: 2          playerHp: 200
playerAtkRange: 75    playerAspd: 1.1      playerSpeed: 28
spawnInterval: 1.4    enemySpawnOffset: 40

// —— 判定 margin（BC，禁止在代码里写裸数字）——
attackEnter: +5       hitMargin: +15       vision: +200     stopMargin: +2
enemyHitRatio: 0.55   怪物出手进度（attackCount × 0.55 帧）

// —— 表现层时长（BC）——
hurtFlash: 0.25s      deathFade: 0.4s

// —— 素材寻址 ——
SHEET_SHIFT: 无        ⚠️ meta.start 即贴图绝对帧号，禁止再加任何偏移
尺寸分级: 人物 target_ratio 0.62 / max_px 110；小怪 0.34 / 60
形态校正: monster_001 scaleY 0.92 / monster_002 scaleY 0.92 + skewX -0.03

// —— 敌人 ——
slime:  atkRange 30   speed 120   hp 1   atk 3   (近战)
demon:  atkRange 35   speed 95    hp 1   atk 5   (近战)
raptor: atkRange 110  speed 70    hp 1   atk 4   (远程)

// —— 玩家攻击帧 ——
第一段: frame 10  系数 0.9~1.1  暴击 8%  ×1.8   #7fe0ff
第二段: frame 26  系数 0.95~1.2 暴击 10% ×2.0   #a0e8ff

// —— 摄像机 ——
主角锚点 28%  阻尼 dt*6

// —— 时间 ——
dt 上限 0.05s   动画 fps 24   逻辑用 sdt / 动画用 dt

// —— 倍速 ——
double 2x/5s/8%   triple 3x/3s/3%

// —— z-index ——
battle-stage: 1（必须低于 UI 最低层 5）
```
