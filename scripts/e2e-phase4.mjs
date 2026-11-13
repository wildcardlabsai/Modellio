/**
 * End-to-end Phase 4 workflow check (STL/OBJ export + import, local project
 * persistence, My Projects, project files), driven through the real UI.
 *
 *   npm run dev
 *   node scripts/e2e-phase4.mjs [url] [screenshotDir]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
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
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
// A returning user: skip the first-run tour (covered by the Phase 5 suite).
await page.addInitScript(() => localStorage.setItem('modellio:onboarded', '1'));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

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
const saveStatus = () => page.getByTestId('save-status').textContent();
const waitSaved = () => waitFor(async () => (await saveStatus())?.includes('Saved'));
const download = async (trigger) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const file = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(file);
  return file;
};

/** Independent binary-STL reader (no three.js): triangle count + bounds. */
function readBinaryStl(buf) {
  const n = buf.readUInt32LE(80);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) {
    for (let v = 0; v < 3; v++) {
      const o = 84 + t * 50 + 12 + v * 12;
      for (let k = 0; k < 3; k++) {
        const x = buf.readFloatLE(o + k * 4);
        min[k] = Math.min(min[k], x);
        max[k] = Math.max(max[k], x);
      }
    }
  }
  return { n, size: buf.length, min, max };
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
check('1. A new project is created and saved on first launch', await waitSaved(), await saveStatus());

// --- 2. Build a design
await S(async () => {
  const s = window.modellio.store.getState();
  const box = s.addShape('box', [-40, 0], { exact: true });
  s.setSize(box, [40, 30, 20]);
  s.setPosition(box, [-40, 0, 10]);
  const hole = s.addShape('cylinder', [-40, 0], { exact: true });
  s.setSize(hole, [10, 10, 30]);
  s.setPosition(hole, [-40, 0, 10]);
  s.setHole([hole], true);
  s.select([box, hole]);
  s.combineSelected('union');
  const w = s.addShape('wedge', [30, 0], { exact: true });
  s.select([w]);
  s.mirrorSelected(0);
  s.setColor(w, '#10B981');
  await s.addText('Hi', [0, 50]);
  s.clearSelection();
});
const nameField = page.getByLabel('Project name');
await nameField.fill('Desk Organiser');
await nameField.press('Enter');
await page.waitForTimeout(300);
check('2. Changes autosave ("Saved")', await waitSaved(), await saveStatus());
let s;
const designBounds = await S(() => {
  const { store, hierarchy } = window.modellio;
  const d = store.getState().doc;
  const b = hierarchy.worldBoundsOf(d, d.rootIds);
  return { min: b.min.toArray(), max: b.max.toArray() };
});
await page.screenshot({ path: `${OUT}/p4-01-design.png` });

// --- 3. Export STL / OBJ
await page.getByRole('button', { name: 'Export', exact: true }).click();
const summary = await page.getByTestId('export-summary').textContent();
check(
  '3. Export dialog summarises objects, triangles and watertightness',
  /3 objects/.test(summary) && /All objects are watertight/.test(summary),
  summary.slice(0, 120),
);
await page.screenshot({ path: `${OUT}/p4-02-export-dialog.png` });
const stlFile = await download(() => page.getByRole('button', { name: /Download STL/ }).click());
const stl = readBinaryStl(fs.readFileSync(stlFile));
check(
  '3b. Binary STL is well-formed (84 + 50·n bytes) and named after the project',
  stl.size === 84 + 50 * stl.n && path.basename(stlFile) === 'Desk_Organiser.stl',
  `${stl.n} triangles`,
);
check(
  '3c. STL coordinates are the real model bounds in mm',
  stl.min.every((v, i) => close(v, designBounds.min[i], 0.01)) && stl.max.every((v, i) => close(v, designBounds.max[i], 0.01)),
  `${stl.min.map((v) => v.toFixed(2))} … ${stl.max.map((v) => v.toFixed(2))}`,
);
await page.getByRole('button', { name: 'Export', exact: true }).click();
await page.getByRole('radio', { name: 'OBJ' }).click();
const objFile = await download(() => page.getByRole('button', { name: /Download OBJ/ }).click());
const obj = fs.readFileSync(objFile, 'utf8');
const objNames = obj
  .split('\n')
  .filter((l) => l.startsWith('o '))
  .map((l) => l.slice(2));
check('3d. OBJ contains one named object per body', objNames.length === 3 && objNames.includes('Union'), objNames.join(', '));
await page.getByRole('button', { name: 'Export', exact: true }).click();
await page.getByRole('radio', { name: 'STL (text)' }).click();
const asciiFile = await download(() => page.getByRole('button', { name: /Download STL/ }).click());
const ascii = fs.readFileSync(asciiFile, 'utf8');
check('3e. ASCII STL has one solid per body', (ascii.match(/^solid /gm) ?? []).length === 3);

// --- 4. Import STL via the file chooser
const before = Object.keys((await state()).doc.objects).length;
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Import STL / OBJ' }).click()]);
await chooser.setFiles(stlFile);
await page.getByRole('dialog', { name: /Import Desk_Organiser.stl/ }).waitFor();
const sizeText = await page.getByTestId('import-size').textContent();
const ds = designBounds.max.map((v, i) => (v - designBounds.min[i]).toFixed(2));
check('4. Import dialog shows the size in mm', sizeText.includes(ds.join(' × ')), sizeText);
await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
s = await state();
const imported = s.doc.objects[s.selection[0]];
check(
  '4b. The STL becomes a mesh object of the same size, resting on the plate',
  imported?.shape === 'mesh' &&
    imported.size.every((v, i) => close(v, Number(ds[i]), 0.01)) &&
    close(imported.transform.position[2], imported.size[2] / 2, 0.01),
  JSON.stringify(imported?.size),
);
check('4c. Import is one undoable step', Object.keys(s.doc.objects).length === before + 1);
await page.screenshot({ path: `${OUT}/p4-03-imported.png` });

// --- 5. OBJ authored in metres, Y-up, dropped onto the viewport
const cubeObj = [
  'v 0 0 0',
  'v 0.02 0 0',
  'v 0.02 0.05 0',
  'v 0 0.05 0',
  'v 0 0 0.01',
  'v 0.02 0 0.01',
  'v 0.02 0.05 0.01',
  'v 0 0.05 0.01',
  'f 1 4 3 2',
  'f 5 6 7 8',
  'f 1 2 6 5',
  'f 2 3 7 6',
  'f 3 4 8 7',
  'f 4 1 5 8',
].join('\n');
await S((text) => {
  const file = new File([text], 'bracket.obj', { type: 'text/plain' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const target = document.querySelector('[data-testid=viewport]');
  target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 800, clientY: 500 }));
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 800, clientY: 500 }));
}, cubeObj);
await page.getByRole('dialog', { name: /Import bracket.obj/ }).waitFor();
const unitChecked = await page.getByRole('radio', { name: 'm', exact: true }).getAttribute('aria-checked');
const upChecked = await page.getByRole('radio', { name: /Y up/ }).getAttribute('aria-checked');
const objSize = await page.getByTestId('import-size').textContent();
check('5. Dropped OBJ: metres and Y-up are detected', unitChecked === 'true' && upChecked === 'true', objSize);
check('5b. …so 0.02 × 0.05 × 0.01 m (Y-up) becomes 20 × 10 × 50 mm (Z-up)', objSize.includes('20.00 × 10.00 × 50.00'));
await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
s = await state();
check('5c. Imported part is watertight and usable', s.doc.objects[s.selection[0]]?.shape === 'mesh');

// --- 6. Reload: everything comes back
await waitSaved();
const snapshot = (await state()).doc;
await page.reload({ waitUntil: 'networkidle' });
await waitFor(async () => (await saveStatus())?.includes('Saved'));
await page.waitForTimeout(800);
const restored = (await state()).doc;
check(
  '6. Reload restores the exact design (hierarchy, transforms, colours, holes, text)',
  JSON.stringify(restored) === JSON.stringify(snapshot),
  `${Object.keys(restored.objects).length} objects`,
);
check('6b. Project name is restored', (await page.getByLabel('Project name').inputValue()) === 'Desk Organiser');
const meshIds = Object.values(restored.objects)
  .filter((o) => o.shape === 'mesh')
  .map((o) => o.id);
check(
  '6c. Imported meshes render after reload (assets persisted)',
  (await S((ids) => ids.every((id) => !!window.modellio.viewport.scene.getObjectByName(id)), meshIds)) && meshIds.length === 2,
);
const combinedId = Object.values(restored.objects).find((o) => o.kind === 'group' && o.combine)?.id;
check(
  '6d. Boolean combination is live after reload',
  await waitFor(() => S((id) => !!window.modellio.viewport.scene.getObjectByName(`${id}:result`), combinedId)),
);
check('6e. Undo history starts fresh', (await state()).past === 0);
await page.screenshot({ path: `${OUT}/p4-04-reloaded.png` });

// --- 7. My Projects
await page.getByRole('button', { name: 'My Projects' }).click();
await page.getByRole('heading', { name: 'My projects' }).waitFor();
check(
  '7. My Projects lists the design with a rendered thumbnail',
  (await page.getByTestId('project-card').count()) === 1 &&
    ((await page.getByTestId('project-card').locator('img').getAttribute('src')) ?? '').startsWith('data:image/jpeg'),
);
await page.getByRole('button', { name: 'New design' }).first().click();
await waitFor(async () => (await page.getByLabel('Project name').inputValue()) === 'Untitled design');
const n7b = Object.keys((await state()).doc.objects).length;
const name7b = await page.getByLabel('Project name').inputValue();
check('7b. New design opens an empty project', n7b === 0 && name7b === 'Untitled design', `${n7b} objects, “${name7b}”`);
await S(() => window.modellio.store.getState().addShape('sphere'));
await waitSaved();
await page.getByRole('button', { name: 'My Projects' }).click();
check(
  '7c. Both projects are listed, newest first',
  (await page.getByTestId('project-card').count()) === 2 &&
    (await page.getByTestId('project-card').first().textContent()).includes('Untitled design'),
);
await page.getByRole('button', { name: 'Actions for Desk Organiser' }).click();
await page.getByRole('menuitem', { name: 'Duplicate' }).click();
await waitFor(async () => (await page.getByTestId('project-card').count()) === 3);
check('7d. Duplicate creates a copy', (await page.getByRole('button', { name: 'Open Desk Organiser (copy)' }).count()) === 1);
await page.getByRole('button', { name: 'Actions for Desk Organiser (copy)' }).click();
await page.getByRole('menuitem', { name: 'Rename' }).click();
await page.getByLabel('Design name').fill('Organiser v2');
await page.getByRole('button', { name: 'Rename', exact: true }).click();
check(
  '7e. Rename updates the card',
  await waitFor(async () => (await page.getByRole('button', { name: 'Open Organiser v2' }).count()) === 1),
);
await page.getByRole('button', { name: 'Actions for Organiser v2' }).click();
await page.getByRole('menuitem', { name: 'Delete' }).click();
await page.getByRole('dialog', { name: 'Delete design?' }).getByRole('button', { name: 'Delete' }).click();
check('7f. Delete (with confirmation) removes it', await waitFor(async () => (await page.getByTestId('project-card').count()) === 2));
await page.screenshot({ path: `${OUT}/p4-05-projects.png` });
await page.getByRole('button', { name: 'Open Desk Organiser' }).click();
await waitFor(async () => Object.keys((await state()).doc.objects).length === Object.keys(snapshot.objects).length);
check('7g. Opening a project loads it into the editor', JSON.stringify((await state()).doc) === JSON.stringify(snapshot));

// --- 8. Project file download + re-open
await page.getByRole('button', { name: 'File menu' }).click();
const projFile = await download(() => page.getByRole('menuitem', { name: /Download project file/ }).click());
const projJson = JSON.parse(fs.readFileSync(projFile, 'utf8'));
check(
  '8. .modellio file contains the design and embedded meshes',
  projJson.format === 'modellio-project' && Object.keys(projJson.assets).length === 2,
  path.basename(projFile),
);
await page.getByRole('button', { name: 'File menu' }).click();
const [pc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: /Open project file/ }).click()]);
await pc.setFiles(projFile);
await waitFor(async () => (await page.getByLabel('Project name').inputValue()) === 'Desk Organiser' && (await state()).doc !== null);
await page.waitForTimeout(500);
const reopened = (await state()).doc;
check('8b. Opening the file recreates the design as a new project', JSON.stringify(reopened) === JSON.stringify(snapshot));
await page.getByRole('button', { name: 'My Projects' }).click();
check('8c. …listed alongside the others', await waitFor(async () => (await page.getByTestId('project-card').count()) === 3));
await page.getByRole('button', { name: 'Design', exact: true }).click();

// --- 9. Bad files are rejected clearly
const badFile = path.join(OUT, 'broken.modellio');
fs.writeFileSync(badFile, '{"format":"modellio-project","version":1,"document":{"schemaVersion":1}}');
await page.getByRole('button', { name: 'File menu' }).click();
const [bc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: /Open project file/ }).click()]);
await bc.setFiles(badFile);
check(
  '9. A corrupt project file shows a clear error',
  await waitFor(async () => (await page.getByRole('status').filter({ hasText: 'incomplete' }).count()) > 0),
);
const txt = path.join(OUT, 'notes.step');
fs.writeFileSync(txt, 'ISO-10303-21;');
const [tc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Import STL / OBJ' }).click()]);
await tc.setFiles(txt);
check(
  '9b. Unsupported formats are refused with a message',
  await waitFor(async () => (await page.getByRole('status').filter({ hasText: 'not supported' }).count()) > 0),
);

check('No runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
