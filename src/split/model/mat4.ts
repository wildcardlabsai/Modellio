import type { Mat4 } from './types';

/** Column-major 4×4 helpers (same layout as THREE.Matrix4.elements), kept dependency-free for the worker. */
export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** a · b (apply b first, then a). */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  return out;
}

export function applyToPoint(m: Mat4, x: number, y: number, z: number, out: number[] = [0, 0, 0]): number[] {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

export function determinant3(m: Mat4): number {
  return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
}

/** Uniform scale factor if the linear part is a similarity (rotation × uniform scale), else null. */
export function uniformScale(m: Mat4, eps = 1e-6): number | null {
  const col = (i: number) => [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]];
  const [a, b, c] = [col(0), col(1), col(2)];
  const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const s = len(a);
  if (Math.abs(len(b) - s) > eps * Math.max(1, s) || Math.abs(len(c) - s) > eps * Math.max(1, s)) return null;
  const tol = eps * Math.max(1, s * s);
  if (Math.abs(dot(a, b)) > tol || Math.abs(dot(a, c)) > tol || Math.abs(dot(b, c)) > tol) return null;
  return s;
}
