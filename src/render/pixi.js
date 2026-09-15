/**
 * 怪物渲染器（PixiJS）—— 怪物精灵的【唯一】绘制实现
 * ──────────────────────────────────────────────────────────────────────
 * 职责：只画【怪物精灵】（enemies）。
 *
 * 加新怪物的素材往哪加？—— 唯一入口是 src/monsters/registry.js 的
 * MONSTER_DEFS（图集路径 + meta.json + 帧范围 + visual 参数）。
 * 本文件不含任何怪物硬编码，新增怪物不需要改这里。
 *
 * 顺序保证：
 *   产出一张画布，由调用方在原本 drawEnemies() 的位置 drawImage 回去，
 *   因此 bg → [怪物] → drops → player → ... 的层序完全不变。
 *   血条 / 精英光环 / BOSS 掩码特效由调用方用 Canvas2D 叠加在精灵之上，
 *   它们只有一份实现，几何量与本文件同源（都来自 measure()）。
 *
 * 铁律：
 *   - 不启用 Pixi 自带 ticker（autoStart:false），由 60-stage 单一 ticker 驱动
 *   - 不接收也不处理 dt；只按给定的帧号与坐标摆位置
 *   - 失败就是失败：初始化/渲染出错如实上报（src/render/status.js），
 *     不悄悄换第二种画法
 */

import { getMonster, pickFrame, measure } from '../monsters/registry.js';

/* Pixi 是 801KB，动态 import —— 默认 canvas2d 路径永不加载它。
   整个 src/render/pixi.js 本身也应由调用方动态 import，形成两级懒加载。 */
let PIXI = null;

export function createPixiBackend() {
  let app = null;
  let root = null;
  let overlay = null;          // 叠加层（光环 / 血条），永远在精灵之上
  let ringG = null;            // 精英光环：一个 Graphics 画全部，一次 draw call
  let hpG = null;              // 血条：同上
  let ready = false;
  let _initPromise = null;
  let lastError = '';          // 初始化失败原因，供角标显示
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
      /* 两层容器：精灵在下，叠加物（精英光环 / 血条）在上。
       * 这样不管精灵池怎么扩，叠加物永远压在精灵之上 —— 与原 Canvas2D
       * 的绘制顺序（精灵 → 光环 → 血条）一致。 */
      root = new Container();
      overlay = new Container();
      const { Graphics } = PIXI;
      ringG = new Graphics();
      hpG = new Graphics();
      overlay.addChild(ringG);
      overlay.addChild(hpG);
      app.stage.addChild(root);
      app.stage.addChild(overlay);
      ready = true;
      return true;
    } catch (e) {
      /* 库加载失败 / WebGL 不可用：返回 false，并把原因交给角标显示。
         注意【不回退】—— 见 src/render/status.js 的"不静默兜底"铁律。 */
      app = null;
      _initPromise = null;
      lastError = (e && e.message ? e.message : String(e)) || '未知错误';
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

  /* ── BOSS 攻击帧的左侧渐隐特效 ──────────────────────────────────────
   * 原为 50-battle.js 里的 Canvas2D 离屏烘焙（BOSS_MASK）。现在怪物的一切
   * 都由本渲染器负责，烘焙也搬到这儿 —— 只在尺寸变化时重烤一次，
   * 烤出来的 canvas 转成 Pixi 纹理缓存，之后每帧只是换 texture。 */
  let _maskBake = { w: 0, h: 0, tex: [] };

  function bakedMasks(drawW, drawH) {
    const B = getMonster('boss');
    if (!B || !B.sprite.ready) return null;
    if (_maskBake.tex.length && _maskBake.w === drawW && _maskBake.h === drawH) return _maskBake;
    const { Texture } = PIXI;
    const BS = B.frames;
    const cw = Math.max(1, Math.ceil(drawW)), chh = Math.max(1, Math.ceil(drawH));
    const tex = [];
    for (let i = 0; i < BS.attack.count; i++) {
      const src = BS.attack.start + i;
      const off = document.createElement('canvas');
      off.width = cw; off.height = chh;
      const octx = off.getContext('2d');
      octx.drawImage(B.sprite.img, (src % BS.cols) * BS.fw,
        Math.floor(src / BS.cols) * BS.fh, BS.fw, BS.fh, 0, 0, cw, chh);
      octx.globalCompositeOperation = 'destination-in';
      const grad = octx.createLinearGradient(0, 0, cw * 0.4, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,1)');
      octx.fillStyle = grad;
      octx.fillRect(0, 0, cw, chh);          /* 必须填满，否则右侧变透明 */
      tex.push(Texture.from(off));
    }
    _maskBake = { w: drawW, h: drawH, tex };
    return _maskBake;
  }

  /* 血条配色桶：与原 Canvas2D 渐变的两端色一致，这里用左右两段实色近似渐变。
   * 怪物血条恒为 'e'（敌方红）；玩家/宠物的血条仍由 Canvas2D 画。 */
  const HP_COLORS = { e: [0xff6050, 0xd82020] };

  function drawHpBar(g, x, y, w, hp, maxHp) {
    const p = Math.max(0, hp / maxHp);
    const h = 3;
    g.roundRect(x - w / 2, y, w, h, 1.5).fill({ color: 0x080c14, alpha: 0.6 });
    if (p <= 0) return;
    const [c0, c1] = HP_COLORS.e;
    const half = w * p * 0.5;
    if (half <= 0) return;
    /* 左半段用渐变起点色，右半段用终点色 —— 两段拼出横向渐变观感 */
    g.roundRect(x - w / 2, y, Math.max(1, half), h, 1.5).fill({ color: c0 });
    g.roundRect(x - w / 2 + half, y, Math.max(1, w * p - half), h, 1.5).fill({ color: c1 });
  }

  let _cw = 0, _ch = 0;

  return {
    name: 'pixi',

    /** 是否可用（WebGL 初始化成功且已就绪）。不可用则调用方回退 Canvas2D。 */
    get available() { return ready; },

    /** 初始化失败原因（成功则为空串） */
    get lastError() { return lastError; },

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
      /* 叠加层每帧重画：一个 Graphics 装下全部光环/血条，draw call 恒为 2 */
      ringG.clear();
      hpG.clear();

      for (const e of enemies) {
        if (!e.alive && e.dying <= 0) continue;
        const M = getMonster(e.type);
        if (!M || !M.sprite.ready) continue;

        const fr = pickFrame(M, e, now);
        const m = measure(M, H, e.elite, now);

        const sx = e.x - camX;
        const sy = floorY - m.floatY;

        /* 与改造前 Canvas2D 完全一致的几何：踩地板的用 footOffset 对齐脚底，
         * 漂浮的（boss）用 drawH 顶对齐 */
        const dy = M.visual.footBase != null ? -m.footOffset : -m.drawH;
        const dh = M.visual.footBase != null ? m.compensatedH : m.drawH;

        /* BOSS 攻击帧：换成预烘焙的左侧渐隐帧，其余帧照常 */
        let tex = getFrame(M.spritePath, M.sprite.img, fr.srcX, fr.srcY, fr.fw, fr.fh);
        if (M.visual.maskedAttack && e.anim > 0) {
          const bake = bakedMasks(m.drawW, m.drawH);
          if (bake) {
            const fi = Math.min(fr.frameIdx - M.frames.attack.start, M.frames.attack.count - 1);
            const mt = bake.tex[Math.max(0, fi)];
            if (mt) tex = mt;
          }
        }

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

        if (!e.alive) continue;                          /* 尸体不画光环/血条 */

        /* 精英光环：脚下金色椭圆，alpha 0.5 */
        if (e.elite) {
          ringG.ellipse(sx, floorY, 16, 16 * 0.3).stroke({
            color: 0xe8c46b, width: 1.5, alpha: 0.5,
          });
        }
        /* 血条位置与改造前一致：踩地板的贴脚底上方 4px（宽 28），
         * BOSS 在头顶右移对齐头部（宽 50） */
        if (M.visual.footBase != null) drawHpBar(hpG, sx, floorY - m.footOffset - 4, 28, e.hp, e.maxHp);
        else drawHpBar(hpG, sx + m.drawW * 0.2, sy - m.drawH - 8, 50, e.hp, e.maxHp);
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
