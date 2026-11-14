/**
 * End-to-end check for the MODELLIO 2.0 Design Studio additions: orthographic / isometric views,
 * the history timeline, the gear and box & lid generators, text spacing, mesh tools, GLB export
 * and re-import, and the sketch editor (draw → dimension → extrude / revolve → edit).
 *
 *   node scripts/e2e-studio2.mjs [url] [screenshotDir]
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
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
const objects = () =>
  S(() => {
    const d = window.modellio.store.getState().doc;
    return Object.values(d.objects).map((o) => ({ id: o.id, name: o.name, kind: o.kind, shape: o.shape, size: o.size, params: o.params }));
  });
const clear = () =>
  S(() => {
    const s = window.modellio.store.getState();
    s.selectAll?.();
    const ids = window.modellio.store.getState().doc.rootIds;
    window.modellio.store.setState({ selection: ids });
    window.modellio.store.getState().deleteSelected();
  });

await page.goto(`${URL}/?studio=design`, { waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
await page.waitForTimeout(1500);
await clear();

// 1. Projection and views
await S(() => window.modellio.store.getState().addShape('box'));
await page.getByTestId('projection-toggle').click();
const ortho = await until(() => S(() => window.modellio.viewport.camera?.isOrthographicCamera === true));
check('1. The projection toggle switches to an orthographic camera', ortho);
check('2. The toggle says ORTHO and is pressed', (await page.getByTestId('projection-toggle').getAttribute('aria-pressed')) === 'true');
await page.getByRole('button', { name: 'Standard views' }).click();
await page.getByRole('button', { name: 'Isometric', exact: true }).click();
await page.waitForTimeout(900);
const dir = await S(() => {
  const c = window.modellio.viewport.camera;
  const t = window.modellio.viewport.orbitControls.target;
  const v = [c.position.x - t.x, c.position.y - t.y, c.position.z - t.z];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
});
const iso = 1 / Math.sqrt(3);
check(
  '3. Isometric looks along (1, −1, 1)',
  Math.abs(dir[0] - iso) < 0.02 && Math.abs(dir[1] + iso) < 0.02 && Math.abs(dir[2] - iso) < 0.02,
  dir.map((x) => x.toFixed(3)).join(','),
);
// Clicking the box in orthographic view selects it.
await S(() => window.modellio.store.setState({ selection: [] }));
const box = await S(() => window.modellio.store.getState().doc.rootIds[0]);
const pt = await S((id) => {
  const o = window.modellio.store.getState().doc.objects[id];
  return window.modellio.worldToScreen(...o.transform.position);
}, box);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(300);
check('4. Clicking a shape in orthographic view selects it', await S((id) => window.modellio.store.getState().selection.includes(id), box));
await page.screenshot({ path: `${OUT}/studio2-01-ortho-iso.png` });
await page.getByTestId('projection-toggle').click();
check(
  '5. Switching back gives a perspective camera',
  await until(() => S(() => window.modellio.viewport.camera?.isPerspectiveCamera === true)),
);

// 2. History timeline
await S(() => {
  const s = window.modellio.store.getState();
  s.addShape('cylinder');
  s.addShape('sphere');
});
await page.waitForTimeout(200);
const steps = await page.getByTestId('history-step').count();
check('6. The history timeline lists each step', steps >= 4, `${steps} steps`);
const before = (await objects()).length;
await page
  .getByTestId('history-step')
  .nth(steps - 3)
  .click();
await page.waitForTimeout(200);
const after = (await objects()).length;
check('7. Clicking an earlier step goes back to it', after === before - 2, `${before} → ${after}`);
await page.getByTestId('history-step').last().click();
await page.waitForTimeout(200);
check('8. Clicking a later (undone) step redoes up to it', (await objects()).length === before);

// 3. Gear
await clear();
const gearId = await S(() => window.modellio.store.getState().addShape('gear'));
await page.waitForTimeout(300);
await S((id) => window.modellio.store.setState({ selection: [id] }), gearId);
const teeth = page.getByLabel('Teeth', { exact: true });
await teeth.waitFor({ timeout: 8000 });
await teeth.fill('30');
await teeth.press('Enter');
const g = await until(() => S((id) => window.modellio.store.getState().doc.objects[id].params.teeth === 30, gearId));
check('9. The gear inspector sets the tooth count', g);
const gearTris = await until(() =>
  S((id) => {
    let n = 0;
    window.modellio.viewport.scene.traverse((o) => {
      if (o.isMesh && o.userData.pickable && o.userData.objectId === id)
        n = Math.max(n, (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3);
    });
    return n > 100 && n;
  }, gearId),
);
check('10. The 30-tooth gear renders as real geometry', gearTris > 100, `${gearTris} triangles`);

// 4. Box & Lid
await clear();
await page.getByRole('button', { name: /Box & Lid/ }).click();
await page.getByRole('button', { name: 'Add box and lid' }).click();
const parts = await until(async () => {
  const o = await objects();
  return o.filter((x) => x.kind === 'group' || x.kind === 'shape').length >= 2 && o;
});
const roots = await S(() =>
  window.modellio.store.getState().doc.rootIds.map((id) => window.modellio.store.getState().doc.objects[id].name),
);
check(
  '11. Box & Lid adds a box and a lid',
  roots.length === 2 && roots.some((n) => /lid/i.test(n)) && roots.some((n) => /box/i.test(n)),
  roots.join(', '),
);
void parts;

// 5. Text spacing
await clear();
const textId = await S(() => window.modellio.store.getState().addText('MAKER', [0, 0]));
await S((id) => window.modellio.store.setState({ selection: [id] }), textId);
await page.waitForTimeout(500);
const w0 = await until(() => S((id) => window.modellio.store.getState().doc.objects[id].size[0], textId));
const ls = page.getByLabel('Letter spacing (em)', { exact: true });
await ls.fill('0.5');
await ls.press('Enter');
const w1 = await until(async () => {
  const w = await S((id) => window.modellio.store.getState().doc.objects[id].size[0], textId);
  return w > w0 + 1 && w;
});
check('12. Letter spacing widens the text', w1 > w0 + 1, `${w0} → ${w1}`);
await page.getByRole('radiogroup', { name: 'Text alignment' }).getByRole('radio').nth(1).click();
check(
  '13. Text alignment is stored',
  await until(() => S((id) => (window.modellio.store.getState().doc.objects[id].params.align ?? 0) !== 0, textId)),
);

// 6. GLB export → re-import
await clear();
await S(() => window.modellio.store.getState().addShape('box'));
await page.getByRole('button', { name: 'Export', exact: true }).click();
await page.getByRole('radio', { name: 'GLB' }).click();
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download GLB/ }).click()]);
const glbPath = `${OUT}/studio2-box.glb`;
await dl.saveAs(glbPath);
const glb = fs.readFileSync(glbPath);
check('14. GLB export downloads a binary glTF', glb.readUInt32LE(0) === 0x46546c67 && glb.readUInt32LE(4) === 2, `${glb.length} bytes`);
await clear();
await page
  .locator('input[type=file]')
  .first()
  .waitFor({ state: 'attached', timeout: 3000 })
  .catch(() => {});
await S(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([bytes], 'box.glb', { type: 'model/gltf-binary' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const el = document.querySelector('[data-testid="viewport"]');
  const r = el.getBoundingClientRect();
  for (const type of ['dragenter', 'dragover', 'drop'])
    el.dispatchEvent(
      new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }),
    );
}, glb.toString('base64'));
const importBtn = page.getByRole('button', { name: 'Import', exact: true });
await importBtn.waitFor({ timeout: 8000 }).catch(() => {});
if (await importBtn.isVisible().catch(() => false)) await importBtn.click();
const imported = await until(async () => (await objects()).find((o) => o.shape === 'mesh'));
check(
  '15. The GLB re-imports at the same size (20 mm box)',
  imported && imported.size.every((v) => Math.abs(v - 20) < 0.05),
  JSON.stringify(imported?.size),
);
await S((id) => window.modellio.store.setState({ selection: [id] }), imported?.id);
await page
  .getByTestId('mesh-report')
  .waitFor({ timeout: 5000 })
  .catch(() => {});
check('16. The mesh report says it is a closed solid', /closed solid/.test((await page.getByTestId('mesh-report').textContent()) ?? ''));
const tri0 = await S((id) => window.modellio.store.getState().doc.objects[id].meshId, imported.id);
await page.getByRole('button', { name: 'Subdivide', exact: true }).click();
const tri1 = await until(async () => {
  const id = await S((id) => window.modellio.store.getState().doc.objects[id].meshId, imported.id);
  return id !== tri0 && id;
});
const report = (await page.getByTestId('mesh-report').textContent()) ?? '';
check('17. Subdivide replaces the mesh and keeps it closed', !!tri1 && /closed solid/.test(report), report);

// 7. Sketch → extrude
await clear();
await page.getByTestId('new-sketch').click();
await page.getByTestId('sketch-editor').waitFor();
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
await page.getByTestId('sketch-editor').getByRole('button', { name: 'Rectangle', exact: true }).click();
for (const [x, y] of [
  [0, 0],
  [30, 20],
]) {
  const [sx, sy] = await toScreen(x, y);
  await page.mouse.click(sx, sy);
}
check('18. The rectangle tool draws four lines', (await page.getByTestId('sketch-line').count()) === 4);
const status1 = await page.getByTestId('sketch-status').textContent();
check('19. The status reports remaining degrees of freedom', /Under-constrained · 4 degrees/.test(status1), status1);
// Dimension the bottom edge to 40 mm.
await page.getByTestId('sketch-editor').getByRole('button', { name: 'Select', exact: true }).click();
let [sx, sy] = await toScreen(15, 0);
await page.mouse.click(sx, sy);
await page.getByTestId('sketch-selection').waitFor();
const len = page.getByLabel('Line length (mm)', { exact: true });
await len.fill('40');
await len.press('Enter');
await page.waitForTimeout(200);
const top = await S(() =>
  [...document.querySelectorAll('[data-testid="sketch-line"]')].map((l) => Math.abs(+l.getAttribute('x2') - +l.getAttribute('x1'))),
);
check(
  '20. A typed length is solved (and the opposite side follows)',
  top.filter((w) => Math.abs(w - 40) < 0.01).length === 2,
  top.join(','),
);
// Fix the bottom-left corner and dimension the height → fully constrained.
const corner = await S(() => {
  const pts = [...document.querySelectorAll('[data-testid="sketch-point"]')].map((c) => [+c.getAttribute('cx'), -c.getAttribute('cy')]);
  return pts.sort((a, b) => a[0] + a[1] - (b[0] + b[1]))[0];
});
[sx, sy] = await toScreen(corner[0], corner[1]);
await page.mouse.click(sx, sy);
await page.getByRole('button', { name: 'Fix point' }).click();
[sx, sy] = await toScreen(corner[0], corner[1] + 10);
await page.mouse.click(sx, sy);
await len.fill('20');
await len.press('Enter');
await page.waitForTimeout(200);
const status2 = await page.getByTestId('sketch-status').textContent();
check('21. Fixing a corner and typing the height makes it fully constrained', /Fully constrained/.test(status2), status2);
// A conflicting dimension is reported.
await page.getByRole('button', { name: 'Horizontal', exact: true }).click();
const status3 = await page.getByTestId('sketch-status').textContent();
check('22. A contradictory constraint is reported', /Conflicting|Over-constrained/.test(status3), status3);
await page.getByTestId('sketch-constraints').getByRole('button').last().click();
check('23. Removing it clears the problem', /Fully constrained/.test(await page.getByTestId('sketch-status').textContent()));
await page.screenshot({ path: `${OUT}/studio2-02-sketch.png` });
await page.getByLabel('Extrude depth (mm)', { exact: true }).fill('8');
await page.getByLabel('Extrude depth (mm)', { exact: true }).press('Enter');
await page.getByTestId('sketch-finish').click();
await page.getByTestId('sketch-editor').waitFor({ state: 'detached' });
const prof = await until(async () => (await objects()).find((o) => o.shape === 'profile'));
check(
  '24. Create solid adds a 40 × 20 × 8 mm sketched solid',
  prof && Math.abs(prof.size[0] - 40) < 0.01 && Math.abs(prof.size[1] - 20) < 0.01 && Math.abs(prof.size[2] - 8) < 0.01,
  JSON.stringify(prof?.size),
);
const solidTris = await until(() =>
  S((id) => {
    let n = 0;
    window.modellio.viewport.scene.traverse((o) => {
      if (o.isMesh && o.userData.pickable && o.userData.objectId === id)
        n = (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    });
    return n > 0 && n;
  }, prof.id),
);
check('25. The sketched solid is rendered in the scene', solidTris >= 12, `${solidTris} triangles`);

// Revolve from the inspector, then edit the sketch.
await S((id) => window.modellio.store.setState({ selection: [id] }), prof.id);
await page.getByRole('radiogroup', { name: 'Sketch operation' }).getByRole('radio', { name: 'revolve' }).click();
const rev = await until(async () => {
  const o = (await objects()).find((x) => x.id === prof.id);
  return o.params.op === 1 && o;
});
// The part right of the Y axis is revolved: diameter = 2 × the profile's furthest x.
const maxX = await S((id) => Math.max(...window.modellio.store.getState().doc.objects[id].sketch.points.map((p) => p.x)), prof.id);
check(
  '26. Revolve makes a solid of revolution: ⌀ = 2 × the profile’s reach, height = its height',
  rev && Math.abs(rev.size[0] - 2 * maxX) < 0.5 && Math.abs(rev.size[1] - 2 * maxX) < 0.5 && Math.abs(rev.size[2] - 20) < 0.01,
  `${JSON.stringify(rev?.size)} for x ≤ ${maxX.toFixed(2)}`,
);
await page.getByTestId('edit-sketch').click();
await page.getByTestId('sketch-editor').waitFor();
check('27. Edit sketch reopens the saved sketch', (await page.getByTestId('sketch-line').count()) === 4);
await page.getByTestId('sketch-editor').getByRole('button', { name: 'Circle', exact: true }).click();
for (const [x, y] of [
  [-12, 30],
  [-8, 30],
]) {
  const [cx, cy] = await toScreen(x, y);
  await page.mouse.click(cx, cy);
}
await page.getByTestId('sketch-editor').getByRole('button', { name: 'Polygon', exact: true }).click();
for (const [x, y] of [
  [38, -10],
  [43, -10],
]) {
  const [cx, cy] = await toScreen(x, y);
  await page.mouse.click(cx, cy);
}
const counts = { circles: await page.getByTestId('sketch-circle').count(), lines: await page.getByTestId('sketch-line').count() };
check(
  '27b. Circle and hexagon tools add a circle and six equal lines',
  counts.circles === 1 && counts.lines === 10,
  JSON.stringify(counts),
);
check(
  '27c. Three closed outlines are found',
  /^3 closed outlines/.test(await page.getByTestId('sketch-status').locator('xpath=following-sibling::p').textContent()),
);
await page.screenshot({ path: `${OUT}/studio2-02b-sketch-tools.png` });
await page.getByRole('button', { name: 'Close sketch without saving' }).click();
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
const undone = (await objects()).find((x) => x.id === prof.id);
check(
  '28. Undo goes back to the extruded solid',
  undone?.params.op === 0 && Math.abs(undone.size[2] - 8) < 0.01,
  JSON.stringify(undone?.size),
);
await page.screenshot({ path: `${OUT}/studio2-03-profile.png` });

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
