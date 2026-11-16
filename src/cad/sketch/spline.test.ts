import { describe, expect, it } from 'vitest';
import { extendSpline } from './edit';
import { solveSketch } from './solver';
import { sketchOutlines } from './outline';
import type { Sketch } from './types';

let n = 0;
const id = (p: string) => `${p}${n++}`;
const anchorsAt = (pts: [number, number][]): Sketch => ({
  points: pts.map(([x, y], i) => ({ id: `p${i}`, x, y })),
  entities: [],
  constraints: [],
});
const cross = (s: Sketch, point: string, h1: string, h2: string) => {
  const P = (k: string) => s.points.find((p) => p.id === k)!;
  const [p, a, b] = [P(point), P(h1), P(h2)];
  return (a.x - p.x) * (b.y - p.y) - (a.y - p.y) * (b.x - p.x);
};

describe('drawing splines', () => {
  it('chains Bézier segments through every anchor, smooth at the joins', () => {
    let s = anchorsAt([
      [0, 0],
      [10, 8],
      [20, 0],
      [30, 6],
    ]);
    const anchors = ['p0'];
    for (const next of ['p1', 'p2', 'p3']) {
      s = extendSpline(s, anchors, next, id);
      anchors.push(next);
    }
    const bez = s.entities.filter((e) => e.kind === 'bezier');
    expect(bez).toHaveLength(3);
    const smooth = s.constraints.filter((c) => c.kind === 'smooth');
    expect(smooth.map((c) => c.kind === 'smooth' && c.point)).toEqual(['p1', 'p2']);
    // Handles are lined up through the joins already, so solving moves nothing.
    for (const c of smooth) if (c.kind === 'smooth') expect(Math.abs(cross(s, c.point, c.h1, c.h2))).toBeLessThan(1e-9);
    const solved = solveSketch(s);
    expect(solved.status.kind).toBe('under');
    expect(solved.sketch.points).toEqual(s.points);
    expect(sketchOutlines(s).open).toBe(1);
  });

  it('closing on the first anchor makes a closed, smooth outline', () => {
    let s = anchorsAt([
      [0, 0],
      [10, -6],
      [20, 0],
      [10, 6],
    ]);
    const anchors = ['p0'];
    for (const next of ['p1', 'p2', 'p3', 'p0']) {
      s = extendSpline(s, anchors, next, id);
      if (next !== 'p0') anchors.push(next);
    }
    const smooth = s.constraints.filter((c) => c.kind === 'smooth');
    expect(smooth).toHaveLength(4);
    for (const c of smooth) if (c.kind === 'smooth') expect(Math.abs(cross(s, c.point, c.h1, c.h2))).toBeLessThan(1e-9);
    const o = sketchOutlines(s);
    expect(o.chains).toHaveLength(1);
    expect(o.chains[0].every((sg) => sg.kind === 'bezier')).toBe(true);
    expect(o.crossing).toBe(false);
  });

  it('moving an anchor keeps the joins smooth (the solver turns the handles)', () => {
    let s = anchorsAt([
      [0, 0],
      [10, 8],
      [20, 0],
    ]);
    s = extendSpline(s, ['p0'], 'p1', id);
    s = extendSpline(s, ['p0', 'p1'], 'p2', id);
    // Drag the middle handle's partner off line, as a drag of one handle would.
    const c = s.constraints.find((k) => k.kind === 'smooth')!;
    if (c.kind !== 'smooth') throw new Error();
    const moved = { ...s, points: s.points.map((p) => (p.id === c.h2 ? { ...p, y: p.y + 4 } : p)) };
    const solved = solveSketch(moved, [c.h2]).sketch;
    expect(Math.abs(cross(solved, c.point, c.h1, c.h2))).toBeLessThan(1e-6);
    // Only the other handle (and possibly the join) moved: the end anchors stay.
    const P = (k: string) => solved.points.find((p) => p.id === k)!;
    expect([P('p0').x, P('p0').y, P('p2').x, P('p2').y]).toEqual([0, 0, 20, 0]);
  });
});
