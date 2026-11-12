import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';

/**
 * Plain, renderer-independent triangle mesh: welded vertices + indices (mm).
 * This is the interchange format between the CAD kernel, the asset store,
 * rendering and (Phase 4) file export.
 */
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Convert any BufferGeometry into welded MeshData, optionally transformed.
 * Improper transforms (reflections) reverse winding so faces stay outward.
 */
export function geometryToMeshData(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4, tolerance = 1e-4): MeshData {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geometry.getAttribute('position').clone());
  if (geometry.index) g.setIndex(geometry.index.clone());
  if (matrix) g.applyMatrix4(matrix);
  const welded = mergeVertices(g, tolerance);
  g.dispose();
  const pos = welded.getAttribute('position').array as Float32Array;
  const idx = welded.index!;
  const indices = new Uint32Array(idx.count);
  for (let i = 0; i < idx.count; i++) indices[i] = idx.getX(i);
  if (matrix && matrix.determinant() < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
  }
  const positions = new Float32Array(pos);
  welded.dispose();
  return { positions, indices };
}

export function meshDataToManifold(k: ManifoldToplevel, data: MeshData): Manifold {
  const mesh = new k.Mesh({ numProp: 3, vertProperties: data.positions, triVerts: data.indices });
  mesh.merge();
  return new k.Manifold(mesh);
}

export function manifoldToMeshData(m: Manifold): MeshData {
  const mesh = m.getMesh();
  const n = mesh.numProp;
  const count = mesh.vertProperties.length / n;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = mesh.vertProperties[i * n];
    positions[i * 3 + 1] = mesh.vertProperties[i * n + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * n + 2];
  }
  return { positions, indices: new Uint32Array(mesh.triVerts) };
}

/**
 * Renderable geometry from MeshData. Normals use a crease angle so curved
 * surfaces render smooth while machined edges stay sharp.
 */
export function meshDataToGeometry(data: MeshData, creaseAngle = (32 * Math.PI) / 180): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.positions.slice(), 3));
  g.setIndex(new THREE.BufferAttribute(data.indices.slice(), 1));
  const out = toCreasedNormals(g, creaseAngle);
  if (out !== g) g.dispose();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

export function meshDataBounds(data: MeshData): THREE.Box3 {
  const b = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < data.positions.length; i += 3) b.expandByPoint(v.set(data.positions[i], data.positions[i + 1], data.positions[i + 2]));
  return b;
}

/** Translate a mesh so its bounding box is centred on the origin. Returns the original centre. */
export function centerMeshData(data: MeshData): { mesh: MeshData; center: THREE.Vector3; size: THREE.Vector3 } {
  const b = meshDataBounds(data);
  const c = b.getCenter(new THREE.Vector3());
  const positions = new Float32Array(data.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = data.positions[i] - c.x;
    positions[i + 1] = data.positions[i + 1] - c.y;
    positions[i + 2] = data.positions[i + 2] - c.z;
  }
  return { mesh: { positions, indices: data.indices }, center: c, size: b.getSize(new THREE.Vector3()) };
}
