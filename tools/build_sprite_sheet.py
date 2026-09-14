#!/usr/bin/env python3
"""
Sprite Sheet 生成工作流
========================
从视频中提取帧，生成稳定的 sprite sheet（用于游戏角色/怪物动画）。

核心稳定方案（经过多轮验证）：
1. 固定裁剪窗口（所有帧共用同一个窗口，不每帧独立裁）
2. flood fill 去黑背景（R/G/B < 25）
3. 边缘暗色清理（R/G/B < 40，透明度降至 30%）
4. 顶部 20% 区域检测头部中心（纯头部，不含肩膀）
5. 中值滤波消除异常值（窗口大小 3）
6. 强制整数像素对齐（头部中心对齐到固定位置）
7. 统一缩放比例（所有帧用完全相同的比例）
8. 排列成 sprite sheet（可配置列数）

使用方法：
    python3 build_sprite_sheet.py \
        --video path/to/video.mp4 \
        --walk-start 4 --walk-end 35 \
        --attack-start 55 --attack-end 94 \
        --output assets/monster_sheet.png \
        --cols 9 \
        --frame-width 240 --frame-height 128 \
        --head-x 80 --head-y 32 \
        --target-height 112

参数说明：
    --video          输入视频路径
    --walk-start     walk 动画起始帧（源视频帧号）
    --walk-end       walk 动画结束帧（源视频帧号，包含）
    --attack-start   attack 动画起始帧（可选，没有攻击动画则不填）
    --attack-end     attack 动画结束帧（可选）
    --output         输出 sprite sheet 路径
    --cols           sprite sheet 列数（默认 9）
    --frame-width    单帧宽度（默认 240）
    --frame-height   单帧高度（默认 128）
    --head-x         头部中心对齐到画布的 x 坐标（默认 80）
    --head-y         头部中心对齐到画布的 y 坐标（默认 32）
    --target-height  缩放目标高度（默认 112）
    --crop-top       固定裁剪窗口顶部偏移（默认 10）
"""

import argparse
import os
import sys
import subprocess
import numpy as np
from PIL import Image


def extract_frames(video_path, start_frame, end_frame, output_dir):
    """从视频中提取指定范围的帧"""
    os.makedirs(output_dir, exist_ok=True)
    # 清空旧帧
    for f in os.listdir(output_dir):
        os.remove(os.path.join(output_dir, f))
    
    cmd = [
        'ffmpeg', '-y', '-i', video_path,
        '-vf', f"select='gte(n,{start_frame})*lte(n,{end_frame})'",
        '-vsync', '0',
        os.path.join(output_dir, 'f_%03d.png')
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"ffmpeg 错误: {result.stderr}")
        sys.exit(1)
    
    frames = sorted([f for f in os.listdir(output_dir) if f.endswith('.png')])
    print(f"提取了 {len(frames)} 帧（帧 {start_frame}-{end_frame}）")
    return [os.path.join(output_dir, f) for f in frames]


def remove_black_background(img, black_threshold=25, dark_threshold=40, dark_alpha=0.3):
    """去黑背景 + 边缘暗色清理"""
    arr = np.array(img.convert('RGBA'))
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    
    # 纯黑背景设为透明
    black_mask = (r < black_threshold) & (g < black_threshold) & (b < black_threshold)
    arr[black_mask, 3] = 0
    
    # 接近黑色的边缘降低透明度
    dark_mask = (r < dark_threshold) & (g < dark_threshold) & (b < dark_threshold) & (~black_mask)
    arr[dark_mask, 3] = (arr[dark_mask, 3].astype(float) * dark_alpha).astype(np.uint8)
    
    return Image.fromarray(arr)


def detect_head_center(img, top_ratio=0.20, alpha_threshold=10):
    """检测头部中心（顶部 top_ratio 区域的非透明像素中心）"""
    arr = np.array(img)
    alpha = arr[:,:,3]
    non_transparent = alpha > alpha_threshold
    h, w = arr.shape[:2]
    
    top_region = non_transparent[:int(h * top_ratio), :]
    if top_region.any():
        ys, xs = np.where(top_region)
        return int(np.mean(xs)), int(np.mean(ys))
    else:
        return w // 2, int(h * top_ratio / 2)


def median_filter(positions, window=3):
    """中值滤波消除异常值"""
    smoothed = []
    for i in range(len(positions)):
        start = max(0, i - window // 2)
        end = min(len(positions), i + window // 2 + 1)
        window_data = positions[start:end]
        xs = [p[0] for p in window_data]
        ys = [p[1] for p in window_data]
        smoothed.append((int(np.median(xs)), int(np.median(ys))))
    return smoothed


def build_sprite_sheet(
    video_path,
    walk_start, walk_end,
    attack_start=None, attack_end=None,
    output_path='output_sheet.png',
    cols=9,
    frame_width=240, frame_height=128,
    head_x=80, head_y=32,
    target_height=112,
    crop_top=10
):
    """
    构建 sprite sheet 主函数
    
    返回: (sprite_sheet_path, walk_count, attack_count, total_frames)
    """
    import tempfile
    tmp_dir = tempfile.mkdtemp(prefix='sprite_')
    
    # 1. 提取 walk 帧
    print(f"\n=== 提取 walk 帧（{walk_start}-{walk_end}）===")
    walk_frame_paths = extract_frames(video_path, walk_start, walk_end, os.path.join(tmp_dir, 'walk'))
    walk_count = len(walk_frame_paths)
    
    # 2. 提取 attack 帧（可选）
    attack_frame_paths = []
    attack_count = 0
    if attack_start is not None and attack_end is not None:
        print(f"\n=== 提取 attack 帧（{attack_start}-{attack_end}）===")
        attack_frame_paths = extract_frames(video_path, attack_start, attack_end, os.path.join(tmp_dir, 'attack'))
        attack_count = len(attack_frame_paths)
    
    all_frame_paths = walk_frame_paths + attack_frame_paths
    total_frames = len(all_frame_paths)
    print(f"\n总计: {total_frames} 帧（walk={walk_count}, attack={attack_count}）")
    
    # 3. 固定裁剪窗口参数
    # 假设视频是 1280x720，裁剪掉顶部 crop_top 像素的黑边
    CROP_BOX = (0, crop_top, 1280, 720)
    print(f"固定裁剪窗口: {CROP_BOX}")
    
    # 4. 第一步：去黑背景 + 检测头部中心
    print("\n=== 第一步: 去黑背景 + 检测头部中心 ===")
    cleaned_frames = []
    raw_head_positions = []
    
    for idx, frame_path in enumerate(all_frame_paths):
        img = Image.open(frame_path).convert('RGBA')
        cropped = img.crop(CROP_BOX)
        cleaned = remove_black_background(cropped)
        cleaned_frames.append(cleaned)
        
        head_cx, head_cy = detect_head_center(cleaned, top_ratio=0.20)
        raw_head_positions.append((head_cx, head_cy))
        
        if idx % 10 == 0:
            print(f"  帧{idx}: 头部中心=({head_cx},{head_cy})")
    
    # 5. 第二步：中值滤波
    print("\n=== 第二步: 中值滤波消除异常值 ===")
    smoothed_head = median_filter(raw_head_positions, window=3)
    
    # 6. 第三步：强制整数像素对齐
    print(f"\n=== 第三步: 强制对齐到 ({head_x},{head_y}) ===")
    processed_frames = []
    frame_size = (frame_width, frame_height)
    
    for idx, img_clean in enumerate(cleaned_frames):
        head_cx, head_cy = smoothed_head[idx]
        
        # 统一缩放比例
        scale = target_height / img_clean.height
        new_w = int(img_clean.width * scale)
        new_h = target_height
        resized = img_clean.resize((new_w, new_h), Image.LANCZOS)
        
        # 缩放后头部位置（整数）
        scaled_head_x = int(head_cx * scale)
        scaled_head_y = int(head_cy * scale)
        
        # 强制对齐到固定位置（整数像素）
        x_offset = int(head_x - scaled_head_x)
        y_offset = int(head_y - scaled_head_y)
        
        canvas = Image.new('RGBA', frame_size, (0, 0, 0, 0))
        canvas.paste(resized, (x_offset, y_offset), resized)
        processed_frames.append(canvas)
        
        if idx % 10 == 0:
            print(f"  帧{idx}: 偏移=({x_offset},{y_offset})")
    
    # 7. 排列成 sprite sheet
    rows = (total_frames + cols - 1) // cols
    sheet_w = cols * frame_width
    sheet_h = rows * frame_height
    sprite_sheet = Image.new('RGBA', (sheet_w, sheet_h), (0, 0, 0, 0))
    
    for idx, frame in enumerate(processed_frames):
        col = idx % cols
        row = idx // cols
        x = col * frame_width
        y = row * frame_height
        sprite_sheet.paste(frame, (x, y), frame)
    
    # 8. 保存
    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    sprite_sheet.save(output_path)
    print(f"\n=== Sprite sheet 已保存 ===")
    print(f"  路径: {output_path}")
    print(f"  尺寸: {sheet_w}x{sheet_h}")
    print(f"  布局: {cols}列x{rows}行")
    print(f"  单帧: {frame_width}x{frame_height}")
    print(f"  walk: 帧0-{walk_count-1}（{walk_count}帧）")
    if attack_count > 0:
        print(f"  attack: 帧{walk_count}-{total_frames-1}（{attack_count}帧）")
    
    # 9. 验证对齐精度
    print(f"\n=== 对齐精度验证（walk 帧头部在画布中的位置）===")
    for idx in range(0, min(walk_count, 32), 4):
        frame = processed_frames[idx]
        arr = np.array(frame)
        non_transparent = arr[:,:,3] > 10
        h, w = arr.shape[:2]
        top_region = non_transparent[:int(h*0.30), :]
        if top_region.any():
            ys, xs = np.where(top_region)
            canvas_head_x = int(np.mean(xs))
            canvas_head_y = int(np.mean(ys))
            print(f"  walk帧{idx}: 画布中头部=({canvas_head_x},{canvas_head_y}) (目标=({head_x},{head_y}))")
    
    # 清理临时目录
    import shutil
    shutil.rmtree(tmp_dir, ignore_errors=True)
    
    return output_path, walk_count, attack_count, total_frames


def main():
    parser = argparse.ArgumentParser(description='Sprite Sheet 生成工作流')
    parser.add_argument('--video', required=True, help='输入视频路径')
    parser.add_argument('--walk-start', type=int, required=True, help='walk 起始帧')
    parser.add_argument('--walk-end', type=int, required=True, help='walk 结束帧')
    parser.add_argument('--attack-start', type=int, default=None, help='attack 起始帧（可选）')
    parser.add_argument('--attack-end', type=int, default=None, help='attack 结束帧（可选）')
    parser.add_argument('--output', default='output_sheet.png', help='输出路径')
    parser.add_argument('--cols', type=int, default=9, help='列数')
    parser.add_argument('--frame-width', type=int, default=240, help='单帧宽度')
    parser.add_argument('--frame-height', type=int, default=128, help='单帧高度')
    parser.add_argument('--head-x', type=int, default=80, help='头部对齐 x')
    parser.add_argument('--head-y', type=int, default=32, help='头部对齐 y')
    parser.add_argument('--target-height', type=int, default=112, help='缩放目标高度')
    parser.add_argument('--crop-top', type=int, default=10, help='裁剪顶部偏移')
    
    args = parser.parse_args()
    
    build_sprite_sheet(
        video_path=args.video,
        walk_start=args.walk_start,
        walk_end=args.walk_end,
        attack_start=args.attack_start,
        attack_end=args.attack_end,
        output_path=args.output,
        cols=args.cols,
        frame_width=args.frame_width,
        frame_height=args.frame_height,
        head_x=args.head_x,
        head_y=args.head_y,
        target_height=args.target_height,
        crop_top=args.crop_top
    )


if __name__ == '__main__':
    main()
