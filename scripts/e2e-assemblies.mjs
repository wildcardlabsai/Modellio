/**
 * End-to-end check for MODELLIO 2.3 Stage 4E (components and assemblies): linked component
 * instances (insert, edit one → all update, one undo step), independent copies, Make independent,
 * nested subassemblies, cycle refusal, grounding, home position and reset, suppression, the
 * assembly browser badges, and links surviving save, reload and project duplication.
 *
 *   node scripts/e2e-assemblies.mjs [url] [screenshotDir]
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
const until = async (fn, ms = 15000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await fn();
    if (v) return v;
    await page.waitForTimeout(100);
  }
  return fn();
};
const obj = (id) => S((i) => window.modellio.store.getState().doc.objects[i], id);
const instances = (cid) =>
  S((c) => Object.values(window.modellio.store.getState().doc.objects).filter((o) => o.kind === 'group' && o.componentId === c), cid);
/** Sizes of the part with link id `node` in every instance of component `cid`. */
const sizesOf = (cid, node) =>
  S(
    ([c, n]) => {
      const d = window.modellio.store.getState().doc;
      return Object.values(d.objects)
        .filter((o) => o.kind === 'group' && o.componentId === c)
        .map((g) => g.children.map((k) => d.objects[k]).find((p) => p.defNode === n)?.size);
    },
    [cid, node],
  );

await page.goto(`${URL}/?studio=design`, { waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
// Wait until the project system has opened the new design.
await until(async () => /Not saved yet|Saved/.test((await page.getByTestId('save-status').textContent()) ?? ''));

// 1. Make a component from two parts.
const [plate, peg] = await S(() => {
  const s = window.modellio.store.getState();
  const a = s.addShape('box');
  s.setSize(a, [30, 10, 2]);
  const b = s.addShape('cylinder');
  s.setSize(b, [4, 4, 8]);
  s.select([a, b]);
  return [a, b];
});
await page.getByRole('button', { name: 'Components', exact: true }).click();
const panel = page.getByTestId('components-panel');
await panel.waitFor();
await panel.getByTestId('make-component').click();
const comp = await S(() => window.modellio.store.getState().selection[0]);
const cid = (await obj(comp)).componentId;
check(
  '1. Make component: a component definition, each part with a link id',
  !!cid && !!(await S((c) => window.modellio.store.getState().doc.components[c], cid)) && !!(await obj(plate)).defNode,
);

// 2. Insert four linked copies.
for (let i = 0; i < 4; i++) await panel.getByRole('button', { name: /^Insert another .*\(linked\)/ }).click();
check('2. Insert ×4: five linked instances', (await instances(cid)).length === 5);
check(
  '2b. The panel lists one component with 5 copies',
  (await panel.getByTestId('component-item').count()) === 1 &&
    /5 linked copies/.test(await panel.getByTestId('component-count').textContent()),
);

// 3. Edit the original: every copy follows, in one undo step.
const node = (await obj(plate)).defNode;
const steps = await S(() => window.modellio.store.getState().history.past.length);
await S((id) => window.modellio.store.getState().setSize(id, [50, 12, 3]), plate);
const after = await sizesOf(cid, node);
check('3. Editing the original updates all 5 copies', after.length === 5 && after.every((sz) => JSON.stringify(sz) === '[50,12,3]'));
check('3b. …as a single undo step', (await S(() => window.modellio.store.getState().history.past.length)) === steps + 1);
await S(() => window.modellio.store.getState().undo());
check(
  '3c. Undo restores every copy',
  (await sizesOf(cid, node)).every((sz) => JSON.stringify(sz) === '[30,10,2]'),
);
await S(() => window.modellio.store.getState().redo());

// 4. Each copy keeps its own position; editing a copy updates the original.
const copies = (await instances(cid)).filter((g) => g.id !== comp);
await S(([id]) => window.modellio.store.getState().setPosition(id, [120, 40, 0]), [copies[0].id]);
check(
  '4. A copy moves on its own (the original stays put)',
  JSON.stringify((await obj(copies[0].id)).transform.position) === '[120,40,0]' &&
    JSON.stringify((await obj(comp)).transform.position) !== '[120,40,0]',
);
const pegInCopy = await S(
  ([g, n]) => {
    const d = window.modellio.store.getState().doc;
    return d.objects[g].children.find((k) => d.objects[k].defNode === n);
  },
  [copies[1].id, (await obj(peg)).defNode],
);
await S((id) => window.modellio.store.getState().setColor(id, '#E11D48'), pegInCopy);
check('4b. Recolouring a part inside a copy recolours the original', (await obj(peg)).color === '#E11D48');

// 5. Inspector shows the link; Make independent.
await S((id) => window.modellio.store.getState().select([id]), copies[2].id);
await page.getByTestId('instance-info').waitFor();
check('5. The Inspector says the copy is linked (5 copies)', /5 copies/.test(await page.getByTestId('instance-info').textContent()));
await page.getByTestId('break-link').click();
await S((id) => window.modellio.store.getState().setSize(id, [70, 12, 3]), plate);
const freed = await S((g) => {
  const d = window.modellio.store.getState().doc;
  return d.objects[g].children.map((k) => d.objects[k].size);
}, copies[2].id);
check(
  '5b. Make independent: the copy no longer follows the original',
  !freed.some((sz) => JSON.stringify(sz) === '[70,12,3]') && (await instances(cid)).length === 4,
);
check('5c. …and is listed as a component of its own', (await panel.getByTestId('component-item').count()) === 2);

// 6. Insert an independent copy.
await panel
  .getByTestId('component-item')
  .first()
  .getByRole('button', { name: /^Insert independent copy/ })
  .click();
check(
  '6. "Insert independent copy" adds an unlinked copy',
  (await panel.getByTestId('component-item').count()) === 3 && (await instances(cid)).length === 4,
);

// 7. Nested subassembly.
const base = await S(() => window.modellio.store.getState().addShape('box'));
await S(([a, b]) => window.modellio.store.getState().select([a, b]), [comp, base]);
await panel.getByTestId('make-component').click();
const outer = await S(() => window.modellio.store.getState().selection[0]);
const outerCid = (await obj(outer)).componentId;
await S((id) => window.modellio.store.getState().insertComponent(id, true), outer);
check('7. A subassembly: inserting the outer component adds another inner copy', (await instances(cid)).length === 5);
await S((id) => window.modellio.store.getState().setSize(id, [55, 12, 3]), plate);
check(
  '7b. Editing the inner part updates it in every copy, including the one inside the new subassembly',
  (await sizesOf(cid, node)).every((sz) => JSON.stringify(sz) === '[55,12,3]'),
);
check('7c. The outer component has 2 linked copies', (await instances(outerCid)).length === 2);

// 8. A component can't contain itself.
const outerCopy = (await instances(outerCid)).find((g) => g.id !== outer).id;
await S(([a, b]) => window.modellio.store.getState().moveInTree([a], b, 0), [outerCopy, outer]);
check(
  '8. Putting a component inside itself is refused, with a notice',
  (await S((d) => window.modellio.store.getState().doc.objects[d.id]?.parentId ?? null, { id: outerCopy })) !== outer &&
    /itself/.test((await S(() => window.modellio.store.getState().notice?.text)) ?? ''),
);

// 9. Ground, numeric position, home and reset.
await S((id) => window.modellio.store.getState().select([id]), copies[0].id);
await page.getByRole('switch', { name: /^Grounded/ }).click();
check('9. Ground: the part is grounded', (await obj(copies[0].id)).grounded === true);
await S((id) => window.modellio.store.getState().setPosition(id, [0, 0, 0]), copies[0].id);
check('9b. A grounded part refuses to move', JSON.stringify((await obj(copies[0].id)).transform.position) === '[120,40,0]');
check('9c. Its position fields are disabled', await page.getByLabel('Position X', { exact: true }).isDisabled());
await page.getByRole('switch', { name: /^Grounded/ }).click();
await page.getByTestId('set-home').click();
const posX = page.getByLabel('Position X', { exact: true });
await posX.fill('150');
await posX.press('Enter');
check('9d. Unground → typed position moves it', (await obj(copies[0].id)).transform.position[0] === 150);
await page.getByTestId('reset-home').click();
check('9e. Reset to home puts it back', JSON.stringify((await obj(copies[0].id)).transform.position) === '[120,40,0]');

// 10. Suppress.
await page.getByRole('switch', { name: /^Suppressed/ }).click();
check('10. Suppress: the copy is marked suppressed', (await obj(copies[0].id)).suppressed === true);

// 11. Assembly browser badges.
await page.getByRole('button', { name: 'Shapes', exact: true }).click();
const tree = page.getByRole('tree', { name: 'Object tree' });
await until(async () => (await tree.getByTestId('tree-linked').count()) > 0);
check('11. The tree marks linked copies', (await tree.getByTestId('tree-linked').count()) >= 4);
check('11b. …and suppressed parts', (await tree.getByTestId('tree-suppressed').count()) === 1);
await page.screenshot({ path: `${OUT}/assemblies-browser.png` });

// 12. Save, reload, duplicate.
const snapshot = async () =>
  S(() => {
    const d = window.modellio.store.getState().doc;
    return JSON.stringify(
      Object.values(d.objects)
        .map((o) => [o.name, o.componentId ?? '', o.parentId ?? '', o.transform.position, o.grounded ?? false, o.suppressed ?? false])
        .sort(),
    );
  });
const before12 = await snapshot();
await S(() => window.modellio.projects.getState().saveAs('Assembly test'));
await page.reload({ waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
await until(async () => (await S(() => Object.keys(window.modellio.store.getState().doc.objects).length)) > 5);
check('12. Links, hierarchy, positions, grounding and suppression survive saving and reloading', (await snapshot()) === before12);
await S((id) => window.modellio.store.getState().setSize(id, [60, 12, 3]), plate);
check(
  '12b. Copies are still linked after reloading',
  (await sizesOf(cid, node)).every((sz) => JSON.stringify(sz) === '[60,12,3]'),
);
const id12 = await S(() => window.modellio.projects.getState().current?.id);
await S(() => window.modellio.projects.getState().saveNow());
await S((id) => window.modellio.projects.getState().duplicate(id), id12);
const dup = await until(() =>
  S(() =>
    window.modellio.projects
      .getState()
      .projects.find((p) => /Assembly test/.test(p.name) && p.id !== window.modellio.projects.getState().current?.id),
  ),
);
await S((id) => window.modellio.projects.getState().open(id), dup.id);
await until(async () => (await S(() => window.modellio.projects.getState().current?.id)) === dup.id);
await until(async () => (await instances(cid)).length === 5);
check(
  '12c. A duplicated project keeps the components and their links',
  (await instances(cid)).length === 5 && (await instances(outerCid)).length === 2,
);

// ── Part 2 (Stage 4F): joints, limits and exploded views ──
const J = (fn, arg) => S(fn, arg);
const world = (id) =>
  S((i) => {
    const s = window.modellio.store.getState();
    const o = s.doc.objects[i];
    return o.transform.position;
  }, id);
const near = (a, b, eps = 0.05) => a.every((v, i) => Math.abs(v - b[i]) < eps);
await S(() => window.modellio.projects.getState().newProject('Joint test'));
await until(async () => (await S(() => Object.keys(window.modellio.store.getState().doc.objects).length)) === 0);
const [hb, lid] = await J(() => {
  const s = window.modellio.store.getState();
  const a = s.addShape('box');
  s.setSize(a, [20, 20, 20]);
  s.setPosition(a, [0, 0, 10]);
  const b = s.addShape('box');
  s.setSize(b, [20, 20, 2]);
  s.setPosition(b, [0, 0, 21]);
  s.select([a, b]);
  return [a, b];
});

// 13. Make a hinge with the dialog (J), 0–90°.
await page
  .locator('body')
  .click({ position: { x: 5, y: 5 } })
  .catch(() => {});
await S(([a, b]) => window.modellio.store.getState().select([a, b]), [hb, lid]);
await page.keyboard.press('j');
const dlg = page.getByTestId('joint-dialog');
await dlg.waitFor();
check(
  '13. J opens the New joint dialog with the two parts (fixed, then moving)',
  /Box/.test(await page.getByTestId('joint-a').textContent()),
);
await dlg.getByRole('radio', { name: 'Hinge', exact: true }).click();
await dlg.getByRole('radio', { name: 'Y', exact: true }).click();
await page.getByTestId('joint-create').click();
await until(async () => (await S(() => Object.keys(window.modellio.store.getState().doc.joints ?? {}).length)) === 1);
const hinge = await S(() => Object.values(window.modellio.store.getState().doc.joints)[0]);
check(
  '13b. A hinge is created at the parts’ current places (nothing jumps)',
  near(await world(lid), [0, 0, 21]) && hinge.kind === 'revolute',
);
check('13c. …with its 0–90° limit', JSON.stringify(hinge.limits.angle) === '[0,90]');

// 14. Drive it by value (Assembly panel) and stop at the limit.
await page.getByRole('button', { name: 'Components', exact: true }).click();
check('13d. The joint is named for what it is', /^Hinge 1$/.test(hinge.name), hinge.name);
const jp = page.getByTestId('joints-section');
await jp.getByLabel(`${hinge.name} Angle (°)`, { exact: true }).fill('45');
await jp.getByLabel(`${hinge.name} Angle (°)`, { exact: true }).press('Enter');
const r45 = await S((i) => window.modellio.store.getState().doc.objects[i].transform.rotation, lid);
check('14. Typing 45° turns the lid 45° about the hinge axis', Math.abs(Math.abs(r45[1]) - 45) < 0.05, JSON.stringify(r45));
await jp.getByLabel(`${hinge.name} Angle (°)`, { exact: true }).fill('120');
await jp.getByLabel(`${hinge.name} Angle (°)`, { exact: true }).press('Enter');
check(
  '14b. 120° stops at the 90° limit, with a notice',
  (await S((id) => window.modellio.store.getState().doc.joints[id].values.angle, hinge.id)) === 90 &&
    /limit/.test((await S(() => window.modellio.store.getState().notice?.text)) ?? ''),
);
await page.screenshot({ path: `${OUT}/assemblies-hinge.png` });

// 15. Drag (the gizmo commits a new place): projected onto the hinge and limited.
await S((j) => window.modellio.store.getState().setJointValues(j, { angle: 30 }), hinge.id);
await S((id) => window.modellio.store.getState().setPosition(id, [60, 60, 60]), lid);
check(
  '15. Dragging the lid away keeps it on the hinge',
  (await S((j) => window.modellio.store.getState().doc.joints[j].values.angle, hinge.id)) === 30,
);
await S((id) => {
  const s = window.modellio.store.getState();
  const r = s.doc.objects[id].transform.rotation;
  s.setRotation(id, [r[0], r[1] - 200, r[2]]);
}, lid);
const a15 = await S((j) => window.modellio.store.getState().doc.joints[j].values.angle, hinge.id);
check('15b. Turning it past the limit stops it at 0° or 90°', a15 === 0 || a15 === 90, String(a15));

// 16. Moving the fixed part carries the lid; one undo step.
const steps16 = await S(() => window.modellio.store.getState().history.past.length);
const lidBefore = await world(lid);
await S((id) => window.modellio.store.getState().setPosition(id, [40, 0, 10]), hb);
const lidAfter = await world(lid);
check(
  '16. Moving the base moves the hinged lid with it',
  near([lidAfter[0] - lidBefore[0], lidAfter[1] - lidBefore[1], lidAfter[2] - lidBefore[2]], [40, 0, 0]),
);
check('16b. …in one undo step', (await S(() => window.modellio.store.getState().history.past.length)) === steps16 + 1);
await S(() => window.modellio.store.getState().undo());

// 17. Slider 0–30 mm, rigid, cylindrical, planar.
const kinds = await S(() => {
  const s = window.modellio.store.getState();
  const mk = (p) => {
    const id = s.addShape('box');
    s.setSize(id, [6, 6, 6]);
    s.setPosition(id, p);
    return id;
  };
  const base = mk([100, 0, 3]);
  const slide = mk([100, 20, 3]);
  const rigidPart = mk([120, 0, 3]);
  const cyl = mk([100, -20, 3]);
  const plan = mk([100, 0, 30]);
  const sj = s.addJoint({ kind: 'slider', a: base, b: slide, axis: 'y', limits: { offset: [0, 30] } });
  const rj = s.addJoint({ kind: 'rigid', a: base, b: rigidPart });
  const cj = s.addJoint({ kind: 'cylindrical', a: base, b: cyl, axis: 'z', origin: [100, -20, 0] });
  const pj = s.addJoint({ kind: 'planar', a: base, b: plan, axis: 'z' });
  return { base, slide, rigidPart, cyl, plan, sj, rj, cj, pj };
});
await S((k) => window.modellio.store.getState().setJointValues(k.sj, { offset: 50 }), kinds);
check('17. Slider: 50 mm stops at 30 mm', near(await world(kinds.slide), [100, 50, 3]));
await S((k) => window.modellio.store.getState().setPosition(k.slide, [130, 30, 9]), kinds);
check('17b. Dragging the slider sideways only slides it along its axis', near(await world(kinds.slide), [100, 30, 3]));
await S((k) => window.modellio.store.getState().setPosition(k.base, [100, 10, 3]), kinds);
check('17c. Rigid: the part follows the base', near(await world(kinds.rigidPart), [120, 10, 3]));
await S((k) => window.modellio.store.getState().setJointValues(k.cj, { angle: 90, offset: 5 }), kinds);
check(
  '17d. Cylindrical: turns and slides on its axis',
  near(await world(kinds.cyl), [100, -10, 8]) || near(await world(kinds.cyl), [100, -10, 8], 0.5),
  JSON.stringify(await world(kinds.cyl)),
);
await S((k) => window.modellio.store.getState().setPosition(k.plan, [110, 25, 80]), kinds);
check('17e. Planar: moves in its plane but not off it', near(await world(kinds.plan), [110, 25, 30]));
check('17f. The Assembly panel lists every joint', (await jp.getByTestId('joint-item').count()) === 5);

// 18. A part can't be driven by two joints.
await S((k) => window.modellio.store.getState().addJoint({ kind: 'rigid', a: k.cyl, b: k.slide }), kinds);
check(
  '18. A second joint on the same moving part is refused, with the reason',
  /one joint only/.test((await S(() => window.modellio.store.getState().notice?.text)) ?? ''),
);

// 19. Exploded view: auto, steps, reorder, progress, reset.
const ids19 = [hb, lid];
await S((ids) => window.modellio.store.getState().select(ids), ids19);
const ex = page.getByTestId('explode-section');
await ex.getByTestId('auto-explode').click();
await until(async () => (await ex.getByTestId('explode-step').count()) === 2);
const pos19 = await world(lid);
check('19. Auto explode makes a step per part', (await ex.getByTestId('explode-step').count()) === 2);
check(
  '19b. Exploding is display only: positions are unchanged',
  near(await world(lid), pos19) && (await S(() => window.modellio.store.getState().explode?.progress)) === 2,
);
const order = async () =>
  S(() => {
    const s = window.modellio.store.getState();
    return s.doc.explodeViews[s.explode.viewId].steps.map((x) => x.id);
  });
const o1 = await order();
await ex.getByRole('button', { name: 'Move step 2 earlier' }).click();
const o2 = await order();
check('19c. Steps can be reordered', o2[0] === o1[1] && o2[1] === o1[0]);
await ex.getByLabel('Step 1 offset Z').fill('44');
await ex.getByLabel('Step 1 offset Z').press('Enter');
check(
  '19d. A step’s offset can be typed',
  (await S(() => {
    const s = window.modellio.store.getState();
    return s.doc.explodeViews[s.explode.viewId].steps[0].offset[2];
  })) === 44,
);
check('19e. The view stays exploded while its steps are edited', (await S(() => window.modellio.store.getState().explode.progress)) > 0);
await page.screenshot({ path: `${OUT}/assemblies-exploded.png` });
await ex.getByTestId('explode-reset').click();
check('19f. "Assembled" shows the design put together', (await S(() => window.modellio.store.getState().explode)) === null);

// 20. Saved, reloaded, duplicated and switched: joints and views stay.
const sig = () =>
  S(() => {
    const d = window.modellio.store.getState().doc;
    return JSON.stringify([
      Object.values(d.joints ?? {})
        .map((j) => [j.kind, j.values, j.limits ?? null])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
      Object.values(d.explodeViews ?? {}).map((v) => v.steps.map((x) => x.offset)),
    ]);
  });
const sig20 = await sig();
await S(() => window.modellio.projects.getState().saveNow());
const jid = await S(() => window.modellio.projects.getState().current?.id);
await page.reload({ waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
await until(async () => (await S(() => Object.keys(window.modellio.store.getState().doc.joints ?? {}).length)) === 5);
check('20. Joints, limits and exploded views survive saving and reloading', (await sig()) === sig20);
await S((id) => window.modellio.projects.getState().duplicate(id), jid);
const dup20 = await until(() =>
  S((id) => window.modellio.projects.getState().projects.find((p) => /Joint test/.test(p.name) && p.id !== id), jid),
);
await S((id) => window.modellio.projects.getState().open(id), dup20.id);
await until(async () => (await S(() => window.modellio.projects.getState().current?.id)) === dup20.id);
await until(async () => (await S(() => Object.keys(window.modellio.store.getState().doc.joints ?? {}).length)) === 5);
check('20b. A duplicated project keeps them', (await sig()) === sig20);
await S((id) => window.modellio.projects.getState().open(id), dup.id);
await until(async () => (await S(() => window.modellio.projects.getState().current?.id)) === dup.id);
check(
  '20c. Switching to another project leaves no joints or exploded view behind',
  (await S(() => Object.keys(window.modellio.store.getState().doc.joints ?? {}).length)) === 0 &&
    (await S(() => window.modellio.store.getState().explode)) === null,
);

check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
