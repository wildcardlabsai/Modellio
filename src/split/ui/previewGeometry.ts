import * as THREE from 'three';
import type { PreviewBuffers, ThreeMFDocument, ThreeMFMesh } from '../model/types';
import { buildPreviewBuffers } from '../model/preview';

/** Geometry from render-ready buffers; each material run becomes a group (materialIndex = material ID). */
export function geometryFromPreview(p: PreviewBuffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(p.normals, 3));
  for (let i = 0; i < p.groups.length; i += 3) g.addGroup(p.groups[i] * 3, p.groups[i + 1] * 3, p.groups[i + 2]);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Preview geometry for a mesh object (buffers built by the import worker when available). */
export function buildPreviewGeometry(mesh: ThreeMFMesh): THREE.BufferGeometry {
  return geometryFromPreview(mesh.preview ?? buildPreviewBuffers(mesh.vertices, mesh.triangles, mesh.perTriangleMaterialIds));
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
