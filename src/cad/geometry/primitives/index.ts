import * as THREE from 'three';
import type { PrimitiveType, ShapeParams, Vec3 } from '@/types/document';
import { clamp } from '@/utils/math';
import { fitToSize, flipGeometry, mergeParts, polyhedron, yUpToZUp } from '../geometryUtils';

/**
 * Pure geometry generators. Each returns a NEW BufferGeometry (the caller owns
 * and must dispose it) that is centred on the origin with a bounding box of
 * exactly `size` millimetres, Z-up.
 */
type Builder = (size: Vec3, params: ShapeParams) => THREE.BufferGeometry;

const seg = (params: ShapeParams, fallback = 48) =>
  Math.round(clamp(params.segments ?? fallback, 3, 256));

const box: Builder = (size) => fitToSize(new THREE.BoxGeometry(1, 1, 1), size);

const sphere: Builder = (size, p) => {
  const s = seg(p, 48);
  return fitToSize(yUpToZUp(new THREE.SphereGeometry(0.5, s, Math.max(2, Math.round(s / 2)))), size);
};

const cylinder: Builder = (size, p) =>
  fitToSize(yUpToZUp(new THREE.CylinderGeometry(0.5, 0.5, 1, seg(p))), size);

const cone: Builder = (size, p) => {
  // Optional truncated cone: topRatio = top radius / base radius.
  const top = clamp(p.topRatio ?? 0, 0, 1) * 0.5;
  return fitToSize(yUpToZUp(new THREE.CylinderGeometry(top, 0.5, 1, seg(p))), size);
};

const pyramid: Builder = (size) =>
  fitToSize(
    polyhedron(
      [
        [-0.5, -0.5, -0.5],
        [0.5, -0.5, -0.5],
        [0.5, 0.5, -0.5],
        [-0.5, 0.5, -0.5],
        [0, 0, 0.5],
      ],
      [
        [0, 3, 2, 1], // base (facing -Z)
        [0, 1, 4],
        [1, 2, 4],
        [2, 3, 4],
        [3, 0, 4],
      ],
    ),
    size,
  );

/** Right-angled wedge: full height at -X, sloping down to +X. */
const wedge: Builder = (size) =>
  fitToSize(
    polyhedron(
      [
        [-0.5, -0.5, -0.5], // 0
        [0.5, -0.5, -0.5], // 1
        [-0.5, -0.5, 0.5], // 2
        [-0.5, 0.5, -0.5], // 3
        [0.5, 0.5, -0.5], // 4
        [-0.5, 0.5, 0.5], // 5
      ],
      [
        [0, 3, 4, 1], // bottom
        [0, 1, 2], // front (-Y)
        [3, 5, 4], // back (+Y)
        [0, 2, 5, 3], // vertical back wall (-X)
        [1, 4, 5, 2], // slope
      ],
    ),
    size,
  );

/** Gable roof: triangular prism with its ridge running along X. */
const roof: Builder = (size) =>
  fitToSize(
    polyhedron(
      [
        [-0.5, -0.5, -0.5], // 0
        [0.5, -0.5, -0.5], // 1
        [0.5, 0.5, -0.5], // 2
        [-0.5, 0.5, -0.5], // 3
        [-0.5, 0, 0.5], // 4
        [0.5, 0, 0.5], // 5
      ],
      [
        [0, 3, 2, 1], // bottom
        [0, 1, 5, 4], // front slope
        [2, 3, 4, 5], // back slope
        [0, 4, 3], // left gable
        [1, 2, 5], // right gable
      ],
    ),
    size,
  );

const torus: Builder = (size, p) => {
  // Tube radius follows the height; the ring is fitted to X/Y afterwards.
  const outerR = Math.max(size[0], size[1]) / 2;
  const tubeR = clamp(size[2] / 2, 0.01, outerR * 0.95);
  const geo = new THREE.TorusGeometry(outerR - tubeR, tubeR, Math.max(8, Math.round(seg(p, 48) / 2)), seg(p, 64));
  return fitToSize(geo, size);
};

const tube: Builder = (size, p) => {
  const s = seg(p);
  const r = Math.max(size[0], size[1]) / 2;
  const wall = clamp(p.wall ?? 2, 0.05, r * 0.98);
  const inner = r - wall;
  const h = size[2];
  const outerWall = yUpToZUp(new THREE.CylinderGeometry(r, r, h, s, 1, true));
  const innerWall = flipGeometry(yUpToZUp(new THREE.CylinderGeometry(inner, inner, h, s, 1, true)));
  const top = new THREE.RingGeometry(inner, r, s, 1).translate(0, 0, h / 2);
  const bottom = flipGeometry(new THREE.RingGeometry(inner, r, s, 1)).translate(0, 0, -h / 2);
  return fitToSize(mergeParts([outerWall, innerWall, top, bottom]), size);
};

const halfSphere: Builder = (size, p) => {
  const s = seg(p, 48);
  const dome = yUpToZUp(new THREE.SphereGeometry(0.5, s, Math.max(2, Math.round(s / 4)), 0, Math.PI * 2, 0, Math.PI / 2));
  const base = flipGeometry(new THREE.CircleGeometry(0.5, s));
  return fitToSize(mergeParts([dome, base]), size);
};

const polygon: Builder = (size, p) => {
  const sides = Math.round(clamp(p.sides ?? 6, 3, 64));
  const shape = new THREE.Shape();
  for (let i = 0; i < sides; i++) {
    const a = Math.PI / 2 + (i / sides) * Math.PI * 2;
    const x = Math.cos(a) * 0.5;
    const y = Math.sin(a) * 0.5;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });
  return fitToSize(geo, size);
};

export const PRIMITIVE_BUILDERS: Record<PrimitiveType, Builder> = {
  box,
  sphere,
  cylinder,
  cone,
  pyramid,
  wedge,
  roof,
  torus,
  tube,
  halfSphere,
  polygon,
};
