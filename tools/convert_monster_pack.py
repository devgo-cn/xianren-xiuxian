#!/usr/bin/env python3
"""
v3.9 怪物包压缩转换管线
Aekashics 97 只骨骼怪 → assets/db/monsters/<slug>/{ske.json, tex.json, tex.webp}
- 图集: PNG → 半尺寸(LANCZOS) → webp q75  (实测 10~22 倍压缩, 游戏内怪 drawH≤200px 足够)
- tex.json: width/height + SubTexture 全部坐标 ×0.5 (99 骨架均无 mesh, 零骨架风险)
- ske.json: minify 不改内容
- 产出 index.json: 接入注册表(name/tier/qual/armature/anims)
"""
import json, os, glob, re, sys
from PIL import Image

LB = "/root/.codebuddy/artifact/pack_static/Aekashics Librarium - Dragonbones Animated Battlers/Aekashics Librarium - Dragonbones Animated Battlers/Dragonbones Battlers"
MP1 = "/root/.codebuddy/artifact/pack_animated/Aekashics Librarium - Animated Megapack I/Animated Battlers"
OUT = "/root/.codebuddy/artifact/xiuxian-git/assets/db/monsters"
SCALE = 0.5
QUALITY = 75
# 包目录名 → slug / 文档名(与 monster_pack_map.json 对齐)
def slugify(n):
    n = re.sub(r'^x_', '', n)
    n = re.sub(r'^(Aekashics-Librarium-|Ækashics-Librarium-|Тkashics-Librarium-)', '', n)
    s = re.sub(r'[^A-Za-z0-9]+', '_', n).strip('_').lower()
    return s

def tex_scale(t):
    t = dict(t)
    # 画布声明保持原版尺寸(不缩)! core parseTextureAtlasData 默认 scale=1,
    # 画布声明/实际图宽 的比例由 buildFactory 换算成贴图放大系数。
    # 若画布也减半, 贴图会被画成骨骼空间的一半 → 全部贴图与骨骼脱节(散架)。
    subs = []
    for s in t.get("SubTexture", []):
        s = dict(s)
        for k in ("x", "y", "width", "height", "frameX", "frameY", "frameWidth", "frameHeight"):
            if k in s and isinstance(s[k], (int, float)):
                s[k] = round(s[k] * SCALE) if k not in ("frameX", "frameY") else round(s[k] * SCALE)
        subs.append(s)
    t["SubTexture"] = subs
    if "imagePath" in t: t["imagePath"] = re.sub(r'\.png$', '.webp', t["imagePath"], flags=re.I)
    return t

def main():
    tiers = {}
    mpath = "/root/.codebuddy/artifact/monster_pack_map.json"
    if os.path.exists(mpath):
        for e in json.load(open(mpath)):
            tiers[e["dir"].lower()] = e
    os.makedirs(OUT, exist_ok=True)
    index = {}
    jobs = []
    for ske in glob.glob(LB + "/x_*/dragonbones_assets/*_ske.json"):
        jobs.append((os.path.basename(os.path.dirname(os.path.dirname(ske))), ske))
    for ske in glob.glob(MP1 + "/*/dragonbones_assets/*_ske.json"):
        jobs.append((os.path.basename(os.path.dirname(os.path.dirname(ske))), ske))
    for dname, ske in sorted(jobs):
        slug = slugify(dname)
        texj = ske.replace("_ske.json", "_tex.json")
        texi = ske.replace("_ske.json", "_tex.png")
        if not (os.path.exists(texj) and os.path.exists(texi)):
            print("skip(缺图集):", dname); continue
        d = os.path.join(OUT, slug)
        os.makedirs(d, exist_ok=True)
        sj = json.load(open(ske))
        tj = tex_scale(json.load(open(texj)))
        img = Image.open(texi)
        w, h = img.size
        if w % 2 or h % 2:
            img = img.crop((0, 0, w - w % 2, h - h % 2))
        img = img.resize((w // 2, h // 2), Image.LANCZOS)
        img.save(os.path.join(d, "tex.webp"), "WEBP", quality=QUALITY, method=6)
        json.dump(sj, open(os.path.join(d, "ske.json"), "w"), separators=(",", ":"), ensure_ascii=False)
        json.dump(tj, open(os.path.join(d, "tex.json"), "w"), separators=(",", ":"), ensure_ascii=False)
        arm = sj.get("armature", [{}])
        anims = []
        for a in arm: anims += [an.get("name") for an in a.get("animation", [])]
        meta = tiers.get(re.sub(r'^x_(Aekashics-|Тkashics-|Ækashics-)?(Librarium-)?', '', dname).lower(), {}) or tiers.get(dname.lower(), {})
        index[slug] = {
            "dir": dname, "armature": arm[0].get("name") if arm else slug,
            "anims": anims, "tex": [w // 2, h // 2],
            "tier": meta.get("tier"), "qual": meta.get("qual"),
            "has_skill": any("Skill" in a or "Ultimate" in a for a in anims),
        }
    json.dump(index, open(os.path.join(OUT, "index.json"), "w"), separators=(",", ":"), ensure_ascii=False, indent=0)
    tot = sum(os.path.getsize(p) for p in glob.glob(OUT + "/*/*") ) + os.path.getsize(os.path.join(OUT, "index.json"))
    print(f"产出 {len(index)} 只怪 → {OUT}  总体积 {tot/1048576:.2f} MB")

if __name__ == "__main__":
    main()
