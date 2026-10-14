// Runs every tests/test-*.js in its own process (several stub globals).
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter(f => /^test-.*\.js$/.test(f)).sort();
let failed = 0;
for (const file of files) {
  const run = spawnSync(process.execPath, [join(dir, file)], { encoding: 'utf8', timeout: 120000 });
  const ok = run.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${file}`);
  if (!ok) console.log((run.stdout + run.stderr).split('\n').filter(l => !/^\s+at /.test(l)).slice(-15).join('\n'));
}
console.log(failed ? `${failed} of ${files.length} test files failed` : `All ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
