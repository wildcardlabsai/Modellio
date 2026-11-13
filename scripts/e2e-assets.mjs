/**
 * End-to-end check for the asset library (Design Studio and makers), "put on the underside",
 * the keyring back side, number-field arrows and arrow-key nudging. Driven through the UI.
 *
 *   node scripts/e2e-assets.mjs [url] [screenshotDir]
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

// --- test files ---------------------------------------------------------------------------
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M0 0 H100 V50 H0 Z M40 15 V35 H60 V15 Z" fill="#000"/></svg>`;
function stlBox(w, d, h) {
  const v = (x, y, z) => [x * w, y * d, z * h];
  const q = [
    [v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)],
    [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)],
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)],
    [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)],
    [v(1, 1, 0), v(0, 1, 0), v(0, 1, 1), v(1, 1, 1)],
    [v(0, 1, 0), v(0, 0, 0), v(0, 0, 1), v(0, 1, 1)],
  ];
  const tris = q.flatMap(([a, b, c, d]) => [
    [a, b, c],
    [a, c, d],
  ]);
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((p, k) => p.forEach((c, j) => buf.writeFloatLE(c, 84 + i * 50 + 12 + k * 12 + j * 4))));
  return buf;
}
function threeMf() {
  const verts = [
    [0, 0, 0],
    [20, 0, 0],
    [0, 20, 0],
    [0, 0, 20],
  ];
  const tris = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ];
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <basematerials id="1"><base name="Red" displaycolor="#E0262BFF"/></basematerials>
  <object id="2" type="model" name="Tetra" pid="1" pindex="0"><mesh><vertices>${verts.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('')}</vertices><triangles>${tris.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('')}</triangles></mesh></object>
 </resources>
 <build><item objectid="2"/></build>
</model>`;
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      ),
      '3D/3dmodel.model': strToU8(model),
    }),
  );
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await context.addInitScript(() => {
  localStorage.setItem('modellio:onboarded', '1');
  if (!sessionStorage.getItem('assets-e2e')) {
    localStorage.removeItem('modellio:keyring');
    sessionStorage.setItem('assets-e2e', '1');
  }
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const S = (fn, arg) => page.evaluate(fn, arg);
const until = async (fn, ms = 20000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await fn();
    if (v) return v;
    await page.waitForTimeout(100);
  }
  return fn();
};
const roots = () =>
  S(() => {
    const d = window.modellio.store.getState().doc;
    return d.rootIds.map((id) => ({ id, name: d.objects[id].name, kind: d.objects[id].kind, combine: d.objects[id].combine }));
  });

// 1. Design Studio: the Assets panel
await page.goto(`${URL}/?studio=design`, { waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Assets', exact: true }).click();
await page.getByTestId('assets-panel').waitFor();
check('1. The Assets button opens the asset library', await page.getByTestId('assets-panel').isVisible());

const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('assets-upload').click()]);
await chooser.setFiles([{ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(SVG) }]);
await until(async () => {
  const r = await roots();
  return r.some((o) => o.name === 'logo') && r;
});
const logo = await S(() => {
  const s = window.modellio.store.getState();
  const o = Object.values(s.doc.objects).find((x) => x.name === 'logo');
  return o && { id: o.id, size: o.size, shape: o.shape };
});
check(
  '2. An uploaded SVG becomes a 40 mm × 2 mm solid in the design',
  logo?.shape === 'mesh' && Math.abs(logo.size[0] - 40) < 0.01 && Math.abs(logo.size[2] - 2) < 0.01,
  JSON.stringify(logo?.size),
);
await until(async () => (await page.getByTestId('asset').count()) === 1);
check('3. The SVG is kept in the library with a thumbnail', (await page.getByTestId('asset').count()) === 1);

const [ch2] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('assets-upload').click()]);
await ch2.setFiles([
  { name: 'block.stl', mimeType: 'model/stl', buffer: stlBox(30, 20, 10) },
  { name: 'tetra.3mf', mimeType: 'model/3mf', buffer: threeMf() },
]);
await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 20000 });
await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 20000 });
await until(async () => {
  const r = await roots();
  return r.length >= 3 && r;
});
const imported = await S(() => {
  const d = window.modellio.store.getState().doc;
  return Object.values(d.objects).map((o) => ({ name: o.name, size: o.size, color: o.color }));
});
const block = imported.find((o) => o.name === 'block');
const tetra = imported.find((o) => /Tetra/.test(o.name));
check('4. STL files import through the units dialog', block && Math.abs(block.size[0] - 30) < 0.01, JSON.stringify(block?.size));
check('5. 3MF files import with their colour', tetra && /e0262b/i.test(tetra.color ?? ''), JSON.stringify(tetra));
await until(async () => (await page.getByTestId('asset').count()) === 3);
check('6. Every file is saved to the library', (await page.getByTestId('asset').count()) === 3);

// Click and drag from the library
const before = (await roots()).length;
await page.locator('[data-testid="asset"][data-asset="logo.svg"]').click();
await until(async () => (await roots()).length === before + 1);
check('7. Clicking an asset adds another copy', (await roots()).length === before + 1);
const vp = await page.getByTestId('viewport').boundingBox();
const dt = await page.evaluateHandle(() => new DataTransfer());
const assetId = await S(() => window.modellio && document.querySelector('[data-asset="block.stl"]') && 'ok');
await page.locator('[data-testid="asset"][data-asset="block.stl"]').dispatchEvent('dragstart', { dataTransfer: dt });
await page
  .getByTestId('viewport')
  .dispatchEvent('dragover', { dataTransfer: dt, clientX: vp.x + vp.width / 2, clientY: vp.y + vp.height / 2 });
await page.getByTestId('viewport').dispatchEvent('drop', { dataTransfer: dt, clientX: vp.x + vp.width / 2, clientY: vp.y + vp.height / 2 });
await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 20000 });
await until(async () => (await roots()).length === before + 2);
check('8. Dragging an asset onto the workplane adds it', assetId === 'ok' && (await roots()).length === before + 2);
await page.screenshot({ path: `${OUT}/assets-01-design.png` });

// 2. Library persists
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Assets', exact: true }).click();
await until(async () => (await page.getByTestId('asset').count()) === 3);
check('9. The library is remembered after a reload', (await page.getByTestId('asset').count()) === 3);

// 3. Put text on the underside
await S(() => {
  const s = window.modellio.store.getState();
  s.selectAll?.();
  s.deleteSelected();
});
const ids = await S(async () => {
  const st = () => window.modellio.store.getState();
  const base = st().addShape('box', [0, 0], { exact: true });
  st().setSize(base, [60, 20, 3]);
  st().setPosition(base, [0, 0, 1.5]);
  const t = await st().addText('BACK', [0, 0]);
  st().setSize(t, [30, 8, 1]);
  st().setPosition(t, [0, 0, 3.5]);
  st().select([t]);
  return { base, t };
});
await page.getByRole('button', { name: 'Engrave', exact: true }).click();
let u = await until(() =>
  S((ids) => {
    const d = window.modellio.store.getState().doc;
    const t = d.objects[ids.t];
    const g = t.parentId && d.objects[t.parentId];
    const b = window.modellio.hierarchy.worldBoundsOf(d, [ids.t]);
    return (
      g && {
        hole: t.isHole,
        rot: t.transform.rotation,
        z: [+b.min.z.toFixed(3), +b.max.z.toFixed(3)],
        combine: g.combine,
        n: g.children.length,
      }
    );
  }, ids),
);
check(
  '10. "Engrave" turns text face down into the bottom of the part below it',
  u &&
    u.hole &&
    u.combine === 'union' &&
    u.n === 2 &&
    Math.abs(Math.abs(u.rot[0]) - 180) < 0.01 &&
    u.z[0] < 0 &&
    Math.abs(u.z[1] - 0.6) < 0.01,
  JSON.stringify(u),
);
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
await S((ids) => window.modellio.store.getState().select([ids.t]), ids);
await page.getByRole('button', { name: 'Flush colour' }).click();
u = await until(() =>
  S((ids) => {
    const d = window.modellio.store.getState().doc;
    const t = d.objects[ids.t];
    const b = d.objects[ids.base];
    const g = b.parentId && d.objects[b.parentId];
    return g && { top: t.parentId === null, hole: t.isHole, z: t.transform.position[2], kids: g.children.length, combine: g.combine };
  }, ids),
);
check(
  '11. "Flush colour" leaves the text as a flush solid and cuts a matching pocket',
  u && u.top && !u.hole && Math.abs(u.z - 0.3) < 0.01 && u.kids === 2 && u.combine === 'union',
  JSON.stringify(u),
);
await page.keyboard.press('Escape');
await page.keyboard.press('Control+e');
await page.getByRole('radio', { name: '3MF' }).click();
const [exp] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download 3MF' }).click()]);
const model = new TextDecoder().decode(unzipSync(fs.readFileSync(await exp.path()))['3D/3dmodel.model']);
const objs = (model.match(/<object /g) ?? []).length;
check('12. Export keeps the inlay as its own object (two colours)', objs >= 2, `${objs} objects`);
await page.screenshot({ path: `${OUT}/assets-02-underside.png` });

// 4. Number-field arrows and nudging
await S((ids) => window.modellio.store.getState().select([ids.t]), ids);
const pos0 = await S((ids) => window.modellio.store.getState().doc.objects[ids.t].transform.position[0], ids);
const xField = page.getByLabel('Position X', { exact: true }).locator('xpath=..');
await xField.getByTestId('step-up').click();
const pos1 = await S((ids) => window.modellio.store.getState().doc.objects[ids.t].transform.position[0], ids);
check('13. The ▲ arrow on a number field steps the value', Math.abs(pos1 - pos0 - 1) < 1e-6, `${pos0} → ${pos1}`);
await xField.getByTestId('step-down').scrollIntoViewIfNeeded();
const sb = await xField.getByTestId('step-down').boundingBox();
await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
await page.mouse.down();
await page.waitForTimeout(900);
await page.mouse.up();
const pos2 = await S((ids) => window.modellio.store.getState().doc.objects[ids.t].transform.position[0], ids);
check('14. Holding an arrow keeps stepping', pos2 < pos1 - 3, `${pos1} → ${pos2}`);
await page
  .getByTestId('viewport')
  .click({ position: { x: 5, y: 5 }, force: true })
  .catch(() => {});
await S((ids) => window.modellio.store.getState().select([ids.t]), ids);
await page.locator('body').focus();
const n0 = await S((ids) => window.modellio.store.getState().doc.objects[ids.t].transform.position[1], ids);
await page.keyboard.press('ArrowUp');
const n1 = await S((ids) => window.modellio.store.getState().doc.objects[ids.t].transform.position[1], ids);
await page.keyboard.press('Shift+ArrowUp');
const n2 = await S((ids) => window.modellio.store.getState().doc.objects[ids.t].transform.position[1], ids);
await page.keyboard.press('Alt+ArrowUp');
const n3 = await S((ids) => window.modellio.store.getState().doc.objects[ids.t].transform.position[1], ids);
check(
  '15. Arrow keys nudge 0.5 mm, Shift 5 mm, Alt 0.1 mm',
  Math.abs(n1 - n0 - 0.5) < 1e-6 && Math.abs(n2 - n1 - 5) < 1e-6 && Math.abs(n3 - n2 - 0.1) < 1e-6,
  `${n0} → ${n1} → ${n2} → ${n3}`,
);

// 5. Makers use the same library
await page.goto(`${URL}/?studio=keyring`, { waitUntil: 'networkidle' });
await page.getByTestId('keyring-studio').waitFor();
await page.getByRole('button', { name: 'Assets', exact: true }).click();
await page.getByTestId('maker-assets').waitFor();
await page
  .getByTestId('maker-asset')
  .first()
  .waitFor({ timeout: 10000 })
  .catch(() => {});
const makerAssets = await page.getByTestId('maker-asset').count();
check('16. The keyring Assets menu lists the saved logo (not the 3D models)', makerAssets === 1, `${makerAssets}`);
const kn = await S(() => window.modellioKeyring.store.getState().elements.length);
await page.getByTestId('maker-asset').first().click();
await until(() => S((n) => window.modellioKeyring.store.getState().elements.length === n + 1, kn));
check(
  '17. Picking it adds the logo to the keyring canvas',
  (await S(() => window.modellioKeyring.store.getState().elements.at(-1).kind)) === 'outline',
);

// Keyring back side
await page.getByRole('radio', { name: /^Back/ }).click();
await page.getByRole('button', { name: 'Text', exact: true }).click();
const back = await until(() =>
  S(() => {
    const s = window.modellioKeyring.store.getState();
    const el = s.elements.at(-1);
    return !s.building && s.result && el.side === 'back' && { role: el.role, ok: s.result.parts.every((p) => p.watertight) };
  }),
);
check('18. Text added on the Back is engraved into the back face', back && back.role === 'engraved' && back.ok, JSON.stringify(back));
check(
  '19. The back offers only engraved, flush or hole',
  (await page.getByRole('radiogroup', { name: 'Role' }).getByRole('radio').allTextContents()).join(',') === 'Engraved,Flush,Hole',
);
await page.getByRole('radio', { name: 'Front' }).click();
check('20. Switching to the Front shows the back items faded', (await page.getByTestId('canvas-ghosts').count()) === 1);
await page.screenshot({ path: `${OUT}/assets-03-keyring.png` });

await page.goto(`${URL}/?studio=cookie`, { waitUntil: 'networkidle' });
await page.getByTestId('cookie-studio').waitFor();
await page.getByRole('button', { name: 'Assets', exact: true }).click();
await page
  .getByTestId('maker-asset')
  .first()
  .waitFor({ timeout: 10000 })
  .catch(() => {});
check('21. The cookie maker lists the same saved logo', (await page.getByTestId('maker-asset').count()) === 1);

// 6. Accessibility of the Assets panel
await page.goto(`${URL}/?studio=design`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Assets', exact: true }).click();
await page.getByTestId('assets-panel').waitFor();
await page.addScriptTag({ content: fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
const v = await S(async () => {
  const r = await window.axe.run(document, { resultTypes: ['violations'] });
  return r.violations
    .filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.id} (${x.nodes.length}): ${x.nodes[0]?.target?.join(' ')}`);
});
check('22. No serious accessibility violations', v.length === 0, v.slice(0, 4).join(' | '));

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
