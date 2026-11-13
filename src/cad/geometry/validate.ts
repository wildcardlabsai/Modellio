import * as THREE from 'three';

export interface MeshReport {
  triangles: number;
  vertices: number;
  /** Every edge is shared by exactly two triangles with opposite orientation. */
  watertight: boolean;
  boundaryEdges: number;
  nonManifoldEdges: number;
  /** Signed volume in mm³ (positive ⇒ outward-facing normals). */
  volume: number;
}

/**
 * Analyse a triangle mesh. Vertices are welded by position (tolerance in mm)
 * so UV / normal seams do not count as holes. Degenerate triangles are ignored.
 * Used by tests now and by Boolean / export validation later.
 */
export function analyzeMesh(geometry: THREE.BufferGeometry, tolerance = 1e-4): MeshReport {
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const triCount = index ? index.count / 3 : pos.count / 3;
  const key = (i: number) =>
    `${Math.round(pos.getX(i) / tolerance)},${Math.round(pos.getY(i) / tolerance)},${Math.round(pos.getZ(i) / tolerance)}`;

  const weld = new Map<string, number>();
  const remap = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    let id = weld.get(k);
    if (id === undefined) {
      id = weld.size;
      weld.set(k, id);
    }
    remap[i] = id;
  }

  const directed = new Map<string, number>();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  let volume = 0;
  let triangles = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const v = [remap[i0], remap[i1], remap[i2]];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue; // degenerate
    triangles++;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    volume += a.dot(b.clone().cross(c)) / 6;
    for (let e = 0; e < 3; e++) {
      const k = `${v[e]}>${v[(e + 1) % 3]}`;
      directed.set(k, (directed.get(k) ?? 0) + 1);
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const [k, count] of directed) {
    const [from, to] = k.split('>');
    const reverse = directed.get(`${to}>${from}`) ?? 0;
    if (count > 1 || reverse > 1) nonManifoldEdges++;
    else if (reverse === 0) boundaryEdges++;
  }

  return {
    triangles,
    vertices: weld.size,
    watertight: boundaryEdges === 0 && nonManifoldEdges === 0,
    boundaryEdges,
    nonManifoldEdges,
    volume,
  };
}
