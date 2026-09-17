/**
 * 舞台合成层（v3.2）—— 把原先 4 张独立 canvas 合并为 1 张
 *
 * ── 为什么合并 ────────────────────────────────────────────────────────
 * v3.1 之前有 4 张各自独立的 canvas，各自跑一个 requestAnimationFrame 循环：
 *
 *   #bg            全屏 0.36 MPx   ~24fps   背景（雾霭/星点/银河/纸月/流云）
 *   #aura          全屏 0.36 MPx   ~18fps   灵气粒子，且带 mix-blend-mode:screen
 *   #battleCanvas  条带 0.13 MPx   ~24fps   战斗（裁剪到 battle-stage 横带）
 *   #burst         全屏 0.36 MPx   ~22fps   点击/渡劫爆发粒子
 *   ─────────────────────────────────────────────────────────────────
 *   合计           1.21 MPx/帧   4 份调度   4 次全屏合成（aura 还需独立合成通道）
 *
 * 实测（420x860，自然战斗）：峰值图元 405、均值 341；四层刷新率相位不齐。
 * 合成层数与填充率是手机发烫的首要单点 —— 四张全屏位图叠在一起，
 * 浏览器合成器每帧要做 4 次全屏混合，`mix-blend-mode:screen` 更会强制
 * aura 走独立合成通道（无法并入轻量合成路径）。
 *
 * 合并后：1 张全屏 canvas、1 个 ticker、1 次合成，混合在绘制期用
 * globalCompositeOperation 完成。像素量 1.21 → 0.36 MPx。
 *
 * ── 铁律：ticker 只管"何时调用"，不管"传什么 dt" ──────────────────────
 * 每一层自己算自己的 dt。ticker 一律传【原始 dt】。
 *
 * 这条规则的存在意义是【倍速不泄漏】：
 * 战斗层的「疾风步 / 缩地成寸」会让战斗实体按 dt×speedMult 推进，
 * 该乘法必须留在 50-battle.js 的 update() 内部（那里第一行就是
 * `const sdt = dt * G.speedMult`）。若把它提到 ticker 里统一乘，
 * 背景 / 灵气 / 爆发粒子就会跟着一起加速 —— 那是错误的。
 *
 * 同理，战斗层内部这些【刻意不吃倍速】的量也必须保持不变：
 *   · _pushT   每 5s 拉取一次玩家属性（用原始 dt）
 *   · skillCall 技能名播报节奏（用原始 dt，注释写明"不吃身法倍速"）
 * 它们都在 update() 里用原始 dt，故不受 ticker 合并影响。
 *
 * ── 绘制顺序（由代码保证，不再依赖 z-index）──────────────────────────
 *   1. bg       背景
 *   2. battle   战斗（clip 到横带）
 *   3. aura     灵气（加法混合）
 *   4. burst    爆发粒子（加法混合，最上）
 *
 * 原 z-index 是 bg=0 / battle=1 / aura=3 / burst=30 —— aura 在战斗之上。
 * 这里保持同样顺序。
 */
let _cv = null, _ctx = null;
let _W = 0, _H = 0, _dpr = 1;
let _raf = 0, _last = 0, _lastPaint = 0, _sleepT = 0;
let _running = false;
let _layers = [];          // [{ name, draw(ctx, W, H, dt, now) }]
let _paused = false;
/* 诊断钩子：非空时每层绘制前调用 _diag(name, dt)。验收脚本用它取证。 */
let _diag = null;

/* v6.9 PERF: 30fps → 24fps。素材 walk/attack 都是 24fps, 30fps 每帧多画 25% 纯浪费。 */
const FRAME_MS = 42;   // ≈24fps

/* DPR 封顶 1.5：合并前 bg/fx2d 是 1.5、战斗也是 1.5，aura 用 capDeviceDpr()。
 * 合并后统一 1.5 —— 手机肉眼无差（行业通行做法），像素量降至约 1/4。
 * 合并前四层像素量之和 = 0.36×3 + 0.13 = 1.21 MPx；
 * 合并后单层 = 0.36 MPx（DPR 1 时）/ 0.81 MPx（DPR 1.5 时）。 */
function pickDPR() {
  return Math.min(window.devicePixelRatio || 1, 1.5);
}

/* 战斗横带的几何：与 .battle-stage 的 CSS 完全对应
 *   top: 92px
 *   bottom: calc(44vh + 84px)
 * → 高度 h = vh - 92 - (0.44*vh + 84) = 0.56*vh - 176
 * 实测校验：860→305.6  844→296.6  780→260.8  932→345.9（与 getBoundingClientRect 一致） */
export function battleBand(vh) {
  const top = 92;
  const h = Math.max(1, 0.56 * (vh || window.innerHeight || 1) - 176);
  return { top, height: h };
}

function resize() {
  _W = Math.max(1, window.innerWidth || 1);
  _H = Math.max(1, window.innerHeight || 1);
  _dpr = pickDPR();
  if (_cv && _ctx) {
    const bw = Math.round(_W * _dpr), bh = Math.round(_H * _dpr);
    if (_cv.width !== bw) _cv.width = bw;
    if (_cv.height !== bh) _cv.height = bh;
    /* 统一变换：逻辑坐标 = CSS 像素，绘制时无需再关心 DPR */
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
  }
  for (const L of _layers) { try { L.resize && L.resize(_W, _H); } catch (e) {} }
}

function tick(now) {
  if (!_running || _paused) return;
  const wait = FRAME_MS - (now - _lastPaint);
  if (wait > 4) {
    /* 限帧期间真正让出主线程：原各层各自 setTimeout，合并后只需一处。
     * 阈值 >4ms 才睡，余量过小 setTimeout 会立即返回、退化成紧凑循环。 */
    _sleepT = setTimeout(() => {
      _sleepT = 0;
      if (_running && !_paused) _raf = requestAnimationFrame(tick);
    }, wait);
    return;
  }
  _raf = requestAnimationFrame(tick);
  _lastPaint = now;

  /* ⚠️ 只算原始 dt，绝不在这里乘倍速 —— 见文件头「铁律」。
   *    各层拿到的是同一个干净 dt，自己决定怎么用。 */
  const dt = Math.min(0.05, (now - _last) / 1000);
  _last = now;

  /* v4.1: _ctx 为 null（纯 ticker 模式）时跳过 2D 清屏与状态归位 ——
   * 层各自的绘制面（GL canvas / overlay canvas）自己负责自己的像素。 */
  if (_ctx) {
    _ctx.clearRect(0, 0, _W, _H);
    for (const L of _layers) {
      /* 诊断钩子：逐层记录它收到的 dt。验收「倍速不泄漏」时靠它取证 ——
       * 舞台把【同一个原始 dt】给每一层，任何一层拿到的 dt 都不含 G.speedMult。 */
      if (_diag) _diag(L.name, dt);
      /* v3.6 状态隔离：clearRect 只清像素、不清画笔状态，globalAlpha /
       * globalCompositeOperation / filter 会跨层、跨帧残留。任何一层泄漏
       * 都会污染后续所有层（曾致 battle 层全体半透明）。每层进入前强制归位。 */
      _ctx.globalAlpha = 1;
      _ctx.globalCompositeOperation = "source-over";
      try { _ctx.filter = "none"; } catch (e) {}
      try { L.draw(_ctx, _W, _H, dt, now); }
      catch (e) {
        /* 单层异常不应拖垮整条渲染链：报一次，之后跳过该层 */
        if (!L._err) { L._err = 1; console.error('[stage] 层绘制失败:', L.name, e); }
      }
    }
  } else {
    for (const L of _layers) {
      if (_diag) _diag(L.name, dt);
      try { L.draw(null, _W, _H, dt, now); }
      catch (e) {
        if (!L._err) { L._err = 1; console.error('[stage] 层绘制失败:', L.name, e); }
      }
    }
  }
}

export function initStage(canvas, layers) {
  /* v4.1: canvas 可为 null —— 渲染栈统一 WebGL 后，#stage 2D 画布退役，
   * 本模块降级为纯 ticker（限帧调度 + dt 分发 + 可见性管理），
   * 层 draw 的 ctx 首参恒 null（层各自决定画到哪：battle→BattleGL，dantian→overlay）。 */
  _cv = canvas || null;
  _ctx = _cv ? _cv.getContext('2d', { alpha: false }) : null;
  _layers = layers.filter(Boolean);
  resize();
  _running = true;
  _last = performance.now();
  _lastPaint = 0;
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVis);
  /* 战斗层需要知道自己该画在哪条横带上。用两个极小的全局钩子，
   * 避免 50-battle.js 反向 import 本模块（那会构成循环依赖）。 */
  window.__stageBand = () => battleBand(_H);
  window.__stageSize = () => ({ W: _W, H: _H });
  _raf = requestAnimationFrame(tick);
  return {
    pause: pauseRender, resume: resumeRender, destroy, resize,
    band: () => battleBand(_H),
    get size() { return { W: _W, H: _H }; },
    /* 运行期加层：层的加入顺序即绘制顺序（后者盖前者）。
     * 用途：战斗层是动态 import 的，就绪比 bg 晚，需要"插进已有顺序里"。 */
    addLayer(L) {
      if (!L) return;
      if (!L.name) L.name = 'layer' + _layers.length;
      _layers.push(L);
      try { L.resize && L.resize(_W, _H); } catch (e) {}
    },
    /* 插到某个已存在层【之前】。找不到就追加到末尾。 */
    insertLayerBefore(name, L) {
      if (!L) return;
      if (!L.name) L.name = 'layer' + _layers.length;
      const i = _layers.findIndex(x => x.name === name);
      if (i < 0) _layers.push(L); else _layers.splice(i, 0, L);
      try { L.resize && L.resize(_W, _H); } catch (e) {}
    },
    get layerNames() { return _layers.map(L => L.name); },
    /* 诊断：装/卸逐层 dt 记录钩子。仅用于验收脚本，正常路径下为 null。 */
    setDiag(fn) { _diag = fn; },
  };
}

function onVis() {
  if (document.hidden) {
    _running = false;
    if (_raf) cancelAnimationFrame(_raf);
    if (_sleepT) { clearTimeout(_sleepT); _sleepT = 0; }
  } else if (!_paused) {
    _running = true; _last = performance.now();
    _raf = requestAnimationFrame(tick);
  }
}

/* 黑屏挂机（enterDim）用：停整条渲染链。合并前是分别停 bg/fx2d/战斗，
 * 现在停一处即可 —— 这也是合并的附带收益：不会再出现"停了三层漏一层"。 */
function pauseRender() {
  _paused = true;
  _running = false;
  if (_raf) cancelAnimationFrame(_raf);
  if (_sleepT) { clearTimeout(_sleepT); _sleepT = 0; }
}
function resumeRender() {
  if (!_paused) return;
  _paused = false;
  if (!document.hidden) {
    _running = true; _last = performance.now(); _lastPaint = 0;
    _raf = requestAnimationFrame(tick);
  }
}

function destroy() {
  _running = false; _paused = false;
  if (_raf) cancelAnimationFrame(_raf);
  if (_sleepT) { clearTimeout(_sleepT); _sleepT = 0; }
  window.removeEventListener('resize', resize);
  document.removeEventListener('visibilitychange', onVis);
}
