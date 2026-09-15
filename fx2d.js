/* ============================================================
 * fx2d.js —— 旋臂星点带 (Canvas 2D)
 *
 * OpenAI Astra 风格旋臂, 渲染 = 预渲染柔光贴图(无白膜/无拖尾):
 *   · 56% 柔光星点 + 34% 白热十字星芒 + 10% 大发光粒子
 *   · 3 条弧形旋臂, 8 车道宽(化神), 臂间细星尘填充
 *   · 粒子沿臂从外端向丹田缓流被吸收; 臂本体极慢公转
 * ============================================================ */

export const BIG_NAMES = ["凡人", "炼气", "筑基", "结丹", "元婴", "化神", "炼虚", "合体", "大乘", "渡劫", "真仙", "天仙"];

export const REALM_VIS = {
  "凡人": { n: 100, spin: .55, glow: 4,   size: 1.6, rw: .36,
    pal: [[255,250,242,.5],[205,182,130,.34],[255,175,90,.16]] },
  "炼气": { n: 190, spin: .75, glow: 7,   size: 1.9, rw: .44,
    pal: [[255,250,242,.44],[132,214,244,.38],[48,92,170,.18]] },
  "筑基": { n: 250, spin: .85, glow: 8,   size: 2.0, rw: .48,
    pal: [[255,250,242,.42],[104,203,192,.38],[62,136,158,.20]] },
  "结丹": { n: 320, spin: .95, glow: 10,  size: 2.1, rw: .52,
    pal: [[255,250,242,.38],[232,197,107,.32],[255,170,80,.18],[255,242,214,.12]] },
  "元婴": { n: 380, spin: 1.05, glow: 11, size: 2.2, rw: .56,
    pal: [[255,250,242,.40],[203,163,250,.32],[122,80,205,.16],[255,175,90,.12]] },
  "化神": { n: 480, spin: 1.15, glow: 12, size: 2.4, rw: .60,
    pal: [[255,250,242,.38],[96,205,252,.28],[255,222,150,.16],[255,175,90,.10],[44,96,178,.08]] },
  "炼虚": { n: 560, spin: 1.22, glow: 13, size: 2.5, rw: .63,
    pal: [[255,250,242,.40],[196,160,255,.30],[140,105,235,.16],[120,190,255,.10]] },
  "合体": { n: 650, spin: 1.29, glow: 14, size: 2.6, rw: .66,
    pal: [[255,250,242,.40],[255,150,220,.28],[196,110,200,.16],[170,140,255,.10]] },
  "大乘": { n: 740, spin: 1.36, glow: 15, size: 2.7, rw: .69,
    pal: [[255,250,242,.40],[255,196,120,.30],[232,160,80,.18],[255,230,180,.12]] },
  "渡劫": { n: 850, spin: 1.45, glow: 17, size: 2.9, rw: .71,
    pal: [[255,255,255,.46],[150,185,255,.30],[80,120,235,.16],[220,235,255,.14]] },
  "真仙": { n: 980, spin: 1.55, glow: 18, size: 3.1, rw: .73,
    pal: [[255,255,255,.48],[150,240,205,.30],[90,190,150,.16],[230,255,244,.12]] },
  "天仙": { n: 1120, spin: 1.68, glow: 21, size: 3.3, rw: .76,
    pal: [[255,255,250,.52],[255,228,150,.30],[232,197,107,.18],[255,250,235,.16],[220,230,255,.10]] },
};

/* ---- 旋臂几何常数 ---- */
const ARMS = 3;          // 旋臂条数
const WIND = 3.4;        // 每臂总扭转 ~195°(弧形, 不风车)
const ROT_K = 0.08;      // 公转系数: 实际角速度 = cfg.spin*ROT_K, 极慢
const V_IN = 0.075;      // 向心流速: 外圈到丹田约 17 秒
const S_MIN = 0.02;
const LANE_HALF = 0.88;  // 臂"半宽"(rad): 加宽一倍后 3 臂覆盖大半个盘面
const GOLD = [255, 205, 120];   // 丹田金丹统一金色

const TAU = Math.PI * 2;
/* v1.7.20 PERF-2: 低端触屏设备 DPR 收敛到 1.5(帧缓冲像素约 -44%), 桌面/高性能保留 2 */
function capFxDpr() {
  let low = false;
  try { low = matchMedia("(pointer: coarse)").matches; } catch (e) {}
  try { if (navigator.deviceMemory && navigator.deviceMemory <= 4) low = true; } catch (e) {}
  return Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2);
}
let cv = null, ctx = null;
let CW = 0, CH = 0, dpr = 1;
let cfg = null, bigNow = null;
let parts = [];
let cx = 0, cy = 0, R = 0;
let t = 0, eraT = 0, last = 0, raf = 0, resizeT = 0;   // eraT: 当前境界时长(金丹成长用)
let fxRunning = false;                                 // 可见性守卫: 后台暂停绘制(省电)
let sprites = {};
/* v2.2 省电: 粒子旋臂为缓动动画, 30fps 观感无损 → GPU负载减半, 与 bg.js 背景层同帧率 */
let _lastPaint = 0;
const FX_FRAME_MS = 33;   // ≈30fps

function curBig() {
  try {
    const c = document.getElementById("cult");
    const b = c && c.getAttribute("data-big");
    return b && BIG_NAMES.indexOf(b) >= 0 ? b : BIG_NAMES[0];
  } catch (e) { return BIG_NAMES[0]; }
}

function pickColor() {
  const pal = cfg.pal;
  const tot = pal.reduce((s, p) => s + p[3], 0);
  let v = Math.random() * tot;
  for (let i = 0; i < pal.length; i++) { v -= pal[i][3]; if (v <= 0) return pal[i]; }
  return pal[pal.length - 1];
}

/* 柔光贴图: 中心白热(hot)或纯色 → 渐变到透明(无圈边/无白膜) */
function softDot(col, hot) {
  const key = col[0] + "," + col[1] + "," + col[2] + (hot ? "|hot" : "|soft");
  if (sprites[key]) return sprites[key];
  const S = 64, cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d");
  const wb = hot ? 0.72 : 0;
  const r0 = Math.round(col[0] + (255 - col[0]) * wb);
  const g0 = Math.round(col[1] + (250 - col[1]) * wb);
  const b0 = Math.round(col[2] + (242 - col[2]) * wb);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, "rgba(" + r0 + "," + g0 + "," + b0 + ",1)");
  grd.addColorStop(0.4, "rgba(" + col[0] + "," + col[1] + "," + col[2] + ",0.45)");
  grd.addColorStop(1, "rgba(" + col[0] + "," + col[1] + "," + col[2] + ",0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  sprites[key] = cv;
  return cv;
}

function buildParticles(n) {
  const perArm = n / ARMS;
  /* 车道数随带宽与粒子预算走, 铺满加宽后的臂带 */
  const L = Math.min(20, Math.max(6, Math.round(Math.sqrt(n / ARMS))));
  const Q = Math.max(4, Math.round(n / (ARMS * L)));    // 沿臂横排数
  const arr = [];
  for (let k = 0; k < ARMS; k++) {
    for (let q = 0; q < Q; q++) {
      const s0 = S_MIN + (1 - S_MIN * 2) * (q + 0.5) / Q;
      const spd = 0.93 + Math.random() * 0.14;
      for (let i = 0; i < L; i++) {
        const lo = L === 1 ? 0 : (i / (L - 1)) * 2 - 1;
        const rr = Math.random();
        arr.push({
          arm: k, lo,
          mode: rr < 0.10 ? 'glow' : (rr < 0.44 ? 'spark' : 'dot'),
          s: s0 + (rr - 0.5) * (0.5 / Q),
          spd,
          sz: 0.75 + Math.random() * 0.6,
          col: pickColor(),
          ph: Math.random() * TAU,
          rot: Math.random() * TAU,
          mlen: 1.4 + Math.random() * 1.8,
        });
      }
    }
  }
  const dustN = Math.max(60, Math.round(n * 0.3));
  for (let i = 0; i < dustN; i++) {
    arr.push({
      arm: -1, mode: 'dust',
      a: Math.random() * TAU,
      s: 0.08 + Math.random() * 0.92,
      sz: 0.5 + Math.random() * 0.6,
      col: pickColor(),
      ph: Math.random() * TAU,
      tws: 0.6 + Math.random() * 1.4,
    });
  }
  return arr;
}

function fit() {
  if (!cv) return;
  const p = cv.parentElement;
  if (!p) return;
  const w = p.clientWidth, h = p.clientHeight;
  if (!w || !h) return;
  dpr = capFxDpr();   // v1.7.20 PERF-2: 低端收敛
  CW = w; CH = h;
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx = CW / 2;
  cy = CH * 0.56;
  R = Math.min(CW, CH) * 0.5 * cfg.rw;
}

/* v3.2 舞台驱动模式：canvas 由 60-stage 统一持有，尺寸由舞台给（逻辑像素），
 * 本层不再改 canvas.width / 不再 setTransform。 */
function fitManaged(targetCtx, w, h) {
  ctx = targetCtx;
  CW = Math.max(1, w || 1);
  CH = Math.max(1, h || 1);
  if (!cfg) cfg = REALM_VIS[curBig()] || REALM_VIS["凡人"];
  cx = CW / 2;
  cy = CH * 0.56;
  R = Math.min(CW, CH) * 0.5 * cfg.rw;
}

function applyRealm(recreate) {
  cfg = REALM_VIS[curBig()] || REALM_VIS["凡人"];
  eraT = 0;                                  // 每次换境界金丹重新"凝聚长大"
  if (recreate) {
    parts = buildParticles(cfg.n);
    R = Math.min(CW, CH) * 0.5 * cfg.rw;
    if (ctx) ctx.clearRect(0, 0, CW, CH);
  }
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
  if (b !== bigNow) { bigNow = b; applyRealm(true); }
  t += dt;
  eraT += dt;
  draw(dt);
}

/* v3.2 舞台驱动：不含调度，由 60-stage 按统一 30fps 调用。
 * ⚠️ dt 是【原始 dt】，本层不吃身法倍速。 */
function renderFrame(dt) {
  if (!ctx || CW < 4) return;
  const b = curBig();
  if (b !== bigNow) { bigNow = b; applyRealm(true); }
  t += dt;
  eraT += dt;
  draw(dt);
}

/* 白热十字星芒: 柔光核心 + 4 轴细芒 */
function starBurst(x, y, size, col, alpha, rot, len) {
  ctx.globalAlpha = alpha;
  ctx.drawImage(softDot(col, true), x - size, y - size, size * 2, size * 2);
  ctx.globalAlpha = alpha * 0.6;
  ctx.strokeStyle = "rgba(255,252,244,1)";
  ctx.lineWidth = Math.max(0.6, size * 0.14);
  ctx.beginPath();
  for (let d = 0; d < 4; d++) {
    const a = rot + d * Math.PI / 2;
    ctx.moveTo(x - Math.cos(a) * len, y - Math.sin(a) * len);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
  }
  ctx.stroke();
}

function draw(dt) {
  ctx.clearRect(0, 0, CW, CH);
  ctx.globalCompositeOperation = "lighter";

  const sc = Math.min(1.3, Math.max(0.8, CW / 430));
  const rot = t * cfg.spin * ROT_K;

  /* 金丹(统一金色): 换境界后 5 秒内从约一半缓缓凝聚到上限 0.20R, 之后恒定 */
  const grow = Math.min(1, eraT / 5);
  const coreR = R * 0.20 * (0.55 + 0.45 * grow);
  const gg = GOLD;
  const g1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  g1.addColorStop(0, "rgba(" + gg[0] + "," + gg[1] + "," + gg[2] + ",0.68)");
  g1.addColorStop(0.3, "rgba(" + gg[0] + "," + gg[1] + "," + gg[2] + ",0.30)");
  g1.addColorStop(1, "rgba(255,190,110,0)");
  ctx.fillStyle = g1;
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, TAU); ctx.fill();
  /* 金丹最中心一点白热(凝实感) */
  const r2 = coreR * 0.5;
  const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r2);
  g2.addColorStop(0, "rgba(255,240,200,0.9)");
  g2.addColorStop(1, "rgba(255,240,200,0)");
  ctx.fillStyle = g2;
  ctx.beginPath(); ctx.arc(cx, cy, r2, 0, TAU); ctx.fill();

  const stepA = TAU / ARMS;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const fall = 0.30 + 0.70 * p.s;
    const rad = p.s * R;

    if (p.mode === 'dust') {
      p.a += dt * cfg.spin * ROT_K * 0.35;
      const x = cx + Math.cos(p.a) * rad;
      const y = cy + Math.sin(p.a) * rad * 0.94;
      const tw = 0.55 + 0.45 * Math.sin(t * p.tws + p.ph);
      const r = cfg.size * p.sz * fall * sc * 0.42;
      ctx.globalAlpha = 0.30 * tw;
      ctx.drawImage(softDot(p.col), x - r, y - r, r * 2, r * 2);
      continue;
    }

    p.s -= dt * V_IN * p.spd * (0.55 + 0.45 * p.s);
    if (p.s < S_MIN) {
      p.s = 1.0;
      p.col = pickColor();
      continue;
    }
    const th = p.arm * stepA + WIND * (1 - p.s) + rot
               + p.lo * LANE_HALF * Math.max(p.s, 0.5);
    const x = cx + Math.cos(th) * rad;
    const y = cy + Math.sin(th) * rad * 0.94;

    const tw = 0.78 + 0.22 * Math.sin(t * 2.0 + p.ph * 3);
    const base = cfg.size * p.sz * fall * sc;
    const fIn = Math.min(1, (1 - p.s) / 0.07);
    const fOut = Math.min(1, (p.s - S_MIN) / 0.14);
    const fade = fIn < fOut ? fIn : fOut;
    const a = tw * fade;

    if (p.mode === 'glow') {
      const r = base * 1.7;
      ctx.globalAlpha = 0.9 * a;
      ctx.drawImage(softDot(p.col, true), x - r, y - r, r * 2, r * 2);
    } else if (p.mode === 'spark') {
      starBurst(x, y, base * 0.9, p.col, 0.95 * a, p.rot, base * p.mlen);
    } else {
      const r = base * 0.55;
      ctx.globalAlpha = 0.62 * a;
      ctx.drawImage(softDot(p.col), x - r, y - r, r * 2, r * 2);
    }
  }
  ctx.globalAlpha = 1;
}

export function initFx(canvas) {
  cv = canvas;
  cfg = REALM_VIS[curBig()] || REALM_VIS["凡人"];
  bigNow = curBig();
  fit();
  if (!ctx) return;
  applyRealm(true);
  last = performance.now();
  cancelAnimationFrame(raf);
  fxRunning = true;
  raf = requestAnimationFrame(loop);
  document.addEventListener("visibilitychange", onVisFx);
}

/* v3.2 舞台驱动版入口：返回 60-stage 契约对象 { name, draw, resize }。
 * 本层不再自持 rAF、不再监听 visibilitychange（舞台统一处理）、
 * 不再监听 fx-suspend / fx-resume（舞台统一暂停整条链）。 */
export function createFxLayer() {
  bigNow = curBig();
  cfg = REALM_VIS[bigNow] || REALM_VIS["凡人"];
  parts = buildParticles(cfg.n);
  t = 0; eraT = 0;
  return {
    name: "fx2d",
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
