import * as THREE from 'three';
import type { ModelDocument, ObjectId, ShapeObject } from '@/types/document';
import {
  descendantShapes,
  groupDraft,
  moveObjectsDraft,
  setWorldMatrixDraft,
  translateWorldDraft,
  worldBoundsOf,
  worldMatrix,
} from './hierarchy';
import { duplicateObjectsDraft, uniqueName } from './document';
import { createId } from '@/utils/id';
import { roundTo } from '@/utils/math';

export type UndersideMode = 'engrave' | 'inlay';

/** Extra depth below the part so cuts break cleanly through its bottom face. */
const OVERSHOOT = 0.02;

/** White on dark parts, near-black on light ones. */
function contrast(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16) || 0;
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 140 ? '#1D1D1F' : '#F4F4F2';
}

/** The visible root object (not one of `exclude`) whose footprint overlaps `box` the most. */
export function partUnder(doc: ModelDocument, box: THREE.Box3, exclude: Set<ObjectId>): ObjectId | null {
  let best: ObjectId | null = null;
  let bestArea = 0;
  for (const id of doc.rootIds) {
    if (exclude.has(id) || !doc.objects[id]?.visible) continue;
    const b = worldBoundsOf(doc, [id]);
    const w = Math.min(b.max.x, box.max.x) - Math.max(b.min.x, box.min.x);
    const h = Math.min(b.max.y, box.max.y) - Math.max(b.min.y, box.min.y);
    if (w > 0 && h > 0 && w * h > bestArea) [best, bestArea] = [id, w * h];
  }
  return best;
}

/** Set a shape's world height (along world Z) when its own Z axis is vertical. */
function setHeight(doc: ModelDocument, id: ObjectId, height: number) {
  const o = doc.objects[id];
  if (o?.kind !== 'shape') return;
  const z = new THREE.Vector3(0, 0, 1).transformDirection(worldMatrix(doc, id));
  if (Math.abs(Math.abs(z.z) - 1) > 1e-3) return;
  o.size = [o.size[0], o.size[1], roundTo(Math.max(0.05, height))];
}

/** Rotate 180° about the world Y axis through the object's centre: face down, still readable from below. */
function flipFaceDown(doc: ModelDocument, id: ObjectId) {
  // Already face down (sent to the underside before): don't turn it back up.
  if (new THREE.Vector3(0, 0, 1).transformDirection(worldMatrix(doc, id)).z < -0.5) return;
  const c = worldBoundsOf(doc, [id]).getCenter(new THREE.Vector3());
  const m = new THREE.Matrix4()
    .makeTranslation(c.x, c.y, c.z)
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z))
    .multiply(worldMatrix(doc, id));
  setWorldMatrixDraft(doc, id, m);
}

/** Put the object's world bounds at z ∈ [bottom, …]. */
function sitAt(doc: ModelDocument, id: ObjectId, bottom: number) {
  const b = worldBoundsOf(doc, [id]);
  translateWorldDraft(doc, id, new THREE.Vector3(0, 0, bottom - b.min.z));
}

/** Join a hole into the part: into the part's union group, or a new union group with it. */
function cutInto(doc: ModelDocument, part: ObjectId, hole: ObjectId): ObjectId {
  for (const s of descendantShapes(doc, [hole])) (doc.objects[s.id] as ShapeObject).isHole = true;
  const p = doc.objects[part];
  if (p.kind === 'group' && p.combine === 'union') {
    moveObjectsDraft(doc, [hole], part, p.children.length);
    return part;
  }
  const gid = createId('grp');
  groupDraft(doc, [part, hole], { id: gid, name: uniqueName(doc, p.name) });
  const g = doc.objects[gid];
  if (g?.kind === 'group') g.combine = 'union';
  return gid;
}

/**
 * Send text, a logo or a shape to the underside of the part below it, for double-sided prints.
 * The item is turned face down (180° about Y, so it reads correctly when the print is turned
 * over) and set `depth` mm into the part's bottom face:
 *  - engrave: it becomes a hole cut into the bottom;
 *  - inlay:   it stays a solid filling a matching pocket, flush with the bottom (a second colour
 *             printed in the first layers).
 * Returns the ids to select and a message when something could not be done.
 */
export function placeOnUndersideDraft(
  doc: ModelDocument,
  ids: ObjectId[],
  mode: UndersideMode,
  depth: number,
): { selection: ObjectId[]; message?: string } {
  const roots = ids.filter((id) => doc.objects[id] && doc.objects[id].parentId === null);
  if (!roots.length) return { selection: ids, message: 'Select text, a logo or a shape that is not inside a group.' };
  const exclude = new Set(roots);
  const selection: ObjectId[] = [];
  let skipped = 0;
  for (const id of roots) {
    const part = partUnder(doc, worldBoundsOf(doc, [id]), exclude);
    if (!part) {
      skipped++;
      continue;
    }
    const pb = worldBoundsOf(doc, [part]);
    // Leave at least 0.4 mm of the part above the cut.
    const d = Math.min(depth, Math.max(0.2, pb.max.z - pb.min.z - 0.4));
    flipFaceDown(doc, id);
    if (mode === 'engrave') {
      setHeight(doc, id, d + OVERSHOOT);
      sitAt(doc, id, pb.min.z - OVERSHOOT);
      selection.push(cutInto(doc, part, id));
    } else {
      setHeight(doc, id, d);
      sitAt(doc, id, pb.min.z);
      const o = doc.objects[id];
      if (o.kind === 'shape' && o.isHole) o.isHole = false;
      // A flush inlay only shows if it is a different colour from the part.
      const partColour = descendantShapes(doc, [part])
        .find((x) => !x.isHole)
        ?.color?.toLowerCase();
      for (const sh of descendantShapes(doc, [id]))
        if (sh.color.toLowerCase() === partColour) (doc.objects[sh.id] as ShapeObject).color = contrast(partColour);
      // The pocket: a copy of the item cut into the part, reaching just below its bottom.
      const [pocket] = duplicateObjectsDraft(doc, [id], [0, 0, 0]);
      setHeight(doc, pocket, d + OVERSHOOT);
      sitAt(doc, pocket, pb.min.z - OVERSHOOT);
      doc.objects[pocket].name = uniqueName(doc, `${doc.objects[id].name} pocket`);
      cutInto(doc, part, pocket);
      selection.push(id);
    }
  }
  const message = skipped
    ? `${skipped === roots.length ? 'Nothing was' : `${skipped} item${skipped > 1 ? 's were' : ' was'} not`} moved: put it over the part whose underside it should go on.`
    : undefined;
  return { selection: selection.length ? selection : ids, message };
}
