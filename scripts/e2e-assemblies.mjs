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

check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
