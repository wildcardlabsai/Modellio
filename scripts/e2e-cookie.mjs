/**
 * End-to-end check for the Cookie Cutter & Stamp Maker, driven through the real UI in Chromium.
 *
 *   node scripts/e2e-cookie.mjs [url] [screenshotDir]
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
  // Start from defaults once; later reloads must keep what the test changed.
  if (!sessionStorage.getItem('cookie-e2e')) {
    localStorage.removeItem('modellio:cookie');
    sessionStorage.setItem('cookie-e2e', '1');
  }
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const S = (fn, arg) => page.evaluate(fn, arg);
const state = () =>
  S(() => {
    const s = window.modellioCookie.store.getState();
    return {
      building: s.building,
      error: s.error,
      parts: s.result?.parts.map((p) => ({ id: p.id, ok: p.watertight, size: p.size, v: p.volume })) ?? [],
      cookie: s.result?.cookie,
      warnings: s.result?.warnings ?? [],
      pieces: s.result?.pieces,
    };
  });
const settled = async (pred = () => true, ms = 30000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const st = await state();
    if (!st.building && (await pred(st))) return st;
    await page.waitForTimeout(100);
  }
  return state();
};

// 1. Open from the landing page and the Makers menu
await page.goto(`${URL}/`, { waitUntil: 'networkidle' });
await page
  .getByTestId('studio-card-cookie')
  .getByRole('link', { name: /Open Cookie Cutter/ })
  .click();
await page.getByTestId('cookie-studio').waitFor({ timeout: 20000 });
check('1. The landing page card opens the cookie maker at ?studio=cookie', page.url().includes('studio=cookie'));
let st = await settled((s) => s.parts.length === 3);
check(
  '2. A default heart cutter, stamp and handle are built',
  st.parts.map((p) => p.id).join(',') === 'cutter,stamp,handle' && st.parts.every((p) => p.ok && p.v > 0),
  JSON.stringify(st.parts.map((p) => p.id)),
);
check(
  '3. The cookie is 70 mm on its longest side',
  Math.abs(Math.max(st.cookie.width, st.cookie.height) - 70) < 0.5,
  `${st.cookie.width.toFixed(1)} × ${st.cookie.height.toFixed(1)}`,
);
await page.getByRole('button', { name: 'Design', exact: true }).click();
await page.getByTestId('left-panel').waitFor();
await page.getByRole('button', { name: 'Makers' }).click();
check(
  '4. The Makers menu lists the cookie maker and the coming-soon makers',
  (await page.getByRole('menuitem', { name: /Cookie Cutter/ }).isEnabled()) &&
    (await page.getByRole('menuitem', { name: /Keyring Maker/ }).isDisabled()),
);
await page.getByRole('menuitem', { name: /Cookie Cutter/ }).click();
await page.getByTestId('cookie-studio').waitFor();

// 2. Shapes and settings
await page.getByRole('button', { name: 'Gingerbread', exact: true }).click();
st = await settled((s) => s.parts.length === 3);
check(
  '5. Picking a shape rebuilds the parts',
  st.parts.every((p) => p.ok),
  `${st.cookie.width.toFixed(1)} × ${st.cookie.height.toFixed(1)}`,
);
const size = page.getByLabel('Cookie size (mm)');
await size.fill('90');
await size.press('Enter');
st = await settled((s) => Math.abs(Math.max(s.cookie.width, s.cookie.height) - 90) < 0.5);
check('6. Changing the size resizes the cookie', Math.abs(Math.max(st.cookie.width, st.cookie.height) - 90) < 0.5);
const cutter = st.parts.find((p) => p.id === 'cutter');
check(
  '7. The cutter is 14 mm tall with the flange around the cookie',
  Math.abs(cutter.size[2] - 14) < 0.01 && cutter.size[1] > st.cookie.height + 2 * 3.5,
  cutter.size.map((v) => v.toFixed(1)).join(' × '),
);
await page.getByRole('radio', { name: 'Cutter' }).click();
st = await settled((s) => s.parts.length === 1);
check(
  '8. "Cutter" makes only the cutter, and the stamp settings hide',
  st.parts[0]?.id === 'cutter' && (await page.getByRole('heading', { name: 'Stamp', exact: true }).count()) === 0,
);
await page.getByRole('radio', { name: 'Both' }).click();
await page.getByRole('switch', { name: 'Separate handle' }).click();
st = await settled((s) => s.parts.length === 2);
check('9. The handle can be turned off', st.parts.map((p) => p.id).join(',') === 'cutter,stamp');
await page.getByRole('switch', { name: 'Separate handle' }).click();
await settled((s) => s.parts.length === 3);

// 3. Text
await page.getByRole('radio', { name: 'Text' }).click();
await page.getByLabel('Text', { exact: true }).fill('Mia');
st = await settled((s) => s.parts.length === 3 && s.pieces === 1, 30000);
check(
  '10. Text makes a single joined cookie (rounded outline margin)',
  st.pieces === 1 && st.parts.every((p) => p.ok),
  `pieces ${st.pieces}`,
);
const margin = await S(() => window.modellioCookie.store.getState().params.outline);
check('11. Text mode sets an outline margin automatically', margin >= 2, `${margin} mm`);
await page.getByLabel('Outline margin (mm)').fill('0');
await page.getByLabel('Outline margin (mm)').press('Enter');
st = await settled((s) => s.pieces > 1);
check(
  '12. Without a margin, separate letters are reported',
  st.pieces > 1 && st.warnings.some((w) => /separate pieces/.test(w)),
  st.warnings[0],
);
await page.getByLabel('Outline margin (mm)').fill('4');
await page.getByLabel('Outline margin (mm)').press('Enter');
await settled((s) => s.pieces === 1);

// 4. SVG upload
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 5 L95 95 L5 95 Z" fill="#000"/><circle cx="50" cy="65" r="12" fill="#fff"/></svg>`;
await page.getByRole('radio', { name: 'Picture' }).click();
const [svgChooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.getByRole('button', { name: /Choose an SVG or picture/ }).click(),
]);
await svgChooser.setFiles({ name: 'triangle.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
st = await settled((s) => s.parts.length === 3 && Math.abs(Math.max(s.cookie.width, s.cookie.height) - 90) < 1);
check(
  '13. An SVG upload becomes the cookie shape',
  st.parts.every((p) => p.ok),
  `${st.cookie.width.toFixed(1)} × ${st.cookie.height.toFixed(1)}`,
);

// 5. Picture upload (traced)
const png = await S(async () => {
  const c = document.createElement('canvas');
  c.width = 200;
  c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 200, 160);
  g.fillStyle = '#111';
  g.beginPath();
  g.ellipse(100, 80, 90, 60, 0, 0, Math.PI * 2);
  g.fill();
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
});
const [pngChooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.getByRole('button', { name: /Choose another file/ }).click(),
]);
await pngChooser.setFiles({ name: 'drawing.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
st = await settled((s) => s.parts.length === 3 && s.cookie && Math.abs(s.cookie.width / s.cookie.height - (180 + 8) / (120 + 8)) < 0.08);
check(
  '14. A picture is traced into a cookie with the right proportions',
  st.parts.every((p) => p.ok),
  `${st.cookie.width.toFixed(1)} × ${st.cookie.height.toFixed(1)}`,
);
check('15. Picture tracing shows a threshold control', await page.getByLabel(/Darkness threshold/).isVisible());
await page.screenshot({ path: `${OUT}/cookie-01-picture.png` });

// 6. Downloads
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('cookie-download').click()]);
const files = unzipSync(fs.readFileSync(await dl.path()));
const model = new TextDecoder().decode(files['3D/3dmodel.model']);
check(
  '16. "Download all parts" gives a 3MF with three objects',
  dl.suggestedFilename().endsWith('.3mf') && (model.match(/<object /g) ?? []).length === 3,
  dl.suggestedFilename(),
);
const [stl] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Download Cookie cutter as STL' }).click(),
]);
const stlBytes = fs.readFileSync(await stl.path());
const tris = stlBytes.readUInt32LE(80);
check(
  '17. Each part downloads as a binary STL',
  stl.suggestedFilename().endsWith('.stl') && stlBytes.length === 84 + tris * 50 && tris > 0,
  `${tris} triangles`,
);

// 7. Customise in Design Studio
const before = await S(() => window.modellio.store.getState().doc.rootIds.length);
await page.getByRole('button', { name: 'Customise in Design Studio' }).click();
await page.getByTestId('left-panel').waitFor();
const after = await S(() => window.modellio.store.getState().doc.rootIds.length);
check('18. "Customise in Design Studio" opens the parts in the editor', page.url().includes('studio=design') && after === before + 1);
await page.goBack();
await page.getByTestId('cookie-studio').waitFor();

// 8. Errors, accessibility, persistence
await page.getByRole('radio', { name: 'Text' }).click();
await page.getByLabel('Text', { exact: true }).fill('');
await page.getByTestId('cookie-error').waitFor({ timeout: 10000 });
check('19. An empty design explains what to do', (await page.getByTestId('cookie-error').textContent()).includes('Pick a shape'));
await page.getByLabel('Text', { exact: true }).fill('Jo');
await settled((s) => s.parts.length === 3);
await page.addScriptTag({ content: fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
const v = await S(async () => {
  const r = await window.axe.run(document, { resultTypes: ['violations'] });
  return r.violations
    .filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.id} (${x.nodes.length}): ${x.nodes[0]?.target?.join(' ')}`);
});
check('20. No serious accessibility violations', v.length === 0, v.slice(0, 4).join(' | '));
await page.reload({ waitUntil: 'networkidle' });
await page.getByTestId('cookie-studio').waitFor();
await settled((s) => s.parts.length === 3);
const kept = await S(() => ({
  text: window.modellioCookie.store.getState().text,
  size: window.modellioCookie.store.getState().params.size,
}));
check('21. Settings are remembered after a reload', kept.text === 'Jo' && kept.size === 90, JSON.stringify(kept));
await page.screenshot({ path: `${OUT}/cookie-02-text.png` });

// 9. Tablet
const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
const tp = await tablet.newPage();
await tp.goto(`${URL}/?studio=cookie`, { waitUntil: 'networkidle' });
await tp.getByTestId('cookie-part').first().waitFor({ timeout: 30000 });
const overflow = await tp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
const navHeights = await tp.evaluate(() =>
  [...document.querySelectorAll('nav[aria-label="Main"] button')].map((b) => b.getBoundingClientRect().height),
);
check('22. Tablet: no horizontal scrolling and a one-line top bar', !overflow && navHeights.every((h) => h <= 40));
await tablet.close();

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
