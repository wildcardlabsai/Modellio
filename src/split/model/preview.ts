import type { PreviewBuffers } from './types';

const CREASE_COS = Math.cos((32 * Math.PI) / 180);

/**
 * Render-ready buffers for a mesh: triangles ordered by material (stable counting sort),
 * non-indexed positions, and creased normals (smooth across gentle curvature, sharp at
 * edges sharper than 32°). Pure typed-array code, so it runs in a worker in O(n).
 */
export function buildPreviewBuffers(vertices: Float32Array, triangles: Uint32Array, materialIds: Uint32Array): PreviewBuffers {
  const n = materialIds.length;
  const nv = vertices.length / 3;
  // Face normals (unit) and area-weighted vertex normals.
  const fn = new Float32Array(n * 3);
  const vn = new Float32Array(nv * 3);
  for (let t = 0; t < n; t++) {
    const a = triangles[t * 3] * 3;
    const b = triangles[t * 3 + 1] * 3;
    const c = triangles[t * 3 + 2] * 3;
    const ux = vertices[b] - vertices[a];
    const uy = vertices[b + 1] - vertices[a + 1];
    const uz = vertices[b + 2] - vertices[a + 2];
    const wx = vertices[c] - vertices[a];
    const wy = vertices[c + 1] - vertices[a + 1];
    const wz = vertices[c + 2] - vertices[a + 2];
    const x = uy * wz - uz * wy;
    const y = uz * wx - ux * wz;
    const z = ux * wy - uy * wx;
    for (const v of [a, b, c]) {
      vn[v] += x;
      vn[v + 1] += y;
      vn[v + 2] += z;
    }
    const l = Math.hypot(x, y, z) || 1;
    fn[t * 3] = x / l;
    fn[t * 3 + 1] = y / l;
    fn[t * 3 + 2] = z / l;
  }
  for (let v = 0; v < nv * 3; v += 3) {
    const l = Math.hypot(vn[v], vn[v + 1], vn[v + 2]) || 1;
    vn[v] /= l;
    vn[v + 1] /= l;
    vn[v + 2] /= l;
  }
  // Order by material.
  let max = 0;
  for (let t = 0; t < n; t++) if (materialIds[t] > max) max = materialIds[t];
  const starts = new Uint32Array(max + 2);
  for (let t = 0; t < n; t++) starts[materialIds[t] + 1]++;
  for (let m = 1; m < starts.length; m++) starts[m] += starts[m - 1];
  const cursor = starts.slice();
  const positions = new Float32Array(n * 9);
  const normals = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const o = cursor[materialIds[t]]++ * 9;
    for (let k = 0; k < 3; k++) {
      const v = triangles[t * 3 + k] * 3;
      positions[o + k * 3] = vertices[v];
      positions[o + k * 3 + 1] = vertices[v + 1];
      positions[o + k * 3 + 2] = vertices[v + 2];
      const dot = fn[t * 3] * vn[v] + fn[t * 3 + 1] * vn[v + 1] + fn[t * 3 + 2] * vn[v + 2];
      const src = dot >= CREASE_COS ? vn : fn;
      const si = dot >= CREASE_COS ? v : t * 3;
      normals[o + k * 3] = src[si];
      normals[o + k * 3 + 1] = src[si + 1];
      normals[o + k * 3 + 2] = src[si + 2];
    }
  }
  const groups: number[] = [];
  for (let m = 0; m <= max; m++) {
    const count = starts[m + 1] - starts[m];
    if (count > 0) groups.push(starts[m], count, m);
  }
  return { positions, normals, groups: new Uint32Array(groups) };
}
