/* ============================================================
 * 洞天·墨夜 全屏背景 bg.js —— 纯 Canvas 2D（无 WebGL / 无 Three.js）
 *
 * v1.7.20 重写：替代原 Three.js 深空背景。
 *   · 移动端 WebGL 不可靠 / 低端机 GPU 压力 → 一律 Canvas 2D
 *   · 视觉收敛到 DESIGN.md「墨线手札」语言：墨色夜空 + 低饱和
 *     黛青/旧金点缀，去掉蓝紫霓虹星云；留白给 UI 墨块与 aura 层呼吸
 *
 * 可调参数集中在各常量/函数注释处：
 *   (1) 星点: STAR_MAIN_MAX / STAR_DUST_MAX / 视差分组 pace
 *   (2) 雾霭: NEB_CFG（位置/大小/色/透明度/漂移）
 *   (3) 节奏: 月呼吸、云漂、银河微移的速率常量
 * 全部程序化生成 + 离屏 sprite 缓存，无外部贴图。
 * 自适应: DPR 低端收敛、prefers-reduced-motion 静止、后台停 RAF。
 * ============================================================ */

const C = {
  paper: [233, 226, 208],   // 纸白 (DESIGN --ink)
  gold:  [201, 168, 106],   // 旧金 (DESIGN --gold)
  jade:  [134, 181, 162],   // 黛青 (DESIGN --jade)
  ink:   [52, 74, 116],     // 墨蓝(暗, 仅雾霭用)
};

/* ---------- 星点密度/视差（按屏幕面积自适应） ---------- */
const STAR_DUST_MAX = 300;   // 尘星上限(小、密、暗)
const STAR_MAIN_MAX = 150;   // 主星上限(大、稀、亮)
const STAR_DUST_PER = 11500; // 每多少 CSS px² 生成 1 尘星
const STAR_MAIN_PER = 28000;
const STAR_MINS = { dust: 64, main: 40 };   // 窄屏下限，避免空荡

/* ---------- 雾霭(替星云: 低饱和墨色, alpha 极低) ---------- */
const NEB_CFG = [
  { fx: -0.30, fy: 0.28, s: 0.72, c: [52, 74, 116],  a: 0.050, dft: [0.20, 0.14], ph: 0.0 },
  { fx:  0.34, fy: 0.62, s: 0.85, c: [48, 96, 102],  a: 0.045, dft: [0.17, 0.22], ph: 2.1 },
  { fx:  0.02, fy: 0.92, s: 0.95, c: [112, 96, 60],  a: 0.038, dft: [0.15, 0.26], ph: 4.0 },
  { fx:  0.60, fy: 0.06, s: 0.50, c: [64, 84, 122],  a: 0.040, dft: [0.22, 0.18], ph: 5.4 },
];
/* 银河: 对角微光丝带上的细小星尘 (确定性 mulberry32) */
const GALAXY_N = 150;
const GALAXY_A = 0.10;       // 单点峰值 alpha
/* 纸月(右上角; fx/fy 为 0..1 屏幕分数坐标, 与 NEB_CFG 同规) */
const MOON = { fx: 0.80, fy: 0.24, size: 0.125 };
/* 流云(极淡横带, 缓慢漂移, 制造"墨气"层次) */
const CLOUD_N = 2;
const CLOUD_SPD = [7, 13];   // 横穿周期秒数(越长越慢)

/* ---------- 通用小工具 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TAU = Math.PI * 2;

/* ---------- 离屏 sprite 缓存 ---------- */
const _sp = {};
// 柔光圆点: col=[r,g,b], hot=偏白热核心. size=画布边长
function softDot(col, hot) {
  const key = col[0] + "," + col[1] + "," + col[2] + (hot ? "|h" : "");
  if (_sp[key]) return _sp[key];
  const S = 64, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const mix = hot ? 0.82 : 0;
  const r0 = col[0] + (255 - col[0]) * mix;
  const g0 = col[1] + (250 - col[1]) * mix;
  const b0 = col[2] + (242 - col[2]) * mix;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, "rgba(" + r0 + "," + g0 + "," + b0 + ",1)");
  grd.addColorStop(0.38, "rgba(" + col[0] + "," + col[1] + "," + col[2] + ",0.55)");
  grd.addColorStop(0.72, "rgba(" + col[0] + "," + col[1] + "," + col[2] + ",0.14)");
  grd.addColorStop(1, "rgba(" + col[0] + "," + col[1] + "," + col[2] + ",0)");
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  _sp[key] = c;
  return c;
}
// 大柔光团(雾霭): 多层 radial, 边缘更自然
function softBlob(c) {
  const key = "blob" + c[0] + "," + c[1] + "," + c[2];
  if (_sp[key]) return _sp[key];
  const S = 256, cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d");
  const a0 = "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0.5)";
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2 - 2);
  grd.addColorStop(0, a0);
  grd.addColorStop(0.3, a0);
  grd.addColorStop(0.62, "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0.22)");
  grd.addColorStop(1, "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0)");
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  _sp[key] = cv;
  return cv;
}
// 流云长条: 左右渐隐的横带
function cloudStrip() {
  const key = "cloud";
  if (_sp[key]) return _sp[key];
  const W = 512, H = 128, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  const grd = g.createLinearGradient(0, 0, W, 0);
  const a = [0, 1, 1, 0];
  grd.addColorStop(0.00, "rgba(226,224,212,0)");
  grd.addColorStop(0.18, "rgba(226,224,212," + a[1] * 0.5 + ")");
  grd.addColorStop(0.55, "rgba(226,224,212,0.55)");
  grd.addColorStop(0.85, "rgba(226,224,212,0.20)");
  grd.addColorStop(1.00, "rgba(226,224,212,0)");
  g.fillStyle = grd; g.fillRect(0, H / 2 - 6, W, 12);
  // 上下轻微"墨迹"起伏(让云不是一条死直线)
  g.fillStyle = "rgba(226,224,212,0.35)";
  for (let i = 0; i < 26; i++) {
    const x = ((i * 97) % W) / W * W;
    const h = 5 + (i % 5) * 2.6;
    const yy = H / 2 + Math.sin(i * 1.7) * 9;
    g.beginPath();
    g.ellipse(x, yy, 14 + (i % 4) * 6, h, 0, 0, TAU);
    g.fill();
  }
  _sp[key] = cv;
  return cv;
}
// 纸月: 暖白月轮 + 内晕 + 外晕(旧金/纸白)
function moonSprite() {
  const key = "moon";
  if (_sp[key]) return _sp[key];
  const S = 320, c = S / 2, cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d");
  const moon = [242, 236, 218];
  // 外晕(极淡金)
  let grd = g.createRadialGradient(c, c, 0, c, c, c * 0.94);
  grd.addColorStop(0, "rgba(231,206,150,0.20)");
  grd.addColorStop(0.45, "rgba(231,206,150,0.10)");
  grd.addColorStop(0.75, "rgba(233,226,208,0.035)");
  grd.addColorStop(1, "rgba(233,226,208,0)");
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  // 内晕(纸白)
  grd = g.createRadialGradient(c, c, 0, c, c, c * 0.55);
  grd.addColorStop(0, "rgba(242,236,218,0.18)");
  grd.addColorStop(1, "rgba(242,236,218,0)");
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  // 月轮(非纯圆: 左侧略"纸边"阴影, 见 DESIGN 的不完美)
  const rr = c * 0.30;
  grd = g.createRadialGradient(c - rr * 0.1, c - rr * 0.08, rr * 0.1, c, c, rr);
  grd.addColorStop(0.00, "rgba(250,246,232,1)");
  grd.addColorStop(0.62, "rgba(242,236,218,0.98)");
  grd.addColorStop(0.88, "rgba(226,216,196,0.72)");
  grd.addColorStop(1.00, "rgba(226,216,196,0)");
  g.fillStyle = grd; g.beginPath(); g.arc(c, c, rr, 0, TAU); g.fill();
  // 月面两三点淡影(砚渍意象, 极淡)
  g.fillStyle = "rgba(190,178,150,0.16)";
  g.beginPath(); g.arc(c + rr * 0.18, c - rr * 0.22, rr * 0.16, 0, TAU); g.fill();
  g.fillStyle = "rgba(190,178,150,0.10)";
  g.beginPath(); g.arc(c - rr * 0.30, c + rr * 0.10, rr * 0.22, 0, TAU); g.fill();
  _sp[key] = cv;
  return cv;
}

/* ---------- 主入口 ---------- */
function initDeepSpace(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { destroy() {} };

  let W = 0, H = 0, dpr = 1;
  let stars = [], neb = [], moon = null;
  let t = 0, last = performance.now(), raf = 0, running = true;
  let userPaused = false;   // v1.7.60 黑屏挂机: 用户主动暂停(与 document.hidden 的暂停分开)
  /* v1.7.56 省电: 背景是极缓动画(雾霭漂移/星点闪烁), 30fps 观感无损 → 主线程占用减半 */
  let _lastPaint = 0;
  const FRAME_MS = 33;   // ≈30fps

  /* v1.7.56 省电: 背景为柔和雾霭/星点, 降分辨率观感无损 → DPR 统一上限 1.5
   * (实测 DPR 2→1.5 背景像素量减 44%, 主线程占用显著下降; 细节由立绘/UI 层保留高清) */
  function pickDPR() {
    const raw = window.devicePixelRatio || 1;
    return Math.min(raw, 1.5);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, rect.width || window.innerWidth || 1);
    H = Math.max(1, rect.height || window.innerHeight || 1);
    dpr = pickDPR();
    const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  /* 重新铺点(尺寸/预算变化时) */
  function build() {
    const area = W * H;
    const nDust = Math.max(STAR_MINS.dust, Math.min(STAR_DUST_MAX, Math.round(area / STAR_DUST_PER)));
    const nMain = Math.max(STAR_MINS.main, Math.min(STAR_MAIN_MAX, Math.round(area / STAR_MAIN_PER)));
    const rng = mulberry32(20260910);        // 每次 resize 形状稳定可复现
    stars = [];
    const push = (isMain) => {
      const r = rng();
      let col;
      if (isMain) col = r < 0.62 ? C.paper : (r < 0.86 ? C.gold : C.jade);
      else col = r < 0.70 ? C.paper : (r < 0.88 ? C.jade : C.gold);
      stars.push({
        x: rng() * W, y: rng() * H,
        zf: 0.45 + rng() * 0.55,          // 视差层
        r: isMain ? 1.1 + rng() * 1.5 : 0.55 + rng() * 0.85,
        base: (isMain ? 0.30 : 0.16) + rng() * 0.30,
        spd: 0.5 + rng() * 1.8,
        ph: rng() * TAU,
        col, hot: isMain && rng() < 0.30,
        main: isMain,
      });
    };
    for (let i = 0; i < nDust; i++) push(false);
    for (let i = 0; i < nMain; i++) push(true);
    // 雾霭(随屏宽缩放, 比例坐标存 fx/fy/s)
    neb = NEB_CFG.map((c) => ({
      cfg: c, sp: softBlob(c.c),
      x: 0, y: 0, r: 0,          // build 后每帧由 layout 换算
    }));
    // 银河带点位(确定性, 对角 -1..1)
    const gr = mulberry32(20240907);
    const gPts = [];
    for (let i = 0; i < GALAXY_N; i++) {
      const u = gr() * 2 - 1;
      const v = (gr() - 0.5) * 2;
      const fade = Math.max(0, 1 - Math.abs(v) * 1.6) * Math.max(0, 1 - Math.pow(Math.max(0, Math.abs(u) - 0.80) / 0.20, 2));
      gPts.push({
        u, v, fade,
        s: 0.5 + gr() * 1.4,
        spd: 0.3 + gr() * 0.9,
        ph: gr() * TAU,
      });
    }
    galaxy = gPts;
  }
  let galaxy = [];

  const moonCv = moonSprite();
  const cloudCv = cloudStrip();

  /* 每帧静态布局换算(雾/月位置随屏, 星云偏移由 tick 驱动) */
  function layoutNeb(ox) {
    for (const n of neb) {
      const c = n.cfg;
      n.x = (c.fx + Math.sin(t * c.dft[0] + c.ph) * 0.05) * W + ox * (1 - 0.2);
      n.y = (c.fy + Math.cos(t * c.dft[1] + c.ph * 1.7) * 0.04) * H;
      n.r = c.s * Math.max(W, H) * 0.62;
    }
  }

  function tick(now) {
    if (!running) return;
    const wait = FRAME_MS - (now - _lastPaint);
    if (wait > 4) {
      /* v2.9 PERF: 限帧期间用 setTimeout 让出主线程(原先无条件续 rAF 会按屏幕刷新率空转)。
       * 阈值 >4ms 才睡, 余量过小会退化成紧凑循环。 */
      setTimeout(() => { if (running) raf = requestAnimationFrame(tick); }, wait);
      return;
    }
    raf = requestAnimationFrame(tick);
    _lastPaint = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    const T = t;
    ctx.clearRect(0, 0, W, H);

    // 相机极缓漂移(视差): 两层反向微移
    const camX = Math.sin(T * 0.021) * 14;
    const camY = Math.sin(T * 0.013 + 1.3) * 9;
    layoutNeb(camX);

    ctx.globalCompositeOperation = "lighter";

    /* 1. 雾霭(墨色低饱和) */
    for (const n of neb) {
      const c = n.cfg;
      const br = 0.82 + 0.18 * Math.sin(T * 0.11 + c.ph * 2.7);
      ctx.globalAlpha = c.a * br;
      ctx.drawImage(n.sp, n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
    }

    /* 2. 银河(对角微光带) */
    const gx0 = W * 0.5 + camX * 0.7, gy0 = H * 0.44 + camY * 0.7;
    const gSpan = Math.hypot(W, H) * 0.62;
    const ang = -Math.PI / 4 + Math.sin(T * 0.006) * 0.02;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (const p of galaxy) {
      const tw = 0.6 + 0.4 * Math.sin(T * p.spd + p.ph);
      const a = GALAXY_A * p.fade * tw;
      if (a <= 0.004) continue;
      const rr = p.s * 2.4;
      const lx = p.u * gSpan, ly = p.v * gSpan * 0.30;
      const x = gx0 + lx * ca - ly * sa;
      const y = gy0 + lx * sa + ly * ca;
      ctx.globalAlpha = a;
      ctx.drawImage(softDot(C.paper, false), x - rr, y - rr, rr * 2, rr * 2);
    }

    /* 3. 星点(尘星 → 主星) */
    for (let pass = 0; pass < 2; pass++) {
      for (const s of stars) {
        if (s.main !== (pass === 1)) continue;
        const tw = 0.62 + 0.38 * Math.sin(T * s.spd + s.ph);
        let a = s.base * tw * (s.main ? 1 : 0.62);
        if (a <= 0.01) continue;
        let x = s.x + camX * s.zf, y = s.y + camY * s.zf;
        // wrap: 漂出屏幕的星星从对侧回来
        const m = s.r * 4;
        if (x < -m) x += W + m * 2; else if (x > W + m) x -= W + m * 2;
        if (y < -m) y += H + m * 2; else if (y > H + m) y -= H + m * 2;
        const rr = s.r * (s.main ? 2.0 : 1.25);
        ctx.globalAlpha = Math.min(0.95, a);
        ctx.drawImage(softDot(s.col, s.hot), x - rr, y - rr, rr * 2, rr * 2);
      }
    }

    /* 4. 纸月(右上) */
    const ms = MOON.size * Math.max(W, H);
    moon.x = (MOON.fx * W) + camX * 0.3;
    moon.y = (MOON.fy * H) + camY * 0.3;
    const breathe = 0.96 + 0.04 * Math.sin(T * 0.16 + 1.2);
    ctx.globalAlpha = 0.92 * breathe;
    ctx.drawImage(moonCv, moon.x - ms, moon.y - ms, ms * 2, ms * 2);

    ctx.globalCompositeOperation = "source-over";

    /* 5. 流云(极淡, 普通混合更"墨") */
    for (let i = 0; i < CLOUD_N; i++) {
      const period = CLOUD_SPD[i % CLOUD_SPD.length];
      const prog = ((T / period) + i * 0.37) % 1;
      const yBase = H * (0.16 + i * 0.34) + Math.sin(T * 0.05 + i * 2.4) * 12;
      const cw = W * 1.6;
      const x = -cw * 0.25 + prog * (cw * 1.4);
      ctx.globalAlpha = 0.05;
      ctx.drawImage(cloudCv, x, yBase - 26, cw, 52);
    }
    ctx.globalAlpha = 1;

    raf = requestAnimationFrame(tick);
  }

  function onVis() {
    if (document.hidden) {
      running = false; cancelAnimationFrame(raf);
    } else if (!running && !userPaused) {
      running = true; last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  }

  /* v1.7.60 黑屏挂机: 停掉背景动画, 省电 */
  function pause() {
    userPaused = true;
    running = false; cancelAnimationFrame(raf);
  }
  function resume() {
    if (!userPaused) return;
    userPaused = false;
    if (!document.hidden) { running = true; last = performance.now(); raf = requestAnimationFrame(tick); }
  }
  function onReduced(e) {
    if (e.matches) { staticFrame(); }
    else if (!running && !document.hidden) {          // 用户取消 reduced-motion → 恢复动画
      running = true; last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  }
  function staticFrame() {                    // prefers-reduced-motion: 只画一帧
    running = false; cancelAnimationFrame(raf);
    _lastPaint = 0;                           // 绕过限帧, 确保这一帧真的画出来
    t = 3.1415; tick(performance.now());
    running = false; cancelAnimationFrame(raf);
  }

  /* 布局对象(月) */
  moon = { x: 0, y: 0 };

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  document.addEventListener("visibilitychange", onVis);
  let rmq = null;
  try {
    rmq = matchMedia("(prefers-reduced-motion: reduce)");
    rmq.addEventListener("change", onReduced);
    if (rmq.matches) staticFrame(); else raf = requestAnimationFrame(tick);
  } catch (e) { raf = requestAnimationFrame(tick); }

  return {
    pause,
    resume,
    destroy() {
      running = false;
      userPaused = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      if (rmq) { try { rmq.removeEventListener("change", onReduced); } catch (e) {} }
      ro.disconnect();
    },
  };
}

export { initDeepSpace };
export default initDeepSpace;
