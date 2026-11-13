/**
 * Run every browser workflow suite against the production build.
 *
 *   npm run build && npm run e2e          # serves dist/ with `vite preview`
 *   E2E_URL=http://localhost:5173 npm run e2e   # or test a running dev server
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const suites = fs
  .readdirSync('scripts')
  .filter((f) => /^e2e-.*\.mjs$/.test(f))
  .sort();
const OUT = process.env.E2E_OUT ?? 'e2e-results';
let url = process.env.E2E_URL;
let server = null;

async function waitForServer(target, ms = 30000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try {
      if ((await fetch(target)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server at ${target} did not start`);
}

if (!url) {
  if (!fs.existsSync('dist/index.html')) {
    console.error('No production build found. Run `npm run build` first (or set E2E_URL).');
    process.exit(1);
  }
  url = 'http://localhost:4173';
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
  await waitForServer(url);
}

let failed = 0;
for (const suite of suites) {
  console.log(`\n▶ ${suite}`);
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [`scripts/${suite}`, url, OUT], { stdio: 'inherit' });
    p.on('exit', resolve);
  });
  if (code !== 0) failed++;
}
server?.kill();
console.log(`\n${suites.length - failed}/${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
