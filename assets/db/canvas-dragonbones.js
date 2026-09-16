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

    // ---- mesh（网格变形贴片）支持 ----
    // 照抄官方 PixiSlot._updateMesh 顶点公式：
    //  - 蒙皮 mesh（weight）：顶点 = Σ w × (骨骼 globalTransformMatrix × 初始局部顶点)，直接落在骨架全局空间；
    //    display 变换恒等（对应 _identityTransform）。
    //  - 非蒙皮 mesh：顶点在 slot 局部空间，与普通贴图共用同一 slot 变换（M×ts + pivot 修正）。
    // 不能把 mesh 当普通矩形贴（会把 124 顶点的透视/蒙皮变形画成整块 → 怪"分离成两块"）。
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
                    if (hasDeform) {
                        xL += deform[iF++];
                        yL += deform[iF++];
                    }
                    xG += (matrix.a * xL + matrix.c * yL + matrix.tx) * weight;
                    yG += (matrix.b * xL + matrix.d * yL + matrix.ty) * weight;
                }
                verts[iD++] = xG;
                verts[iD++] = yG;
            }
            return { verts, vertexCount, triangleCount, skinned: true, intArray, gd };
        }

        for (let i = 0; i < vertexCount * 2; i += 2) {
            let x = floatArray[vertexOffset + i] * scale;
            let y = floatArray[vertexOffset + i + 1] * scale;
            if (hasDeform) {
                x += deform[i];
                y += deform[i + 1];
            }
            verts[i] = x;
            verts[i + 1] = y;
        }
        return { verts, vertexCount, triangleCount, skinned: false, intArray, gd };
    }

    // 单三角形仿射贴图：源图三角 (sx*,sy*) → 目标三角 (dx*,dy*)。clip 限制绘制范围，
    // 源矩形取三角 bbox 以减少采样量。det=0（退化三角）跳过。
    function drawTexturedTriangle(ctx, src, dx0, dy0, dx1, dy1, dx2, dy2, sx0, sy0, sx1, sy1, sx2, sy2) {
        const det = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0);
        if (det === 0) return;
        // 退化/近退化目标三角（动画中被蒙皮压扁）：面积过小时 affine 数值爆炸会
        // 采到 region 外的压缩杂色 → 画布上出现彩色拉丝。肉眼不可见，直接跳过。
        const area = Math.abs((dx1 - dx0) * (dy2 - dy0) - (dx2 - dx0) * (dy1 - dy0));
        if (!(area > 0.01) || !isFinite(area)) return;
        const inv = 1.0 / det;
        const a = ((dx1 - dx0) * (sy2 - sy0) - (dx2 - dx0) * (sy1 - sy0)) * inv;
        const c = ((dx2 - dx0) * (sx1 - sx0) - (dx1 - dx0) * (sx2 - sx0)) * inv;
        const b = ((dy1 - dy0) * (sy2 - sy0) - (dy2 - dy0) * (sy1 - sy0)) * inv;
        const d = ((dy2 - dy0) * (sx1 - sx0) - (dy1 - dy0) * (sx2 - sx0)) * inv;
        const e = dx0 - a * sx0 - c * sy0;
        const f = dy0 - b * sx0 - d * sy0;
        if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d) || !isFinite(e) || !isFinite(f)) return;
        const sbx = Math.min(sx0, sx1, sx2), sby = Math.min(sy0, sy1, sy2);
        const sbw = Math.max(sx0, sx1, sx2) - sbx, sbh = Math.max(sy0, sy1, sy2) - sby;
        if (sbw <= 0 || sbh <= 0) return;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(dx0, dy0);
        ctx.lineTo(dx1, dy1);
        ctx.lineTo(dx2, dy2);
        ctx.closePath();
        ctx.clip();
        ctx.transform(a, b, c, d, e, f);
        ctx.drawImage(src, sbx, sby, sbw, sbh, sbx, sby, sbw, sbh);
        ctx.restore();
    }

    // 最小二乘仿射拟合：把源局部像素坐标 (sx,sy) 映到骨架空间顶点 (dx,dy)。
    // 返回 null 表示奇异（顶点共线等）。正常方程 3x3 直接解。
    function fitAffine(srcX, srcY, verts, n, out) {
        let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0;
        let bxa = 0, bxb = 0, bya = 0, byb = 0, bxe = 0, byf = 0;
        for (let i = 0; i < n; i++) {
            const x = srcX[i], y = srcY[i];
            const dx = verts[i * 2], dy = verts[i * 2 + 1];
            sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y;
            bxa += x * dx; bxb += y * dx; bxe += dx;
            bya += x * dy; byb += y * dy; byf += dy;
        }
        const N = n;
        // 3x3 伴随求逆
        const m00 = sxx, m01 = sxy, m02 = sx, m10 = sxy, m11 = syy, m12 = sy, m20 = sx, m21 = sy, m22 = N;
        const det = m00 * (m11 * m22 - m12 * m21) - m01 * (m10 * m22 - m12 * m20) + m02 * (m10 * m21 - m11 * m20);
        if (!isFinite(det) || Math.abs(det) < 1e-6) return false;
        const i00 = (m11 * m22 - m12 * m21) / det, i01 = (m02 * m21 - m01 * m22) / det, i02 = (m01 * m12 - m02 * m11) / det;
        const i10 = (m12 * m20 - m10 * m22) / det, i11 = (m00 * m22 - m02 * m20) / det, i12 = (m02 * m10 - m00 * m12) / det;
        const i20 = (m10 * m21 - m11 * m20) / det, i21 = (m01 * m20 - m00 * m21) / det, i22 = (m00 * m11 - m01 * m10) / det;
        // 输出为 canvas transform(a,b,c,d,e,f) 顺序：dx=a*x+c*y+e, dy=b*x+d*y+f，
        // 调用方可直接 ctx.transform(out) 且误差公式与 canvas 语义一致。
        out[0] = i00 * bxa + i01 * bxb + i02 * bxe; // a = ∂dx/∂x
        out[1] = i00 * bya + i01 * byb + i02 * byf; // b = ∂dy/∂x
        out[2] = i10 * bxa + i11 * bxb + i12 * bxe; // c = ∂dx/∂y
        out[3] = i10 * bya + i11 * byb + i12 * byf; // d = ∂dy/∂y
        out[4] = i20 * bxa + i21 * bxb + i22 * bxe; // e = dx 偏移
        out[5] = i20 * bya + i21 * byb + i22 * byf; // f = dy 偏移
        return true;
    }

    // 绘制一个 mesh slot（调用方已检查 visible/alpha/贴图可用）。
    // opts.affineTol：仿射退化的最大顶点偏差（骨架空间 px，默认 0.5）。蒙皮变形小于该值时
    // 用 1 次 drawImage 代替逐三角 clip——移动端 clip 是头号性能杀手（158 三角 → 1 调用）。
    function drawMeshSlot(ctx, slot, td, alpha, opts) {
        const geo = computeMeshGeometry(slot);
        if (!geo) return;
        const region = td.region;
        const src = td.parent.renderTexture;
        const tol = (opts && opts.affineTol !== undefined) ? opts.affineTol : 0.5;

        const verts = geo.verts;
        const intArray = geo.intArray;
        const floatArray = geo.gd.data.floatArray;
        let vertexOffset = intArray[geo.gd.offset + 2];
        if (vertexOffset < 0) vertexOffset += 65536;
        const uvOffset = vertexOffset + geo.vertexCount * 2;
        const indexBase = geo.gd.offset + 4;
        const rw = region.width, rh = region.height, rx = region.x, ry = region.y;

        // 源图像素坐标（每顶点一次）
        const srcX = new Float32Array(geo.vertexCount);
        const srcY = new Float32Array(geo.vertexCount);
        for (let i = 0; i < geo.vertexCount; ++i) {
            srcX[i] = floatArray[uvOffset + i * 2] * rw;
            srcY[i] = floatArray[uvOffset + i * 2 + 1] * rh;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0.0, Math.min(1.0, alpha));

        if (!geo.skinned) {
            const M = slot.globalTransformMatrix, ts = slot._textureScale;
            const x = M.tx - (M.a * slot._pivotX + M.c * slot._pivotY);
            const y = M.ty - (M.b * slot._pivotX + M.d * slot._pivotY);
            ctx.transform(M.a * ts, M.b * ts, M.c * ts, M.d * ts, x, y);
        }

        // 仿射退化检测：拟合误差（骨架空间）< tol → 单次 drawImage。
        // 非蒙皮 mesh 顶点在 slot 局部空间，误差 ×ts 折算到骨架空间。
        const errScale = geo.skinned ? 1.0 : slot._textureScale;
        const m = [0, 0, 0, 0, 0, 0];
        let affineOk = tol > 0 && fitAffine(srcX, srcY, verts, geo.vertexCount, m);
        if (affineOk) {
            let maxErr = 0;
            for (let i = 0; i < geo.vertexCount; i++) {
                const ex = Math.abs(m[0] * srcX[i] + m[2] * srcY[i] + m[4] - verts[i * 2]);
                const ey = Math.abs(m[1] * srcX[i] + m[3] * srcY[i] + m[5] - verts[i * 2 + 1]);
                if (ex > maxErr) maxErr = ex;
                if (ey > maxErr) maxErr = ey;
            }
            if (maxErr * errScale > tol) affineOk = false;
        }

        if (affineOk) {
            if (global.CanvasDragonBones && global.CanvasDragonBones._stats) {
                global.CanvasDragonBones._stats.affine++;
            }
            ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
            ctx.drawImage(src, rx, ry, rw, rh, 0, 0, rw, rh);
        }
        else if (td.rotated) {
            // 本素材包无 rotated 网格；遇到时先按普通矩形兜底（后续包再验证）
            ctx.drawImage(src, rx, ry, rh, rw, 0, 0, rw, rh);
        }
        else {
            if (global.CanvasDragonBones && global.CanvasDragonBones._stats) {
                global.CanvasDragonBones._stats.tri++;
            }
            for (let t = 0; t < geo.triangleCount; ++t) {
                const i0 = intArray[indexBase + t * 3];
                const i1 = intArray[indexBase + t * 3 + 1];
                const i2 = intArray[indexBase + t * 3 + 2];
                drawTexturedTriangle(ctx, src,
                    verts[i0 * 2], verts[i0 * 2 + 1],
                    verts[i1 * 2], verts[i1 * 2 + 1],
                    verts[i2 * 2], verts[i2 * 2 + 1],
                    rx + srcX[i0], ry + srcY[i0], rx + srcX[i1], ry + srcY[i1], rx + srcX[i2], ry + srcY[i2]);
            }
        }
        ctx.restore();
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
            if (opts.only && slot.name !== opts.only) continue; // 调试：只画指定 slot
            if (opts.hide && opts.hide.indexOf(slot.name) >= 0) continue; // 调试：隐藏指定 slot
            if (!slot._visible) continue;
            const td = slot._textureData;
            if (td === null) continue; // 该显示无贴图（被隐藏等）
            const region = td.region;
            if (region === null) continue;
            const src = td.parent.renderTexture;
            if (!src) continue;

            // alpha 判断提前：透明部件（含 mesh）一律跳过
            const alpha0 = (slot._colorTransform ? slot._colorTransform.alphaMultiplier : 1.0) *
                (slot._globalAlpha === undefined || slot._globalAlpha === null ? 1.0 : slot._globalAlpha);
            if (alpha0 <= 0.001) continue;

            // 网格变形贴片：走 mesh 专用路径（蒙皮顶点公式 + 仿射退化/逐三角仿射贴图）
            if (slot._geometryData) {
                slot.updateGlobalTransform();
                drawMeshSlot(ctx, slot, td, alpha0, opts);
                continue;
            }

            slot.updateGlobalTransform();
            const M = slot.globalTransformMatrix;
            const ts = slot._textureScale;
            const pivotX = slot._pivotX;
            const pivotY = slot._pivotY;

            // 官方 PixiSlot._updateTransformV4 同款公式：
            // 1) 平移 = slot 世界原点 - 矩阵作用于 pivot（pivot 已由 core 换算为骨骼空间像素）
            // 2) 线性部分 = globalTransformMatrix × textureScale（贴图物理像素 → 骨骼空间）。
            //    不能从 global(rotation/skew/scale) 重建矩阵：skew 大时（本包最大 97°）
            //    重建公式与 Pixi 的剪切数学不等价，会整块错位（表现为上半身/下半身分离）。
            const x = M.tx - (M.a * pivotX + M.c * pivotY);
            const y = M.ty - (M.b * pivotX + M.d * pivotY);

            // slot._globalAlpha 并非 core 字段（undefined→NaN→globalAlpha 赋值失效），
            // 会把 alpha=0 的隐藏部件（如 megapack1 的参考图 slot）全部画出来 → 怪"分离成两块"。
            // （alpha 已提前算为 alpha0；skew 大时不能从 global 重建矩阵——见上注释）

            ctx.save();
            ctx.globalAlpha = Math.max(0.0, Math.min(1.0, alpha0));
            ctx.transform(M.a * ts, M.b * ts, M.c * ts, M.d * ts, x, y);

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

            // mesh slot：AABB 取自变形后的顶点（蒙皮=全局顶点；非蒙皮=局部顶点经 slot 变换）
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

    // ---- 顶层便捷 API ----
    const CanvasDragonBones = {
        CanvasFactory,
        CanvasSlot,
        CanvasTextureAtlasData,
        CanvasArmatureProxy,
        drawArmature,
        armatureAABB,
        _stats: { affine: 0, tri: 0 }, // 调试: 仿射退化/逐三角路径命中计数
        _debug: { computeMeshGeometry, fitAffine, drawMeshSlot }, // 调试句柄

        /**
         * 构建一个可复用工厂（一次解析，多次 buildArmature 出独立骨架实例）。
         */
        buildFactory(skeJson, texJson, image, scaleOverride) {
            const factory = new CanvasFactory(null);
            factory.parseDragonBonesData(skeJson);
            /* scale = 声明画布 / 实际图宽: 压缩管线把贴图与 region 减半但骨骼空间不变,
             * core 默认 scale=1 会把贴图画成骨骼空间的一半 → 全部贴图与骨骼脱节(散架)。
             * scaleOverride 供调试页对照实验。 */
            const iw = (image && (image.naturalWidth || image.width)) || texJson.width;
            const scale = (scaleOverride !== undefined && scaleOverride !== null) ? scaleOverride : (texJson.width / iw);
            factory.parseTextureAtlasData(texJson, image, null, scale);
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
