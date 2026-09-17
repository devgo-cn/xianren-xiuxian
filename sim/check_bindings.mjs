// 全链路 import/export 绑定静态校验
// 用法: node sim/check_bindings.mjs
// 扫描 src/*.js 的具名 import，与目标文件的具名 export 比对，
// 防 "模块经转导链缺 re-export" 类启动崩溃（node --check 查不出跨文件绑定）。
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = readdirSync(ROOT).filter(f => f.endsWith('.js')).sort();

const exports = {}; // file -> Set(导出名)
const imports = []; // {file, name, from}

for (const f of files) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  const set = new Set();
  // export { A, B as C, D } [from '...']
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?\s*;?/g)) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const n of names) {
      const as = n.match(/^(?:[\w$]+)\s+as\s+([\w$]+)$/);
      set.add(as ? as[1] : n.split(/\s+/)[0]);
    }
    if (m[2] && !m[1].includes('*')) {
      // re-export 同时也是对源文件绑定合法性的声明，登记导入校验
      const from = m[2].replace('./', '');
      for (const n of names) {
        const as = n.match(/^(?:[\w$]+)\s+as\s+([\w$]+)$/);
        imports.push({ file: f, name: as ? as[1] : n.split(/\s+/)[0], from });
      }
    }
  }
  // export const/let/var/function/class Name
  for (const m of src.matchAll(/export\s+(?:const|let|var|function\*?|class)\s+([\w$]+)/g)) set.add(m[1]);
  exports[f] = set;
}

let bad = 0;
for (const f of files) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const from = m[2].replace('./', '');
    for (const raw of m[1].split(',')) {
      const n = raw.trim();
      if (!n) continue;
      const as = n.match(/^(?:[\w$]+)\s+as\s+([\w$]+)$/);
      const name = as ? n.match(/^([\w$]+)/)[1] : n;
      imports.push({ file: f, name, from });
    }
  }
}
for (const im of imports) {
  if (!(im.from in exports)) { console.log(`MISSING MODULE ${im.file}: '${im.from}' 不存在`); bad++; continue; }
  if (!exports[im.from].has(im.name)) { console.log(`MISSING EXPORT ${im.file}: '${im.name}' 未在 ${im.from} 导出（转导链缺 re-export?）`); bad++; }
}
console.log(bad === 0 ? `BINDINGS_OK (${files.length} files, ${imports.length} bindings)` : `BINDINGS_FAIL: ${bad} 处缺失`);
process.exit(bad === 0 ? 0 : 1);
