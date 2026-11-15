/**
 * End-to-end check for MODELLIO 2.3 Stage 3 (advanced sketching): the new constraints solve in
 * the editor, a conflicting or repeated constraint is refused with the constraints it clashes
 * with named (and nothing changes), and a sketch that already conflicts names and highlights the
 * culprits.
 *
 *   node scripts/e2e-sketching.mjs [url] [screenshotDir]
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

await page.goto(`${URL}/?studio=design`, { waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
await page.waitForTimeout(800);

const editor = () => page.getByTestId('sketch-editor');
const tool = (name) => editor().getByRole('button', { name, exact: true }).click();
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
const click = async (x, y, opts = {}) => {
  const [sx, sy] = await toScreen(x, y);
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.click(sx, sy);
  if (opts.shift) await page.keyboard.up('Shift');
};
const status = async () => (await page.getByTestId('sketch-status').textContent()) ?? '';
const constraintCount = () => page.getByTestId('sketch-constraints').locator('li').count();
const typeInto = async (label, v) => {
  const f = page.getByLabel(label, { exact: true });
  await f.fill(String(v));
  await f.press('Enter');
  await page.waitForTimeout(150);
};
/** What the canvas shows: points, lines and circles in sketch coordinates. */
const drawn = () =>
  S(() => ({
    points: [...document.querySelectorAll('[data-testid="sketch-point"]')].map((c) => [+c.getAttribute('cx'), -c.getAttribute('cy')]),
    lines: [...document.querySelectorAll('[data-testid="sketch-line"]')].map((l) => [
      [+l.getAttribute('x1'), -l.getAttribute('y1')],
      [+l.getAttribute('x2'), -l.getAttribute('y2')],
    ]),
    circles: [...document.querySelectorAll('[data-testid="sketch-circle"]')].map((c) => ({
      c: [+c.getAttribute('cx'), -c.getAttribute('cy')],
      r: +c.getAttribute('r'),
    })),
  }));
const near = (a, b, tol = 0.02) => Math.abs(a - b) < tol;

// 1. A dimensioned rectangle; a contradictory constraint is refused and named.
await page.getByTestId('new-sketch').click();
await editor().waitFor();
// Zoom out so everything drawn below is on screen.
{
  const [cx, cy] = await toScreen(30, 10);
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(50);
  }
}
await tool('Rectangle');
await click(0, 0);
await click(30, 20);
await tool('Select');
await click(0, 0);
await page.getByRole('button', { name: 'Fix point' }).click();
await click(15, 0);
await typeInto('Line length (mm)', 40);
await click(0, 10);
await typeInto('Line length (mm)', 20);
check('1. Fixing a corner and typing two lengths fully constrains the rectangle', /Fully constrained/.test(await status()), await status());
const before = await drawn();
const n0 = await constraintCount();
// The left side is vertical: making it horizontal can't work.
await page.getByRole('button', { name: 'Horizontal', exact: true }).click();
const notice = (await page.getByTestId('sketch-notice').textContent()) ?? '';
check(
  '2. A conflicting constraint is refused, naming what it conflicts with',
  /Horizontal was not added: it conflicts with .*Vertical/.test(notice),
  notice,
);
check(
  '3. Nothing changed: same constraints, same geometry, still fully constrained',
  (await constraintCount()) === n0 && JSON.stringify(await drawn()) === JSON.stringify(before) && /Fully constrained/.test(await status()),
);
// The top and bottom are both horizontal, so making them parallel adds nothing: refused as a repeat.
await click(20, 0);
check('4a. Selecting something else clears the old message', (await page.getByTestId('sketch-notice').count()) === 0);
await click(20, 20, { shift: true });
await page.getByRole('button', { name: 'Parallel', exact: true }).click();
const repeat = (await page.getByTestId('sketch-notice').textContent()) ?? '';
check(
  '4. A constraint the sketch already implies is refused as a repeat',
  /Parallel was not added: .*Horizontal.* already do/.test(repeat),
  repeat,
);
await page.screenshot({ path: `${OUT}/sketching-01-refused.png` });

// 2. Tangent: a line and a circle, two circles (left of the rectangle, in view).
await tool('Circle');
await click(-60, 10);
await click(-55, 10);
await tool('Circle');
await click(-35, 10);
await click(-27, 10);
await tool('Line');
await click(-80, -12);
await click(-20, -12);
await page.keyboard.press('Escape');
await tool('Select');
await click(-50, -12);
await click(-60, 15, { shift: true });
await page.getByRole('button', { name: 'Tangent', exact: true }).click();
// Circles and lines in the order they were drawn: the tangent line is the fifth line.
let d = await drawn();
const lineDist = (p, [a, b]) =>
  Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
let [c1, c2] = d.circles;
check(
  '5. Tangent puts the line exactly one radius from the circle centre',
  near(lineDist(c1.c, d.lines[4]), c1.r, 0.01),
  `${lineDist(c1.c, d.lines[4]).toFixed(4)} vs r ${c1.r.toFixed(4)}`,
);
await click(c1.c[0] + c1.r * Math.cos(1), c1.c[1] + c1.r * Math.sin(1));
await click(c2.c[0], c2.c[1] + c2.r, { shift: true });
await page.getByRole('button', { name: 'Tangent', exact: true }).click();
d = await drawn();
[c1, c2] = d.circles;
check(
  '6. Two circles touch: the distance between centres is the sum of the radii',
  near(Math.hypot(c1.c[0] - c2.c[0], c1.c[1] - c2.c[1]), c1.r + c2.r, 0.01),
);
check('7. The earlier line tangency still holds', near(lineDist(c1.c, d.lines[4]), c1.r, 0.01));
check('7a. The rectangle did not move', JSON.stringify(d.lines.slice(0, 4)) === JSON.stringify(before.lines));
await page.keyboard.press('Escape');

// 3. Point constraints: distance between points, midpoint.
await tool('Line');
await click(0, 40);
await click(20, 40);
await page.keyboard.press('Escape');
await tool('Line');
await click(5, 50);
await click(12, 60);
await page.keyboard.press('Escape');
await tool('Select');
await click(5, 50);
await click(12, 60, { shift: true });
await typeInto('Distance between points (mm)', 15);
d = await drawn();
const has = (x, y, tol = 0.6) => d.points.find((p) => near(p[0], x, tol) && near(p[1], y, tol));
const q1 = has(5, 50, 2);
const q2 = d.points.find((p) => p[1] > 52 && p[0] < 30);
check('8. A distance between two points is solved', q1 && q2 && near(Math.hypot(q2[0] - q1[0], q2[1] - q1[1]), 15, 0.01));
const untouched = has(0, 40, 0.001) && has(20, 40, 0.001);
check('9. Geometry not tied to that distance did not move', !!untouched);
await click(q2[0], q2[1]);
await click(10, 40, { shift: true });
await page.getByRole('button', { name: 'Midpoint', exact: true }).click();
d = await drawn();
const base = d.lines.find((l) => near(l[0][1], l[1][1], 0.01) && l[0][1] > 30);
const mid = base && [(base[0][0] + base[1][0]) / 2, (base[0][1] + base[1][1]) / 2];
check('10. Midpoint puts the point in the middle of the line', mid && !!has(mid[0], mid[1], 0.01), mid?.join(','));
await page.screenshot({ path: `${OUT}/sketching-02-constraints.png` });
await page.getByRole('button', { name: 'Close sketch without saving' }).click();

// 4. A saved sketch that already conflicts names and highlights the constraints involved.
const id = await S(() =>
  window.modellio.store.getState().saveSketch(
    null,
    {
      points: [
        { id: 'a', x: 0, y: 0, fixed: true },
        { id: 'b', x: 20, y: 0 },
        { id: 'c', x: 20, y: 10 },
        { id: 'e', x: 0, y: 10 },
      ],
      entities: [
        { id: 'l1', kind: 'line', a: 'a', b: 'b' },
        { id: 'l2', kind: 'line', a: 'b', b: 'c' },
        { id: 'l3', kind: 'line', a: 'c', b: 'e' },
        { id: 'l4', kind: 'line', a: 'e', b: 'a' },
      ],
      constraints: [
        { id: 'k1', kind: 'horizontal', line: 'l1' },
        { id: 'k2', kind: 'distance', line: 'l1', value: 20 },
        { id: 'k3', kind: 'pointDistance', a: 'a', b: 'b', value: 30 },
      ],
    },
    { kind: 'extrude', depth: 4, angle: 360 },
  ),
);
check('11a. The conflicting sketch was saved as a body', !!id);
await S((id) => window.modellio.store.setState({ selection: [id] }), id);
await page.locator('#inspector-tab-features').click();
await page.getByTestId('edit-sketch').click();
await editor().waitFor();
const st = await status();
check(
  '11. A conflicting sketch names the constraints involved',
  /Conflicting constraints: .*Length 20\.00 mm.*Distance 30\.00 mm/.test(st),
  st,
);
check('12. They are highlighted in the constraint list', (await page.locator('[data-culprit]').count()) === 2);
check('13. The geometry they act on is drawn red', (await page.locator('[data-testid="sketch-line"][stroke="#DC2626"]').count()) >= 1);
await page.screenshot({ path: `${OUT}/sketching-03-conflict.png` });
await page.getByRole('button', { name: 'Remove Distance 30.00 mm' }).click();
check('14. Removing one clears the conflict', !/Conflicting/.test(await status()), await status());
await page.getByRole('button', { name: 'Close sketch without saving' }).click();

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
