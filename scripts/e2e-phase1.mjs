/**
 * End-to-end Phase 1 workflow check, driven through the real UI with real
 * mouse/keyboard input in Chromium (WebGL via SwiftShader).
 *
 *   npm run dev            # in one terminal
 *   node scripts/e2e-phase1.mjs [url] [screenshotDir]
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

const state = () => page.evaluate(() => {
  const s = window.modellio.store.getState();
  return { doc: s.doc, selection: s.selection, past: s.history.past.length, future: s.history.future.length, mode: s.mode };
});
const obj = async (id) => (await state()).doc.objects[id];
const screen = (p) => page.evaluate(([x, y, z]) => window.modellio.worldToScreen(x, y, z), p);
/** World-space length of one TransformControls gizmo unit at a point (mirrors three's sizing). */
const gizmoUnit = (p) =>
  page.evaluate(([x, y, z]) => {
    const cam = window.modellio.viewport.camera;
    const d = Math.hypot(cam.position.x - x, cam.position.y - y, cam.position.z - z);
    return (d * Math.min((1.9 * Math.tan((Math.PI * cam.fov) / 360)) / cam.zoom, 7) * 0.85) / 4;
  }, p);
const cameraPos = () => page.evaluate(() => { const c = window.modellio.viewport.camera.position; return [c.x, c.y, c.z]; });
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

// 1. Open the application
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
check('1. Application opens', await page.locator('canvas').first().isVisible());

// 2. 3D grid visible
await page.screenshot({ path: `${OUT}/01-empty.png` });
check('2. Workplane grid + viewport rendered', (await page.locator('[data-testid=viewport] canvas').count()) === 1);

// 3. Add cube, sphere, cylinder (click) + one by drag-and-drop
for (const label of ['Box', 'Sphere', 'Cylinder']) await page.locator(`button[title^="Add ${label} "]`).click();
let s = await state();
const ids = s.doc.rootIds;
const kinds = ids.map((id) => s.doc.objects[id].shape);
check('3. Box, sphere and cylinder added', JSON.stringify(kinds) === '["box","sphere","cylinder"]', kinds.join(', '));
const [boxId, sphereId, cylId] = ids;
const target = await screen([60, -40, 0]);
await page.locator('button[title^="Add Cone "]').dragTo(page.locator('[data-testid=viewport]'), { targetPosition: { x: target.x - 340, y: target.y - 108 } });
s = await state();
const cone = Object.values(s.doc.objects).find((o) => o.shape === 'cone');
check('3b. Drag-and-drop places a cone on the workplane', !!cone && close(cone.transform.position[2], 10), cone ? JSON.stringify(cone.transform.position) : 'none');
await page.screenshot({ path: `${OUT}/02-shapes.png` });

// 4. Select an object by clicking it in the viewport
await page.keyboard.press('Escape');
const box = await obj(boxId);
const boxScreen = await screen([box.transform.position[0], box.transform.position[1] - 9.9, box.transform.position[2]]);
await page.mouse.click(boxScreen.x, boxScreen.y);
await page.waitForTimeout(200);
s = await state();
check('4. Clicking the box selects it', s.selection.length === 1 && s.selection[0] === boxId, JSON.stringify(s.selection));
// clicking empty space deselects
const empty = await screen([-90, 90, 0]);
await page.mouse.click(empty.x, empty.y);
await page.waitForTimeout(150);
check('4b. Clicking empty space deselects', (await state()).selection.length === 0);
// orbit drag on empty space must not change selection
await page.mouse.click(boxScreen.x, boxScreen.y);
await drag(empty, { x: empty.x + 120, y: empty.y + 30 });
await page.waitForTimeout(1200); // let orbit damping settle before measuring handle positions
check('4c. Orbiting the camera keeps the selection', (await state()).selection[0] === boxId);

// 5. Move with the gizmo (drag the +X arrow)
let b0 = await obj(boxId);
let p = b0.transform.position;
let u = await gizmoUnit(p);
// TransformControls hides the arrow pointing away from the camera — grab the visible one.
const sx = Math.sign((await cameraPos())[0] - p[0]) || 1;
let a = await screen([p[0] + sx * 0.5 * u, p[1], p[2]]);
let o = await screen(p);
let dir = { x: a.x - o.x, y: a.y - o.y };
let len = Math.hypot(dir.x, dir.y);
const pastBeforeMove = (await state()).past;
await drag(a, { x: a.x + (dir.x / len) * 120, y: a.y + (dir.y / len) * 120 });
let b1 = await obj(boxId);
const dx = b1.transform.position[0] - p[0];
check(
  '5. Gizmo X-arrow drag moves along X only (snapped to 1 mm)',
  Math.abs(dx) > 5 && Number.isInteger(b1.transform.position[0]) && close(b1.transform.position[1], p[1]) && close(b1.transform.position[2], p[2]),
  `${JSON.stringify(p)} → ${JSON.stringify(b1.transform.position)}`,
);
s = await state();
check('5b. Whole drag recorded as ONE undo step', s.past === pastBeforeMove + 1, `${pastBeforeMove} → ${s.past}`);
check('5c. Selection kept after gizmo drag', s.selection[0] === boxId);
await page.screenshot({ path: `${OUT}/03-moved.png` });

// 6. Rotate (E), drag the Z ring — from the Home view (also exercises the animated camera views)
await page.getByRole('button', { name: 'Home view' }).click();
await page.waitForTimeout(900);
const camHome = await cameraPos();
check('6a. Home view button animates the camera back to the front-right-top view', camHome[0] > 0 && camHome[1] < 0 && camHome[2] > 0, camHome.map(Math.round).join(', '));
await page.keyboard.press('e');
await page.waitForTimeout(150);
p = b1.transform.position;
u = await gizmoUnit(p);
const r = 0.5 * u;
const cp = await cameraPos();
// Side of the Z ring (≈45° from the view direction) so we don't grab the free-rotate trackball.
const ang = Math.atan2(cp[1] - p[1], cp[0] - p[0]) + 0.8;
const ringPt = await screen([p[0] + r * Math.cos(ang), p[1] + r * Math.sin(ang), p[2]]);
const tangent = await screen([p[0] + r * Math.cos(ang) - 5 * Math.sin(ang), p[1] + r * Math.sin(ang) + 5 * Math.cos(ang), p[2]]);
dir = { x: tangent.x - ringPt.x, y: tangent.y - ringPt.y };
len = Math.hypot(dir.x, dir.y);
await drag(ringPt, { x: ringPt.x + (dir.x / len) * 90, y: ringPt.y + (dir.y / len) * 90 });
let b2 = await obj(boxId);
const rz = b2.transform.rotation[2];
check(
  '6. Rotate gizmo turns the box about Z in 15° steps',
  Math.abs(rz) >= 15 && close(rz % 15, 0, 0.01) && close(b2.transform.rotation[0], 0) && close(b2.transform.rotation[1], 0),
  JSON.stringify(b2.transform.rotation),
);
await page.screenshot({ path: `${OUT}/04-rotated.png` });

// 7. Resize (R), drag the +Z scale handle
await page.keyboard.press('r');
await page.waitForTimeout(150);
p = b2.transform.position;
u = await gizmoUnit(p);
a = await screen([p[0], p[1], p[2] + 0.5 * u]);
await drag(a, { x: a.x, y: a.y - 80 });
let b3 = await obj(boxId);
check(
  '7. Resize handle makes the box taller, bottom stays on the workplane',
  b3.size[2] > 20 && close(b3.size[0], 20) && close(b3.transform.position[2] - b3.size[2] / 2, 0, 0.01),
  `size ${JSON.stringify(b3.size)}, z ${b3.transform.position[2]}`,
);
await page.screenshot({ path: `${OUT}/05-resized.png` });

// 8. Exact dimensions in millimetres
const sizeX = page.getByLabel('Size X');
await sizeX.click();
await sizeX.fill('45.5');
await sizeX.press('Enter');
const sizeY = page.getByLabel('Size Y');
await sizeY.click();
await sizeY.fill('20+12');
await sizeY.press('Enter');
await page.getByLabel('Position Z').click(); // blur
let b4 = await obj(boxId);
check('8. Typed size 45.5 × (20+12) mm applied exactly', b4.size[0] === 45.5 && b4.size[1] === 32, JSON.stringify(b4.size));
// Backspace inside an input must not delete the object
await sizeX.click();
await page.keyboard.press('Backspace');
await page.keyboard.press('Escape');
check('8b. Backspace while typing does not delete the object', !!(await obj(boxId)));
await page.screenshot({ path: `${OUT}/06-exact-size.png` });

// 9. Duplicate and delete
await page.locator('[data-testid=viewport]').click({ position: { x: 5, y: 400 } }).catch(() => {});
await page.evaluate((id) => window.modellio.store.getState().select([id]), boxId);
await page.keyboard.press('Control+d');
s = await state();
const copyId = s.selection[0];
const copy = s.doc.objects[copyId];
check('9. Ctrl+D duplicates the box with identical size', copyId !== boxId && JSON.stringify(copy.size) === JSON.stringify(b4.size), copy?.name);
await page.keyboard.press('Delete');
check('9b. Delete removes the duplicate', !(await obj(copyId)) && Object.keys((await state()).doc.objects).length === 4);

// 10. Undo / redo
await page.keyboard.press('Control+z'); // undo delete
check('10. Ctrl+Z restores the deleted copy', !!(await obj(copyId)));
await page.keyboard.press('Control+z'); // undo duplicate
await page.keyboard.press('Control+z'); // undo size Y
await page.keyboard.press('Control+z'); // undo size X
let b5 = await obj(boxId);
check('10b. Undo walks back through typed sizes', JSON.stringify(b5.size) === JSON.stringify(b3.size), JSON.stringify(b5.size));
await page.keyboard.press('Control+z'); // resize
await page.keyboard.press('Control+z'); // rotate
await page.keyboard.press('Control+z'); // move
let b6 = await obj(boxId);
check('10c. Undo reverts resize, rotate and move', JSON.stringify(b6.transform) === JSON.stringify(b0.transform) && JSON.stringify(b6.size) === '[20,20,20]');
for (let i = 0; i < 5; i++) await page.keyboard.press('Control+Shift+z');
let b7 = await obj(boxId);
check('10d. Ctrl+Shift+Z redoes to the typed size', JSON.stringify(b7.size) === JSON.stringify(b4.size), JSON.stringify(b7.size));
await page.getByRole('button', { name: /^Undo/ }).click();
check('10e. Toolbar Undo button works', (await obj(boxId)).size[1] !== 32);
await page.getByRole('button', { name: /^Redo/ }).click();

await page.evaluate((id) => window.modellio.store.getState().select([id]), boxId);
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/07-final.png` });

// Multi-select move (shift-click)
const sph = await obj(sphereId);
const sphScreen = await screen(sph.transform.position);
await page.keyboard.down('Shift');
await page.mouse.click(sphScreen.x, sphScreen.y);
await page.keyboard.up('Shift');
s = await state();
check('Extra: Shift+click multi-selects', s.selection.length === 2, JSON.stringify(s.selection.length));
await page.keyboard.press('w');
await page.keyboard.press('ArrowUp');
const sph2 = await obj(sphereId);
check('Extra: Arrow-key nudge moves the whole selection', close(sph2.transform.position[1], sph.transform.position[1] + 1));

// View cube: click the Top face (cube centre is 72 px from the canvas' top-right corner).
await page.getByRole('button', { name: 'Home view' }).click();
await page.waitForTimeout(900);
const vbox = await page.locator('[data-testid=viewport] canvas').boundingBox();
await page.mouse.click(vbox.x + vbox.width - 72, vbox.y + 72 - 30);
await page.waitForTimeout(900);
const tgt = await page.evaluate(() => {
  const c = window.modellio.viewport.camera;
  const d = c.getWorldDirection(new c.position.constructor());
  return [d.x, d.y, d.z];
});
check('View cube "Top" face animates to a top-down view', tgt[2] < -0.99, `view dir ${tgt.map((v) => v.toFixed(2)).join(', ')}`);
await page.screenshot({ path: `${OUT}/08-top-view.png` });

// GPU memory: adding/resizing/deleting shapes must not leak geometries.
const gpuGeometries = () =>
  page.evaluate(async () => {
    window.modellio.viewport.renderer && (await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return window.modellio.viewport.renderer.info.memory.geometries;
  });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const geoBefore = await gpuGeometries();
for (let round = 0; round < 3; round++) {
  const added = await page.evaluate(() => {
    const s = window.modellio.store.getState();
    const types = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'tube', 'halfSphere', 'polygon'];
    return types.map((t) => s.addShape(t));
  });
  await page.waitForTimeout(200);
  await page.evaluate((ids) => {
    const s = window.modellio.store.getState();
    ids.forEach((id, i) => s.setSize(id, [10 + i, 12 + i, 8 + i])); // forces geometry regeneration
  }, added);
  await page.waitForTimeout(200);
  await page.evaluate((ids) => {
    const s = window.modellio.store.getState();
    s.select(ids);
    s.deleteSelected();
  }, added);
  await page.waitForTimeout(200);
}
const geoAfter = await gpuGeometries();
check('GPU geometries are released after add → resize → delete cycles', geoAfter <= geoBefore, `${geoBefore} → ${geoAfter}`);

check('No runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
