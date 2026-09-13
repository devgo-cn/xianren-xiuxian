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
INCLUDE_FILES = ["index.html", "game.js", "dt-theme.css", "bg.js", "fx2d.js"]
# 运行时资源目录
INCLUDE_DIRS = ["assets"]
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
