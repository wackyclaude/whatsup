// Starts the test-only probe Worker in workerd and runs its self-test.
//   npm run test:runtime            → run checks, exit
//   npm run test:runtime -- --serve → keep it running at http://127.0.0.1:8788 (signed in, fake data)
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serve = process.argv.includes('--serve');
const proc = spawn('npx', ['wrangler', 'dev', '--config', join(here, 'probe', 'wrangler.jsonc'), '--port', '8788', '--ip', '127.0.0.1'], {
  cwd: join(here, '..'), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TZ: 'Europe/Amsterdam' },
});
let log = '';
proc.stdout.on('data', (d) => { log += d; });
proc.stderr.on('data', (d) => { log += d; });

const stop = (code) => { proc.kill('SIGTERM'); process.exit(code); };
let res;
for (let i = 0; i < 60; i++) {
  try {
    res = await fetch('http://127.0.0.1:8788/__selftest');
    break;
  } catch (e) {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
if (!res) {
  console.error('probe did not start\n', log.slice(-2000));
  stop(1);
}
const out = await res.json();
for (const r of out.results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : `  → ${JSON.stringify(r.detail)}`}`);
console.log(out.ok ? 'runtime checks passed' : 'runtime checks FAILED', out.calls);
if (serve && out.ok) {
  console.log('Serving signed-in dashboard with fake data at http://127.0.0.1:8788 (Ctrl-C to stop)');
} else {
  stop(out.ok ? 0 : 1);
}
