"""检测「相对 HEAD 被删掉、但正文仍在引用」的导入符号。

背景：批量清理未使用导入时，单字符符号（如 `$`）容易被正则边界误判而误删，
导致运行时 `X is not defined`，且 node --check / 静态守卫都查不出来。
本工具以 git HEAD 为基准做回归比对。
"""
import re, glob, subprocess


def src_at(rev, path):
    """rev='WORK' 时读工作区，否则读 git 指定版本。"""
    if rev == 'WORK':
        return open(path, encoding='utf-8').read()
    r = subprocess.run(['git', 'show', f'{rev}:{path}'], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ''


def imports_of(src):
    """解析 ESM 单行 import，返回 {模块路径: [符号名,...]}。"""
    out = {}
    for line in src.split('\n'):
        m = re.match(r"import \{([^}]*)\} from '(\./[^']+)'", line)
        if not m:
            continue
        names = [n.strip() for n in m.group(1).split(',') if n.strip()]
        out.setdefault(m.group(2), []).extend(names)
    return out


def ident_ref(alias, body):
    """判断 alias 是否以标识符形式出现在正文（非 import 行）中。"""
    return re.search(r'(?<![\w.$])' + re.escape(alias) + r'(?![\w$])', body) is not None


bad = []
for path in sorted(glob.glob('src/*.js')):
    head_imp = imports_of(src_at('HEAD', path))
    work_src = src_at('WORK', path)
    work_imp = imports_of(work_src)
    if not work_src:
        continue

    removed = set()
    for mod, names in head_imp.items():
        removed |= set(names) - set(work_imp.get(mod, []))
    if not removed:
        continue

    body = '\n'.join(l for l in work_src.split('\n') if not l.startswith('import '))
    for n in sorted(removed):
        alias = n.split(' as ')[-1].strip()
        if ident_ref(alias, body):
            bad.append((path, alias))

if bad:
    print(f"❌ 有 {len(bad)} 个符号被删除但正文仍在使用：")
    for p, n in bad:
        print(f"   {p}: {n}")
    raise SystemExit(1)
print("✅ 无「已删除但仍被引用」的导入")
