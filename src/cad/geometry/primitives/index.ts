import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PrimitiveType, ShapeParams, Vec3 } from '@/types/document';
import { clamp } from '@/utils/math';
import { fitToSize, flipGeometry, mergeParts, polyhedron, yUpToZUp } from '../geometryUtils';

/**
 * Pure geometry generators. Each returns a NEW BufferGeometry (the caller owns
 * and must dispose it) that is centred on the origin with a bounding box of
 * exactly `size` millimetres, Z-up.
 */
type Builder = (size: Vec3, params: ShapeParams) => THREE.BufferGeometry;

/** Shapes built purely from size + numeric params (text and mesh need more context). */
export type ParametricType = Exclude<PrimitiveType, 'text' | 'mesh'>;

const seg = (params: ShapeParams, fallback = 48) => Math.round(clamp(params.segments ?? fallback, 3, 256));

/** Box with an optional fillet radius (mm) on every edge. The radius is absolute, never stretched. */
const box: Builder = (size, p) => {
  const r = clamp(p.radius ?? 0, 0, Math.min(...size) / 2 - 1e-3);
  if (r <= 1e-3) return fitToSize(new THREE.BoxGeometry(1, 1, 1), size);
  const segs = Math.round(clamp(p.filletSegments ?? 4, 1, 16));
  return fitToSize(new RoundedBoxGeometry(size[0], size[1], size[2], segs, r), size);
};

const sphere: Builder = (size, p) => {
  const s = seg(p, 48);
  return fitToSize(yUpToZUp(new THREE.SphereGeometry(0.5, s, Math.max(2, Math.round(s / 2)))), size);
};

const cylinder: Builder = (size, p) => fitToSize(yUpToZUp(new THREE.CylinderGeometry(0.5, 0.5, 1, seg(p))), size);

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

/** Extruded star with `points` tips; `innerRatio` = inner / outer radius. */
const star: Builder = (size, p) => {
  const points = Math.round(clamp(p.points ?? 5, 3, 32));
  const inner = clamp(p.innerRatio ?? 0.5, 0.05, 0.95);
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.5 : 0.5 * inner;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  return fitToSize(new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 }), size);
};

/** Capsule (cylinder with hemispherical ends) along Z. */
const capsule: Builder = (size, p) => {
  const s = seg(p, 48);
  const r = 0.5;
  const h = Math.max(0.01, size[2] / Math.max(size[0], size[1]) - 1); // keep the ends round
  return fitToSize(yUpToZUp(new THREE.CapsuleGeometry(r, h, Math.max(4, Math.round(s / 4)), s)), size);
};

/** Paraboloid dome: r(z) ∝ √(1 − z), flat base. */
const paraboloid: Builder = (size, p) => {
  const s = seg(p, 48);
  const rows = Math.max(8, Math.round(s / 3));
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows; // 0 = apex, 1 = base rim
    profile.push(new THREE.Vector2(0.5 * Math.sqrt(t), 1 - t));
  }
  profile.reverse(); // rim → apex gives outward-facing lathe triangles
  const dome = yUpToZUp(new THREE.LatheGeometry(profile, s));
  const base = flipGeometry(new THREE.CircleGeometry(0.5, s));
  return fitToSize(mergeParts([dome, base]), size);
};

export const PRIMITIVE_BUILDERS: Record<ParametricType, Builder> = {
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
  star,
  capsule,
  paraboloid,
};
