#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""扫描运行时资源，生成 ota/manifest.json（App 资源热更新清单）。

rev 由所有文件的 sha256 汇总得出，所以**内容一变 rev 就变**，不需要手动改版本号。
GitHub Action 会在每次 push 后自动跑本脚本并提交清单。
"""
import hashlib
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "ota", "manifest.json")

# 运行时必需文件
#   game.js 现在是兼容占位（仅转发到 src/main.js），保留在清单里是因为
#   平台注入脚本/旧书签仍可能请求它，缺失会导致 404。
INCLUDE_FILES = ["index.html", "game.js", "dt-theme.css", "bg.js", "fx2d.js"]
# 运行时资源目录
INCLUDE_DIRS = ["assets"]
# v3.0: game.js 已按拓扑层拆入 src/*.js，这些模块同样是【运行时必需】——
#       不纳入清单会导致热更新下发新 game.js（垫片）却不下发新模块，
#       App 端加载到旧模块 → 白屏 / 版本错乱。
#       故必须一并纳入，且纳入方式用目录扫描而非写死文件名，
#       这样后续再拆模块时无需再改本脚本。
# v3.1: index.html 改为直接加载 src/main.js（唯一 ES Module 入口），
#       src/50-battle.js 也由 index.html 内联脚本抽取而来 —— 二者都在本目录扫描范围内。
INCLUDE_JS_DIRS = ["src"]
# 自托管第三方库目录（目前只有 vendor/pixi.min.mjs，PixiJS 8.20.1，约 801KB）
#   v3.4 起纳入热更清单，这样 App 内切 ?render=pixi 才能直接生效。
#   代价：每个用户【一次性】多下约 800KB —— 清单是按文件 sha256 比对的，
#         pixi 内容不变就不会重复下载，不会每次热更都背上这 800KB。
#   只收 .js/.mjs，避免把 source map / README 之类也打进清单。
INCLUDE_LIB_DIRS = ["vendor"]
LIB_EXT = (".js", ".mjs")
# 不参与热更新的目录（素材源文件、参考项目）
EXCLUDE_PREFIX = ("assets/raw/", "assets/ref/")


def collect():
    files = set()
    for f in INCLUDE_FILES:
        if os.path.isfile(os.path.join(ROOT, f)):
            files.add(f)
    for d in INCLUDE_DIRS:
        base = os.path.join(ROOT, d)
        for dirpath, _dirnames, filenames in os.walk(base):
            for fn in filenames:
                rel = os.path.relpath(os.path.join(dirpath, fn), ROOT).replace(os.sep, "/")
                if rel.startswith(EXCLUDE_PREFIX):
                    continue
                files.add(rel)
    # 拆分后的模块目录：只收 .js，避免把临时文件/编辑器备份也打进清单
    for d in INCLUDE_JS_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirnames, filenames in os.walk(base):
            for fn in filenames:
                if not fn.endswith(".js"):
                    continue
                rel = os.path.relpath(os.path.join(dirpath, fn), ROOT).replace(os.sep, "/")
                files.add(rel)
    for d in INCLUDE_LIB_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirnames, filenames in os.walk(base):
            for fn in filenames:
                if not fn.endswith(LIB_EXT):
                    continue
                rel = os.path.relpath(os.path.join(dirpath, fn), ROOT).replace(os.sep, "/")
                files.add(rel)
    return sorted(files)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fp:
        for chunk in iter(lambda: fp.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def read_version():
    """从 index.html 的 window.APP_VER 读取当前版本号（唯一来源）。

    支持 主.次（如 2.3）和 主.次.修（如 2.3.1）两种格式。
    """
    try:
        with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as fp:
            m = re.search(r'window\.APP_VER\s*=\s*"(\d+\.\d+(?:\.\d+)?)"', fp.read(6000))
            return m.group(1) if m else "0.0.0"
    except OSError:
        return "0.0.0"


def main():
    files = collect()
    hashes = {f: sha256(os.path.join(ROOT, f)) for f in files}
    canonical = json.dumps(hashes, sort_keys=True, separators=(",", ":"))
    rev = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]

    manifest = {
        "version": read_version(),
        "rev": rev,
        "files": hashes,
    }
    new = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"

    old = None
    if os.path.isfile(OUT):
        with open(OUT, encoding="utf-8") as fp:
            old = fp.read()

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if old != new:
        with open(OUT, "w", encoding="utf-8") as fp:
            fp.write(new)
        print(f"清单已更新  rev={rev}  version={manifest['version']}  文件数={len(hashes)}")
    else:
        print(f"清单无变化  rev={rev}  文件数={len(hashes)}")


if __name__ == "__main__":
    main()
