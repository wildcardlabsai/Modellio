/**
 * End-to-end check for MODELLIO 2.3 Stage 2 solid features: Shell (click a face to leave open),
 * Hole (click a flat face; simple, counterbore, row pattern), Draft; each previewed by the real
 * engine with an exact volume, applied as one undo step, listed in the Inspector and the Features
 * view, editable, and kept after saving and reopening.
 *
 *   node scripts/e2e-solid-features.mjs [url] [screenshotDir]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
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

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => localStorage.setItem('modellio:onboarded', '1'));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const S = (fn, arg) => page.evaluate(fn, arg);
const until = async (fn, ms = 30000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await fn();
    if (v) return v;
    await page.waitForTimeout(100);
  }
  return fn();
};
const obj = (id) => S((id) => window.modellio.store.getState().doc.objects[id], id);
const ops = async (id) => (await obj(id)).feature.ops;
const previewVolume = () =>
  until(() =>
    S(() => {
      const p = window.modellio.features.getState().session?.preview;
      return p?.state === 'ok' && p.build.volume;
    }),
  );
const close = (a, b, tol = 0.5) => Math.abs(a - b) < tol;
const field = (label) => page.getByLabel(label, { exact: true });
const setField = async (label, v) => {
  await field(label).fill(String(v));
  await field(label).press('Enter');
};
/** Click the world point (it must be on the visible part). */
const clickAt = async (p) => {
  const s = await S(([x, y, z]) => window.modellio.worldToScreen(x, y, z), p);
  await page.mouse.click(s.x, s.y);
};

await page.goto(`${URL}/?studio=design`, { waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
await page.waitForTimeout(1000);

// A precise 20 mm cube resting on the plate (its top face is at z = 20).
const box = await S(() => window.modellio.store.getState().addShape('box'));
await S((id) => window.modellio.store.getState().convertToSolid(id), box);
await until(async () => (await obj(box))?.shape === 'solid');
const at = (await obj(box)).transform.position;
const top = [at[0], at[1], at[2] + 10];

// 1. Shell: from the Inspector, click the top face to leave it open.
await page.getByRole('tab', { name: /^Features/ }).click();
await page.getByTestId('solid-shell').click();
const dialog = page.getByRole('dialog', { name: 'Shell' });
await dialog.waitFor();
await until(() => S(() => !!window.modellio.features.getState().session?.before));
await clickAt(top);
check('1. Clicking the top face chooses it to leave open', /1 face open/.test(await page.getByTestId('feature-face-count').textContent()));
await setField('Shell wall (mm)', 2);
const shellVol = await previewVolume();
check('1b. The preview is an exact open box with 2 mm walls', close(shellVol, 8000 - 16 * 16 * 18), shellVol?.toFixed?.(2));
await page.getByTestId('feature-apply').click();
check('1c. Apply records one shell operation', (await ops(box)).map((o) => o.kind).join() === 'shell');
check('1d. The Inspector lists it', /Shell 2 mm walls · 1 open face/.test(await page.getByTestId('solid-ops').textContent()));
await page.keyboard.press('Control+z');
check('1e. One undo removes it', (await ops(box)).length === 0);

// 2. Hole: from the Features menu, click the top face; through, Ø4.
await page.getByTestId('features-menu').click();
await page.getByRole('button', { name: /^Hole\s*Drill/ }).click();
await page.getByRole('dialog', { name: 'Hole' }).waitFor();
await until(() => S(() => !!window.modellio.features.getState().session?.before));
await clickAt(top);
check('2. Clicking the top face places the hole', /At /.test(await page.getByTestId('hole-position').textContent()));
await page.getByRole('button', { name: 'Centre on the face' }).click();
check(
  '2b. "Centre on the face" puts it in the middle',
  /At 0\.00, 0\.00, 10\.00 mm/.test(await page.getByTestId('hole-position').textContent()),
);
await setField('Hole diameter (mm)', 4);
let v = await previewVolume();
check('2c. A Ø4 through-hole removes exactly π·2²·20 mm³', close(v, 8000 - Math.PI * 4 * 20), v?.toFixed?.(2));
await page.getByRole('radiogroup', { name: 'Hole style' }).getByRole('radio', { name: 'Counterbore' }).click();
await setField('Counterbore diameter (mm)', 8);
await setField('Counterbore depth (mm)', 3);
v = await until(async () => {
  const x = await previewVolume();
  return close(x, 8000 - Math.PI * 16 * 3 - Math.PI * 4 * 17) && x;
});
check('2d. Counterbore Ø8 × 3 mm is exact', !!v, String(v));
await page.getByRole('radiogroup', { name: 'Hole style' }).getByRole('radio', { name: 'Simple' }).click();
// Ø2 holes 4 mm apart from the centre (x = 0, 4, 8): all three fit inside the 20 mm cube.
await setField('Hole diameter (mm)', 2);
await page.getByRole('radiogroup', { name: 'Hole pattern' }).getByRole('radio', { name: 'Row' }).click();
await setField('Number of holes', 3);
await setField('Hole spacing (mm)', 4);
v = await until(async () => {
  const x = await previewVolume();
  return close(x, 8000 - 3 * Math.PI * 1 * 20) && x;
});
check('2e. A row of 3 holes removes three holes', !!v, String(v));
await page.getByTestId('feature-apply').click();
const hole = (await ops(box))[0];
check('2f. Apply records the hole with its row pattern', hole?.kind === 'hole' && hole.pattern?.count === 3 && hole.hole.diameter === 2);

// 3. Draft (faces chosen through the tool; the side faces may face away from the camera).
await page.getByTestId('features-menu').click();
await page.getByRole('button', { name: /^Draft\s*Taper/ }).click();
await page.getByRole('dialog', { name: 'Draft' }).waitFor();
const sides = await until(() =>
  S(() =>
    window.modellio.features
      .getState()
      .session?.before?.faces.filter((f) => f.ref.kind === 'plane' && Math.abs(f.ref.normal[2]) < 1e-6)
      .map((f) => f.ref),
  ),
);
for (const f of sides) await S((f) => window.modellio.features.getState().toggleFace(f), f);
const faceCount = await page.getByTestId('feature-face-count').textContent();
check('3. Four side faces chosen', /4 faces selected/.test(faceCount), faceCount);
await setField('Draft angle (°)', 5);
v = await previewVolume();
// The holes come after the draft is applied on top of them: compare with the engine's own sum.
check('3b. The draft preview builds and is smaller than before', v && v < 8000 - 3 * Math.PI * 1 * 20, String(v));
await page.getByTestId('feature-apply').click();
check('3c. Apply adds the draft after the hole', (await ops(box)).map((o) => o.kind).join() === 'hole,draft');

// 4. Features view and editing.
await page.getByRole('radiogroup', { name: 'Browser view' }).getByRole('radio', { name: 'Features' }).click();
const tree = page.getByTestId('feature-tree');
check(
  '4. The Features view lists the hole and the draft',
  /Hole/.test(await tree.textContent()) && /Draft5°/.test((await tree.textContent()).replace(/\s/g, '')),
);
await tree.getByRole('button', { name: 'Edit hole' }).click();
await page.getByRole('dialog', { name: 'Hole' }).waitFor();
check(
  '4b. Editing the hole opens it with its size and pattern',
  (await field('Hole diameter (mm)').inputValue()).startsWith('2') && (await field('Number of holes').inputValue()) === '3',
);
await page.getByRole('button', { name: 'Cancel' }).click();

// 5. Saved and reopened.
await S(() => window.modellio.projects.getState().saveNow());
await page.reload({ waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
const after = await until(async () => (await obj(box))?.feature?.ops?.length === 2 && (await ops(box)));
check('5. The hole and draft survive saving and reopening', after && after[0].kind === 'hole' && after[1].kind === 'draft');
await page.screenshot({ path: `${OUT}/solid-features.png` });

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
