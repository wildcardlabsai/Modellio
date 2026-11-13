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

/** Rotation taking unit vector `from` onto unit vector `to` (Rodrigues), as a column-major 4×4. */
export function rotationBetween(from: [number, number, number], to: [number, number, number]): Mat4 {
  const [ax, ay, az] = from;
  const [bx, by, bz] = to;
  const c = ax * bx + ay * by + az * bz;
  let kx = ay * bz - az * by;
  let ky = az * bx - ax * bz;
  let kz = ax * by - ay * bx;
  const s = Math.hypot(kx, ky, kz);
  if (s < 1e-12) {
    if (c > 0) return [...IDENTITY];
    // Opposite: rotate 180° about any axis perpendicular to `from`.
    const p = Math.abs(ax) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    kx = ay * p[2] - az * p[1];
    ky = az * p[0] - ax * p[2];
    kz = ax * p[1] - ay * p[0];
    const l = Math.hypot(kx, ky, kz);
    return axisAngle([kx / l, ky / l, kz / l], Math.PI);
  }
  return axisAngle([kx / s, ky / s, kz / s], Math.atan2(s, c));
}

export function axisAngle([x, y, z]: [number, number, number], angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y + s * z,
    t * x * z - s * y,
    0,
    t * x * y - s * z,
    t * y * y + c,
    t * y * z + s * x,
    0,
    t * x * z + s * y,
    t * y * z - s * x,
    t * z * z + c,
    0,
    0,
    0,
    0,
    1,
  ];
}

export function translation(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/** Apply a transform to every vertex (returns a new array). */
export function transformPositions(m: Mat4, p: Float32Array): Float32Array {
  const out = new Float32Array(p.length);
  const q = [0, 0, 0];
  for (let i = 0; i < p.length; i += 3) {
    applyToPoint(m, p[i], p[i + 1], p[i + 2], q);
    out[i] = q[0];
    out[i + 1] = q[1];
    out[i + 2] = q[2];
  }
  return out;
}
