"""检测每个模块 import 了但没在正文使用的符号（ESM 单行 import 形态）。"""
import re, glob

for path in sorted(glob.glob('src/*.js')):
    src = open(path, encoding='utf-8').read()
    lines = src.split('\n')
    unused = []
    for idx, line in enumerate(lines):
        m = re.match(r"import \{([^}]*)\} from '\./", line)
        if not m: continue
        names = [n.strip() for n in m.group(1).split(',') if n.strip()]
        # 正文 = 除了所有 import 行以外的内容
        body = '\n'.join(l for i, l in enumerate(lines) if not l.startswith('import '))
        for n in names:
            alias = n.split(' as ')[-1].strip()
            # 单字符/$ 类符号名：前导边界不能用 [\w.$]，否则 $ 永远匹配不到自己
            if re.fullmatch(r'[$_a-zA-Z][\w$]*', alias) and len(alias) == 1:
                pat = r'(?<![\w.])' + re.escape(alias) + r'(?![\w$])'
            else:
                pat = r'(?<![\w.$])' + re.escape(alias) + r'(?![\w$])'
            if not re.search(pat, body):
                unused.append(alias)
    if unused:
        print(f"{path}: {len(unused)} 个未使用 -> {', '.join(unused)}")
