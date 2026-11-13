import * as THREE from 'three';
import type { Manifold } from 'manifold-3d';
import type { ModelDocument, ObjectId, SceneObject, ShapeObject, Vec3 } from '@/types/document';
import { getKernel } from '../kernel/kernel';
import {
  centerMeshData,
  geometryToMeshData,
  manifoldToMeshData,
  meshDataBounds,
  meshDataToManifold,
  type MeshData,
} from '../kernel/meshData';
import { buildGeometryForShape } from '../shapeRegistry';
import { setCombinedBoundsResolver, siblingsOf, worldMatrix } from '../hierarchy';
import { addMeshAsset } from '../assets';
import { matrixToTransform, transformToMatrix } from '../transforms/transform';
import { createId } from '@/utils/id';
import { roundTo } from '@/utils/math';

/**
 * Live Boolean evaluation of combined groups.
 *
 *   result = (union | intersection)(solids) − union(holes)
 *
 * Parts stay fully editable; the result is recomputed from them by the
 * Manifold kernel (guaranteed watertight output) and cached by a key derived
 * from everything that affects geometry, so undo/redo and re-renders are free.
 */
export interface CombineResult {
  /** Result mesh in the group's LOCAL frame, or null on error / empty. */
  mesh: MeshData | null;
  error: string | null;
  /** Bounds of the result in the group's local frame (empty if no result). */
  bounds: THREE.Box3;
  /** Colour of the first solid part (used to render the result). */
  color: string;
  /** True when the group contains only holes: the result itself acts as a hole. */
  isHole: boolean;
  triangles: number;
}

class PendingError extends Error {}

const cache = new Map<string, CombineResult>();
const CACHE_LIMIT = 64;

/** Everything in a subtree that affects geometry (colour and names excluded). */
function geometryKey(doc: ModelDocument, groupId: ObjectId): string {
  const parts: unknown[] = [];
  const visit = (id: ObjectId) => {
    const o = doc.objects[id];
    if (!o) return;
    if (o.kind === 'shape') {
      parts.push([id, o.visible, o.transform, o.shape, o.size, o.params, o.mirror, o.text, o.meshId, o.isHole]);
    } else {
      parts.push([id, o.visible, o.transform, o.combine, o.children.length]);
      o.children.forEach(visit);
    }
  };
  visit(groupId);
  return JSON.stringify(parts);
}

function firstSolidColor(doc: ModelDocument, id: ObjectId): string | null {
  const o = doc.objects[id];
  if (!o || !o.visible) return null;
  if (o.kind === 'shape') return o.isHole ? null : o.color;
  for (const c of o.children) {
    const col = firstSolidColor(doc, c);
    if (col) return col;
  }
  return null;
}

function transformMesh(data: MeshData, m: THREE.Matrix4): MeshData {
  const positions = new Float32Array(data.positions.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    v.set(data.positions[i], data.positions[i + 1], data.positions[i + 2]).applyMatrix4(m);
    positions[i] = v.x;
    positions[i + 1] = v.y;
    positions[i + 2] = v.z;
  }
  return { positions, indices: data.indices };
}

/**
 * Evaluate a combined group. Returns null while something it depends on is
 * still loading (kernel or a font); otherwise a result or a readable error.
 */
export function computeCombined(doc: ModelDocument, groupId: ObjectId): CombineResult | null {
  const group = doc.objects[groupId];
  if (!group || group.kind !== 'group' || !group.combine) return null;
  const k = getKernel();
  if (!k) return null;

  const key = geometryKey(doc, groupId);
  const color = firstSolidColor(doc, groupId) ?? '#94A3B8';
  const hit = cache.get(key);
  if (hit) return hit.color === color ? hit : { ...hit, color };

  const owned: Manifold[] = [];
  const own = (m: Manifold) => {
    owned.push(m);
    return m;
  };
  const frameInv = worldMatrix(doc, groupId).invert();
  const solids: Manifold[] = [];
  const holes: Manifold[] = [];

  const collect = (id: ObjectId) => {
    const o: SceneObject | undefined = doc.objects[id];
    if (!o || !o.visible) return;
    const rel = frameInv.clone().multiply(worldMatrix(doc, id));
    if (o.kind === 'shape') {
      const geo = buildGeometryForShape(o);
      if (!geo) throw new PendingError();
      const data = geometryToMeshData(geo, rel);
      geo.dispose();
      let m: Manifold;
      try {
        m = own(meshDataToManifold(k, data));
      } catch {
        throw new Error(`“${o.name}” is not a closed solid, so it can't be combined.`);
      }
      if (m.status() !== 'NoError') throw new Error(`“${o.name}” is not a closed solid (${m.status()}).`);
      (o.isHole ? holes : solids).push(m);
      return;
    }
    if (o.combine) {
      const sub = computeCombined(doc, id);
      if (!sub) throw new PendingError();
      if (sub.error) throw new Error(`${o.name}: ${sub.error}`);
      if (!sub.mesh) return;
      const m = own(meshDataToManifold(k, transformMesh(sub.mesh, rel)));
      (sub.isHole ? holes : solids).push(m);
      return;
    }
    o.children.forEach(collect);
  };

  let result: CombineResult;
  try {
    group.children.forEach(collect);
    let isHole = false;
    let base: Manifold | null;
    if (solids.length) {
      base = own(group.combine === 'intersect' ? k.Manifold.intersection(solids) : k.Manifold.union(solids));
      if (holes.length) base = own(base.subtract(own(k.Manifold.union(holes))));
    } else if (holes.length) {
      base = own(k.Manifold.union(holes));
      isHole = true;
    } else {
      base = null;
    }
    if (!base || base.isEmpty()) {
      result = {
        mesh: null,
        error: solids.length ? 'Nothing is left: the result of this combination is empty.' : 'This group has no visible parts.',
        bounds: new THREE.Box3(),
        color,
        isHole,
        triangles: 0,
      };
    } else {
      const mesh = manifoldToMeshData(base);
      result = { mesh, error: null, bounds: meshDataBounds(mesh), color, isHole, triangles: mesh.indices.length / 3 };
    }
  } catch (e) {
    if (e instanceof PendingError) return null;
    result = {
      mesh: null,
      error: e instanceof Error ? e.message : String(e),
      bounds: new THREE.Box3(),
      color,
      isHole: false,
      triangles: 0,
    };
  } finally {
    owned.forEach((m) => m.delete());
  }

  cache.set(key, result);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return result;
}

setCombinedBoundsResolver((doc, id) => computeCombined(doc, id)?.bounds ?? null);

// ---------- destructive operations ----------

/**
 * Replace a combined group by a single mesh shape with the same world
 * placement ("Flatten to mesh"). Returns the new shape id, or null.
 */
export function bakeGroupDraft(doc: ModelDocument, groupId: ObjectId, name: string): ObjectId | null {
  const g = doc.objects[groupId];
  if (!g || g.kind !== 'group' || !g.combine) return null;
  const r = computeCombined(doc, groupId);
  if (!r?.mesh) return null;
  const { mesh, center, size } = centerMeshData(r.mesh);
  const meshId = addMeshAsset(mesh);
  const local = transformToMatrix(g.transform).multiply(new THREE.Matrix4().makeTranslation(center.x, center.y, center.z));
  const id = createId();
  const shape: ShapeObject = {
    id,
    kind: 'shape',
    name,
    shape: 'mesh',
    meshId,
    params: {},
    size: [roundTo(size.x), roundTo(size.y), roundTo(size.z)],
    color: r.color,
    isHole: r.isHole,
    transform: matrixToTransform(local),
    visible: g.visible,
    locked: false,
    parentId: g.parentId,
  };
  replaceInTreeDraft(doc, groupId, [shape]);
  return id;
}

/**
 * Split a mesh shape into its disconnected solid parts. Each part becomes a
 * mesh shape in the same place. Returns the new ids (empty if only one part).
 */
export function separateDraft(doc: ModelDocument, id: ObjectId): ObjectId[] {
  const o = doc.objects[id];
  const k = getKernel();
  if (!k || !o || o.kind !== 'shape') return [];
  const geo = buildGeometryForShape(o);
  if (!geo) return [];
  const data = geometryToMeshData(geo);
  geo.dispose();
  const whole = meshDataToManifold(k, data);
  const parts = whole.decompose();
  try {
    if (parts.length < 2) return [];
    const base = transformToMatrix(o.transform);
    const created: ShapeObject[] = parts.map((p, i) => {
      const { mesh, center, size } = centerMeshData(manifoldToMeshData(p));
      const local = base.clone().multiply(new THREE.Matrix4().makeTranslation(center.x, center.y, center.z));
      return {
        id: createId(),
        kind: 'shape',
        name: `${o.name} ${i + 1}`,
        shape: 'mesh',
        meshId: addMeshAsset(mesh),
        params: {},
        size: [roundTo(size.x), roundTo(size.y), roundTo(size.z)] as Vec3,
        color: o.color,
        isHole: o.isHole,
        transform: matrixToTransform(local),
        visible: o.visible,
        locked: false,
        parentId: o.parentId,
      };
    });
    replaceInTreeDraft(doc, id, created);
    return created.map((c) => c.id);
  } finally {
    whole.delete();
    parts.forEach((p) => p.delete());
  }
}

function replaceInTreeDraft(doc: ModelDocument, oldId: ObjectId, replacements: SceneObject[]) {
  const old = doc.objects[oldId];
  const list = siblingsOf(doc, old.parentId);
  const index = list.indexOf(oldId);
  // remove the old subtree
  const stack = [oldId];
  while (stack.length) {
    const id = stack.pop()!;
    const o = doc.objects[id];
    if (o?.kind === 'group') stack.push(...o.children);
    delete doc.objects[id];
  }
  list.splice(index, 1, ...replacements.map((r) => r.id));
  for (const r of replacements) doc.objects[r.id] = r;
}
