/**
 * Standalone sketches (document schema 2). A sketch record exists on its own; profile bodies
 * reference it by `sketchId` and keep a resolved copy in `sketch`, so geometry, export and the
 * makers read bodies exactly as before. Edits go through the record and are written to every
 * body that uses it (see the editor store), so the copies cannot drift.
 */
import { current, isDraft } from 'immer';
import { createId } from '@/utils/id';
import { collectSubtree } from './document';
import type { ModelDocument, ObjectId, ShapeObject, SketchId, SketchRecord } from '@/types/document';
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
export function forkSketchLinksDraft(d: ModelDocument, ids: ObjectId[]) {
  for (const id of collectSubtree(d, ids)) {
    const o = d.objects[id];
    if (o?.kind !== 'shape' || o.shape !== 'profile' || !o.sketch) continue;
    const from = o.sketchId ? sketchRecords(d)[o.sketchId] : undefined;
    o.sketchId = addSketchRecordDraft(d, o.sketch, from?.name ?? `${o.name} sketch`);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSketch = (v: unknown): v is Sketch =>
  isObj(v) && Array.isArray(v.points) && Array.isArray(v.entities) && Array.isArray(v.constraints);

/**
 * Bring a document's sketches to schema 2 (in place, on a freshly migrated document):
 * keep valid records, link every profile to one (creating records for version 1 profiles), and
 * drop links that point nowhere or disagree with the body's own copy.
 */
export function migrateSketchesDraft(doc: ModelDocument, raw: unknown) {
  const records: Record<SketchId, SketchRecord> = {};
  if (isObj(raw))
    for (const [id, r] of Object.entries(raw))
      if (isObj(r) && r.id === id && typeof r.name === 'string' && isSketch(r.sketch))
        records[id] = { id, name: r.name || 'Sketch', sketch: r.sketch };
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
