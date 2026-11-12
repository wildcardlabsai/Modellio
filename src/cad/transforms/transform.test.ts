import * as THREE from 'three';
import { matrixToTransform, transformToMatrix, worldBounds, dropToWorkplaneZ } from './transform';
import type { Transform } from '@/types/document';

describe('transform conversions', () => {
  it('round-trips position and rotation through a matrix', () => {
    const t: Transform = { position: [12.5, -3, 40], rotation: [30, -45, 90] };
    const back = matrixToTransform(transformToMatrix(t));
    expect(back.position).toEqual(t.position);
    back.rotation.forEach((v, i) => expect(v).toBeCloseTo(t.rotation[i], 3));
  });

  it('uses Z-up: rotating 90° about Z maps +X to +Y', () => {
    const m = transformToMatrix({ position: [0, 0, 0], rotation: [0, 0, 90] });
    const v = new THREE.Vector3(1, 0, 0).applyMatrix4(m);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
  });

  it('computes world bounds of a rotated object', () => {
    const b = worldBounds({ size: [40, 10, 10], transform: { position: [0, 0, 5], rotation: [0, 0, 90] } });
    const s = b.getSize(new THREE.Vector3());
    expect(s.x).toBeCloseTo(10);
    expect(s.y).toBeCloseTo(40);
    expect(b.min.z).toBeCloseTo(0);
  });

  it('computes the Z that rests an object on the workplane', () => {
    expect(dropToWorkplaneZ({ size: [10, 10, 30], transform: { position: [0, 0, 100], rotation: [0, 0, 0] } })).toBeCloseTo(15);
    expect(dropToWorkplaneZ({ size: [10, 10, 30], transform: { position: [0, 0, 100], rotation: [90, 0, 0] } })).toBeCloseTo(5);
  });
});
