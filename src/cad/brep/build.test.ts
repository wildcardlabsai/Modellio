import { createRequire } from 'node:module';
import type * as Replicad from 'replicad';
import { buildBrep, matchEdges, sketchOutlines } from './build';
import { validateRecipe, type BrepBuild, type EdgeRef, type FeatureRecipe } from './types';
import type { Sketch } from '@/cad/sketch/types';
import type { Vec3 } from '@/types/document';

let r: typeof Replicad;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = require.resolve('replicad-opencascadejs/wasm');
  const { default: init } = await import('replicad-opencascadejs');
  const oc = await (init as unknown as (o: { locateFile: () => string }) => Promise<unknown>)({ locateFile: () => wasm });
  r = await import('replicad');
  r.setOC(oc as Parameters<typeof r.setOC>[0]);
}, 60000);

const prim = (shape: string, params: Record<string, number> = {}): FeatureRecipe => ({
  base: { kind: 'primitive', shape: shape as never, params },
  ops: [],
});
const build = (recipe: FeatureRecipe, size: Vec3) => buildBrep(r, { recipe, size });
const near = (a: number, b: number, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

/**
 * Distinct edges of a built solid whose reference matches a predicate (normalised coordinates).
 * OpenCascade stores a full circle as two half-circle edges with the same reference.
 */
const edgesWhere = (b: BrepBuild, pred: (e: EdgeRef) => boolean) => {
  const out: EdgeRef[] = [];
  for (const e of b.edges) if (pred(e.ref) && !out.some((o) => JSON.stringify(o) === JSON.stringify(e.ref))) out.push(e.ref);
  return out;
};

describe('exact primitives', () => {
  it('box, cylinder, cone, sphere, torus, wedge and tube have the right size and volume', () => {
    const box = build(prim('box'), [20, 30, 10]);
    expect(box.size.map((v) => +v.toFixed(6))).toEqual([20, 30, 10]);
    near(box.volume, 6000);
    expect(box.edges).toHaveLength(12);
    near(build(prim('cylinder'), [20, 20, 10]).volume, Math.PI * 100 * 10);
    near(build(prim('cylinder'), [20, 10, 10]).volume, Math.PI * 10 * 5 * 10); // elliptical
    near(build(prim('cone'), [20, 20, 30]).volume, (Math.PI * 100 * 30) / 3);
    near(build(prim('cone', { topRatio: 0.5 }), [20, 20, 30]).volume, (Math.PI * 30 * (100 + 25 + 50)) / 3);
    near(build(prim('sphere'), [20, 20, 20]).volume, (4 / 3) * Math.PI * 1000);
    near(build(prim('sphere'), [20, 10, 30]).volume, (4 / 3) * Math.PI * 10 * 5 * 15);
    near(build(prim('torus'), [20, 20, 4]).volume, 2 * Math.PI ** 2 * 8 * 4);
    const wedge = build(prim('wedge'), [20, 10, 30]);
    near(wedge.volume, (20 * 30 * 10) / 2);
    expect(wedge.size.map((v) => +v.toFixed(6))).toEqual([20, 10, 30]);
    near(build(prim('tube', { wall: 2 }), [20, 20, 10]).volume, Math.PI * (100 - 64) * 10);
  });

  it('a rounded box rounds every edge exactly', () => {
    const r2 = 2;
    // Box minus edge material: 12 edges lose (1 − π/4)r² along their straight length, corners add back.
    const b = build(prim('box', { radius: r2 }), [20, 20, 20]);
    const straight = 12 * (1 - Math.PI / 4) * r2 * r2 * (20 - 2 * r2);
    const corners = 8 * (r2 ** 3 - (Math.PI / 6) * r2 ** 3);
    near(b.volume, 8000 - straight - corners);
  });
});

describe('sketch bases', () => {
  const rectWithHole: Sketch = {
    points: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 40, y: 0 },
      { id: 'c', x: 40, y: 20 },
      { id: 'd', x: 0, y: 20 },
      { id: 'o', x: 20, y: 10 },
    ],
    entities: [
      { id: 'l1', kind: 'line', a: 'a', b: 'b' },
      { id: 'l2', kind: 'line', a: 'b', b: 'c' },
      { id: 'l3', kind: 'line', a: 'c', b: 'd' },
      { id: 'l4', kind: 'line', a: 'd', b: 'a' },
      { id: 'h', kind: 'circle', c: 'o', r: 5 },
    ],
    constraints: [],
  };
  it('finds closed chains and circles', () => {
    const o = sketchOutlines(rectWithHole);
    expect(o.chains).toHaveLength(1);
    expect(o.chains[0]).toHaveLength(4);
    expect(o.circles).toHaveLength(1);
  });
  it('extrudes with an exact round hole', () => {
    const b = build({ base: { kind: 'sketch', sketch: rectWithHole, op: 'extrude', depth: 5, angle: 360 }, ops: [] }, [40, 20, 5]);
    near(b.volume, (800 - Math.PI * 25) * 5);
    expect(edgesWhere(b, (e) => e.kind === 'circle')).toHaveLength(2); // top and bottom of the hole
  });
  it('keeps arcs exact', () => {
    // A 20 × 10 slot: two straight sides and two semicircles (counter-clockwise a → b around c).
    const slot: Sketch = {
      points: [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 20, y: 0 },
        { id: 'p3', x: 20, y: 10 },
        { id: 'p4', x: 0, y: 10 },
        { id: 'c1', x: 20, y: 5 },
        { id: 'c2', x: 0, y: 5 },
      ],
      entities: [
        { id: 'l1', kind: 'line', a: 'p1', b: 'p2' },
        { id: 'a1', kind: 'arc', c: 'c1', a: 'p2', b: 'p3' },
        { id: 'l2', kind: 'line', a: 'p3', b: 'p4' },
        { id: 'a2', kind: 'arc', c: 'c2', a: 'p4', b: 'p1' },
      ],
      constraints: [],
    };
    const b = build({ base: { kind: 'sketch', sketch: slot, op: 'extrude', depth: 2, angle: 360 }, ops: [] }, [30, 10, 2]);
    near(b.volume, (200 + Math.PI * 25) * 2);
  });
  it('revolves the part right of the axis', () => {
    const sq: Sketch = {
      points: [
        { id: 'a', x: 5, y: 0 },
        { id: 'b', x: 10, y: 0 },
        { id: 'c', x: 10, y: 10 },
        { id: 'd', x: 5, y: 10 },
      ],
      entities: [
        { id: 'l1', kind: 'line', a: 'a', b: 'b' },
        { id: 'l2', kind: 'line', a: 'b', b: 'c' },
        { id: 'l3', kind: 'line', a: 'c', b: 'd' },
        { id: 'l4', kind: 'line', a: 'd', b: 'a' },
      ],
      constraints: [],
    };
    const b = build({ base: { kind: 'sketch', sketch: sq, op: 'revolve', depth: 0, angle: 360 }, ops: [] }, [20, 20, 10]);
    near(b.volume, Math.PI * (100 - 25) * 10);
  });
});

describe('fillet and chamfer', () => {
  const topFrontEdge = (b: BrepBuild) =>
    edgesWhere(b, (e) => e.kind === 'line' && Math.abs(e.mid[1] + 1) < 1e-6 && Math.abs(e.mid[2] - 1) < 1e-6)[0];

  it('fillets exactly the chosen edge', () => {
    const base = build(prim('box'), [20, 20, 10]);
    const edge = topFrontEdge(base);
    expect(edge).toBeTruthy();
    const b = build({ ...prim('box'), ops: [{ id: 'f1', kind: 'fillet', edges: [edge], radius: 3 }] }, [20, 20, 10]);
    near(b.volume, 4000 - (9 - (Math.PI * 9) / 4) * 20, 1e-6);
    expect(b.edges).toHaveLength(15);
    expect(b.problems).toEqual([]);
  });

  it('chamfers the chosen edges', () => {
    const base = build(prim('box'), [20, 20, 10]);
    const vertical = edgesWhere(base, (e) => e.kind === 'line' && Math.abs(Math.abs(e.dir[2]) - 1) < 1e-6);
    expect(vertical).toHaveLength(4);
    const b = build({ ...prim('box'), ops: [{ id: 'c1', kind: 'chamfer', edges: vertical, distance: 2 }] }, [20, 20, 10]);
    near(b.volume, 4000 - 4 * 2 * 10, 1e-6);
  });

  it('finds the same edge after the box is resized', () => {
    const edge = topFrontEdge(build(prim('box'), [20, 20, 10]));
    const b = build({ ...prim('box'), ops: [{ id: 'f1', kind: 'fillet', edges: [edge], radius: 3 }] }, [40, 30, 12]);
    near(b.volume, 40 * 30 * 12 - (9 - (Math.PI * 9) / 4) * 40, 1e-6);
  });

  it('applies operations in order (chamfer after fillet)', () => {
    const base = build(prim('box'), [20, 20, 10]);
    const edge = topFrontEdge(base);
    const vertical = edgesWhere(base, (e) => e.kind === 'line' && Math.abs(Math.abs(e.dir[2]) - 1) < 1e-6 && e.mid[1] > 0);
    const b = build(
      {
        ...prim('box'),
        ops: [
          { id: 'f1', kind: 'fillet', edges: [edge], radius: 3 },
          { id: 'c1', kind: 'chamfer', edges: vertical, distance: 1 },
        ],
      },
      [20, 20, 10],
    );
    expect(b.problems).toEqual([]);
    near(b.volume, 4000 - (9 - (Math.PI * 9) / 4) * 20 - 2 * 0.5 * 10, 1e-6);
  });

  it('reports an impossible fillet and keeps the solid', () => {
    const edge = topFrontEdge(build(prim('box'), [20, 20, 10]));
    const b = build({ ...prim('box'), ops: [{ id: 'f1', kind: 'fillet', edges: [edge], radius: 30 }] }, [20, 20, 10]);
    expect(b.problems).toEqual([expect.objectContaining({ id: 'f1', reason: 'failed' })]);
    near(b.volume, 4000);
  });

  it('never guesses an edge that no longer exists', () => {
    const ghost: EdgeRef = { kind: 'circle', mid: [0, 0, 1], dir: [0, 0, 1], radius: 0.5 };
    const b = build({ ...prim('box'), ops: [{ id: 'f1', kind: 'fillet', edges: [ghost], radius: 1 }] }, [20, 20, 10]);
    expect(b.problems).toEqual([expect.objectContaining({ id: 'f1', reason: 'missing-edges' })]);
    expect(b.edges).toHaveLength(12);
  });

  it('suppressed operations are skipped', () => {
    const edge = topFrontEdge(build(prim('box'), [20, 20, 10]));
    const b = build({ ...prim('box'), ops: [{ id: 'f1', kind: 'fillet', edges: [edge], radius: 3, suppressed: true }] }, [20, 20, 10]);
    near(b.volume, 4000);
  });

  it('fillets a circular edge of a cylinder', () => {
    const base = build(prim('cylinder'), [20, 20, 10]);
    const top = edgesWhere(base, (e) => e.kind === 'circle' && e.mid[2] > 0.5);
    expect(top).toHaveLength(1);
    const b = build({ ...prim('cylinder'), ops: [{ id: 'f', kind: 'fillet', edges: top, radius: 2 }] }, [20, 20, 10]);
    // Pappus: removed area (1 − π/4)·r² revolved at its centroid radius.
    const rr = 2;
    const area = (1 - Math.PI / 4) * rr * rr;
    // The removed region's centroid lies r·(10 − 3π)/(12 − 3π) in from the corner (at radius 10).
    const centroid = 10 - rr * ((10 - 3 * Math.PI) / (12 - 3 * Math.PI));
    near(b.volume, Math.PI * 1000 - 2 * Math.PI * centroid * area, 1e-4);
  });
});

describe('edge matching and validation', () => {
  it('matches by kind and position, and rejects distant edges', () => {
    const a: EdgeRef = { kind: 'line', mid: [0, -1, 1], dir: [1, 0, 0], radius: 0 };
    const b: EdgeRef = { kind: 'line', mid: [0, 1, 1], dir: [1, 0, 0], radius: 0 };
    expect(matchEdges([a], [b, { ...a, mid: [0.001, -1, 1] }])).toEqual([1]);
    expect(matchEdges([a], [b])).toEqual([-1]);
    expect(matchEdges([a], [{ ...a, kind: 'circle' }])).toEqual([-1]);
  });
  it('validates recipes from files', () => {
    expect(validateRecipe(prim('box'))).toBeNull();
    expect(validateRecipe(prim('teapot'))).toMatch(/Unknown/);
    expect(validateRecipe({ ...prim('box'), ops: [{ id: 'x', kind: 'fillet', edges: [], radius: 1 }] })).toMatch(/no valid edges/);
    expect(
      validateRecipe({
        ...prim('box'),
        ops: [{ id: 'x', kind: 'fillet', edges: [{ kind: 'line', mid: [0, 0, 0], dir: [1, 0, 0], radius: 0 }], radius: -1 }],
      }),
    ).toMatch(/positive/);
  });
});
