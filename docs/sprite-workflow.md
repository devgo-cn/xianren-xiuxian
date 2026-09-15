# 素材生成与切帧工作流

> **核心原则**：素材视频由用户提供，AI 不生视频（额度消耗太快）。AI 负责抽帧、抠图、对齐、排列 sprite sheet、接入游戏。

---

## 一、工作流总览

```
用户上传视频 → ffmpeg 抽帧 → flood fill 去背景 → 统一裁剪窗口 → 主体对齐 → 排列 sprite sheet → 转 WebP → 接入游戏
```

### 1.1 抽帧

```bash
# 按 fps 抽帧（通常 12-24fps，根据动作流畅度选择）
ffmpeg -i input.mp4 -vf "fps=12" frames/frame_%04d.png

# 抽指定时间段的帧
ffmpeg -i input.mp4 -ss 2 -t 4 -vf "fps=12" frames/frame_%04d.png
```

**经验**：
- 走路循环：12-16fps 足够，32 帧构成完整循环
- 攻击动作：24fps，动作细节多
- 技能特效：12-24fps，根据特效复杂度
- 帧数以能整除列数为准（如 32 帧 = 8列×4行 或 4列×8行）

### 1.2 抠图（flood fill）

**核心算法**：从图片边缘开始 flood fill，移除背景色。

```python
from PIL import Image
import numpy as np
from collections import deque

def flood_fill_remove_bg(img_path, threshold=30, protect_black=True):
    """
    从边缘 flood fill 移除背景
    threshold: 亮度阈值，低于此值视为背景
    protect_black: 保护主体内部的纯黑区域（如眼睛）
    """
    img = Image.open(img_path).convert('RGBA')
    arr = np.array(img)
    h, w = arr.shape[:2]
    
    # 亮度图
    brightness = arr[:,:,:3].mean(axis=2)
    
    # 背景掩码：从边缘开始 flood fill
    bg_mask = np.zeros((h, w), dtype=bool)
    queue = deque()
    
    # 边缘像素入队
    for x in range(w):
        if brightness[0, x] < threshold:
            queue.append((0, x)); bg_mask[0, x] = True
        if brightness[h-1, x] < threshold:
            queue.append((h-1, x)); bg_mask[h-1, x] = True
    for y in range(h):
        if brightness[y, 0] < threshold:
            queue.append((y, 0)); bg_mask[y, 0] = True
        if brightness[y, w-1] < threshold:
            queue.append((y, w-1)); bg_mask[y, w-1] = True
    
    # flood fill
    while queue:
        y, x = queue.popleft()
        for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]:
            ny, nx = y+dy, x+dx
            if 0 <= ny < h and 0 <= nx < w and not bg_mask[ny, nx]:
                if brightness[ny, nx] < threshold:
                    bg_mask[ny, nx] = True
                    queue.append((ny, nx))
    
    # 保护主体内部纯黑（如眼睛）：不被 flood fill 到的黑色区域保留
    # （flood fill 只从边缘开始，内部黑色自然保留）
    
    # 应用透明
    arr[bg_mask, 3] = 0
    return Image.fromarray(arr)
```

**关键经验**：
- **必须用 flood fill，不能用全局颜色阈值**——全局阈值会把主体内部的黑色（眼睛、阴影）也抠掉
- **背景必须是纯黑**（用户生图时要求纯黑背景），阈值设 25-30
- **白色背景**（如剑气斩帧9）需要单独处理：亮度 > 200 的区域 flood fill
- **抠完检查透明占比**：正常 70-85%，过低说明没抠干净，过高说明抠多了

### 1.3 统一裁剪窗口

**核心原则**：所有帧用同一个裁剪窗口，不能逐帧裁 bbox。

```python
def find_crop_window(frames, padding=20):
    """
    找到所有帧的非透明区域的并集，作为统一裁剪窗口
    """
    min_x, min_y = float('inf'), float('inf')
    max_x, max_y = 0, 0
    
    for frame in frames:
        arr = np.array(frame)
        alpha = arr[:,:,3]
        rows = np.any(alpha > 0, axis=1)
        cols = np.any(alpha > 0, axis=0)
        if rows.any():
            y_min, y_max = np.where(rows)[0][[0, -1]]
            x_min, x_max = np.where(cols)[0][[0, -1]]
            min_x = min(min_x, x_min)
            min_y = min(min_y, y_min)
            max_x = max(max_x, x_max)
            max_y = max(max_y, y_max)
    
    # 加 padding
    min_x = max(0, min_x - padding)
    min_y = max(0, min_y - padding)
    max_x = min(frames[0].width, max_x + padding)
    max_y = min(frames[0].height, max_y + padding)
    
    return (min_x, min_y, max_x, max_y)
```

**为什么不能逐帧裁 bbox**：
- 逐帧裁剪会导致每帧尺寸不同，播放时角色左右跳动
- 攻击帧剑伸出去会变宽，走路帧窄，逐帧裁会忽大忽小
- 统一窗口保证所有帧的主体相对位置一致

### 1.4 主体对齐

**对齐基准**：
- **水平对齐**：头部中心 x 坐标对齐（不是身体中心，头部最稳定）
- **垂直对齐**：脚底 y 坐标对齐（所有角色脚底落在地板线上）

```python
def align_frames(frames, head_x_ratio=0.42, foot_y_ratio=0.95):
    """
    对齐所有帧：头部中心 x 对齐，脚底 y 对齐
    head_x_ratio: 头部中心在帧宽中的比例
    foot_y_ratio: 脚底在帧高中的比例
    """
    # 找到统一的头部 x 和脚底 y
    # 然后平移每帧，使头部和脚底对齐到统一位置
    pass
```

**关键经验**：
- **走路循环的稳定性问题**：原视频走路有位移（走几步向前移动一段），首尾帧对接会后退
- **解决方案**：以头部为不动点，每帧平移使头部 x 坐标一致，走路变成原地踏步
- **更强的限制**：头部 x 偏差超过 2px 就强制对齐，用更强的限制消除轻微抖动

### 1.5 排列 sprite sheet

```python
def build_sprite_sheet(frames, cols, frame_w, frame_h):
    """
    排列成 sprite sheet
    cols: 列数
    frame_w, frame_h: 每帧尺寸（统一）
    """
    rows = (len(frames) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * frame_w, rows * frame_h), (0,0,0,0))
    
    for i, frame in enumerate(frames):
        col = i % cols
        row = i // cols
        sheet.paste(frame, (col * frame_w, row * frame_h), frame)
    
    return sheet
```

**排列规则**：
- 动作按顺序排列：walk 帧在前，attack 帧在后，hurt 帧最后
- 列数选择：尽量让每行填满，如 32 帧用 8列×4行
- 每帧尺寸统一（由统一裁剪窗口决定）

### 1.6 转 WebP

```bash
# 无损 WebP（推荐，透明通道质量好）
cwebp -lossless input.png -o output.webp

# 有损 WebP（体积更小，但透明边缘可能有瑕疵）
cwebp -q 90 input.png -o output.webp
```

**经验**：
- 无损 WebP 比 PNG 小约 30%，透明通道无损失
- 角色素材用无损，背景图可用有损
- 文件名：`cultivator_sheet.webp`、`monster_001_green_slime.webp`

---

## 二、各角色帧配置

### 2.1 修仙男主（玩家）

| 属性 | 值 |
|---|---|
| 文件 | `assets/cultivator_sheet.webp` |
| 尺寸 | 2160×1024（9列×8行） |
| 每帧 | 240×128 |
| walk | 32 帧（帧 0-31），24fps |
| attack | 40 帧（帧 32-71），24fps |
| 伤害帧 | 第一段 animFrame=10，第二段 animFrame=26，第三段 animFrame=36 |
| 音效帧 | 第一段帧8，第二段帧24，第三段帧34 |
| 对齐基准 | 头部中心 x≈0.35 帧宽，脚底 y=帧底 |

### 2.2 绿色史莱姆（monster_001）

| 属性 | 值 |
|---|---|
| 文件 | `assets/monster_001_green_slime.webp` |
| 尺寸 | 2880×1024（12列×8行） |
| 每帧 | 240×128 |
| walk | 32 帧 |
| attack | 51 帧 |
| hurt | 11 帧 |
| 朝向 | 面向左（与玩家对立） |
| 元数据 | `assets/monster_001_green_slime_meta.json` |

### 2.3 水精灵（monster_002）

| 属性 | 值 |
|---|---|
| 文件 | `assets/monster_002_water_sprite.webp` |
| 尺寸 | 2400×1024（10列×8行） |
| 每帧 | 240×128 |
| walk | 32 帧 |
| attack | 33 帧 |
| hurt | 13 帧 |
| 朝向 | 面向左 |

### 2.4 BOSS 史莱姆王（monster_003）

| 属性 | 值 |
|---|---|
| 文件 | `assets/monster_003_slime_king.webp` |
| 尺寸 | 1920×1200（8列×6行） |
| 每帧 | 240×200 |
| walk（漂浮） | 18 帧 |
| attack | 22 帧 |
| recovery | 8 帧 |
| 特殊 | 漂浮不踩地板，floatHeight=20，sizeMult=2.0 |

### 2.5 灵狐宠物

| 属性 | 值 |
|---|---|
| 文件 | `assets/pet_fox_sheet.webp` |
| 尺寸 | 768×320（8列×4行） |
| 每帧 | 96×80 |
| fly | 32 帧，24fps |
| 位置 | 玩家左上方 offsetX=-65, offsetY=-70 |
| 特殊 | y 坐标用 `floorY() + offsetY`（玩家 y 默认是 0） |

### 2.6 剑气斩技能

| 属性 | 值 |
|---|---|
| 文件 | `assets/cultivator_skill_sheet.webp` |
| 尺寸 | 2880×1024（6列×4行） |
| 每帧 | 480×256 |
| 帧数 | 24 帧，24fps（1秒） |
| 命中帧 | 第 12 帧 |
| 对齐基准 | 头部中心 (200,70)，脚底 y=250 |
| 绘制高度 | `Math.min(CH * 0.55, 80)`（和玩家一致，不按帧高比例放大） |

### 2.7 横扫千军技能特效

| 属性 | 值 |
|---|---|
| 文件 | `assets/skill_hengsao_sheet.webp` |
| 尺寸 | 2240×1120（7列×7行） |
| 每帧 | 320×160 |
| 帧数 | 49 帧，12fps |
| 持续时间 | 0.6 秒 |
| 移动距离 | 200px（从玩家位置向右） |
| 特殊 | 左右渐现渐隐（离屏 canvas + destination-in） |

---

## 三、特效渲染技巧

### 3.1 左右渐现渐隐（横扫千军 / BOSS 特效）

```javascript
// 离屏 canvas 绘制 sprite
const off = document.createElement('canvas');
off.width = drawW; off.height = drawH;
const octx = off.getContext('2d');
octx.drawImage(sprite, srcX, srcY, fw, fh, 0, 0, drawW, drawH);

// destination-in 模式：用渐变控制透明度
octx.globalCompositeOperation = 'destination-in';
const grad = octx.createLinearGradient(0, 0, drawW, 0);
grad.addColorStop(0, 'rgba(0,0,0,0)');       // 左侧透明
grad.addColorStop(0.2, 'rgba(0,0,0,1)');     // 20% 位置不透明
grad.addColorStop(0.8, 'rgba(0,0,0,1)');     // 80% 位置不透明
grad.addColorStop(1, 'rgba(0,0,0,0)');       // 右侧透明
octx.fillStyle = grad;
octx.fillRect(0, 0, drawW, drawH);  // 必须 fillRect 整个画布！

ctx.drawImage(off, x, y);
```

**关键 bug 记录**：
- `destination-in` 模式下只 fillRect 左侧 40%，会导致右侧 60%（怪物身体）变透明
- **必须 fillRect 整个画布**，渐变从左侧透明到 40% 位置不透明，右侧保持不透明

### 3.2 速度爆发特效（疾风步/缩地成寸）

```javascript
// 冲击波圆环 + 向后气流线 + 粒子飞溅
ctx.save(); ctx.translate(sx, fy - 25);
// 冲击波圆环
ctx.globalAlpha = (1-k) * 0.6;
ctx.strokeStyle = color; ctx.lineWidth = 2;
ctx.beginPath(); ctx.arc(0, 0, 5 + k*35, 0, Math.PI*2); ctx.stroke();
// 向后气流线（8条，扇形扩散）
ctx.globalAlpha = (1-k) * 0.9;
ctx.lineWidth = 1.8; ctx.lineCap = 'round';
ctx.shadowColor = color; ctx.shadowBlur = 6;
for (let i=0; i<8; i++) {
  const ang = Math.PI + (i/7 - 0.5) * 1.2;
  const r1 = 3 + k*8, r2 = 12 + k*40;
  ctx.beginPath();
  ctx.moveTo(Math.cos(ang)*r1, Math.sin(ang)*r1);
  ctx.lineTo(Math.cos(ang)*r2, Math.sin(ang)*r2);
  ctx.stroke();
}
ctx.restore();
```

### 3.3 残影效果（加速期间）

```javascript
// 玩家身后 3-4 个半透明残影
const trailCount = G.speedMult >= 3 ? 4 : 3;
for (let i = trailCount; i >= 1; i--) {
  ctx.save();
  ctx.translate(sx - i * 10, sy);
  ctx.globalAlpha = 0.12 * (trailCount + 1 - i) / trailCount;
  ctx.scale(1 + i * 0.03, 1);  // 轻微水平拉伸
  ctx.drawImage(sprite, srcX, srcY, fw, fh, -drawW*0.35, -drawH, drawW, drawH);
  ctx.restore();
}
```

### 3.4 受击火花（不旋转！）

```javascript
// 4 条向外扩散的短线，不旋转
// 之前用 ctx.rotate(f.t*3) 旋转 4 条线，看起来像转圈加载图标
// 改成固定角度的 4 条线，向外扩散
for (let i=0; i<4; i++) {
  const ang = i * Math.PI/2 + Math.PI/4;  // 固定角度
  const r1 = 3, r2 = 8 + k*12;
  ctx.beginPath();
  ctx.moveTo(Math.cos(ang)*r1, Math.sin(ang)*r1);
  ctx.lineTo(Math.cos(ang)*r2, Math.sin(ang)*r2);
  ctx.stroke();
}
```

---

## 四、战斗系统架构

### 4.1 代码位置

所有战斗系统代码在 `index.html` 的一个 `<script>` IIFE 中，通过 `window.BattleAPI` 暴露接口。

**核心函数**：
- `makePlayer()` - 创建玩家
- `updatePlayer(dt)` - 玩家逻辑（走路/攻击/技能）
- `drawPlayerSprite()` - 玩家渲染
- `updateEnemies(dt)` - 怪物逻辑
- `drawEnemies()` - 怪物渲染
- `updatePets(dt)` - 宠物逻辑
- `drawPets()` - 宠物渲染
- `playerStrike(p, target, seg)` - 玩家攻击伤害计算
- `drawFx()` - 特效渲染
- `drawHpBar(x, y, w, hp, maxHp, isEnemy)` - 血条

### 4.2 BattleAPI 接口

```javascript
window.BattleAPI = {
  start: () => {},           // 启动战斗
  stop: () => {},            // 停止战斗
  pause: () => {},           // 暂停（弹窗时调用）
  resume: () => {},          // 恢复
  pushBattleStats: (stats) => {},  // 注入玩家属性（atk/hp/def等）
  triggerSpeedSkill: (mult, duration) => {},  // 触发加速技能
  getSpeedMult: () => {},    // 获取当前倍速
  getState: () => {},        // 获取战斗状态
  // ...
};
```

### 4.3 战斗区 CSS

```css
.battle-stage {
  position: fixed;
  left: 0; right: 0;
  top: 92px;
  bottom: calc(44vh + 84px);
  z-index: 1;
  pointer-events: none !important;  /* 战斗区不拦截点击 */
  overflow: hidden;
}
```

**关键**：战斗区 `pointer-events: none`，所有子元素也必须 `pointer-events: none`，否则会挡住下面的按钮。

### 4.4 UI 图标层级

- **大图标**（宝物/丹房/技能）：`.big-icons`，`position:absolute; bottom:6px; right:10px`，在战斗区内
- **小图标**（设置/邮件/云存档/剧情）：`.small-icons`，`position:fixed; top:6px; right:8px; z-index:100`，**独立于 battle-ui**（在 battle-ui 内会因为超出父元素范围导致点击失效）

---

## 五、技能接入方式

### 5.1 技能数据

技能定义在 `game.js` 中，通过 `skVal(id)` 获取当前等级的技能数值。

```javascript
// 示例：横扫千军
{
  id: 'hengsao',
  name: '横扫千军',
  from: { chance: 3, n: 2, dmg: 40 },   // Lv1
  to: { chance: 15, n: 5, dmg: 80 },    // 满级
  fmt: '触发概率 XX% · 波及身周...'
}
```

### 5.2 技能类型

| 类型 | 触发方式 | 视觉表现 | 示例 |
|---|---|---|---|
| 普攻附加 | `playerStrike` 中判定 | 伤害数字颜色/特效 | 破甲击、斩杀 |
| 独立动画 | 攻击动画中插入帧 | sprite sheet | 剑气斩 |
| 状态效果 | 击杀后触发 | 残影/发光/速度线 | 疾风步、缩地成寸 |
| 连击 | 攻击动画多段 | 复用攻击动画 | 三连斩 |
| 特效层 | 命中时播放 | sprite sheet 特效 | 横扫千军 |

### 5.3 8 个神通技能进度

| 技能 | id | 状态 | 说明 |
|---|---|---|---|
| 剑气斩 | jianqi | ✅ 已完成 | sprite 动画，2.5倍伤害+溅射 |
| 三连斩 | sanlian | ✅ 已完成 | 普攻两段后补第三段，必会心 |
| 横扫千军 | hengsao | ✅ 已完成 | 范围特效，左右渐隐 |
| 斩杀 | zhansha | ✅ 已完成 | 残血伤害翻倍，playerStrike 中实现 |
| 疾风步 | jifeng | ✅ 已完成 | 击杀后2倍速+闪避，残影+速度线 |
| 缩地成寸 | suodi | ✅ 已完成 | 击杀后3倍速+高闪避，效果更强 |
| 破甲击 | pojia | ⏳ 进行中 | 护甲碎裂特效，等用户视频 |
| 追猎 | zhuilie | ⏳ 未做 | 击杀后立刻再出手，暴击率大增 |

---

## 六、常见问题与解决方案

### 6.1 角色左右横跳/抽搐

**原因**：走路循环首尾帧对接时，原视频走路有位移，头部 x 坐标不一致。

**解决方案**：
1. 以头部为不动点，每帧平移使头部 x 坐标一致
2. 更强的限制：头部 x 偏差超过 2px 就强制对齐
3. 统一裁剪窗口，不逐帧裁 bbox

### 6.2 角色浮空/不踩地板

**原因**：脚底 y 坐标没对齐，或者角色有脚底阴影被当成了脚底。

**解决方案**：
1. 抠图时去掉脚底阴影（不需要阴影）
2. 所有角色脚底对齐到 `floorY() = CH * 0.82`
3. 漂浮单位（BOSS）单独设置 `floatHeight`

### 6.3 技能释放时角色变大

**原因**：技能帧高（256）是玩家帧高（128）的 2 倍，代码 `drawH = 80 * (SKILL.fh / SPRITE.fh)` 错误放大。

**解决方案**：`drawH = Math.min(CH * 0.55, 80)`，和玩家一致。

### 6.4 按钮点不动

**原因**：战斗区或 UI 层 `pointer-events` 没处理好，或者小图标在 `battle-ui` 内超出父元素范围。

**解决方案**：
1. 战斗区 `pointer-events: none !important`
2. 小图标移到 body 独立层级，`z-index: 100`
3. 检查是否有透明遮罩层挡住了按钮

### 6.5 抠图后主体内部变黑/眼睛消失

**原因**：用全局颜色阈值抠图，把主体内部的纯黑（眼睛）也抠掉了。

**解决方案**：用 flood fill 从边缘开始抠图，内部黑色自然保留。

### 6.6 特效左侧/右侧有割裂感

**原因**：特效素材出屏，边缘硬切。

**解决方案**：离屏 canvas + `destination-in` + 线性渐变，左右渐现渐隐。

### 6.7 怪物空血不死

**原因**：死亡判定在伤害计算之后，但某些路径跳过了死亡判定。

**解决方案**：在 `dealDamage` 中统一处理死亡，`target.hp <= 0` 时立即触发死亡逻辑。

### 6.8 怪物跑到玩家后面

**原因**：怪物生成位置和行走线没约束好，近战/远程怪的攻击距离定义不明。

**解决方案**：
- 近战怪：走到玩家攻击距离内停下
- 远程怪：保持在远程攻击距离外
- 怪物生成在玩家右侧，向左走

---

## 七、音效接入

### 7.1 音效文件

所有音效放在 `assets/sfx/`，格式 ogg。

| 文件 | 用途 | 触发时机 |
|---|---|---|
| footstep.ogg | 玩家脚步声 | walk 第 18 帧 |
| attack1.ogg | 第一段攻击 | attack 第 8 帧 |
| attack2.ogg | 第二段攻击 | attack 第 24 帧 |
| skill_attack.ogg | 剑气斩 | 技能第 12 帧（命中） |
| hengsao.ogg | 横扫千军 | 技能触发时 |
| boss_attack.ogg | BOSS 攻击 | BOSS attack 帧 |
| slime_*.ogg | 史莱姆音效 | 脚步/攻击/受击 |
| water_*.ogg | 水精灵音效 | 脚步/攻击/受击 |

### 7.2 音效播放代码

```javascript
function playSfx(name, volume) {
  if (!G.sfx[name]) {
    G.sfx[name] = new Audio(`assets/sfx/${name}.ogg`);
  }
  G.sfx[name].volume = volume || 0.7;
  G.sfx[name].currentTime = 0;
  G.sfx[name].play().catch(() => {});
}
```

### 7.3 从视频提取音效

```bash
# 提取指定时间段的音频
ffmpeg -i input.mp4 -ss 2.7 -to 4.0 -vn -c:a libvorbis -q:a 4 output.ogg
```

---

## 八、版本号与 OTA

### 8.1 版本号统一

所有版本号在 `index.html`、`game.js`、`ota/manifest.json` 中必须一致。

修改版本号时：
1. `index.html` 中的版本显示
2. `game.js` 中的版本常量
3. `ota/manifest.json` 中的版本号
4. 运行 `tools/bump-version.py` 自动更新

### 8.2 OTA 清单

`ota/manifest.json` 列出所有需要 OTA 更新的文件。新增素材文件时必须加入清单。

**注意**：待机图标（`assets/monster_idle_icons/`）推送到仓库但**不加入 OTA 清单**，游戏代码也不引用。

---

## 九、协作规范

### 9.1 多 Agent 协作

- 推送前必须 `git pull origin main --rebase`
- 解决冲突时保留双方的修改（如另一个 agent 加了身法播报，我加了 speedBurst 特效）
- 大改动前先确认对方不在改同一区域

### 9.2 提交信息规范

```
<模块>: <具体改动>

示例：
三连斩: 普攻两段后补第三段伤害(animFrame=36), 必会心, 复用攻击动画无需特效
疾风步/缩地成寸: 触发速度爆发特效+残影+屏幕速度线+发光
```

---

## 十、工具脚本

### 10.1 build_sprite_sheet.py

完整的 sprite sheet 生成脚本，包含抽帧、抠图、对齐、排列全流程。

```bash
python3 tools/build_sprite_sheet.py \
  --input video.mp4 \
  --output assets/monster_004.webp \
  --fps 12 \
  --cols 8 \
  --walk-start 0 --walk-count 32 \
  --attack-start 32 --attack-count 40
```

### 10.2 bump-version.py

自动更新所有版本号。

```bash
python3 tools/bump-version.py 1.8.1
```

### 10.3 ota-manifest.py

生成 OTA 清单。

```bash
python3 tools/ota-manifest.py
```

---

> **最后更新**：2026-09-15
> **维护者**：AI Agent（协作开发）
