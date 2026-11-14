import { describe, expect, it } from 'vitest';
import { initKernel } from '../kernel/kernel';
import { validatePart } from '@/split/geometry/split';
import { solveSketch } from './solver';
import { buildProfileMesh, sketchLoops } from './profile';
import type { Sketch } from './types';

/** A rough rectangle drawn by hand: corners near (0,0), (40,1), (41,22), (-1,20). */
function rough(): Sketch {
  return {
    points: [
      { id: 'p0', x: 0, y: 0 },
      { id: 'p1', x: 40, y: 1 },
      { id: 'p2', x: 41, y: 22 },
      { id: 'p3', x: -1, y: 20 },
    ],
    entities: [
      { id: 'l0', kind: 'line', a: 'p0', b: 'p1' },
      { id: 'l1', kind: 'line', a: 'p1', b: 'p2' },
      { id: 'l2', kind: 'line', a: 'p2', b: 'p3' },
      { id: 'l3', kind: 'line', a: 'p3', b: 'p0' },
    ],
    constraints: [],
  };
}
const len = (s: Sketch, a: string, b: string) => {
  const p = s.points.find((x) => x.id === a)!;
  const q = s.points.find((x) => x.id === b)!;
  return Math.hypot(q.x - p.x, q.y - p.y);
};

describe('sketch constraints', () => {
  it('an unconstrained quadrilateral has 8 degrees of freedom', () => {
    expect(solveSketch(rough()).status).toEqual({ kind: 'under', dof: 8 });
  });

  it('horizontal/vertical, two lengths and a fixed corner make it a fully constrained 50 × 30 rectangle', () => {
    const s = rough();
    s.points[0].fixed = true;
    s.constraints = [
      { id: 'c0', kind: 'horizontal', line: 'l0' },
      { id: 'c1', kind: 'vertical', line: 'l1' },
      { id: 'c2', kind: 'horizontal', line: 'l2' },
      { id: 'c3', kind: 'vertical', line: 'l3' },
      { id: 'c4', kind: 'distance', line: 'l0', value: 50 },
      { id: 'c5', kind: 'distance', line: 'l1', value: 30 },
    ];
    const r = solveSketch(s);
    expect(r.status).toEqual({ kind: 'fully' });
    expect(len(r.sketch, 'p0', 'p1')).toBeCloseTo(50, 5);
    expect(len(r.sketch, 'p1', 'p2')).toBeCloseTo(30, 5);
    expect(len(r.sketch, 'p2', 'p3')).toBeCloseTo(50, 5);
    expect(r.sketch.points[1].y).toBeCloseTo(0, 5);
  });

  it('flags repeated constraints as over-constrained and impossible ones as conflicting', () => {
    const s = rough();
    s.constraints = [
      { id: 'c0', kind: 'horizontal', line: 'l0' },
      { id: 'c1', kind: 'horizontal', line: 'l0' },
    ];
    expect(solveSketch(s).status.kind).toBe('over');
    s.constraints = [
      { id: 'c0', kind: 'horizontal', line: 'l0' },
      { id: 'c1', kind: 'vertical', line: 'l0' },
      { id: 'c2', kind: 'distance', line: 'l0', value: 20 },
    ];
    expect(solveSketch(s).status.kind).toBe('conflicting');
  });

  it('parallel, perpendicular and equal hold after solving', () => {
    const s = rough();
    s.constraints = [
      { id: 'a', kind: 'parallel', l1: 'l0', l2: 'l2' },
      { id: 'b', kind: 'perpendicular', l1: 'l0', l2: 'l1' },
      { id: 'c', kind: 'equal', l1: 'l0', l2: 'l1' },
    ];
    const r = solveSketch(s).sketch;
    expect(len(r, 'p0', 'p1')).toBeCloseTo(len(r, 'p1', 'p2'), 4);
    const d0 = [r.points[1].x - r.points[0].x, r.points[1].y - r.points[0].y];
    const d1 = [r.points[2].x - r.points[1].x, r.points[2].y - r.points[1].y];
    expect(d0[0] * d1[0] + d0[1] * d1[1]).toBeCloseTo(0, 3);
  });

  it('keeps a dragged (pinned) point where it is', () => {
    const s = rough();
    s.points[2] = { ...s.points[2], x: 60, y: 40 };
    s.constraints = [{ id: 'c0', kind: 'horizontal', line: 'l1' }];
    const r = solveSketch(s, ['p2']).sketch;
    expect(r.points[2]).toMatchObject({ x: 60, y: 40 });
    expect(r.points[1].y).toBeCloseTo(40, 5);
  });
});

describe('profiles', () => {
  it('extrudes a closed sketch with a hole (even-odd) into a watertight solid', async () => {
    const s = rough();
    s.points.push({ id: 'c', x: 20, y: 10 });
    s.entities.push({ id: 'h', kind: 'circle', c: 'c', r: 4 });
    const { loops, open } = sketchLoops(s);
    expect(loops).toHaveLength(2);
    expect(open).toBe(0);
    const mesh = buildProfileMesh(await initKernel(), s, { kind: 'extrude', depth: 5, angle: 360 })!;
    const r = validatePart(mesh);
    expect(r.watertight).toBe(true);
    // Shoelace area of the rough quad minus the circle, times the depth.
    const q = s.points.slice(0, 4);
    let area = 0;
    for (let i = 0; i < 4; i++) area += q[i].x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * q[i].y;
    expect(r.volume).toBeCloseTo((Math.abs(area) / 2 - Math.PI * 16) * 5, -1);
  });

  it('revolves a profile around the Y axis into a ring', async () => {
    const s: Sketch = {
      points: [
        { id: 'a', x: 10, y: 0 },
        { id: 'b', x: 14, y: 0 },
        { id: 'c', x: 14, y: 6 },
        { id: 'd', x: 10, y: 6 },
      ],
      entities: [
        { id: '1', kind: 'line', a: 'a', b: 'b' },
        { id: '2', kind: 'line', a: 'b', b: 'c' },
        { id: '3', kind: 'line', a: 'c', b: 'd' },
        { id: '4', kind: 'line', a: 'd', b: 'a' },
      ],
      constraints: [],
    };
    const r = validatePart(buildProfileMesh(await initKernel(), s, { kind: 'revolve', depth: 0, angle: 360 })!);
    expect(r.watertight).toBe(true);
    expect(r.volume).toBeCloseTo(Math.PI * (14 * 14 - 10 * 10) * 6, -2);
  });

  it('builds outlines with arcs walked in either direction, and reports open chains', () => {
    const s: Sketch = {
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 20, y: 0 },
        { id: 'c', x: 10, y: 0 },
      ],
      entities: [
        { id: 'l', kind: 'line', a: 'a', b: 'b' },
        { id: 'arc', kind: 'arc', a: 'b', b: 'a', c: 'c' },
      ],
      constraints: [],
    };
    const { loops, open } = sketchLoops(s);
    expect(loops).toHaveLength(1);
    expect(open).toBe(0);
    let area = 0;
    const L = loops[0];
    for (let i = 0; i < L.length; i++) area += L[i][0] * L[(i + 1) % L.length][1] - L[(i + 1) % L.length][0] * L[i][1];
    expect(Math.abs(area / 2)).toBeCloseTo((Math.PI * 100) / 2, 0);
    expect(sketchLoops({ ...s, entities: [s.entities[0]] }).open).toBe(1);
  });
});
