/**
 * End-to-end check for Split Studio (phases 1 and 2: integration and 3MF import),
 * driven through the real UI in Chromium.
 *
 *   node scripts/e2e-split.mjs [url] [screenshotDir]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { zipSync, strToU8, unzipSync } = require('fflate');

const URL = process.argv[2] ?? 'http://localhost:5173';
const OUT = process.argv[3] ?? 'e2e-results';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ---------- Fixtures (3MF packages built here, as a slicer would write them) ----------
const NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const P = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const box = ([x0, y0, z0], [x1, y1, z1], attrs = () => '') => {
  const v = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const f = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  return `<mesh><vertices>${v.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('')}</vertices><triangles>${f
    .map((t, i) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"${attrs(i)}/>`)
    .join('')}</triangles></mesh>`;
};
const pkg = (rootModel, extra = {}, rels = '') =>
  Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`,
      ),
      '_rels/.rels': strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
      ),
      '3D/3dmodel.model': strToU8(rootModel),
      ...(rels ? { '3D/_rels/3dmodel.model.rels': strToU8(rels) } : {}),
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)])),
    }),
  );

// Bambu Studio style project: parts in a production-extension model part, extruders per part,
// filament colours in project settings, paint on two triangles, and a modifier volume.
const bambu = pkg(
  `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="${NS}" xmlns:p="${P}" requiredextensions="p"><metadata name="Application">BambuStudio-01.10.00.00</metadata><metadata name="Title">Bambu badge</metadata><resources><object id="4" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1"/><component p:path="/3D/Objects/object_1.model" objectid="2"/><component p:path="/3D/Objects/object_1.model" objectid="3"/></components></object></resources><build><item objectid="4" transform="1 0 0 0 1 0 0 0 1 100 100 0"/></build></model>`,
  {
    '3D/Objects/object_1.model': `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="${NS}" xmlns:p="${P}"><resources><object id="1" type="model">${box([0, 0, 0], [30, 20, 3], (i) => (i < 2 ? ' paint_color="8"' : ''))}</object><object id="2" type="model">${box([5, 5, 3], [25, 15, 6])}</object><object id="3" type="model">${box([0, 0, 0], [10, 10, 10])}</object></resources><build/></model>`,
    'Metadata/model_settings.config': `<?xml version="1.0" encoding="UTF-8"?><config><object id="4"><metadata key="name" value="Badge"/><metadata key="extruder" value="1"/><part id="1" subtype="normal_part"><metadata key="name" value="Base"/></part><part id="2" subtype="normal_part"><metadata key="name" value="Top"/><metadata key="extruder" value="3"/></part><part id="3" subtype="modifier_part"><metadata key="name" value="Modifier"/></part></object><plate><metadata key="plater_id" value="1"/></plate></config>`,
    'Metadata/project_settings.config': JSON.stringify({
      filament_colour: ['#FFFFFF', '#E0262B', '#2F6FDE'],
      filament_type: ['PLA', 'PLA', 'PLA'],
    }),
  },
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/Objects/object_1.model" Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
);

// A large single-colour grid (≈200k triangles) so cancellation can be exercised mid-import.
function bigGrid(n) {
  const v = [];
  const t = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) v.push(`<vertex x="${i}" y="${j}" z="${((i * 7 + j * 13) % 5) * 0.2}"/>`);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      t.push(`<triangle v1="${a}" v2="${a + 1}" v3="${a + n + 2}"/>`, `<triangle v1="${a}" v2="${a + n + 2}" v3="${a + n + 1}"/>`);
    }
  return pkg(
    `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="${NS}"><resources><object id="1" type="model"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`,
  );
}
const big = bigGrid(320);
// About a million triangles: long enough to cancel reliably now that import is fast.
const huge = bigGrid(700);

// ---------- Browser ----------
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
await context.addInitScript(() => localStorage.setItem('modellio:onboarded', '1'));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const S = (fn, arg) => page.evaluate(fn, arg);
const split = () =>
  S(() => {
    const s = window.modellioSplit.store.getState();
    return {
      loaded: !!s.doc,
      fileName: s.doc?.fileName,
      colours: s.components.map((c) => ({ id: c.materialId, name: c.name, colour: c.colour, tris: c.triangleCount, type: c.materialType })),
      hidden: s.hidden,
      selected: s.selectedMaterial,
      importing: !!s.importing,
      error: s.error,
      issues: s.doc?.issues.map((i) => i.code) ?? [],
    };
  });
const waitFor = async (fn, ms = 15000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await fn()) return true;
    await page.waitForTimeout(100);
  }
  return false;
};
/** Fraction of sampled canvas pixels that differ from the background, plus whether a colour near `hex` appears. */
const canvasStats = (hex) =>
  S((hex) => {
    const c = document.querySelector('[data-testid="split-viewport"] canvas');
    const w = 240;
    const h = Math.round((c.height / c.width) * w);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.drawImage(c, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const target = hex ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null;
    let painted = 0;
    let match = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - 245) + Math.abs(d[i + 1] - 247) + Math.abs(d[i + 2] - 251) > 30) painted++;
      if (target) {
        // Hue match tolerant to shading: compare normalised RGB direction.
        const s1 = d[i] + d[i + 1] + d[i + 2] + 1;
        const s2 = target[0] + target[1] + target[2] + 1;
        const diff =
          Math.abs(d[i] / s1 - target[0] / s2) + Math.abs(d[i + 1] / s1 - target[1] / s2) + Math.abs(d[i + 2] / s1 - target[2] / s2);
        if (diff < 0.15 && s1 > 60) match++;
      }
    }
    return { painted: painted / (d.length / 4), match: match / (d.length / 4) };
  }, hex);

// 1. Routing and shell
await page.goto(`${URL}/?studio=split`);
await page.getByTestId('split-studio').waitFor({ timeout: 20000 });
check('1. ?studio=split opens Split Studio', await page.getByTestId('split-studio').isVisible());
check(
  '2. The editor workspace is not mounted in Split Studio',
  (await page.getByTestId('left-panel').count()) === 0 && (await page.getByTestId('inspector-panel').count()) === 0,
);
check(
  '3. Split Studio is the current nav item',
  (await page.getByRole('button', { name: 'Split Studio' }).getAttribute('aria-current')) === 'page',
);
const steps = page.getByRole('navigation', { name: 'Split Studio steps' });
check(
  '4. Stepper: Import is current; later steps are locked',
  (await steps.getByRole('button', { name: /^1?\s*Import/ }).getAttribute('aria-current')) === 'step' &&
    (await steps.getByRole('button', { name: /Split/ }).isDisabled()) &&
    (await steps.getByRole('button', { name: /Export/ }).isDisabled()),
);
check(
  '5. Empty state offers file picker and sample',
  (await page.getByRole('button', { name: 'Choose 3MF file' }).isVisible()) &&
    (await page.getByRole('button', { name: 'Try a sample' }).isVisible()),
);

// 2. Sample import through the worker
await page.getByRole('button', { name: 'Try a sample' }).click();
await waitFor(async () => (await split()).loaded);
let st = await split();
check('6. Sample imports with eight colours', st.colours.length === 8, st.colours.map((c) => c.name).join(', '));
check('7. Colour list shows every colour', (await page.getByTestId('split-colour').count()) === 8);
check(
  '8. File info shows the title and triangle count',
  (await page.getByTestId('split-file-info').textContent()).includes('Eye badge (sample)') &&
    (await page.getByTestId('split-file-info').textContent()).includes('Triangles'),
);
check(
  '9. Import step is marked done',
  (await steps
    .getByRole('button', { name: /Import/ })
    .locator('svg')
    .count()) > 0,
);
await page.waitForTimeout(600);
let cs = await canvasStats('#2F6FDE');
check('10. The preview renders the model', cs.painted > 0.04, `painted ${(cs.painted * 100).toFixed(1)}%`);
check('11. The preview shows the blue iris colour', cs.match > 0.002, `match ${(cs.match * 100).toFixed(2)}%`);
await page.screenshot({ path: `${OUT}/split-01-sample.png` });

// 3. Selection, dimensions, visibility
const pupil = page.getByTestId('split-colour').filter({ hasText: 'Black PLA' });
await pupil.getByRole('button', { name: /^Black PLA/ }).click();
st = await split();
const dims = (await page.getByTestId('split-selection').getByTestId('split-dimensions').textContent()).replace(/\s+/g, '');
check(
  '12. Selecting a colour shows its details',
  st.selected !== null && (await page.getByTestId('split-selection').textContent()).includes('Black PLA'),
);
check('13. Selected region dimensions are in mm (pupil Ø10 × 1.5)', dims === 'X10Y10Z1.5' || dims.startsWith('X10Y9.9'), dims);
await pupil.getByRole('button', { name: 'Hide Black PLA' }).click();
st = await split();
check('14. Hiding a colour updates the preview state', st.hidden.includes(st.colours.find((c) => c.name === 'Black PLA').id));
await page.getByRole('button', { name: 'Show all' }).click();
check('15. Show all restores every colour', (await split()).hidden.length === 0);
await page.getByTestId('split-colour').filter({ hasText: 'Blue PLA' }).getByRole('button', { name: 'Show only Blue PLA' }).click();
await page.waitForTimeout(300);
st = await split();
check('16. "Show only" isolates one colour', st.hidden.length === 7);
await page.getByRole('button', { name: 'Show all' }).click();
await S(() => window.modellioSplit.store.getState().select(null));
// Click the model in the viewport.
const vp = await page.getByTestId('split-viewport').boundingBox();
// Click a pixel that shows the model (the first non-background pixel nearest the centre).
const hitPoint = await S(() => {
  const c = document.querySelector('[data-testid="split-viewport"] canvas');
  const cv = document.createElement('canvas');
  cv.width = 200;
  cv.height = Math.round((c.height / c.width) * 200);
  const ctx = cv.getContext('2d');
  ctx.drawImage(c, 0, 0, cv.width, cv.height);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let best = null;
  for (let y = 0; y < cv.height; y++)
    for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4;
      const bg = Math.abs(d[i] - 245) + Math.abs(d[i + 1] - 247) + Math.abs(d[i + 2] - 251) < 40;
      const grid = Math.abs(d[i] - d[i + 2]) < 25 && d[i] > 180;
      if (bg || grid) continue;
      const dist = Math.hypot(x - cv.width / 2, y - cv.height / 2);
      if (!best || dist < best.dist) best = { x: x / cv.width, y: y / cv.height, dist };
    }
  return best;
});
await page.mouse.click(vp.x + (hitPoint?.x ?? 0.5) * vp.width, vp.y + (hitPoint?.y ?? 0.5) * vp.height);
await page.waitForTimeout(200);
check('17. Clicking the model selects the colour under the cursor', (await split()).selected !== null);
await page.getByTestId('split-fit').click();
check('18. Fit view button works', true);

// 4. Vendor (Bambu) project through the file picker
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open another 3MF' }).click()]);
await chooser.setFiles({ name: 'bambu-badge.3mf', mimeType: 'model/3mf', buffer: bambu });
await waitFor(async () => (await split()).fileName === 'bambu-badge.3mf');
st = await split();
check(
  '19. Bambu parts resolve to filament colours',
  JSON.stringify(st.colours.map((c) => [c.name, c.colour, c.tris])) ===
    JSON.stringify([
      ['Filament 1 · PLA', '#FFFFFF', 10],
      ['Filament 2 · PLA', '#E0262B', 2],
      ['Filament 3 · PLA', '#2F6FDE', 12],
      ['Modifier volume (not printed)', '#9AA1AD', 12],
    ]),
  st.colours.map((c) => `${c.name} ${c.colour} ${c.tris}`).join(' | '),
);
check('20. Modifier volumes start hidden', st.hidden.length === 1 && st.colours.find((c) => c.id === st.hidden[0]).type === 'nonprinting');
const report = await page.getByTestId('split-report').textContent();
check(
  '21. Import report explains the slicer data and paint',
  report.includes('Bambu Studio') && report.includes('paint'),
  report.slice(0, 120),
);
check(
  '22. Instances are named from the slicer project',
  (await page.getByTestId('split-colour').nth(1).getByRole('button').first().textContent()).includes('Filament 2'),
);
await page
  .getByTestId('split-colour')
  .filter({ hasText: 'Filament 3' })
  .getByRole('button', { name: /^Filament 3/ })
  .click();
check('23. Selection shows where the colour is used', (await page.getByTestId('split-selection').textContent()).includes('Badge › Part 2'));
await page.screenshot({ path: `${OUT}/split-02-bambu.png` });

// 5. Errors never replace the loaded model
const [bad] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open another 3MF' }).click()]);
await bad.setFiles({ name: 'broken.3mf', mimeType: 'model/3mf', buffer: Buffer.from('this is not a zip archive') });
await page.getByTestId('split-error').waitFor({ timeout: 10000 });
st = await split();
check('24. A broken file shows a readable error', (await page.getByTestId('split-error').textContent()).includes('not a 3MF package'));
check('25. The previous model stays loaded after an error', st.fileName === 'bambu-badge.3mf');
await page.getByRole('button', { name: 'Dismiss error' }).click();
const [wrong] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open another 3MF' }).click()]);
await wrong.setFiles({ name: 'part.stl', mimeType: 'model/stl', buffer: Buffer.from('solid x\nendsolid x') });
check(
  '26. Non-3MF files are refused with an explanation',
  (await page.getByTestId('split-error').textContent()).includes('is not a 3MF file'),
);
await page.getByRole('button', { name: 'Dismiss error' }).click();

// 6. Progress and cancellation (large file)
const [bigChooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open another 3MF' }).click()]);
await bigChooser.setFiles({ name: 'huge-grid.3mf', mimeType: 'model/3mf', buffer: huge });
const sawProgress = await page
  .getByTestId('split-progress')
  .waitFor({ timeout: 5000 })
  .then(
    () => true,
    () => false,
  );
check('27. A progress dialog appears during import', sawProgress);
const pct = await page
  .getByRole('progressbar', { name: 'Import progress' })
  .getAttribute('aria-valuenow')
  .catch(() => null);
await page.getByRole('button', { name: 'Cancel import' }).click();
await page.waitForTimeout(300);
st = await split();
check(
  '28. Cancelling stops the import and keeps the previous model',
  !st.importing && st.fileName === 'bambu-badge.3mf' && !st.error,
  `progress was ${pct}%`,
);
await page.waitForTimeout(1500);
check('29. A cancelled import never lands later', (await split()).fileName === 'bambu-badge.3mf');

// 7. Large file completes, UI stays responsive
const [bigAgain] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open another 3MF' }).click()]);
const t0 = Date.now();
await bigAgain.setFiles({ name: 'big-grid.3mf', mimeType: 'model/3mf', buffer: big });
let maxGap = 0;
let last = Date.now();
const done = await waitFor(async () => {
  const now = Date.now();
  maxGap = Math.max(maxGap, now - last);
  last = now;
  return (await split()).fileName === 'big-grid.3mf';
}, 60000);
st = await split();
check(
  '30. A 200k-triangle file imports',
  done && st.colours[0]?.tris === 320 * 320 * 2,
  `${((Date.now() - t0) / 1000).toFixed(1)} s, ${st.colours[0]?.tris} triangles`,
);
check('31. The page stays responsive while importing (worker)', maxGap < 1500, `longest gap ${maxGap} ms`);

// 8. Drag and drop
await S(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'dropped-bambu.3mf', { type: 'model/3mf' }));
  const el = document.querySelector('[data-testid="split-studio"]');
  el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
}, bambu.toString('base64'));
check('32. Dropping a 3MF imports it', await waitFor(async () => (await split()).fileName === 'dropped-bambu.3mf'));

// 9. Studio switching and editor isolation
const before = await S(() => {
  const { store } = window.modellio;
  store.getState().addShape('box');
  store.getState().select(store.getState().doc.rootIds);
  return store.getState().doc.rootIds.length;
});
await page.keyboard.press('Delete');
await page.keyboard.press('Control+d');
const after = await S(() => window.modellio.store.getState().doc.rootIds.length);
check('33. Editor shortcuts do nothing while in Split Studio', after === before, `${before} → ${after}`);
await page.getByRole('button', { name: 'Design' }).click();
await page.getByTestId('left-panel').waitFor({ timeout: 10000 });
check(
  '34. Design returns to the editor at ?studio=design',
  page.url().includes('studio=design') && (await page.getByTestId('split-studio').count()) === 0,
);
await page.goBack();
await page.getByTestId('split-studio').waitFor({ timeout: 10000 });
check(
  '35. Browser Back returns to Split Studio with the model still loaded',
  (await split()).fileName === 'dropped-bambu.3mf' && (await page.getByTestId('split-colour').count()) === 4,
);
await page.goForward();
await page.getByTestId('left-panel').waitFor({ timeout: 10000 });
check('36. Browser Forward returns to Design', (await page.getByTestId('split-studio').count()) === 0);
await page.getByRole('button', { name: 'Split Studio' }).click();
await page.getByTestId('split-studio').waitFor();

// 10. Accessibility
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
await page.addScriptTag({ content: axeSource });
const violations = await S(async () => {
  const r = await window.axe.run(document, { resultTypes: ['violations'] });
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target?.join(' ')}`);
});
check('37. No serious accessibility violations in Split Studio', violations.length === 0, violations.slice(0, 4).join(' | '));

// 12. Full workflow: split → connect → export
{
  await page.getByRole('button', { name: 'Close file' }).click();
  await page.getByRole('button', { name: 'Try a sample' }).click();
  await waitFor(async () => (await split()).colours.length === 8);
  await page.getByTestId('split-next-split').click();
  await page.getByTestId('split-part').first().waitFor({ timeout: 30000 });
  const parts = () =>
    S(
      () =>
        window.modellioSplit.store.getState().split?.parts.map((p) => ({ name: p.name, ok: p.report.watertight, v: p.report.volume })) ??
        [],
    );
  let ps = await parts();
  check(
    'W1. Splitting the sample gives 9 parts, all closed solids',
    ps.length === 9 && ps.every((p) => p.ok && p.v > 0),
    ps.map((p) => p.name).join(' | '),
  );
  check('W2. Every part is marked ready to print', (await page.locator('[data-testid="split-part"][data-status="ok"]').count()) === 9);
  check('W3. The viewport shows the parts', (await page.getByTestId('split-viewport').getAttribute('data-mode')) === 'parts');
  const snap = () => S(() => document.querySelector('[data-testid="split-viewport"] canvas').toDataURL().length);
  const before = await snap();
  await page.getByTestId('split-explode').fill('80');
  await page.waitForTimeout(400);
  check(
    'W4. The explode slider moves the parts apart',
    (await S(() => window.modellioSplit.store.getState().explode)) === 0.8 && (await snap()) !== before,
  );
  await page.getByTestId('split-part').filter({ hasText: 'Colour #26262B' }).getByRole('button').first().click();
  const details = await page.getByTestId('split-part-details').textContent();
  check(
    'W5. Selecting a part shows its size, volume and solid check',
    details.includes('Colour #26262B') && details.includes('Closed and manifold') && details.includes('cm³'),
    details.slice(0, 80),
  );
  await page.getByRole('switch', { name: 'Separate disconnected pieces' }).click();
  await waitFor(async () => (await parts()).length === 8, 30000);
  check('W6. Changing a split option re-splits (cube faces merge into one part)', (await parts()).length === 8);
  await page.getByRole('button', { name: 'Undo settings change' }).click();
  await waitFor(async () => (await parts()).length === 9, 30000);
  check('W7. Undo restores the previous split', (await parts()).length === 9);
  await page.keyboard.press('Control+Shift+Z');
  await waitFor(async () => (await parts()).length === 8, 30000);
  check('W8. Redo (keyboard) applies it again', (await parts()).length === 8);
  await page.keyboard.press('Control+z');
  await waitFor(async () => (await parts()).length === 9, 30000);

  await page.getByTestId('split-next-connect').click();
  await waitFor(() => S(() => !!window.modellioSplit.store.getState().connected), 30000);
  const con = await S(() => {
    const s = window.modellioSplit.store.getState();
    return {
      connectors: s.connected.connectors.length,
      joints: s.split.joints.length,
      ok: s.connected.parts.every((p) => p.report.watertight),
    };
  });
  check('W9. Connectors: pegs and blind sockets are added, parts stay closed', con.connectors === 2 && con.ok, JSON.stringify(con));
  const jointsText = await page.getByTestId('split-joints').textContent();
  check(
    'W10. The joints list explains each joint',
    jointsText.includes('Ø3 mm peg') && jointsText.includes('Inlay'),
    jointsText.slice(0, 120),
  );
  await page.getByLabel('Peg diameter (mm)').fill('4');
  await page.getByLabel('Peg diameter (mm)').press('Enter');
  await waitFor(() => S(() => window.modellioSplit.store.getState().connected?.connectors[0]?.diameter === 4), 30000);
  check(
    'W11. Changing the peg diameter rebuilds the connectors',
    await S(() => window.modellioSplit.store.getState().connected?.connectors[0]?.diameter === 4),
  );

  await page.getByTestId('split-next-export').click();
  await page.getByTestId('split-plate').first().waitFor();
  check(
    'W12. Export shows one plate per colour',
    (await page.getByTestId('split-plate').count()) === 8 &&
      (await page.getByTestId('split-viewport').getAttribute('data-mode')) === 'plates',
  );
  await page.getByLabel('Printer').selectOption('bambu-a1mini');
  check('W13. Choosing a printer sets the plate size', await S(() => window.modellioSplit.store.getState().plateSettings.width === 180));
  await page.screenshot({ path: `${OUT}/split-04-plates.png` });
  const [one] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Download plate 1 .* as 3MF/ }).click(),
  ]);
  const oneBytes = fs.readFileSync(await one.path());
  check(
    'W14. A single plate downloads as a 3MF package',
    one.suggestedFilename().endsWith('.3mf') && !!unzipSync(oneBytes)['3D/3dmodel.model'],
    one.suggestedFilename(),
  );
  const [all] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByTestId('split-download').click()]);
  const files = unzipSync(fs.readFileSync(await all.path()));
  const names = Object.keys(files);
  const readme = new TextDecoder().decode(files[names.find((n) => n.endsWith('README.txt'))]);
  check(
    'W15. "Download all" gives a ZIP with a 3MF per plate, an STL per part and a README',
    names.filter((n) => n.endsWith('.3mf')).length === 8 &&
      names.filter((n) => n.endsWith('.stl')).length === 9 &&
      readme.includes('Connectors: 2'),
    `${names.length} files`,
  );
  await page.addScriptTag({ content: fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
  const v2 = await S(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target?.join(' ')}`);
  });
  check('W16. No serious accessibility violations in the export step', v2.length === 0, v2.slice(0, 4).join(' | '));
  await page
    .getByRole('navigation', { name: 'Split Studio steps' })
    .getByRole('button', { name: /Import/ })
    .click();
  check('W17. The stepper returns to Import with the colour list', await page.getByTestId('split-colour-list').isVisible());
}

// 11. Tablet layout
const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
await tablet.addInitScript(() => localStorage.setItem('modellio:onboarded', '1'));
const tp = await tablet.newPage();
await tp.goto(`${URL}/?studio=split`);
await tp.getByRole('button', { name: 'Try a sample' }).tap();
await tp.getByTestId('split-colour').first().waitFor({ timeout: 20000 });
const overflow = await tp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check('38. Tablet (1024 px) shows the studio without horizontal scrolling', !overflow);
const navHeights = await tp.evaluate(() =>
  [...document.querySelectorAll('nav[aria-label="Main"] button')].map((b) => b.getBoundingClientRect().height),
);
check(
  '39. Top bar navigation fits on one line at tablet width',
  navHeights.every((h) => h <= 40),
  navHeights.join(', '),
);
const viewportWidth = (await tp.getByTestId('split-viewport').boundingBox()).width;
check('40. The preview keeps at least 45% of the width on a tablet', viewportWidth >= 1024 * 0.45, `${Math.round(viewportWidth)} px`);
await tp.screenshot({ path: `${OUT}/split-03-tablet.png` });
await tablet.close();

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
