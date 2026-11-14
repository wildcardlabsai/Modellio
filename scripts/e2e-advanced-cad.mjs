/**
 * End-to-end check for MODELLIO 2.1 precise solids (OpenCascade). Step 1: making a shape a
 * precise solid, exact volumes, resizing, undo, saving and reopening.
 *
 *   node scripts/e2e-advanced-cad.mjs [url] [screenshotDir]
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
const until = async (fn, ms = 60000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await fn();
    if (v) return v;
    await page.waitForTimeout(150);
  }
  return fn();
};
const obj = (id) => S((id) => window.modellio.store.getState().doc.objects[id], id);
const renderedTriangles = (id) =>
  S((id) => {
    let n = 0;
    window.modellio?.viewport?.scene?.traverse((o) => {
      if (o.isMesh && o.userData.pickable && o.userData.objectId === id)
        n = (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    });
    return n;
  }, id);

await page.goto(`${URL}/?studio=design`, { waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
await page.waitForTimeout(1000);
await S(() => {
  const s = window.modellio.store.getState();
  s.selectAll();
  s.deleteSelected();
});

// 1. The engine is not downloaded until it is needed.
const wasmBefore = await S(() => performance.getEntriesByType('resource').filter((r) => /replicad_single.*\.wasm/.test(r.name)).length);
check('1. The precise-solid engine is not loaded up front', wasmBefore === 0);

// 2. Box → precise solid.
const id = await S(() => window.modellio.store.getState().addShape('box'));
await S((id) => window.modellio.store.getState().select([id]), id);
await page.getByTestId('make-solid').click();
const converted = await until(async () => (await obj(id))?.shape === 'solid');
check('2. "Make precise solid" turns the box into a precise solid', converted);
const vol = await until(async () => {
  const t = await page
    .getByTestId('solid-volume')
    .textContent()
    .catch(() => '');
  return /cm³/.test(t) && t;
});
check('3. Its exact volume is shown (20 mm cube = 8 cm³)', vol === '8.000 cm³', vol);
check('4. It renders as real geometry', (await until(() => renderedTriangles(id))) >= 12);
const o = await obj(id);
check(
  '5. Same size and place as before',
  JSON.stringify(o.size) === '[20,20,20]' && o.feature?.base?.shape === 'box',
  JSON.stringify(o.size),
);
await page.screenshot({ path: `${OUT}/advanced-01-solid.png` });

// 3. Resize: the solid is rebuilt exactly at the new size.
await page.getByLabel('Size X', { exact: true }).fill('40');
await page.getByLabel('Size X', { exact: true }).press('Enter');
const vol2 = await until(async () => {
  const t = await page.getByTestId('solid-volume').textContent();
  return t === '16.000 cm³' && t;
});
check('6. Resizing rebuilds the exact solid (40 × 20 × 20 = 16 cm³)', vol2 === '16.000 cm³', vol2);

// 4. Undo / redo.
await S(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
check('7. Undo goes back to the ordinary box', (await obj(id))?.shape === 'box');
await page.keyboard.press('Control+Shift+z');
check('8. Redo makes it a precise solid again', (await obj(id))?.shape === 'solid');

// 5. Shapes that cannot be precise say nothing misleading.
const meshLike = await S(() => window.modellio.store.getState().addShape('star'));
await S((id) => window.modellio.store.getState().select([id]), meshLike);
await page.waitForTimeout(300);
check('9. Mesh-only shapes do not offer the conversion', (await page.getByTestId('make-solid').count()) === 0);
await S((id) => {
  window.modellio.store.getState().select([id]);
  window.modellio.store.getState().deleteSelected();
}, meshLike);

// 6. Cylinder and a sketch.
const cyl = await S(() => window.modellio.store.getState().addShape('cylinder'));
const ok = await S((id) => window.modellio.store.getState().convertToSolid(id), cyl);
await S((id) => window.modellio.store.getState().select([id]), cyl);
const cylVol = await until(async () => {
  const t = await page
    .getByTestId('solid-volume')
    .textContent()
    .catch(() => '');
  return /cm³/.test(t) && t;
});
check(
  '10. A cylinder converts with its exact volume (π·10²·20 mm³)',
  ok && cylVol === `${((Math.PI * 100 * 20) / 1000).toFixed(3)} cm³`,
  cylVol,
);

// 7. Save and reopen.
await S(() => window.modellio.projects.getState().saveNow({ manual: true }));
await page.reload({ waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
const reopened = await until(() =>
  S(() => Object.values(window.modellio.store.getState().doc.objects).filter((o) => o.shape === 'solid' && o.feature).length),
);
check('11. Precise solids survive saving and reopening', reopened === 2, String(reopened));
check('12. …and render again after reloading', (await until(() => renderedTriangles(id))) >= 12);
await page.screenshot({ path: `${OUT}/advanced-02-reopened.png` });

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
