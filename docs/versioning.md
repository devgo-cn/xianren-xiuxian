# 版本号管理规范

> 改版本号只跑一个脚本，所有位置自动同步。**禁止手动逐个文件改版本号。**

## 一、核心原则

**唯一来源（Single Source of Truth）：`index.html` 中的 `window.APP_VER`。**

所有运行时版本号都从这里派生，不允许在其他文件中硬编码独立的版本号。

```
index.html
  └─ window.APP_VER = "3.1"          ← 唯一来源，改这里
       ├─ src/main.js 入口 URL: ?v=APP_VER  (运行时派生，见下方「入口缓存戳」)
       ├─ src/*.js: 模块内部【不带】?v=  (模块图 URL 必须唯一，见下方警告)
       ├─ bg.js / fx2d.js: 资源缓存戳 ?v= (运行时派生)
       ├─ ota/manifest.json: version 字段 (构建时生成)
       ├─ download/index.html: 页面显示 / APK 链接 (脚本同步)
       └─ _probe_*.html: 探测页 APP_VER (脚本同步)
```

### ⚠️ 入口缓存戳：为什么只有一处

`src/*.js` 是同一条 ES Module 依赖图，模块之间用**静态 import**：

```js
// src/40-app.js
import { SND } from './10-base.js';   // ← 不能写 './10-base.js?v=' + APP_VER
```

一旦给某处 import 加了 `?v=`，浏览器会把 `10-base.js?v=3.1` 与 `10-base.js`
当成**两个不同的模块**，各自实例化一份。后果是 `state` / `SND` / 各级缓存
分裂成两份 —— 表现为音效开关失效、rAF 与事件监听重复注册。

因此 `?v=` 只允许出现在 `index.html` 的入口 URL 上：

```html
<script type="module" src="./src/main.js?v=APP_VER"></script>
```

模块图内部的缓存失效**不靠 query**，而是：
- App / 平台端：`ota/manifest.json` 的 `rev` 变化驱动资源热更（与 query 无关）
- 浏览器端：由部署侧的 HTTP `Cache-Control` 负责

## 二、版本号分布全景

### 自动同步（bump-version.py 覆盖）

| 文件 | 字段 / 位置 | 说明 |
|------|------------|------|
| `index.html` | `window.APP_VER` | **唯一来源**，运行时所有版本号的根 |
| `src/main.js` 入口 URL | `?v=APP_VER` | 运行时从 `window.APP_VER` 派生，模块内部不带 query |
| `ota/manifest.json` | `version` | 由 `tools/ota-manifest.py` 从 index.html 读取后生成 |
| `download/index.html` | meta description / 版本 chip / 热更提示 / APK 下载链接 / 正文版本引用 | 全部由 bump-version.py 替换 |
| `_probe_e2e.html` / `_probe_pills.html` | `window.APP_VER` | 探测/测试页，由 bump-version.py 同步 |

### 独立版本号（**不要**跟 app 版本混改）

| 位置 | 示例 | 说明 |
|------|------|------|
| `src/00-pure.js` `SAVE_KEY` | `"dongtian_save_v1"` | 存档格式 schema 版本，仅在存档结构不兼容时才 +1 |
| `docs/save-system.md` 标题 | `v1.10.1` | 文档撰写时的版本快照，保留历史 |
| 代码注释中的 `v1.7.x` / `v1.9.x` | 变更日志注释 | 历史记录，**永远不要改** |
| `ota/manifest.json` `rev` | `b76407630b9fb0b2` | 所有资源文件 sha256 汇总，内容一变自动变，无需手动管 |

## 三、如何改版本号

### 标准操作（唯一正确方式）

```bash
# 设为 2.4（APK 构建号默认不变）
python3 tools/bump-version.py 2.4

# 设为 2.4，同时指定 APK 构建号 r3
python3 tools/bump-version.py 2.4 --build 3

# 只看当前版本，不改任何文件
python3 tools/bump-version.py --print
```

脚本自动完成：
1. 更新 `index.html` 的 `window.APP_VER`
2. 同步 `download/index.html` 中所有版本号引用和 APK 文件名
3. 调用 `ota-manifest.py` 重新生成 `ota/manifest.json`

### 版本号格式

- 支持 `主.次`（如 `2.3`）和 `主.次.修`（如 `2.3.1`）
- 发布新功能 → 次版本 +1（2.3 → 2.4）
- 修 bug / 热更 → 修订版本 +1（2.3 → 2.3.1）
- 大版本重构 → 主版本 +1（2.x → 3.0）

### APK 构建号

- `--build N` 对应 APK 文件名中的 `rN`（如 `xianren-xiuxian-v2.3-r4.apk`）
- 同一个 app 版本重新打包 APK 时 +1
- 不指定 `--build` 时，下载页不显示构建号 chip

## 四、CI/CD 集成

### OTA 清单自动更新

`.github/workflows/ota.yml` 在每次 push 到 main 后自动运行：

```
push → tools/ota-manifest.py → 读取 index.html APP_VER → 生成 ota/manifest.json → 自动提交
```

所以 **push 代码后不需要手动跑 ota-manifest.py**，GitHub Action 会处理。

### 发版流程

```bash
# 1. 改版本号
python3 tools/bump-version.py 2.4 --build 1

# 2. 提交
git add -A
git commit -m "chore: 版本号 → v2.4"

# 3. 推送（触发 OTA 清单自动更新）
git push

# 4. 如需发布 APK，构建后放入 download/ 目录，文件名与下载页一致
#    xianren-xiuxian-v2.4-r1.apk
```

## 五、常见错误

| 错误做法 | 后果 | 正确做法 |
|---------|------|---------|
| 手动改 `ota/manifest.json` 的 version | 下次 CI 跑 ota-manifest.py 会被覆盖 | 改 index.html 的 APP_VER，manifest 自动生成 |
| 在 `game.js` 里写死 `const VERSION = "2.3"` | 与 APP_VER 不同步，显示和缓存戳混乱 | 用已有的 `GAME_VER` / `CACHE_VER` |
| 手动改 `download/index.html` 的版本号 | 漏改某一处，页面显示不一致 | 用 bump-version.py 统一替换 |
| 改代码注释里的历史版本号 | 丢失变更历史 | 注释里的版本号永远不动 |
| 改 `SAVE_KEY` 的版本号 | 老玩家存档读不到 | 仅在存档结构不兼容时才改 |

## 六、代码注释规范

代码中大量 `// v1.7.x` / `/* v1.9.x ... */` 格式的注释是**变更日志**，记录了"为什么这么写"的历史背景。规范如下：

### 保留的注释

| 类型 | 示例 | 原因 |
|------|------|------|
| 带说明的变更日志 | `// v1.7.60 黑屏挂机: 用户主动暂停` | 解释了代码为什么这么写，有历史价值 |
| 性能优化说明 | `/* v2.2 省电: 30fps 观感无损 → GPU负载减半 */` | 记录了性能决策的原因 |
| Bug 修复记录 | `// v2.3 FIX: 云端档采纳失败不得标记同步` | 防止回归，解释了防御性代码 |
| 设计决策记录 | `/* v1.8.0: 图标改用内联 SVG —— 齿轮字符会被渲染成 emoji */` | 解释了非显而易见的选择 |

### 清理的注释

| 类型 | 示例 | 原因 |
|------|------|------|
| 文件级独立版本号 | `fx2d.js v6.6 纯版` / `版本: 0.3.0` | 与统一版本号体系冲突，无实际用途 |
| 描述旧管理方式的注释 | `只改 head 里的 window.APP_VER`（不提 bump-version.py） | 管理方式已变，注释会误导 |
| 引用已删除功能的注释 | （如引用已移除的 Three.js 依赖作为当前理由） | 前提已不存在，注释失效 |
| 纯版本号标记无说明 | `// v1.7.x`（后面没有任何说明文字） | 没有信息量 |

### 写新注释的原则

- 版本注释必须带**说明文字**，不能只有 `// v2.4`
- 说明"为什么"，而不是"改了什么"（git log 已经记录了改了什么）
- 涉及版本号管理方式时，注明 `tools/bump-version.py`

## 七、清理记录

### v2.3 版本号统一清理（2026-09-13）

| 清理项 | 处理方式 |
|--------|---------|
| `fx2d.js` 文件头 `v6.6 纯版` | 删除独立版本号，改为 `fx2d.js —— 旋臂星点带` |
| `dt-theme.css` 文件头 `版本: 0.3.0` | 删除独立版本号及"bump 此号 + index.html 引用参数"说明 |
| `game.js` 开头 v2.3 管理注释 | 更新为说明 `tools/bump-version.py` 是唯一入口 |
| `index.html` 脚本加载处 v2.3 管理注释 | 更新为说明唯一来源和 bump-version.py |
| `_probe_e2e.html` / `_probe_pills.html` | 去掉硬编码 `game.js?v=v1.10.0` / `v1.9.8`，改为动态读取 APP_VER |
| `DESIGN.md` 第7节"版本号与防缓存" | 更新为描述统一管理方式，引用 docs/versioning.md |

## 八、文件清单

| 文件 | 作用 |
|------|------|
| `tools/bump-version.py` | **版本号统一管理入口**，改版本号只跑这个 |
| `tools/ota-manifest.py` | 生成热更新清单，从 index.html 读取版本号 |
| `.github/workflows/ota.yml` | CI 自动更新 OTA 清单 |
| `docs/versioning.md` | 本文档 |
