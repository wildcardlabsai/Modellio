/**
 * Where sketches sit in the world (schema 3): the frames of reference planes and of flat faces of
 * precise solids, and the transform that puts a sketched body on its sketch's frame.
 *
 * A frame is the sketch's origin and its x and y axes in world space; its normal (x × y) is the
 * way an extrusion grows. A body made from a placed sketch is the profile mesh (extruded along
 * mesh +Z, or revolved about mesh Z) mapped onto that frame.
 */
import * as THREE from 'three';
import type { BrepBuild } from '@/cad/brep/types';
import type { Frame, RefPlane, Transform, Vec3 } from '@/types/document';
import { matrixToTransform } from '@/cad/transforms/transform';

type P3 = [number, number, number];

// ── Build ↔ world (shared with edge and face picking) ──────────────────────────────────────────

/** Scale (build → object size), the build's box centre, for mapping build coordinates. */
function buildFit(build: BrepBuild, size: Vec3) {
  const box = new THREE.Box3();
  const p = build.positions;
  for (let i = 0; i < p.length; i += 3) box.expandByPoint(new THREE.Vector3(p[i], p[i + 1], p[i + 2]));
  const c = box.getCenter(new THREE.Vector3());
  const e = box.getSize(new THREE.Vector3());
  const s: P3 = [e.x > 1e-9 ? size[0] / e.x : 1, e.y > 1e-9 ? size[1] / e.y : 1, e.z > 1e-9 ? size[2] / e.z : 1];
  return { c, s };
}

/** A point in a build's coordinates → world (the body is the build fitted to `size`, mirrored, placed by `matrix`). */
export function toWorld(build: BrepBuild, size: Vec3, mirror: Vec3 | undefined, matrix: THREE.Matrix4) {
  const { c, s } = buildFit(build, size);
  const m = mirror ?? [1, 1, 1];
  const v = new THREE.Vector3();
  return (x: number, y: number, z: number): P3 => {
    v.set((x - c.x) * s[0] * m[0], (y - c.y) * s[1] * m[1], (z - c.z) * s[2] * m[2]).applyMatrix4(matrix);
    return [v.x, v.y, v.z];
  };
}

/** The inverse of `toWorld`: a world point back to the build's coordinates. */
export function fromWorld(build: BrepBuild, size: Vec3, mirror: Vec3 | undefined, matrix: THREE.Matrix4) {
  const { c, s } = buildFit(build, size);
  const m = mirror ?? [1, 1, 1];
  const inv = matrix.clone().invert();
  return (w: THREE.Vector3): P3 => {
    const v = w.clone().applyMatrix4(inv);
    return [v.x / (s[0] * m[0]) + c.x, v.y / (s[1] * m[1]) + c.y, v.z / (s[2] * m[2]) + c.z];
  };
}

// ── Frames ─────────────────────────────────────────────────────────────────────────────────────

const v3 = (a: THREE.Vector3): Vec3 => [a.x, a.y, a.z];
const vec = (a: Vec3) => new THREE.Vector3(...a);
export const frameNormal = (f: Frame): Vec3 => v3(vec(f.x).cross(vec(f.y)).normalize());

/** The world XY plane: what an unplaced sketch uses. */
export const WORLD_XY: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] };

/**
 * A reference plane's frame. XY: x along X, y along Y (normal +Z). XZ: x along X, y along Z
 * (normal −Y, so the plane faces the default front view). YZ: x along Y, y along Z (normal +X).
 * `offset` moves it along its normal; `tilt` turns it about its own x axis.
 */
export function planeFrame(p: Pick<RefPlane, 'base' | 'offset' | 'tilt'>): Frame {
  const axes: Record<RefPlane['base'], [Vec3, Vec3]> = {
    XY: [
      [1, 0, 0],
      [0, 1, 0],
    ],
    XZ: [
      [1, 0, 0],
      [0, 0, 1],
    ],
    YZ: [
      [0, 1, 0],
      [0, 0, 1],
    ],
  };
  const [x0, y0] = axes[p.base];
  const x = vec(x0);
  const y = vec(y0).applyAxisAngle(x, ((p.tilt || 0) * Math.PI) / 180);
  const n = x.clone().cross(y).normalize();
  // Offset along the untilted normal, so a tilted plane turns about a line at that offset.
  const n0 = vec(x0).cross(vec(y0)).normalize();
  return { origin: v3(n0.multiplyScalar(p.offset || 0)), x: v3(x), y: v3(n.clone().cross(x).normalize()) };
}

/**
 * The frame of flat face `faceIndex` of a build, in world space: origin at the face's centre,
 * normal pointing out of the solid, x along the body's own X axis laid onto the face (its Y when
 * X is square to the face), so the frame turns with the body and stays put between rebuilds.
 * Null when the face is not flat.
 */
export function faceFrame(build: BrepBuild, faceIndex: number, size: Vec3, mirror: Vec3 | undefined, matrix: THREE.Matrix4): Frame | null {
  const f = build.faces[faceIndex]?.ref;
  if (!f || f.kind !== 'plane') return null;
  const { s } = buildFit(build, size);
  const m = mirror ?? [1, 1, 1];
  const k: P3 = [s[0] * m[0], s[1] * m[1], s[2] * m[2]];
  // Face references are normalised by the build's half-extents (centre ⊙ half, normal ⊘ half).
  const centre = new THREE.Vector3(
    f.centre[0] * build.half[0] * k[0],
    f.centre[1] * build.half[1] * k[1],
    f.centre[2] * build.half[2] * k[2],
  );
  const origin = centre.applyMatrix4(matrix);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const n = new THREE.Vector3(f.normal[0] / build.half[0] / k[0], f.normal[1] / build.half[1] / k[1], f.normal[2] / build.half[2] / k[2])
    .applyMatrix3(normalMatrix)
    .normalize();
  const rot = new THREE.Matrix4().extractRotation(matrix);
  let x = new THREE.Vector3(Math.sign(k[0]) || 1, 0, 0).applyMatrix4(rot);
  if (Math.abs(x.dot(n)) > 0.999) x = new THREE.Vector3(0, Math.sign(k[1]) || 1, 0).applyMatrix4(rot);
  x.addScaledVector(n, -x.dot(n)).normalize();
  const y = n.clone().cross(x).normalize();
  return { origin: v3(origin), x: v3(x), y: v3(y) };
}

/** Whether two frames are the same (to a micron and a micro-radian). */
export function sameFrame(a: Frame | undefined, b: Frame | undefined, tol = 1e-6): boolean {
  if (!a || !b) return a === b;
  const close = (p: Vec3, q: Vec3, t: number) => Math.abs(p[0] - q[0]) < t && Math.abs(p[1] - q[1]) < t && Math.abs(p[2] - q[2]) < t;
  return close(a.origin, b.origin, tol * 1000) && close(a.x, b.x, tol) && close(a.y, b.y, tol);
}

// ── Bodies on frames ───────────────────────────────────────────────────────────────────────────

/**
 * Where a sketched body goes on its sketch's frame. The profile mesh is extruded along mesh +Z
 * (onto the frame's normal) or revolved about mesh Z (the sketch's Y axis); bodies are drawn
 * centred on the mesh's box, so `anchor` is that box's centre in mesh coordinates. `parentWorld`
 * is the body's parent group's world matrix (identity at the top level).
 */
export function bodyTransformOnFrame(frame: Frame, revolve: boolean, anchor: Vec3, parentWorld?: THREE.Matrix4): Transform {
  const x = vec(frame.x);
  const y = vec(frame.y);
  const n = x.clone().cross(y).normalize();
  // Mesh axes → world: extrude (x, y, n); revolve (x, −n, y) (mesh Z is the sketch's Y axis).
  const basis = revolve ? new THREE.Matrix4().makeBasis(x, n.clone().negate(), y) : new THREE.Matrix4().makeBasis(x, y, n);
  const pos = vec(anchor).applyMatrix4(basis).add(vec(frame.origin));
  const world = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromRotationMatrix(basis), new THREE.Vector3(1, 1, 1));
  const local = parentWorld ? parentWorld.clone().invert().multiply(world) : world;
  return matrixToTransform(local);
}

/** Whether two transforms are the same (to a micron and a thousandth of a degree, angles modulo 360). */
export function sameTransform(a: Transform, b: Transform): boolean {
  const qa = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(a.rotation.map((d) => (d * Math.PI) / 180) as P3)));
  const qb = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(b.rotation.map((d) => (d * Math.PI) / 180) as P3)));
  return a.position.every((v, i) => Math.abs(v - b.position[i]) < 1e-3) && Math.abs(Math.abs(qa.dot(qb)) - 1) < 1e-9;
}
