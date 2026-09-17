/* webgl-battle.js v4.0 —— 战斗层全 WebGL 渲染
 *
 * 依赖（按序加载）：pixi-legacy.min.js(5.3.3) → dragonBones.js(5.5, 内置 PixiFactory) → 本文件
 *
 * 架构：一张透明 WebGL canvas(#battleGL) 盖在共享 #stage 之上（z-index:1），
 * 战斗层全部内容（背景平铺/骨骼怪/序列帧怪/玩家/宠物/掉落/特效/飘字）都在 Pixi
 * stage 上渲染；#stage 2D 只保留横带底色渐变。60-stage 的层接口不变（battle 层
 * 依旧 draw(ctx,W,H,dt)，只是内部从 ctx 操作换成 Pixi 对象同步 + app.render()）。
 *
 * z 序（对应原 2D 画家算法，容器顺序即遮挡关系）：
 *   bg → far(远车道怪) → farUI(远怪血条/法环) → drops(掉落) → player → pets
 *      → near(近车道怪) → nearUI → fx(战斗特效) → text(伤害飘字/技能播报)
 *
 * 坐标系：与原 2D 完全一致 —— 横带本地坐标（y=0 为横带顶），root.y=bandTop
 * 平移由 frame() 完成，50-battle 的 draw* 函数坐标语义零改动。
 */
(function (global) {
    'use strict';
    if (!global.PIXI || !global.dragonBones) {
        console.error('[BattleGL] 缺 PIXI/dragonBones —— WebGL 战斗层不可用');
        return;
    }
    const PIXI = global.PIXI;
    const dragonBones = global.dragonBones;

    /* ========== 应用骨架 ========== */
    let app = null, root = null, bandMask = null, bgGradSprite = null;
    const L = {};                 // z 序容器组
    let W = 1, H = 1, dpr = 1;

    function init() {
        if (app) return true;
        if (!document.body) return false;
        app = new PIXI.Application({
            width: 8, height: 8,
            transparent: true, autoStart: false,
            antialias: false, resolution: 1, autoDensity: false,
            /* v6.7 PERF: high-performance → low-power。
             * 手机 SoC 的 GPU 有大小核集群, high-performance 会强制锁大核, 是发烫主因之一。
             * 2D 骨骼动画用小核完全够, 视觉无差, 功耗显著下降。 */
            powerPreference: 'low-power'
        });
        const cv = app.view;
        cv.id = 'battleGL';
        /* 常态调色沿用 2D 版 #battleCanvas 的 CSS 合成层方案（GPU, 零逐帧开销）——
         * 保持战斗画面饱和度/亮度与旧渲染一致 */
        cv.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:1;';   /* v4.4: 移除 saturate/brightness filter, 战斗层恢复素材原色, 与打坐角色白衣亮度一致 */
        document.body.appendChild(cv);

        root = new PIXI.Container();
        app.stage.addChild(root);
        /* z 序对应原 2D 画家算法；farUI/nearUI 分别承接远/近批次血条+法环，
         * playerUI 是玩家血条 —— 与 2D 版"画完怪立刻画其 UI"的时序一致。
         * v4.2: foreground = 前景遮挡层(背景源图底部条带再画一次, 压在所有实体
         * 之上, 实体脚踝"走在草后")；drops 提到前景之上 —— 掉落物(水晶)躺在
         * 前景草上, 永不被怪/玩家/前景遮挡。 */
        for (const n of ['bg', 'far', 'farUI', 'player', 'playerUI', 'pets', 'near', 'nearUI', 'foreground', 'drops', 'fx', 'text']) {
            L[n] = new PIXI.Container();
            root.addChild(L[n]);
        }
        /* UI 层共享 Graphics：每帧 clear 重画（血条/法环数量小，直画语义最保真） */
        for (const n of ['farUI', 'playerUI', 'nearUI']) {
            L[n]._gfx = new PIXI.Graphics();
            L[n].addChild(L[n]._gfx);
        }
        bandMask = new PIXI.Graphics();
        app.stage.addChild(bandMask);
        root.mask = bandMask;   // mask 画在 stage 坐标(屏幕)，把内容裁进横带

        /* 横带底色渐变纹理(1x256 竖向拉伸) —— 原渲染里 clear=false 分支的
         * createLinearGradient(0,'#070b16'→'#060912'→'#050810') 的 GL 等价物。
         * 不透明，铺满横带后正好遮住 #stage 上同位置的 2D 底色。 */
        const gc = document.createElement('canvas');
        gc.width = 1; gc.height = 256;
        const gx = gc.getContext('2d');
        const g = gx.createLinearGradient(0, 0, 0, 256);
        g.addColorStop(0, '#070b16'); g.addColorStop(0.72, '#060912'); g.addColorStop(1, '#050810');
        gx.fillStyle = g; gx.fillRect(0, 0, 1, 256);
        bgGradSprite = new PIXI.Sprite(PIXI.Texture.from(gc));
        L.bg.addChild(bgGradSprite);
        /* v6.8: 程序云 Graphics 已删除(用户要求)。背景未就绪时由 bgGradSprite 渐变兜底。 */
        L.bg._tiles = new PIXI.Container();
        L.bg.addChild(L.bg._tiles);

        resize();
        global.addEventListener('resize', resize);
        console.log('[BattleGL] WebGL 战斗层就绪 renderer=' + (app.renderer.gl ? 'WebGL' : 'canvas'));
        return true;
    }

    function resize() {
        if (!app) return;
        /* v6.7 PERF: DPR 封顶从 2.0 降回 1.5。
         * 像素量 = (dpr×宽)×(dpr×高), 2.0 → 1.5 直接砍掉 44% GPU 填充率。
         * 1.5x 在手机屏幕上肉眼无差(行业通行做法), 换来明显降温。 */
        dpr = Math.min(global.devicePixelRatio || 1, 1.5);
        W = global.innerWidth; H = global.innerHeight;
        app.renderer.resolution = dpr;
        app.renderer.resize(W, H);
    }

    /* 每帧末调用：同步横带几何并渲染。bandTop/bandH 来自 window.__stageBand()
     * v4.1.1: 环形记录最近调用 —— 排查"战斗画面跳顶部"抖动：
     * bandTop 只可能是 92(stage 驱动)或 0(独立泵 frame(0,innerH))，
     * 若 diag 里 top=0 出现即证明第二渲染泵存在，src 字段指认调用方。 */
    let _bandTop = NaN, _bandH = NaN, _maskW = 0, _maskH = 0;
    const _frameLog = [];
    function frame(bandTop, bandH, src) {
        if (!app) return;
        _frameLog.push({ top: bandTop, h: bandH, src: src || '?', at: (performance.now() | 0) });
        if (_frameLog.length > 60) _frameLog.shift();
        root.y = bandTop;
        if (bandTop !== _bandTop || bandH !== _bandH || W !== _maskW || H !== _maskH) {
            _bandTop = bandTop; _bandH = bandH; _maskW = W; _maskH = H;
            bandMask.clear().beginFill(0xffffff).drawRect(0, bandTop, W, bandH).endFill();
        }
        bgGradSprite.x = 0; bgGradSprite.y = 0;
        bgGradSprite.width = W; bgGradSprite.height = bandH;
        app.render();
    }

    /* ========== 通用工具 ========== */
    const _texCache = new Map();
    /* Image/Canvas → 纹理（按对象引用缓存；canvas 内容更新后传 true 强刷） */
    function tex(obj, update) {
        let t = _texCache.get(obj);
        if (!t) {
            t = PIXI.Texture.from(obj);
            _texCache.set(obj, t);
        } else if (update) {
            t.baseTexture.update();
        }
        return t;
    }

    /* 共享滤镜（ColorMatrixFilter 比逐怪 new 便宜；挂/摘引用即可） */
    const mkF = (fn) => { const f = new PIXI.filters.ColorMatrixFilter(); fn(f); return f; };
    const Filters = {
        /* 怪受击闪白 —— 等价 ctx.filter='brightness(1.8)' */
        hurt: mkF(f => f.brightness(1.8, false)),
        /* 玩家受击 —— 等价 brightness(2.2) saturate(0.3) */
        playerHurt: mkF(f => { f.brightness(2.2, false); f.saturate(0.3, false); })
    };

    /* ========== 骨骼怪（dragonBones PixiFactory） ========== */
    const boneFactories = {};   // slug -> PixiFactory

    function buildFactory(skeJson, texJson, image) {
        const factory = new dragonBones.PixiFactory();
        factory.parseDragonBonesData(skeJson);
        const ptext = tex(image);
        /* scale = 声明画布宽 / 物理图宽：压缩管线把贴图与 region 减半而骨骼空间不变，
         * 与 canvas 桥 buildFactory 同一套管线语义（官方 parseTextureAtlasData 第 4 参）。 */
        const iw = (image && (image.naturalWidth || image.width)) || texJson.width;
        factory.parseTextureAtlasData(texJson, ptext, null, texJson.width / iw);
        return factory;
    }
    function getFactory(slug) { return boneFactories[slug] || null; }
    function setFactory(slug, f) { boneFactories[slug] = f; }

    /* 骨架实例池：同工厂 build 出的实例互不影响；死怪回收复用（build 一棵
     * Pixi 显示树不便宜，刷怪高峰期每秒可能新建多只）。 */
    function acquireArmature(B) {
        if (B.pool && B.pool.length) return B.pool.pop();
        return B.factory.buildArmature(B.arm);
    }
    function releaseArmature(B, arm) {
        const d = arm.display;
        if (d && d.parent) d.parent.removeChild(d);
        (B.pool || (B.pool = [])).push(arm);
    }

    /* ---- mesh 顶点计算（从 canvas-dragonbones.js 平移；PixiSlot 与 CanvasSlot
     * 字段同名同语义：_textureScale/_textureData/_pivotX/_geometryData） ---- */
    function computeMeshGeometry(slot) {
        const gd = slot._geometryData;
        if (!gd) return null;
        const intArray = gd.data.intArray;
        const floatArray = gd.data.floatArray;
        const vertexCount = intArray[gd.offset];
        const triangleCount = intArray[gd.offset + 1];
        let vertexOffset = intArray[gd.offset + 2];
        if (vertexOffset < 0) vertexOffset += 65536;
        const scale = slot._armature._armatureData.scale;
        const deform = slot._displayFrame ? slot._displayFrame.deformVertices : null;
        const hasDeform = deform && deform.length > 0 && gd.inheritDeform;
        const verts = new Float32Array(vertexCount * 2);

        if (gd.weight !== null) {
            const bones = slot._geometryBones;
            let wfo = intArray[gd.weight.offset + 1];
            if (wfo < 0) wfo += 65536;
            let iB = gd.weight.offset + 2 + bones.length;
            let iV = wfo, iF = 0;
            for (let i = 0, iD = 0; i < vertexCount; ++i) {
                const boneCount = intArray[iB++];
                let xG = 0.0, yG = 0.0;
                for (let j = 0; j < boneCount; ++j) {
                    const bone = bones[intArray[iB++]];
                    const matrix = bone.globalTransformMatrix;
                    const weight = floatArray[iV++];
                    let xL = floatArray[iV++] * scale;
                    let yL = floatArray[iV++] * scale;
                    if (hasDeform) { xL += deform[iF++]; yL += deform[iF++]; }
                    xG += (matrix.a * xL + matrix.c * yL + matrix.tx) * weight;
                    yG += (matrix.b * xL + matrix.d * yL + matrix.ty) * weight;
                }
                verts[iD++] = xG; verts[iD++] = yG;
            }
            return { verts, vertexCount, triangleCount, skinned: true };
        }

        for (let i = 0; i < vertexCount * 2; i += 2) {
            let x = floatArray[vertexOffset + i] * scale;
            let y = floatArray[vertexOffset + i + 1] * scale;
            if (hasDeform) { x += deform[i]; y += deform[i + 1]; }
            verts[i] = x; verts[i + 1] = y;
        }
        return { verts, vertexCount, triangleCount, skinned: false };
    }

    /* 骨架当前姿态 AABB（骨架局部空间）—— WebGL 版，字段语义同 canvas 桥。 */
    function armatureAABB(armature) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const slots = armature.getSlots();
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (!slot._visible) continue;
            const td = slot._textureData;
            if (!td || td.region === null) continue;
            slot.updateGlobalTransform();

            if (slot._geometryData) {
                const geo = computeMeshGeometry(slot);
                if (geo) {
                    const verts = geo.verts;
                    if (geo.skinned) {
                        for (let k = 0; k < verts.length; k += 2) {
                            if (verts[k] < minX) minX = verts[k];
                            if (verts[k] > maxX) maxX = verts[k];
                            if (verts[k + 1] < minY) minY = verts[k + 1];
                            if (verts[k + 1] > maxY) maxY = verts[k + 1];
                        }
                    } else {
                        const M = slot.globalTransformMatrix, ts = slot._textureScale;
                        const x = M.tx - (M.a * slot._pivotX + M.c * slot._pivotY);
                        const y = M.ty - (M.b * slot._pivotX + M.d * slot._pivotY);
                        const a = M.a * ts, b = M.b * ts, c = M.c * ts, d = M.d * ts;
                        for (let k = 0; k < verts.length; k += 2) {
                            const wx = a * verts[k] + c * verts[k + 1] + x;
                            const wy = b * verts[k] + d * verts[k + 1] + y;
                            if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
                            if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
                        }
                    }
                    continue;
                }
            }

            const M = slot.globalTransformMatrix, ts = slot._textureScale;
            const x = M.tx - (M.a * slot._pivotX + M.c * slot._pivotY);
            const y = M.ty - (M.b * slot._pivotX + M.d * slot._pivotY);
            const a = M.a * ts, b = M.b * ts, c = M.c * ts, d = M.d * ts;
            const w = td.region.width, h = td.region.height;
            const cs = [[0, 0], [w, 0], [0, h], [w, h]];
            for (let k = 0; k < 4; k++) {
                const wx = a * cs[k][0] + c * cs[k][1] + x;
                const wy = b * cs[k][0] + d * cs[k][1] + y;
                if (wx < minX) minX = wx; if (wy < minY) minY = wy;
                if (wx > maxX) maxX = wx; if (wy > maxY) maxY = wy;
            }
        }
        if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        return { minX, minY, maxX, maxY };
    }

    global.BattleGL = {
        init, frame, resize, tex, Filters,
        layers: L,
        buildFactory, getFactory, setFactory,
        acquireArmature, releaseArmature,
        computeMeshGeometry, armatureAABB,
        get renderer() { return app ? app.renderer : null; },
        get ready() { return !!app; },
        get size() { return { W, H, dpr }; },
        /* 诊断：最近 60 次 frame 调用(top/h/src/at) —— 抖动取证 */
        get diag() { return { frames: _frameLog.slice(), rootY: root ? root.y : null, W, H, dpr }; }
    };
})(window);
