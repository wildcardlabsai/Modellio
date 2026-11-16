/**
 * Assembly joints (schema 4). A joint connects two parts, A and B, through a frame on each (an
 * origin and an axis, stored in each part's own coordinates). B's place follows from A's and the
 * joint's values:
 *
 *   world(B) = world(A) · frameA · motion(kind, values) · frameB⁻¹
 *
 * where motion is the identity (rigid), a turn about the axis (revolute), a slide along it
 * (slider), both (cylindrical), or a slide in the plane plus a turn about its normal (planar).
 * Values stay within their limits. Joints form a tree: a part is moved by at most one joint, and
 * no chain of joints loops back; those cases are refused, never solved approximately.
 */
import * as THREE from 'three';
import { produce } from 'immer';
import type { Joint, JointKind, ModelDocument, ObjectId } from '@/types/document';
import { worldMatrix } from '../hierarchy';
import { instanceRootOf } from './links';
import { matrixToTransform, transformToMatrix } from '../transforms/transform';

const DEG = Math.PI / 180;
export const mat = (a: number[]) => new THREE.Matrix4().fromArray(a);

/** Which values each kind of joint has. */
export const JOINT_DOF: Record<JointKind, ('angle' | 'offset' | 'u' | 'v')[]> = {
  rigid: [],
  revolute: ['angle'],
  slider: ['offset'],
  cylindrical: ['angle', 'offset'],
  planar: ['u', 'v', 'angle'],
};

/** The everyday name of each kind of joint. */
export const JOINT_NAME: Record<JointKind, string> = {
  rigid: 'Rigid',
  revolute: 'Hinge',
  slider: 'Slider',
  cylindrical: 'Cylindrical',
  planar: 'Planar',
};

/** The motion a joint's values make, in frame A's coordinates (its axis is local Z). */
export function motion(kind: JointKind, v: Joint['values']): THREE.Matrix4 {
  const rot = new THREE.Matrix4().makeRotationZ((v.angle ?? 0) * DEG);
  if (kind === 'rigid') return new THREE.Matrix4();
  if (kind === 'revolute') return rot;
  if (kind === 'slider') return new THREE.Matrix4().makeTranslation(0, 0, v.offset ?? 0);
  if (kind === 'cylindrical') return new THREE.Matrix4().makeTranslation(0, 0, v.offset ?? 0).multiply(rot);
  return new THREE.Matrix4().makeTranslation(v.u ?? 0, v.v ?? 0, 0).multiply(rot);
}

/** Values clamped to the joint's limits. */
export function clampValues(j: Pick<Joint, 'kind' | 'values' | 'limits'>, v: Joint['values']): Joint['values'] {
  const out: Joint['values'] = {};
  for (const k of JOINT_DOF[j.kind]) {
    let x = v[k] ?? 0;
    const lim = j.limits?.[k];
    if (lim) x = Math.min(lim[1], Math.max(lim[0], x));
    out[k] = x;
  }
  return out;
}

/** The values that best match B being at `worldB` (its motion projected onto the joint's freedoms). */
export function valuesFor(j: Joint, worldA: THREE.Matrix4, worldB: THREE.Matrix4): Joint['values'] {
  // motion = (world(A)·frameA)⁻¹ · world(B) · frameB
  const m = worldA.clone().multiply(mat(j.frameA)).invert().multiply(worldB).multiply(mat(j.frameB));
  const p = new THREE.Vector3().setFromMatrixPosition(m);
  const e = m.elements;
  const angle = Math.atan2(e[1], e[0]) / DEG;
  return clampValues(j, { angle, offset: p.z, u: p.x, v: p.y });
}

/** B's world placement for given values. */
export const placeB = (j: Joint, worldA: THREE.Matrix4, values: Joint['values']) =>
  worldA.clone().multiply(mat(j.frameA)).multiply(motion(j.kind, values)).multiply(mat(j.frameB).invert());

/** Joints in the order they must be solved (parents before children), or the reason they can't be. */
export function jointOrder(joints: Joint[]): { order: Joint[] } | { error: string } {
  const active = joints.filter((j) => !j.suppressed);
  const byB = new Map<ObjectId, Joint>();
  for (const j of active) {
    if (j.a === j.b) return { error: `${j.name} connects a part to itself.` };
    if (byB.has(j.b)) return { error: `A part can be moved by one joint only (${byB.get(j.b)!.name} and ${j.name}).` };
    byB.set(j.b, j);
  }
  const order: Joint[] = [];
  const state = new Map<ObjectId, 'visiting' | 'done'>();
  const visit = (part: ObjectId): string | null => {
    const j = byB.get(part);
    if (!j || state.get(part) === 'done') return null;
    if (state.get(part) === 'visiting') return `The joints form a loop through ${j.name}; loops are not supported.`;
    state.set(part, 'visiting');
    const err = visit(j.a);
    if (err) return err;
    state.set(part, 'done');
    order.push(j);
    return null;
  };
  for (const j of active) {
    const err = visit(j.b);
    if (err) return { error: err };
  }
  return { order };
}

/** Frame matrix (as stored) from an origin, axis (local Z) and a reference direction (local X). */
export function frameFrom(origin: THREE.Vector3, axis: THREE.Vector3, ref: THREE.Vector3): number[] {
  const z = axis.clone().normalize();
  let x = ref.clone().addScaledVector(z, -ref.dot(z));
  if (x.lengthSq() < 1e-12) x = Math.abs(z.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  x.addScaledVector(z, -x.dot(z)).normalize();
  const y = z.clone().cross(x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin).toArray();
}

/** Why a joint between A and B can't be made (or null). */
export function jointProblem(doc: ModelDocument, j: Pick<Joint, 'id' | 'name' | 'a' | 'b'>): string | null {
  const a = doc.objects[j.a];
  const b = doc.objects[j.b];
  if (!a || !b) return 'Pick two parts to connect.';
  if (j.a === j.b) return 'A joint connects two different parts.';
  for (let p = b.parentId; p; p = doc.objects[p]?.parentId)
    if (p === j.a) return `${b.name} is inside ${a.name}; pick parts that are not nested in each other.`;
  for (let p = a.parentId; p; p = doc.objects[p]?.parentId)
    if (p === j.b) return `${a.name} is inside ${b.name}; pick parts that are not nested in each other.`;
  for (const id of [j.a, j.b]) {
    const root = instanceRootOf(doc, id);
    if (root && root !== id)
      return `${doc.objects[id].name} is a part inside the component ${doc.objects[root].name}. Connect the component itself.`;
  }
  if (b.grounded) return `${b.name} is grounded, so a joint can't move it. Pick it first (as the fixed part) or unground it.`;
  const others = Object.values(doc.joints ?? {}).filter((x) => x.id !== j.id);
  const ord = jointOrder([...others, { ...(j as Joint), kind: 'rigid', frameA: [], frameB: [], values: {} }]);
  return 'error' in ord ? ord.error : null;
}

/**
 * Apply every joint, after every change and inside the same undo step: where the user moved a
 * jointed part, its move is projected onto the joint's freedoms (and stopped at its limits); then
 * each part is put where its joint says, parents first. Joints whose parts were deleted are
 * removed. Returns the names of joints that stopped at a limit.
 */
export function solveJoints(prev: ModelDocument, next: ModelDocument): { doc: ModelDocument; limited: string[] } {
  const all = Object.values(next.joints ?? {});
  const limited: string[] = [];
  if (!all.length) return { doc: next, limited };
  const orphans = all.filter((j) => !next.objects[j.a] || !next.objects[j.b]);
  const joints = all.filter((j) => !orphans.includes(j));
  const ord = jointOrder(joints);
  const doc = produce(next, (d) => {
    for (const j of orphans) delete d.joints![j.id];
    if ('error' in ord) return;
    const doc = d as ModelDocument;
    for (const j of ord.order) {
      const b = doc.objects[j.b];
      const wa = worldMatrix(doc, j.a);
      const before = prev.joints?.[j.id];
      // The user moved B itself (not by changing the joint's values): follow the move along the joint.
      const dragged =
        !!before && !!prev.objects[j.b] && prev.objects[j.b].transform !== next.objects[j.b].transform && before.values === j.values;
      let values: Joint['values'];
      if (dragged) {
        const m = wa.clone().multiply(mat(j.frameA)).invert().multiply(worldMatrix(doc, j.b)).multiply(mat(j.frameB));
        const p = new THREE.Vector3().setFromMatrixPosition(m);
        const raw = { angle: Math.atan2(m.elements[1], m.elements[0]) / DEG, offset: p.z, u: p.x, v: p.y };
        // Keep turning continuous with the previous value (e.g. 170° → 190°, not −170°).
        if (before.values.angle !== undefined) raw.angle += 360 * Math.round((before.values.angle - raw.angle) / 360);
        // A freedom the drag didn't really change keeps its value exactly (no rounding drift).
        for (const k of JOINT_DOF[j.kind])
          if (before.values[k] !== undefined && Math.abs(raw[k] - before.values[k]!) < 1e-3) raw[k] = before.values[k]!;
        values = clampValues(j, raw);
        if (JOINT_DOF[j.kind].some((k) => Math.abs((values[k] ?? 0) - raw[k]) > 1e-6)) limited.push(j.name);
      } else values = clampValues(j, j.values);
      const live = d.joints![j.id];
      if (JSON.stringify(plain(live.values)) !== JSON.stringify(values)) live.values = values;
      const target = placeB(j, wa, values);
      const parent = b.parentId ? worldMatrix(doc, b.parentId) : null;
      const t = matrixToTransform(parent ? parent.clone().invert().multiply(target) : target);
      const was = transformToMatrix(b.transform).elements;
      if (transformToMatrix(t).elements.some((v, i) => Math.abs(v - was[i]) > 1e-4)) d.objects[j.b].transform = t;
    }
  });
  return { doc: orphans.length || doc !== next ? doc : next, limited };
}

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));
