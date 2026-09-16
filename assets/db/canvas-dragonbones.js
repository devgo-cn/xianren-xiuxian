/*!
 * canvas-dragonbones.js
 * 真·Canvas 2D 骨骼渲染桥：基于 DragonBonesJS 核心（MIT），不引 pixi / 不用 WebGL。
 * 仅扩展三个渲染器类：CanvasTextureAtlasData / CanvasSlot / CanvasArmatureProxy + 一个 CanvasFactory。
 * 复用核心 Slot.update() 已算好的世界矩阵(global / globalTransformMatrix) 与 TextureData.region，
 * 把每个可见 slot 的子贴图用 ctx.drawImage 拼到 2D canvas。
 *
 * 依赖：dragonBones UMD（Pixi/5.x/out/dragonBones.js 已含全部 core 类，但我们只用 core）。
 */
(function (global) {
    'use strict';
    const DB = global.dragonBones;
    if (!DB) {
        throw new Error('[canvas-dragonbones] 请先加载 dragonBones UMD（dragonBones.js）');
    }
    const { BaseFactory, Slot, TextureAtlasData, TextureData, Armature, DragonBones, BaseObject } = DB;

    // ---- 1) 贴图集数据：持有源图 Image，子贴图 region 由解析器填好 ----
    class CanvasTextureAtlasData extends TextureAtlasData {
        static toString() {
            return '[class dragonBones.CanvasTextureAtlasData]';
        }
        constructor() {
            super();
            this.renderTexture = null; // 源图 <img>
        }
        _onClear() {
            super._onClear();
            this.renderTexture = null;
        }
        createTexture() {
            return new TextureData();
        }
    }

    // ---- 2) 骨架代理：实现 IArmatureProxy（DB 仅用到 dbInit/dbUpdate/dispose/armature/animation） ----
    class CanvasArmatureProxy {
        constructor() {
            this._armature = null;
        }
        dbInit(armature) {
            this._armature = armature;
        }
        dbClear() {
            this._armature = null;
        }
        // advanceTime 已在内部驱动 slot.update()（进而 _updateTransform）；renderer 直接读字段，这里留空即可。
        dbUpdate() {}
        dispose(disposeProxy) {
            if (this._armature !== null) {
                this._armature.dispose();
                this._armature = null;
            }
        }
        get armature() {
            return this._armature;
        }
        get animation() {
            return this._armature ? this._armature.animation : null;
        }
        // IEventDispatcher 最小实现（首测不需要事件分发）
        dispatchDBEvent() {}
        addDBEventListener() {}
        removeDBEventListener() {}
        hasDBEventListener() {
            return false;
        }
        toString() {
            return '[class dragonBones.CanvasArmatureProxy]';
        }
    }

    // ---- 3) Canvas Slot：除 _updateFrame（记录 textureScale）与 _updateTransform（留空，绘制在渲染循环）外，全部 no-op ----
    class CanvasSlot extends Slot {
        static toString() {
            return '[class dragonBones.CanvasSlot]';
        }
        constructor() {
            super();
            this._textureScale = 1.0; // 设计单位 → 贴图像素 的额外缩放
        }
        _onClear() {
            super._onClear();
            this._textureScale = 1.0;
        }
        _initDisplay() {}
        _disposeDisplay() {}
        _onUpdateDisplay() {
            this._renderDisplay = this._display ? this._display : this._rawDisplay;
        }
        _addDisplay() {}
        _replaceDisplay() {}
        _removeDisplay() {}
        _updateZOrder() {} // z 序由 getSlots() 返回顺序保证（armature 已按 z 排序）
        _updateVisible() {}
        _updateBlendMode() {} // 可选：后续按需支持 Add 混合
        _updateColor() {}
        _updateFrame() {
            const td = this._textureData;
            if (this._displayIndex >= 0 && this._display !== null && td !== null) {
                this._textureScale = td.parent.scale * this._armature._armatureData.scale;
            }
        }
        _updateMesh() {} // 首测仅支持 Image 显示；mesh 走兜底
        _updateTransform() {} // 真正的绘制在 drawArmature 里
        _identityTransform() {}
    }

    // ---- 4) 工厂 ----
    class CanvasFactory extends BaseFactory {
        static toString() {
            return '[class dragonBones.CanvasFactory]';
        }
        constructor(dataParser) {
            super(dataParser); // null → 默认 ObjectDataParser(JSON)
            // DragonBones 核心仅需一个 eventManager（仅用 dispatchDBEvent）；这里给最小桩。
            this._dragonBones = new DragonBones({ dispatchDBEvent() {} });
        }
        _buildTextureAtlasData(textureAtlasData, textureAtlas) {
            let data = textureAtlasData;
            if (!data) {
                data = BaseObject.borrowObject(CanvasTextureAtlasData);
            }
            if (textureAtlas) {
                data.renderTexture = textureAtlas; // 源图 Image
            }
            return data;
        }
        _buildArmature(dataPackage) {
            const armature = BaseObject.borrowObject(Armature);
            const proxy = new CanvasArmatureProxy();
            armature.init(dataPackage.armature, proxy, proxy, this._dragonBones);
            return armature;
        }
        _buildSlot(dataPackage, slotData, armature) {
            const slot = BaseObject.borrowObject(CanvasSlot);
            slot.init(slotData, armature, {}, {});
            return slot;
        }
    }

    /**
     * 把一只骨架渲染到 2D 上下文。
     * 调用方应先在 ctx 上摆好“骨架世界原点 + 缩放/翻转”，本函数按 DB 世界坐标逐 slot 绘制。
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {Armature} armature
     * @param {object} [opts] { blendAdd:boolean }
     */
    function drawArmature(ctx, armature, opts) {
        opts = opts || {};
        const slots = armature.getSlots();
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (!slot._visible) continue;
            const td = slot._textureData;
            if (td === null) continue; // 该显示无贴图（被隐藏等）
            const region = td.region;
            if (region === null) continue;
            const src = td.parent.renderTexture;
            if (!src) continue;

            slot.updateGlobalTransform();
            const M = slot.globalTransformMatrix;
            const t = slot.global;
            const ts = slot._textureScale;
            const pivotX = slot._pivotX;
            const pivotY = slot._pivotY;

            // 贴图左上角的世界坐标（仿 Pixi _updateTransformV4）
            const x = t.x - (M.a * pivotX + M.c * pivotY);
            const y = t.y - (M.b * pivotX + M.d * pivotY);
            const sx = t.scaleX * ts;
            const sy = t.scaleY * ts;
            const rot = t.rotation;
            const skew = -t.skew;

            // 仿 Pixi localTransform（pivot=0）
            const cr = Math.cos(rot);
            const sr = Math.sin(rot);
            const a = cr * sx;
            const b = sr * sx;
            const c = -sr * sy + cr * skew;
            const d = cr * sy + sr * skew;

            const alpha = slot._colorTransform ? slot._colorTransform.alphaMultiplier * slot._globalAlpha : slot._globalAlpha;

            ctx.save();
            if (alpha !== undefined) ctx.globalAlpha = alpha;
            ctx.transform(a, b, c, d, x, y);

            if (td.rotated) {
                // 旋转 90° 的子贴图：源区 w/h 交换
                ctx.drawImage(
                    src,
                    region.x, region.y, region.height, region.width,
                    0, 0, region.width, region.height
                );
            } else {
                ctx.drawImage(
                    src,
                    region.x, region.y, region.width, region.height,
                    0, 0, region.width, region.height
                );
            }
            ctx.restore();
        }
    }

    /**
     * 计算骨架当前姿态的绘制包围盒（armature 局部像素空间）。
     * 用于游戏里对齐"脚底/水平中心"与按目标高度缩放。
     * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
     */
    function armatureAABB(armature) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const slots = armature.getSlots();
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (!slot._visible) continue;
            const td = slot._textureData;
            if (td === null || td.region === null) continue;
            const src = td.parent.renderTexture;
            if (!src) continue;
            slot.updateGlobalTransform();
            const M = slot.globalTransformMatrix, t = slot.global, ts = slot._textureScale;
            const x = t.x - (M.a * slot._pivotX + M.c * slot._pivotY);
            const y = t.y - (M.b * slot._pivotX + M.d * slot._pivotY);
            const cr = Math.cos(t.rotation), sr = Math.sin(t.rotation), skew = -t.skew;
            const a = cr * t.scaleX * ts, b = sr * t.scaleX * ts;
            const c = -sr * t.scaleY * ts + cr * skew, d = cr * t.scaleY * ts + sr * skew;
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

    // ---- 顶层便捷 API ----
    const CanvasDragonBones = {
        CanvasFactory,
        CanvasSlot,
        CanvasTextureAtlasData,
        CanvasArmatureProxy,
        drawArmature,
        armatureAABB,

        /**
         * 构建一个可复用工厂（一次解析，多次 buildArmature 出独立骨架实例）。
         */
        buildFactory(skeJson, texJson, image) {
            const factory = new CanvasFactory(null);
            factory.parseDragonBonesData(skeJson);
            /* scale = 声明画布 / 实际图宽: 压缩管线把贴图与 region 减半但骨骼空间不变,
             * core 默认 scale=1 会把贴图画成骨骼空间的一半 → 全部贴图与骨骼脱节(散架)。 */
            const iw = (image && (image.naturalWidth || image.width)) || texJson.width;
            factory.parseTextureAtlasData(texJson, image, null, texJson.width / iw);
            return factory;
        },

        /**
         * 便捷方法：建工厂 + 建一只骨架。
         * @param {object} skeJson  _ske.json 解析对象
         * @param {object} texJson  _tex.json 解析对象（含 SubTexture）
         * @param {HTMLImageElement} image  源图（已 onload）
         * @param {string} [armatureName]   不传则用 skeJson 第一个 armature
         * @returns {Armature}
         */
        buildArmature(skeJson, texJson, image, armatureName) {
            const factory = this.buildFactory(skeJson, texJson, image);
            const name = armatureName || (skeJson.armature && skeJson.armature[0] && skeJson.armature[0].name);
            const armature = factory.buildArmature(name);
            if (!armature) {
                throw new Error('[canvas-dragonbones] 构建骨架失败：' + name);
            }
            armature._factory = factory; // 便于 dispose 时回收
            return armature;
        },
    };

    global.CanvasDragonBones = CanvasDragonBones;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = CanvasDragonBones;
    }
})(typeof window !== 'undefined' ? window : this);
