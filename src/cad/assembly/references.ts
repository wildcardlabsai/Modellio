/**
 * Joint references (Stage 4H): reading a joint's position and axis from real geometry. A picked
 * face or edge of a body's exact build becomes a *reference*:
 *
 *   - a flat face → a plane: its centre and outward normal;
 *   - a cylindrical or conical face → an axis: fitted from the face's own triangles (every normal
 *     of a cylinder is square to its axis), through the fitted circle's centre;
 *   - a circular edge → an axis through its centre, square to its plane;
 *   - a straight edge → an axis along it, through its middle;
 *   - a spherical face → a point (its centre).
 *
 * Two references, one on each part, make a joint: the moving part is mated so that its reference
 * meets the fixed part's (flat faces face each other, axes line up), optionally reversed, offset
 * along the axis and turned about it. The joint's frames are then exact: the joint turns or slides
 * about the fixed part's reference.
 */
import * as THREE from 'three';
import type { BrepBuild, EdgeRef, FaceRef } from '@/cad/brep/types';
import type { JointKind, ObjectId, Vec3 } from '@/types/document';
import { faceFrame, toWorld } from '../placement';

/** What was picked, stored on the joint (body, and its face or edge, found again by reference). */
export interface JointRef {
  objectId: ObjectId;
  face?: FaceRef;
  edge?: EdgeRef;
}

/** A reference's geometry in world space. */
export type RefGeom =
  | { kind: 'plane'; origin: Vec3; axis: Vec3; x: Vec3; label: string }
  | { kind: 'axis'; origin: Vec3; axis: Vec3; label: string; radius?: number }
  | { kind: 'point'; origin: Vec3; label: string }
  | { kind: 'none'; label: string; why: string };

type V = THREE.Vector3;
const v3 = (v: V): Vec3 => [v.x, v.y, v.z].map((n) => Math.round(n * 1e6) / 1e6) as Vec3;
const vec = (a: Vec3) => new THREE.Vector3(...a);

/** Eigenvectors of a symmetric 3×3 matrix (Jacobi), smallest eigenvalue first. */
export function symmetricEigen(m: number[][]): { values: number[]; vectors: V[] } {
  const a = m.map((r) => [...r]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-20) break;
    for (let p = 0; p < 3; p++)
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => new THREE.Vector3(v[0][i], v[1][i], v[2][i]).normalize()),
  };
}

/** Two unit vectors square to `axis` (a stable choice: world X, or world Y when the axis is near X). */
function basisFor(axis: V): [V, V] {
  const ref = Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const x = ref.addScaledVector(axis, -ref.dot(axis)).normalize();
  return [x, axis.clone().cross(x).normalize()];
}

/** Least-squares circle through points given in a plane (u, v coordinates): centre and radius. */
function fitCircle(pts: [number, number][]): { cu: number; cv: number; r: number } | null {
  // x² + y² + D x + E y + F = 0, solved by normal equations.
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const b = [0, 0, 0];
  for (const [x, y] of pts) {
    const row = [x, y, 1];
    const rhs = -(x * x + y * y);
    for (let i = 0; i < 3; i++) {
      b[i] += row[i] * rhs;
      for (let j = 0; j < 3; j++) A[i][j] += row[i] * row[j];
    }
  }
  const sol = solve3(A, b);
  if (!sol) return null;
  const [D, E, F] = sol;
  const cu = -D / 2;
  const cv = -E / 2;
  const r2 = cu * cu + cv * cv - F;
  return r2 > 0 ? { cu, cv, r: Math.sqrt(r2) } : null;
}

function solve3(A: number[][], b: number[]): number[] | null {
  const m = new THREE.Matrix3().set(A[0][0], A[0][1], A[0][2], A[1][0], A[1][1], A[1][2], A[2][0], A[2][1], A[2][2]);
  if (Math.abs(m.determinant()) < 1e-18) return null;
  const inv = m.clone().invert();
  const x = new THREE.Vector3(...b).applyMatrix3(inv);
  return [x.x, x.y, x.z];
}

/** A fitted axis through points whose surface normals are all square to it (cylinder, cone). */
function fitAxis(points: V[], normals: { n: V; w: number }[]): { origin: V; axis: V; radius: number } | null {
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const { n, w } of normals) {
    const c = [n.x, n.y, n.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += w * c[i] * c[j];
  }
  const { values, vectors } = symmetricEigen(M);
  // A cylinder's normals span a plane: one direction (the axis) has almost no share of them.
  if (values[1] < 1e-9 || values[0] / values[1] > 0.2) return null;
  const axis = vectors[0];
  const [u, w] = basisFor(axis);
  const circle = fitCircle(points.map((p) => [p.dot(u), p.dot(w)]));
  if (!circle) return null;
  const along = points.reduce((s, p) => s + p.dot(axis), 0) / points.length;
  const origin = u.clone().multiplyScalar(circle.cu).addScaledVector(w, circle.cv).addScaledVector(axis, along);
  return { origin, axis, radius: circle.r };
}

/** The world geometry of face `index` of a body's build. */
export function faceGeometry(
  build: BrepBuild,
  index: number,
  size: Vec3,
  mirror: Vec3 | undefined,
  matrix: THREE.Matrix4,
  name: string,
): RefGeom {
  const f = build.faces[index];
  if (!f) return { kind: 'none', label: `a face of ${name}`, why: 'That face could not be found.' };
  const map = toWorld(build, size, mirror, matrix);
  const pts: V[] = [];
  const normals: { n: V; w: number }[] = [];
  const centroid = new THREE.Vector3();
  let area = 0;
  for (let t = f.start; t < f.start + f.count; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => {
      const i = build.indices[t * 3 + k] * 3;
      return vec(map(build.positions[i], build.positions[i + 1], build.positions[i + 2]));
    });
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    const ar = n.length() / 2;
    if (ar < 1e-12) continue;
    normals.push({ n: n.normalize(), w: ar });
    pts.push(a, b, c);
    centroid.addScaledVector(a.clone().add(b).add(c).divideScalar(3), ar);
    area += ar;
  }
  if (!area) return { kind: 'none', label: `a face of ${name}`, why: 'That face has no area.' };
  centroid.divideScalar(area);
  const kind = f.ref.kind;
  if (kind === 'plane') {
    const fr = faceFrame(build, index, size, mirror, matrix);
    if (!fr) return { kind: 'none', label: `a flat face of ${name}`, why: 'That face could not be read.' };
    const axis = vec(fr.x).cross(vec(fr.y)).normalize();
    return { kind: 'plane', origin: v3(centroid), axis: v3(axis), x: fr.x, label: `a flat face of ${name}` };
  }
  if (kind === 'cylinder' || kind === 'cone') {
    const fit = fitAxis(pts, normals);
    if (!fit)
      return {
        kind: 'none',
        label: `a round face of ${name}`,
        why: 'The axis of that round face could not be found. Pick a circular edge of it instead.',
      };
    const d = (fit.radius * 2).toFixed(1);
    return {
      kind: 'axis',
      origin: v3(fit.origin),
      axis: v3(fit.axis),
      radius: fit.radius,
      label: kind === 'cylinder' ? `a round face of ${name} (Ø${d} mm)` : `a cone face of ${name}`,
    };
  }
  if (kind === 'sphere') {
    // Sphere centre: x² + y² + z² + D x + E y + F z + G = 0 by least squares (4 unknowns).
    const A = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    const b = [0, 0, 0, 0];
    for (const p of pts) {
      const row = [p.x, p.y, p.z, 1];
      const rhs = -p.lengthSq();
      for (let i = 0; i < 4; i++) {
        b[i] += row[i] * rhs;
        for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j];
      }
    }
    const m = new THREE.Matrix4().set(...(A.flat() as Parameters<THREE.Matrix4['set']>));
    if (Math.abs(m.determinant()) < 1e-18)
      return { kind: 'none', label: `a spherical face of ${name}`, why: 'That face could not be read.' };
    const x = new THREE.Vector4(...b).applyMatrix4(m.clone().invert());
    return { kind: 'point', origin: v3(new THREE.Vector3(-x.x / 2, -x.y / 2, -x.z / 2)), label: `a spherical face of ${name}` };
  }
  return {
    kind: 'none',
    label: kind === 'torus' ? `a ring-shaped face of ${name}` : `a curved face of ${name}`,
    why: 'That face has no flat side or straight axis to line a joint up with. Pick a flat face, a round (cylindrical) face, or an edge.',
  };
}

/** The world geometry of edge `index` of a body's build. */
export function edgeGeometry(
  build: BrepBuild,
  index: number,
  size: Vec3,
  mirror: Vec3 | undefined,
  matrix: THREE.Matrix4,
  name: string,
): RefGeom {
  const e = build.edges[index];
  if (!e) return { kind: 'none', label: `an edge of ${name}`, why: 'That edge could not be found.' };
  const map = toWorld(build, size, mirror, matrix);
  const pts: V[] = [];
  for (let i = 0; i < e.points.length; i += 3) pts.push(vec(map(e.points[i], e.points[i + 1], e.points[i + 2])));
  if (pts.length < 2) return { kind: 'none', label: `an edge of ${name}`, why: 'That edge is too short.' };
  if (e.ref.kind === 'line') {
    const a = pts[0];
    const b = pts[pts.length - 1];
    const axis = b.clone().sub(a);
    if (axis.length() < 1e-6) return { kind: 'none', label: `an edge of ${name}`, why: 'That edge is too short.' };
    return {
      kind: 'axis',
      origin: v3(a.clone().add(b).multiplyScalar(0.5)),
      axis: v3(axis.normalize()),
      label: `a straight edge of ${name}`,
    };
  }
  if (e.ref.kind === 'circle') {
    const c = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pts.length);
    const C = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (const p of pts) {
      const d = [p.x - c.x, p.y - c.y, p.z - c.z];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j];
    }
    const normal = symmetricEigen(C).vectors[0];
    const [u, w] = basisFor(normal);
    const circle = fitCircle(pts.map((p) => [p.dot(u), p.dot(w)]));
    if (!circle) return { kind: 'none', label: `a circular edge of ${name}`, why: 'That edge could not be read.' };
    const origin = u.clone().multiplyScalar(circle.cu).addScaledVector(w, circle.cv).addScaledVector(normal, c.dot(normal));
    return {
      kind: 'axis',
      origin: v3(origin),
      axis: v3(normal),
      radius: circle.r,
      label: `a circular edge of ${name} (Ø${(circle.r * 2).toFixed(1)} mm)`,
    };
  }
  return {
    kind: 'none',
    label: `a curved edge of ${name}`,
    why: 'A free-form edge has no single direction. Pick a straight or circular edge, or a face.',
  };
}

const KIND_NAME: Record<JointKind, string> = {
  rigid: 'A rigid joint',
  revolute: 'A hinge',
  slider: 'A slider',
  cylindrical: 'A cylindrical joint',
  planar: 'A planar joint',
};

/** Why these references can't make this kind of joint (or null). */
export function suitability(kind: JointKind, a: RefGeom, b: RefGeom): string | null {
  for (const r of [a, b]) if (r.kind === 'none') return `${cap(r.label)}: ${r.why}`;
  if (kind === 'planar') {
    for (const r of [a, b])
      if (r.kind !== 'plane') return `${KIND_NAME[kind]} slides one flat face on another, and ${r.label} is not flat. Pick a flat face.`;
    return null;
  }
  if (kind !== 'rigid')
    for (const r of [a, b])
      if (r.kind === 'point')
        return `${KIND_NAME[kind]} needs an axis, and ${r.label} has none (a sphere turns every way). Pick a flat or round face, or an edge.`;
  return null;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** A reference as a frame: origin, axis as Z (reversed when `flip`), and a stable X. */
export function refFrame(g: Exclude<RefGeom, { kind: 'none' }>): THREE.Matrix4 {
  const origin = vec(g.origin);
  const z = g.kind === 'point' ? new THREE.Vector3(0, 0, 1) : vec(g.axis).normalize();
  let x = g.kind === 'plane' ? vec(g.x) : basisFor(z)[0];
  x = x.addScaledVector(z, -x.dot(z));
  if (x.lengthSq() < 1e-12) x = basisFor(z)[0];
  x.normalize();
  const y = z.clone().cross(x).normalize();
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin);
}

export interface MateOptions {
  kind: JointKind;
  a: RefGeom;
  b: RefGeom;
  /** World placements of the fixed part A and the moving part B. */
  worldA: THREE.Matrix4;
  worldB: THREE.Matrix4;
  /** Reverse the moving part's direction. */
  flip: boolean;
  /** Gap along the fixed part's axis (mm). */
  offset: number;
  /** Turn about the axis (degrees). */
  angle: number;
  /** Move the moving part onto the fixed part's reference (otherwise it stays where it is). */
  snap: boolean;
}

/** Whether, by default, B's reference faces A's (two flat faces touch) rather than pointing the same way (axes line up). */
export const opposedByDefault = (a: RefGeom, b: RefGeom) => a.kind === 'plane' && b.kind === 'plane';

/**
 * Mate B onto A: where B goes, and the joint's frames (rest pose = that place, values 0). The
 * joint's axis is A's reference; for two flat faces B is turned to face A.
 */
export function mate(
  o: MateOptions,
): { frameA: number[]; frameB: number[]; worldB: THREE.Matrix4; axisWorld: THREE.Matrix4 } | { error: string } {
  const why = suitability(o.kind, o.a, o.b);
  if (why) return { error: why };
  const FA = refFrame(o.a as Exclude<RefGeom, { kind: 'none' }>);
  const FB = refFrame(o.b as Exclude<RefGeom, { kind: 'none' }>);
  const opposed = opposedByDefault(o.a, o.b) !== o.flip;
  const target = FA.clone()
    .multiply(new THREE.Matrix4().makeTranslation(0, 0, o.offset))
    .multiply(new THREE.Matrix4().makeRotationZ((o.angle * Math.PI) / 180))
    .multiply(opposed ? new THREE.Matrix4().makeRotationX(Math.PI) : new THREE.Matrix4());
  // B's reference lands on the target: world(B)′ · (world(B)⁻¹ · FB) = target.
  const worldB = o.snap ? target.clone().multiply(FB.clone().invert()).multiply(o.worldB) : o.worldB.clone();
  const frameA = o.worldA.clone().invert().multiply(FA).toArray();
  const frameB = worldB.clone().invert().multiply(FA).toArray();
  return { frameA, frameB, worldB, axisWorld: FA };
}
