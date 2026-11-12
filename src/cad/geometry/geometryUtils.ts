import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec3 } from '@/types/document';

/** Minimum dimension (mm) any object may have. Prevents degenerate geometry. */
export const MIN_DIMENSION = 0.01;

/**
 * Translate and scale a geometry so its bounding box is centred on the origin
 * and exactly `size` millimetres. Normals are transformed with the correct
 * normal matrix by `applyMatrix4`, so non-uniform scaling shades correctly.
 */
export function fitToSize(geometry: THREE.BufferGeometry, size: Vec3): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const center = box.getCenter(new THREE.Vector3());
  const extent = box.getSize(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  const sx = extent.x > 1e-9 ? size[0] / extent.x : 1;
  const sy = extent.y > 1e-9 ? size[1] / extent.y : 1;
  const sz = extent.z > 1e-9 ? size[2] / extent.z : 1;
  if (sx !== 1 || sy !== 1 || sz !== 1) geometry.scale(sx, sy, sz);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Rotate a Three.js Y-axis primitive so that its axis points along +Z. */
export function yUpToZUp(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  return geometry.rotateX(Math.PI / 2);
}

/**
 * Build a flat-shaded closed polyhedron from vertices and polygonal faces.
 * Faces must be convex and wound counter-clockwise when seen from outside.
 */
export function polyhedron(vertices: Vec3[], faces: number[][]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const face of faces) {
    for (let i = 1; i < face.length - 1; i++) {
      for (const idx of [face[0], face[i], face[i + 1]]) {
        const v = vertices[idx];
        positions.push(v[0], v[1], v[2]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals(); // non-indexed ⇒ per-face (flat) normals
  return geometry;
}

/** Reverse the winding order and normals of a geometry (turn it inside out). */
export function flipGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const index = geometry.getIndex();
  if (index) {
    const arr = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
    index.needsUpdate = true;
  } else {
    const pos = geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) swapVertex(geometry, i + 1, i + 2);
  }
  const normal = geometry.getAttribute('normal');
  if (normal) {
    for (let i = 0; i < normal.count; i++) {
      normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
    }
    normal.needsUpdate = true;
  }
  return geometry;
}

function swapVertex(geometry: THREE.BufferGeometry, a: number, b: number) {
  for (const name of Object.keys(geometry.attributes)) {
    const attr = geometry.getAttribute(name) as THREE.BufferAttribute;
    for (let c = 0; c < attr.itemSize; c++) {
      const t = attr.getComponent(a, c);
      attr.setComponent(a, c, attr.getComponent(b, c));
      attr.setComponent(b, c, t);
    }
  }
}

/** Merge geometries after normalising them to a common attribute layout. */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = parts.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    for (const name of Object.keys(ng.attributes)) {
      if (name !== 'position' && name !== 'normal') ng.deleteAttribute(name);
    }
    if (!ng.getAttribute('normal')) ng.computeVertexNormals();
    return ng;
  });
  const merged = mergeGeometries(prepared, false);
  prepared.forEach((g) => g.dispose());
  if (!merged) throw new Error('Failed to merge geometry parts');
  return merged;
}

/**
 * Reflect a geometry across its local axes (signs of ±1). Positions and normals
 * are transformed by the reflection, and when the reflection is improper
 * (odd number of flips) the triangle winding is reversed so faces still point
 * outwards and the mesh remains a valid, positively-oriented solid.
 */
export function mirrorGeometry(geometry: THREE.BufferGeometry, signs: Vec3): THREE.BufferGeometry {
  if (signs[0] === 1 && signs[1] === 1 && signs[2] === 1) return geometry;
  geometry.scale(signs[0], signs[1], signs[2]);
  const improper = signs[0] * signs[1] * signs[2] < 0;
  if (improper) {
    // Reverse winding only: normals were already reflected correctly above.
    const normal = geometry.getAttribute('normal');
    flipGeometry(geometry);
    if (normal) {
      for (let i = 0; i < normal.count; i++) normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
      normal.needsUpdate = true;
    }
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
