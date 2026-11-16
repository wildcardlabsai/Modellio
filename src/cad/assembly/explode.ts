/**
 * Exploded views (schema 4): named arrangements that pull parts of an assembly apart, step by
 * step, to show how it goes together. They are display only: an offset is added when the scene is
 * drawn, so positions, joints, Booleans, export and print checks always use the assembled design.
 * Saved with the project.
 */
import * as THREE from 'three';
import { produce } from 'immer';
import type { ExplodeStep, ExplodeView, ModelDocument, ObjectId, Vec3 } from '@/types/document';
import { worldBoundsOf } from '../hierarchy';

/**
 * The world-space offset of each moved object at `progress` (0 = assembled, n = the first n steps
 * done; fractions move part-way through a step). Steps add up when one object moves in several.
 */
export function explodeOffsets(view: ExplodeView, progress: number): Map<ObjectId, Vec3> {
  const out = new Map<ObjectId, Vec3>();
  view.steps.forEach((s, i) => {
    const t = Math.max(0, Math.min(1, progress - i));
    if (t <= 0) return;
    for (const id of s.objectIds) {
      const o = out.get(id) ?? [0, 0, 0];
      out.set(id, [o[0] + s.offset[0] * t, o[1] + s.offset[1] * t, o[2] + s.offset[2] * t]);
    }
  });
  return out;
}

/**
 * Steps that spread `ids` out from their common centre: each part moves away from the middle of
 * the assembly by its own distance (the radial explode of Split Studio, per part), the furthest
 * parts first.
 */
export function autoExplodeSteps(doc: ModelDocument, ids: ObjectId[], newId: () => string): ExplodeStep[] {
  if (ids.length < 2) return [];
  const all = worldBoundsOf(doc, ids);
  const centre = all.getCenter(new THREE.Vector3());
  const size = all.getSize(new THREE.Vector3()).length();
  const parts = ids.map((id) => {
    const b = worldBoundsOf(doc, [id]);
    const c = b.getCenter(new THREE.Vector3());
    let d = c.clone().sub(centre);
    // A part at the very centre moves up.
    if (d.lengthSq() < 1e-6) d = new THREE.Vector3(0, 0, 1);
    const dir = d.clone().normalize();
    const reach = b.getSize(new THREE.Vector3()).length() * 0.6 + size * 0.25;
    return { id, dist: c.distanceTo(centre), offset: dir.multiplyScalar(reach).toArray() as Vec3 };
  });
  parts.sort((a, b) => b.dist - a.dist);
  return parts.map((p) => ({ id: newId(), objectIds: [p.id], offset: p.offset.map((v) => Math.round(v * 100) / 100) as Vec3 }));
}

/** Drop deleted objects from exploded views (and steps left empty). */
export function pruneExplodeViews(doc: ModelDocument): ModelDocument {
  const views = doc.explodeViews;
  if (!views || !Object.values(views).some((v) => v.steps.some((s) => s.objectIds.some((id) => !doc.objects[id])))) return doc;
  return produce(doc, (d) => {
    for (const v of Object.values(d.explodeViews!))
      v.steps = v.steps
        .map((s) => ({ ...s, objectIds: s.objectIds.filter((id) => !!d.objects[id]) }))
        .filter((s) => s.objectIds.length > 0);
  });
}
