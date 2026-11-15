import { describe, expect, it } from 'vitest';
import { bezierAt, bezierPiece, curveOf, intersect, pointMap, segmentCurve } from './curves';
import { cornerAt, extendAt, offsetChain, trimAt } from './edit';
import { solveSketch } from './solver';
import type { Sketch, SketchEntity } from './types';

let k = 0;
const id = (p: string) => `${p}_${k++}`;
type P = [string, number, number, boolean?];
const sk = (points: P[], entities: SketchEntity[], constraints: Sketch['constraints'] = []): Sketch => ({
  points: points.map(([id, x, y, fixed]) => ({ id, x, y, ...(fixed ? { fixed } : {}) })),
  entities,
  constraints,
});
const L = (id: string, a: string, b: string): SketchEntity => ({ id, kind: 'line', a, b });
const pt = (s: Sketch, id: string) => {
  const p = s.points.find((q) => q.id === id)!;
  return [p.x, p.y];
};
const ends = (s: Sketch, lineId: string) => {
  const e = s.entities.find((x) => x.id === lineId)!;
  if (e.kind !== 'line') throw new Error('not a line');
  return [pt(s, e.a), pt(s, e.b)];
};
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason);
  return r as Extract<T, { ok: true }>;
};

describe('curve intersections', () => {
  it('line × line is exact', () => {
    const r = intersect(segmentCurve([0, 0], [10, 10]), segmentCurve([0, 10], [10, 0]));
    expect(r).toHaveLength(1);
    expect(r[0].p[0]).toBeCloseTo(5, 12);
    expect(r[0].t).toBeCloseTo(0.5, 12);
  });
  it('line × circle and circle × circle match the analytic answers', () => {
    const s = sk(
      [
        ['o', 0, 0],
        ['q', 6, 0],
      ],
      [
        { id: 'c1', kind: 'circle', c: 'o', r: 5 },
        { id: 'c2', kind: 'circle', c: 'q', r: 5 },
      ],
    );
    const pts = pointMap(s);
    const lc = intersect(segmentCurve([-10, 3], [10, 3]), curveOf(pts, s.entities[0])!);
    expect(lc.map((x) => +x.p[0].toFixed(9)).sort((a, b) => a - b)).toEqual([-4, 4]);
    const cc = intersect(curveOf(pts, s.entities[0])!, curveOf(pts, s.entities[1])!);
    expect(cc.map((x) => [+x.p[0].toFixed(9), +Math.abs(x.p[1]).toFixed(9)])).toEqual([
      [3, 4],
      [3, 4],
    ]);
  });
  it('a Bézier × a line lands exactly on the line', () => {
    const b = { at: (t: number) => bezierAt([0, 0], [3, 12], [9, -8], [12, 4], t), closed: false, n: 64 };
    const r = intersect(b, segmentCurve([-1, 1.5], [13, 1.5]));
    expect(r.length).toBeGreaterThanOrEqual(1);
    for (const x of r) expect(bezierAt([0, 0], [3, 12], [9, -8], [12, 4], x.t)[1]).toBeCloseTo(1.5, 10);
  });
  it('de Casteljau pieces trace the same curve', () => {
    const p: [number, number][] = [
      [0, 0],
      [3, 12],
      [9, -8],
      [12, 4],
    ];
    const q = bezierPiece(p as never, 0.25, 0.7);
    for (const s of [0, 0.3, 0.5, 1]) {
      const a = bezierAt(q[0], q[1], q[2], q[3], s);
      const b = bezierAt(p[0], p[1], p[2], p[3], 0.25 + 0.45 * s);
      expect(a[0]).toBeCloseTo(b[0], 10);
      expect(a[1]).toBeCloseTo(b[1], 10);
    }
  });
});

describe('trim', () => {
  const cross = () =>
    sk(
      [
        ['a', -10, 0],
        ['b', 10, 0],
        ['c', 0, -10],
        ['d', 0, 10],
      ],
      [L('h', 'a', 'b'), L('v', 'c', 'd')],
      [
        { id: 'H', kind: 'horizontal', line: 'h' },
        { id: 'len', kind: 'distance', line: 'h', value: 20 },
      ],
    );
  it('cuts a line back to the crossing, keeping what still holds and naming what was removed', () => {
    const r = ok(trimAt(cross(), 'h', [5, 0.1], id));
    expect(ends(r.sketch, 'h')).toEqual([
      [-10, 0],
      [0, 0],
    ]);
    expect(ends(r.sketch, 'v')).toEqual([
      [0, -10],
      [0, 10],
    ]);
    expect(r.sketch.constraints.map((c) => c.id)).toEqual(['H']);
    expect(r.message).toMatch(/1 constraint .* removed \(Length 20\.00 mm\)/);
  });
  it('removes the middle of a line between two crossings, leaving two pieces', () => {
    const s = sk(
      [
        ['a', -10, 0],
        ['b', 10, 0],
        ['c', -3, -5],
        ['d', -3, 5],
        ['e', 3, -5],
        ['f', 3, 5],
      ],
      [L('h', 'a', 'b'), L('v1', 'c', 'd'), L('v2', 'e', 'f')],
      [{ id: 'H', kind: 'horizontal', line: 'h' }],
    );
    const r = ok(trimAt(s, 'h', [0, 0], id));
    const lines = r.sketch.entities.filter((e) => e.kind === 'line' && e.id !== 'v1' && e.id !== 'v2');
    expect(lines).toHaveLength(2);
    const lens = lines.map((l) => ends(r.sketch, l.id)).map(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]));
    expect(lens.map((x) => +x.toFixed(9))).toEqual([7, 7]);
    // Both pieces are still horizontal.
    expect(r.sketch.constraints.filter((c) => c.kind === 'horizontal')).toHaveLength(2);
  });
  it('turns a circle into the arc on the far side of the click', () => {
    const s = sk(
      [
        ['o', 0, 0],
        ['a', -10, 0],
        ['b', 10, 0],
      ],
      [{ id: 'c', kind: 'circle', c: 'o', r: 5 }, L('h', 'a', 'b')],
    );
    const r = ok(trimAt(s, 'c', [0, 5], id));
    const arc = r.sketch.entities.find((e) => e.id === 'c')!;
    expect(arc.kind).toBe('arc');
    if (arc.kind !== 'arc') return;
    // Runs counter-clockwise from (−5, 0) under the bottom to (5, 0).
    expect(pt(r.sketch, arc.a).map((v) => +v.toFixed(9))).toEqual([-5, 0]);
    expect(pt(r.sketch, arc.b).map((v) => +v.toFixed(9))).toEqual([5, 0]);
  });
  it('refuses a circle with only one crossing, and removes a curve that crosses nothing', () => {
    const s = sk(
      [
        ['o', 0, 0],
        ['a', 0, 0],
        ['b', 10, 0],
        ['x', 20, 20],
        ['y', 30, 20],
      ],
      [{ id: 'c', kind: 'circle', c: 'o', r: 5 }, L('h', 'a', 'b'), L('far', 'x', 'y')],
    );
    expect(trimAt(s, 'c', [0, 5], id)).toMatchObject({ ok: false, reason: expect.stringMatching(/two crossings/) });
    const r = ok(trimAt(s, 'far', [25, 20], id));
    expect(r.sketch.entities.some((e) => e.id === 'far')).toBe(false);
    expect(r.sketch.points.some((p) => p.id === 'x')).toBe(false);
  });
  it('splits a Bézier exactly at the crossing', () => {
    const s = sk(
      [
        ['a', 0, 0],
        ['h1', 4, 10],
        ['h2', 8, 10],
        ['b', 12, 0],
        ['c', 6, -2],
        ['d', 6, 12],
      ],
      [{ id: 's', kind: 'bezier', a: 'a', b: 'b', c1: 'h1', c2: 'h2' }, L('v', 'c', 'd')],
    );
    const r = ok(trimAt(s, 's', [10, 4], id));
    const sp = r.sketch.entities.find((e) => e.id === 's')!;
    if (sp.kind !== 'bezier') throw new Error();
    const q = [sp.a, sp.c1, sp.c2, sp.b].map((p) => pt(r.sketch, p) as [number, number]);
    expect(q[3][0]).toBeCloseTo(6, 9);
    // The piece is the first half of the original curve (symmetric: the crossing is at t = 0.5).
    for (const t of [0.2, 0.6, 1]) {
      const a = bezierAt(q[0], q[1], q[2], q[3], t);
      const b = bezierAt([0, 0], [4, 10], [8, 10], [12, 0], 0.5 * t);
      expect(a[0]).toBeCloseTo(b[0], 9);
      expect(a[1]).toBeCloseTo(b[1], 9);
    }
  });
});

describe('extend', () => {
  const s = () =>
    sk(
      [
        ['a', 0, 0],
        ['b', 5, 0],
        ['c', 10, -5],
        ['d', 10, 5],
      ],
      [L('l', 'a', 'b'), L('w', 'c', 'd')],
      [{ id: 'len', kind: 'distance', line: 'l', value: 5 }],
    );
  it('runs a line on to the next curve it meets', () => {
    const r = ok(extendAt(s(), 'l', [4.5, 0]));
    expect(ends(r.sketch, 'l')).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(r.message).toMatch(/Length 5\.00 mm/);
  });
  it('refuses when nothing lies ahead, or when the end is joined', () => {
    expect(extendAt(s(), 'l', [0.5, 0])).toMatchObject({ ok: false, reason: expect.stringMatching(/nothing to extend to/) });
    const joined = s();
    joined.entities.push(L('m', 'b', 'c'));
    expect(extendAt(joined, 'l', [4.5, 0])).toMatchObject({ ok: false, reason: expect.stringMatching(/joined/) });
  });
});

describe('corner fillet and chamfer', () => {
  const rect = () =>
    sk(
      [
        ['p', 0, 0, true],
        ['q', 20, 0],
        ['r', 20, 10],
        ['s', 0, 10],
      ],
      [L('l1', 'p', 'q'), L('l2', 'q', 'r'), L('l3', 'r', 's'), L('l4', 's', 'p')],
      [
        { id: 'h1', kind: 'horizontal', line: 'l1' },
        { id: 'v1', kind: 'vertical', line: 'l2' },
        { id: 'h2', kind: 'horizontal', line: 'l3' },
        { id: 'v2', kind: 'vertical', line: 'l4' },
        { id: 'w', kind: 'distance', line: 'l1', value: 20 },
        { id: 'ht', kind: 'distance', line: 'l2', value: 10 },
      ],
    );
  it('a fillet is a tangent arc of the given radius; the outline stays closed and solvable', () => {
    const r = ok(cornerAt(rect(), 'r', 'fillet', 3, id));
    const arc = r.sketch.entities.find((e) => e.kind === 'arc')!;
    if (arc.kind !== 'arc') throw new Error();
    expect(pt(r.sketch, arc.c).map((v) => +v.toFixed(6))).toEqual([17, 7]);
    expect(solveSketch(r.sketch).status.kind).not.toBe('conflicting');
    expect(r.sketch.constraints.filter((c) => c.kind === 'tangent')).toHaveLength(2);
    // The old corner point is gone; the lengths that no longer hold are named.
    expect(r.sketch.points.some((p) => p.id === 'r')).toBe(false);
    expect(r.message).toMatch(/Length 10\.00 mm/);
  });
  it('a chamfer is a line the given distance back on each side', () => {
    const r = ok(cornerAt(rect(), 'r', 'chamfer', 2, id));
    const ch = r.sketch.entities[r.sketch.entities.length - 1];
    expect(ends(r.sketch, ch.id).map((p) => p.map((v) => +v.toFixed(6)))).toEqual([
      [20, 8],
      [18, 10],
    ]);
  });
  it('refuses a radius too big for the lines, and a point that is not a two-line corner', () => {
    expect(cornerAt(rect(), 'r', 'fillet', 12, id)).toMatchObject({ ok: false, reason: expect.stringMatching(/too big/) });
    const open = sk(
      [
        ['a', 0, 0],
        ['b', 5, 0],
      ],
      [L('l', 'a', 'b')],
    );
    expect(cornerAt(open, 'b', 'fillet', 1, id)).toMatchObject({ ok: false, reason: expect.stringMatching(/two lines/) });
  });
});

describe('offset', () => {
  const square = () =>
    sk(
      [
        ['a', 0, 0],
        ['b', 10, 0],
        ['c', 10, 10],
        ['d', 0, 10],
      ],
      [L('l1', 'a', 'b'), L('l2', 'b', 'c'), L('l3', 'c', 'd'), L('l4', 'd', 'a')],
    );
  const bounds = (s: Sketch, ids: string[]) => {
    const pts = s.entities.filter((e) => ids.includes(e.id)).flatMap((e) => (e.kind === 'line' ? [pt(s, e.a), pt(s, e.b)] : []));
    return [
      Math.min(...pts.map((p) => p[0])),
      Math.min(...pts.map((p) => p[1])),
      Math.max(...pts.map((p) => p[0])),
      Math.max(...pts.map((p) => p[1])),
    ].map((v) => +v.toFixed(9));
  };
  const added = (before: Sketch, after: Sketch) =>
    after.entities.filter((e) => !before.entities.some((b) => b.id === e.id)).map((e) => e.id);
  it('a positive distance offsets a closed chain outward, joined at the corners', () => {
    const s = square();
    const r = ok(offsetChain(s, ['l1', 'l2', 'l3', 'l4'], 2, id));
    const ids = added(s, r.sketch);
    expect(ids).toHaveLength(4);
    expect(bounds(r.sketch, ids)).toEqual([-2, -2, 12, 12]);
    expect(r.sketch.constraints.filter((c) => c.kind === 'parallel')).toHaveLength(4);
  });
  it('a negative distance offsets inward, and too far inward is refused', () => {
    const s = square();
    const r = ok(offsetChain(s, ['l1', 'l2', 'l3', 'l4'], -2, id));
    expect(bounds(r.sketch, added(s, r.sketch))).toEqual([2, 2, 8, 8]);
    expect(offsetChain(s, ['l1', 'l2', 'l3', 'l4'], -6, id)).toMatchObject({ ok: false, reason: expect.stringMatching(/too big/) });
  });
  it('a slot (lines and arcs) offsets with concentric arcs on the same centres', () => {
    const s = sk(
      [
        ['a', 0, 0],
        ['b', 20, 0],
        ['c', 20, 10],
        ['d', 0, 10],
        ['k1', 20, 5],
        ['k2', 0, 5],
      ],
      [
        L('l1', 'a', 'b'),
        { id: 'r', kind: 'arc', c: 'k1', a: 'b', b: 'c' },
        L('l2', 'c', 'd'),
        { id: 'q', kind: 'arc', c: 'k2', a: 'd', b: 'a' },
      ],
    );
    const r = ok(offsetChain(s, ['l1', 'r', 'l2', 'q'], 1, id));
    const arcs = r.sketch.entities.filter((e) => e.kind === 'arc' && e.id !== 'r' && e.id !== 'q');
    expect(arcs).toHaveLength(2);
    for (const a of arcs) {
      if (a.kind !== 'arc') continue;
      expect(['k1', 'k2']).toContain(a.c);
      const [c, p] = [pt(r.sketch, a.c), pt(r.sketch, a.a)];
      expect(Math.hypot(p[0] - c[0], p[1] - c[1])).toBeCloseTo(6, 9);
    }
  });
  it('refuses splines (no exact offset) and offsets a circle concentrically', () => {
    const s = sk(
      [
        ['a', 0, 0],
        ['h', 1, 1],
        ['g', 2, 1],
        ['b', 3, 0],
        ['o', 10, 10],
      ],
      [
        { id: 's', kind: 'bezier', a: 'a', b: 'b', c1: 'h', c2: 'g' },
        { id: 'c', kind: 'circle', c: 'o', r: 4 },
      ],
    );
    expect(offsetChain(s, ['s'], 1, id)).toMatchObject({ ok: false, reason: expect.stringMatching(/Splines/) });
    const r = ok(offsetChain(s, ['c'], 1.5, id));
    const c2 = r.sketch.entities.find((e) => e.kind === 'circle' && e.id !== 'c');
    expect(c2).toMatchObject({ c: 'o', r: 5.5 });
    expect(offsetChain(s, ['c'], -5, id)).toMatchObject({ ok: false });
  });
});
