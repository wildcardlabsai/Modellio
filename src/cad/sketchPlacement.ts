/**
 * Sketch placements in the document (schema 3): which bodies sit on a placed sketch, putting them
 * there, and keeping them there. A body built from a placed sketch has its position and rotation
 * set by the sketch's frame; nothing else may move it (detach the sketch to move it freely).
 */
import * as THREE from 'three';
import { produce, type Draft } from 'immer';
import type { ModelDocument, ObjectId, PlaneId, ShapeObject, SketchId, SketchRecord } from '@/types/document';
import { worldMatrix } from './hierarchy';
import { bodyTransformOnFrame, sameTransform } from './placement';
import { meshDataBounds } from './kernel/meshData';
import { getProfileMesh } from './shapeRegistry';
import { sketchRecords, sketchUsers } from './sketchRecords';
import { matrixToTransform } from './transforms/transform';

/** The record a body is placed by (placed, resolved and not broken), or null. */
export function placingRecord(doc: ModelDocument, objectId: ObjectId): SketchRecord | null {
  const o = doc.objects[objectId];
  if (o?.kind !== 'shape' || o.shape !== 'profile' || !o.sketchId) return null;
  const rec = sketchRecords(doc)[o.sketchId];
  return rec?.placement && rec.frame && !rec.broken ? rec : null;
}

/** Records placed on a reference plane. */
export const planeUsers = (doc: ModelDocument, planeId: PlaneId) =>
  Object.values(sketchRecords(doc)).filter((r) => r.placement?.kind === 'plane' && r.placement.planeId === planeId);

/** The profile mesh's box centre (mesh coordinates): where the body's centre sits on the frame. Null until the kernel loads. */
export function profileAnchor(o: Pick<ShapeObject, 'sketch' | 'params'>): [number, number, number] | null {
  const mesh = getProfileMesh(o);
  if (!mesh) return null;
  const c = meshDataBounds(mesh).getCenter(new THREE.Vector3());
  return [c.x, c.y, c.z];
}

/** Where a placed record's body should be (its local transform), or null when it can't be worked out yet. */
export function placedTransform(doc: ModelDocument, rec: SketchRecord, body: ShapeObject) {
  if (!rec.frame) return null;
  const anchor = profileAnchor(body);
  if (!anchor) return null;
  const parent = body.parentId ? worldMatrix(doc, body.parentId) : undefined;
  return bodyTransformOnFrame(rec.frame, (body.params.op ?? 0) >= 1, anchor, parent);
}

/** Put every body built from record `recId` on its frame (inside a document recipe). */
export function placeBodiesDraft(d: Draft<ModelDocument>, recId: SketchId) {
  const doc = d as ModelDocument;
  const rec = sketchRecords(doc)[recId];
  if (!rec?.placement || !rec.frame || rec.broken) return;
  for (const u of sketchUsers(doc, recId)) {
    const t = placedTransform(doc, rec, u);
    if (t && !sameTransform(t, u.transform)) (d.objects[u.id] as ShapeObject).transform = t;
  }
}

/**
 * Keep placed bodies where their sketches put them: any change to `next` that would move one in
 * the world (a drag, nudge, align or typed position) is undone for that body, and its name is
 * returned so the user can be told. Changes that keep it where it is (grouping) are allowed.
 */
export function guardPlacedBodies(prev: ModelDocument, next: ModelDocument): { doc: ModelDocument; blocked: string[] } {
  const blocked: string[] = [];
  const fixes: { id: ObjectId; world: THREE.Matrix4 }[] = [];
  for (const rec of Object.values(sketchRecords(next))) {
    if (!rec.placement || !rec.frame || rec.broken) continue;
    for (const u of sketchUsers(next, rec.id)) {
      const before = prev.objects[u.id];
      if (!before || before.kind !== 'shape' || before.sketchId !== u.sketchId) continue;
      // Only bodies that were placed by this same record before the change.
      const was = placingRecord(prev, u.id);
      if (!was || was.id !== rec.id) continue;
      const w0 = worldMatrix(prev, u.id);
      const w1 = worldMatrix(next, u.id);
      if (sameTransform(matrixToTransform(w0), matrixToTransform(w1))) continue;
      fixes.push({ id: u.id, world: w0 });
      if (before.transform !== u.transform) blocked.push(u.name);
    }
  }
  if (!fixes.length) return { doc: next, blocked };
  const doc = produce(next, (d) => {
    for (const f of fixes) {
      const o = d.objects[f.id];
      const parent = o.parentId ? worldMatrix(d as ModelDocument, o.parentId) : null;
      o.transform = matrixToTransform(parent ? parent.clone().invert().multiply(f.world) : f.world);
    }
  });
  return { doc, blocked };
}

/** Words for where a record sits ("On Plane 1", "On a face of Box"), or null when it is free. */
export function placementLabel(doc: ModelDocument, rec: SketchRecord): string | null {
  const p = rec.placement;
  if (!p) return null;
  if (p.kind === 'plane') return `On ${doc.planes?.[p.planeId]?.name ?? 'a deleted plane'}`;
  return `On a face of ${doc.objects[p.objectId]?.name ?? 'a deleted body'}`;
}
