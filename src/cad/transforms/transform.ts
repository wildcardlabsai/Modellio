import * as THREE from 'three';
import type { ShapeObject, Transform, Vec3 } from '@/types/document';
import { DEG2RAD, RAD2DEG, normalizeDegrees, roundTo } from '@/utils/math';

/** Convert a document transform to a Three.js matrix (no scale; size lives in the geometry). */
export function transformToMatrix(t: Transform, target = new THREE.Matrix4()): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(eulerFromDegrees(t.rotation));
  return target.compose(new THREE.Vector3(...t.position), q, new THREE.Vector3(1, 1, 1));
}

export function eulerFromDegrees(r: Vec3): THREE.Euler {
  return new THREE.Euler(r[0] * DEG2RAD, r[1] * DEG2RAD, r[2] * DEG2RAD, 'XYZ');
}

export function degreesFromQuaternion(q: THREE.Quaternion): Vec3 {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [normalizeDegrees(e.x * RAD2DEG), normalizeDegrees(e.y * RAD2DEG), normalizeDegrees(e.z * RAD2DEG)];
}

/** Decompose a rigid matrix into a clean document transform (rounded to remove float noise). */
export function matrixToTransform(m: THREE.Matrix4): Transform {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  return {
    position: [roundTo(p.x), roundTo(p.y), roundTo(p.z)],
    rotation: degreesFromQuaternion(q),
  };
}

/** The 8 corners of an object's local bounding box. */
export function localCorners(size: Vec3): THREE.Vector3[] {
  const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const out: THREE.Vector3[] = [];
  for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

/** Axis-aligned world bounding box of a shape's oriented bounding box. */
export function worldBounds(obj: Pick<ShapeObject, 'size' | 'transform'>): THREE.Box3 {
  const m = transformToMatrix(obj.transform);
  const box = new THREE.Box3();
  for (const c of localCorners(obj.size)) box.expandByPoint(c.applyMatrix4(m));
  return box;
}

/** Z offset that places an object's lowest point exactly on the workplane. */
export function dropToWorkplaneZ(obj: Pick<ShapeObject, 'size' | 'transform'>): number {
  const b = worldBounds(obj);
  return roundTo(obj.transform.position[2] - b.min.z);
}
