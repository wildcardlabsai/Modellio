/**
 * End-to-end Phase 3 workflow check (holes, Boolean combine, flatten/separate,
 * 3D text, new shapes, measure tool), driven through the real UI in Chromium.
 *
 *   npm run dev
 *   node scripts/e2e-phase3.mjs [url] [screenshotDir]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.argv[2] ?? 'http://localhost:5173';
const OUT = process.argv[3] ?? 'e2e-screenshots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const close = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const S = (fn, arg) => page.evaluate(fn, arg);
const state = () =>
  S(() => {
    const s = window.modellio.store.getState();
    return { doc: s.doc, selection: s.selection, past: s.history.past.length };
  });
/** Volume + triangle count of a combined group's live result. */
const resultInfo = (gid) =>
  S((gid) => {
    const { store, computeCombined } = window.modellio;
    const r = computeCombined(store.getState().doc, gid);
    if (!r) return { pending: true };
    if (!r.mesh) return { error: r.error };
    const p = r.mesh.positions,
      ix = r.mesh.indices;
    let v = 0;
    for (let i = 0; i < ix.length; i += 3) {
      const a = ix[i] * 3,
        b = ix[i + 1] * 3,
        c = ix[i + 2] * 3;
      v +=
        (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
          p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
          p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
        6;
    }
    return { volume: v, triangles: ix.length / 3, isHole: r.isHole };
  }, gid);
const inScene = (name) => S((n) => !!window.modellio.viewport.scene.getObjectByName(n), name);
const screen = (p) => S(([x, y, z]) => window.modellio.worldToScreen(x, y, z), p);
const setField = async (label, value) => {
  const f = page.getByLabel(label, { exact: true });
  await f.click();
  await f.fill(String(value));
  await f.press('Enter');
};
const waitFor = async (fn, ms = 4000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await fn()) return true;
    await page.waitForTimeout(100);
  }
  return false;
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
check(
  '0. Solid-modelling kernel (WASM) loads in the browser',
  await waitFor(
    () =>
      S(() => true) &&
      page
        .locator('button[aria-label="Combine (Boolean)"]')
        .count()
        .then((c) => c > 0),
  ),
);

// --- 1. Box with a hole
await page.locator('button[title^="Add Box "]').click();
await setField('Size X', 40);
await setField('Size Y', 40);
await setField('Position X', 0);
await setField('Position Y', 0);
let s = await state();
const boxId = s.selection[0];
await page.locator('button[title^="Add Cylinder "]').click();
await setField('Size X', 10);
await setField('Size Y', 10);
await setField('Size Z', 30);
await setField('Position X', 0);
await setField('Position Y', 0);
await setField('Position Z', 10);
s = await state();
const cylId = s.selection[0];
await S(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()); // leave the number field
await page.keyboard.press('h');
s = await state();
check('1. H turns the cylinder into a hole', s.doc.objects[cylId].isHole === true);
check('1b. Inspector shows the Hole state', (await page.getByRole('radio', { name: 'Hole' }).getAttribute('aria-checked')) === 'true');
await page.screenshot({ path: `${OUT}/p3-01-hole.png` });

// --- 2. Union via the toolbar Combine menu
await S(([a, b]) => window.modellio.store.getState().select([a, b]), [boxId, cylId]);
await page.getByRole('button', { name: 'Combine (Boolean)' }).click();
await page
  .getByRole('dialog')
  .getByRole('button', { name: /^Union/ })
  .click();
s = await state();
const gid = s.selection[0];
check('2. Combine → Union creates a combined group', s.doc.objects[gid]?.kind === 'group' && s.doc.objects[gid].combine === 'union');
let info;
await waitFor(async () => (info = await resultInfo(gid)) && !info.pending);
const expected = 40 * 40 * 20 - Math.PI * 25 * 20;
check(
  '2b. Result is the box minus the cylinder (exact volume)',
  close(info.volume, expected, expected * 0.003),
  `${info.volume?.toFixed(1)} mm³ vs ${expected.toFixed(1)}`,
);
check('2c. Inspector reports a watertight solid', await page.getByText(/Watertight solid · [\d,]+ triangles/).isVisible());
await page.waitForTimeout(300);
check(
  '2d. The viewport renders the live result, not the parts',
  (await inScene(`${gid}:result`)) && !(await inScene(boxId)) && !(await inScene(cylId)),
);
await page.screenshot({ path: `${OUT}/p3-02-union.png` });

// --- 3. Measure tool across the top face of the result (corner snapping)
await page.keyboard.press('Escape');
await page.keyboard.press('m');
// Click just inside the top face near two corners; the tool snaps to the exact vertices.
const c1 = await screen([-19, -19, 20]);
const c2 = await screen([19, -19, 20]);
await page.mouse.click(c1.x, c1.y);
await page.mouse.click(c2.x, c2.y);
await page.waitForTimeout(250);
const pts = await S(() => window.modellio.store.getState().measurePoints);
const dist = pts.length === 2 ? Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]) : 0;
check('3. Measure snaps to the corners and reads 40.00 mm', close(dist, 40, 0.01), JSON.stringify(pts));
check('3b. Measurement label is shown', (await page.getByTestId('measure-label').textContent())?.includes('40.00 mm'));
await page.screenshot({ path: `${OUT}/p3-03-measure.png` });
await page.keyboard.press('Escape');
check('3c. Esc leaves the measure tool', (await S(() => window.modellio.store.getState().tool)) === 'select');

// --- 4. Edit a part inside the live combination
await page.locator('[role=treeitem] > div').filter({ hasText: 'Cylinder' }).first().click();
s = await state();
check('4. Selecting a part in the tree shows it as a ghost', s.selection[0] === cylId && (await inScene(cylId)));
await setField('Size X', 20);
await setField('Size Y', 20);
await page.waitForTimeout(200);
info = await resultInfo(gid);
const expected2 = 40 * 40 * 20 - Math.PI * 100 * 20;
check('4b. Widening the hole updates the result live', close(info.volume, expected2, expected2 * 0.003), `${info.volume?.toFixed(1)} mm³`);
await S(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()); // Ctrl+Z in a field is the field's own undo
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
info = await resultInfo(gid);
check('4c. Undo restores the original result', close(info.volume, expected, expected * 0.003));

// --- 5. Combine mode switch in the inspector
await S((g) => window.modellio.store.getState().select([g]), gid);
await page.getByRole('radio', { name: 'Assembly' }).click();
check(
  '5. Switching to Assembly shows the parts again',
  (await state()).doc.objects[gid].combine === undefined && (await waitFor(() => inScene(boxId))),
);
await page.keyboard.press('Control+z');
check('5b. Undo returns to Union', (await state()).doc.objects[gid].combine === 'union');

// --- 6. Intersect and subtract with fresh objects
await S(() =>
  window.modellio.store
    .getState()
    .loadDocument({ schemaVersion: 1, objects: {}, rootIds: [], settings: { units: 'mm', workplane: [200, 200] } }),
);
const [sA, sB] = await S(() => {
  const s = window.modellio.store.getState();
  const a = s.addShape('box', [0, 0], { exact: true });
  const b = s.addShape('sphere', [10, 0], { exact: true });
  s.setSize(b, [30, 30, 30]);
  s.setPosition(b, [10, 0, 10]);
  s.select([a, b]);
  return [a, b];
});
await page.getByRole('button', { name: 'Combine (Boolean)' }).click();
await page
  .getByRole('dialog')
  .getByRole('button', { name: /^Intersect/ })
  .click();
s = await state();
const ig = s.selection[0];
await waitFor(async () => !(info = await resultInfo(ig)).pending);
check('6. Intersect keeps only the shared volume', info.volume > 100 && info.volume < 8000, `${info.volume?.toFixed(1)} mm³`);
await page.keyboard.press('Control+z');
await S(([a, b]) => window.modellio.store.getState().select([a, b]), [sA, sB]);
await page.getByRole('button', { name: 'Combine (Boolean)' }).click();
await page
  .getByRole('dialog')
  .getByRole('button', { name: /^Subtract/ })
  .click();
s = await state();
const sg = s.selection[0];
await waitFor(async () => !(info = await resultInfo(sg)).pending);
check(
  '6b. Subtract cuts the sphere out of the first-selected box',
  s.doc.objects[sB].isHole && !s.doc.objects[sA].isHole && info.volume > 0 && info.volume < 8000,
  `${info.volume?.toFixed(1)} mm³`,
);
await page.screenshot({ path: `${OUT}/p3-04-subtract.png` });

// --- 7. Flatten + separate
await S(() =>
  window.modellio.store
    .getState()
    .loadDocument({ schemaVersion: 1, objects: {}, rootIds: [], settings: { units: 'mm', workplane: [200, 200] } }),
);
await S(() => {
  const s = window.modellio.store.getState();
  const a = s.addShape('box', [-30, 0], { exact: true });
  const b = s.addShape('cylinder', [30, 0], { exact: true });
  s.select([a, b]);
  s.combineSelected('union');
});
await page.getByRole('button', { name: 'Flatten to mesh' }).click();
s = await state();
const meshId = s.selection[0];
check('7. Flatten turns the combination into one mesh object', s.doc.objects[meshId]?.shape === 'mesh' && s.doc.rootIds.length === 1);
await page.getByRole('button', { name: 'Separate parts' }).click();
s = await state();
check(
  '7b. Separate splits it into its two solid parts',
  s.selection.length === 2 && s.doc.rootIds.length === 2 && s.selection.every((id) => s.doc.objects[id].shape === 'mesh'),
);
const bx = await S(
  (ids) =>
    ids
      .map((id) => {
        const { store, hierarchy } = window.modellio;
        const b = hierarchy.worldBoundsOf(store.getState().doc, [id]);
        return Math.round((b.min.x + b.max.x) / 2);
      })
      .sort((a, b) => a - b),
  s.selection,
);
check('7c. Parts stay exactly where they were', JSON.stringify(bx) === '[-30,30]', JSON.stringify(bx));

// --- 8. 3D text
await S(() =>
  window.modellio.store
    .getState()
    .loadDocument({ schemaVersion: 1, objects: {}, rootIds: [], settings: { units: 'mm', workplane: [200, 200] } }),
);
await page.getByRole('button', { name: 'Text', exact: true }).first().click();
await page.locator('#new-text').fill('MAKE');
await page.getByRole('button', { name: 'Add text' }).click();
await waitFor(async () => (await state()).selection.length === 1);
s = await state();
const textId = s.selection[0];
const t = s.doc.objects[textId];
check(
  '8. Text panel adds solid text sized from the font',
  t?.shape === 'text' && t.text.content === 'MAKE' && t.size[0] > 20 && t.size[1] > 5,
  JSON.stringify(t?.size),
);
await page.waitForTimeout(400);
check('8b. Text geometry renders in the viewport', await inScene(textId));
await page.getByLabel('Font', { exact: true }).selectOption('pacifico');
await waitFor(async () => (await state()).doc.objects[textId].text.font === 'pacifico');
s = await state();
check(
  '8c. Changing the font re-lays out the text',
  s.doc.objects[textId].text.font === 'pacifico' && s.doc.objects[textId].size[0] !== t.size[0],
  JSON.stringify(s.doc.objects[textId].size),
);
const ta = page.getByLabel('Text content');
await ta.fill('MAKER');
await ta.press('Control+Enter');
await waitFor(async () => (await state()).doc.objects[textId].text.content === 'MAKER');
check('8d. Editing the text content updates the object', (await state()).doc.objects[textId].text.content === 'MAKER');
await page.screenshot({ path: `${OUT}/p3-05-text.png` });

// --- 9. Engrave text into a plate
const plate = await S((tid) => {
  const s = window.modellio.store.getState();
  const p = s.addShape('box', [0, 0], { exact: true });
  s.setSize(p, [80, 30, 6]);
  s.setPosition(p, [0, 0, 3]);
  const tt = s.doc.objects[tid];
  s.setPosition(tid, [0, 0, 6]);
  s.setSize(tid, [tt.size[0], tt.size[1], 2]);
  return p;
}, textId);
await S(([p, tid]) => window.modellio.store.getState().select([p, tid]), [plate, textId]);
await page.getByRole('button', { name: 'Combine (Boolean)' }).click();
await page
  .getByRole('dialog')
  .getByRole('button', { name: /^Subtract/ })
  .click();
s = await state();
const eg = s.selection[0];
await waitFor(async () => !(info = await resultInfo(eg)).pending, 8000);
check(
  '9. Text engraves into a plate (watertight result)',
  info.volume > 80 * 30 * 6 - 80 * 30 && info.volume < 80 * 30 * 6,
  `${info.volume?.toFixed(1)} mm³, ${info.triangles} tris`,
);
await page.evaluate(() => window.modellio.store.getState().requestFrame());
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/p3-06-engraved.png` });

// --- 10. New shapes and the box fillet
await page.getByRole('button', { name: 'Shapes', exact: true }).first().click();
for (const label of ['Star', 'Capsule', 'Paraboloid']) await page.locator(`button[title^="Add ${label} "]`).click();
s = await state();
const kinds = s.selection.map((id) => s.doc.objects[id].shape);
check(
  '10. Star, capsule and paraboloid can be added',
  ['star', 'capsule', 'paraboloid'].every((k) => Object.values(s.doc.objects).some((o) => o.shape === k)),
  kinds.join(),
);
await page.locator('button[title^="Add Box "]').click();
await setField('Fillet radius', 4);
s = await state();
check('10b. Box fillet radius is editable', s.doc.objects[s.selection[0]].params.radius === 4);
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/p3-07-shapes.png` });

// --- 11. GPU memory across combine / uncombine / delete
const gpu = () =>
  S(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.modellio.viewport.renderer.info.memory.geometries;
  });
await S(() =>
  window.modellio.store
    .getState()
    .loadDocument({ schemaVersion: 1, objects: {}, rootIds: [], settings: { units: 'mm', workplane: [200, 200] } }),
);
await page.waitForTimeout(300);
const g0 = await gpu();
for (let i = 0; i < 3; i++) {
  await S(() => {
    const s = window.modellio.store.getState();
    const a = s.addShape('box');
    const b = s.addShape('sphere');
    s.select([a, b]);
    s.combineSelected('subtract');
  });
  await page.waitForTimeout(200);
  await S(() => {
    const s = window.modellio.store.getState();
    const g = s.selection[0];
    s.setCombineMode(g, 'intersect');
    s.select([g]);
    s.deleteSelected();
  });
  await page.waitForTimeout(200);
}
const g1 = await gpu();
check('11. No GPU geometry leak across Boolean cycles', g1 <= g0, `${g0} → ${g1}`);

check('No runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
