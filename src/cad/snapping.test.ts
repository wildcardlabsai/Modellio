import * as THREE from 'three';
import { smartSnap } from './snapping';

const box = (x0: number, y0: number, x1: number, y1: number) => new THREE.Box3(new THREE.Vector3(x0, y0, 0), new THREE.Vector3(x1, y1, 10));

describe('smart snapping', () => {
  const other = box(30, 0, 50, 20);

  it('snaps an edge to a neighbour edge within the threshold and reports a guide', () => {
    // moving box 0..10 moved by +19.2 → max at 29.2, neighbour min at 30
    const r = smartSnap(box(0, 40, 10, 50), [other], new THREE.Vector3(19.2, 0, 0), 1.5);
    expect(r.delta.x).toBeCloseTo(20);
    expect(r.guides).toHaveLength(1);
    expect(r.guides[0].axis).toBe(0);
    expect(r.guides[0].value).toBeCloseTo(30);
  });

  it('snaps centres', () => {
    const r = smartSnap(box(0, 40, 10, 50), [other], new THREE.Vector3(34.6, 0, 0), 1.5); // centre 39.6 → 40
    expect(r.delta.x).toBeCloseTo(35);
  });

  it('leaves the move alone when nothing is close', () => {
    const r = smartSnap(box(0, 40, 10, 50), [other], new THREE.Vector3(5, 3, 0), 1.5);
    expect(r.delta.toArray()).toEqual([5, 3, 0]);
    expect(r.guides).toHaveLength(0);
  });

  it('snaps X and Y independently and picks the closest candidate', () => {
    const r = smartSnap(box(0, 0, 10, 10), [other, box(100, 19, 110, 29)], new THREE.Vector3(19.5, 9.4, 0), 1.5);
    expect(r.delta.x).toBeCloseTo(20); // max 29.5 → 30
    expect(r.delta.y).toBeCloseTo(9); // max 19.4 → 19 (closer than 20)
  });
});
