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
 * ── 切换方式 ─────────────────────────────────────────────────────────
 *   ?render=pixi      URL 参数
 *   localStorage.xrRenderBackend = 'pixi'
 *   默认 'canvas2d'（零风险，与改造前完全一致）
 */

export const BACKENDS = { CANVAS2D: 'canvas2d', PIXI: 'pixi' };

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
  return _cached;
}

/** 供调试：运行时切换（下一帧生效，需重建后端） */
export function setBackend(kind) {
  _cached = (kind === 'pixi') ? BACKENDS.PIXI : BACKENDS.CANVAS2D;
  try { localStorage.setItem('xrRenderBackend', _cached); } catch (e) {}
  return _cached;
}
