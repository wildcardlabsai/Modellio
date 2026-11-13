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
    localStorage.removeItem('modellio:cookie-design');
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
      elements: s.elements.map((e) => ({ id: e.id, kind: e.kind, role: e.role, x: e.x, y: e.y, w: e.w, h: e.h })),
      templateId: s.templateId,
      params: s.params,
    };
  });
const settled = async (pred = () => true, ms = 30000) => {
  const t = Date.now();
  await page.waitForTimeout(150);
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
check('3. The design is on a canvas you can edit directly', (await page.getByTestId('canvas-element').count()) === 1);
check('4. The cookie outline is drawn on the canvas', await page.getByTestId('cookie-outline').isVisible());
await page.getByRole('button', { name: 'Design', exact: true }).first().click();
await page.getByTestId('left-panel').waitFor();
await page.getByRole('button', { name: 'Makers' }).click();
check(
  '5. The Makers menu lists the cookie and keyring makers and the coming-soon makers',
  (await page.getByRole('menuitem', { name: /Cookie Cutter/ }).isEnabled()) &&
    (await page.getByRole('menuitem', { name: /Keyring/ }).isEnabled()) &&
    (await page.getByRole('menuitem', { name: /Sign Maker/ }).isDisabled()),
);
await page.getByRole('menuitem', { name: /Cookie Cutter/ }).click();
await page.getByTestId('cookie-studio').waitFor();

// 2. Templates
await page.getByRole('radio', { name: /Templates/ }).click();
const tiles = await page.getByTestId('cookie-template').count();
check('6. At least 20 templates', tiles >= 20, `${tiles}`);
await page.locator('[data-template="gingerbread"]').click();
st = await settled((s) => s.templateId === 'gingerbread' && s.parts.length === 3);
check(
  '7. A template opens on the canvas at its real size',
  Math.abs(st.cookie.height - 80) < 1 && st.parts.every((p) => p.ok),
  `${st.cookie.width.toFixed(1)} × ${st.cookie.height.toFixed(1)}`,
);
const size = page.getByLabel('Design size (mm)');
await size.fill('90');
await size.press('Enter');
st = await settled((s) => Math.abs(s.cookie.height - 90) < 0.6);
check('8. "Design size" scales the whole design', Math.abs(st.cookie.height - 90) < 0.6, `${st.cookie.height.toFixed(1)}`);
const cutter = st.parts.find((p) => p.id === 'cutter');
check(
  '9. The cutter is 14 mm tall with the flange around the cookie',
  Math.abs(cutter.size[2] - 14) < 0.01 && cutter.size[1] > st.cookie.height + 2 * 3.5,
  cutter.size.map((v) => v.toFixed(1)).join(' × '),
);
await page.getByRole('radio', { name: 'Cutter', exact: true }).click();
st = await settled((s) => s.parts.length === 1);
check(
  '10. "Cutter" makes only the cutter, and the stamp settings hide',
  st.parts[0]?.id === 'cutter' && (await page.getByRole('heading', { name: 'Stamp', exact: true }).count()) === 0,
);
await page.getByRole('radio', { name: 'Cutter + stamp' }).click();
await page.getByRole('switch', { name: 'Separate handle' }).click();
st = await settled((s) => s.parts.length === 2);
check('11. The handle can be turned off', st.parts.map((p) => p.id).join(',') === 'cutter,stamp');
await page.getByRole('switch', { name: 'Separate handle' }).click();
await settled((s) => s.parts.length === 3);

// 3. Detail pressed into the stamp
const stamp0 = st.parts.find((p) => p.id === 'stamp')?.v ?? (await state()).parts.find((p) => p.id === 'stamp').v;
const cut0 = (await state()).parts.find((p) => p.id === 'cutter').v;
await page.getByRole('button', { name: 'Text', exact: true }).click();
st = await settled((s) => s.elements.length === 2 && s.parts.length === 3);
check('12. Text added to a cookie becomes stamp detail', st.elements[1].role === 'detail');
await page.getByLabel('Text', { exact: true }).fill('MAX');
st = await settled((s) => s.parts.length === 3);
check(
  '13. Stamp detail changes the stamp, not the cutter',
  Math.abs(st.parts.find((p) => p.id === 'cutter').v - cut0) < 1 && st.parts.find((p) => p.id === 'stamp').v !== stamp0,
);

// 4. A name cookie from scratch
await page.getByRole('radio', { name: /Templates/ }).click();
await page.getByTestId('cookie-blank').click();
st = await settled((s) => s.elements.length === 0);
check('14. "Start blank" gives an empty canvas and says what to add', /Add a shape/.test(st.error ?? ''), st.error ?? '');
await page.getByRole('button', { name: 'Text', exact: true }).click();
st = await settled((s) => s.elements.length === 1);
check('15. The first thing added makes the cookie shape', st.elements[0].role === 'shape');
await page.getByLabel('Text', { exact: true }).fill('Mia');
const margin = page.getByLabel('Outline margin (mm)');
await margin.fill('0');
await margin.press('Enter');
st = await settled((s) => s.pieces > 1);
check(
  '16. Without a margin, separate letters are reported',
  st.warnings.some((w) => /separate pieces/.test(w)),
  st.warnings[0],
);
await margin.fill('4');
await margin.press('Enter');
st = await settled((s) => s.pieces === 1);
check('17. An outline margin joins the letters into one cookie', st.pieces === 1 && st.parts.every((p) => p.ok));

// 5. Uploads: SVG via the button, a picture by drag and drop
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 5 L95 95 L5 95 Z" fill="#000"/><circle cx="50" cy="65" r="12" fill="#fff"/></svg>`;
await page.getByRole('radio', { name: /Templates/ }).click();
await page.getByTestId('cookie-blank').click();
await settled((s) => s.elements.length === 0);
const [svgChooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.getByRole('button', { name: 'Upload', exact: true }).click(),
]);
await svgChooser.setFiles({ name: 'triangle.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
st = await settled((s) => s.parts.length === 3);
check('18. An SVG upload becomes the cookie shape', st.elements[0]?.kind === 'outline' && st.parts.every((p) => p.ok));
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
const dt = await page.evaluateHandle((b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const d = new DataTransfer();
  d.items.add(new File([bytes], 'drawing.png', { type: 'image/png' }));
  return d;
}, png);
await page.getByTestId('cookie-studio').dispatchEvent('dragover', { dataTransfer: dt });
await page.getByTestId('cookie-studio').dispatchEvent('drop', { dataTransfer: dt });
st = await settled((s) => s.elements.length === 2 && s.parts.length === 3);
const traced = st.elements[1];
check(
  '19. A dropped picture is traced with the right proportions',
  traced?.kind === 'outline' && Math.abs(traced.w / traced.h - 1.5) < 0.08,
  traced ? `${traced.w.toFixed(1)} × ${traced.h.toFixed(1)}` : 'none',
);
await page.screenshot({ path: `${OUT}/cookie-01-upload.png` });

// 6. Downloads
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('cookie-download').click()]);
const files = unzipSync(fs.readFileSync(await dl.path()));
const model = new TextDecoder().decode(files['3D/3dmodel.model']);
check(
  '20. "Download all parts" gives a 3MF with three objects',
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
  '21. Each part downloads as a binary STL',
  stl.suggestedFilename().endsWith('.stl') && stlBytes.length === 84 + tris * 50 && tris > 0,
  `${tris} triangles`,
);

// 7. A copy in the Design Studio, and back
const kept0 = JSON.stringify((await state()).elements);
const before = await S(() => window.modellio.store.getState().doc.rootIds.length);
await page.getByRole('button', { name: 'Open a copy in Design Studio' }).click();
await page.getByTestId('left-panel').waitFor();
const after = await S(() => window.modellio.store.getState().doc.rootIds.length);
check('22. "Open a copy in Design Studio" adds the parts to the editor', page.url().includes('studio=design') && after === before + 1);
await page.getByRole('button', { name: 'Back to Cookie Maker' }).click();
await page.getByTestId('cookie-studio').waitFor();
st = await settled((s) => s.parts.length === 3);
check('23. "Back to Cookie Maker" returns to the same design', JSON.stringify(st.elements) === kept0);

// 8. Accessibility, persistence
await page.addScriptTag({ content: fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
const v = await S(async () => {
  const r = await window.axe.run(document, { resultTypes: ['violations'] });
  return r.violations
    .filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.id} (${x.nodes.length}): ${x.nodes[0]?.target?.join(' ')}`);
});
check('24. No serious accessibility violations', v.length === 0, v.slice(0, 4).join(' | '));
await page.reload({ waitUntil: 'networkidle' });
await page.getByTestId('cookie-studio').waitFor();
st = await settled((s) => s.parts.length === 3);
check('25. The design is remembered after a reload', JSON.stringify(st.elements) === kept0);
await page.getByRole('radio', { name: '3D', exact: true }).click();
await page.getByTestId('cookie-viewport').waitFor();
await page.screenshot({ path: `${OUT}/cookie-02-3d.png` });

// 9. Tablet
const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
const tp = await tablet.newPage();
await tp.goto(`${URL}/?studio=cookie`, { waitUntil: 'networkidle' });
await tp.getByTestId('cookie-part').first().waitFor({ timeout: 30000 });
const overflow = await tp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
const navHeights = await tp.evaluate(() =>
  [...document.querySelectorAll('nav[aria-label="Main"] button')].map((b) => b.getBoundingClientRect().height),
);
check('26. Tablet: no horizontal scrolling and a one-line top bar', !overflow && navHeights.every((h) => h <= 40));
await tablet.close();

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
