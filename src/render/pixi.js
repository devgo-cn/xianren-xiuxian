/**
 * PixiJS 战斗渲染后端
 * ──────────────────────────────────────────────────────────────────────
 * 职责：只画【怪物】（enemies）。其余战斗元素（玩家/宠物/特效/伤害数字）
 * 仍走 Canvas2D —— 它们数量少且大量依赖 Canvas 特有绘制（渐变/文字/混合模式）。
 *
 * 为什么只画怪物：
 *   用户目标是"引进大量怪物内容"，怪物是唯一会规模增长的部分。
 *   怪物绘制又是纯图集 blit，正是 Pixi 批处理收益最大的场景。
 *
 * 顺序保证：
 *   产出一张画布，由调用方在原本 drawEnemies() 的位置 drawImage 回去，
 *   因此 bg → [怪物] → drops → player → ... 的层序完全不变。
 *
 * 铁律：
 *   - 不启用 Pixi 自带 ticker（autoStart:false），由 60-stage 单一 ticker 驱动
 *   - 不接收也不处理 dt；只按给定的帧号与坐标摆位置
 */

import { getMonster, pickFrame, measure } from '../monsters/registry.js';

/* Pixi 是 801KB，动态 import —— 默认 canvas2d 路径永不加载它。
   整个 src/render/pixi.js 本身也应由调用方动态 import，形成两级懒加载。 */
let PIXI = null;

export function createPixiBackend() {
  let app = null;
  let root = null;
  let ready = false;
  let _initPromise = null;
  /* Pixi v8 用 ImageSource + Texture({source, frame})，
   * 不再是 v7 的 BaseTexture —— 见 vendor/pixi.min.mjs 导出清单。 */
  const _srcCache = new Map();     // spritePath -> ImageSource
  const _frameCache = new Map();   // `${path}:${x},${y},${w},${h}` -> Texture
  const _pool = [];                // 精灵对象池
  let _used = 0;

  /** 首次调用时异步建 app。Pixi 8 的 init 是 Promise。
   *  幂等：并发调用共享同一个 _initPromise。 */
  function ensureApp(w, h) {
    if (ready) return Promise.resolve(true);
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
    try {
      if (!PIXI) PIXI = await import('../../vendor/pixi.min.mjs');
      const { Application, Container } = PIXI;
      app = new Application();
      await app.init({
        width: Math.max(1, Math.ceil(w)),
        height: Math.max(1, Math.ceil(h)),
        backgroundAlpha: 0,                   // 透明底，blit 时才不会盖住 bg
        antialias: false,
        autoStart: false,                     // ★ 不用 Pixi ticker
        autoDensity: false,
        resolution: 1,
        preference: 'webgl',
      });
      root = new Container();
      app.stage.addChild(root);
      ready = true;
      return true;
    } catch (e) {
      /* WebGL 不可用 / 加载失败：返回 false，调用方回退 Canvas2D */
      app = null;
      _initPromise = null;
      return false;
    }
    })();
    return _initPromise;
  }

  function getFrame(path, img, x, y, w, h) {
    const { Texture, ImageSource, Rectangle } = PIXI;
    const key = path + ':' + x + ',' + y + ',' + w + ',' + h;
    let t = _frameCache.get(key);
    if (!t) {
      let src = _srcCache.get(path);
      if (!src) {
        /* ImageSource 直接包住整张 img 时，source 的 width/height 取自
         * resource，帧的 UV 才按整图归一化。v8 中不可再用 BaseTexture。 */
        src = new ImageSource({ resource: img });
        src.width = img.naturalWidth || img.width;
        src.height = img.naturalHeight || img.height;
        _srcCache.set(path, src);
      }
      t = new Texture({ source: src, frame: new Rectangle(x, y, w, h) });
      _frameCache.set(key, t);
    }
    return t;
  }

  function obtain() {
    const { Sprite } = PIXI;
    if (_used < _pool.length) return _pool[_used++];
    const s = new Sprite();
    s.anchor.set(0, 0);
    _pool.push(s);
    _used++;
    root.addChild(s);
    return s;
  }

  let _cw = 0, _ch = 0;

  return {
    name: 'pixi',

    /** 是否可用（WebGL 初始化成功且已就绪）。不可用则调用方回退 Canvas2D。 */
    get available() { return ready; },

    /** 异步初始化（幂等）。返回 Promise<boolean>。 */
    ensureInit(w, h) { _cw = w; _ch = h; return ensureApp(w, h); },

    /** 尺寸变化时重建画布（幂等，尺寸未变则跳过）。 */
    resize(w, h) {
      _cw = w; _ch = h;
      if (!ready) return;
      try { app.renderer.resize(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h))); }
      catch (e) { /* 忽略 */ }
    },

    /**
     * 画一帧怪物。
     * @param {Array} enemies  敌人数组（只读）
     * @param {object} geo     { W, H, floorY, camX, now }
     * @returns {HTMLCanvasElement|null} 供调用方 blit；null 表示本帧走 Canvas2D
     */
    drawEnemies(enemies, geo) {
      if (!ready) return null;
      const { W, H, floorY, camX, now } = geo;
      /* 尺寸变化（旋转屏幕/改窗口）时同步 Pixi 画布 */
      if (Math.abs(W - _cw) > 0.5 || Math.abs(H - _ch) > 0.5) {
        _cw = W; _ch = H;
        try { app.renderer.resize(Math.max(1, Math.ceil(W)), Math.max(1, Math.ceil(H))); }
        catch (e) { return null; }
      }
      _used = 0;

      for (const e of enemies) {
        if (!e.alive && e.dying <= 0) continue;
        const M = getMonster(e.type);
        if (!M || !M.sprite.ready) continue;

        const fr = pickFrame(M, e, now);
        const m = measure(M, H, e.elite, now);

        const sx = e.x - camX;
        const sy = floorY - m.floatY;

        /* 与 Canvas2D 路径一致的几何：踩地板的用 footOffset 对齐脚底，
         * 漂浮的（boss）用 drawH 顶对齐 */
        const dy = M.visual.footBase != null ? -m.footOffset : -m.drawH;
        const dh = M.visual.footBase != null ? m.compensatedH : m.drawH;

        const tex = getFrame(M.spritePath, M.sprite.img, fr.srcX, fr.srcY, fr.fw, fr.fh);
        const s = obtain();
        s.texture = tex;
        s.visible = true;
        s.x = sx - m.drawW * 0.5;
        s.y = sy + dy;
        s.width = m.drawW;
        s.height = dh;
        /* 倾斜校正（水灵 -0.03 弧度） */
        s.skew.x = M.visual.skewX || 0;
        /* 死亡淡出 / 受击压暗：用 alpha + tint 近似 Canvas2D 的 globalAlpha+filter */
        let a = 1;
        if (e.dying > 0) a = e.dying / 0.4;
        if (e.hurtT > 0) a *= 0.7;
        s.alpha = Math.max(0, Math.min(1, a));
        s.tint = (e.hurtT > 0) ? 0xffe9c8 : 0xffffff;   /* brightness 近似 */
      }

      /* 复用池：本帧没用到的精灵隐藏 */
      for (let i = _used; i < _pool.length; i++) _pool[i].visible = false;

      try {
        app.renderer.render(app.stage);
      } catch (e) {
        return null;
      }
      return app.canvas;
    },

    destroy() {
      try { if (app) app.destroy(true, { children: true }); } catch (e) {}
      app = null; root = null; ready = false;
      _srcCache.clear(); _frameCache.clear(); _pool.length = 0;
    },
  };
}
