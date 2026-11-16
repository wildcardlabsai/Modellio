/**
 * End-to-end check for MODELLIO 2.3 Stage 4C (project lifecycle): explicit Save / Save As with a
 * name the first time, unsaved-changes questions (Save / Discard / Cancel), New and Open design,
 * Recent designs, rename / duplicate / delete, recovery of unsaved work after a reload, a clean
 * slate when switching projects, and makers sharing the same projects (one project, two views:
 * Keyring Maker ↔ Design Studio, and a Sign Maker design).
 *
 *   node scripts/e2e-projects.mjs [url] [screenshotDir]
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
const P = () => S(() => window.modellio.projects.getState());
const status = async () => (await page.getByTestId('save-status').textContent()) ?? '';
const objectCount = () => S(() => Object.keys(window.modellio.store.getState().doc.objects).length);
const stored = () =>
  S(() =>
    window.modellio.projects.getState().projects.map((p) => ({ id: p.id, name: p.name, n: p.objectCount, edited: !!p.studioEdited })),
  );
const menu = async (item) => {
  await page.getByRole('button', { name: 'File menu' }).first().click();
  await page.getByRole('menuitem', { name: item }).click();
};
const nameAs = async (name) => {
  await page.getByTestId('project-name-input').fill(name);
  await page.getByTestId('project-name-save').click();
};

await page.goto(`${URL}/?studio=design`, { waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
await until(async () => /Not saved yet|Saved/.test(await status()));

// 1. A new design: not saved anywhere until the user saves.
check(
  '1. A first visit opens a new design that is not saved yet',
  /Not saved yet/.test(await status()) && (await stored()).length === 0,
  await status(),
);
await S(() => window.modellio.store.getState().addShape('box'));
check('2. A change shows as unsaved', /Unsaved changes/.test(await status()));
await menu(/^Save(?! as)/);
await page.getByTestId('project-name-input').waitFor();
check('3. The first Save asks for a name', (await page.getByTestId('project-name-input').inputValue()) === 'Untitled design');
await nameAs('Lamp base');
await until(async () => /Saved/.test(await status()));
let list = await stored();
check(
  '4. Save writes the project under that name',
  list.length === 1 && list[0].name === 'Lamp base' && list[0].n === 1,
  JSON.stringify(list),
);
check(
  '4b. The save status shows when it was saved',
  /Last saved/.test((await page.getByTestId('save-status').getAttribute('title')) ?? ''),
);
const lampId = (await P()).current.id;

// 2. Save again (no question), Save As (an independent copy).
await S(() => window.modellio.store.getState().addShape('sphere'));
await page.keyboard.press('Control+s');
await until(async () => /Saved/.test(await status()));
check('5. Saving again does not ask anything', (await page.getByTestId('project-name-input').count()) === 0 && (await stored())[0].n === 2);
await S(() => window.modellio.store.getState().addShape('cone'));
await menu('Save as…');
await nameAs('Lamp base tall');
await until(async () => (await stored()).length === 2);
list = await stored();
const p6 = await P();
check(
  '6. Save As makes a separate project; the original stays as it was saved',
  p6.current.id !== lampId && list.find((p) => p.id === lampId)?.n === 2 && list.find((p) => p.name === 'Lamp base tall')?.n === 3,
  JSON.stringify(list),
);
const tallId = p6.current.id;

// 3. New design with unsaved changes: Cancel keeps everything, Discard starts fresh.
await S(() => window.modellio.store.getState().addShape('torus'));
await menu('New design…');
await page.getByTestId('new-blank').click();
await page.getByTestId('unsaved-prompt').waitFor();
check(
  '7. Starting a new design with unsaved changes asks Save / Discard / Cancel',
  /has changes that are not saved/.test((await page.getByRole('dialog').textContent()) ?? ''),
);
await page.getByTestId('unsaved-prompt-cancel').click();
check('8. Cancel keeps the design and its changes', (await P()).current.id === tallId && (await objectCount()) === 4);
// Leave something behind that must not leak into the next design.
await S(() => {
  const s = window.modellio.store.getState();
  s.select(Object.keys(s.doc.objects));
  s.setTool('measure');
});
await menu('New design…');
await page.getByTestId('new-blank').click();
await page.getByTestId('unsaved-discard').click();
await until(async () => (await P()).current.id !== tallId);
const fresh = await S(() => {
  const e = window.modellio.store.getState();
  const p = window.modellio.projects.getState();
  return { n: Object.keys(e.doc.objects).length, sel: e.selection.length, tool: e.tool, past: e.history.past.length, name: p.current.name };
});
check(
  '9. Discard opens a genuinely new design: no geometry, selection, tool or history carried over',
  fresh.n === 0 && fresh.sel === 0 && fresh.tool === 'select' && fresh.past === 0,
  JSON.stringify(fresh),
);
check('10. …and the saved projects are untouched', (await stored()).find((p) => p.id === tallId)?.n === 3);

// 4. Open design (search, type, preview) and Recent designs.
await menu('Open…');
await page.getByTestId('open-design-list').waitFor();
check(
  '11. Open design lists the saved designs with their type',
  (await page.getByTestId('open-design-row').count()) === 2 &&
    /Design Studio/.test(await page.getByTestId('open-design-type').first().textContent()),
);
await page.getByLabel('Search designs').fill('tall');
check('12. …and can be searched', (await page.getByTestId('open-design-row').count()) === 1);
await page.getByLabel('Search designs').fill('');
await page.getByRole('button', { name: 'Open Lamp base', exact: true }).click();
await until(async () => (await P()).current.id === lampId);
check(
  '13. Opening loads that design, with a fresh history',
  (await objectCount()) === 2 && (await S(() => window.modellio.store.getState().history.past.length)) === 0,
);
await page.getByRole('button', { name: 'File menu' }).first().click();
const recent = await page.getByTestId('recent-design').allTextContents();
await page.keyboard.press('Escape');
check(
  '14. Recent designs list the others by last activity, each once',
  recent.length === 1 && /Lamp base tall/.test(recent[0]),
  recent.join(' | '),
);

// 5. Rename, duplicate, delete the open design.
await menu('Rename…');
await page.getByLabel('Design name').fill('Lamp base short');
await page.getByRole('button', { name: 'Rename', exact: true }).click();
await until(async () => (await stored()).some((p) => p.name === 'Lamp base short'));
check('15. Rename renames the open design and its project', (await P()).current.name === 'Lamp base short');
await menu('Duplicate');
await until(async () => (await stored()).some((p) => p.name === 'Lamp base short (copy)'));
check('16. Duplicate adds a copy', (await stored()).length === 3);
await menu('Delete…');
await page.getByTestId('confirm-delete-design').click();
await until(async () => (await P()).current.id !== lampId);
check(
  '17. Delete (confirmed) removes it and starts a new design',
  !(await stored()).some((p) => p.id === lampId) && (await objectCount()) === 0,
);

// 6. Recovery after a reload: offered, never applied silently.
await page.getByRole('button', { name: 'File menu' }).first().click();
await page.getByTestId('recent-design').filter({ hasText: 'Lamp base tall' }).click();
await until(async () => (await P()).current.id === tallId);
await S(() => window.modellio.store.getState().addShape('box'));
await page.waitForTimeout(1600); // the recovery draft is written shortly after a change
await page.reload({ waitUntil: 'networkidle' });
await page.getByTestId('recovery-banner').waitFor({ timeout: 15000 });
check(
  '18. After a reload, unsaved changes are offered back',
  (await objectCount()) === 3,
  `${await objectCount()} objects before restoring`,
);
await page.getByTestId('recovery-restore').click();
await until(async () => (await objectCount()) === 4);
check('19. Restore brings them back, still unsaved', (await objectCount()) === 4 && /Unsaved changes/.test(await status()));
check('19b. …and the saved project is unchanged until Save', (await stored()).find((p) => p.id === tallId)?.n === 3);
await page.waitForTimeout(1600);
await page.reload({ waitUntil: 'networkidle' });
await page.getByTestId('recovery-banner').waitFor({ timeout: 15000 });
await page.getByTestId('recovery-discard').click();
check(
  '20. Discard keeps the design as it was last saved',
  (await page.getByTestId('recovery-banner').count()) === 0 && (await objectCount()) === 3,
);
await page.screenshot({ path: `${OUT}/projects-01-design.png` });

// 7. Keyring Maker: a new keyring, saved, opened in the Design Studio as the same project.
await page.getByRole('button', { name: 'File menu' }).first().click();
await page.getByRole('menuitem', { name: 'New design…' }).click();
await page.getByTestId('new-maker-keyring').click();
await page.getByTestId('keyring-studio').waitFor();
await until(() => S(() => window.modellioKeyring?.store.getState().result?.parts.length > 0));
check(
  '21. New design → Keyring Maker opens a new keyring design',
  (await S(() => window.modellioKeyring.store.getState().project)) === null,
);
await S(() => window.modellioKeyring.openKeyringTemplate('heart'));
await until(() => S(() => !window.modellioKeyring.store.getState().building && window.modellioKeyring.store.getState().result));
await S(() => {
  const s = window.modellioKeyring.store.getState();
  s.setParams({ ...s.params });
});
check('22. Changing it marks it unsaved', await page.getByTestId('maker-unsaved').isVisible());
await page.getByTestId('maker-save').click();
await nameAs('Heart tag');
await until(() => S(() => window.modellioKeyring.store.getState().project?.name === 'Heart tag'));
const heart = await S(() => window.modellioKeyring.store.getState().project.id);
const heartParams = await S(() => JSON.stringify(window.modellioKeyring.store.getState().params));
await page.getByRole('button', { name: 'Open in Design Studio' }).click();
await page.getByTestId('left-panel').waitFor();
const inStudio = await S(() => {
  const p = window.modellio.projects.getState();
  return { id: p.current.id, maker: p.currentMaker?.studio, params: JSON.stringify(p.currentMaker?.state?.params) };
});
check(
  '23. Open in Design Studio opens the same project, with its maker settings',
  inStudio.id === heart && inStudio.maker === 'keyring' && inStudio.params === heartParams,
  JSON.stringify({ ...inStudio, params: undefined }),
);
check('24. No duplicate project was made', (await stored()).filter((p) => p.name === 'Heart tag').length === 1);
await S(() => window.modellio.store.getState().addShape('box'));
await page.keyboard.press('Control+s');
await until(async () => (await stored()).find((p) => p.id === heart)?.edited);
check(
  '25. Saving in the Design Studio saves into that project (marked as changed there)',
  (await stored()).find((p) => p.id === heart)?.edited === true,
);
await page.getByRole('button', { name: 'Back to Keyring Maker' }).click();
await page.getByTestId('keyring-studio').waitFor();
check(
  '26. Back in the maker, the keyring is as it was',
  (await S(() => JSON.stringify(window.modellioKeyring.store.getState().params))) === heartParams,
);
await S(() => {
  const s = window.modellioKeyring.store.getState();
  s.setParams({ ...s.params });
});
await page.getByTestId('maker-save').click();
await page.getByTestId('maker-rebuild-prompt').waitFor();
check('27. Saving it from the maker warns that the Design Studio changes would be replaced', true);
await page.getByTestId('maker-rebuild-confirm').click();
await until(async () => !(await stored()).find((p) => p.id === heart)?.edited);
check('28. Rebuilding saves it from the maker settings again', (await stored()).find((p) => p.id === heart)?.edited === false);

// 8. A new keyring does not keep the previous one.
await S(() => {
  const s = window.modellioKeyring.store.getState();
  s.setParams({ ...s.params });
});
await page.getByRole('button', { name: 'File menu' }).first().click();
await page.getByRole('menuitem', { name: 'New design…' }).click();
await page.getByTestId('new-maker-keyring').click();
await page.getByTestId('maker-unsaved-prompt').waitFor();
await page.getByTestId('maker-unsaved-discard').click();
await until(() => S(() => window.modellioKeyring.store.getState().project === null));
check(
  '29. New keyring (after Discard) starts blank, not the previous design',
  (await S(() => JSON.stringify(window.modellioKeyring.store.getState().params))) !== heartParams ||
    (await S(() => window.modellioKeyring.store.getState().templateId)) !== 'heart',
);
await menu('Open…');
await page.getByRole('button', { name: 'Open Heart tag', exact: true }).click();
await until(() => S(() => window.modellioKeyring.store.getState().project?.name === 'Heart tag'));
check(
  '30. Opening the original reopens it in the maker',
  (await S(() => JSON.stringify(window.modellioKeyring.store.getState().params))) === heartParams,
);

// 9. Sign Maker uses the same projects.
await page.getByRole('button', { name: 'File menu' }).first().click();
await page.getByRole('menuitem', { name: 'New design…' }).click();
await page.getByTestId('new-maker-sign').click();
await page.getByTestId('sign-studio').waitFor();
await until(() => S(() => window.modellioSign?.store.getState().result?.parts.length > 0));
await page.getByTestId('maker-save').click();
await nameAs('Shed sign');
await until(async () => (await stored()).some((p) => p.name === 'Shed sign'));
await menu('Open…');
const signRow = page.getByTestId('open-design-row').filter({ hasText: 'Shed sign' });
check(
  '31. A Sign Maker design is saved and listed with its type',
  /Sign Maker/.test(await signRow.getByTestId('open-design-type').textContent()),
);
await page.screenshot({ path: `${OUT}/projects-02-open.png` });
await page.keyboard.press('Escape');

// 10. Split Studio projects: saved with their source model, reopened in Split Studio to carry on.
await page.getByRole('button', { name: 'Split Studio', exact: true }).click();
await page.getByTestId('split-studio').waitFor();
await page.getByRole('button', { name: 'Try a sample' }).click();
await until(() => S(() => !!window.modellioSplit.store.getState().doc));
const islands = await S(() => {
  const st = window.modellioSplit.store.getState();
  st.setSplitOptions({ separateIslands: !st.splitOptions.separateIslands });
  return window.modellioSplit.store.getState().splitOptions.separateIslands;
});
await menu(/^Save(?! as)/);
await nameAs('Badge split');
await until(async () => (await stored()).some((p) => p.name === 'Badge split'), 60000);
check(
  '32. A Split Studio design saves as a project (splitting it first), listed with its type',
  (await stored()).some((p) => p.name === 'Badge split') &&
    (await S(() => window.modellioSplit.store.getState().project?.name)) === 'Badge split',
);
await menu('New design…');
await page.getByTestId('new-blank').click();
await page.getByTestId('viewport').waitFor();
await until(async () => /Not saved yet/.test(await status()));
await menu('Open…');
const splitRow = page.getByTestId('open-design-row').filter({ hasText: 'Badge split' });
check(
  '32b. The Open dialog shows it as a Split Studio design',
  /Split Studio/.test(await splitRow.getByTestId('open-design-type').textContent()),
);
await page.getByRole('button', { name: 'Open Badge split', exact: true }).click();
await page.getByTestId('split-studio').waitFor();
await until(() => S(() => !!window.modellioSplit.store.getState().doc && !window.modellioSplit.store.getState().importing), 60000);
const back = await S(() => {
  const st = window.modellioSplit.store.getState();
  return { file: st.doc?.fileName, islands: st.splitOptions.separateIslands, project: st.project?.name, dirty: st.dirty };
});
check(
  '33. Opening it carries on in Split Studio: same model, same settings, same project, nothing unsaved',
  /sample/i.test(back.file ?? '') && back.islands === islands && back.project === 'Badge split' && back.dirty === false,
  JSON.stringify(back),
);

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
