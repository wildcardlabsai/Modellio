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

// 6. Exact Booleans: a plate with a hole is combined exactly, becomes one precise solid, and can be filleted.
const [plate, cyl] = await S(() => {
  const s = window.modellio.store.getState();
  const a = s.addShape('box');
  s.setSize(a, [40, 30, 10]);
  s.setPosition(a, [-60, 40, 5]);
  const b = s.addShape('cylinder');
  s.setSize(b, [6, 6, 20]);
  s.setPosition(b, [-60, 40, 5]);
  s.select([a, b]);
  window.modellio.store.getState().combineSelected('subtract');
  return [a, b];
});
const gid = (await obj(plate)).parentId;
await S((g) => window.modellio.store.getState().select([g]), gid);
await page.getByRole('tab', { name: /^Features/ }).click();
const exactNote = page.getByTestId('combine-exact');
check(
  '6. A combination of primitives is computed exactly once the engine is loaded',
  await until(async () => /^Exact:/.test(((await exactNote.textContent()) ?? '').trim())),
  await exactNote.textContent(),
);
await page.getByTestId('combine-make-precise').click();
const solidId = await until(() =>
  S(() => {
    const s = window.modellio.store.getState();
    const o = s.doc.objects[s.selection[0]];
    return o?.shape === 'solid' && o.feature.base.kind === 'boolean' && o.id;
  }),
);
check('6b. "Make one precise solid" replaces the group with one solid built on the exact combination', !!solidId && !(await obj(gid)));
const exactVol = await until(() =>
  S((id) => {
    const o = window.modellio.store.getState().doc.objects[id];
    return o && window.modellio.viewport.scene.getObjectByName(id) && o.size.join();
  }, solidId),
);
check('6c. It keeps the size of the combination', exactVol === '40,30,10', exactVol);
await S((id) => window.modellio.features.getState().start(id, 'fillet'), solidId);
const edge = await until(() =>
  S(
    () =>
      window.modellio.features
        .getState()
        .session?.before?.edges.find((e) => e.ref.kind === 'line' && e.ref.mid[2] > 0.99 && e.ref.mid[1] < -0.99)?.ref,
  ),
);
await S((ref) => {
  const t = window.modellio.features.getState();
  t.toggleEdge(ref);
  t.setValue(2);
}, edge);
const fv = await previewVolume();
const expectFillet = 12000 - Math.PI * 9 * 10 - (1 - Math.PI / 4) * 4 * 40;
check(
  '6d. Filleting the exact result works (exact volume)',
  close(fv, expectFillet, 0.05),
  `${fv?.toFixed?.(3)} vs ${expectFillet.toFixed(3)}`,
);
await page.getByTestId('feature-apply').click();
check('6e. The fillet follows the combination in its recipe', (await obj(solidId)).feature.ops[0]?.kind === 'fillet');
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
check('6f. Undo brings the editable group back', !!(await obj(gid)) && (await obj(cyl)).isHole === true);

// 7. Copies: a row of three, and a mirrored copy, from the Inspector.
const peg = await S(() => {
  const s = window.modellio.store.getState();
  const id = s.addShape('cylinder');
  s.setPosition(id, [60, -60, 10]);
  s.select([id]);
  return id;
});
await page.getByRole('tab', { name: 'Properties' }).click();
await field('Pattern count').fill('3');
await field('Pattern count').press('Enter');
await field('Pattern spacing (mm)').fill('25');
await field('Pattern spacing (mm)').press('Enter');
await page.getByTestId('make-pattern').click();
const rowGroup = await S(() => {
  const s = window.modellio.store.getState();
  const g = s.doc.objects[s.selection[0]];
  return g?.kind === 'group' && g.children.map((c) => s.doc.objects[c].transform.position[0]).sort((a, b) => a - b);
});
// Positions are relative to the new group: check the spacing.
check(
  '7. "Make pattern" makes a row of three, 25 mm apart, grouped',
  rowGroup && rowGroup.length === 3 && Math.abs(rowGroup[1] - rowGroup[0] - 25) < 1e-6 && Math.abs(rowGroup[2] - rowGroup[1] - 25) < 1e-6,
  JSON.stringify(rowGroup),
);
await page.keyboard.press('Control+z');
await S((id) => window.modellio.store.getState().select([id]), peg);
await page.getByRole('button', { name: 'Mirror a copy across Y' }).click();
const mirrored = await S((peg) => {
  const s = window.modellio.store.getState();
  const g = s.doc.objects[s.selection[0]];
  return g?.kind === 'group' && g.children.length === 2 && g.children.includes(peg);
}, peg);
check('7b. "Mirror a copy" adds a mirrored copy grouped with it', mirrored);

// 8. Rollback and dependencies: a chamfer inserted before a fillet on the same edge breaks the fillet, and the Features view says so.
const cube = await S(() => {
  const s = window.modellio.store.getState();
  const id = s.addShape('box');
  s.setPosition(id, [0, -70, 10]);
  return id;
});
await S((id) => window.modellio.store.getState().convertToSolid(id), cube);
await until(async () => (await obj(cube))?.shape === 'solid');
const startOn = async (kind) => {
  await S(([id, kind]) => window.modellio.features.getState().start(id, kind), [cube, kind]);
  return until(() =>
    S(
      () =>
        window.modellio.features
          .getState()
          .session?.before?.edges.find((e) => e.ref.kind === 'line' && e.ref.mid[2] > 0.99 && e.ref.mid[1] < -0.99)?.ref,
    ),
  );
};
let e1 = await startOn('fillet');
await S((ref) => {
  const t = window.modellio.features.getState();
  t.toggleEdge(ref);
  t.setValue(2);
}, e1);
await previewVolume();
await page.getByTestId('feature-apply').click();
await S((id) => window.modellio.store.getState().select([id]), cube);
await page.getByRole('radiogroup', { name: 'Browser view' }).getByRole('radio', { name: 'Features' }).click();
await tree.getByRole('button', { name: 'Roll back to the start' }).last().click();
check('8. "Roll back to the start" sets the marker before every operation', (await obj(cube)).feature.rollback === 0);
check('8b. The fillet is shown rolled back', /rolled back/.test(await tree.textContent()));
e1 = await startOn('chamfer');
await S((ref) => {
  const t = window.modellio.features.getState();
  t.toggleEdge(ref);
  t.setValue(1);
}, e1);
await previewVolume();
await page.getByTestId('feature-apply').click();
const f8 = (await obj(cube)).feature;
check(
  '8c. A chamfer added while rolled back goes in at the marker, before the fillet',
  f8.ops.map((o) => o.kind).join() === 'chamfer,fillet' && f8.rollback === 1,
  JSON.stringify([f8.ops.map((o) => o.kind), f8.rollback]),
);
await tree.getByRole('button', { name: 'Roll forward to the end' }).click();
check('8d. Rolling forward builds everything again', (await obj(cube)).feature.rollback === undefined);
const problemText = await until(
  async () => (await tree.getByTestId('op-problem').count()) && (await tree.getByTestId('op-problem').first().textContent()),
);
check('8e. The fillet whose edge the chamfer removed is flagged, never moved', /no longer exist/.test(problemText ?? ''), problemText);

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
