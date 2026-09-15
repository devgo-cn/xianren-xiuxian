/**
 * 怪物渲染器状态（角标）
 * ──────────────────────────────────────────────────────────────────────
 * 怪物只有【一套】绘制实现：PixiJS（src/render/pixi.js）。
 * 这里不负责"选哪套"，只负责把【那唯一一套是否真的在跑】如实显示出来。
 *
 * 为什么需要它：
 *   WebGL 不可用 / 库没加载成功 / 某帧渲染抛错，都不会抛到控制台就被吞掉。
 *   没有角标的话屏幕上看着"好像也能玩"，实际怪物根本没画 —— 无法验收。
 *
 * 角标常驻左下角：
 *   PIXI（绿）       PixiJS 正在画怪物
 *   PIXI✗ 原因（红） 没生效，附原因；此时怪物不绘制
 *
 * window.__monsterRenderer 暴露同样信息，供自动化验收取证。
 */

const state = { ok: false, reason: '', ready: false };

let _badge = null;

/**
 * 上报渲染器状态。
 * @param {boolean} ok     是否健康地在画
 * @param {string}  reason 不健康时的原因
 */
export function reportRenderer(ok, reason) {
  state.ok = !!ok;
  state.reason = reason || '';
  if (ok) state.ready = true;
  paintBadge();
}

/** 当前状态快照（只读拷贝） */
export function rendererState() {
  return { ok: state.ok, ready: state.ready, reason: state.reason };
}

function paintBadge() {
  try {
    if (!_badge) {
      if (!document.body) return;
      _badge = document.createElement('div');
      _badge.id = 'xrRendererBadge';
      _badge.style.cssText = [
        'position:fixed', 'left:6px', 'bottom:6px', 'z-index:9999',
        'pointer-events:none', 'font:11px/1.5 ui-monospace,Menlo,Consolas,monospace',
        'padding:2px 6px', 'border-radius:4px', 'white-space:pre',
        'background:rgba(0,0,0,.55)', 'letter-spacing:.3px',
      ].join(';');
      document.body.appendChild(_badge);
    }
    /* 手机上不能让原因撑爆屏幕，截断到 48 字符；完整原因看 window.__monsterRenderer */
    const why = state.reason.length > 48 ? state.reason.slice(0, 48) + '…' : state.reason;
    _badge.textContent = state.ok ? 'PIXI' : ('PIXI✗ ' + (why || '未就绪'));
    _badge.style.color = state.ok ? '#5ce08a' : '#ff6b6b';
  } catch (e) { /* 角标是诊断设施，绝不能反过来影响游戏 */ }

  try {
    window.__monsterRenderer = { ok: state.ok, ready: state.ready, reason: state.reason };
  } catch (e) {}
}
