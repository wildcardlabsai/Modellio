import * as THREE from 'three';
import type { Axis, ModelDocument, ObjectId, SceneObject, ShapeObject, Vec3 } from '@/types/document';
import { eulerFromDegrees, localCorners, matrixToTransform, transformToMatrix } from './transforms/transform';
import { buildGeometryForShape } from './shapeRegistry';
import { roundTo } from '@/utils/math';

/**
 * Scene-graph maths. Object transforms are local to their parent group; these
 * helpers compose world matrices, compute bounds in any frame, and re-parent
 * objects while preserving their world placement.
 *
 * Functions ending in `Draft` mutate an Immer draft; all others are pure.
 */

// ---------- queries ----------

export function parentOf(doc: ModelDocument, id: ObjectId): ObjectId | null {
  return doc.objects[id]?.parentId ?? null;
}

/** Ancestors from the direct parent up to the root. */
export function ancestors(doc: ModelDocument, id: ObjectId): ObjectId[] {
  const out: ObjectId[] = [];
  let p = parentOf(doc, id);
  while (p && doc.objects[p]) {
    out.push(p);
    p = parentOf(doc, p);
  }
  return out;
}

export function rootAncestor(doc: ModelDocument, id: ObjectId): ObjectId {
  const a = ancestors(doc, id);
  return a.length ? a[a.length - 1] : id;
}

export function isDescendantOf(doc: ModelDocument, id: ObjectId, ancestor: ObjectId): boolean {
  return ancestors(doc, id).includes(ancestor);
}

/** True if the object or any ancestor is locked. */
export function isEffectivelyLocked(doc: ModelDocument, id: ObjectId): boolean {
  return !!doc.objects[id]?.locked || ancestors(doc, id).some((a) => doc.objects[a]?.locked);
}

/** True if the object and all ancestors are visible. */
export function isEffectivelyVisible(doc: ModelDocument, id: ObjectId): boolean {
  return !!doc.objects[id]?.visible && ancestors(doc, id).every((a) => doc.objects[a]?.visible);
}

/** Remove ids whose ancestor is also in the list (keeps the input order). */
export function topLevel(doc: ModelDocument, ids: ObjectId[]): ObjectId[] {
  const set = new Set(ids);
  return ids.filter((id, i) => doc.objects[id] && ids.indexOf(id) === i && !ancestors(doc, id).some((a) => set.has(a)));
}

/** Ordered children list of a parent (null = root). */
export function siblingsOf(doc: ModelDocument, parentId: ObjectId | null): ObjectId[] {
  if (!parentId) return doc.rootIds;
  const p = doc.objects[parentId];
  return p?.kind === 'group' ? p.children : [];
}

/** Every shape in the subtrees of `ids`. */
export function descendantShapes(doc: ModelDocument, ids: ObjectId[]): ShapeObject[] {
  const out: ShapeObject[] = [];
  const visit = (id: ObjectId) => {
    const o = doc.objects[id];
    if (!o) return;
    if (o.kind === 'shape') out.push(o);
    else o.children.forEach(visit);
  };
  ids.forEach(visit);
  return out;
}

// ---------- matrices ----------

export function localMatrix(obj: SceneObject): THREE.Matrix4 {
  return transformToMatrix(obj.transform);
}

export function worldMatrix(doc: ModelDocument, id: ObjectId): THREE.Matrix4 {
  const chain = [id, ...ancestors(doc, id)].reverse();
  const m = new THREE.Matrix4();
  for (const cid of chain) m.multiply(localMatrix(doc.objects[cid]));
  return m;
}

export function parentWorldMatrix(doc: ModelDocument, id: ObjectId): THREE.Matrix4 {
  const p = parentOf(doc, id);
  return p ? worldMatrix(doc, p) : new THREE.Matrix4();
}

/** Write an object's placement from a WORLD matrix, converting to its parent's frame. */
export function setWorldMatrixDraft(doc: ModelDocument, id: ObjectId, world: THREE.Matrix4) {
  const local = parentWorldMatrix(doc, id).invert().multiply(world);
  doc.objects[id].transform = matrixToTransform(local);
}

/** Move an object by a world-space vector (rotation untouched). */
export function translateWorldDraft(doc: ModelDocument, id: ObjectId, delta: THREE.Vector3) {
  const o = doc.objects[id];
  const q = new THREE.Quaternion();
  parentWorldMatrix(doc, id).decompose(new THREE.Vector3(), q, new THREE.Vector3());
  const local = delta.clone().applyQuaternion(q.invert());
  o.transform.position = [
    roundTo(o.transform.position[0] + local.x),
    roundTo(o.transform.position[1] + local.y),
    roundTo(o.transform.position[2] + local.z),
  ];
}

// ---------- bounds ----------

/**
 * Combined (Boolean) groups are bounded by their actual result, not by their
 * parts. The Boolean module registers a resolver returning the result's
 * bounds in the group's local frame (null if not computed yet).
 */
type CombinedBoundsResolver = (doc: ModelDocument, groupId: ObjectId) => { bounds: THREE.Box3; positions?: Float32Array } | null;
let combinedBounds: CombinedBoundsResolver | null = null;
export function setCombinedBoundsResolver(fn: CombinedBoundsResolver | null) {
  combinedBounds = fn;
}

/**
 * Is this transform's rotation axis-aligned (multiples of 90°)? Then a
 * shape's bounding box is exact, because geometry is fitted to `size`.
 */
function isAxisAlignedMatrix(m: THREE.Matrix4): boolean {
  const e = m.elements;
  for (let c = 0; c < 3; c++) {
    const col = [Math.abs(e[c * 4]), Math.abs(e[c * 4 + 1]), Math.abs(e[c * 4 + 2])];
    if (!col.some((v) => Math.abs(v - 1) < 1e-6)) return false;
  }
  return true;
}

/** Local vertex positions of a shape's real geometry (cached by geometry key). */
const vertexCache = new Map<string, Float32Array | null>();
function shapeVertices(o: ShapeObject): Float32Array | null {
  const key = JSON.stringify([o.shape, o.size, o.params, o.mirror, o.text, o.meshId]);
  if (vertexCache.has(key)) return vertexCache.get(key)!;
  const geo = buildGeometryForShape(o);
  const out = geo ? (geo.getAttribute('position').array as Float32Array).slice() : null;
  geo?.dispose();
  if (out) {
    vertexCache.set(key, out);
    if (vertexCache.size > 256) vertexCache.delete(vertexCache.keys().next().value!);
  }
  return out;
}

function boxCorners(b: THREE.Box3): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [b.min.x, b.max.x])
    for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

/**
 * Axis-aligned bounds of the subtrees of `ids`, measured in the frame whose
 * world matrix is `frame` (identity = world). Uses each shape's oriented box,
 * and the real Boolean result for combined groups.
 */
export function boundsInFrame(doc: ModelDocument, ids: ObjectId[], frame?: THREE.Matrix4): THREE.Box3 {
  const inv = frame ? frame.clone().invert() : null;
  const box = new THREE.Box3();
  const toFrame = (id: ObjectId) => {
    const m = worldMatrix(doc, id);
    if (inv) m.premultiply(inv);
    return m;
  };
  const visit = (id: ObjectId) => {
    const o = doc.objects[id];
    if (!o) return;
    if (o.kind === 'shape') {
      const m = toFrame(id);
      // Rotated at an arbitrary angle, the oriented box over-estimates (a tilted wedge's
      // empty corner would "touch" the plate), so use the real vertices.
      const verts = isAxisAlignedMatrix(m) ? null : shapeVertices(o);
      if (verts) {
        const v = new THREE.Vector3();
        for (let i = 0; i < verts.length; i += 3) box.expandByPoint(v.fromArray(verts, i).applyMatrix4(m));
      } else {
        for (const c of localCorners(o.size)) box.expandByPoint(c.applyMatrix4(m));
      }
      return;
    }
    if (o.combine && combinedBounds) {
      const r = combinedBounds(doc, id);
      if (r) {
        if (!r.bounds.isEmpty()) {
          const m = toFrame(id);
          if (r.positions && !isAxisAlignedMatrix(m)) {
            const v = new THREE.Vector3();
            for (let i = 0; i < r.positions.length; i += 3) box.expandByPoint(v.fromArray(r.positions, i).applyMatrix4(m));
          } else {
            for (const c of boxCorners(r.bounds)) box.expandByPoint(c.applyMatrix4(m));
          }
        }
        return;
      }
    }
    o.children.forEach(visit);
  };
  ids.forEach(visit);
  return box;
}

export function worldBoundsOf(doc: ModelDocument, ids: ObjectId[]): THREE.Box3 {
  return boundsInFrame(doc, ids);
}

/** A group's bounds in its own local frame. */
export function groupLocalBounds(doc: ModelDocument, groupId: ObjectId): THREE.Box3 {
  return boundsInFrame(doc, [groupId], worldMatrix(doc, groupId));
}

// ---------- structure edits ----------

function detachDraft(doc: ModelDocument, id: ObjectId) {
  const o = doc.objects[id];
  if (o.parentId) {
    const p = doc.objects[o.parentId];
    if (p?.kind === 'group') p.children = p.children.filter((c) => c !== id);
  } else {
    doc.rootIds = doc.rootIds.filter((c) => c !== id);
  }
}

function insertDraft(doc: ModelDocument, id: ObjectId, parentId: ObjectId | null, index: number) {
  doc.objects[id].parentId = parentId;
  const list = parentId ? (doc.objects[parentId] as { children: ObjectId[] }).children : doc.rootIds;
  const i = Math.max(0, Math.min(index, list.length));
  list.splice(i, 0, id);
}

/**
 * Move objects into `parentId` at `index`, preserving their world placement.
 * Objects cannot be moved into themselves or their own descendants.
 * Returns false (and does nothing) if the move is invalid.
 */
export function moveObjectsDraft(doc: ModelDocument, ids: ObjectId[], parentId: ObjectId | null, index: number): boolean {
  const items = topLevel(doc, ids);
  if (parentId) {
    const p = doc.objects[parentId];
    if (!p || p.kind !== 'group') return false;
    if (items.some((id) => id === parentId || isDescendantOf(doc, parentId, id))) return false;
  }
  const worlds = items.map((id) => worldMatrix(doc, id));
  const targetList = siblingsOf(doc, parentId);
  // Index correction for items removed before the insertion point in the same list.
  let insertAt = index;
  for (const id of items) {
    const i = targetList.indexOf(id);
    if (i !== -1 && i < index) insertAt--;
  }
  items.forEach((id) => detachDraft(doc, id));
  items.forEach((id, k) => {
    insertDraft(doc, id, parentId, insertAt + k);
    setWorldMatrixDraft(doc, id, worlds[k]);
  });
  return true;
}

/** Re-centre a group's pivot on its bounds without moving anything in the world. */
export function recenterGroupDraft(doc: ModelDocument, groupId: ObjectId) {
  const g = doc.objects[groupId];
  if (g?.kind !== 'group' || !g.children.length) return;
  const c = groupLocalBounds(doc, groupId).getCenter(new THREE.Vector3());
  if (c.lengthSq() < 1e-12) return;
  const childWorlds = g.children.map((id) => worldMatrix(doc, id));
  const newWorld = worldMatrix(doc, groupId).multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
  setWorldMatrixDraft(doc, groupId, newWorld);
  g.children.forEach((id, k) => setWorldMatrixDraft(doc, id, childWorlds[k]));
}

/**
 * Wrap objects in a new group placed at their bounds centre. World placement
 * is preserved exactly. Returns the group, or null if fewer than 2 items.
 */
export function groupDraft(doc: ModelDocument, ids: ObjectId[], group: { id: ObjectId; name: string }): ObjectId | null {
  const items = topLevel(doc, ids);
  if (items.length < 2) return null;
  const parents = new Set(items.map((id) => doc.objects[id].parentId));
  const parentId = parents.size === 1 ? [...parents][0] : null;
  const firstIndex = Math.min(...items.map((id) => siblingsOf(doc, doc.objects[id].parentId).indexOf(id)));

  const center = worldBoundsOf(doc, items).getCenter(new THREE.Vector3());
  const parentWorld = parentId ? worldMatrix(doc, parentId) : new THREE.Matrix4();
  const localCenter = center.clone().applyMatrix4(parentWorld.clone().invert());

  const worlds = items.map((id) => worldMatrix(doc, id));
  items.forEach((id) => detachDraft(doc, id));
  doc.objects[group.id] = {
    id: group.id,
    kind: 'group',
    name: group.name,
    children: [],
    parentId: null,
    visible: true,
    locked: false,
    transform: { position: [roundTo(localCenter.x), roundTo(localCenter.y), roundTo(localCenter.z)], rotation: [0, 0, 0] },
  };
  insertDraft(doc, group.id, parentId, parents.size === 1 ? firstIndex : doc.rootIds.length);
  items.forEach((id, k) => {
    insertDraft(doc, id, group.id, k);
    setWorldMatrixDraft(doc, id, worlds[k]);
  });
  return group.id;
}

/** Dissolve groups, moving their children to the group's parent in place. Returns released child ids. */
export function ungroupDraft(doc: ModelDocument, groupIds: ObjectId[]): ObjectId[] {
  const released: ObjectId[] = [];
  for (const gid of groupIds) {
    const g = doc.objects[gid];
    if (g?.kind !== 'group') continue;
    const parentId = g.parentId;
    const children = [...g.children];
    const worlds = children.map((id) => worldMatrix(doc, id));
    const index = siblingsOf(doc, parentId).indexOf(gid);
    detachDraft(doc, gid);
    delete doc.objects[gid];
    children.forEach((id, k) => {
      insertDraft(doc, id, parentId, index + k);
      setWorldMatrixDraft(doc, id, worlds[k]);
    });
    released.push(...children);
  }
  return released;
}

// ---------- group scaling ----------

const isAxisAligned = (q: THREE.Quaternion) => {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
  // every column must be ±unit along one axis
  for (let c = 0; c < 3; c++) {
    const col = [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]].map(Math.abs);
    if (!col.some((v) => Math.abs(v - 1) < 1e-6)) return false;
  }
  return true;
};

/** Map per-axis factors from a parent frame into a child frame rotated by q (axis-aligned). */
function factorsInChild(f: Vec3, q: THREE.Quaternion): Vec3 {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
  const out: Vec3 = [1, 1, 1];
  for (let c = 0; c < 3; c++) {
    const col = [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]].map(Math.abs);
    out[c] = f[col.indexOf(Math.max(...col))];
  }
  return out;
}

/** Non-uniform group scaling is only exact if every descendant is axis-aligned with the group. */
export function canScaleNonUniform(doc: ModelDocument, groupId: ObjectId): boolean {
  const gInv = worldMatrix(doc, groupId).invert();
  const q = new THREE.Quaternion();
  const ids = descendantShapes(doc, [groupId]).map((s) => s.id);
  return ids.every((id) => {
    worldMatrix(doc, id).premultiply(gInv).decompose(new THREE.Vector3(), q, new THREE.Vector3());
    return isAxisAligned(q);
  });
}

/**
 * Scale a group by per-axis factors in its own frame, about the bottom-centre
 * of its bounds (so it stays on the workplane). Sizes and positions of all
 * descendants are rewritten — no scale factor is stored anywhere.
 * `base` is the unscaled document (so a drag never accumulates error).
 */
export function scaleGroupDraft(doc: ModelDocument, base: ModelDocument, groupId: ObjectId, factors: Vec3) {
  let f = factors;
  // Always start from the unscaled state so repeated calls (gizmo drags) never accumulate.
  doc.objects[groupId].transform = JSON.parse(JSON.stringify(base.objects[groupId].transform));
  if (!canScaleNonUniform(base, groupId)) {
    const u = factors.reduce((best, v) => (Math.abs(v - 1) > Math.abs(best - 1) ? v : best), 1);
    f = [u, u, u];
  }
  const b = groupLocalBounds(base, groupId);
  const anchor = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.min.z);

  const scaleChildren = (gid: ObjectId, fac: Vec3, anchorLocal: THREE.Vector3) => {
    const g = base.objects[gid];
    if (g.kind !== 'group') return;
    for (const cid of g.children) {
      const c = base.objects[cid];
      const p = c.transform.position;
      const np: Vec3 = [
        roundTo(anchorLocal.x + (p[0] - anchorLocal.x) * fac[0]),
        roundTo(anchorLocal.y + (p[1] - anchorLocal.y) * fac[1]),
        roundTo(anchorLocal.z + (p[2] - anchorLocal.z) * fac[2]),
      ];
      const draft = doc.objects[cid];
      draft.transform.position = np;
      const q = new THREE.Quaternion().setFromEuler(eulerFromDegrees(c.transform.rotation));
      const childFac = factorsInChild(fac, q);
      if (c.kind === 'shape' && draft.kind === 'shape') {
        draft.size = c.size.map((v, i) => roundTo(Math.max(0.01, v * childFac[i]))) as Vec3;
      } else if (c.kind === 'group') {
        // Grandchildren scale about the child group's own origin.
        scaleChildren(cid, childFac, new THREE.Vector3());
      }
    }
  };
  scaleChildren(groupId, f, anchor);
  recenterGroupDraft(doc, groupId);
}

// ---------- mirror ----------

/**
 * Mirror objects across the plane through `center` perpendicular to the world
 * `axis`. Each node's new world matrix is M·W·F, where F reflects the node's
 * local axis most aligned with the mirror normal: this keeps every transform
 * a proper rotation, and shapes absorb F as a genuine geometry reflection.
 */
export function mirrorDraft(doc: ModelDocument, ids: ObjectId[], axis: Axis, center: THREE.Vector3) {
  const items = topLevel(doc, ids);
  const normal = new THREE.Vector3().setComponent(axis, 1);
  const M = new THREE.Matrix4()
    .makeTranslation(center.x, center.y, center.z)
    .multiply(new THREE.Matrix4().makeScale(axis === 0 ? -1 : 1, axis === 1 ? -1 : 1, axis === 2 ? -1 : 1))
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));

  // Compute every node's new world matrix first, from the unmodified document.
  const order: ObjectId[] = [];
  const visit = (id: ObjectId) => {
    order.push(id);
    const o = doc.objects[id];
    if (o.kind === 'group') o.children.forEach(visit);
  };
  items.forEach(visit);

  const newWorld = new Map<ObjectId, THREE.Matrix4>();
  const flipAxis = new Map<ObjectId, Axis>();
  for (const id of order) {
    const W = worldMatrix(doc, id);
    const q = new THREE.Quaternion();
    W.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    const localN = normal.clone().applyQuaternion(q.clone().invert());
    const abs = [Math.abs(localN.x), Math.abs(localN.y), Math.abs(localN.z)];
    const k = abs.indexOf(Math.max(...abs)) as Axis;
    const F = new THREE.Matrix4().makeScale(k === 0 ? -1 : 1, k === 1 ? -1 : 1, k === 2 ? -1 : 1);
    newWorld.set(id, M.clone().multiply(W).multiply(F));
    flipAxis.set(id, k);
  }

  // Write back top-down so each parent is already updated.
  for (const id of order) {
    const o = doc.objects[id];
    const parentWorld = o.parentId && newWorld.has(o.parentId) ? newWorld.get(o.parentId)! : parentWorldMatrix(doc, id);
    o.transform = matrixToTransform(parentWorld.clone().invert().multiply(newWorld.get(id)!));
    if (o.kind === 'shape') {
      const m: Vec3 = [...(o.mirror ?? [1, 1, 1])] as Vec3;
      m[flipAxis.get(id)!] *= -1;
      o.mirror = m;
    }
  }
}

// ---------- align / distribute ----------

/**
 * Align objects along a world axis. With 2+ objects the reference is their
 * combined bounds; a single object aligns to the workplane.
 */
export function alignDraft(doc: ModelDocument, ids: ObjectId[], axis: Axis, mode: 'min' | 'center' | 'max') {
  const items = topLevel(doc, ids);
  if (!items.length) return;
  let refMin: number;
  let refMax: number;
  if (items.length === 1) {
    // A single object aligns to the workplane: its edges on X/Y, the plate surface on Z.
    const half = axis === 2 ? 0 : doc.settings.workplane[axis] / 2;
    refMin = -half;
    refMax = half;
  } else {
    const all = worldBoundsOf(doc, items);
    refMin = all.min.getComponent(axis);
    refMax = all.max.getComponent(axis);
  }
  for (const id of items) {
    const b = worldBoundsOf(doc, [id]);
    const lo = b.min.getComponent(axis);
    const hi = b.max.getComponent(axis);
    const d = mode === 'min' ? refMin - lo : mode === 'max' ? refMax - hi : (refMin + refMax) / 2 - (lo + hi) / 2;
    if (Math.abs(d) > 1e-9) translateWorldDraft(doc, id, new THREE.Vector3().setComponent(axis, d));
  }
}

/** Space 3+ objects so the gaps between them along a world axis are equal. */
export function distributeDraft(doc: ModelDocument, ids: ObjectId[], axis: Axis) {
  const items = topLevel(doc, ids);
  if (items.length < 3) return;
  const entries = items
    .map((id) => ({ id, b: worldBoundsOf(doc, [id]) }))
    .sort((a, b) => a.b.min.getComponent(axis) + a.b.max.getComponent(axis) - (b.b.min.getComponent(axis) + b.b.max.getComponent(axis)));
  const first = entries[0].b.min.getComponent(axis);
  const last = entries[entries.length - 1].b.max.getComponent(axis);
  const total = entries.reduce((s, e) => s + e.b.max.getComponent(axis) - e.b.min.getComponent(axis), 0);
  const gap = (last - first - total) / (entries.length - 1);
  let cursor = first;
  for (const e of entries) {
    const d = cursor - e.b.min.getComponent(axis);
    if (Math.abs(d) > 1e-9) translateWorldDraft(doc, e.id, new THREE.Vector3().setComponent(axis, d));
    cursor += e.b.max.getComponent(axis) - e.b.min.getComponent(axis) + gap;
  }
}

/** Lowest world Z of the objects' geometry. */
export function dropToWorkplaneDraft(doc: ModelDocument, ids: ObjectId[]) {
  for (const id of topLevel(doc, ids)) {
    if (isEffectivelyLocked(doc, id)) continue;
    const minZ = worldBoundsOf(doc, [id]).min.z;
    if (Math.abs(minZ) > 1e-9) translateWorldDraft(doc, id, new THREE.Vector3(0, 0, -minZ));
  }
}
