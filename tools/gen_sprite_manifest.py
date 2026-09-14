#!/usr/bin/env python3
"""把各角色 meta 合成 assets/sprite-manifest.json（战斗系统唯一的素材合同入口）。

为什么需要它：
  素材有两条互相独立的口径，混用必错：
    · meta.start/count = 贴图内的绝对帧号，可直接用来切格；
    · meta.src_frames  = 源视频帧号，仅供溯源，与贴图无关。
  把这条口径写死在绘制代码里，就会出现"每个人各猜一种偏移"的局面。manifest 做三件事：
    1) 固化"start 即绝对帧号、无偏移"这一口径，代码不再各自猜；
    2) 给出每帧的真实内容框 frameBoxes，让绘制能按"脚底对齐 + 内容高度缩放"精确落位；
    3) 携带形态校正 correct（scaleY/skewX），素材画歪/画扁由数据纠正，不由绘制分支写死。

用法:  python3 tools/gen_sprite_manifest.py
"""
import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("需要 Pillow: sudo pip3 install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALPHA_MIN = 24           # flood fill 去背后的残留边缘阈值

# 形态校正默认值：素材本身画扁/画歪时在这里登记。
# 优先级：meta 里的 correct > 本表 > 无校正。
# 只有"素材本身的形态问题"才放这里；站位、朝向、大小一律由运行时算。
CORRECT_DEFAULTS = {
    "monster_001": {"scaleY": 0.92},                  # 底部压平贴合地板
    "monster_002": {"scaleY": 0.92, "skewX": -0.03},  # 同上 + 身体微右倾(约 -1.7°)
}

# 帧号口径（血泪教训，见 docs/combat-system.md §6.1）：
#   meta 里的 start/count = 贴图内的绝对帧号，直接用，不做任何偏移。
#   meta 里的 src_frames  = 源视频帧号，仅供溯源，与贴图无关。
# 曾经误以为需要 +4 的 SHEET_SHIFT，结果把 hurt 段算到贴图外，
# 表现成"受击动画永远不播"。别再引入任何偏移。


def sheet_name(path):
    return os.path.splitext(os.path.basename(path))[0]


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def clip_frames(key, meta_clip, cols, width, height, fw, fh, total):
    """按 meta 的 start/count 逐帧裁内容框（start 就是贴图绝对帧号）。"""
    start = meta_clip["start"]
    count = meta_clip["count"]
    frames, boxes = [], []
    for i in range(count):
        absf = start + i
        col, row = absf % cols, absf // cols
        x0, y0 = col * fw, row * fh
        if absf >= total:
            print(f"    ! {key}: 声明 {count} 帧但贴图只有 {total} 帧，"
                  f"第 {i} 帧({absf})越界 → 截断为 {len(frames)} 帧")
            break
        crop = img_crop(x0, y0, fw, fh)
        if crop is None:
            print(f"    ! {key}: 第 {i} 帧({absf})无内容 → 截断为 {len(frames)} 帧")
            break
        frames.append(absf)
        boxes.append(crop)
    return frames, boxes


def main():
    global img_crop
    manifest = {"version": 2, "frame_index_basis": "meta.start 即贴图绝对帧号（无偏移）",
               "characters": {}}
    assets = os.path.join(ROOT, "assets")

    metas = [(f, load_json(os.path.join(assets, f)))
             for f in sorted(os.listdir(assets)) if f.endswith("_meta.json")]

    for meta_file, meta in metas:
        sheet_rel = (meta.get("sprite") or "").replace("\\", "/").strip()
        if not sheet_rel:
            print(f"  跳过 {meta_file}: 没有 sprite 字段")
            continue
        # 兼容两种写法：相对仓库根 assets/xxx.png，或相对 assets 目录 xxx.png
        if "/" not in sheet_rel:
            sheet_rel = "assets/" + sheet_rel
        sheet_path = os.path.join(ROOT, sheet_rel)
        if not os.path.exists(sheet_path):
            print(f"  跳过 {meta_file}: 找不到 {sheet_rel}")
            continue

        im = Image.open(sheet_path).convert("RGBA")
        width, height = im.size
        cols = meta.get("cols") or (width // meta["frame_size"][0])
        fw, fh = meta["frame_size"]

        def img_crop(x0, y0, w, h):
            piece = im.crop((x0, y0, x0 + w, y0 + h))
            # 用 alpha 通道求真实内容框（flood fill 去背后背景 alpha=0）
            alpha = piece.getchannel("A").point(lambda v: 255 if v > ALPHA_MIN else 0)
            box = alpha.getbbox()
            if not box:
                return None
            bx0, by0, bx1, by1 = box
            return {"x": bx0, "y": by0, "w": bx1 - bx0, "h": by1 - by0}

        entry = {
            "id": meta.get("id") or sheet_name(sheet_rel),
            "name": meta.get("name"),
            "sprite": sheet_rel,          # 运行时加载用（和 meta 里同名，方便直接替换）
            "sheet": sheet_rel,
            "cols": cols,
            "rows": height // fh,
            "frame_size": [fw, fh],
            "fps": meta.get("walk", {}).get("fps", 24),
            "facing": meta.get("facing", "left"),
            "base_stats": meta.get("base_stats"),
            "clips": {},
        }

        total_frames = entry["rows"] * cols
        for key in ("walk", "attack", "hurt"):
            if key not in meta:
                continue
            frames, boxes = clip_frames(key, meta[key], cols, width, height, fw, fh, total_frames)
            if not frames:
                continue
            entry["clips"][key] = {
                "index": meta[key]["start"],     # 贴图绝对帧号起点（= meta.start，无偏移）
                "start": meta[key]["start"],
                "count": len(frames),
                "loop": bool(meta[key].get("loop")),
                "fps": meta[key].get("fps", entry["fps"]),
                # frames/boxes 是权威数据：逐帧实测，能表达非矩形片段与尾部空帧
                "frames": frames,
                "boxes": boxes,
            }

        # 表现尺寸基准：取所有帧内容高度的中位数，避免单帧动作把角色拉高/压扁
        heights = sorted(b["h"] for clip in entry["clips"].values() for b in clip["boxes"])
        entry["content_h"] = heights[len(heights) // 2] if heights else fh
        # 体型分级：tier 1 小怪给画布高 34%，人物给 62%（见 docs/combat-system.md §6）
        is_player = "cultivator" in sheet_rel
        entry["target_ratio"] = 0.62 if is_player else 0.34
        entry["max_px"] = 110 if is_player else 60
        correct = dict(CORRECT_DEFAULTS.get(entry["id"], {}))
        correct.update(meta.get("correct") or {})
        if correct:
            entry["correct"] = correct

        if not entry["clips"]:
            print(f"  跳过 {meta_file}: 无有效帧")
            continue

        cid = entry["id"]
        manifest["characters"][cid] = entry
        walk = entry["clips"].get("walk", {})
        atk = entry["clips"].get("attack", {})
        hurt = entry["clips"].get("hurt", {})
        print(f"  {cid:14s} cols={cols} 帧={fw}x{fh} "
              f"walk={walk.get('count', 0)} attack={atk.get('count', 0)} hurt={hurt.get('count', 0)}")

    out = os.path.join(assets, "sprite-manifest.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"\n写出 {os.path.relpath(out, ROOT)}  ({len(manifest['characters'])} 个角色)")


if __name__ == "__main__":
    main()
