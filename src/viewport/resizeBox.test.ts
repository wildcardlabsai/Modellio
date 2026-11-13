import * as THREE from 'three';
import { resizeBox } from './ResizeHandles';

const start = new THREE.Box3(new THREE.Vector3(-10, -5, 0), new THREE.Vector3(10, 5, 8));
const h = (x: number, y: number, z: 0 | 1 = 0) => ({ key: 'h', x, y, z });

describe('one-sided resize', () => {
  it('+X edge: min X fixed, only X changes', () => {
    const b = resizeBox(start, h(1, 0), new THREE.Vector3(25, 99, 0), false, 0);
    expect(b.min.x).toBe(-10);
    expect(b.max.x).toBe(25);
    expect([b.min.y, b.max.y, b.max.z]).toEqual([-5, 5, 8]);
  });

  it('−Y edge: max Y fixed', () => {
    const b = resizeBox(start, h(0, -1), new THREE.Vector3(0, -20, 0), false, 0);
    expect(b.max.y).toBe(5);
    expect(b.min.y).toBe(-20);
  });

  it('corner resizes X and Y, anchoring the opposite corner, and snaps to the grid', () => {
    const b = resizeBox(start, h(-1, 1), new THREE.Vector3(-20.4, 9.7, 0), false, 1);
    expect(b.max.x).toBe(10); // anchored
    expect(b.min.y).toBe(-5); // anchored
    expect(b.max.x - b.min.x).toBe(30); // 30.4 → 30
    expect(b.max.y - b.min.y).toBe(15); // 14.7 → 15
  });

  it('top handle sets the height from the bottom', () => {
    const b = resizeBox(start, h(0, 0, 1), new THREE.Vector3(0, 0, 20), false, 0);
    expect([b.min.z, b.max.z]).toEqual([0, 20]);
  });

  it('uniform: every axis scales by the dragged factor, X/Y centred when not dragged', () => {
    const b = resizeBox(start, h(1, 0), new THREE.Vector3(30, 0, 0), true, 0); // X 20 → 40 (×2)
    const s = b.getSize(new THREE.Vector3());
    expect(s.toArray()).toEqual([40, 20, 16]);
    expect(b.min.x).toBe(-10);
    expect((b.min.y + b.max.y) / 2).toBe(0);
    expect(b.min.z).toBe(0);
  });

  it('never inverts or collapses to zero', () => {
    const b = resizeBox(start, h(1, 0), new THREE.Vector3(-50, 0, 0), false, 0);
    expect(b.max.x - b.min.x).toBeGreaterThan(0);
  });
});
