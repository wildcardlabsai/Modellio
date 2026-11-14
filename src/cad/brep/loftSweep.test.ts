import { createRequire } from 'node:module';
import type * as Replicad from 'replicad';
import { buildBrep, sketchPath } from './build';
import type { FeatureRecipe } from './types';
import type { Sketch } from '@/cad/sketch/types';

let r: typeof Replicad;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = require.resolve('replicad-opencascadejs/wasm');
  const { default: init } = await import('replicad-opencascadejs');
  const oc = await (init as unknown as (o: { locateFile: () => string }) => Promise<unknown>)({ locateFile: () => wasm });
  r = await import('replicad');
  r.setOC(oc as Parameters<typeof r.setOC>[0]);
}, 60000);

const near = (a: number, b: number, tol = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));
const build = (recipe: FeatureRecipe) => buildBrep(r, { recipe, size: [0, 0, 0] });

const square = (w: number): Sketch => ({
  points: [
    { id: 'a', x: -w / 2, y: -w / 2 },
    { id: 'b', x: w / 2, y: -w / 2 },
    { id: 'c', x: w / 2, y: w / 2 },
    { id: 'd', x: -w / 2, y: w / 2 },
  ],
  entities: [
    { id: 'l1', kind: 'line', a: 'a', b: 'b' },
    { id: 'l2', kind: 'line', a: 'b', b: 'c' },
    { id: 'l3', kind: 'line', a: 'c', b: 'd' },
    { id: 'l4', kind: 'line', a: 'd', b: 'a' },
  ],
  constraints: [],
});
const circle = (rad: number, cx = 0, cy = 0): Sketch => ({
  points: [{ id: 'o', x: cx, y: cy }],
  entities: [{ id: 'c', kind: 'circle', c: 'o', r: rad }],
  constraints: [],
});
/** An open path of points (lines only). */
const polyline = (pts: [number, number][]): Sketch => ({
  points: pts.map(([x, y], i) => ({ id: `p${i}`, x, y })),
  entities: pts.slice(1).map((_, i) => ({ id: `l${i}`, kind: 'line' as const, a: `p${i}`, b: `p${i + 1}` })),
  constraints: [],
});

describe('loft', () => {
  it('ruled loft between squares is an exact frustum', () => {
    const b = build({
      base: {
        kind: 'loft',
        ruled: true,
        sections: [
          { sketch: square(20), height: 0, offset: [0, 0] },
          { sketch: square(10), height: 10, offset: [0, 0] },
        ],
      },
      ops: [],
    });
    near(b.volume, (10 / 3) * (400 + 100 + 200));
    expect(b.size.map((v) => +v.toFixed(4))).toEqual([20, 20, 10]);
  });
  it('circle to a smaller circle is a cone frustum; offsets shift a section', () => {
    const b = build({
      base: {
        kind: 'loft',
        ruled: true,
        sections: [
          { sketch: circle(10), height: 0, offset: [0, 0] },
          { sketch: circle(5), height: 10, offset: [0, 0] },
        ],
      },
      ops: [],
    });
    near(b.volume, ((Math.PI * 10) / 3) * (100 + 50 + 25), 1e-3);
    const shifted = build({
      base: {
        kind: 'loft',
        ruled: true,
        sections: [
          { sketch: circle(10), height: 0, offset: [0, 0] },
          { sketch: circle(10), height: 10, offset: [15, 0] },
        ],
      },
      ops: [],
    });
    // An oblique cylinder keeps the volume of a straight one.
    near(shifted.volume, Math.PI * 100 * 10, 1e-3);
    near(shifted.size[0], 35, 1e-3);
  });
  it('a smooth loft through three different sections makes one closed solid', () => {
    const b = build({
      base: {
        kind: 'loft',
        ruled: false,
        sections: [
          { sketch: circle(10), height: 0, offset: [0, 0] },
          { sketch: square(12), height: 15, offset: [0, 0] },
          { sketch: circle(6), height: 30, offset: [0, 0] },
        ],
      },
      ops: [],
    });
    expect(b.volume).toBeGreaterThan(Math.PI * 36 * 30 * 0.5);
    near(b.size[2], 30, 1e-6);
  });
  it('explains bad sections', () => {
    const two: Sketch = {
      ...circle(5),
      points: [...circle(5).points, { id: 'q', x: 20, y: 0 }],
      entities: [...circle(5).entities, { id: 'c2', kind: 'circle', c: 'q', r: 3 }],
    };
    expect(() =>
      build({
        base: {
          kind: 'loft',
          ruled: true,
          sections: [
            { sketch: two, height: 0, offset: [0, 0] },
            { sketch: circle(5), height: 5, offset: [0, 0] },
          ],
        },
        ops: [],
      }),
    ).toThrow(/single closed outline/);
    expect(() =>
      build({
        base: {
          kind: 'loft',
          ruled: true,
          sections: [
            { sketch: circle(5), height: 0, offset: [0, 0] },
            { sketch: circle(4), height: 0, offset: [0, 0] },
          ],
        },
        ops: [],
      }),
    ).toThrow(/same height/);
  });
});

describe('sweep', () => {
  const sweep = (path: Sketch, profile: Sketch, pathPlane: 'XZ' | 'XY' = 'XZ', corners: 'round' | 'sharp' = 'round'): FeatureRecipe => ({
    base: { kind: 'sweep', profile, path, pathPlane, orientation: 'follow', corners },
    ops: [],
  });
  it('a circle swept along a straight line is a cylinder', () => {
    const b = build(
      sweep(
        polyline([
          [0, 0],
          [0, 30],
        ]),
        circle(2),
      ),
    );
    near(b.volume, Math.PI * 4 * 30, 1e-4);
    near(b.size[2], 30, 1e-4);
  });
  it('along lines and an arc, the volume is area × path length (Pappus)', () => {
    // 20 mm up, a quarter arc of radius 10 to the right, 20 mm across.
    const path: Sketch = {
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 0, y: 20 },
        { id: 'c', x: 10, y: 30 },
        { id: 'd', x: 30, y: 30 },
        { id: 'k', x: 10, y: 20 },
      ],
      entities: [
        { id: 'l1', kind: 'line', a: 'a', b: 'b' },
        // Arcs run a → b counter-clockwise around k: from (10,30) to (0,20) is the quarter we need.
        { id: 'arc', kind: 'arc', c: 'k', a: 'c', b: 'b' },
        { id: 'l2', kind: 'line', a: 'c', b: 'd' },
      ],
      constraints: [],
    };
    const b = build(sweep(path, circle(2)));
    near(b.volume, Math.PI * 4 * (40 + 5 * Math.PI), 1e-3);
  });
  it('a circular path makes a ring (torus)', () => {
    const b = build(sweep(circle(20), circle(2), 'XY'));
    near(b.volume, 2 * Math.PI * Math.PI * 20 * 4, 1e-3);
  });
  it('explains paths that are not one chain', () => {
    const branched: Sketch = {
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 0 },
        { id: 'c', x: 20, y: 0 },
        { id: 'd', x: 10, y: 10 },
      ],
      entities: [
        { id: 'l1', kind: 'line', a: 'a', b: 'b' },
        { id: 'l2', kind: 'line', a: 'b', b: 'c' },
        { id: 'l3', kind: 'line', a: 'b', b: 'd' },
      ],
      constraints: [],
    };
    expect(sketchPath(branched)).toMatch(/branches/);
    expect(sketchPath({ points: [], entities: [], constraints: [] })).toMatch(/Draw a path/);
    expect(() => build(sweep(branched, circle(2)))).toThrow(/branches/);
    expect(() =>
      build(
        sweep(
          polyline([
            [0, 0],
            [0, 30],
          ]),
          polyline([
            [0, 0],
            [1, 1],
          ]),
        ),
      ),
    ).toThrow(/no closed outline/);
  });
});
