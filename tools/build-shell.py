#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""打包 App 壳资源：assets/www/ + assets/bundle.json

── 这个脚本解决什么问题 ────────────────────────────────────────────────
App 壳（Android WebView）从 apk 内的 assets/www/ 载入游戏，并用
assets/bundle.json 做本地资源校验/比对。两者必须与仓库当前源码一致，
否则壳里跑的还是旧版本。

产物结构（与线上 apk 内 assets/ 一致）：
    <out>/www/index.html
    <out>/www/src/...
    <out>/www/assets/...
    <out>/www/vendor/pixi.min.mjs
    <out>/bundle.json

bundle.json 与 ota/manifest.json 同构（{version, rev, files:{路径: sha256}}），
直接复用同一份数据 —— 只有一份口径，不会两套清单打架。

用法:
    python3 tools/build-shell.py                 # 输出到 build/shell/
    python3 tools/build-shell.py --out /tmp/壳    # 指定输出目录
    python3 tools/build-shell.py --zip           # 额外打一个 zip

加新素材后不需要改本脚本：只要它出现在 ota/manifest.json 里就会被带上，
而 ota/manifest.json 由 tools/ota-manifest.py 扫描生成。
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "ota", "manifest.json")


def ensure_manifest():
    """清单必须与当前源码一致 —— 先重生成再读，避免打包旧清单。"""
    subprocess.run([sys.executable, os.path.join(ROOT, "tools", "ota-manifest.py")],
                   check=True, cwd=ROOT)
    with open(MANIFEST, encoding="utf-8") as fp:
        return json.load(fp)


def build(out, do_zip):
    man = ensure_manifest()
    files = man["files"]

    www = os.path.join(out, "www")
    if os.path.isdir(www):
        shutil.rmtree(www)
    os.makedirs(www, exist_ok=True)

    missing = []
    for rel in files:
        src = os.path.join(ROOT, rel)
        if not os.path.isfile(src):
            missing.append(rel)
            continue
        dst = os.path.join(www, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)

    if missing:
        print("!! 清单里有但磁盘上不存在（已跳过）:", missing)
        return 1

    with open(os.path.join(out, "bundle.json"), "w", encoding="utf-8") as fp:
        json.dump(man, fp, ensure_ascii=False, indent=2, sort_keys=True)
        fp.write("\n")

    total = sum(os.path.getsize(os.path.join(ROOT, f)) for f in files)
    print(f"壳资源已生成  {out}")
    print(f"  文件数 {len(files)}   合计 {total/1024/1024:.2f} MB   rev {man['rev']}   version {man['version']}")

    if do_zip:
        zpath = out.rstrip("/\\") + ".zip"
        if os.path.exists(zpath):
            os.remove(zpath)
        shutil.make_archive(out.rstrip("/\\"), "zip", root_dir=out)
        print(f"  zip -> {zpath}  ({os.path.getsize(zpath)/1024/1024:.2f} MB)")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "build", "shell"))
    ap.add_argument("--zip", action="store_true", help="额外产出一个 zip")
    a = ap.parse_args()
    sys.exit(build(a.out, a.zip))


if __name__ == "__main__":
    main()
