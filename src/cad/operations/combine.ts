import * as THREE from 'three';
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
import { runBoolean, type BooleanJob, type BooleanOutcome } from '../kernel/booleanCore';
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
  /** The previous result, shown while a new one is computed in the background. */
  stale?: boolean;
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
  if (hit) {
    lastByGroup.set(groupId, hit);
    return hit.color === color ? hit : { ...hit, color };
  }

  // While a new result is being computed in the worker, keep showing the previous one.
  const stale = () => {
    const last = lastByGroup.get(groupId);
    return last ? { ...last, color, stale: true } : null;
  };
  if (inflight.has(key)) return stale();

  // Prepare the job on this thread: every visible part as a welded mesh in the group's frame.
  let job: BooleanJob;
  try {
    job = prepareJob(doc, groupId);
  } catch (e) {
    if (e instanceof PendingError) return stale();
    return store(key, groupId, { mesh: null, error: e instanceof Error ? e.message : String(e), isHole: false }, color);
  }

  const worker = getWorker();
  if (worker) {
    inflight.set(key, { groupId, color });
    const transfer = job.parts.flatMap((p) => [p.mesh.positions.buffer, p.mesh.indices.buffer]);
    worker.postMessage({ key, job }, transfer);
    return stale();
  }
  return store(key, groupId, runBoolean(k, job), color);
}

function prepareJob(doc: ModelDocument, groupId: ObjectId): BooleanJob {
  const group = doc.objects[groupId] as Extract<SceneObject, { kind: 'group' }>;
  const frameInv = worldMatrix(doc, groupId).invert();
  const parts: BooleanJob['parts'] = [];
  const collect = (id: ObjectId) => {
    const o: SceneObject | undefined = doc.objects[id];
    if (!o || !o.visible) return;
    const rel = frameInv.clone().multiply(worldMatrix(doc, id));
    if (o.kind === 'shape') {
      const geo = buildGeometryForShape(o);
      if (!geo) throw new PendingError();
      parts.push({ name: o.name, mesh: geometryToMeshData(geo, rel), hole: o.isHole });
      geo.dispose();
      return;
    }
    if (o.combine) {
      const sub = computeCombined(doc, id);
      if (!sub || sub.stale) throw new PendingError();
      if (sub.error) throw new Error(`${o.name}: ${sub.error}`);
      if (!sub.mesh) return;
      // Copies: the job's buffers are transferred to the worker.
      parts.push({
        name: o.name,
        mesh: { positions: transformMesh(sub.mesh, rel).positions, indices: sub.mesh.indices.slice() },
        hole: sub.isHole,
      });
      return;
    }
    o.children.forEach(collect);
  };
  group.children.forEach(collect);
  return { mode: group.combine === 'intersect' ? 'intersect' : 'union', parts };
}

function store(key: string, groupId: ObjectId, outcome: BooleanOutcome, color: string): CombineResult {
  const result: CombineResult = {
    mesh: outcome.mesh,
    error: outcome.error,
    bounds: outcome.mesh ? meshDataBounds(outcome.mesh) : new THREE.Box3(),
    color,
    isHole: outcome.isHole,
    triangles: outcome.mesh ? outcome.mesh.indices.length / 3 : 0,
  };
  cache.set(key, result);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  lastByGroup.set(groupId, result);
  return result;
}

// ---------- background worker ----------

const inflight = new Map<string, { groupId: ObjectId; color: string }>();
const lastByGroup = new Map<ObjectId, CombineResult>();
const resultListeners = new Set<() => void>();
let worker: Worker | null | undefined;
let forceSync = false;

/** Run Booleans on the calling thread (tests, debugging). */
export function setBooleanSync(sync: boolean) {
  forceSync = sync;
}

/** Notified whenever a background result arrives (the UI re-renders). */
export function onCombineResult(cb: () => void): () => void {
  resultListeners.add(cb);
  return () => resultListeners.delete(cb);
}

export function booleanStats() {
  return { inFlight: inflight.size, worker: !!worker, cached: cache.size };
}

function getWorker(): Worker | null {
  if (forceSync) return null;
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined' || typeof window === 'undefined') return (worker = null);
  try {
    worker = new Worker(new URL('../kernel/boolean.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ key: string; outcome: BooleanOutcome }>) => {
      const job = inflight.get(e.data.key);
      inflight.delete(e.data.key);
      if (job) store(e.data.key, job.groupId, e.data.outcome, job.color);
      resultListeners.forEach((l) => l());
    };
    worker.onerror = () => {
      // Fall back to the main thread for everything from now on.
      console.warn('[modellio] Boolean worker failed; computing on the main thread.');
      worker?.terminate();
      worker = null;
      inflight.clear();
      resultListeners.forEach((l) => l());
    };
  } catch {
    worker = null;
  }
  return worker;
}

setCombinedBoundsResolver((doc, id) => {
  const r = computeCombined(doc, id);
  return r ? { bounds: r.bounds, positions: r.mesh?.positions } : null;
});

// ---------- destructive operations ----------

/**
 * Replace a combined group by a single mesh shape with the same world
 * placement ("Flatten to mesh"). Returns the new shape id, or null.
 */
export function bakeGroupDraft(doc: ModelDocument, groupId: ObjectId, name: string): ObjectId | null {
  const g = doc.objects[groupId];
  if (!g || g.kind !== 'group' || !g.combine) return null;
  const r = computeCombined(doc, groupId);
  if (!r?.mesh || r.stale) return null;
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
