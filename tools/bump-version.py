#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""版本号统一管理入口 —— 改版本号只跑这一个脚本。

用法:
    python3 tools/bump-version.py 2.4          # 设为 2.4
    python3 tools/bump-version.py 2.4 --build 3  # 设为 2.4，构建号 r3
    python3 tools/bump-version.py --print       # 只打印当前版本，不修改

自动同步的位置:
    1. index.html  → window.APP_VER
    2. download/index.html → 页面上所有版本号显示、APK 下载链接、meta description
    3. _probe_e2e.html / _probe_pills.html → 探测页 window.APP_VER
    4. ota/manifest.json → 调用 ota-manifest.py 重新生成（version 字段自动同步）

不改的位置:
    - game.js / bg.js / fx2d.js 中的 GAME_VER / CACHE_VER：运行时从 APP_VER 派生，无需手动改
    - 代码注释中的历史版本号（v1.7.x / v1.9.x 等）：变更日志，保留不动
    - SAVE_KEY 等 schema 版本号：存档格式版本，与 app 版本独立
"""
import argparse
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_file(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def write_file(rel, content):
    path = os.path.join(ROOT, rel)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  ✓ {rel}")


def get_current_version():
    """从 index.html 读取当前 APP_VER。"""
    html = read_file("index.html")
    m = re.search(r'window\.APP_VER\s*=\s*"([^"]+)"', html)
    return m.group(1) if m else "0.0.0"


def update_index_html(version):
    """更新 index.html 中的 window.APP_VER。"""
    html = read_file("index.html")
    new_html = re.sub(
        r'window\.APP_VER\s*=\s*"[^"]*"',
        f'window.APP_VER="{version}"',
        html,
        count=1,
    )
    if new_html != html:
        write_file("index.html", new_html)
    else:
        print(f"  - index.html (无需修改)")


def update_download_page(version, build):
    """更新 download/index.html 中的所有版本号引用。

    处理的位置:
    - <meta name="description"> 中的版本
    - .chip 中的版本标签 (vX.Y.Z rN)
    - .chip 中的热更目标版本
    - APK 下载链接 href 和 download 属性
    - 正文文字中的版本号引用
    """
    path = os.path.join(ROOT, "download", "index.html")
    if not os.path.isfile(path):
        print("  - download/index.html (不存在，跳过)")
        return

    html = read_file(os.path.join("download", "index.html"))
    original = html

    build_tag = f" r{build}" if build else ""

    # 1. meta description
    html = re.sub(
        r'(<meta name="description" content="[^"]*?)v?\d+\.\d+(\.\d+)?',
        rf'\g<1>v{version}',
        html,
    )

    # 2. 版本 chip: <span class="chip">v1.10.1 r4</span>
    html = re.sub(
        r'<span class="chip">v?\d+\.\d+(\.\d+)?(\s*r\d+)?</span>',
        f'<span class="chip">v{version}{build_tag}</span>',
        html,
    )

    # 3. 热更目标 chip: <span class="chip">装后自动热更到 1.10.2</span>
    html = re.sub(
        r'(<span class="chip">装后自动热更到\s*)\d+\.\d+(\.\d+)?(</span>)',
        rf'\g<1>{version}\g<3>',
        html,
    )

    # 4. APK 下载链接: href="./xianren-xiuxian-v1.10.1-r4.apk"
    #    download="闲人修仙-v1.10.1-r4.apk"
    apk_name = f"xianren-xiuxian-v{version}"
    if build:
        apk_name += f"-r{build}"
    apk_name += ".apk"
    html = re.sub(
        r'href="\./xianren-xiuxian-v?[\d.]+(-r\d+)?\.apk"',
        f'href="./{apk_name}"',
        html,
    )
    html = re.sub(
        r'download="闲人修仙-v?[\d.]+(-r\d+)?\.apk"',
        f'download="闲人修仙-v{version}{("-r" + build) if build else ""}.apk"',
        html,
    )

    # 5. 正文中的版本号引用（"内置资源与线上 v1.10.0 完全一致"等）
    html = re.sub(
        r'(内置资源与线上\s*)v?\d+\.\d+(\.\d+)?',
        rf'\g<1>v{version}',
        html,
    )
    html = re.sub(
        r'(内置资源已同步到\s*)v?\d+\.\d+(\.\d+)?',
        rf'\g<1>v{version}',
        html,
    )
    html = re.sub(
        r'(本包内置的是\s*)v?\d+\.\d+(\.\d+)?',
        rf'\g<1>v{version}',
        html,
    )
    html = re.sub(
        r'(线上已是\s*)v?\d+\.\d+(\.\d+)?',
        rf'\g<1>v{version}',
        html,
    )
    html = re.sub(
        r'(热更完成\s*→\s*)\d+\.\d+(\.\d+)?',
        rf'\g<1>{version}',
        html,
    )

    if html != original:
        write_file(os.path.join("download", "index.html"), html)
    else:
        print("  - download/index.html (无需修改)")


def update_probe_files(version):
    """更新探测/测试页面中的 window.APP_VER。

    处理 _probe_e2e.html / _probe_pills.html 等测试页。
    """
    probe_files = ["_probe_e2e.html", "_probe_pills.html"]
    for rel in probe_files:
        path = os.path.join(ROOT, rel)
        if not os.path.isfile(path):
            print(f"  - {rel} (不存在，跳过)")
            continue
        html = read_file(rel)
        new_html = re.sub(
            r'window\.APP_VER\s*=\s*"[^"]*"',
            f'window.APP_VER="{version}"',
            html,
            count=1,
        )
        if new_html != html:
            write_file(rel, new_html)
        else:
            print(f"  - {rel} (无需修改)")


def regenerate_manifest():
    """调用 ota-manifest.py 重新生成热更新清单。"""
    script = os.path.join(ROOT, "tools", "ota-manifest.py")
    if not os.path.isfile(script):
        print("  - ota/manifest.json (ota-manifest.py 不存在，跳过)")
        return
    result = subprocess.run(
        [sys.executable, script],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        print(f"  ✓ ota/manifest.json ({result.stdout.strip()})")
    else:
        print(f"  ✗ ota/manifest.json 生成失败: {result.stderr.strip()}")


def main():
    parser = argparse.ArgumentParser(
        description="版本号统一管理入口 —— 改版本号只跑这一个脚本"
    )
    parser.add_argument(
        "version",
        nargs="?",
        help="目标版本号，如 2.4 / 2.4.1",
    )
    parser.add_argument(
        "--build",
        help="构建号（APK 用），如 3 表示 r3",
    )
    parser.add_argument(
        "--print",
        action="store_true",
        help="只打印当前版本号，不修改任何文件",
    )
    args = parser.parse_args()

    current = get_current_version()

    if args.print:
        print(f"当前版本: {current}")
        return

    if not args.version:
        parser.error("请指定目标版本号，或使用 --print 查看当前版本")

    # 校验版本号格式
    if not re.match(r"^\d+\.\d+(\.\d+)?$", args.version):
        parser.error(f"版本号格式不正确: {args.version}（应为 主.次 或 主.次.修）")

    target = args.version
    build = args.build

    print(f"\n版本号变更: {current} → {target}" + (f" (构建 r{build})" if build else ""))
    print("=" * 50)

    # 1. 更新 index.html（唯一来源）
    print("\n[1/4] 更新 index.html APP_VER")
    update_index_html(target)

    # 2. 更新下载页
    print("\n[2/4] 同步 download/index.html")
    update_download_page(target, build)

    # 3. 更新探测页面
    print("\n[3/4] 同步探测页面 APP_VER")
    update_probe_files(target)

    # 4. 重新生成 manifest
    print("\n[4/4] 重新生成 ota/manifest.json")
    regenerate_manifest()

    print("\n" + "=" * 50)
    print(f"完成！版本号已统一为 {target}")
    print("\n下一步:")
    print("  git add -A && git commit -m 'chore: 版本号 → v{}'".format(target))
    if build:
        print(f"\n注意: APK 文件名已更新为 xianren-xiuxian-v{target}-r{build}.apk")
        print("      请确保 download/ 目录下存在对应 APK 文件，或重新构建 APK。")


if __name__ == "__main__":
    main()
