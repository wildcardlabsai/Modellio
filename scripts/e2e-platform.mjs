/**
 * End-to-end check for the MODELLIO 2.0 platform: dashboard, maker projects (save, reopen,
 * duplicate, delete, copy to the Design Studio), the Key Tag Maker and the Sign Maker.
 *
 *   node scripts/e2e-platform.mjs [url] [screenshotDir]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { unzipSync } = require('fflate');

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
await context.addInitScript(() => {
  localStorage.setItem('modellio:onboarded', '1');
  if (!sessionStorage.getItem('platform-e2e')) {
    for (const k of ['modellio:keyring', 'modellio:keytag', 'modellio:sign', 'modellio:lastProject']) localStorage.removeItem(k);
    indexedDB.deleteDatabase('modellio');
    sessionStorage.setItem('platform-e2e', '1');
  }
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const S = (fn, arg) => page.evaluate(fn, arg);
const path = () => new globalThis.URL(page.url()).search;
const settled = (key) =>
  page.waitForFunction(
    (k) => {
      const s = window[k]?.store.getState();
      return s && !s.building && (s.result || s.error);
    },
    key,
    { timeout: 30000 },
  );

// 1. Dashboard
await page.goto(`${URL}/?studio=dashboard`, { waitUntil: 'networkidle' });
await page.getByTestId('dashboard').waitFor();
check('1. The dashboard welcomes you', await page.getByRole('heading', { name: /Welcome to MODELLIO/ }).isVisible());
check(
  '2. Entry points: Design Studio, Makers and Tools',
  (await page.getByTestId('entry-design').isVisible()) &&
    (await page.getByTestId('entry-makers').isVisible()) &&
    (await page.getByTestId('entry-tools').isVisible()),
);
await page.getByTestId('empty-state').waitFor({ timeout: 10000 });
check(
  '3. With no projects, a helpful empty state',
  await page.getByTestId('empty-state').getByRole('link', { name: 'Make a keyring' }).isVisible(),
);
const makers = await page.locator('[data-testid^="maker-"]').count();
check('4. Every maker has a card', makers === 6, `${makers}`);
check(
  '5. "Open Recent Project" is disabled with nothing to open',
  await page.getByRole('button', { name: /Open Recent Project/ }).isDisabled(),
);

// 2. Save a keyring as a project
await page.getByTestId('maker-keyring').click();
await page.getByTestId('keyring-studio').waitFor();
await settled('modellioKeyring');
await page.getByTestId('maker-save').click();
await page.getByLabel('Project name').fill('Gift keyring');
await page.getByRole('button', { name: 'Save project', exact: true }).last().click();
await page.waitForFunction(() => window.modellioKeyring.store.getState().project?.name === 'Gift keyring', null, { timeout: 10000 });
check('6. Save project stores the keyring as a project', true);
const savedElements = await S(() => JSON.stringify(window.modellioKeyring.store.getState().elements));
// Change it, then save again over the same project.
await S(() => window.modellioKeyring.openKeyringTemplate('heart'));
await settled('modellioKeyring');
await S(() => window.modellioKeyring.store.getState().setProject(null));
await page
  .getByRole('link', { name: 'Dashboard' })
  .click()
  .catch(() => page.getByRole('button', { name: 'Dashboard' }).click());
await page.getByTestId('dashboard').waitFor();
const card = page.getByTestId('project-card').filter({ hasText: 'Gift keyring' });
await card.waitFor({ timeout: 10000 });
check('7. The dashboard lists it with its maker', (await card.getByTestId('project-workspace').textContent()) === 'Keyring Maker');
const thumb = await card.locator('img').count();
check('8. …and a thumbnail of the 3D preview', thumb === 1);

// 3. Reopen it in the maker
await card.getByRole('button', { name: 'Open', exact: true }).click();
await page.getByTestId('keyring-studio').waitFor();
await settled('modellioKeyring');
const reopened = await S(() => ({
  els: JSON.stringify(window.modellioKeyring.store.getState().elements),
  p: window.modellioKeyring.store.getState().project,
}));
check(
  '9. Open restores the exact design in its maker',
  path() === '?studio=keyring' && reopened.els === savedElements && reopened.p?.name === 'Gift keyring',
);

// 4. Duplicate, copy to Design Studio, delete
await page.goto(`${URL}/?studio=dashboard`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Duplicate Gift keyring' }).click();
await page.getByTestId('project-card').filter({ hasText: 'Gift keyring (copy)' }).waitFor({ timeout: 10000 });
check('10. Duplicate makes a copy', true);
await page.getByRole('button', { name: 'Open a copy of Gift keyring in the Design Studio' }).first().click();
await page.getByTestId('left-panel').waitFor({ timeout: 15000 });
const doc = await S(() => {
  const d = window.modellio.store.getState().doc;
  return Object.values(d.objects).filter((o) => o.kind === 'shape' && o.shape === 'mesh').length;
});
check('11. "Open a copy in the Design Studio" opens the real parts as meshes', path() === '?studio=design' && doc === 2, `${doc} meshes`);
await page.goto(`${URL}/?studio=dashboard`, { waitUntil: 'networkidle' });
const before = await page.getByTestId('project-card').count();
await page.getByRole('button', { name: 'Delete Gift keyring (copy)' }).click();
const dlg = page.getByRole('alertdialog');
check('12. Delete asks for confirmation', await dlg.isVisible());
await dlg.getByRole('button', { name: 'Cancel' }).click();
check('12b. Cancel keeps the project', (await page.getByTestId('project-card').count()) === before);
await page.getByRole('button', { name: 'Delete Gift keyring (copy)' }).click();
await page.getByRole('alertdialog').getByRole('button', { name: 'Delete project' }).click();
await page.waitForFunction((n) => document.querySelectorAll('[data-testid="project-card"]').length === n - 1, before, { timeout: 10000 });
check('13. Confirming deletes it', true);
check('14. "Open Recent Project" is now available', await page.getByRole('button', { name: /Open Recent Project/ }).isEnabled());
await page.screenshot({ path: `${OUT}/platform-01-dashboard.png` });

// 5. Key Tag Maker
await page.getByTestId('maker-keytag').click();
await page.getByTestId('keytag-studio').waitFor();
await settled('modellioKeyTag');
let st = await S(() => {
  const s = window.modellioKeyTag.store.getState();
  return {
    n: s.params.numbering,
    ok: s.result?.parts.every((p) => p.watertight),
    texts: s.elements.filter((e) => e.kind === 'text').map((e) => e.text),
  };
});
check(
  '15. Key tags: the locker layout builds, with {#} where the number goes',
  st.ok && st.texts.includes('{#}'),
  JSON.stringify(st.texts),
);
await page.getByLabel('How many tags').fill('6');
await page.getByLabel('How many tags').press('Enter');
await page.getByLabel('First number').fill('7');
await page.getByLabel('First number').press('Enter');
await page.getByRole('button', { name: 'Next tag' }).click();
await settled('modellioKeyTag');
check(
  '16. Numbering: the preview steps through the run',
  ((await page.getByTestId('keytag-preview-index').textContent()) ?? '').includes('2 of 6 · 08'),
);
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('keytag-download-all').click()]);
const model = new TextDecoder().decode(unzipSync(fs.readFileSync(await dl.path()))['3D/3dmodel.model']);
const objects = (model.match(/<object /g) ?? []).length;
check('17. "Download all" gives one 3MF with every tag (base + top each)', objects === 12 && /Tag 12 /.test(model), `${objects} objects`);

// 6. Sign Maker
await page.goto(`${URL}/?studio=sign`, { waitUntil: 'networkidle' });
await page.getByTestId('sign-studio').waitFor();
await settled('modellioSign');
const vol = () => S(() => window.modellioSign.store.getState().result.parts.find((p) => p.id === 'base').volume);
const screws = await vol();
await page.getByTestId('sign-mounting').getByRole('radio', { name: 'None' }).click();
await page.waitForTimeout(200);
await settled('modellioSign');
check(
  '18. Signs: screw holes are real cuts (removing them adds material)',
  (await vol()) > screws + 50,
  `${screws.toFixed(0)} → ${(await vol()).toFixed(0)}`,
);
await page.getByRole('switch', { name: 'Desk stand' }).click();
await page.waitForTimeout(200);
await settled('modellioSign');
const stand = await S(() => window.modellioSign.store.getState().result.parts.find((p) => p.id === 'stand'));
check('19. A desk stand is added as its own watertight part', stand && stand.watertight);
const lines0 = await S(() => window.modellioSign.store.getState().elements.filter((e) => e.kind === 'text').length);
await page.getByRole('button', { name: 'Add a line' }).click();
await page.getByRole('button', { name: 'Align lines left' }).click();
await settled('modellioSign');
const lines = await S(() =>
  window.modellioSign.store
    .getState()
    .elements.filter((e) => e.kind === 'text')
    .map((e) => +(e.x - e.w / 2).toFixed(1)),
);
check('20. Lines: add a line and align them all left', lines.length === lines0 + 1 && new Set(lines).size === 1, JSON.stringify(lines));
await page.screenshot({ path: `${OUT}/platform-02-sign.png` });

// 7. Privacy page and accessibility
await page.goto(`${URL}/?studio=privacy`, { waitUntil: 'networkidle' });
check(
  '21. The privacy page explains where designs are kept',
  await page.getByRole('heading', { name: 'Your designs stay on your device' }).isVisible(),
);
await page.goto(`${URL}/?studio=dashboard`, { waitUntil: 'networkidle' });
await page.getByTestId('project-card').first().waitFor();
await page.addScriptTag({ content: fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
const v = await S(async () => {
  const r = await window.axe.run(document, { resultTypes: ['violations'] });
  return r.violations
    .filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.id} (${x.nodes.length}): ${x.nodes[0]?.target?.join(' ')}`);
});
check('22. Dashboard: no serious accessibility violations', v.length === 0, v.slice(0, 4).join(' | '));

// 8. Phone
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const pp = await phone.newPage();
await pp.goto(`${URL}/?studio=dashboard`, { waitUntil: 'networkidle' });
await pp.getByTestId('dashboard').waitFor();
const overflow = await pp.evaluate(
  () => document.documentElement.scrollWidth > innerWidth || document.querySelector('[data-testid=dashboard]').scrollWidth > innerWidth,
);
check('23. Phone: the dashboard fits with no sideways scrolling', !overflow);
await pp.screenshot({ path: `${OUT}/platform-03-phone.png` });
await phone.close();

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
