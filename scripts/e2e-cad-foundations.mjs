/**
 * End-to-end check for MODELLIO 2.3 Stage 1 (foundations): edges carry their face normals and
 * builds report faces with their triangles; rapid fillet previews build only the latest size; and
 * the sketch editor explains outlines that cross, branch, or reach left of a revolve axis.
 *
 *   node scripts/e2e-cad-foundations.mjs [url] [screenshotDir]
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
const until = async (fn, ms = 30000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await fn();
    if (v) return v;
    await page.waitForTimeout(100);
  }
  return fn();
};

await page.goto(`${URL}/?studio=design`, { waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
await page.waitForTimeout(1000);

// 1. A precise box: edges with both face normals, faces with their triangles.
const box = await S(() => window.modellio.store.getState().addShape('box'));
await S((id) => window.modellio.store.getState().convertToSolid(id), box);
await until(() => S((id) => window.modellio.store.getState().doc.objects[id]?.shape === 'solid', box));
await S((id) => window.modellio.features.getState().start(id, 'fillet'), box);
const base = await until(() =>
  S(() => {
    const b = window.modellio.features.getState().session?.before;
    return (
      b && {
        edges: b.edges.length,
        withFaces: b.edges.filter((e) => e.ref.faces?.length === 2).length,
        faces: b.faces.length,
        tris: b.faces.reduce((n, f) => n + f.count, 0),
        all: b.indices.length / 3,
      }
    );
  }),
);
check('1. Every edge of a precise box records its two faces', base && base.edges === 12 && base.withFaces === 12, JSON.stringify(base));
check('1b. The build lists 6 faces covering every triangle', base && base.faces === 6 && base.tris === base.all, JSON.stringify(base));

// 2. Dragging the radius quickly builds only the latest preview, and it is right.
const top = await S(
  () => window.modellio.features.getState().session.before.edges.find((e) => e.ref.mid[2] > 0.99 && Math.abs(e.ref.dir[0]) > 0.99).ref,
);
await S((ref) => window.modellio.features.getState().toggleEdge(ref), top);
await S(() => {
  const t = window.modellio.features.getState();
  for (const v of [1, 1.5, 2, 2.5, 3, 3.5, 4]) t.setValue(v);
});
const preview = await until(() =>
  S(() => {
    const p = window.modellio.features.getState().session?.preview;
    return p?.state === 'ok' && window.modellio.features.getState().session.value === 4 && p.build.volume;
  }),
);
// A 20 mm box with one 4 mm fillet along a 20 mm edge removes (1 − π/4)·r²·L.
const expected = 8000 - (1 - Math.PI / 4) * 16 * 20;
check(
  '2. Rapid radius changes end with the right preview (R 4 mm)',
  preview && Math.abs(preview - expected) < 0.5,
  `${preview?.toFixed?.(2)} vs ${expected.toFixed(2)}`,
);
await page.getByTestId('feature-apply').click();
check(
  '2b. Applying records one fillet with the edge and its faces',
  await S((id) => {
    const ops = window.modellio.store.getState().doc.objects[id].feature.ops;
    return ops.length === 1 && ops[0].radius === 4 && ops[0].edges[0].faces?.length === 2;
  }, box),
);

// 3. The sketch editor explains crossing outlines and a revolve reaching left of the axis.
await S(() => window.modellio.store.getState().select([]));
await page.keyboard.press('k');
await page.getByTestId('sketch-editor').waitFor();
const toScreen = (x, y) =>
  S(
    ([x, y]) => {
      const s = document.querySelector('[data-testid="sketch-canvas"]');
      const p = s.createSVGPoint();
      p.x = x;
      p.y = -y;
      const q = p.matrixTransform(s.getScreenCTM());
      return [q.x, q.y];
    },
    [x, y],
  );
const rectangle = async ([x0, y0], [x1, y1]) => {
  await page.getByTestId('sketch-editor').getByRole('button', { name: 'Rectangle', exact: true }).click();
  for (const [x, y] of [
    [x0, y0],
    [x1, y1],
  ]) {
    const [sx, sy] = await toScreen(x, y);
    await page.mouse.click(sx, sy);
  }
};
await rectangle([-10, 0], [10, 10]);
check('3. One rectangle: no warnings', (await page.getByTestId('sketch-warnings').count()) === 0);
await page.getByTestId('sketch-editor').getByRole('radiogroup', { name: 'Operation' }).getByRole('radio', { name: 'revolve' }).click();
check(
  '3b. Revolving a profile that reaches left of the axis says that part is not used',
  /left of the green Y axis/.test((await page.getByTestId('sketch-warnings').textContent()) ?? ''),
);
await rectangle([0, 5], [15, 15]);
check('3c. Overlapping outlines are reported as crossing', /cross/.test((await page.getByTestId('sketch-warnings').textContent()) ?? ''));
await page.screenshot({ path: `${OUT}/foundations-sketch-warnings.png` });
await page.getByRole('button', { name: 'Close sketch without saving' }).click();

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
