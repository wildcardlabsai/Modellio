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

// ---- Step 2: fillet and chamfer through the UI ------------------------------------------------
await S(() => {
  const s = window.modellio.store.getState();
  s.selectAll();
  s.deleteSelected();
});
const fbox = await S(() => window.modellio.store.getState().addShape('box', [0, 0], { exact: true }));
await S((id) => {
  const s = window.modellio.store.getState();
  s.setSize(id, [30, 20, 10]);
  s.setPosition(id, [0, 0, 5]);
  s.select([id]);
}, fbox);
await page.getByTestId('features-menu').click();
await page.getByTestId('feature-fillet').click();
await page.getByTestId('feature-dialog').waitFor({ timeout: 60000 });
check('13. Features → Fillet makes the box precise and opens the fillet panel', (await obj(fbox)).shape === 'solid');
check('14. Nothing is selected yet, so Apply is disabled', await page.getByTestId('feature-apply').isDisabled());

/** Screen position of the midpoint of the box edge whose normalised midpoint is `mid`. */
const edgeScreen = (mid) =>
  S(
    ({ id, mid }) => {
      const m = window.modellio;
      const sess = m.features.getState().session;
      const o = m.store.getState().doc.objects[id];
      const e = sess.before.edges.find((x) => x.ref.kind === 'line' && x.ref.mid.every((v, i) => Math.abs(v - mid[i]) < 1e-6));
      const n = e.points.length / 3;
      const p = [0, 1, 2].map((k) => (e.points[k] + e.points[(n - 1) * 3 + k]) / 2);
      return m.worldToScreen(p[0] + o.transform.position[0], p[1] + o.transform.position[1], p[2] + o.transform.position[2]);
    },
    { id: fbox, mid },
  );
await page.getByRole('button', { name: 'Standard views' }).click();
await page.getByRole('button', { name: 'Isometric', exact: true }).click();
await page.waitForTimeout(900);
// The top edge along X at the front (y = −10, z = +5): visible from the isometric view.
let pt = await edgeScreen([0, -1, 1]);
await page.mouse.move(pt.x, pt.y);
await page.waitForTimeout(150);
await page.mouse.click(pt.x, pt.y);
await until(async () => /1 edge selected/.test(await page.getByTestId('feature-edge-count').textContent()));
check('15. Clicking an edge on the part selects it', /1 edge selected/.test(await page.getByTestId('feature-edge-count').textContent()));
await page.getByLabel('Radius (mm)').fill('3');
await page.getByLabel('Radius (mm)').press('Enter');
const st = await until(async () => {
  const t = await page.getByTestId('feature-status').textContent();
  return /Preview ready/.test(t) && t;
});
const expected = (30 * 20 * 10 - (9 - (9 * Math.PI) / 4) * 30) / 1000;
check('16. The preview is built by the engine, with the exact filleted volume', st && st.includes(expected.toFixed(3)), st);
check('17. The document is unchanged until Apply', (await obj(fbox)).feature.ops.length === 0);
await page.screenshot({ path: `${OUT}/advanced-03-fillet-preview.png` });
await page.getByTestId('feature-apply').click();
const applied = await obj(fbox);
check(
  '18. Apply adds one fillet operation',
  applied.feature.ops.length === 1 && applied.feature.ops[0].kind === 'fillet' && applied.feature.ops[0].radius === 3,
);
const vAfter = await until(async () => {
  const t = await page.getByTestId('solid-volume').textContent();
  return t === `${expected.toFixed(3)} cm³` && t;
});
check('19. The part now has the filleted volume', !!vAfter, vAfter);
check('20. The operation is listed in the Inspector', (await page.getByTestId('solid-op').count()) === 1);
await page.screenshot({ path: `${OUT}/advanced-04-filleted.png` });

await S(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
await page.keyboard.press('Control+z');
check('21. Undo removes the fillet in one step', (await obj(fbox)).feature.ops.length === 0);
await page.keyboard.press('Control+Shift+z');
check('22. Redo puts it back', (await obj(fbox)).feature.ops.length === 1);

// Resizing keeps the fillet on the same edge.
await S((id) => window.modellio.store.getState().setSize(id, [40, 20, 10]), fbox);
const resized = await until(async () => {
  const t = await page.getByTestId('solid-volume').textContent();
  return t === `${((40 * 20 * 10 - (9 - (9 * Math.PI) / 4) * 40) / 1000).toFixed(3)} cm³` && t;
});
check('23. Resizing the part keeps the fillet on the same edge, at the same radius', !!resized, resized);

// Suppress and delete from the operations list.
await page.getByRole('button', { name: 'Turn this operation off (suppress)' }).click();
check('24. Suppressing turns the fillet off without deleting it', (await obj(fbox)).feature.ops[0].suppressed === true);
await page.getByRole('button', { name: 'Turn this operation back on' }).click();

// Chamfer with an impossible size: a clear error, and Apply stays disabled.
await page.getByTestId('solid-chamfer').click();
await page.getByTestId('feature-dialog').waitFor();
// Pick the right-hand vertical front edge (visible from the isometric view).
const vert = await S((id) => {
  const m = window.modellio;
  const sess = m.features.getState().session;
  const o = m.store.getState().doc.objects[id];
  const e = sess.before.edges.find(
    (x) => x.ref.kind === 'line' && Math.abs(x.ref.dir[2] - 1) < 1e-6 && x.ref.mid[0] > 0.9 && x.ref.mid[1] < -0.9,
  );
  const n = e.points.length / 3;
  const p = [0, 1, 2].map((k) => (e.points[k] + e.points[(n - 1) * 3 + k]) / 2);
  return m.worldToScreen(p[0] + o.transform.position[0], p[1] + o.transform.position[1], p[2] + o.transform.position[2]);
}, fbox);
await page.mouse.move(vert.x, vert.y);
await page.mouse.click(vert.x, vert.y);
await until(async () => /1 edge selected/.test(await page.getByTestId('feature-edge-count').textContent()));
await page.getByLabel('Distance (mm)').fill('25');
await page.getByLabel('Distance (mm)').press('Enter');
const err = await until(async () => {
  const t = await page.getByTestId('feature-status').textContent();
  return /could not|smaller/i.test(t) && t;
}, 30000);
check('25. An impossible chamfer is explained and cannot be applied', !!err && (await page.getByTestId('feature-apply').isDisabled()), err);
await page.getByLabel('Distance (mm)').fill('2');
await page.getByLabel('Distance (mm)').press('Enter');
await until(async () => /Preview ready/.test(await page.getByTestId('feature-status').textContent()));
await page.getByTestId('feature-apply').click();
const both = await obj(fbox);
check('26. A chamfer is added after the fillet', both.feature.ops.map((o) => o.kind).join(',') === 'fillet,chamfer');
// Tangent propagation (as in other CAD tools): the vertical edge runs smoothly into the arc at the end
// of the fillet and on into the top right-hand edge, so the 2 mm chamfer (2 mm² section) follows the
// whole smooth chain: about 2 × (7 + 4.7 + 17) ≈ 57 mm³ (slightly less along the curved part).
const filletOnly = 40 * 20 * 10 - (9 - (9 * Math.PI) / 4) * 40;
const vBoth = await until(async () => {
  const t = await page.getByTestId('solid-volume').textContent();
  const removed = filletOnly - parseFloat(t) * 1000;
  return removed > 45 && removed < 60 && t;
});
check('27. The chamfer follows the smooth (tangent) chain of edges, as in other CAD tools', !!vBoth, vBoth);

// Edit the fillet's radius.
await page.getByTestId('solid-op').first().getByRole('button', { name: 'Edit' }).click();
await page.getByTestId('feature-dialog').waitFor();
check(
  '28. Edit reopens the fillet with its edge and radius',
  /1 edge selected/.test(await page.getByTestId('feature-edge-count').textContent()) &&
    (await page.getByLabel('Radius (mm)').inputValue()).startsWith('3'),
);
await page.getByLabel('Radius (mm)').fill('1');
await page.getByLabel('Radius (mm)').press('Enter');
await until(async () => /Preview ready/.test(await page.getByTestId('feature-status').textContent()));
await page.getByTestId('feature-apply').click();
check(
  '29. Editing changes the radius in place',
  (await obj(fbox)).feature.ops[0].radius === 1 && (await obj(fbox)).feature.ops.length === 2,
);

// Cancel leaves everything as it was.
await page.getByTestId('solid-fillet').click();
await page.getByTestId('feature-dialog').waitFor();
await page.keyboard.press('Escape');
check(
  '30. Esc cancels without changing anything',
  (await page.getByTestId('feature-dialog').count()) === 0 && (await obj(fbox)).feature.ops.length === 2,
);

// Export still works with a filleted solid.
await page.getByRole('button', { name: 'Export', exact: true }).click();
const summary = await page.getByTestId('export-summary').textContent();
check(
  '31. The export dialog counts the filleted solid as a watertight object',
  /1 object/.test(summary) && !/not watertight|open/i.test(summary),
  summary.slice(0, 120),
);
await page.keyboard.press('Escape');

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
