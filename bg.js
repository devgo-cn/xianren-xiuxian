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
/* 纸月(右上角; fx/fy 为 0..1 屏幕分数坐标, 与 NEB_CFG 同规)
 * v3.3: fy 从 0.24 上移到 0.135。
 *   原因：v3.2 起战斗层是一条固定横带（top=92, height=0.56*vh-176），
 *   它会在自己的区域内铺不透明底色。fy=0.24 在 860 高屏上 ≈ y207，
 *   正好落进横带 —— 月亮被战斗区底色压住，观感上就是"月亮没了"。
 *   上移到 0.135 后，月亮稳定待在**横带之上**的纯净夜空里（也避开顶部 HUD），
 *   这才是"右上角挂一盏月亮"该在的位置。
 * size 相应放大到 0.15：月亮本体 = 2*ms*rr/S ≈ 0.15*max(W,H)*0.80，
 *   在 860 高屏上直径约 103px，清晰但不喧宾夺主。 */
const MOON = { fx: 0.80, fy: 0.135, size: 0.15 };
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
/* 纸月: 暖白月轮 + 内晕 + 外晕(旧金/纸白)
 *
 * v3.3 修正：月轮本身做"实"而不是靠混合模式推亮。
 *   背景是墨夜星空（很暗），一旦用 screen/lighter 去"提亮"，
 *   月轮就会跟它自己的外晕糊成一片白斑，轮缘反而消失。
 *   正解是 sprite 里就把轮体画成不透明实心（alpha 1.0）、
 *   外晕压到极淡作为真·光环 —— 之后无论用什么混合模式，轮体都是实心的。 */
function moonSprite() {
  const key = "moon";
  if (_sp[key]) return _sp[key];
  const S = 320, c = S / 2, cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d");
  /* 外晕(极淡金) —— 收窄、压淡，让它只是"光环" */
  let grd = g.createRadialGradient(c, c, 0, c, c, c * 0.90);
  grd.addColorStop(0, "rgba(226,206,164,0.14)");
  grd.addColorStop(0.40, "rgba(228,212,178,0.065)");
  grd.addColorStop(0.74, "rgba(233,226,208,0.022)");
  grd.addColorStop(1, "rgba(233,226,208,0)");
  g.fillStyle = grd; g.fillRect(0, 0, S, S);

  /* 月轮 —— 实心、不透明；外缘只留 3% 做 1 像素级柔和收边（防锯齿）
   * rr = c*0.40：sprite 会被拉到 2*ms，月轮在屏上占 2*ms*0.40 ≈ 0.8*ms，
   * 即"月亮本体比它的光晕小一圈"，这才是月亮该有的比例。 */
  const rr = c * 0.40;
  grd = g.createRadialGradient(c - rr * 0.12, c - rr * 0.10, rr * 0.06, c, c, rr);
  grd.addColorStop(0.00, "rgba(255,253,247,1)");
  grd.addColorStop(0.42, "rgba(250,246,234,1)");
  grd.addColorStop(0.80, "rgba(243,237,220,1)");
  grd.addColorStop(0.97, "rgba(234,225,204,1)");
  grd.addColorStop(1.00, "rgba(232,222,200,0)");
  g.fillStyle = grd; g.beginPath(); g.arc(c, c, rr, 0, TAU); g.fill();

  /* 月面两三点淡影(砚渍意象, 极淡) */
  g.fillStyle = "rgba(186,174,148,0.15)";
  g.beginPath(); g.arc(c + rr * 0.20, c - rr * 0.24, rr * 0.17, 0, TAU); g.fill();
  g.fillStyle = "rgba(186,174,148,0.09)";
  g.beginPath(); g.arc(c - rr * 0.32, c + rr * 0.12, rr * 0.23, 0, TAU); g.fill();
  _sp[key] = cv;
  return cv;
}

/* ---------- 主入口 ----------
 *
 * v3.2 起背景【不再自持 rAF 循环】，改为暴露 draw() 由统一舞台层驱动。
 * 原因见 src/60-stage.js 文件头：4 张独立 canvas 叠在一起 = 4 份调度 + 4 次全屏合成，
 * 是手机发烫的首要单点。合并后本层只提供"给定 ctx / 尺寸 / dt，画一帧"。
 *
 * 兼容期保留：不传 opts 时按老方式自持 rAF（供单独调试页使用）。
 */
function initDeepSpace(canvas, opts) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { destroy() {} };
  /* opts.managed === true → 由 60-stage 驱动：不自持 rAF、不管 visibility、不改 canvas 尺寸 */
  const managed = !!(opts && opts.managed);

  let W = 0, H = 0, dpr = 1;
  let stars = [], neb = [], moon = null;
  let t = 0, last = performance.now(), raf = 0, running = !managed, _sleepT = 0;
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

  /* managed 模式下尺寸由舞台层给（W/H 是逻辑像素），本层不碰 canvas.width，
   * 也不 setTransform —— 舞台已设好统一变换，重复设置会叠乘。 */
  function resize(nw, nh) {
    if (managed) {
      W = Math.max(1, nw || canvas.clientWidth || window.innerWidth || 1);
      H = Math.max(1, nh || canvas.clientHeight || window.innerHeight || 1);
      dpr = 1;
      build();
      return;
    }
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

  /* 画一帧（不含调度）：由统一舞台层调用，或由独立 tick 调用。
   * ⚠️ dt 是【原始 dt】，本层不吃身法倍速。 */
  function renderFrame(dt) {
    t += dt;
    const T = t;
    draw(T);
  }

  /* 纯绘制：给定时间点 T，把整层画到 ctx。
   * 与调度、dt 完全解耦 —— renderFrame 与 staticFrame 都走这里。 */
  function draw(T) {
    const g = ctx;
    g.clearRect(0, 0, W, H);

    // 相机极缓漂移(视差): 两层反向微移
    const camX = Math.sin(T * 0.021) * 14;
    const camY = Math.sin(T * 0.013 + 1.3) * 9;
    layoutNeb(camX);

    g.globalCompositeOperation = "lighter";

    /* 1. 雾霭(墨色低饱和) */
    for (const n of neb) {
      const c = n.cfg;
      const br = 0.82 + 0.18 * Math.sin(T * 0.11 + c.ph * 2.7);
      g.globalAlpha = c.a * br;
      g.drawImage(n.sp, n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
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
      g.globalAlpha = a;
      g.drawImage(softDot(C.paper, false), x - rr, y - rr, rr * 2, rr * 2);
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
        g.globalAlpha = Math.min(0.95, a);
        g.drawImage(softDot(s.col, s.hot), x - rr, y - rr, rr * 2, rr * 2);
      }
    }

    /* 4. 纸月(右上) */
    const ms = MOON.size * Math.max(W, H);
    moon.x = (MOON.fx * W) + camX * 0.3;
    moon.y = (MOON.fy * H) + camY * 0.3;
    const breathe = 0.97 + 0.03 * Math.sin(T * 0.16 + 1.2);
    /* v3.3: 改回 source-over（普通混合）。
     *   月轮 sprite 本身已经是【不透明实心 + 极淡外晕】，这正是月亮该有的样子 ——
     *   不需要任何混合模式帮忙"提亮"。
     *   screen 会把轮体与背景一起 `1-(1-a)(1-b)` 推白、轮缘消失（v3.2 实测变成一团
     *   灰白云雾）；lighter 更糟（直接曝掉）。普通混合保留 sprite 原样，
     *   轮体就是实心的暖白盘，外晕叠在夜空中自然衰减。
     *   呼吸只动 alpha 0.97~1.0，不动机位 —— 月亮不该"闪"。 */
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = breathe;
    g.drawImage(moonCv, moon.x - ms, moon.y - ms, ms * 2, ms * 2);
    g.globalAlpha = 1;

    /* 5. 流云(极淡, 普通混合更"墨") */
    for (let i = 0; i < CLOUD_N; i++) {
      const period = CLOUD_SPD[i % CLOUD_SPD.length];
      const prog = ((T / period) + i * 0.37) % 1;
      const yBase = H * (0.16 + i * 0.34) + Math.sin(T * 0.05 + i * 2.4) * 12;
      const cw = W * 1.6;
      const x = -cw * 0.25 + prog * (cw * 1.4);
      g.globalAlpha = 0.05;
      g.drawImage(cloudCv, x, yBase - 26, cw, 52);
    }
    g.globalAlpha = 1;
  }

  /* ---- 独立运行模式（managed=false）的调度：仅调试页使用 ---- */
  function tick(now) {
    if (!running) return;
    const wait = FRAME_MS - (now - _lastPaint);
    if (wait > 4) { _sleepT = setTimeout(() => { _sleepT = 0; if (running) raf = requestAnimationFrame(tick); }, wait); return; }
    raf = requestAnimationFrame(tick);
    _lastPaint = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    renderFrame(dt);
  }
  function onVis() {
    if (managed) return;
    if (document.hidden) {
      running = false; cancelAnimationFrame(raf);
    } else if (!running && !userPaused) {
      running = true; last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  }
  function pause() {
    if (managed) return;          // 统一舞台层负责暂停
    userPaused = true;
    running = false; cancelAnimationFrame(raf);
  }
  function resume() {
    if (managed || !userPaused) return;
    userPaused = false;
    if (!document.hidden) { running = true; last = performance.now(); raf = requestAnimationFrame(tick); }
  }
  function onReduced(e) {
    if (managed) return;
    if (e.matches) { staticFrame(); }
    else if (!running && !document.hidden) {
      running = true; last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  }
  function staticFrame() {                    // prefers-reduced-motion: 只画一帧
    running = false; cancelAnimationFrame(raf);
    _lastPaint = 0;
    t = 3.1415; draw(t);
  }

  /* 布局对象(月) */
  moon = { x: 0, y: 0 };

  if (managed) {
    /* 舞台驱动：尺寸由舞台给，不自持 rAF */
    resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
    return {
      name: "bg",
      resize,
      /* 舞台层契约：draw(ctx, W, H, dt, now) */
      draw(_ctx, _W, _H, dt) { renderFrame(dt); },
      /* 供调试/截图：按指定时间点画一帧，不推进内部时钟 */
      staticFrame() { staticFrame(); },
      pause() {}, resume() {},
      destroy() {},
    };
  }

  resize();
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  document.addEventListener("visibilitychange", onVis);
  let rmq = null;
  try {
    rmq = matchMedia("(prefers-reduced-motion: reduce)");
    rmq.addEventListener("change", onReduced);
    if (rmq.matches) staticFrame(); else raf = requestAnimationFrame(tick);
  } catch (e) { raf = requestAnimationFrame(tick); }

  return {
    name: "bg",
    resize: () => resize(),
    draw(_ctx, _W, _H, dt) { renderFrame(dt); },
    staticFrame,
    pause,
    resume,
    destroy() {
      running = false;
      userPaused = false;
      cancelAnimationFrame(raf);
      if (_sleepT) { clearTimeout(_sleepT); _sleepT = 0; }
      document.removeEventListener("visibilitychange", onVis);
      if (rmq) { try { rmq.removeEventListener("change", onReduced); } catch (e) {} }
      ro.disconnect();
    },
  };
}

export { initDeepSpace };
export default initDeepSpace;
