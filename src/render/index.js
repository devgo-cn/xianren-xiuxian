/**
 * 渲染后端 (Render Backend)
 * ──────────────────────────────────────────────────────────────────────
 * 战斗层的绘制实现被抽成"后端"，可在 Canvas2D 与 PixiJS 之间切换。
 *
 * ── 为什么后端渲染到【离屏画布】再 blit 回舞台 ──────────────────────
 * 层顺序是 bg → battle → aura → burst → dantian，五层画在【同一张 #stage】上。
 * 若 Pixi 用一张独立 canvas 叠在 #stage 之上，battle 就会盖住 aura/burst，
 * 顺序即被破坏。因此 Pixi 只负责"把 battle 层内部画好"，产出一张画布，
 * 由调用方在【原本 drawEnemies 的位置】drawImage 回 #stage —— 顺序零变化。
 *
 * 代价：每帧一次画布 blit。收益：大量怪物时 Pixi 的批渲染（batching）
 * 能把几百次 drawImage 压成个位数 draw call。
 *
 * ── 铁律：后端不碰 dt ────────────────────────────────────────────────
 * 后端只接收【已经算好的位置/帧号】去画。倍速乘法留在 50-battle.js 的
 * update() 第一行（const sdt = dt * G.speedMult），后端绝不参与。
 * Pixi 自带 ticker，但我们【不启用】它 —— 由 60-stage 的单一 ticker 驱动。
 *
 * ── 铁律：不静默兜底 ─────────────────────────────────────────────────
 * 选定 pixi 却起不来（无 WebGL / 模块加载失败 / 渲染抛错）时【绝不】
 * 悄悄改用 Canvas2D —— 那样屏幕上看着一切正常，实际跑的是哪套技术栈
 * 就无从判断，验收等于白做。
 *
 * 不兜底的表现：怪物不绘制 + 屏幕角标红字写明原因。想恢复旧行为，
 * 显式切回 ?render=canvas2d 即可（角标随之变成灰字 CANVAS2D）。
 *
 * 角标常驻显示当前后端，任何时刻都一眼可辨。
 *   PIXI（绿）      正在走 PixiJS
 *   CANVAS2D（灰）  正在走 Canvas2D（默认）
 *   PIXI✗（红）     指定 pixi 但未生效，附原因；怪物未绘制
 *
 * ── 切换方式 ─────────────────────────────────────────────────────────
 *   ?render=pixi      URL 参数
 *   localStorage.xrRenderBackend = 'pixi'
 *   默认 'canvas2d'（零风险，与改造前完全一致）
 */

export const BACKENDS = { CANVAS2D: 'canvas2d', PIXI: 'pixi' };

/**
 * 后端实际状态。requested = 用户指定，actual = 真正生效。
 * 二者不一致即为"未生效"，角标转红 —— 这是判断技术栈的唯一权威来源。
 */
export const backendState = {
  requested: null,   // 'canvas2d' | 'pixi'
  actual: null,      // 'canvas2d' | 'pixi' | null(尚未就绪)
  ok: false,         // actual 是否健康
  reason: '',        // 未生效/异常原因
};

let _cached = null;

/** 解析当前应选用的后端。只解析一次并缓存，避免每帧读 localStorage。 */
export function resolveBackend() {
  if (_cached) return _cached;
  let v = null;
  try {
    const q = new URLSearchParams(location.search).get('render');
    if (q === 'pixi' || q === 'canvas2d') v = q;
  } catch (e) { /* file:// 等无 location.search 的场景 */ }
  if (!v) {
    try { v = localStorage.getItem('xrRenderBackend'); } catch (e) { /* 隐私模式 */ }
  }
  _cached = (v === 'pixi') ? BACKENDS.PIXI : BACKENDS.CANVAS2D;
  backendState.requested = _cached;
  return _cached;
}

/** 供调试：运行时切换（下一帧生效，需重建后端） */
export function setBackend(kind) {
  _cached = (kind === 'pixi') ? BACKENDS.PIXI : BACKENDS.CANVAS2D;
  try { localStorage.setItem('xrRenderBackend', _cached); } catch (e) {}
  return _cached;
}

/**
 * 后端上报自己是否真的生效了。由调用方在初始化/每帧渲染后调用。
 * @param {'canvas2d'|'pixi'} actual 真正生效的后端
 * @param {boolean} ok      是否健康
 * @param {string}  reason  不健康时的原因
 */
export function reportBackend(actual, ok, reason) {
  backendState.actual = actual;
  backendState.ok = !!ok;
  backendState.reason = reason || '';
  paintBadge();
}

/* ── 角标 ──────────────────────────────────────────────────────────────
 * 一个常驻的 DOM 小标签。不用 canvas 画是因为它必须盖在所有层之上且
 * 不受游戏清屏影响 —— DOM 是最省事也最可靠的位置。 */
let _badge = null;

function paintBadge() {
  try {
    if (!_badge) {
      if (!document.body) return;
      _badge = document.createElement('div');
      _badge.id = 'xrBackendBadge';
      _badge.style.cssText = [
        'position:fixed', 'left:6px', 'bottom:6px', 'z-index:9999',
        'pointer-events:none', 'font:11px/1.5 ui-monospace,Menlo,Consolas,monospace',
        'padding:2px 6px', 'border-radius:4px', 'white-space:pre',
        'background:rgba(0,0,0,.55)', 'letter-spacing:.3px',
      ].join(';');
      document.body.appendChild(_badge);
    }
    const s = backendState;
    const failed = s.requested === BACKENDS.PIXI && !(s.ok && s.actual === BACKENDS.PIXI);
    const label = s.actual || '…';
    /* 手机上不能让原因撑爆屏幕，截断到 48 字符；完整原因看 window.__renderBackend */
    const why = s.reason.length > 48 ? s.reason.slice(0, 48) + '…' : s.reason;
    _badge.textContent = failed
      ? 'PIXI✗ ' + (why || '未生效')
      : (label === BACKENDS.PIXI ? 'PIXI' : 'CANVAS2D');
    _badge.style.color = failed ? '#ff6b6b' : (label === BACKENDS.PIXI ? '#5ce08a' : '#9aa4b2');
  } catch (e) { /* 角标是诊断设施，绝不能反过来影响游戏 */ }

  /* 供验收脚本取证：实际跑了哪套技术栈 */
  try {
    window.__renderBackend = {
      requested: backendState.requested,
      actual: backendState.actual,
      ok: backendState.ok,
      reason: backendState.reason,
    };
  } catch (e) {}
}
