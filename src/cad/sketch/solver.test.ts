import { describe, expect, it } from 'vitest';
import { solveSketch, tryConstraint } from './solver';
import type { Constraint, Sketch, SketchEntity } from './types';

type P = [string, number, number, boolean?];
const sk = (points: P[], entities: SketchEntity[], constraints: Constraint[] = []): Sketch => ({
  points: points.map(([id, x, y, fixed]) => ({ id, x, y, ...(fixed ? { fixed } : {}) })),
  entities,
  constraints,
});
const pt = (s: Sketch, id: string) => s.points.find((p) => p.id === id)!;
const dist = (s: Sketch, a: string, b: string) => Math.hypot(pt(s, a).x - pt(s, b).x, pt(s, a).y - pt(s, b).y);
const line = (id: string, a: string, b: string): SketchEntity => ({ id, kind: 'line', a, b });

describe('new sketch constraints', () => {
  it('tangent: a line touches a circle', () => {
    const s = sk(
      [
        ['a', -20, 7, true],
        ['b', 20, 6],
        ['c', 0, 0, true],
      ],
      [line('l', 'a', 'b'), { id: 'k', kind: 'circle', c: 'c', r: 5 }],
      [
        { id: 'r', kind: 'radius', entity: 'k', value: 5 },
        { id: 't', kind: 'tangent', e1: 'l', e2: 'k' },
      ],
    );
    const out = solveSketch(s).sketch;
    const a = pt(out, 'a');
    const b = pt(out, 'b');
    const d = Math.abs((b.x - a.x) * (0 - a.y) - (b.y - a.y) * (0 - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
    expect(d).toBeCloseTo(5, 6);
  });

  it('tangent at a shared end: a line continues smoothly into an arc', () => {
    // Arc around (0,0) from (10,0) counter-clockwise; line arriving at (10,0) from below-left.
    const s = sk(
      [
        ['o', 0, 0, true],
        ['p', 10, 0, true],
        ['q', 0, 10],
        ['s', 6, -8],
      ],
      [line('l', 's', 'p'), { id: 'arc', kind: 'arc', a: 'p', b: 'q', c: 'o' }],
      [{ id: 't', kind: 'tangent', e1: 'l', e2: 'arc', at: 'p' }],
    );
    const out = solveSketch(s).sketch;
    // The line must be vertical at (10, 0) (perpendicular to the radius).
    expect(pt(out, 's').x).toBeCloseTo(10, 6);
  });

  it('two circles touch outside, or inside', () => {
    const base = (inside: boolean) =>
      sk(
        [
          ['c1', 0, 0, true],
          ['c2', 12, 3],
        ],
        [
          { id: 'k1', kind: 'circle', c: 'c1', r: 5 },
          { id: 'k2', kind: 'circle', c: 'c2', r: 3 },
        ],
        [
          { id: 'r1', kind: 'radius', entity: 'k1', value: 5 },
          { id: 'r2', kind: 'radius', entity: 'k2', value: 3 },
          { id: 't', kind: 'tangent', e1: 'k1', e2: 'k2', inside },
        ],
      );
    expect(dist(solveSketch(base(false)).sketch, 'c1', 'c2')).toBeCloseTo(8, 6);
    expect(dist(solveSketch(base(true)).sketch, 'c1', 'c2')).toBeCloseTo(2, 6);
  });

  it('concentric, midpoint, point on line and point on circle', () => {
    const s = sk(
      [
        ['c1', 0, 0, true],
        ['c2', 3, 2],
        ['a', 0, 0, true],
        ['b', 20, 0, true],
        ['m', 7, 4],
        ['p', 5, 9],
        ['q', 30, 30],
      ],
      [{ id: 'k1', kind: 'circle', c: 'c1', r: 5 }, { id: 'k2', kind: 'circle', c: 'c2', r: 8 }, line('l', 'a', 'b')],
      [
        { id: 'r1', kind: 'radius', entity: 'k1', value: 5 },
        { id: 'cc', kind: 'concentric', e1: 'k1', e2: 'k2' },
        { id: 'mid', kind: 'midpoint', point: 'm', line: 'l' },
        { id: 'on', kind: 'pointOnLine', point: 'p', line: 'l' },
        { id: 'oc', kind: 'pointOnCurve', point: 'q', entity: 'k1' },
      ],
    );
    const out = solveSketch(s).sketch;
    expect(dist(out, 'c1', 'c2')).toBeCloseTo(0, 6);
    expect(pt(out, 'm').x).toBeCloseTo(10, 6);
    expect(pt(out, 'm').y).toBeCloseTo(0, 6);
    expect(pt(out, 'p').y).toBeCloseTo(0, 6);
    expect(dist(out, 'q', 'c1')).toBeCloseTo(5, 6);
  });

  it('symmetric about a line, an angle, and distances', () => {
    const s = sk(
      [
        ['o', 0, 0, true],
        ['y', 0, 10, true],
        ['u', -4, 3],
        ['v', 6, 1],
        ['e', 10, 0, true],
        ['f', 7, 9],
        ['g', 30, 5],
      ],
      [line('axis', 'o', 'y'), line('l1', 'o', 'e'), line('l2', 'o', 'f')],
      [
        { id: 'sym', kind: 'symmetric', a: 'u', b: 'v', line: 'axis' },
        { id: 'ang', kind: 'angle', l1: 'l1', l2: 'l2', value: 30 },
        { id: 'pd', kind: 'pointDistance', a: 'o', b: 'f', value: 12 },
        { id: 'pl', kind: 'pointLineDistance', point: 'g', line: 'l1', value: 4 },
      ],
    );
    const out = solveSketch(s).sketch;
    expect(pt(out, 'u').x).toBeCloseTo(-pt(out, 'v').x, 6);
    expect(pt(out, 'u').y).toBeCloseTo(pt(out, 'v').y, 6);
    const f = pt(out, 'f');
    expect((Math.atan2(f.y, f.x) * 180) / Math.PI).toBeCloseTo(30, 5);
    expect(dist(out, 'o', 'f')).toBeCloseTo(12, 6);
    expect(Math.abs(pt(out, 'g').y)).toBeCloseTo(4, 6);
  });

  it('smooth: a spline’s handles line up through its anchor', () => {
    const s = sk(
      [
        ['a', 0, 0, true],
        ['h1', -5, 2, true],
        ['h2', 4, 3],
      ],
      [],
      [{ id: 's', kind: 'smooth', point: 'a', h1: 'h1', h2: 'h2' }],
    );
    const out = solveSketch(s).sketch;
    const h2 = pt(out, 'h2');
    expect(h2.x * 2 - h2.y * -5).toBeCloseTo(0, 6); // cross((−5,2),(h2)) = 0
  });
});

describe('conflicts, redundancy and leaving unrelated geometry alone', () => {
  const square = (): Sketch =>
    sk(
      [
        ['a', 0, 0, true],
        ['b', 10, 0],
        ['c', 10, 10],
        ['d', 0, 10],
        ['x', 50, 50],
        ['y', 70, 55],
      ],
      [line('l1', 'a', 'b'), line('l2', 'b', 'c'), line('l3', 'c', 'd'), line('l4', 'd', 'a'), line('other', 'x', 'y')],
      [
        { id: 'h1', kind: 'horizontal', line: 'l1' },
        { id: 'v1', kind: 'vertical', line: 'l2' },
        { id: 'h2', kind: 'horizontal', line: 'l3' },
        { id: 'v2', kind: 'vertical', line: 'l4' },
        { id: 'len', kind: 'distance', line: 'l1', value: 10 },
      ],
    );

  it('names the constraints a conflict comes from', () => {
    const s = square();
    s.constraints.push({ id: 'bad', kind: 'pointDistance', a: 'a', b: 'b', value: 25 });
    const r = solveSketch(s, [], { diagnose: true });
    expect(r.status.kind).toBe('conflicting');
    const culprits = (r.status as { culprits?: string[] }).culprits!;
    expect(culprits).toContain('bad');
    expect(culprits).toContain('len');
    expect(culprits).not.toContain('v2');
  });

  it('refuses a constraint that would conflict, saying with what, and changes nothing', () => {
    const s = solveSketch(square()).sketch;
    const r = tryConstraint(s, { id: 'bad', kind: 'pointDistance', a: 'a', b: 'b', value: 25 });
    expect(r.ok).toBe(false);
    expect((r as { culprits: string[] }).culprits).toContain('len');
    expect(s.constraints.some((c) => c.id === 'bad')).toBe(false);
  });

  it('a new constraint never moves geometry it is not connected to', () => {
    const s = solveSketch(square()).sketch;
    const r = tryConstraint(s, { id: 'len2', kind: 'distance', line: 'l2', value: 20 });
    expect(r.ok).toBe(true);
    const out = (r as { result: { sketch: Sketch } }).result.sketch;
    expect(dist(out, 'b', 'c')).toBeCloseTo(20, 6);
    expect(pt(out, 'x')).toEqual(pt(s, 'x'));
    expect(pt(out, 'y')).toEqual(pt(s, 'y'));
  });

  it('reports redundant constraints and which they are', () => {
    const s = square();
    s.constraints.push({ id: 'again', kind: 'parallel', l1: 'l1', l2: 'l3' });
    const r = solveSketch(s, [], { diagnose: true });
    expect(r.status.kind).toBe('over');
    expect((r.status as { culprits?: string[] }).culprits).toContain('again');
  });

  it('solves a 200-entity sketch quickly', () => {
    // 50 independent constrained rectangles (200 lines).
    const points: P[] = [];
    const entities: SketchEntity[] = [];
    const constraints: Constraint[] = [];
    for (let i = 0; i < 50; i++) {
      const o = i * 30;
      const ids = ['a', 'b', 'c', 'd'].map((k) => `${k}${i}`);
      points.push([ids[0], o, 0, true], [ids[1], o + 11, 1], [ids[2], o + 9, 12], [ids[3], o - 1, 9]);
      for (let k = 0; k < 4; k++) entities.push(line(`l${i}_${k}`, ids[k], ids[(k + 1) % 4]));
      constraints.push(
        { id: `h${i}`, kind: 'horizontal', line: `l${i}_0` },
        { id: `v${i}`, kind: 'vertical', line: `l${i}_1` },
        { id: `h2${i}`, kind: 'horizontal', line: `l${i}_2` },
        { id: `v2${i}`, kind: 'vertical', line: `l${i}_3` },
        { id: `w${i}`, kind: 'distance', line: `l${i}_0`, value: 20 },
        { id: `t${i}`, kind: 'distance', line: `l${i}_1`, value: 10 },
      );
    }
    const t = performance.now();
    const r = solveSketch(sk(points, entities, constraints));
    const ms = performance.now() - t;
    expect(r.status.kind).toBe('fully');
    expect(ms).toBeLessThan(100);
  });
});
