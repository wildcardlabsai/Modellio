import * as THREE from 'three';
import type { ManifoldToplevel } from 'manifold-3d';
import { geometryToMeshData, manifoldToMeshData, meshDataToManifold, type MeshData } from '../kernel/meshData';

export type MeshTool = 'repair' | 'simplify' | 'smooth' | 'subdivide';

/** Weld vertices closer than `tolerance` (mm) and drop degenerate triangles. */
export function weldMesh(mesh: MeshData, tolerance = 1e-3): MeshData {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const welded = geometryToMeshData(g, undefined, tolerance);
  g.dispose();
  const keep: number[] = [];
  const I = welded.indices;
  for (let t = 0; t < I.length; t += 3)
    if (I[t] !== I[t + 1] && I[t + 1] !== I[t + 2] && I[t] !== I[t + 2]) keep.push(I[t], I[t + 1], I[t + 2]);
  return { positions: welded.positions, indices: new Uint32Array(keep) };
}

/**
 * Mesh clean-up and reshaping on real mesh data, through the Manifold kernel:
 *  - repair:    weld near-duplicate vertices, drop degenerate triangles, rebuild as a manifold
 *  - simplify:  remove detail smaller than `amount` mm (decimate)
 *  - smooth:    round off edges sharper than 60° and subdivide `amount` times
 *  - subdivide: split every triangle into `amount`² smaller ones (shape unchanged)
 * Throws with a readable message when the mesh is not a closed solid (repair what it can first).
 */
export function applyMeshTool(k: ManifoldToplevel, mesh: MeshData, tool: MeshTool, amount: number): MeshData {
  const welded = weldMesh(mesh, tool === 'repair' ? Math.max(1e-4, amount) : 1e-5);
  let m;
  try {
    m = meshDataToManifold(k, welded);
  } catch {
    if (tool === 'repair') return welded;
    throw new Error('This mesh is not a closed solid, so it can’t be reshaped. Try Repair first.');
  }
  const owned = [m];
  try {
    if (m.status() !== 'NoError') {
      if (tool === 'repair') return welded;
      throw new Error('This mesh is not a closed solid, so it can’t be reshaped. Try Repair first.');
    }
    let out = m;
    if (tool === 'simplify') out = m.simplify(Math.max(0.001, amount));
    else if (tool === 'subdivide') out = m.refine(Math.max(2, Math.min(4, Math.round(amount))));
    else if (tool === 'smooth') {
      const s = m.smoothOut(60, 0);
      owned.push(s);
      out = s.refine(Math.max(2, Math.min(4, Math.round(amount))));
    }
    if (out !== m) owned.push(out);
    return manifoldToMeshData(out);
  } finally {
    for (const o of owned) o.delete();
  }
}

/**
 * Volume (mm³, from signed tetrahedra; always positive) and surface area (mm²) of a triangle mesh.
 * The volume is only meaningful for a closed mesh.
 */
export function meshMeasures(mesh: MeshData): { volume: number; area: number } {
  const P = mesh.positions;
  const I = mesh.indices;
  let six = 0;
  let twice = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3;
    const b = I[t + 1] * 3;
    const c = I[t + 2] * 3;
    const ax = P[a],
      ay = P[a + 1],
      az = P[a + 2];
    const bx = P[b] - ax,
      by = P[b + 1] - ay,
      bz = P[b + 2] - az;
    const cx = P[c] - ax,
      cy = P[c + 1] - ay,
      cz = P[c + 2] - az;
    const nx = by * cz - bz * cy;
    const ny = bz * cx - bx * cz;
    const nz = bx * cy - by * cx;
    twice += Math.hypot(nx, ny, nz);
    // Signed volume of the tetrahedron (origin, a, b, c) = a · ((b−a) × (c−a)) / 6.
    six += ax * nx + ay * ny + az * nz;
  }
  return { volume: Math.abs(six) / 6, area: twice / 2 };
}

/** Boundary and non-manifold edge counts: 0 and 0 means a closed, printable solid. */
export function meshReport(mesh: MeshData): { triangles: number; boundaryEdges: number; nonManifoldEdges: number } {
  const counts = new Map<string, number>();
  const I = mesh.indices;
  for (let t = 0; t < I.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = I[t + e];
      const b = I[t + ((e + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const c of counts.values()) {
    if (c === 1) boundaryEdges++;
    else if (c > 2) nonManifoldEdges++;
  }
  return { triangles: I.length / 3, boundaryEdges, nonManifoldEdges };
}
