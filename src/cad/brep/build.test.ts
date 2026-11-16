import { createRequire } from 'node:module';
import type * as Replicad from 'replicad';
import { AMBIGUOUS, buildBrep, matchEdges, matchFaces, NO_MATCH, sketchOutlines } from './build';
import { validateRecipe, type BooleanPart, type BrepBuild, type EdgeRef, type FaceRef, type FeatureRecipe } from './types';
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
  it('ignores the part of a revolved profile left of the axis (as the mesh engine does)', () => {
    const sq: Sketch = {
      points: [
        { id: 'a', x: -5, y: 0 },
        { id: 'b', x: 10, y: 0 },
        { id: 'c', x: 10, y: 10 },
        { id: 'd', x: -5, y: 10 },
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
    near(b.volume, Math.PI * 100 * 10);
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

  it('still applies a fillet saved before edges recorded their faces (MODELLIO 2.2 files)', () => {
    const base = build(prim('box'), [20, 20, 10]);
    const { faces: _faces, ...old } = topFrontEdge(base)!;
    expect(old).not.toHaveProperty('faces');
    const b = build({ ...prim('box'), ops: [{ id: 'f1', kind: 'fillet', edges: [old as EdgeRef], radius: 3 }] }, [20, 20, 10]);
    near(b.volume, 4000 - (9 - (Math.PI * 9) / 4) * 20, 1e-6);
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
  it('uses the faces on either side to tell apart edges in the same place', () => {
    const up: Vec3 = [0, 0, 1];
    const side: Vec3 = [0, -1, 0];
    const inward: Vec3 = [0, 1, 0];
    const outer: EdgeRef = { kind: 'line', mid: [0, -1, 1], dir: [1, 0, 0], radius: 0, faces: [side, up] };
    const inner: EdgeRef = { ...outer, mid: [0, -0.995, 1], faces: [inward, up] };
    expect(matchEdges([outer], [inner, outer])).toEqual([1]);
    expect(matchEdges([inner], [outer, inner])).toEqual([1]);
  });
  it('refuses to guess when two different edges fit equally well', () => {
    const ref: EdgeRef = { kind: 'line', mid: [0, 0, 1], dir: [1, 0, 0], radius: 0 };
    const left: EdgeRef = { ...ref, mid: [-0.008, 0, 1] };
    const right: EdgeRef = { ...ref, mid: [0.008, 0, 1] };
    expect(matchEdges([ref], [left, right])).toEqual([AMBIGUOUS]);
    // One clearly better candidate is not ambiguous.
    expect(matchEdges([ref], [{ ...ref, mid: [0.001, 0, 1] }, right])).toEqual([0]);
    // Two identical references (a circle's two halves) count as one.
    expect(matchEdges([ref], [left, left])).toEqual([0]);
    expect(matchEdges([ref], [{ ...ref, mid: [0.5, 0, 1] }])).toEqual([NO_MATCH]);
  });
  it('real edges carry both face normals and are found again after a resize', () => {
    const a = build(prim('box'), [20, 20, 20]);
    const b = build(prim('box'), [40, 10, 6]);
    expect(a.edges).toHaveLength(12);
    expect(a.edges.every((e) => e.ref.faces?.length === 2)).toBe(true);
    const hit = matchEdges(
      a.edges.map((e) => e.ref),
      b.edges.map((e) => e.ref),
    );
    expect(new Set(hit).size).toBe(12);
    expect(hit.every((i) => i >= 0)).toBe(true);
  });
  it('describes faces with their triangles, and finds them again after a resize', () => {
    const a = build(prim('cylinder'), [20, 20, 10]);
    // Two flat ends; the side is cylindrical (OpenCascade may split it into halves).
    expect(a.faces.filter((f) => f.ref.kind === 'plane')).toHaveLength(2);
    expect(a.faces.filter((f) => f.ref.kind !== 'plane').every((f) => f.ref.kind === 'cylinder')).toBe(true);
    // Every triangle belongs to exactly one face.
    expect(a.faces.reduce((n, f) => n + f.count, 0)).toBe(a.indices.length / 3);
    const top = a.faces.find((f) => f.ref.kind === 'plane' && f.ref.normal[2] > 0.9)!;
    expect(top.ref.centre[2]).toBeCloseTo(1, 6);
    const b = build(prim('cylinder'), [30, 30, 25]);
    const [i] = matchFaces(
      [top.ref],
      b.faces.map((f) => f.ref),
    );
    expect(b.faces[i].ref.normal[2]).toBeGreaterThan(0.9);
    // A box's faces are all planes with outward normals.
    const box = build(prim('box'), [20, 20, 20]);
    expect(box.faces).toHaveLength(6);
    for (const f of box.faces) expect(Math.hypot(...f.ref.centre.map((c, k) => c - f.ref.normal[k]))).toBeLessThan(1e-6);
  });
  it('refuses to guess between two equally good faces', () => {
    const ref: FaceRef = { kind: 'plane', centre: [0, 0, 1], normal: [0, 0, 1], area: 1 };
    expect(
      matchFaces(
        [ref],
        [
          { ...ref, centre: [-0.01, 0, 1] },
          { ...ref, centre: [0.01, 0, 1] },
        ],
      ),
    ).toEqual([AMBIGUOUS]);
    expect(matchFaces([ref], [{ ...ref, normal: [0, 0, -1] }])).toEqual([NO_MATCH]);
    expect(matchFaces([ref], [{ ...ref, kind: 'cylinder' }])).toEqual([NO_MATCH]);
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

describe('shell, draft and holes', () => {
  const faceWhere = (b: BrepBuild, pred: (f: FaceRef) => boolean) => b.faces.find((f) => pred(f.ref))!.ref;
  const top = (b: BrepBuild) => faceWhere(b, (f) => f.normal[2] > 0.99);
  const sides = (b: BrepBuild) => b.faces.filter((f) => Math.abs(f.ref.normal[2]) < 1e-6).map((f) => f.ref);

  it('shells a box inwards with the top left open', () => {
    const base = build(prim('box'), [20, 20, 10]);
    const b = build({ ...prim('box'), ops: [{ id: 's', kind: 'shell', thickness: 2, faces: [top(base)] }] }, [20, 20, 10]);
    near(b.volume, 4000 - 16 * 16 * 8, 1e-6);
    expect(b.size).toEqual([20, 20, 10]);
    expect(b.problems).toEqual([]);
  });

  it('tapers the side faces inwards going up from the bottom', () => {
    const base = build(prim('box'), [20, 20, 10]);
    const b = build({ ...prim('box'), ops: [{ id: 'd', kind: 'draft', angle: 5, faces: sides(base) }] }, [20, 20, 10]);
    // A frustum: 20 × 20 at the bottom, each side moved in by 10·tan 5° at the top.
    const t = 20 - 2 * 10 * Math.tan((5 * Math.PI) / 180);
    near(b.volume, (10 / 3) * (400 + t * t + 20 * t), 1e-5);
    expect(b.size[2]).toBeCloseTo(10, 6);
    expect(b.size[0]).toBeCloseTo(20, 6);
  });

  it('drills simple, counterbored and countersunk holes, blind or through', () => {
    const base = build(prim('box'), [20, 20, 10]);
    const at: Vec3 = [0, 0, 1];
    const hole = (spec: object) =>
      build({ ...prim('box'), ops: [{ id: 'h', kind: 'hole', face: top(base), at, hole: spec as never }] }, [20, 20, 10]);
    near(hole({ style: 'simple', diameter: 4, depth: 0 }).volume, 4000 - Math.PI * 4 * 10, 1e-6);
    near(hole({ style: 'simple', diameter: 4, depth: 6 }).volume, 4000 - Math.PI * 4 * 6, 1e-6);
    near(
      hole({ style: 'counterbore', diameter: 4, depth: 0, cbDiameter: 8, cbDepth: 3 }).volume,
      4000 - Math.PI * 16 * 3 - Math.PI * 4 * 7,
      1e-6,
    );
    // Countersink 90°: a cone from Ø8 at the surface down to Ø4, 2 mm deep, then the hole.
    const h = 2;
    const cone = (Math.PI * h * (16 + 4 + 8)) / 3;
    near(hole({ style: 'countersink', diameter: 4, depth: 0, csDiameter: 8, csAngle: 90 }).volume, 4000 - cone - Math.PI * 4 * 8, 1e-6);
  });

  it('repeats a hole in a row and round a circle', () => {
    const base = build(prim('box'), [40, 40, 10]);
    const ring = build(
      {
        ...prim('box'),
        ops: [
          {
            id: 'h',
            kind: 'hole',
            face: top(base),
            at: [0.5, 0, 1],
            hole: { style: 'simple', diameter: 2, depth: 0 },
            pattern: { kind: 'circular', count: 6, angle: 360, centre: [0, 0, 1] },
          },
        ],
      },
      [40, 40, 10],
    );
    near(ring.volume, 16000 - 6 * Math.PI * 10, 1e-6);
    const row = build(
      {
        ...prim('box'),
        ops: [
          {
            id: 'h',
            kind: 'hole',
            face: top(base),
            at: [-0.5, 0, 1],
            hole: { style: 'simple', diameter: 2, depth: 0 },
            pattern: { kind: 'linear', count: 3, spacing: 10, dir: [1, 0, 0] },
          },
        ],
      },
      [40, 40, 10],
    );
    near(row.volume, 16000 - 3 * Math.PI * 10, 1e-6);
  });

  it('keeps a hole on its face, in proportion, when the part is resized', () => {
    const base = build(prim('box'), [20, 20, 10]);
    const op = {
      id: 'h',
      kind: 'hole' as const,
      face: top(base),
      at: [0, 0, 1] as Vec3,
      hole: { style: 'simple' as const, diameter: 4, depth: 0 },
    };
    near(build({ ...prim('box'), ops: [op] }, [30, 25, 16]).volume, 30 * 25 * 16 - Math.PI * 4 * 16, 1e-6);
  });

  it('flags a shell that leaves nothing, and a hole whose face has gone, without changing the solid', () => {
    const base = build(prim('box'), [20, 20, 10]);
    const tooThick = build({ ...prim('box'), ops: [{ id: 's', kind: 'shell', thickness: 30, faces: [top(base)] }] }, [20, 20, 10]);
    expect(tooThick.problems.map((p) => p.reason)).toEqual(['failed']);
    near(tooThick.volume, 4000, 1e-6);
    const gone: FaceRef = { kind: 'plane', centre: [0, 0, 3], normal: [0, 0, 1], area: 1 };
    const b = build(
      { ...prim('box'), ops: [{ id: 'h', kind: 'hole', face: gone, at: [0, 0, 3], hole: { style: 'simple', diameter: 2, depth: 0 } }] },
      [20, 20, 10],
    );
    expect(b.problems.map((p) => p.reason)).toEqual(['missing-faces']);
    near(b.volume, 4000, 1e-6);
  });

  it('validates the new operations', () => {
    const f: FaceRef = { kind: 'plane', centre: [0, 0, 1], normal: [0, 0, 1], area: 1 };
    expect(validateRecipe({ ...prim('box'), ops: [{ id: 's', kind: 'shell', thickness: 1, faces: [f] }] })).toBeNull();
    expect(validateRecipe({ ...prim('box'), ops: [{ id: 's', kind: 'shell', thickness: 1, faces: [] }] })).toMatch(/open face/);
    expect(validateRecipe({ ...prim('box'), ops: [{ id: 'd', kind: 'draft', angle: 60, faces: [f] }] })).toMatch(/45/);
    expect(
      validateRecipe({
        ...prim('box'),
        ops: [
          {
            id: 'h',
            kind: 'hole',
            face: f,
            at: [0, 0, 1],
            hole: { style: 'counterbore', diameter: 4, depth: 0, cbDiameter: 3, cbDepth: 1 },
          },
        ],
      }),
    ).toMatch(/wider/);
  });
});

describe('exact Booleans', () => {
  const I = (x = 0, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  const part = (shape: string, size: Vec3, m = I(), hole = false, extra: Partial<BooleanPart> = {}): BooleanPart => ({
    name: shape,
    recipe: prim(shape),
    size,
    fit: size,
    matrix: m,
    hole,
    ...extra,
  });
  const combine = (parts: BooleanPart[], mode: 'union' | 'intersect' = 'union', ops: FeatureRecipe['ops'] = []) =>
    build({ base: { kind: 'boolean', mode, parts }, ops }, [0, 0, 0]);

  it('unites overlapping boxes and cuts a cylinder hole exactly', () => {
    near(combine([part('box', [20, 20, 10]), part('box', [20, 20, 10], I(10))]).volume, 30 * 20 * 10, 1e-6);
    near(combine([part('box', [20, 20, 10]), part('cylinder', [6, 6, 20], I(), true)]).volume, 4000 - Math.PI * 9 * 10, 1e-6);
  });

  it('intersects, and places rotated parts', () => {
    near(combine([part('box', [20, 20, 10]), part('box', [20, 20, 10], I(10))], 'intersect').volume, 10 * 20 * 10, 1e-6);
    // A 40 × 4 × 4 bar turned 90° about Z crosses another: a plus sign.
    const c = Math.cos(Math.PI / 2);
    const s = Math.sin(Math.PI / 2);
    const rot = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    near(combine([part('box', [40, 4, 4]), part('box', [40, 4, 4], rot)]).volume, 2 * 40 * 16 - 4 * 16, 1e-6);
  });

  it('refuses parts stretched unevenly (they cannot be exact) but accepts uniform scaling', () => {
    const sq: FeatureRecipe = {
      base: {
        kind: 'sketch',
        sketch: {
          points: [
            { id: 'a', x: 0, y: 0 },
            { id: 'b', x: 10, y: 0 },
            { id: 'c', x: 10, y: 10 },
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
        op: 'extrude',
        depth: 10,
        angle: 360,
      },
      ops: [],
    };
    const stretched: BooleanPart = { name: 'Sketch', recipe: sq, size: [0, 0, 0], fit: [20, 10, 10], matrix: I(), hole: false };
    expect(() => combine([stretched])).toThrow(/stretched unevenly/);
    near(combine([{ ...stretched, fit: [20, 20, 20] }]).volume, 8000, 1e-6);
  });

  it('nests combinations, and fillets the exact result', () => {
    const inner: BooleanPart = {
      name: 'inner',
      recipe: {
        base: { kind: 'boolean', mode: 'union', parts: [part('box', [20, 20, 10]), part('cylinder', [6, 6, 20], I(), true)] },
        ops: [],
      },
      size: [0, 0, 0],
      matrix: I(),
      hole: false,
    };
    near(combine([inner, part('box', [20, 20, 10], I(0, 0, 10))]).volume, 8000 - Math.PI * 9 * 10, 1e-6);
    // Fillet the top front edge of the exact result: (1 − π/4)·r²·L comes off.
    const plain = combine([part('box', [20, 20, 10]), part('box', [20, 20, 10], I(10))]);
    const edge = plain.edges.find((e) => e.ref.kind === 'line' && e.ref.mid[2] > 0.99 && e.ref.mid[1] < -0.99)!.ref;
    const f = combine([part('box', [20, 20, 10]), part('box', [20, 20, 10], I(10))], 'union', [
      { id: 'f', kind: 'fillet', edges: [edge], radius: 2 },
    ]);
    near(f.volume, 6000 - (1 - Math.PI / 4) * 4 * 30, 1e-5);
    expect(f.problems).toEqual([]);
  });

  it('mirrors a part like the display does', () => {
    near(combine([part('wedge', [20, 20, 10], I(), false, { mirror: [-1, 1, 1] })]).volume, 2000, 1e-6);
  });
});

describe('rollback', () => {
  it('builds only the operations before the marker', () => {
    const base = build(prim('box'), [20, 20, 10]);
    const top = base.faces.find((f) => f.ref.normal[2] > 0.99)!.ref;
    const hole = {
      id: 'h',
      kind: 'hole' as const,
      face: top,
      at: [0, 0, 1] as Vec3,
      hole: { style: 'simple' as const, diameter: 4, depth: 0 },
    };
    const shell = { id: 's', kind: 'shell' as const, thickness: 1, faces: [top] };
    near(build({ ...prim('box'), ops: [hole, shell], rollback: 1 }, [20, 20, 10]).volume, 4000 - Math.PI * 4 * 10, 1e-6);
    near(build({ ...prim('box'), ops: [hole, shell], rollback: 0 }, [20, 20, 10]).volume, 4000, 1e-6);
    expect(validateRecipe({ ...prim('box'), ops: [hole], rollback: 2 })).toMatch(/rollback/);
  });
});
