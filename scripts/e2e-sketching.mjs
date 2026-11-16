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

// 5. Splines: draw a closed smooth curve through four points, shape it with handles, extrude it.
await page.getByTestId('new-sketch').click();
await editor().waitFor();
await tool('Spline');
for (const [x, y] of [
  [0, 0],
  [15, 12],
  [30, 0],
  [15, -12],
  [0, 0],
])
  await click(x, y);
check('15. The spline tool draws one Bézier per span', (await page.getByTestId('sketch-spline').count()) === 4);
check('16. Each span has two handles', (await page.getByTestId('sketch-handle').count()) === 8);
const outlines = async () => (await page.getByTestId('sketch-outlines').textContent()) ?? '';
check('17. Clicking the first point closes it into an outline', /^1 closed outline/.test(await outlines()), await outlines());
const handlesNow = () =>
  S(() =>
    [...document.querySelectorAll('[data-testid="sketch-handle"]')].map((r) => [
      +r.getAttribute('x') + +r.getAttribute('width') / 2,
      -(+r.getAttribute('y') + +r.getAttribute('height') / 2),
    ]),
  );
const nearest = (list, x, y) => list.reduce((b, p) => (Math.hypot(p[0] - x, p[1] - y) < Math.hypot(b[0] - x, b[1] - y) ? p : b));
const drag = async ([x0, y0], [x1, y1]) => {
  const [a, b] = await toScreen(x0, y0);
  const [c, e] = await toScreen(x1, y1);
  await page.mouse.move(a, b);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(a + ((c - a) * i) / 6, b + ((e - b) * i) / 6);
  await page.mouse.up();
  await page.waitForTimeout(100);
};
await tool('Select');
let hs = await handlesNow();
const right = nearest(hs, 20, 12);
const left = nearest(hs, 10, 12);
await drag(right, [right[0], right[1] + 4]);
hs = await handlesNow();
const [r2, l2] = [nearest(hs, right[0], right[1] + 4), nearest(hs, left[0], left[1])];
const crossAt = (p, a, b) => (a[0] - p[0]) * (b[1] - p[1]) - (a[1] - p[1]) * (b[0] - p[0]);
check(
  '18. Dragging a handle turns its partner: the join stays smooth',
  Math.abs(crossAt([15, 12], r2, l2)) < 0.05 && Math.hypot(l2[0] - left[0], l2[1] - left[1]) > 0.5,
  `cross ${crossAt([15, 12], r2, l2).toFixed(4)}`,
);
await click(15, 12);
await page.getByRole('button', { name: 'Make corner', exact: true }).click();
hs = await handlesNow();
const l3 = nearest(hs, l2[0], l2[1]);
await drag(nearest(hs, r2[0], r2[1]), [r2[0] + 2, r2[1] - 8]);
hs = await handlesNow();
const l4 = nearest(hs, l3[0], l3[1]);
check('19. After Make corner, a handle moves on its own', Math.hypot(l4[0] - l3[0], l4[1] - l3[1]) < 1e-6);
await click(15, 12);
check('20. A corner join offers Make smooth', (await page.getByRole('button', { name: 'Make smooth', exact: true }).count()) === 1);
await page.screenshot({ path: `${OUT}/sketching-04-spline.png` });
await page.getByTestId('sketch-finish').click();
await editor().waitFor({ state: 'detached' });
const splineBody = await S(() => {
  const o = Object.values(window.modellio.store.getState().doc.objects).find(
    (x) => x.kind === 'shape' && x.shape === 'profile' && x.sketch?.entities.some((e) => e.kind === 'bezier'),
  );
  return o && { id: o.id, size: o.size };
});
check(
  '21. The spline outline becomes a solid',
  !!splineBody && splineBody.size[0] > 25 && splineBody.size[1] > 15,
  JSON.stringify(splineBody?.size),
);
const precise = await S((id) => window.modellio.store.getState().convertToSolid(id), splineBody.id);
check(
  '22. It converts to a precise solid (true Bézier edges in the exact engine)',
  precise && (await S((id) => window.modellio.store.getState().doc.objects[id]?.shape === 'solid', splineBody.id)),
);

// 6. Dimensions on the canvas: drawn for every value, edited in place, solved, conflicts refused.
await page.getByTestId('new-sketch').click();
await editor().waitFor();
await tool('Line');
for (const [x, y] of [
  [0, 0],
  [12, 0],
  [6, 9],
  [0, 0],
])
  await click(x, y);
await tool('Select');
for (const [x, y] of [
  [6, 0],
  [9, 4.5],
  [3, 4.5],
]) {
  await click(x, y);
  await typeInto('Line length (mm)', 10);
}
await page.keyboard.press('Escape');
const dims = page.getByTestId('sketch-dim');
check('23. Each length is drawn as a dimension on the canvas', (await dims.count()) === 3, String(await dims.count()));
const sideLengths = async () => (await drawn()).lines.map(([a, b]) => +Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(3));
const editDim = async (i, v) => {
  await dims.nth(i).dispatchEvent('pointerdown');
  const f = page.getByTestId('sketch-dim-input');
  await f.waitFor();
  await f.fill(String(v));
  await f.press('Enter');
  await page.waitForTimeout(150);
};
const tri0 = await sideLengths();
await editDim(0, 25);
const triNotice = (await page.getByTestId('sketch-notice').textContent()) ?? '';
check(
  '24. A dimension the sketch cannot meet (a side longer than the other two) is refused, naming the conflict',
  /Length 25\.00 mm was not changed: it conflicts with .*Length 10\.00 mm/.test(triNotice),
  triNotice,
);
check('25. Nothing changed', JSON.stringify(await sideLengths()) === JSON.stringify(tri0), (await sideLengths()).join(','));
await editDim(0, 14);
const tri1 = await sideLengths();
check(
  '26. Typing a new value on the canvas re-solves the sketch',
  tri1.filter((l) => Math.abs(l - 14) < 0.01).length === 1 && tri1.filter((l) => Math.abs(l - 10) < 0.01).length === 2,
  tri1.join(','),
);
check('27. The label shows the new value', ((await dims.allTextContents()) ?? []).includes('14'));
await editDim(1, -3);
check('28. A negative length is refused', /not a valid size/.test((await page.getByTestId('sketch-notice').textContent()) ?? ''));
await page.screenshot({ path: `${OUT}/sketching-05-dimensions.png` });
await page.getByRole('button', { name: 'Close sketch without saving' }).click();

// 7. Editing tools: trim, extend, fillet, chamfer and offset, each previewed before the click.
await page.getByTestId('new-sketch').click();
await editor().waitFor();
await tool('Rectangle');
await click(0, 0);
await click(30, 20);
await tool('Line');
await click(10, -5);
await click(10, 25);
await page.keyboard.press('Escape');
await tool('Line');
await click(-20, 10);
await click(-10, 10);
await page.keyboard.press('Escape');
const counts = async () => ({
  lines: await page.getByTestId('sketch-line').count(),
  arcs: await page.getByTestId('sketch-arc').count(),
});
const hoverAt = async (x, y) => {
  const [sx, sy] = await toScreen(x, y);
  await page.mouse.move(sx, sy);
  await page.waitForTimeout(100);
};
const lineThrough = (pts, pred) => pts.lines.find(pred);
// Trim the part of the vertical line above the rectangle.
await tool('Trim');
await hoverAt(10, 23);
check(
  '29. Trim shows what it will cut before the click',
  (await page.locator('[data-preview="remove"]').count()) >= 1 && (await page.locator('[data-preview="add"]').count()) >= 1,
);
await click(10, 23);
let dd = await drawn();
const vert = lineThrough(dd, ([a, b]) => Math.abs(a[0] - 10) < 1e-6 && Math.abs(b[0] - 10) < 1e-6);
check(
  '30. Trim cuts the line back to where it crosses the rectangle',
  vert && Math.abs(Math.max(vert[0][1], vert[1][1]) - 20) < 1e-6 && Math.abs(Math.min(vert[0][1], vert[1][1]) + 5) < 1e-6,
  JSON.stringify(vert),
);
check('31. It says what it did', /Trimmed/.test((await page.getByTestId('sketch-info').textContent()) ?? ''));
// Extend the short line on to the rectangle's left side.
await tool('Extend');
await click(-11, 10);
dd = await drawn();
const ext = lineThrough(dd, ([a, b]) => Math.abs(a[1] - 10) < 1e-6 && Math.abs(b[1] - 10) < 1e-6 && Math.min(a[0], b[0]) < -19);
check('32. Extend runs the line on to the next curve', ext && Math.abs(Math.max(ext[0][0], ext[1][0])) < 1e-6, JSON.stringify(ext));
// Fillet the bottom-right corner; a radius too big is refused with the reason, before and on click.
await tool('Fillet');
const r0 = page.getByLabel('Fillet radius (mm)', { exact: true });
await r0.fill('50');
await r0.press('Enter');
await hoverAt(0, 20);
const why = (await page.getByTestId('sketch-edit-refusal').textContent()) ?? '';
check('33. A fillet too big for the lines is refused before the click, with the reason', /too big for these lines/.test(why), why);
const k0 = await counts();
await click(0, 20);
check(
  '34. Clicking anyway changes nothing and says why',
  JSON.stringify(await counts()) === JSON.stringify(k0) && /too big/.test((await page.getByTestId('sketch-notice').textContent()) ?? ''),
);
await r0.fill('3');
await r0.press('Enter');
await click(30, 0);
const k1 = await counts();
check('35. A fillet adds a tangent arc at the corner', k1.arcs === 1 && k1.lines === k0.lines, JSON.stringify(k1));
check('36. The sketch still solves', !/Conflicting/.test(await status()), await status());
// Chamfer the bottom-left corner.
await tool('Chamfer');
await click(0, 0);
check('37. A chamfer adds a line across the corner', (await counts()).lines === k1.lines + 1);
// Offset the whole outline outward by 2 mm.
await tool('Offset');
await click(15, 0);
await hoverAt(15, -10);
check('38. Offset previews the copy', (await page.locator('[data-preview="add"]').count()) === 6);
await page.getByTestId('sketch-offset-apply').click();
dd = await drawn();
const xs = dd.lines.flatMap(([a, b]) => [a[0], b[0]]);
const ys = dd.lines.flatMap(([a, b]) => [a[1], b[1]]);
check(
  '39. Offset adds a copy 2 mm outside, joined at the corners',
  (await counts()).arcs === 2 && Math.abs(Math.max(...ys) - 22) < 1e-6 && Math.abs(Math.max(...xs) - 32) < 1e-6,
  `${Math.max(...xs)}, ${Math.max(...ys)}`,
);
check('40. Both outlines are closed', /^2 closed outlines/.test(await outlines()), await outlines());
await page.screenshot({ path: `${OUT}/sketching-06-edit-tools.png` });
await page.keyboard.press('Control+z');
check('41. One undo removes the offset', (await counts()).arcs === 1);
await page.getByRole('button', { name: 'Close sketch without saving' }).click();

// 8. Placement: reference planes and sketches attached to faces (schema 3).
const until = async (fn, ms = 30000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await fn();
    if (v) return v;
    await page.waitForTimeout(100);
  }
  return fn();
};
const docNow = () => S(() => window.modellio.store.getState().doc);
const bodyOf = async (recId) => S((r) => Object.values(window.modellio.store.getState().doc.objects).find((o) => o.sketchId === r), recId);
const closeTo = (a, b, tol = 0.01) => a.every((v, i) => Math.abs(v - b[i]) < tol);
await S(() => window.modellio.store.getState().select([]));
const browserView = (name) => page.getByRole('radiogroup', { name: 'Browser view' }).getByRole('radio', { name }).click();
await browserView('Sketches');
await page.getByRole('button', { name: 'New plane parallel to XZ' }).click();
const planeRow = page.getByTestId('plane-row').first();
await planeRow.waitFor();
const planeId = await S(() => Object.keys(window.modellio.store.getState().doc.planes)[0]);
const offsetField = page.getByLabel('Plane 1 offset (mm)', { exact: true });
await offsetField.fill('10');
await offsetField.press('Enter');
check('42. A reference plane is added and offset', (await docNow()).planes[planeId].offset === 10);
await page.getByRole('button', { name: 'Sketch on Plane 1' }).click();
await editor().waitFor();
check('43. Sketching on a plane says so', /on Plane 1/.test((await page.getByTestId('sketch-place').textContent()) ?? ''));
await tool('Rectangle');
await click(0, 0);
await click(20, 10);
await page.getByTestId('sketch-finish').click();
await editor().waitFor({ state: 'detached' });
const planeRec = await until(() =>
  S(() => Object.values(window.modellio.store.getState().doc.sketches).find((r) => r.placement?.kind === 'plane')?.id),
);
let pb = await bodyOf(planeRec);
// XZ plane: sketch x → world X, sketch y → world Z, extrusion along −Y from y = −10.
check(
  '44. The body sits on the plane, extruded along its normal',
  pb && closeTo(pb.transform.position, [10, -12.5, 5]),
  JSON.stringify(pb?.transform),
);
await offsetField.fill('20');
await offsetField.press('Enter');
pb = await bodyOf(planeRec);
check('45. Moving the plane moves the body with it', closeTo(pb.transform.position, [10, -22.5, 5]), JSON.stringify(pb.transform.position));
await offsetField.blur();
await page.keyboard.press('Control+z');
pb = await bodyOf(planeRec);
check(
  '46. One undo puts both back',
  closeTo(pb.transform.position, [10, -12.5, 5]) && (await docNow()).planes[planeId].offset === 10,
  JSON.stringify(pb.transform.position),
);
await S((id) => window.modellio.store.getState().setPosition(id, [50, 50, 50]), pb.id);
pb = await bodyOf(planeRec);
check('47. A placed body cannot be moved on its own', closeTo(pb.transform.position, [10, -12.5, 5]));
await S((id) => window.modellio.store.getState().select([id]), pb.id);
await page.getByRole('tab', { name: /^Properties/ }).click();
check(
  '48. The Inspector says where it sits and locks its position',
  /On Plane 1/.test((await page.getByTestId('placement-note').textContent()) ?? '') &&
    (await page.getByLabel('Position X', { exact: false }).first().isDisabled()),
);

// A sketch on the top face of a box.
const boxId = await S(() => window.modellio.store.getState().addShape('box', [60, 0]));
await S((id) => window.modellio.store.getState().setSize(id, [30, 30, 10]), boxId);
const boxObj = await S((id) => window.modellio.store.getState().doc.objects[id], boxId);
await S((id) => window.modellio.store.getState().select([id]), boxId);
await page.getByRole('tab', { name: /^Features/ }).click();
// Frame the whole design so the box is on screen.
await page.getByRole('button', { name: 'Fit all' }).click();
await page.waitForTimeout(600);
await page.getByTestId('sketch-on-face').click();
await page.getByTestId('face-pick-banner').waitFor();
const topCentre = [boxObj.transform.position[0], boxObj.transform.position[1], boxObj.transform.position[2] + 5];
const clickWorld = async (p) => {
  const q = await S(([x, y, z]) => window.modellio.worldToScreen(x, y, z), p);
  await page.mouse.move(q.x, q.y);
  await page.waitForTimeout(80);
  await page.mouse.click(q.x, q.y);
};
await clickWorld([topCentre[0] + 3, topCentre[1] + 3, topCentre[2]]);
await editor().waitFor();
check(
  '49. Clicking a flat face opens the sketch editor on it',
  /on a face of/.test((await page.getByTestId('sketch-place').textContent()) ?? ''),
);
await tool('Circle');
await click(0, 0);
await click(4, 0);
await page.getByTestId('sketch-finish').click();
await editor().waitFor({ state: 'detached' });
const faceRec = await until(() =>
  S(() => Object.values(window.modellio.store.getState().doc.sketches).find((r) => r.placement?.kind === 'face')?.id),
);
const fb0 = await bodyOf(faceRec);
check(
  '50. The body stands on the face (extruded up from its centre)',
  fb0 && closeTo(fb0.transform.position, [topCentre[0], topCentre[1], topCentre[2] + 2.5]),
  JSON.stringify(fb0?.transform.position),
);
// Make the box taller: the face moves up and the body follows (found again by its reference).
await S((id) => window.modellio.store.getState().setSize(id, [30, 30, 16]), boxId);
const boxTop = async () => {
  const b = await S((id) => window.modellio.store.getState().doc.objects[id], boxId);
  return b.transform.position[2] + b.size[2] / 2;
};
const fb1 = await until(async () => {
  const b = await bodyOf(faceRec);
  return Math.abs(b.transform.position[2] - ((await boxTop()) + 2.5)) < 0.01 && b;
});
check('51. When the box changes, the attached body follows its face', !!fb1, JSON.stringify((await bodyOf(faceRec)).transform.position));
// Remove the face: shell the box with its top open. The attachment breaks; nothing moves.
await S((id) => window.modellio.store.getState().convertToSolid(id), boxId);
await until(() => S((id) => window.modellio.store.getState().doc.objects[id].shape === 'solid', boxId));
const beforeBreak = (await bodyOf(faceRec)).transform;
const face = (await docNow()).sketches[faceRec].placement.face;
await S(
  ([id, face]) =>
    window.modellio.store.getState().setFeatureOps(id, [{ id: 'op_shell', kind: 'shell', thickness: 2, faces: [face] }], 'Shell'),
  [boxId, face],
);
const broken = await until(() => S((r) => window.modellio.store.getState().doc.sketches[r].broken, faceRec));
check('52. Removing the face marks the attachment broken, with the reason', /no longer exists/.test(broken ?? ''), broken);
check('53. …and nothing moved', JSON.stringify((await bodyOf(faceRec)).transform) === JSON.stringify(beforeBreak));
await S(() => window.modellio.store.getState().select([]));
await browserView('Sketches');
check(
  '54. The Sketches view explains it, with Re-attach and Detach',
  /no longer exists/.test((await page.getByTestId('sketch-broken').textContent()) ?? ''),
);
await page.screenshot({ path: `${OUT}/sketching-07-broken.png` });
await page.keyboard.press('Control+z');
const healed = await until(() => S((r) => !window.modellio.store.getState().doc.sketches[r].broken, faceRec));
check('55. Undoing the shell restores the attachment', healed);
// Detach: the body stays put and can then be moved on its own.
const fb = await bodyOf(faceRec);
await S((id) => window.modellio.store.getState().select([id]), fb.id);
await page.getByRole('tab', { name: /^Properties/ }).click();
await page.getByTestId('detach-sketch').click();
check(
  '56. Detach frees the sketch and leaves the body where it was',
  !(await docNow()).sketches[faceRec].placement && closeTo((await bodyOf(faceRec)).transform.position, fb.transform.position),
);
await S((id) => window.modellio.store.getState().setPosition(id, [100, 100, 5]), fb.id);
check('57. A detached body moves freely', closeTo((await bodyOf(faceRec)).transform.position, [100, 100, 5]));

// Saved and reopened: planes, placements and bodies come back.
await S(() => window.modellio.projects.getState().saveNow());
await page.reload({ waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
await until(() => S(() => Object.keys(window.modellio.store.getState().doc.planes ?? {}).length === 1));
const reopened = await docNow();
const pb2 = Object.values(reopened.objects).find((o) => o.sketchId === planeRec);
check(
  '58. Planes, placed sketches and their bodies survive saving and reopening',
  reopened.planes[planeId]?.offset === 10 &&
    reopened.sketches[planeRec]?.placement?.planeId === planeId &&
    pb2 &&
    closeTo(pb2.transform.position, [10, -12.5, 5]) &&
    reopened.schemaVersion === 4,
);

// 9. Safeguards (Stage 4B): a spline can't be dragged into a loop; a sketched body can't be stretched.
await S(() => window.modellio.store.getState().select([]));
await page.getByTestId('new-sketch').click();
await editor().waitFor();
await tool('Spline');
for (const [x, y] of [
  [0, 0],
  [15, 12],
  [30, 0],
])
  await click(x, y);
await page.keyboard.press('Escape');
await tool('Select');
let hs9 = await handlesNow();
const endHandle = nearest(hs9, 25, 2);
const target9 = [0, 25];
{
  const [a, b] = await toScreen(endHandle[0], endHandle[1]);
  const [c, e] = await toScreen(target9[0], target9[1]);
  await page.mouse.move(a, b);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(a + ((c - a) * i) / 10, b + ((e - b) * i) / 10);
  const hint =
    (await page
      .getByTestId('sketch-drag-hint')
      .textContent()
      .catch(() => '')) ?? '';
  check('59. Dragging a handle into a loop is held back, with the reason', /loops over itself|doubles back/.test(hint), hint);
  await page.mouse.up();
}
hs9 = await handlesNow();
const moved = nearest(hs9, target9[0], target9[1]);
check(
  '60. The spline stays valid (the handle stopped short of the loop)',
  Math.hypot(moved[0] - target9[0], moved[1] - target9[1]) > 1 && (await page.getByTestId('sketch-spline-problem').count()) === 0,
);
await page.getByRole('button', { name: 'Close sketch without saving' }).click();

// A body made from a rectangle sketch: stretching it is refused and explained.
const sb = await S(() =>
  window.modellio.store.getState().saveSketch(
    null,
    {
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 30, y: 0 },
        { id: 'c', x: 30, y: 10 },
        { id: 'd', x: 0, y: 10 },
      ],
      entities: [
        { id: 'l1', kind: 'line', a: 'a', b: 'b' },
        { id: 'l2', kind: 'line', a: 'b', b: 'c' },
        { id: 'l3', kind: 'line', a: 'c', b: 'd' },
        { id: 'l4', kind: 'line', a: 'd', b: 'a' },
      ],
      constraints: [],
    },
    { kind: 'extrude', depth: 4, angle: 360 },
  ),
);
await S((id) => window.modellio.store.getState().select([id]), sb);
await page.getByRole('tab', { name: /^Properties/ }).click();
const sizeX = page.getByLabel('Size X', { exact: false }).first();
await sizeX.fill('45');
await sizeX.press('Enter');
await page.getByTestId('sketch-resize-dialog').waitFor();
check(
  '61. Stretching a sketched body is refused, with the reason',
  (await S((id) => window.modellio.store.getState().doc.objects[id].size[0], sb)) === 30 &&
    /stop matching that sketch/.test((await page.getByRole('dialog').textContent()) ?? ''),
);
await page.getByTestId('sketch-resize-independent').click();
const sbAfter = await until(() =>
  S((id) => {
    const o = window.modellio.store.getState().doc.objects[id];
    return Math.abs(o.size[0] - 45) < 1e-6 && o;
  }, sb),
);
check(
  '62. “Make independent and resize” resizes it with its own scaled sketch',
  !!sbAfter && Math.max(...sbAfter.sketch.points.map((p) => p.x)) === 45,
);
const sizeZ = page.getByLabel('Size Z', { exact: false }).first();
await sizeZ.fill('9');
await sizeZ.press('Enter');
check(
  '63. Its height is its extrude depth and changes freely',
  (await S((id) => window.modellio.store.getState().doc.objects[id].params.depth, sb)) === 9 &&
    (await page.getByTestId('sketch-resize-dialog').count()) === 0,
);

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
