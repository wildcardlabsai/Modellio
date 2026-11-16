/**
 * Standalone sketches (document schema 2). A sketch record exists on its own; profile bodies
 * reference it by `sketchId` and keep a resolved copy in `sketch`, so geometry, export and the
 * makers read bodies exactly as before. Edits go through the record and are written to every
 * body that uses it (see the editor store), so the copies cannot drift.
 */
import { current, isDraft } from 'immer';
import { createId } from '@/utils/id';
import { collectSubtree } from './document';
import type {
  Frame,
  ModelDocument,
  ObjectId,
  PlaneId,
  RefPlane,
  ShapeObject,
  SketchId,
  SketchPlacement,
  SketchRecord,
} from '@/types/document';
import { validFaceRef } from './brep/types';
import type { Sketch } from './sketch/types';

export const sketchRecords = (doc: ModelDocument): Record<SketchId, SketchRecord> => doc.sketches ?? {};

/** Profile bodies built from a sketch record. */
export function sketchUsers(doc: ModelDocument, sketchId: SketchId): ShapeObject[] {
  return Object.values(doc.objects).filter((o): o is ShapeObject => o.kind === 'shape' && o.shape === 'profile' && o.sketchId === sketchId);
}

/** A name not used by another sketch. */
export function uniqueSketchName(doc: ModelDocument, base: string): string {
  const names = new Set(Object.values(sketchRecords(doc)).map((r) => r.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/** Add a sketch record to a draft document and return its id. */
export function addSketchRecordDraft(d: ModelDocument, sketch: Sketch, name: string, id?: SketchId): SketchId {
  d.sketches ??= {};
  if (!id || d.sketches[id]) id = createId('sk');
  // The sketch may itself be part of the draft: take a plain copy.
  d.sketches[id] = { id, name: uniqueSketchName(d, name), sketch: structuredClone(isDraft(sketch) ? current(sketch) : sketch) };
  return id;
}

/**
 * Copies (duplicate, paste) get their own sketch, so they stay independent like before: editing
 * one never changes the other. A body whose record is missing (pasted from elsewhere) gets one
 * made from its own copy.
 */
export function forkSketchLinksDraft(d: ModelDocument, ids: ObjectId[], opts: { keepLinked?: boolean } = {}) {
  const keepLinked = opts.keepLinked ?? true;
  for (const id of collectSubtree(d, ids)) {
    const o = d.objects[id];
    if (o?.kind !== 'shape' || o.shape !== 'profile' || !o.sketch) continue;
    // Parts of linked component instances share their sketch (schema 4): editing it updates them all.
    if (keepLinked && o.defNode && insideInstance(d, id)) continue;
    const from = o.sketchId ? sketchRecords(d)[o.sketchId] : undefined;
    o.sketchId = addSketchRecordDraft(d, o.sketch, from?.name ?? `${o.name} sketch`);
  }
}

/** Whether an object is part of a component instance (a group with a componentId above it). */
function insideInstance(d: ModelDocument, id: ObjectId) {
  for (let o = d.objects[id]; o?.parentId;) {
    const p = d.objects[o.parentId];
    if (p?.kind === 'group' && p.componentId) return true;
    o = p;
  }
  return false;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSketch = (v: unknown): v is Sketch =>
  isObj(v) && Array.isArray(v.points) && Array.isArray(v.entities) && Array.isArray(v.constraints);

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
const isFrame = (v: unknown): v is Frame => isObj(v) && isVec3(v.origin) && isVec3(v.x) && isVec3(v.y);

function migratePlacement(v: unknown, planes: Record<PlaneId, RefPlane>): SketchPlacement | null {
  if (!isObj(v)) return null;
  if (v.kind === 'plane' && typeof v.planeId === 'string' && planes[v.planeId]) return { kind: 'plane', planeId: v.planeId };
  // A face placement whose body is gone is kept: it shows as a broken attachment, not silently dropped.
  if (v.kind === 'face' && typeof v.objectId === 'string' && validFaceRef(v.face))
    return { kind: 'face', objectId: v.objectId, face: v.face };
  return null;
}

/** Reference planes (schema 3): keep the well-formed ones. */
export function migratePlanes(raw: unknown): Record<PlaneId, RefPlane> {
  const out: Record<PlaneId, RefPlane> = {};
  if (!isObj(raw)) return out;
  for (const [id, p] of Object.entries(raw)) {
    if (!isObj(p) || p.id !== id || !['XY', 'XZ', 'YZ'].includes(p.base as string)) continue;
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    out[id] = {
      id,
      name: typeof p.name === 'string' && p.name ? p.name : 'Plane',
      base: p.base as RefPlane['base'],
      offset: num(p.offset),
      tilt: Math.max(-89, Math.min(89, num(p.tilt))),
      visible: p.visible !== false,
    };
  }
  return out;
}

/**
 * Bring a document's sketches to schema 2 (in place, on a freshly migrated document):
 * keep valid records, link every profile to one (creating records for version 1 profiles), and
 * drop links that point nowhere or disagree with the body's own copy.
 */
export function migrateSketchesDraft(doc: ModelDocument, raw: unknown) {
  const records: Record<SketchId, SketchRecord> = {};
  if (isObj(raw))
    for (const [id, r] of Object.entries(raw))
      if (isObj(r) && r.id === id && typeof r.name === 'string' && isSketch(r.sketch)) {
        const rec: SketchRecord = { id, name: r.name || 'Sketch', sketch: r.sketch };
        // Schema 3: a placement is kept only if it is well formed and what it names is valid.
        const placement = migratePlacement(r.placement, doc.planes ?? {});
        if (placement) {
          rec.placement = placement;
          if (isFrame(r.frame)) rec.frame = r.frame;
          if (typeof r.broken === 'string' && r.broken) rec.broken = r.broken;
        }
        records[id] = rec;
      }
  doc.sketches = records;
  for (const o of Object.values(doc.objects)) {
    if (o.kind !== 'shape') continue;
    if (o.shape !== 'profile' || !o.sketch) {
      delete o.sketchId;
      continue;
    }
    const linked = typeof o.sketchId === 'string' ? records[o.sketchId] : undefined;
    if (linked && JSON.stringify(linked.sketch) === JSON.stringify(o.sketch)) continue;
    // Version 1 body, a dangling link, or copies that disagree: the body's own copy wins (it is
    // what was built), in a record of its own.
    o.sketchId = addSketchRecordDraft(doc, o.sketch, `${o.name} sketch`, `sk_${o.id}`);
  }
}
