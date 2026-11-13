/**
 * End-to-end check for the Keyring & Name Tag Maker and the shared maker design canvas,
 * driven through the real UI in Chromium.
 *
 *   node scripts/e2e-keyring.mjs [url] [screenshotDir]
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
  if (!sessionStorage.getItem('keyring-e2e')) {
    localStorage.removeItem('modellio:keyring');
    sessionStorage.setItem('keyring-e2e', '1');
  }
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const S = (fn, arg) => page.evaluate(fn, arg);
const state = () =>
  S(() => {
    const s = window.modellioKeyring.store.getState();
    return {
      building: s.building,
      error: s.error,
      elements: s.elements.map((e) => ({ id: e.id, kind: e.kind, role: e.role, x: e.x, y: e.y, w: e.w, h: e.h, rotation: e.rotation })),
      selected: s.selected,
      params: s.params,
      templateId: s.templateId,
      parts: s.result?.parts.map((p) => ({ id: p.id, ok: p.watertight, v: p.volume, size: p.size })) ?? [],
      width: s.result?.width,
      height: s.result?.height,
      warnings: s.result?.warnings ?? [],
      notes: s.result?.notes ?? [],
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
const vol = (st, id) => st.parts.find((p) => p.id === id)?.v ?? 0;

// 1. Open from the landing page and the Makers menu
await page.goto(`${URL}/`, { waitUntil: 'networkidle' });
await page
  .getByTestId('studio-card-keyring')
  .getByRole('link', { name: /Open Keyring Maker/ })
  .click();
await page.getByTestId('keyring-studio').waitFor({ timeout: 20000 });
check('1. The landing page card opens the maker at ?studio=keyring', page.url().includes('studio=keyring'));
let st = await settled((s) => s.parts.length === 2);
check(
  '2. The default bubble name tag builds a base and a top colour',
  st.parts.map((p) => p.id).join(',') === 'base,top' && st.parts.every((p) => p.ok && p.v > 0),
  `${st.width?.toFixed(1)} × ${st.height?.toFixed(1)}`,
);
check(
  '3. A filament-change note is given for single-nozzle printers',
  st.notes.some((n) => /filament change/.test(n)),
);
await page.getByRole('button', { name: 'Makers' }).click();
check('4. The Makers menu lists the keyring maker', await page.getByRole('menuitem', { name: /Keyring & Name Tag/ }).isEnabled());
await page.keyboard.press('Escape');

// 2. Templates
await page.getByRole('radio', { name: /Templates/ }).click();
const tiles = await page.getByTestId('keyring-template').count();
check('5. At least 25 templates with thumbnails', tiles >= 25, `${tiles}`);
const thumbsOk = await page
  .waitForFunction(
    () => [...document.querySelectorAll('[data-testid="keyring-template"] img')].slice(0, 6).every((i) => i.complete && i.naturalWidth > 0),
    null,
    { timeout: 10000 },
  )
  .then(() => true)
  .catch(() => false);
check('6. Template thumbnails load', thumbsOk);
await page.getByRole('button', { name: 'Pets', exact: true }).click();
const pets = await page.getByTestId('keyring-template').count();
check('7. Categories filter the templates', pets > 0 && pets < tiles, `${pets}`);
await page.getByRole('button', { name: 'All', exact: true }).click();
await page.locator('[data-template="luggage"]').click();
st = await settled((s) => s.templateId === 'luggage' && s.parts.length === 2);
check(
  '8. Opening a template loads it onto the canvas and switches to Design',
  st.elements.length === 3 && (await page.getByTestId('inspector').count()) + (await page.getByTestId('layers').count()) > 0,
  `${st.width?.toFixed(0)} × ${st.height?.toFixed(0)}`,
);
check(
  '9. Template text keeps its natural proportions (not stretched)',
  st.elements.filter((e) => e.kind === 'text').every((e) => e.w > e.h * 3),
);

// 3. Start blank and build a design from scratch
await page.getByRole('radio', { name: /Templates/ }).click();
await page.getByTestId('keyring-blank').click();
st = await settled((s) => s.elements.length === 0);
check('10. "Start blank" gives an empty canvas and explains what to do', st.elements.length === 0 && !!st.error, st.error ?? '');
await page.getByRole('button', { name: 'Text', exact: true }).click();
st = await settled((s) => s.elements.length === 1 && s.parts.length === 2);
check(
  '11. Adding text makes a tag around it, with the ring placed on its edge',
  st.elements[0].kind === 'text' && st.parts.length === 2 && !st.warnings.some((w) => /not touching/.test(w)),
  st.warnings.join(' '),
);
await page.getByLabel('Text', { exact: true }).fill('ROBIN');
st = await settled((s) => s.parts.length === 2 && s.elements[0].w > 30);
check(
  '12. Typing changes the text, keeping its height',
  Math.abs(st.elements[0].h - 9) < 0.01 && st.elements[0].w > 30,
  `${st.elements[0].w}`,
);

// Canvas: drag to move
const canvas = page.getByTestId('design-canvas');
const el = page.locator('[data-testid="canvas-element"]').first();
let box = await el.boundingBox();
const before = st.elements[0];
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 - 40, { steps: 6 });
await page.mouse.up();
st = await settled();
const moved = st.elements[0];
check(
  '13. Dragging an item moves it (right and up, snapped to 0.5 mm)',
  moved.x > before.x + 2 && moved.y > before.y + 1 && Math.abs(moved.x * 2 - Math.round(moved.x * 2)) < 1e-6,
  `(${moved.x}, ${moved.y})`,
);
await page.keyboard.press('Control+z');
st = await settled();
check('14. The whole drag undoes in one step', st.elements[0].x === before.x && st.elements[0].y === before.y);
await page.keyboard.press('Control+Shift+z');
st = await settled();
check('15. Redo puts it back', st.elements[0].x === moved.x);

// Resize with a corner handle (keeps proportions)
await page.getByTestId('layer').first().click();
box = await page.getByTestId('handle-11').boundingBox();
const r0 = st.elements[0];
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 - 20, { steps: 6 });
await page.mouse.up();
st = await settled();
const r1 = st.elements[0];
check(
  '16. A corner handle resizes and keeps proportions',
  r1.w > r0.w + 2 && Math.abs(r1.w / r1.h - r0.w / r0.h) < 0.02,
  `${r0.w.toFixed(1)}×${r0.h.toFixed(1)} → ${r1.w.toFixed(1)}×${r1.h.toFixed(1)}`,
);

// Rotate
box = await page.getByTestId('handle-rotate').boundingBox();
const c = await el.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(c.x + c.width + 80, c.y + c.height / 2, { steps: 8 });
await page.mouse.up();
st = await settled();
check('17. The rotate handle turns the item', Math.abs(st.elements[0].rotation) > 20, `${st.elements[0].rotation.toFixed(1)}°`);
const angle = page.getByLabel('Angle (degrees)');
await angle.fill('0');
await angle.press('Enter');
st = await settled((s) => s.elements[0].rotation === 0);
check('18. The inspector sets exact values', st.elements[0].rotation === 0);

// Keyboard nudge
await canvas.locator('svg').focus();
const nx = st.elements[0].x;
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('Shift+ArrowLeft');
st = await settled();
check('19. Arrow keys nudge (Shift ×10)', Math.abs(st.elements[0].x - (nx - 5.5)) < 1e-6, `${nx} → ${st.elements[0].x}`);

// Add a shape and change roles
await page.getByRole('button', { name: 'Shape', exact: true }).click();
await page.getByRole('menuitem', { name: 'Heart' }).click();
st = await settled((s) => s.elements.length === 2);
check('20. A shape can be added from the shape menu', st.elements[1].kind === 'shape' && st.selected === st.elements[1].id);
const base0 = vol(st, 'base');
await page.getByRole('radiogroup', { name: 'Role' }).getByRole('radio', { name: 'Engraved' }).click();
st = await settled((s) => s.elements[1].role === 'engraved' && s.parts.length === 2);
check(
  '21. Setting a shape to "Engraved" cuts it into the base',
  vol(st, 'base') < base0 - 50,
  `${base0.toFixed(0)} → ${vol(st, 'base').toFixed(0)}`,
);
await page.getByRole('radiogroup', { name: 'Role' }).getByRole('radio', { name: 'Hole' }).click();
st = await settled((s) => s.elements[1].role === 'cut');
check(
  '22. "Hole" cuts through the tag',
  st.parts.every((p) => p.ok),
);
await page.getByRole('button', { name: 'Delete' }).click();
st = await settled((s) => s.elements.length === 1);
check('23. Delete removes the selected item', st.elements.length === 1);

// Draw freehand
await page.getByRole('button', { name: 'Draw', exact: true }).click();
const cb = await canvas.boundingBox();
await page.mouse.move(cb.x + cb.width * 0.35, cb.y + cb.height * 0.75);
await page.mouse.down();
for (let i = 1; i <= 12; i++)
  await page.mouse.move(cb.x + cb.width * (0.35 + i * 0.02), cb.y + cb.height * (0.75 - Math.sin(i / 3) * 0.04));
await page.mouse.up();
st = await settled((s) => s.elements.length === 2);
check('24. The pen draws a stroke that becomes part of the tag', st.elements[1]?.kind === 'draw' && st.parts.every((p) => p.ok));
await page.getByRole('button', { name: 'Select', exact: true }).click();

// Upload an SVG
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 5 L95 95 L5 95 Z" fill="#000"/></svg>`;
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Upload', exact: true }).click()]);
await chooser.setFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
st = await settled((s) => s.elements.length === 3);
check('25. An uploaded SVG becomes an item on the canvas', st.elements[2]?.kind === 'outline' && st.parts.every((p) => p.ok));
check('26. Layers list every item', (await page.getByTestId('layer').count()) === 3);

// 4. Tag settings
await page.getByRole('radio', { name: 'From plate shapes' }).click();
st = await settled((s) => s.params.plateMode === 'elements');
check('27. Without a plate shape, "From plate shapes" explains what to add', /no plate/i.test(st.error ?? ''), st.error ?? '');
await page.getByRole('radio', { name: 'Around the content' }).click();
await settled((s) => s.parts.length === 2);
const thick = page.getByLabel('Thickness (mm)');
await thick.fill('4');
await thick.press('Enter');
st = await settled((s) => s.params.thickness === 4 && s.parts.length === 2);
check('28. Thickness changes the base', Math.abs(st.parts.find((p) => p.id === 'base').size[2] - 4) < 0.01);
await page.getByRole('switch', { name: 'Border' }).click();
st = await settled((s) => s.params.border.enabled && s.parts.length === 2);
check(
  '29. A border can be added',
  st.parts.every((p) => p.ok),
);
await page.getByRole('switch', { name: 'Two colours' }).click();
st = await settled((s) => s.parts.length === 1);
check('30. Single colour makes one part', st.parts[0]?.id === 'tag');
await page.getByRole('switch', { name: 'Two colours' }).click();
await page.getByRole('radiogroup', { name: 'Top colour' }).getByRole('radio', { name: '#E0262B' }).click();
st = await settled((s) => s.params.topColour === '#E0262B');
check('31. Colours can be picked', st.params.topColour === '#E0262B');

// Key ring hole: drag the pin
const pin = page.getByTestId('pin-ring');
const pb = await pin.boundingBox();
const h0 = st.params.hole;
await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
await page.mouse.down();
await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2 - 12, { steps: 5 });
await page.mouse.up();
st = await settled();
const h1 = st.params.hole;
check('32. Dragging the ring moves the key ring hole', st.params.hole.y > h0.y + 1, `y ${h0.y} → ${st.params.hole.y}`);
const pb2 = await pin.boundingBox();
await page.mouse.move(pb2.x + pb2.width / 2, pb2.y + pb2.height / 2);
await page.mouse.down();
await page.mouse.move(pb.x - 400, pb.y + pb.height / 2 - 300, { steps: 5 });
await page.mouse.up();
st = await settled();
check(
  '33. A ring dragged off the tag is flagged',
  st.warnings.some((w) => /not touching/.test(w)),
  st.warnings[0],
);
await page.keyboard.press('Control+z');
st = await settled((s) => s.params.hole.x === h1.x && s.params.hole.y === h1.y);
check(
  '34. Undo brings the ring back',
  st.params.hole.x === h1.x && st.params.hole.y === h1.y && !st.warnings.some((w) => /not touching/.test(w)),
);
await page.mouse.move(pb2.x + pb2.width / 2, pb2.y + pb2.height / 2);
await page.mouse.down();
await page.mouse.move(pb.x - 400, pb.y - 300, { steps: 5 });
await page.mouse.up();
await settled((s) => s.warnings.some((w) => /not touching/.test(w)));
await page.getByRole('button', { name: 'Put on edge' }).click();
st = await settled((s) => !s.warnings.some((w) => /not touching/.test(w)));
check('34b. "Put on edge" puts a stray ring back on the tag', !st.warnings.some((w) => /not touching/.test(w)), st.warnings.join(' '));
await page.screenshot({ path: `${OUT}/keyring-01-design.png` });

// 5. 3D view
await page.getByRole('radio', { name: '3D', exact: true }).click();
await page.getByTestId('keyring-viewport').waitFor();
check('35. The 3D view shows the tag', await page.getByTestId('keyring-viewport').locator('canvas').isVisible());
await page.screenshot({ path: `${OUT}/keyring-02-3d.png` });
await page.getByRole('radio', { name: 'Design', exact: true }).first().click();
check('36. The mini 3D preview sits beside the canvas', await page.getByTestId('keyring-mini-preview').isVisible());

// 6. Downloads
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('keyring-download').click()]);
const files = unzipSync(fs.readFileSync(await dl.path()));
const model = new TextDecoder().decode(files['3D/3dmodel.model']);
check(
  '37. Download gives a 3MF with one object per colour',
  dl.suggestedFilename().endsWith('.3mf') && (model.match(/<object /g) ?? []).length === 2,
  dl.suggestedFilename(),
);
const [stl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Base as STL' }).click()]);
const stlBytes = fs.readFileSync(await stl.path());
const tris = stlBytes.readUInt32LE(80);
check('38. Each part downloads as a binary STL', stlBytes.length === 84 + tris * 50 && tris > 0, `${tris} triangles`);

// 7. A copy in the Design Studio, and back
const rootsBefore = await S(() => window.modellio.store.getState().doc.rootIds.length);
const designBefore = JSON.stringify((await state()).elements);
await page.getByRole('button', { name: 'Open a copy in Design Studio' }).click();
await page.getByTestId('left-panel').waitFor();
check(
  '39. "Open a copy in Design Studio" adds the tag to the editor',
  (await S(() => window.modellio.store.getState().doc.rootIds.length)) === rootsBefore + 1,
);
check('40. The Design Studio shows a bar to go back to the maker', await page.getByTestId('return-bar').isVisible());
await page.getByRole('button', { name: 'Back to Keyring Maker' }).click();
await page.getByTestId('keyring-studio').waitFor();
st = await settled((s) => s.parts.length > 0);
check('41. "Back" returns to the same design, still editable', JSON.stringify(st.elements) === designBefore);

// 8. Accessibility, persistence
await page.addScriptTag({ content: fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
const v = await S(async () => {
  const r = await window.axe.run(document, { resultTypes: ['violations'] });
  return r.violations
    .filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.id} (${x.nodes.length}): ${x.nodes[0]?.target?.join(' ')}`);
});
check('42. No serious accessibility violations', v.length === 0, v.slice(0, 4).join(' | '));
await page.reload({ waitUntil: 'networkidle' });
await page.getByTestId('keyring-studio').waitFor();
st = await settled((s) => s.parts.length > 0);
check('43. The design is remembered after a reload', JSON.stringify(st.elements) === designBefore);

// 9. Tablet
const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
const tp = await tablet.newPage();
await tp.goto(`${URL}/?studio=keyring`, { waitUntil: 'networkidle' });
await tp.getByTestId('keyring-part').first().waitFor({ timeout: 30000 });
const overflow = await tp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check('44. Tablet: no horizontal scrolling', !overflow);
await tp.screenshot({ path: `${OUT}/keyring-03-tablet.png` });
await tablet.close();

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
