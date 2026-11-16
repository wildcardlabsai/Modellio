import { describe, expect, it } from 'vitest';
import { constraintRefs, describeConstraint, nameConstraints } from './describe';
import { mergePoints } from './edit';
import type { Sketch } from './types';

const sk = (): Sketch => ({
  points: [
    { id: 'p1', x: 0, y: 0 },
    { id: 'p2', x: 10, y: 0 },
    { id: 'p3', x: 10, y: 0.2 },
    { id: 'p4', x: 10, y: 10 },
  ],
  entities: [
    { id: 'l1', kind: 'line', a: 'p1', b: 'p2' },
    { id: 'l2', kind: 'line', a: 'p3', b: 'p4' },
    { id: 'l3', kind: 'line', a: 'p2', b: 'p3' },
  ],
  constraints: [
    { id: 'c1', kind: 'horizontal', line: 'l1' },
    { id: 'c2', kind: 'distance', line: 'l3', value: 0.2 },
    { id: 'c3', kind: 'pointDistance', a: 'p2', b: 'p3', value: 0.2 },
    { id: 'c4', kind: 'angle', l1: 'l1', l2: 'l2', value: 90 },
  ],
});

describe('constraint descriptions', () => {
  it('names constraints for messages', () => {
    const s = sk();
    expect(nameConstraints(s, ['c1'])).toBe('Horizontal');
    expect(nameConstraints(s, ['c1', 'c4'])).toBe('Horizontal and Angle 90.0°');
    expect(nameConstraints(s, ['c1', 'c2', 'c4'])).toBe('Horizontal, Length 0.20 mm and Angle 90.0°');
    expect(nameConstraints(s, [])).toBe('the existing constraints');
  });
  it('lists every reference of the new kinds', () => {
    expect(constraintRefs({ id: 'x', kind: 'symmetric', a: 'p1', b: 'p2', line: 'l1' })).toEqual(['p1', 'p2', 'l1']);
    expect(constraintRefs({ id: 'x', kind: 'tangent', e1: 'l1', e2: 'o1', at: 'p1' })).toEqual(['l1', 'o1', 'p1']);
    expect(describeConstraint({ id: 'x', kind: 'tangent', e1: 'a', e2: 'b', inside: true })).toBe('Tangent (inside)');
  });
});

describe('mergePoints', () => {
  it('joins two points, dropping the collapsed line and its constraints', () => {
    const m = mergePoints(sk(), 'p2', 'p3');
    expect(m.points.map((p) => p.id)).toEqual(['p1', 'p2', 'p4']);
    expect(m.entities.map((e) => e.id)).toEqual(['l1', 'l2']);
    expect(m.entities.find((e) => e.id === 'l2')).toMatchObject({ a: 'p2', b: 'p4' });
    // The length of the collapsed line and the distance between the merged points go; the rest stay.
    expect(m.constraints.map((c) => c.id)).toEqual(['c1', 'c4']);
  });
});
