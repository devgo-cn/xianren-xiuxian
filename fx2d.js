/* ============================================================
 * fx2d.js —— 丹田光华 (Canvas 2D)
 *
 * v3.3：旋臂星点带整条移除。
 *   用户实测反馈：「漩涡🌀现在看不到效果了，但我发现没有它更好看一点……
 *   保留它的中心点，有一个发光的中心点，就是他的丹田，那个可以调出来。」
 *
 *   于是本层只保留【丹田金丹】这一件事：
 *     · 外圈大柔和光晕（按境界换色，slow breathe）
 *     · 内圈轮缘（凝实感，微微加速呼吸，与外壳相位错开）
 *     · 最中心一点白热
 *   旋臂粒子（buildParticles / starBurst / softDot 星点 / dust 星尘）全部删除，
 *   REALM_VIS 的 n / spin / size / rw / pal 也不再需要 —— 只留每个境界的
 *   【丹田颜色】，颜色取自原先 pal 的第一顺位亮色，保证换境界时观感连续。
 * ============================================================ */

export const BIG_NAMES = ["凡人", "炼气", "筑基", "结丹", "元婴", "化神", "炼虚", "合体", "大乘", "渡劫", "真仙", "天仙"];

/* 每个境界的丹田色： [外晕RGB, 内轮RGB]
 * 取色沿用 v3.2 旋臂调的 pal[0]（亮色）与 pal[1]（本命色），只把 gamma 提到主色位。
 * 这样从凡人到天仙，丹田会依次是：暖白 → 冰蓝 → 青碧 → 金 → 紫 → 天青 →
 * 紫罗兰 → 品红 → 橙金 → 亮蓝 → 翠绿 → 金白，一条看得出来的成长线。 */
export const REALM_VIS = {
  "凡人": { outer: [255, 236, 200], core: [255, 214, 150] },
  "炼气": { outer: [180, 224, 250], core: [110, 190, 240] },
  "筑基": { outer: [180, 240, 226], core: [ 96, 214, 190] },
  "结丹": { outer: [255, 240, 190], core: [236, 199, 108] },
  "元婴": { outer: [226, 208, 255], core: [186, 150, 248] },
  "化神": { outer: [196, 234, 255], core: [ 96, 205, 252] },
  "炼虚": { outer: [222, 206, 255], core: [176, 140, 250] },
  "合体": { outer: [255, 208, 240], core: [248, 140, 214] },
  "大乘": { outer: [255, 232, 196], core: [255, 178,  92] },
  "渡劫": { outer: [222, 236, 255], core: [150, 185, 255] },
  "真仙": { outer: [204, 255, 234], core: [146, 240, 200] },
  "天仙": { outer: [255, 250, 216], core: [255, 224, 140] },
};

/* 丹田几何：相对【角色框高度】的半径比。
 * v3.3: 为什么用高度而不是宽度 —— 角色框宽高比 ≈ 825:835（近正方），
 * 但真正决定"人物多大"的是高度（height:min(44vh,350px)，随视口变）。
 * 以高为基准，丹田在任何屏幕上都稳定是人物高度的固定比例，不会忽大忽小。
 *
 * CORE_K = 0.030 → 350px 高的角色框上，丹体半径 ≈ 10.5px、直径 ≈ 21px。
 *   这是"丹田"该有的存在感：一眼能看见，但不至于变成一颗大灯泡。
 * HALO_K = 0.075 → 外晕半径 ≈ 26px。
 *   ⚠️ 不要贪大：外晕是"托住丹体"的，半径一大、alpha 一高，
 *   整块区域就被抬成一片平光，反而看不出中间有颗丹田（实测 alpha 0.26 时
 *   剖面 -50..+50 全是 218~229，完全糊平）。
 *   收窄到 0.075 且中心 alpha 压到 0.16，才能保住"中间亮、四周暗"的单峰。 */
const CORE_K = 0.030;    // 丹体半径 / 角色框高
const HALO_K = 0.075;    // 外晕半径 / 角色框高

let cv = null, ctx = null;
let CW = 0, CH = 0, dpr = 1;
let cfg = null, bigNow = null;
let cx = 0, cy = 0, R = 1;   // R = 角色框高度，由 resolveAnchor() 每帧刷新
let t = 0, eraT = 0, last = 0, raf = 0, resizeT = 0;
let fxRunning = false;
let _lastPaint = 0;
const FX_FRAME_MS = 33;   // ≈30fps

function curBig() {
  try {
    const c = document.getElementById("cult");
    const b = c && c.getAttribute("data-big");
    return b && BIG_NAMES.indexOf(b) >= 0 ? b : BIG_NAMES[0];
  } catch (e) { return BIG_NAMES[0]; }
}

/* ── 丹田锚点解析 ─────────────────────────────────────────────────
 * 丹田必须长在角色身上，不能是固定屏幕比例。
 *
 * 两种驱动方式，锚点算法不同：
 *   A. overlay 模式（主路径）：调用方给的就是一张【贴合角色框】的画布，
 *      所以本层坐标系原点 = 角色框左上角。丹田位置直接取
 *          (W/2, H*0.40)   —— 水平居中、垂直 40%（胸腔→下腹之间）
 *      尺寸基准 R = H（角色框高）。完全不碰 DOM，零重排。
 *   B. 独立模式（initFx）：画布是整屏的，此时才需要去 DOM 里量角色框。
 * 用 _overlayMode 区分：overlay 模式由 fitManaged 之后置位。 */
let _overlayMode = false;

function resolveAnchor() {
  if (_overlayMode) {
    /* A. 画布已经是角色框本身 */
    cx = CW * 0.5;
    cy = CH * 0.40;
    R = CH;
    return;
  }
  /* B. 整屏画布：去量角色框 */
  try {
    const el = document.querySelector("#cult .bodyL") || document.getElementById("cult");
    if (el) {
      const b = el.getBoundingClientRect();
      if (b.width > 8 && b.height > 8) {
        cx = b.x + b.width * 0.5;
        cy = b.y + b.height * 0.40;
        R = b.height;
        return;
      }
    }
  } catch (e) { /* 落到下面的兜底 */ }
  cx = CW * 0.5;
  cy = CH * 0.72;
  R = Math.min(CW, CH) * 0.5;
}

/* 由 40-app.js 的 overlay 宿主显式打开 overlay 模式 */
export function setOverlayMode(on) { _overlayMode = !!on; }

function capFxDpr() {
  let low = false;
  try { low = matchMedia("(pointer: coarse)").matches; } catch (e) {}
  try { if (navigator.deviceMemory && navigator.deviceMemory <= 4) low = true; } catch (e) {}
  return Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2);
}

function fit() {
  if (!cv) return;
  const p = cv.parentElement;
  if (!p) return;
  const w = p.clientWidth, h = p.clientHeight;
  if (!w || !h) return;
  dpr = capFxDpr();
  CW = w; CH = h;
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  resolveAnchor();
}

/* v3.2 舞台驱动模式：canvas 由 60-stage 统一持有，尺寸由舞台给（逻辑像素），
 * 本层不再改 canvas.width / 不再 setTransform。 */
function fitManaged(targetCtx, w, h) {
  ctx = targetCtx;
  CW = Math.max(1, w || 1);
  CH = Math.max(1, h || 1);
  if (!cfg) cfg = REALM_VIS[curBig()] || REALM_VIS["凡人"];
  resolveAnchor();
}

function applyRealm() {
  cfg = REALM_VIS[curBig()] || REALM_VIS["凡人"];
  eraT = 0;                                  // 每次换境界丹田重新"凝聚长大"
}

/* ── 丹田绘制 ─────────────────────────────────────────────────────
 * 纯叠加发光：三层同心径向渐变，全部用 'lighter'。
 * 这里用 lighter 是安全的 —— 三层是【同心圆】、不是四个散开的大光团，
 * 叠加只让中心更亮，不会像 v3.2 旋臂层那样在大面积上泛色。
 * 本层不吃身法倍速（呼吸是纯视觉，不该被 ×2 加速）。 */
function draw(dt) {
  resolveAnchor();   /* 每帧贴回角色身上（角色会随视口/呼吸微动） */
  ctx.globalCompositeOperation = "lighter";
  /* 换境界后 5 秒内从 55% 缓缓凝聚到 100% —— 保留原金丹的"成长"手感 */
  const grow = Math.min(1, eraT / 5);
  const coreR = R * CORE_K * (0.55 + 0.45 * grow);
  const oc = cfg.outer, cc = cfg.core;

  /* 1. 外圈柔光晕：慢呼吸，相位 0。刻意压淡 —— 它的职责是"托住"丹体，
   *    不是自己发光。alpha 一高整块就糊成平光，单峰就没了。 */
  const haloR = R * HALO_K * (0.94 + 0.06 * Math.sin(t * 0.55));
  const g0 = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  g0.addColorStop(0.00, `rgba(${oc[0]},${oc[1]},${oc[2]},0.16)`);
  g0.addColorStop(0.40, `rgba(${oc[0]},${oc[1]},${oc[2]},0.065)`);
  g0.addColorStop(0.75, `rgba(${cc[0]},${cc[1]},${cc[2]},0.022)`);
  g0.addColorStop(1.00, `rgba(${cc[0]},${cc[1]},${cc[2]},0)`);
  ctx.fillStyle = g0;
  ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, Math.PI * 2); ctx.fill();

  /* 2. 丹体：凝实的轮缘，呼吸比外晕快一档、相位错开 1.1，避免"整团一起胀"。
   *    半径收在 coreR 内，保证亮度集中、外缘快速衰减。 */
  const bodyR = coreR * (0.96 + 0.10 * Math.sin(t * 0.9 + 1.1));
  const g1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, bodyR);
  g1.addColorStop(0.00, `rgba(${cc[0]},${cc[1]},${cc[2]},0.70)`);
  g1.addColorStop(0.30, `rgba(${cc[0]},${cc[1]},${cc[2]},0.34)`);
  g1.addColorStop(0.62, `rgba(${cc[0]},${cc[1]},${cc[2]},0.10)`);
  g1.addColorStop(0.85, `rgba(${oc[0]},${oc[1]},${oc[2]},0.028)`);
  g1.addColorStop(1.00, `rgba(${oc[0]},${oc[1]},${oc[2]},0)`);
  ctx.fillStyle = g1;
  ctx.beginPath(); ctx.arc(cx, cy, bodyR, 0, Math.PI * 2); ctx.fill();

  /* 3. 最中心一点白热（凝实感）—— 原旋臂层的核心保留项 */
  const r2 = bodyR * 0.46;
  const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r2);
  g2.addColorStop(0, "rgba(255,244,214,0.86)");
  g2.addColorStop(0.45, "rgba(255,238,198,0.30)");
  g2.addColorStop(1, "rgba(255,238,198,0)");
  ctx.fillStyle = g2;
  ctx.beginPath(); ctx.arc(cx, cy, r2, 0, Math.PI * 2); ctx.fill();

  ctx.globalCompositeOperation = "source-over";
}

function loop(now) {
  if (!fxRunning) return;                              // 后台不续帧
  const wait = FX_FRAME_MS - (now - _lastPaint);
  if (wait > 4) {
    /* v2.9 PERF: 限帧期间用 setTimeout 让出主线程(原先无条件续 rAF 会按屏幕刷新率空转)。
     * 阈值 >4ms 才睡, 余量过小会退化成紧凑循环。 */
    setTimeout(() => { if (fxRunning) raf = requestAnimationFrame(loop); }, wait);
    return;
  }
  raf = requestAnimationFrame(loop);
  _lastPaint = now;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (dt <= 0) return;
  if (now - resizeT > 500) {
    resizeT = now;
    const p = cv && cv.parentElement;
    if (p) {
      const w = p.clientWidth, h = p.clientHeight;
      if (w && h && (w !== CW || h !== CH)) fit();
    }
  }
  if (!ctx || CW < 4) return;
  const b = curBig();
  if (b !== bigNow) { bigNow = b; applyRealm(); }
  t += dt;
  eraT += dt;
  draw(dt);
}

/* v3.2 舞台驱动：不含调度，由 60-stage 按统一 30fps 调用。
 * ⚠️ dt 是【原始 dt】，本层不吃身法倍速。 */
function renderFrame(dt) {
  if (!ctx || CW < 4) return;
  const b = curBig();
  if (b !== bigNow) { bigNow = b; applyRealm(); }
  t += dt;
  eraT += dt;
  draw(dt);
}

export function initFx(canvas) {
  cv = canvas;
  cfg = REALM_VIS[curBig()] || REALM_VIS["凡人"];
  bigNow = curBig();
  fit();
  if (!ctx) return;
  applyRealm();
  last = performance.now();
  cancelAnimationFrame(raf);
  fxRunning = true;
  raf = requestAnimationFrame(loop);
  document.addEventListener("visibilitychange", onVisFx);
}

/* v3.2 舞台驱动版入口：返回 60-stage 契约对象 { name, draw, resize }。
 * 本层不再自持 rAF、不再监听 visibilitychange（舞台统一处理）、
 * 不再监听 fx-suspend / fx-resume（舞台统一暂停整条链）。
 *
 * v3.3: 层名从 "fx2d" 改为 "dantian" —— 它现在只画丹田，名字要跟内容一致。 */
export function createFxLayer() {
  bigNow = curBig();
  cfg = REALM_VIS[bigNow] || REALM_VIS["凡人"];
  t = 0; eraT = 0;
  return {
    name: "dantian",
    resize(_W, _H) { /* 真实尺寸在首帧 draw 时由舞台注入，见下 */ },
    draw(targetCtx, W, H, dt) {
      if (CW !== W || CH !== H || ctx !== targetCtx) fitManaged(targetCtx, W, H);
      renderFrame(dt);
    },
  };
}

function onVisFx() {
  if (document.hidden) { fxRunning = false; cancelAnimationFrame(raf); }
  else if (!fxRunning) { fxRunning = true; last = performance.now(); raf = requestAnimationFrame(loop); }
}
/* v2.6 省电: 黑屏挂机(body.dimmed)时主页被盖住, 由 game.js enterDim/exitDim 派发事件停/启 rAF
 * (visibilitychange 只管页面切走, 管不了页内黑屏场景)
 * v3.2: 仅独立模式需要；舞台模式下由 60-stage 统一 pause/resume。 */
document.addEventListener("fx-suspend", () => {
  if (fxRunning) { fxRunning = false; cancelAnimationFrame(raf); }
});
document.addEventListener("fx-resume", () => {
  if (!fxRunning && !document.hidden) { fxRunning = true; last = performance.now(); raf = requestAnimationFrame(loop); }
});

