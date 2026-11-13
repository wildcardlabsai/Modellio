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
  // The page is lazy-loaded: wait for it rather than sampling visibility immediately.
  const storageShown = await page
    .getByTestId('storage-info')
    .waitFor()
    .then(() => true)
    .catch(() => false);
  check('R1. My Projects shows storage usage and protection status', storageShown, await page.getByTestId('storage-info').textContent());
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

// ===================== Direct manipulation =====================
{
  await reset();
  await home();
  const [a, b] = await S(() => {
    const s = window.modellio.store.getState();
    const a = s.addShape('box', [-30, 0], { exact: true });
    const b = s.addShape('box', [30, 0], { exact: true });
    s.setSize(b, [24, 24, 30]);
    s.setPosition(b, [30, 0, 15]);
    s.clearSelection();
    return [a, b];
  });
  await page.waitForTimeout(300);
  // D1: press on box A and drag it on top of box B.
  const from = await screen([-30, 0, 20]);
  const to = await screen([30, 0, 20]); // movement is 1:1 at the grab height (A's top, z = 20)
  const past0 = (await state()).past;
  const camBefore = await S(() => window.modellio.viewport.camera.position.toArray().map(Math.round).join());
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 25 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  let ba = await bounds([a]);
  check(
    'D1. Dragging an object onto another stacks it on the top face',
    close(ba.min[2], 30, 0.01) && Math.abs((ba.min[0] + ba.max[0]) / 2 - 30) < 6,
    `bottom z ${ba.min[2]}`,
  );
  check('D1b. …selects it, and the whole drag is one undo step', (await state()).selection[0] === a && (await state()).past === past0 + 1);
  const camAfter = await S(() => window.modellio.viewport.camera.position.toArray().map(Math.round).join());
  check('D1c. The camera did not orbit while dragging the object', camBefore === camAfter, `${camBefore} → ${camAfter}`);
  await page.keyboard.press('Control+z');
  ba = await bounds([a]);
  check('D1d. Undo puts it back on the plate', close(ba.min[2], 0, 0.01) && close(ba.min[0], -40, 0.01));

  // D2: drop a cylinder from the library onto B's top face.
  const top = await screen([30, 0, 30]);
  const vp = await page.locator('[data-testid=viewport]').boundingBox();
  await page
    .locator('button[title^="Add Cylinder "]')
    .dragTo(page.locator('[data-testid=viewport]'), { targetPosition: { x: top.x - vp.x, y: top.y - vp.y } });
  let st = await state();
  const cyl = st.selection[0];
  let bc = await bounds([cyl]);
  check(
    'D2. A shape dropped on a top face stands on it',
    st.doc.objects[cyl]?.shape === 'cylinder' && close(bc.min[2], 30, 0.05),
    `bottom z ${bc.min[2].toFixed(2)}`,
  );

  // D3: drop a cone onto B's front (−Y) face: it should point out of that face.
  const side = await screen([30, -12, 15]);
  await page
    .locator('button[title^="Add Cone "]')
    .dragTo(page.locator('[data-testid=viewport]'), { targetPosition: { x: side.x - vp.x, y: side.y - vp.y } });
  st = await state();
  const cone = st.selection[0];
  const axis = await S((id) => {
    const { store, hierarchy } = window.modellio;
    const e = hierarchy.worldMatrix(store.getState().doc, id).elements;
    return [e[8], e[9], e[10]].map((v) => Math.round(v * 1000) / 1000);
  }, cone);
  bc = await bounds([cone]);
  check(
    'D3. A shape dropped on a side face is oriented along the face normal',
    close(axis[1], -1, 0.01) && close(bc.max[1], -12, 0.05),
    `axis ${axis}`,
  );
  await S(
    (ids) => {
      const s = window.modellio.store.getState();
      s.select(ids);
      s.deleteSelected();
    },
    [cyl, cone],
  );

  // D4: resize handles (R): drag the +X edge handle of A outward.
  await S((id) => window.modellio.store.getState().select([id]), a);
  await page.keyboard.press('r');
  await page.waitForTimeout(200);
  const ex = await screen([-20, 0, 0]);
  const ex2 = await screen([-5, 0, 0]);
  await page.mouse.move(ex.x, ex.y);
  await page.mouse.down();
  await page.mouse.move(ex2.x, ex2.y, { steps: 15 });
  await page.mouse.up();
  ba = await bounds([a]);
  check(
    'D4. +X edge handle stretches X only, the −X side stays put',
    close(ba.min[0], -40, 0.01) && close(ba.max[0], -5, 0.6) && close(ba.max[1] - ba.min[1], 20, 0.01),
    `x ${ba.min[0]} … ${ba.max[0]}`,
  );
  // D5: top handle sets the height.
  const tz = await screen([(ba.min[0] + ba.max[0]) / 2, 0, 20]);
  await page.mouse.move(tz.x, tz.y);
  await page.mouse.down();
  await page.mouse.move(tz.x, tz.y - 60, { steps: 12 });
  await page.mouse.up();
  ba = await bounds([a]);
  check('D5. Top handle raises the height from the bottom', close(ba.min[2], 0, 0.01) && ba.max[2] > 25, `height ${ba.max[2]}`);
  // D6: Shift + corner = uniform.
  const before = await S((id) => window.modellio.store.getState().doc.objects[id].size, a);
  const corner = await screen([ba.max[0], ba.min[1], 0]);
  const corner2 = await screen([ba.max[0] + 10, ba.min[1] - 3, 0]);
  await page.keyboard.down('Shift');
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner2.x, corner2.y, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const after = await S((id) => window.modellio.store.getState().doc.objects[id].size, a);
  const ratios = after.map((v, i) => v / before[i]);
  check(
    'D6. Shift + corner handle resizes uniformly',
    ratios[0] > 1.05 && ratios.every((r) => close(r, ratios[0], 0.03)),
    ratios.map((r) => r.toFixed(3)).join(' / '),
  );
  await page.keyboard.press('w');
  await page.screenshot({ path: `${OUT}/p5-01-handles.png` });

  // D7: smart snapping to a neighbour (B moved to a non-grid position).
  await S(
    ([a, b]) => {
      const s = window.modellio.store.getState();
      s.setSize(a, [20, 20, 20]);
      s.setPosition(a, [-30, 0, 10]);
      s.setPosition(b, [30.3, 0, 15]); // B's min X = 18.3
      s.clearSelection();
    },
    [a, b],
  );
  await page.waitForTimeout(200);
  const p0 = await screen([-30, -10, 10]);
  const p1 = await screen([7.6, -10, 10]); // A's max X ≈ 17.6 → should snap to 18.3
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 20 });
  const guides = await S(() => window.modellio.guides.getState().guides.length);
  await page.mouse.up();
  ba = await bounds([a]);
  check('D7. Dragging near a neighbour snaps edges together (off-grid)', close(ba.max[0], 18.3, 0.01), `A max X ${ba.max[0]}`);
  check('D7b. …and shows a snap guide while dragging', guides > 0, `${guides} guide(s)`);

  // D8: Shift + drag box-select.
  await page.keyboard.press('Escape');
  const r0 = await screen([-60, -40, 0]);
  const r1 = await screen([60, 40, 0]);
  await page.keyboard.down('Shift');
  await page.mouse.move(Math.min(r0.x, r1.x) - 40, Math.max(r0.y, r1.y) + 30);
  await page.mouse.down();
  await page.mouse.move(Math.max(r0.x, r1.x) + 40, Math.min(r0.y, r1.y) - 140, { steps: 10 });
  const marqueeShown = await page.getByTestId('marquee').isVisible();
  await page.mouse.up();
  await page.keyboard.up('Shift');
  st = await state();
  check('D8. Shift + drag on empty space box-selects', marqueeShown && st.selection.length === 2, `${st.selection.length} selected`);

  // D9: double-click inside a combination picks the part.
  const hole = await S(
    ([a]) => {
      const s = window.modellio.store.getState();
      s.setSize(a, [30, 30, 20]);
      s.setPosition(a, [-30, 0, 10]);
      const h = s.addShape('cylinder', [-30, 0], { exact: true });
      s.setSize(h, [10, 10, 30]);
      s.setPosition(h, [-30, 0, 10]);
      s.setHole([h], true);
      s.select([a, h]);
      s.combineSelected('union');
      return h;
    },
    [a],
  );
  await home();
  await page.keyboard.press('r'); // resize mode: the move gizmo is hidden, so it can't take the double-click
  await page.waitForTimeout(600);
  const onBox = await screen([-38, -8, 20]);
  await page.mouse.dblclick(onBox.x, onBox.y);
  st = await state();
  check(
    'D9. Double-clicking a combination selects the part under the cursor',
    st.selection[0] === a,
    st.doc.objects[st.selection[0]]?.name,
  );
  // Look into the hole through its opening (off-centre: the top resize handle sits at the centre);
  // the surface seen there is the hole's inner wall.
  const inHole = await screen([-32.5, 2.5, 20]);
  await page.keyboard.press('Escape'); // deselect the box part (its ghost would cover the opening)
  await page.waitForTimeout(200);
  await page.mouse.dblclick(inHole.x, inHole.y);
  st = await state();
  check('D9b. …including a hole, picked through the cut it makes', st.selection[0] === hole, st.doc.objects[st.selection[0]]?.name);
  await page.screenshot({ path: `${OUT}/p5-02-combination-pick.png` });
  await page.keyboard.press('w');
  await reset();
}

// ===================== Printing =====================
{
  const { unzipSync, strFromU8 } = require('fflate');
  await reset();
  await home();
  const [box, wedge] = await S(() => {
    const s = window.modellio.store.getState();
    const b = s.addShape('box', [-30, 0], { exact: true });
    s.setColor(b, '#FF0000');
    const w = s.addShape('wedge', [30, 0], { exact: true });
    s.clearSelection();
    return [b, w];
  });

  // P1: 3MF export.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('radio', { name: '3MF' }).click();
  const file = await download(() => page.getByRole('button', { name: /Download 3MF/ }).click());
  const zip = unzipSync(new Uint8Array(fs.readFileSync(file)));
  const model = strFromU8(zip['3D/3dmodel.model'] ?? new Uint8Array());
  check(
    'P1. 3MF export: valid package with millimetres, both objects and their colours',
    file.endsWith('.3mf') &&
      model.includes('unit="millimeter"') &&
      (model.match(/<object /g) ?? []).length === 2 &&
      model.includes('#FF0000FF'),
  );

  // P2: lay flat on the wedge's slope.
  await page.keyboard.press('l');
  const slope = await screen([30, 0, 10]); // the slope passes through the wedge's centre
  await page.mouse.click(slope.x, slope.y);
  const after = await S((id) => {
    const { store, hierarchy } = window.modellio;
    const d = store.getState().doc;
    const e = hierarchy.worldMatrix(d, id).elements;
    // the slope's outward normal in local space is (1, 0, 1)/√2
    const nz = (e[2] + e[10]) * Math.SQRT1_2;
    return { minZ: hierarchy.worldBoundsOf(d, [id]).min.z, nz, tool: store.getState().tool };
  }, wedge);
  check(
    'P2. Lay flat (L) + click puts the clicked slope face-down on the plate',
    close(after.minZ, 0, 0.01) && close(after.nz, -1, 0.01) && after.tool === 'select',
    JSON.stringify(after),
  );

  // P3: printability check.
  await S((id) => {
    const s = window.modellio.store.getState();
    s.setPosition(id, [-30, 0, 25]); // floating box → overhang + floating
    const thin = s.addShape('box', [0, 50], { exact: true });
    s.setSize(thin, [30, 30, 0.5]);
    s.setPosition(thin, [0, 50, 0.25]);
    s.clearSelection();
  }, box);
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  await page.getByRole('button', { name: 'Check printability' }).click();
  await page.getByTestId('print-report').waitFor();
  const text = await page.getByTestId('print-report').textContent();
  check(
    'P3. Print check finds the floating part, its overhang and the thin wall',
    /does not touch the plate/.test(text) && /overhangs/.test(text) && /thinner than 0.8 mm/.test(text),
    text.slice(0, 160),
  );
  check('P3a. The laid-flat wedge really rests on the plate (not reported as floating)', !/Wedge does not touch/.test(text));
  check('P3b. Problem areas are highlighted in 3D', await S(() => !!window.modellio.viewport.scene.getObjectByName('print-highlights')));
  await page.screenshot({ path: `${OUT}/p5-03-print-check.png` });
  await S((id) => window.modellio.store.getState().dropToWorkplane([id]), box);
  check('P3c. Results are marked stale after an edit', await page.getByText('The design changed since this check').isVisible());
  await page.getByRole('button', { name: 'Shapes', exact: true }).first().click();

  // P4: hollow + chamfer via the inspector.
  await S((id) => window.modellio.store.getState().select([id]), box);
  const tris = () => S((id) => window.modellio.viewport.scene.getObjectByName(id)?.geometry.getAttribute('position').count ?? 0, box);
  const solidTris = await tris();
  const wall = page.getByLabel('Wall thickness');
  await wall.click();
  await wall.fill('2');
  await wall.press('Enter');
  await waitFor(async () => (await tris()) !== solidTris);
  check(
    'P4. Setting a wall thickness hollows the box (real geometry)',
    (await tris()) > solidTris,
    `${solidTris} → ${await tris()} vertices`,
  );
  await page.getByRole('switch', { name: 'Open top' }).click();
  check('P4b. Open top is applied', (await S((id) => window.modellio.store.getState().doc.objects[id].params.openTop, box)) === 1);
  await S((id) => {
    const s = window.modellio.store.getState();
    s.setParam(id, 'shell', 0);
  }, box);
  const sharp = await tris();
  const ch = page.getByLabel('Chamfer', { exact: true });
  await ch.click();
  await ch.fill('3');
  await ch.press('Enter');
  await waitFor(async () => (await tris()) !== sharp);
  check(
    'P4c. Chamfer edits the box edges',
    (await tris()) !== sharp && (await S((id) => window.modellio.store.getState().doc.objects[id].params.chamfer, box)) === 3,
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/p5-04-hollow-chamfer.png` });
  await reset();
}

// ===================== Accessibility, onboarding, performance =====================
{
  await reset();
  const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const axe = async (label) => {
    await page.addScriptTag({ content: axeSource });
    const res = await S(async () => {
      const r = await window.axe.run(document, { resultTypes: ['violations'] });
      return r.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target?.join(' ')}`);
    });
    check(`A1. No serious accessibility violations: ${label}`, res.length === 0, res.slice(0, 4).join(' | '));
  };
  const [a, b, c] = await S(() => {
    const s = window.modellio.store.getState();
    const ids = [s.addShape('box'), s.addShape('sphere'), s.addShape('cylinder')];
    s.select([ids[0]]);
    return ids;
  });
  await page.waitForTimeout(300);
  await axe('editor with a selection');

  // A2: keyboard navigation in the object tree.
  const yBefore = await S((ids) => ids.map((id) => window.modellio.store.getState().doc.objects[id].transform.position[1]), [a, b, c]);
  await page.locator('[role=treeitem]').first().focus();
  await page.keyboard.press('ArrowDown');
  let st = await state();
  check('A2. ↓ in the object tree moves the selection to the next object', st.selection.length === 1 && st.selection[0] === b);
  await page.keyboard.press('Shift+ArrowDown');
  st = await state();
  check('A2b. Shift+↓ extends the selection', st.selection.length === 2 && st.selection.includes(c));
  const yAfter = await S((ids) => ids.map((id) => window.modellio.store.getState().doc.objects[id].transform.position[1]), [a, b, c]);
  check(
    'A2c. Arrow keys in the tree navigate instead of nudging objects',
    JSON.stringify(yAfter) === JSON.stringify(yBefore),
    `${yBefore} → ${yAfter}`,
  );
  await page.keyboard.press('Enter');
  check('A2d. Enter starts renaming the focused object', await page.getByLabel('Rename object').isVisible());
  await page.keyboard.press('Escape');
  const announced = await waitFor(async () => /selected/.test((await page.getByTestId('announcer').textContent()) ?? ''), 2000);
  check('A2e. Screen readers are told what is selected', announced, await page.getByTestId('announcer').textContent());

  // A3: dialogs trap focus and give it back.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('dialog', { name: 'Export for 3D printing' }).waitFor();
  await axe('export dialog');
  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
  const inside = await S(() => !!document.activeElement?.closest('[role=dialog]'));
  check('A3. Tab stays inside an open dialog', inside);
  await page.keyboard.press('Escape');
  check(
    'A3b. Closing a dialog returns focus to the button that opened it',
    await S(() => document.activeElement?.textContent?.trim() === 'Export'),
  );

  await page.getByRole('button', { name: 'My Projects' }).click();
  await page.getByRole('heading', { name: 'My projects' }).waitFor();
  await axe('My Projects page');
  await page.getByRole('button', { name: 'Design', exact: true }).click();

  // A4: reduced motion: camera views switch instantly.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Standard views' }).click();
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await page.waitForTimeout(60);
  const dz = await S(() => {
    const cam = window.modellio.viewport.camera;
    const d = cam.getWorldDirection(new cam.position.constructor());
    return d.z;
  });
  check('A4. With reduced motion, camera views change without animation', dz < -0.99, dz.toFixed(3));
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // PF: Booleans run in a background worker; heavy modules load on demand.
  const loadedBefore = await S(() => performance.getEntriesByType('resource').some((r) => /opentype/.test(r.name)));
  await S(
    ([a, b]) => {
      const s = window.modellio.store.getState();
      s.setHole([b], true);
      s.select([a, b]);
      s.combineSelected('union');
    },
    [a, b],
  );
  await waitFor(() => S(() => window.modellio.booleanStats().cached > 0));
  check('PF1. Boolean operations run in a background worker', await S(() => window.modellio.booleanStats().worker));
  check('PF2. The font engine is not downloaded until text is used', loadedBefore === false);
  await S(() => window.modellio.store.getState().addText('Hi'));
  check(
    'PF2b. …and is fetched on demand when it is',
    await waitFor(() => S(() => performance.getEntriesByType('resource').some((r) => /opentype/.test(r.name)))),
  );
  await reset();

  // O: first-run tour on a fresh profile.
  const fresh = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const tp = await fresh.newPage();
  await tp.goto(URL + '?tour', { waitUntil: 'networkidle' });
  const tour = tp.getByTestId('tour');
  check(
    'O1. A first visit starts the guided tour',
    await tour
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false),
  );
  check('O1b. The first step points at the shape library', (await tp.getByRole('dialog', { name: 'Add shapes' }).count()) === 1);
  await tp.addScriptTag({ content: axeSource });
  const tourViolations = await tp.evaluate(
    async () =>
      (await window.axe.run(document.querySelector('[data-testid=tour]'))).violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      ).length,
  );
  check('A1. No serious accessibility violations: tour', tourViolations === 0);
  for (let i = 0; i < 5; i++) await tp.keyboard.press('ArrowRight');
  check('O2. Arrow keys step through the tour', (await tp.getByRole('dialog', { name: 'Print it' }).count()) === 1);
  await tp.screenshot({ path: `${OUT}/p5-05-tour.png` });
  await tp.getByRole('button', { name: 'Start designing' }).click();
  check(
    'O3. Finishing the tour closes it and remembers',
    (await tour.count()) === 0 && (await tp.evaluate(() => localStorage.getItem('modellio:onboarded'))) === '1',
  );
  await tp.reload({ waitUntil: 'networkidle' });
  await tp.waitForTimeout(1500);
  check('O4. It does not come back on the next visit', (await tour.count()) === 0);
  await tp.getByRole('button', { name: 'Help' }).click();
  await tp.getByRole('menuitem', { name: 'Take the tour' }).click();
  check('O5. Help → Take the tour restarts it', await tour.isVisible());
  await tp.keyboard.press('Escape');
  check('O5b. Esc skips the tour', (await tour.count()) === 0);
  await fresh.close();
}

// @@SECTIONS@@

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
