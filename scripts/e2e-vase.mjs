/**
 * End-to-end check for the Vase Maker, driven through the real UI in Chromium.
 *
 *   node scripts/e2e-vase.mjs [url] [screenshotDir]
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
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
await context.addInitScript(() => {
  localStorage.setItem('modellio:onboarded', '1');
  if (!sessionStorage.getItem('vase-e2e')) {
    localStorage.removeItem('modellio:vase');
    sessionStorage.setItem('vase-e2e', '1');
  }
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const S = (fn, arg) => page.evaluate(fn, arg);
const state = () =>
  S(() => {
    const s = window.modellioVase.store.getState();
    return {
      building: s.building,
      error: s.error,
      params: s.params,
      templateId: s.templateId,
      parts: s.result?.parts.map((p) => ({ id: p.id, ok: p.watertight, v: p.volume })) ?? [],
      width: s.result?.width,
      capacity: s.result?.capacity,
      overhang: s.result?.maxOverhang,
      warnings: s.result?.warnings ?? [],
      notes: s.result?.notes ?? [],
    };
  });
const settled = async (pred = () => true, ms = 30000) => {
  const t = Date.now();
  await page.waitForTimeout(150);
  while (Date.now() - t < ms) {
    const st = await state();
    if (!st.building && st.parts.length && (await pred(st))) return st;
    await page.waitForTimeout(100);
  }
  return state();
};

// 1. Getting there
await page.goto(`${URL}/`, { waitUntil: 'networkidle' });
await page.getByTestId('path-makers').getByTestId('maker-link-vase').click();
await page.getByTestId('vase-studio').waitFor({ timeout: 20000 });
check('1. The landing page lists the Vase Maker and opens it at ?studio=vase', page.url().includes('studio=vase'));
let st = await settled();
check('2. A starting design is built straight away', st.parts.length >= 1 && st.parts.every((p) => p.ok), st.templateId);

// 2. Templates
const cards = page.getByTestId('vase-template');
check(
  '3. The gallery shows 32 templates and "Start blank"',
  (await cards.count()) === 32 && (await page.getByTestId('vase-blank').isVisible()),
);
const thumbs = await S(async () => {
  const imgs = [...document.querySelectorAll('[data-testid="vase-template"] img')];
  for (const i of imgs) {
    i.loading = 'eager';
    if (!i.complete) await new Promise((r) => (i.onload = i.onerror = r));
  }
  return imgs.filter((i) => i.naturalWidth > 0).length;
});
check('4. Every template has a rendered thumbnail', thumbs === 32, `${thumbs}/32`);
await page.getByRole('button', { name: 'Lampshades', exact: true }).click();
check('5. Category filters narrow the gallery', (await cards.count()) === 3);
await page.getByRole('button', { name: 'All', exact: true }).click();
await page.locator('[data-template="spiral-star"]').click();
st = await settled((s) => s.templateId === 'spiral-star');
check(
  '6. Choosing a template builds it',
  st.params.shape.kind === 'star' && st.params.twist === 180 && st.parts.every((p) => p.ok),
  `⌀${st.width?.toFixed(0)}`,
);
check(
  '7. The result shows size, capacity and steepest lean',
  (await page.getByTestId('vase-stats').textContent()).match(/⌀\d+ × 180 mm.*ml.*°/s),
);
await page.locator('[data-template="pot-classic"]').click();
st = await settled((s) => s.templateId === 'pot-classic');
check('8. A planter template comes with its saucer', st.parts.map((p) => p.id).join(',') === 'body,saucer');
await page.screenshot({ path: `${OUT}/vase-01-templates.png` });

// 3. Start blank and design
await page.getByTestId('vase-blank').click();
st = await settled((s) => s.params.profile.length === 2);
check(
  '9. "Start blank" opens the Design tab with a plain cylinder',
  (await page.getByRole('radio', { name: 'Design' }).getAttribute('aria-checked')) === 'true' && st.params.profile.length === 2,
);
const widthBefore = st.width;
const pts = page.getByTestId('vase-profile-point');
const top = await pts.nth(1).boundingBox();
await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
await page.mouse.down();
await page.mouse.move(top.x + top.width / 2 + 40, top.y + top.height / 2, { steps: 6 });
await page.mouse.up();
st = await settled((s) => s.width > widthBefore + 5);
check('10. Dragging the rim point widens the top', st.width > widthBefore + 5, `${widthBefore.toFixed(0)} → ${st.width.toFixed(0)} mm`);
const outline = await page.getByTestId('vase-profile').boundingBox();
const line = await S(() => {
  const el = document.querySelector('[data-testid="vase-profile-outline"]');
  const pts = el
    .getAttribute('points')
    .split(' ')
    .map((s) => s.split(',').map(Number));
  const svg = el.ownerSVGElement;
  const vb = svg.viewBox.baseVal;
  const r = svg.getBoundingClientRect();
  const [x, y] = pts[Math.floor(pts.length / 2)];
  return { x: r.left + (x / vb.width) * r.width, y: r.top + (y / vb.height) * r.height };
});
void outline;
await page.mouse.click(line.x, line.y);
st = await settled((s) => s.params.profile.length === 3);
check('11. Clicking the outline adds a profile point', st.params.profile.length === 3);
await page.getByRole('button', { name: 'Undo', exact: true }).click();
st = await settled((s) => s.params.profile.length === 2);
check('12. Undo removes it again (the drag stays)', st.params.profile.length === 2 && st.width > widthBefore + 5);
await page.keyboard.press('Control+Shift+Z');
st = await settled((s) => s.params.profile.length === 3);
check('13. Redo (keyboard) brings it back', st.params.profile.length === 3);
await page.getByTestId('vase-profile-point').nth(1).dblclick();
st = await settled((s) => s.params.profile.length === 2);
check('14. Double-clicking a point removes it', st.params.profile.length === 2);
await page.getByRole('button', { name: 'Star', exact: true }).click();
await page.getByLabel('Sides').fill('5');
await page.getByLabel('Sides').press('Enter');
await page.getByLabel('Twist (degrees)').fill('90');
await page.getByLabel('Twist (degrees)').press('Enter');
await page.getByRole('button', { name: 'Ribs', exact: true }).click();
st = await settled(
  (s) => s.params.shape.kind === 'star' && s.params.shape.sides === 5 && s.params.twist === 90 && s.params.pattern.kind === 'ribs',
);
check(
  '15. Shape, sides, twist and pattern all apply, and the result stays a closed solid',
  st.parts.every((p) => p.ok),
  JSON.stringify({ shape: st.params.shape.kind, twist: st.params.twist, pattern: st.params.pattern.kind }),
);
const capSolid = st.capacity;
await page.getByRole('switch', { name: /Vase mode/ }).click();
st = await settled((s) => !s.params.vaseMode);
check(
  '16. Turning vase mode off gives real walls (less capacity)',
  st.capacity < capSolid && (await page.getByLabel('Wall thickness (mm)').isVisible()),
  `${capSolid.toFixed(0)} → ${st.capacity.toFixed(0)} ml`,
);
await page.screenshot({ path: `${OUT}/vase-02-design.png` });

// 4. Types
await page.getByRole('radio', { name: 'Plant pot' }).click();
st = await settled((s) => s.params.type === 'pot' && s.parts.length === 2);
check(
  '17. Plant pot: drainage settings and a saucer part',
  (await page.getByRole('radiogroup', { name: 'Drainage holes' }).isVisible()) && st.parts[1]?.id === 'saucer',
);
await page.getByRole('radio', { name: 'Lampshade' }).click();
st = await settled((s) => s.params.type === 'lampshade');
check(
  '18. Lampshade: lamp-holder hole setting and an LED note',
  (await page.getByLabel('Lamp-holder hole (mm)').isVisible()) && st.notes.some((n) => /LED/.test(n)),
);
await page.getByRole('radio', { name: 'Vase' }).click();
await settled((s) => s.params.type === 'vase');

// 5. Checks
await S(() =>
  window.modellioVase.store.getState().setParams({
    profile: [
      { t: 0, r: 15 },
      { t: 0.4, r: 18 },
      { t: 1, r: 90 },
    ],
    height: 60,
  }),
);
await settled((s) => s.overhang > 60);
check(
  '19. A steep flare is reported as an overhang problem',
  (await page.getByTestId('vase-warning').first().textContent()).includes('droop'),
);
await page.getByRole('button', { name: 'Undo', exact: true }).click();
await settled((s) => s.params.height !== 60);

// 6. Downloads and hand-off
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByTestId('vase-download').click()]);
const model = new TextDecoder().decode(unzipSync(fs.readFileSync(await dl.path()))['3D/3dmodel.model']);
const tris = (model.match(/<triangle /g) ?? []).length;
check('20. Download gives a finer 3MF than the preview', dl.suggestedFilename().endsWith('.3mf') && tris > 100000, `${tris} triangles`);
const [stl] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  page
    .getByRole('button', { name: /Download .* as STL/ })
    .first()
    .click(),
]);
const bytes = fs.readFileSync(await stl.path());
check('21. Each part downloads as a binary STL', bytes.length === 84 + bytes.readUInt32LE(80) * 50);
const before = await S(() => JSON.stringify(window.modellioVase.store.getState().params));
await page.getByTestId('vase-surprise').click();
st = await settled();
check('22. "Surprise me" makes a new printable design', JSON.stringify(st.params) !== before && st.parts.every((p) => p.ok));
await page.addScriptTag({ content: fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
const v = await S(async () => {
  const r = await window.axe.run(document, { resultTypes: ['violations'] });
  return r.violations
    .filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.id} (${x.nodes.length}): ${x.nodes[0]?.target?.join(' ')}`);
});
check('23. No serious accessibility violations', v.length === 0, v.slice(0, 4).join(' | '));
const kept = await S(() => JSON.stringify(window.modellioVase.store.getState().params));
await page.reload({ waitUntil: 'networkidle' });
await page.getByTestId('vase-studio').waitFor();
check('24. The design is remembered after a reload', (await S(() => JSON.stringify(window.modellioVase.store.getState().params))) === kept);
await settled();
const rootsBefore = await S(() => window.modellio.store.getState().doc.rootIds.length);
await page.getByRole('button', { name: 'Customise in Design Studio' }).click();
await page.getByTestId('left-panel').waitFor();
check(
  '25. "Customise in Design Studio" opens it in the editor',
  (await S(() => window.modellio.store.getState().doc.rootIds.length)) === rootsBefore + 1,
);
await page.getByRole('button', { name: 'Makers' }).click();
check('26. The Makers menu lists the Vase Maker', await page.getByRole('menuitem', { name: /Vase Maker/ }).isEnabled());
await page.keyboard.press('Escape');

// 7. Tablet
const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
const tp = await tablet.newPage();
await tp.goto(`${URL}/?studio=vase`, { waitUntil: 'networkidle' });
await tp.getByTestId('vase-part').first().waitFor({ timeout: 30000 });
check('27. Tablet: no horizontal scrolling', !(await tp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
await tablet.close();

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
