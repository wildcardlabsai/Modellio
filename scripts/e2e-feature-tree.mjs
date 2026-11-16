/**
 * End-to-end check for the Design Browser's feature tree (MODELLIO 2.2, Stage 3a): Features and
 * Sketches views derived from the document, real edit / suppress / delete actions, Booleans with
 * their bodies and cutters, the "last change" marker, and hover links from the tree and the
 * history timeline to the 3D view.
 *
 *   node scripts/e2e-feature-tree.mjs [url] [screenshotDir]
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
const until = async (fn, ms = 20000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await fn();
    if (v) return v;
    await page.waitForTimeout(100);
  }
  return fn();
};
const obj = (id) => S((id) => window.modellio.store.getState().doc.objects[id], id);

await page.goto(`${URL}/?studio=design`, { waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
await page.waitForTimeout(1000);

const view = (name) => page.getByRole('radiogroup', { name: 'Browser view' }).getByRole('radio', { name }).click();
const tree = page.getByTestId('feature-tree');
const node = (label) => tree.getByTestId('feature-node').filter({ hasText: label }).first();

// A precise box with a fillet and a chamfer (edges of a 20 mm box centred on its origin).
const box = await S(() => window.modellio.store.getState().addShape('box'));
await S((id) => window.modellio.store.getState().convertToSolid(id), box);
await until(async () => (await obj(box))?.shape === 'solid');
await S((id) => {
  const edge = (mid, dir) => ({ kind: 'line', mid, dir, radius: 0 });
  window.modellio.store.getState().setFeatureOps(
    id,
    [
      { id: 'f1', kind: 'fillet', radius: 2, edges: [edge([0, -10, 10], [1, 0, 0])] },
      { id: 'c1', kind: 'chamfer', distance: 1, edges: [edge([10, 0, 10], [0, 1, 0])] },
    ],
    'Add fillet and chamfer',
  );
}, box);

// 1. Views.
await view('Features');
await tree.waitFor();
check(
  '1. The Features view lists the body, its base and its operations in order',
  JSON.stringify(await tree.getByTestId('feature-node').locator('span.font-medium').allTextContents()) ===
    JSON.stringify(['Box', 'Box', 'Fillet', 'Chamfer']),
);
check(
  '1b. Operation rows show their size and edge count',
  /R 2 mm · 1 edge/.test(await node('Fillet').textContent()) && /1 mm · 1 edge/.test(await node('Chamfer').textContent()),
);
check('1c. Levels are real tree levels', (await node('Fillet').getAttribute('aria-level')) === '2');

// 2. Suppress from the tree, then undo.
await node('Fillet').hover();
await node('Fillet').getByRole('button', { name: 'Turn fillet off (suppress)' }).click();
check('2. Suppressing in the tree turns the operation off in the document', (await obj(box)).feature.ops[0].suppressed === true);
check('2b. …and the row shows it', /off/.test(await node('Fillet').textContent()));
await page.keyboard.press('Control+z');
check('2c. Undo turns it back on', !(await obj(box)).feature.ops[0].suppressed);

// 3. Edit opens the real fillet panel on that operation.
await node('Fillet').getByRole('button', { name: 'Edit fillet' }).click();
const panel = page.getByRole('dialog', { name: 'Fillet edges' });
check(
  '3. "Edit fillet" opens the fillet panel for that operation',
  await panel
    .getByText('Edit fillet')
    .isVisible()
    .catch(() => false),
);
check('3b. …with its radius', (await panel.getByLabel('Radius (mm)').inputValue()).startsWith('2'));
await panel.getByRole('button', { name: 'Cancel' }).click();

// 4. Delete from the tree.
await node('Chamfer').getByRole('button', { name: 'Delete chamfer' }).click();
check('4. Deleting in the tree removes the chamfer', (await obj(box)).feature.ops.length === 1);
await page.keyboard.press('Control+z');
check('4b. Undo brings it back', (await obj(box)).feature.ops.length === 2);

// 5. A Boolean with a body and a cutter.
const [plate, hole] = await S(() => {
  const s = window.modellio.store.getState();
  const a = s.addShape('box');
  s.setSize(a, [40, 40, 4]);
  s.setPosition(a, [60, 0, 2]);
  const b = s.addShape('cylinder');
  s.setSize(b, [10, 10, 10]);
  s.setPosition(b, [60, 0, 2]);
  s.select([a, b]);
  window.modellio.store.getState().combineSelected('subtract');
  return [a, b];
});
const groupId = (await obj(plate)).parentId;
const boolRow = tree.locator(`[data-kind="boolean"]`).first();
await boolRow.waitFor();
check('5. A subtraction shows as a Boolean node: 1 body − 1 cutter', /Union · 1 body − 1 cutter/.test(await boolRow.textContent()));
check(
  '5b. Its children are the body and the cutter',
  (await tree.locator('[data-kind="body"][aria-level="2"]').count()) === 1 && (await tree.locator('[data-kind="cutter"]').count()) === 1,
);
check('5c. The last step’s objects carry the "last change" marker', (await boolRow.getByTestId('last-changed').count()) === 1);

// 6. Hovering a row highlights it in 3D.
const glow = (id) => S((id) => window.modellio.viewport.scene.getObjectByName(id)?.material?.emissiveIntensity ?? -1, id);
await S(() => window.modellio.store.getState().select([]));
await page.mouse.move(5, 5);
await page.waitForTimeout(200);
const before = await glow(box);
await node('Fillet').hover();
const during = await until(async () => (await glow(box)) > 0 && glow(box));
check('6. Hovering a tree row highlights its body in the 3D view', before === 0 && during > 0, `${before} → ${during}`);
await page.mouse.move(5, 5);
check('6b. …and leaving clears it', (await until(async () => (await glow(box)) === 0)) === true);

// 7. The timeline names what each step changed and points at it.
const steps = page.getByTestId('history-step');
const lastStep = steps.last();
check(
  '7. A history step names the objects it changed',
  /\(.*Box.*\)/.test((await lastStep.getAttribute('title')) ?? ''),
  await lastStep.getAttribute('title'),
);
await lastStep.hover();
const pointed = await until(() => S(() => window.modellio.hover?.getState().ids ?? null));
check(
  '7b. Hovering a step points at those objects',
  Array.isArray(pointed) && pointed.includes(plate) && pointed.includes(hole),
  JSON.stringify(pointed),
);
await page.mouse.move(5, 5);

// 8. A loft: its sections appear as sketches and open in the sketch editor.
await page.getByRole('button', { name: 'Loft: blend between sketched sections' }).click();
const apply = page.getByTestId('loft-sweep-apply');
await until(() => apply.isEnabled());
await apply.click();
const loftId = await until(() =>
  S(() => Object.values(window.modellio.store.getState().doc.objects).find((o) => o.feature?.base?.kind === 'loft')?.id),
);
check(
  '8. The loft appears in the Features view, built from 2 smooth sections',
  (await tree.locator('[data-kind="base"]').filter({ hasText: '2 sections · smooth' }).count()) === 1,
);
await view('Sketches');
const items = page.getByTestId('sketch-item');
const labels = await items.allTextContents();
check(
  '8b. The Sketches view lists both loft sections with the body they drive',
  labels.filter((t) => /Section \d/.test(t) && /Drives Loft/.test(t)).length === 2,
  labels.join(' | '),
);
await items.filter({ hasText: 'Section 2' }).click();
const editor = page.getByTestId('sketch-editor');
check(
  '8c. Clicking a section opens it in the sketch editor',
  await editor.waitFor({ timeout: 10000 }).then(
    () => true,
    () => false,
  ),
);
check('8d. …as that section', await page.getByText('Loft section 2').first().isVisible());
await page.getByRole('button', { name: 'Close sketch without saving' }).click();
await page.getByTestId('loft-sweep-dialog').getByRole('button', { name: 'Cancel' }).click();
check('8e. Closing leaves the loft unchanged', (await obj(loftId)).feature.base.sections.length === 2);

// 9. The Bodies view is the full object tree, unchanged.
await view('Bodies');
check('9. The Bodies view is the object tree', (await page.locator('[role=tree] [role=treeitem]').count()) >= 4);
check('9b. Group ids are real', !!groupId);

await page.screenshot({ path: `${OUT}/feature-tree.png` });

// ---- Stage 3b: standalone sketches and components (document schema 2) ----
const records = () => S(() => Object.values(window.modellio.store.getState().doc.sketches ?? {}));
const toScreen = (x, y) =>
  S(
    ([x, y]) => {
      const s = document.querySelector('[data-testid="sketch-canvas"]');
      const p = s.createSVGPoint();
      p.x = x;
      p.y = -y;
      const q = p.matrixTransform(s.getScreenCTM());
      return [q.x, q.y];
    },
    [x, y],
  );
const rectangle = async ([x0, y0], [x1, y1]) => {
  await page.getByTestId('sketch-editor').getByRole('button', { name: 'Rectangle', exact: true }).click();
  for (const [x, y] of [
    [x0, y0],
    [x1, y1],
  ]) {
    const [sx, sy] = await toScreen(x, y);
    await page.mouse.click(sx, sy);
  }
};

// 10. A sketch kept on its own.
await view('Sketches');
const bodiesBefore = await S(() => Object.keys(window.modellio.store.getState().doc.objects).length);
const recordsBefore = (await records()).length;
await page.getByTestId('sketch-list').getByRole('button', { name: 'New sketch', exact: true }).click();
await page.getByTestId('sketch-editor').waitFor();
await rectangle([0, 0], [30, 20]);
await page.getByTestId('sketch-save-only').click();
await page.getByTestId('sketch-editor').waitFor({ state: 'detached' });
const own = (await records()).find((r) => r.name === 'Sketch');
check(
  '10. "Save sketch only" keeps the sketch without making a body',
  (await records()).length === recordsBefore + 1 &&
    !!own &&
    own.sketch.entities.length === 4 &&
    (await S(() => Object.keys(window.modellio.store.getState().doc.objects).length)) === bodiesBefore,
);
const ownRow = page.getByTestId('sketch-row').filter({ hasText: 'On its own' });
check('10b. The Sketches view shows it on its own', (await ownRow.count()) === 1);

// 11. One sketch drives two bodies; editing it rebuilds both.
await ownRow.getByRole('button', { name: 'Extrude Sketch' }).click();
const users = async () =>
  S(
    (sk) =>
      Object.values(window.modellio.store.getState().doc.objects)
        .filter((o) => o.sketchId === sk)
        .map((o) => ({ id: o.id, name: o.name, size: o.size })),
    own.id,
  );
await until(async () => (await users()).length === 1);
await page
  .getByTestId('sketch-row')
  .filter({ hasText: /^Sketch/ })
  .first()
  .getByRole('button', { name: 'Extrude Sketch' })
  .click();
const two = await until(async () => {
  const u = await users();
  return u.length === 2 && u;
});
check(
  '11. Extruding the sketch twice makes two bodies built from it',
  two && two.every((u) => u.size[0] === 30 && u.size[1] === 20),
  JSON.stringify(two),
);
await page
  .getByTestId('sketch-item')
  .filter({ hasText: /Drives Sketch/ })
  .first()
  .click();
await page.getByTestId('sketch-editor').waitFor();
check(
  '11b. A shared sketch opens on its own, saying it updates every body',
  await page.getByText('Saving updates every body built from this sketch').isVisible(),
);
// A second outline below the first: the parts grow from 20 to 26 mm in Y.
await rectangle([5, -6], [12, -1]);
check('11c. The second outline is drawn in the shared sketch', (await page.getByTestId('sketch-line').count()) === 8);
await page.getByTestId('sketch-use').click();
const rebuilt = await until(async () => {
  const u = await users();
  return u.every((x) => x.size[1] === 26) && u;
});
check('11d. Saving it rebuilds both bodies', !!rebuilt, JSON.stringify(rebuilt || (await users())));
await page.keyboard.press('Control+z');
check('11e. One undo restores both', (await until(async () => (await users()).every((x) => x.size[1] === 20))) === true);

// 12. Unlinking from the Inspector.
await S((id) => window.modellio.store.getState().select([id]), two[0].id);
await page.getByRole('tab', { name: /^Features/ }).click();
check(
  '12. The Inspector names the shared sketch and the other body',
  /Also builds/.test(await page.getByTestId('sketch-link').textContent()),
);
await page.getByTestId('unlink-sketch').click();
check('12b. "Give this body its own copy" unlinks it', (await users()).length === 1);
await page.getByRole('tab', { name: 'Properties' }).click();

// 13. Components.
await page.getByRole('button', { name: 'Components', exact: true }).click();
const panelC = page.getByTestId('components-panel');
await panelC.waitFor();
await S(([a, b]) => window.modellio.store.getState().select([a, b]), [box, loftId]);
await panelC.getByTestId('make-component').click();
const comp = await S(() => window.modellio.store.getState().selection[0]);
check(
  '13. "Make component from selection" groups the parts as a component',
  (await obj(comp))?.component === true && (await obj(comp)).children.length === 2,
);
check('13b. It is listed under Components', (await panelC.getByTestId('component-item').count()) === 1);
const before13 = await S(() => Object.keys(window.modellio.store.getState().doc.objects).length);
await panelC.getByRole('button', { name: /^Insert another .*\(linked\)/ }).click();
check(
  '13c. "Insert another" adds a linked copy (3 new objects: the group and its 2 parts), listed under the same component',
  (await panelC.getByTestId('component-item').count()) === 1 &&
    (await panelC.getByTestId('component-item').getAttribute('data-instances')) === '2' &&
    (await S(() => Object.keys(window.modellio.store.getState().doc.objects).length)) === before13 + 3,
);
await panelC.getByRole('button', { name: /^Insert independent copy/ }).click();
check(
  '13c2. "Insert independent copy" adds an unlinked copy, listed as a component of its own',
  (await panelC.getByTestId('component-item').count()) === 2 &&
    (await S(() => Object.keys(window.modellio.store.getState().doc.objects).length)) === before13 + 6,
);
await view('Features');
check('13d. The feature tree labels it a component', /Component · 2 parts/.test(await tree.textContent()));
await page.getByRole('button', { name: 'Shapes', exact: true }).click();

// 14. Saved and reopened.
const recordCount = (await records()).length;
await S(() => window.modellio.projects.getState().saveNow());
await page.reload({ waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
await until(async () => (await records()).length === recordCount);
check(
  '14. Standalone sketches survive saving and reopening',
  (await records()).length === recordCount && (await records()).some((r) => r.id === own.id),
);
check(
  '14b. …and so do components',
  (await S(() => Object.values(window.modellio.store.getState().doc.objects).filter((o) => o.component).length)) === 3,
);
// ---- Stage 4: workflow ----
// 15. Measure: a marker shows where the next click lands, snapped to the grid on the workplane.
await S(() => window.modellio.store.getState().select([]));
await page.keyboard.press('m');
await until(() => S(() => window.modellio.store.getState().tool === 'measure'));
await page.waitForTimeout(300); // the tool's pointer listeners attach on the next render
const vp = await page.getByTestId('viewport').boundingBox();
const spot = await S(() => window.modellio.worldToScreen(-30.3, 85.6, 0));
await page.mouse.move(spot.x + 3, spot.y + 3);
await page.mouse.move(spot.x, spot.y);
const marker = await until(() =>
  S(() => {
    const m = window.modellio.viewport.scene.getObjectByName('measure-cursor');
    return m && Math.abs(m.position.x + 30) <= 1 && { p: m.position.toArray(), snapped: m.userData.snapped };
  }),
);
check(
  '15. Measuring shows where the next click lands, on the 1 mm snap grid',
  !!marker && marker.snapped && marker.p.every((v) => Math.abs(v - Math.round(v)) < 1e-6) && Math.abs(marker.p[0] + 30) <= 1,
  JSON.stringify(marker),
);
await page.mouse.click(spot.x, spot.y);
const far = await S(() => window.modellio.worldToScreen(9.6, 85.6, 0));
await page.mouse.click(far.x, far.y);
const mpts = await S(() => window.modellio.store.getState().measurePoints);
check(
  '15b. Workplane clicks land on the grid: 40 mm apart',
  mpts.length === 2 && Math.abs(Math.abs(mpts[1][0] - mpts[0][0]) - 40) < 1e-6,
  JSON.stringify(mpts),
);
await page.mouse.move(vp.x + vp.width - 5, vp.y + 5);
await page.keyboard.press('Escape');
check(
  '15c. Leaving the measure tool removes the marker',
  (await S(() => !!window.modellio.viewport.scene.getObjectByName('measure-cursor'))) === false,
);

// 16. K starts a new sketch; the shortcuts list includes it.
await page.mouse.click(vp.x + vp.width / 2, vp.y + vp.height - 60);
await page.keyboard.press('k');
check(
  '16. K opens a new sketch',
  await page
    .getByTestId('sketch-editor')
    .waitFor({ timeout: 5000 })
    .then(
      () => true,
      () => false,
    ),
);
await page.getByRole('button', { name: 'Close sketch without saving' }).click();
await page.keyboard.press('?');
const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
check(
  '16b. The shortcuts list shows New sketch (K) and Ctrl+Y redo',
  /New sketchK/.test(await dialog.textContent()) && /Y/.test(await dialog.textContent()),
);
await dialog.getByRole('button', { name: 'Close' }).click();

// 17. Bodies rows point at their object in 3D too.
await view('Bodies');
const row = page
  .locator('[role=treeitem]')
  .filter({ hasText: (await obj(box)).name })
  .first();
await row.hover();
check('17. Hovering a Bodies row highlights it in the 3D view', (await until(async () => (await glow(box)) > 0)) === true);
await page.mouse.move(5, 5);

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
