import * as THREE from 'three';
import type { ModelDocument, ObjectId, PrimitiveType, SceneObject, ShapeObject, Vec3 } from '@/types/document';
import { getShapeDefinition } from './shapeRegistry';
import { worldBounds } from './transforms/transform';
import { createId } from '@/utils/id';
import { MIN_DIMENSION } from './geometry/geometryUtils';
import { roundTo } from '@/utils/math';

/**
 * Pure document operations. Functions named `*Draft` mutate an Immer draft;
 * the rest are read-only queries. No React, no Three.js scene state.
 */

export function createEmptyDocument(): ModelDocument {
  return { schemaVersion: 1, objects: {}, rootIds: [], settings: { units: 'mm', workplane: [200, 200] } };
}

export function uniqueName(doc: ModelDocument, base: string): string {
  const names = new Set(Object.values(doc.objects).map((o) => o.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export function createShape(doc: ModelDocument, type: PrimitiveType, position?: Vec3): ShapeObject {
  const def = getShapeDefinition(type);
  const size: Vec3 = [...def.defaultSize];
  return {
    id: createId(),
    kind: 'shape',
    name: uniqueName(doc, def.label),
    shape: type,
    params: { ...def.defaultParams },
    size,
    color: def.defaultColor,
    isHole: false,
    transform: { position: position ?? [0, 0, size[2] / 2], rotation: [0, 0, 0] },
    visible: true,
    locked: false,
    parentId: null,
  };
}

/**
 * Find a free spot on the workplane for a new shape near `preferred`, stepping
 * outwards in a spiral so clicked shapes don't stack inside each other.
 */
export function findFreePosition(doc: ModelDocument, size: Vec3, preferred: [number, number] = [0, 0]): Vec3 {
  const others = Object.values(doc.objects)
    .filter((o): o is ShapeObject => o.kind === 'shape' && o.visible)
    .map((o) => worldBounds(o));
  const step = Math.max(size[0], size[1]) + 5;
  const candidate = (x: number, y: number): Vec3 => [roundTo(x), roundTo(y), size[2] / 2];
  const fits = (p: Vec3) => {
    const b = new THREE.Box3(
      new THREE.Vector3(p[0] - size[0] / 2, p[1] - size[1] / 2, 0),
      new THREE.Vector3(p[0] + size[0] / 2, p[1] + size[1] / 2, size[2]),
    );
    return !others.some((o) => o.intersectsBox(b));
  };
  const [px, py] = preferred;
  if (fits(candidate(px, py))) return candidate(px, py);
  for (let ring = 1; ring <= 8; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
        const c = candidate(px + dx * step, py + dy * step);
        if (fits(c)) return c;
      }
    }
  }
  return candidate(px, py);
}

export function addObjectDraft(doc: ModelDocument, obj: SceneObject) {
  doc.objects[obj.id] = obj;
  if (obj.parentId && doc.objects[obj.parentId]?.kind === 'group') {
    (doc.objects[obj.parentId] as { children: ObjectId[] }).children.push(obj.id);
  } else {
    doc.rootIds.push(obj.id);
  }
}

/** All ids in the subtree rooted at each given id (including the ids themselves). */
export function collectSubtree(doc: ModelDocument, ids: ObjectId[]): ObjectId[] {
  const out: ObjectId[] = [];
  const visit = (id: ObjectId) => {
    const o = doc.objects[id];
    if (!o || out.includes(id)) return;
    out.push(id);
    if (o.kind === 'group') o.children.forEach(visit);
  };
  ids.forEach(visit);
  return out;
}

export function removeObjectsDraft(doc: ModelDocument, ids: ObjectId[]) {
  const all = new Set(collectSubtree(doc, ids));
  for (const id of all) {
    const o = doc.objects[id];
    if (o?.parentId) {
      const parent = doc.objects[o.parentId];
      if (parent?.kind === 'group') parent.children = parent.children.filter((c) => c !== id);
    }
    delete doc.objects[id];
  }
  doc.rootIds = doc.rootIds.filter((id) => !all.has(id));
}

/**
 * Deep-copy objects (and their descendants). Returns the ids of the new
 * top-level copies, in the same order as `ids`.
 */
export function duplicateObjectsDraft(doc: ModelDocument, ids: ObjectId[], offset: Vec3): ObjectId[] {
  const created: ObjectId[] = [];
  const copy = (id: ObjectId, parentId: ObjectId | null, top: boolean): ObjectId => {
    const src = doc.objects[id];
    const newId = createId();
    const clone: SceneObject = JSON.parse(JSON.stringify(src));
    clone.id = newId;
    clone.parentId = parentId;
    clone.name = uniqueName(doc, src.name.replace(/ \d+$/, ''));
    if (top) {
      clone.transform.position = [
        roundTo(clone.transform.position[0] + offset[0]),
        roundTo(clone.transform.position[1] + offset[1]),
        roundTo(clone.transform.position[2] + offset[2]),
      ];
    }
    if (clone.kind === 'group') clone.children = [];
    addObjectDraft(doc, clone);
    if (src.kind === 'group') src.children.forEach((c) => copy(c, newId, false));
    return newId;
  };
  for (const id of ids) {
    if (!doc.objects[id]) continue;
    created.push(copy(id, doc.objects[id].parentId, true));
  }
  return created;
}

export function clampSize(size: Vec3): Vec3 {
  return size.map((v) => roundTo(Math.max(MIN_DIMENSION, Math.abs(v)))) as Vec3;
}

/**
 * Resize keeping proportions: the edited axis gets `value`, the others scale
 * by the same factor.
 */
export function proportionalSize(current: Vec3, axis: 0 | 1 | 2, value: number): Vec3 {
  const factor = Math.max(MIN_DIMENSION, value) / current[axis];
  return clampSize(current.map((v, i) => (i === axis ? value : v * factor)) as Vec3);
}

export function getShape(doc: ModelDocument, id: ObjectId): ShapeObject | undefined {
  const o = doc.objects[id];
  return o?.kind === 'shape' ? o : undefined;
}
