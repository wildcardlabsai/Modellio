import { createRequire } from 'node:module';
import type * as Replicad from 'replicad';
import { buildBrep, sketchPath } from './build';
import type { FeatureRecipe } from './types';
import { chainPolygon, segmentOf, pointMap, sketchOutlines } from '@/cad/sketch/outline';
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

const shoelace = (poly: [number, number][]) =>
  Math.abs(poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0)) / 2;

/** A dome: a straight base from (0,0) to (20,0), closed by a Bézier back over the top. */
const dome: Sketch = {
  points: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 20, y: 0 },
    { id: 'h1', x: 20, y: 15 },
    { id: 'h2', x: 0, y: 15 },
  ],
  entities: [
    { id: 'base', kind: 'line', a: 'a', b: 'b' },
    { id: 'top', kind: 'bezier', a: 'b', b: 'a', c1: 'h1', c2: 'h2' },
  ],
  constraints: [],
};
/**
 * The dome's exact area. By Green's theorem the region between a cubic Bézier and its chord, with
 * handles straight up from each end to a height h (the curve peaks at 3/4 h), is 3/5 · width · h.
 */
const exactArea = (3 / 5) * 20 * 15;

describe('Bézier splines in both geometry engines', () => {
  it('the outline walk keeps a Bézier and reverses its handles when walked backwards', () => {
    const o = sketchOutlines(dome);
    expect(o.chains).toHaveLength(1);
    expect(o.chains[0].map((s) => s.kind).sort()).toEqual(['bezier', 'line']);
    const fwd = segmentOf(pointMap(dome), dome.entities[1] as never, 'b');
    const back = segmentOf(pointMap(dome), dome.entities[1] as never, 'a');
    expect(fwd).toMatchObject({ from: [20, 0], to: [0, 0], c1: [20, 15], c2: [0, 15] });
    expect(back).toMatchObject({ from: [0, 0], to: [20, 0], c1: [0, 15], c2: [20, 15] });
  });

  it('the mesh outline samples the curve closely (area within 0.2 %)', () => {
    const area = shoelace(chainPolygon(sketchOutlines(dome).chains[0]));
    expect(Math.abs(area - exactArea) / exactArea).toBeLessThan(0.002);
  });

  it('the exact engine draws a true Bézier: extruded volume = area × depth', () => {
    const recipe: FeatureRecipe = { base: { kind: 'sketch', sketch: dome, op: 'extrude', depth: 4, angle: 360 }, ops: [] };
    const b = buildBrep(r, { recipe, size: [20, 11.25, 4] });
    expect(Math.abs(b.volume - exactArea * 4) / (exactArea * 4)).toBeLessThan(1e-5);
  });

  it('a Bézier can be a sweep path', () => {
    const path: Sketch = {
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'c1', x: 0, y: 10 },
        { id: 'c2', x: 0, y: 20 },
        { id: 'b', x: 0, y: 30 },
      ],
      entities: [{ id: 's', kind: 'bezier', a: 'a', b: 'b', c1: 'c1', c2: 'c2' }],
      constraints: [],
    };
    const p = sketchPath(path);
    expect(typeof p).not.toBe('string');
    const profile: Sketch = { points: [{ id: 'o', x: 0, y: 0 }], entities: [{ id: 'c', kind: 'circle', c: 'o', r: 2 }], constraints: [] };
    const recipe: FeatureRecipe = {
      base: { kind: 'sweep', profile, path, pathPlane: 'XZ', orientation: 'follow', corners: 'round' },
      ops: [],
    };
    // Straight handles: a straight 30 mm path, so a cylinder.
    const b = buildBrep(r, { recipe, size: [0, 0, 0] });
    expect(Math.abs(b.volume - Math.PI * 4 * 30) / (Math.PI * 4 * 30)).toBeLessThan(1e-4);
  });
});
