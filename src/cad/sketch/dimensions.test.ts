import { describe, expect, it } from 'vitest';
import { dimensionMarks } from './dimensions';
import type { Sketch } from './types';

const s: Sketch = {
  points: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 10, y: 0 },
    { id: 'c', x: 10, y: 10 },
    { id: 'o', x: 30, y: 0 },
  ],
  entities: [
    { id: 'l1', kind: 'line', a: 'a', b: 'b' },
    { id: 'l2', kind: 'line', a: 'b', b: 'c' },
    { id: 'k', kind: 'circle', c: 'o', r: 4 },
  ],
  constraints: [
    { id: 'len', kind: 'distance', line: 'l1', value: 10 },
    { id: 'dia', kind: 'radius', entity: 'k', value: 4 },
    { id: 'ang', kind: 'angle', l1: 'l1', l2: 'l2', value: 90 },
    { id: 'px', kind: 'pointX', point: 'c', value: 10 },
    { id: 'h', kind: 'horizontal', line: 'l1' },
  ],
};

describe('on-canvas dimensions', () => {
  const marks = dimensionMarks(s, 2);
  const by = (id: string) => marks.find((m) => m.id === id)!;
  it('draws one dimension per dimensional constraint (not for plain constraints)', () => {
    expect(marks.map((m) => m.id)).toEqual(['len', 'dia', 'ang', 'px']);
  });
  it('a length is an offset line beside the edge, labelled with its value', () => {
    const m = by('len');
    expect(m.text).toBe('10');
    // Parallel to the edge, 2 units away on the side away from the rest of the sketch (−y).
    expect(m.lines[2]).toEqual([
      [0, -2],
      [10, -2],
    ]);
    expect(m.at[1]).toBeLessThan(-2);
  });
  it('places lengths outside a closed outline, whichever way it was drawn', () => {
    for (const order of [
      ['a', 'b', 'c'],
      ['a', 'c', 'b'],
    ]) {
      const tri: Sketch = {
        points: [
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 12, y: 0 },
          { id: 'c', x: 6, y: 9 },
        ],
        entities: order.map((p, i) => ({ id: `l${i}`, kind: 'line' as const, a: p, b: order[(i + 1) % 3] })),
        constraints: order.map((_, i) => ({ id: `d${i}`, kind: 'distance' as const, line: `l${i}`, value: 10 })),
      };
      for (const m of dimensionMarks(tri, 1)) {
        // Label further from the triangle's centre than its edge's middle is.
        const e = tri.entities.find((x) => `d${x.id.slice(1)}` === m.id)!;
        if (e.kind !== 'line') throw new Error();
        const P = (k: string) => tri.points.find((p) => p.id === k)!;
        const mid = [(P(e.a).x + P(e.b).x) / 2, (P(e.a).y + P(e.b).y) / 2];
        const c = [6, 3];
        expect(Math.hypot(m.at[0] - c[0], m.at[1] - c[1])).toBeGreaterThan(Math.hypot(mid[0] - c[0], mid[1] - c[1]));
      }
    }
  });
  it('a radius constraint shows and takes a diameter', () => {
    const m = by('dia');
    expect(m.text).toBe('⌀8');
    expect(m.shown).toBe(8);
    expect(m.toValue(12)).toBe(6);
    expect(m.toValue(0)).toBeNull();
  });
  it('an angle is an arc at the corner, in degrees', () => {
    const m = by('ang');
    expect(m.text).toBe('90°');
    expect(m.unit).toBe('°');
    // The arc is centred on the corner (10, 0).
    for (const [p] of m.lines) expect(Math.hypot(p[0] - 10, p[1])).toBeCloseTo(5, 6);
  });
  it('refuses lengths that are not positive', () => {
    expect(by('len').toValue(-1)).toBeNull();
    expect(by('px').toValue(-5)).toBe(-5);
  });
});
