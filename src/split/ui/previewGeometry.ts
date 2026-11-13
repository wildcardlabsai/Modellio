import * as THREE from 'three';
import { meshDataToGeometry } from '@/cad/kernel/meshData';
import type { ThreeMFDocument, ThreeMFMesh } from '../model/types';

/**
 * Preview geometry for one mesh object: triangles are ordered by material (counting sort,
 * stable) and each run becomes a geometry group whose materialIndex is the document's
 * material ID. The source mesh is not modified.
 */
export function buildPreviewGeometry(mesh: ThreeMFMesh): THREE.BufferGeometry {
  const ids = mesh.perTriangleMaterialIds;
  const n = ids.length;
  let max = 0;
  for (let t = 0; t < n; t++) if (ids[t] > max) max = ids[t];
  const counts = new Uint32Array(max + 2);
  for (let t = 0; t < n; t++) counts[ids[t] + 1]++;
  for (let m = 1; m < counts.length; m++) counts[m] += counts[m - 1];
  const starts = counts.slice(0, max + 1);
  const order = new Uint32Array(n);
  const cursor = starts.slice();
  for (let t = 0; t < n; t++) order[cursor[ids[t]]++] = t;
  const indices = new Uint32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = order[i];
    indices[i * 3] = mesh.triangles[t * 3];
    indices[i * 3 + 1] = mesh.triangles[t * 3 + 1];
    indices[i * 3 + 2] = mesh.triangles[t * 3 + 2];
  }
  // Creased normals de-index in triangle order, so group ranges stay valid.
  const g = meshDataToGeometry({ positions: mesh.vertices, indices });
  for (let m = 0; m <= max; m++) {
    const count = (m < max ? starts[m + 1] : n) - starts[m];
    if (count > 0) g.addGroup(starts[m] * 3, count * 3, m);
  }
  return g;
}

/** World-space bounds of every placed triangle (optionally only those of one material). */
export function placedBounds(doc: ThreeMFDocument, materialId?: number): THREE.Box3 {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  for (const inst of doc.instances) {
    const mesh = doc.objects[inst.objectIndex].mesh;
    if (!mesh) continue;
    m.fromArray(inst.transform);
    const { vertices, triangles, perTriangleMaterialIds: ids } = mesh;
    if (materialId === undefined) {
      for (let i = 0; i < vertices.length; i += 3) box.expandByPoint(v.set(vertices[i], vertices[i + 1], vertices[i + 2]).applyMatrix4(m));
      continue;
    }
    for (let t = 0; t < ids.length; t++) {
      if (ids[t] !== materialId) continue;
      for (let k = 0; k < 3; k++) {
        const i = triangles[t * 3 + k] * 3;
        box.expandByPoint(v.set(vertices[i], vertices[i + 1], vertices[i + 2]).applyMatrix4(m));
      }
    }
  }
  return box;
}
