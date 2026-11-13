/**
 * End-to-end check for the refinement round: reliability, direct
 * manipulation, printing tools, performance, accessibility, onboarding and
 * product features. Driven through the real UI in Chromium.
 *
 *   node scripts/e2e-phase5.mjs [url] [screenshotDir]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.argv[2] ?? 'http://localhost:5173';
const OUT = process.argv[3] ?? 'e2e-results';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const close = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
// Skip the first-run tour for the feature sections (it has its own section).
await context.addInitScript(() => {
  if (!location.search.includes('tour')) localStorage.setItem('modellio:onboarded', '1');
});
const page = await context.newPage();
const errors = [];
const expectedErrors = [/Simulated viewport failure/, /UI crash contained/, /The above error occurred/, /QuotaExceededError/];
// While the crash test tears the canvas down, drei <Html> roots warn about unmounting mid-render. Allowed only then.
let inCrashTest = false;
const allowed = (msg) => expectedErrors.some((r) => r.test(msg)) || (inCrashTest && /synchronously unmount a root/.test(msg));
page.on('pageerror', (e) => !allowed(e.message) && errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !allowed(m.text()) && errors.push(m.text()));

const S = (fn, arg) => page.evaluate(fn, arg);
const state = () =>
  S(() => {
    const s = window.modellio.store.getState();
    return { doc: s.doc, selection: s.selection, past: s.history.past.length };
  });
const waitFor = async (fn, ms = 6000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await fn()) return true;
    await page.waitForTimeout(100);
  }
  return false;
};
const screen = (p) => S(([x, y, z]) => window.modellio.worldToScreen(x, y, z), p);
const bounds = (ids) =>
  S((ids) => {
    const { store, hierarchy } = window.modellio;
    const b = hierarchy.worldBoundsOf(store.getState().doc, ids);
    return { min: b.min.toArray(), max: b.max.toArray() };
  }, ids);
const reset = () =>
  S(() => {
    const s = window.modellio.store.getState();
    s.loadDocument({ schemaVersion: 1, objects: {}, rootIds: [], settings: { units: 'mm', workplane: [200, 200] } });
    s.setTool('select');
  });
const download = async (trigger) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const file = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(file);
  return file;
};
const home = async () => {
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(800);
};

await page.goto(URL, { waitUntil: 'networkidle' });
await waitFor(async () => (await page.getByTestId('save-status').textContent())?.includes('Saved'));

// ===================== Reliability =====================
{
  await page.getByRole('button', { name: 'My Projects' }).click();
  check(
    'R1. My Projects shows storage usage and protection status',
    await page.getByTestId('storage-info').isVisible(),
    await page.getByTestId('storage-info').textContent(),
  );
  await page.getByRole('button', { name: 'Design', exact: true }).click();

  inCrashTest = true;
  await S(() => window.modellio.debug.setState({ crashViewport: true }));
  check(
    'R2. A 3D-view crash is contained (panels keep working)',
    await waitFor(() => page.getByText('The 3D view stopped working').isVisible()),
  );
  await page.locator('button[title^="Add Box "]').click();
  check('R2b. …shapes can still be added while the view is down', (await state()).doc.rootIds.length === 1);
  await page.getByRole('button', { name: 'Restart 3D view' }).click();
  check(
    'R2c. Restart brings the 3D view back',
    await waitFor(async () => (await page.locator('[data-testid=viewport] canvas').count()) === 1),
  );
  await page.waitForTimeout(500);
  inCrashTest = false;

  // Simulate a full disk: every IndexedDB write fails with QuotaExceededError.
  await S(() => {
    const orig = IDBObjectStore.prototype.put;
    window.__restorePut = () => (IDBObjectStore.prototype.put = orig);
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('quota', 'QuotaExceededError');
    };
  });
  await S(() => window.modellio.store.getState().addShape('sphere'));
  check(
    'R3. A full disk is reported clearly instead of failing silently',
    await waitFor(async () => (await page.getByTestId('save-status').textContent())?.includes('Not saved'), 5000),
  );
  check('R3b. …with advice to back up', ((await S(() => window.modellio.projects.getState().error)) ?? '').includes('storage is full'));
  await S(() => window.__restorePut());
  await page.keyboard.press('Control+s');
  check(
    'R3c. Saving works again once space is available',
    await waitFor(async () => (await page.getByTestId('save-status').textContent())?.includes('Saved')),
  );
  await reset();
}

void [close, screen, bounds, download, home]; // helpers used by the sections below

// @@SECTIONS@@

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
