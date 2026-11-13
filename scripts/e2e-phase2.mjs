/**
 * End-to-end Phase 2 workflow check (hierarchy, grouping, align, mirror,
 * clipboard, workplane), driven through the real UI in Chromium.
 *
 *   npm run dev
 *   node scripts/e2e-phase2.mjs [url] [screenshotDir]
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

const state = () =>
  page.evaluate(() => {
    const s = window.modellio.store.getState();
    return { doc: s.doc, selection: s.selection, past: s.history.past.length };
  });
const bounds = (ids) =>
  page.evaluate((ids) => {
    const { store, hierarchy } = window.modellio;
    const b = hierarchy.worldBoundsOf(store.getState().doc, ids);
    return { min: b.min.toArray(), max: b.max.toArray() };
  }, ids);
const worldPos = (id) =>
  page.evaluate((id) => {
    const { store, hierarchy } = window.modellio;
    const m = hierarchy.worldMatrix(store.getState().doc, id);
    return [m.elements[12], m.elements[13], m.elements[14]].map((v) => Math.round(v * 1000) / 1000);
  }, id);
const screen = (p) => page.evaluate(([x, y, z]) => window.modellio.worldToScreen(x, y, z), p);
const gizmoUnit = (p) =>
  page.evaluate(([x, y, z]) => {
    const cam = window.modellio.viewport.camera;
    const d = Math.hypot(cam.position.x - x, cam.position.y - y, cam.position.z - z);
    return (d * Math.min((1.9 * Math.tan((Math.PI * cam.fov) / 360)) / cam.zoom, 7) * 0.85) / 4;
  }, p);
const drag = async (from, to, steps = 20) => {
  await page.mouse.move(from.x, from.y);
  await page.waitForTimeout(60);
  await page.mouse.move(from.x + 1, from.y + 1);
  await page.waitForTimeout(60);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(250);
};
const treeRowLoose = (name) => page.locator('[role=treeitem] > div').filter({ hasText: name }).first();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
for (const label of ['Box', 'Cylinder', 'Sphere']) await page.locator(`button[title^="Add ${label} "]`).click();
let s = await state();
const [boxId, cylId, sphId] = s.doc.rootIds;

// --- 1. Multi-select in viewport + Ctrl+G
await page.keyboard.press('Escape');
for (const [id, shift] of [
  [boxId, false],
  [cylId, true],
]) {
  const p = s.doc.objects[id].transform.position;
  const sp = await screen([p[0], p[1] - 9.5, p[2]]);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(sp.x, sp.y);
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(150);
}
s = await state();
check('1. Shift+click selects box and cylinder in the viewport', s.selection.length === 2, JSON.stringify(s.selection.length));
const beforeGroup = await bounds([boxId, cylId]);
await page.keyboard.press('Control+g');
s = await state();
const gid = s.selection[0];
const g = s.doc.objects[gid];
check('1b. Ctrl+G creates a group of both and selects it', g?.kind === 'group' && g.children.length === 2 && s.doc.rootIds.length === 2);
const afterGroup = await bounds([boxId, cylId]);
check('1c. Grouping does not move anything', JSON.stringify(beforeGroup) === JSON.stringify(afterGroup));
check('1d. Object tree shows the group with nested children', (await page.locator('[role=treeitem][aria-level="2"]').count()) === 2);
await page.screenshot({ path: `${OUT}/p2-01-grouped.png` });

// --- 2. Click selects group, double-click drills in
await page.keyboard.press('Escape');
const cp = await worldPos(cylId);
const cylScreen = await screen([cp[0], cp[1] - 9.5, cp[2]]);
await page.mouse.click(cylScreen.x, cylScreen.y);
await page.waitForTimeout(400);
check('2. Clicking a grouped part selects its group', (await state()).selection[0] === gid);
await page.mouse.dblclick(cylScreen.x, cylScreen.y);
await page.waitForTimeout(200);
check('2b. Double-clicking selects the part inside the group', (await state()).selection[0] === cylId);
check(
  '2c. Inspector explains group-relative coordinates',
  await page.getByText('Position and rotation are relative to the group').isVisible(),
);

// --- 3. Move the group with the gizmo (one undo step)
await page.locator('[role=treeitem] > div').first().click(); // group row
s = await state();
check('3a. Selecting the group row in the tree selects it in 3D', s.selection[0] === gid);
const camPos = await page.evaluate(() => window.modellio.viewport.camera.position.toArray());
let gp = await worldPos(gid);
let u = await gizmoUnit(gp);
const sy = Math.sign(camPos[1] - gp[1]) || 1;
const a = await screen([gp[0], gp[1] + sy * 0.5 * u, gp[2]]);
const o = await screen(gp);
const dir = { x: a.x - o.x, y: a.y - o.y };
const len = Math.hypot(dir.x, dir.y);
const pastBefore = s.past;
const boxBefore = await worldPos(boxId);
await drag(a, { x: a.x + (dir.x / len) * 100, y: a.y + (dir.y / len) * 100 });
const boxAfter = await worldPos(boxId);
const cylAfter = await worldPos(cylId);
s = await state();
check(
  '3. Dragging the group Y arrow moves both children together',
  Math.abs(boxAfter[1] - boxBefore[1]) > 5 && close(boxAfter[1] - boxBefore[1], cylAfter[1] - cp[1]) && close(boxAfter[0], boxBefore[0]),
  `box Δy ${(boxAfter[1] - boxBefore[1]).toFixed(2)}, cyl Δy ${(cylAfter[1] - cp[1]).toFixed(2)}`,
);
check('3b. Group drag is one undo step', s.past === pastBefore + 1);

// --- 4. Resize the group with the gizmo Z handle
await page.keyboard.press('r');
await page.waitForTimeout(150);
gp = await worldPos(gid);
u = await gizmoUnit(gp);
const zh = await screen([gp[0], gp[1], gp[2] + 0.5 * u]);
await drag(zh, { x: zh.x, y: zh.y - 70 });
let b = await bounds([gid]);
check(
  '4. Resizing the group makes every part taller and keeps it on the plate',
  b.max[2] > 21 && close(b.min[2], 0, 0.01),
  `height ${(b.max[2] - b.min[2]).toFixed(2)}`,
);
s = await state();
check(
  '4b. Children sizes changed (no hidden scale factor)',
  s.doc.objects[boxId].size[2] > 20 && s.doc.objects[cylId].size[2] > 20,
  `${s.doc.objects[boxId].size}`,
);
await page.keyboard.press('w');

// --- 5. Exact group size in the inspector
const gx = page.getByLabel('Size X');
await gx.click();
await gx.fill('80');
await gx.press('Enter');
b = await bounds([gid]);
check('5. Typing group width 80 mm resizes the group exactly', close(b.max[0] - b.min[0], 80, 0.01), (b.max[0] - b.min[0]).toFixed(3));
await page.screenshot({ path: `${OUT}/p2-02-group-resized.png` });

// --- 6. Rotate group, ungroup keeps world placement
const rz = page.getByLabel('Rotation Z');
await rz.click();
await rz.fill('45');
await rz.press('Enter');
const rotatedBounds = await bounds([boxId, cylId]);
await page
  .locator('body')
  .click({ position: { x: 800, y: 870 } })
  .catch(() => {});
await page.evaluate((id) => window.modellio.store.getState().select([id]), gid);
await page.keyboard.press('Control+Shift+g');
s = await state();
const ungroupedBounds = await bounds([boxId, cylId]);
const sameBounds =
  rotatedBounds.min.every((v, i) => close(v, ungroupedBounds.min[i], 0.01)) &&
  rotatedBounds.max.every((v, i) => close(v, ungroupedBounds.max[i], 0.01));
check('6. Ctrl+Shift+G ungroups a rotated group without moving parts', !s.doc.objects[gid] && sameBounds && s.selection.length === 2);
check(
  '6b. Parts inherit the 45° rotation',
  close(s.doc.objects[boxId].transform.rotation[2], 45, 0.01),
  JSON.stringify(s.doc.objects[boxId].transform.rotation),
);
await page.keyboard.press('Control+z');
s = await state();
check('6c. Undo restores the group', s.doc.objects[gid]?.kind === 'group');

// --- 7. Tree: collapse, rename, hide, lock
await page.getByRole('button', { name: `Collapse ${g.name}` }).click();
check('7. Collapsing a group hides its rows', (await page.locator('[role=treeitem][aria-level="2"]').count()) === 0);
await page.getByRole('button', { name: `Expand ${g.name}` }).click();
check('7b. Expanding shows them again', (await page.locator('[role=treeitem][aria-level="2"]').count()) === 2);
await treeRowLoose('Sphere').dblclick();
await page.getByLabel('Rename object').fill('Ball');
await page.getByLabel('Rename object').press('Enter');
check('7c. Double-click renames in the tree', (await state()).doc.objects[sphId].name === 'Ball');
await page.getByRole('button', { name: 'Hide Ball' }).click({ force: true });
await page.waitForTimeout(150);
const sphereInScene = await page.evaluate((id) => !!window.modellio.viewport.scene.getObjectByName(id), sphId);
check(
  '7d. Eye toggle hides the object (removed from the 3D scene)',
  (await state()).doc.objects[sphId].visible === false && !sphereInScene,
);
await page.getByRole('button', { name: 'Show Ball' }).click({ force: true });
await page.getByRole('button', { name: 'Lock Ball' }).click({ force: true });
await page.evaluate((id) => window.modellio.store.getState().select([id]), sphId);
await page.keyboard.press('Delete');
check('7e. Locked object survives Delete', !!(await state()).doc.objects[sphId]);
await page.getByRole('button', { name: 'Unlock Ball' }).click({ force: true });

// --- 8. Tree drag & drop into the group preserves world placement
const ballWorld = await worldPos(sphId);
const src = treeRowLoose('Ball');
const dst = page.locator('[role=treeitem] > div').first();
const db = await dst.boundingBox();
await src.dragTo(dst, { targetPosition: { x: db.width / 2, y: db.height / 2 } });
await page.waitForTimeout(200);
s = await state();
const ballAfter = await worldPos(sphId);
check('8. Dragging a row onto a group moves it inside', s.doc.objects[sphId].parentId === gid, `parent ${s.doc.objects[sphId].parentId}`);
check(
  '8b. …without moving it in 3D',
  ballAfter.every((v, i) => close(v, ballWorld[i], 0.01)),
  `${ballWorld} → ${ballAfter}`,
);
// drag back out to root (drop on empty tree area)
const tree = page.getByRole('tree');
const tb = await tree.boundingBox();
await treeRowLoose('Ball').dragTo(tree, { targetPosition: { x: tb.width / 2, y: tb.height - 8 } });
await page.waitForTimeout(200);
check('8c. Dragging to empty space moves it back to the top level', (await state()).doc.objects[sphId].parentId === null);
await page.screenshot({ path: `${OUT}/p2-03-tree.png` });

// --- 9. Align and distribute via the toolbar
await page.keyboard.press('Control+Shift+g'); // nothing selected that's a group → notice only
await page.evaluate(() => {
  const s = window.modellio.store.getState();
  s.loadDocument({ schemaVersion: 1, objects: {}, rootIds: [], settings: { units: 'mm', workplane: [200, 200] } });
});
const ids = await page.evaluate(() => {
  const s = window.modellio.store.getState();
  const out = [
    s.addShape('box', [-60, -30], { exact: true }),
    s.addShape('cylinder', [10, 20], { exact: true }),
    s.addShape('wedge', [70, 50], { exact: true }),
  ];
  s.setSize(out[1], [30, 30, 40]);
  s.select(out);
  return out;
});
await page.getByRole('button', { name: 'Align', exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Align Left (X)' }).click();
let lefts = await Promise.all(ids.map((id) => bounds([id]).then((bb) => bb.min[0])));
check(
  '9. Align Left lines up the left edges',
  lefts.every((v) => close(v, lefts[0], 0.01)),
  lefts.map((v) => v.toFixed(2)).join(', '),
);
const topsBefore = await Promise.all(ids.map((id) => bounds([id]).then((bb) => bb.max[2])));
await page.getByRole('button', { name: 'Align', exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Align Top (Z)' }).click();
const tops = await Promise.all(ids.map((id) => bounds([id]).then((bb) => bb.max[2])));
check(
  '9b. Align Top lines up the tops with the highest one',
  tops.every((v) => close(v, Math.max(...topsBefore), 0.01)),
  `${topsBefore.join(', ')} → ${tops.join(', ')}`,
);
await page.getByRole('button', { name: 'Align', exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Y', exact: true }).click(); // distribute Y
const bs = await Promise.all(ids.map((id) => bounds([id])));
const sorted = bs.sort((p, q) => p.min[1] - q.min[1]);
const gaps = [sorted[1].min[1] - sorted[0].max[1], sorted[2].min[1] - sorted[1].max[1]];
check('9c. Distribute Y makes equal gaps', close(gaps[0], gaps[1], 0.01), gaps.map((v) => v.toFixed(2)).join(' / '));
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
lefts = await Promise.all(ids.map((id) => bounds([id]).then((bb) => bb.min[0])));
check('9d. Undo reverts the alignments', !lefts.every((v) => close(v, lefts[0], 0.01)));

// --- 10. Mirror the wedge
await page.evaluate((id) => window.modellio.store.getState().select([id]), ids[2]);
const wedgeBefore = await bounds([ids[2]]);
await page.getByRole('button', { name: 'Mirror', exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Mirror X' }).click();
s = await state();
const wedgeAfter = await bounds([ids[2]]);
check(
  '10. Mirror X reflects the wedge in place',
  JSON.stringify(s.doc.objects[ids[2]].mirror) === '[-1,1,1]' && close(wedgeAfter.min[0], wedgeBefore.min[0], 0.01),
);
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/p2-04-mirror.png` });

// --- 11. Copy / paste
await page.evaluate((ids) => window.modellio.store.getState().select(ids.slice(0, 2)), ids);
await page.keyboard.press('Control+g');
await page.keyboard.press('Control+c');
await page.keyboard.press('Control+v');
s = await state();
const pasted = s.doc.objects[s.selection[0]];
check(
  '11. Ctrl+C / Ctrl+V pastes a full copy of a group',
  pasted?.kind === 'group' && pasted.children.length === 2 && Object.keys(s.doc.objects).length === 7,
);

// --- 12. Workplane panel
await page.getByRole('button', { name: 'Workplane' }).first().click();
await page.getByRole('button', { name: '256 × 256' }).click();
s = await state();
check('12. Workplane preset changes the plate size', JSON.stringify(s.doc.settings.workplane) === '[256,256]');
await page.getByRole('switch', { name: 'Show grid' }).click();
check('12b. Grid can be hidden', (await page.evaluate(() => window.modellio.store.getState().showGrid)) === false);
await page.getByRole('switch', { name: 'Show grid' }).click();
await page.keyboard.press('Control+z');
check('12c. Plate size change is undoable', JSON.stringify((await state()).doc.settings.workplane) === '[200,200]');
await page.getByRole('button', { name: 'Shapes' }).first().click();

// --- 13. GPU memory over group/ungroup/delete cycles
const gpu = () =>
  page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.modellio.viewport.renderer.info.memory.geometries;
  });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const g0 = await gpu();
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => {
    const s = window.modellio.store.getState();
    const a = s.addShape('torus');
    const b = s.addShape('tube');
    s.select([a, b]);
    s.groupSelected();
    s.mirrorSelected(1);
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const s = window.modellio.store.getState();
    s.ungroupSelected();
    s.deleteSelected();
    s.clearSelection();
  });
  await page.waitForTimeout(150);
}
const g1 = await gpu();
check('13. No GPU geometry leak across group/mirror/ungroup/delete cycles', g1 <= g0, `${g0} → ${g1}`);

check('No runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
