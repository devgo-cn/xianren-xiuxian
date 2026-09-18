import { spawnSync } from 'child_process';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter(f => f.startsWith('test_') && f.endsWith('.mjs')).sort();
let allPass = true;
for (const f of files) {
  const r = spawnSync('node', [join(dir, f)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/通过 (\d+) \/ (\d+)/);
  const ok = r.status === 0;
  if (!ok) allPass = false;
  const mark = ok ? '[PASS]' : '[FAIL]';
  const score = m ? (m[1] + '/' + m[2]) : 'ERROR';
  console.log(mark + ' ' + f.padEnd(22) + ' ' + score);
  if (!ok) console.log(out.split('\n').filter(function(l){return l.indexOf('FAIL')>=0;}).join('\n'));
}
console.log('');
console.log(allPass ? '全部通过' : '存在失败');
process.exit(allPass ? 0 : 1);
