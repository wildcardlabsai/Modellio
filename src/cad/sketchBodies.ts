/**
 * Bodies whose outline comes from a sketch (profile bodies linked to a sketch record) keep
 * matching it. Their footprint is the sketch's: stretching one would make it disagree with the
 * sketch that controls it, so that is refused. Height is the extrude depth: changing it on an
 * extruded body is allowed and simply becomes the new depth.
 */
import { produce } from 'immer';
import type { ModelDocument, ObjectId, ShapeObject } from '@/types/document';
import { sketchRecords } from './sketchRecords';

/** A resize the sketch relationship refused: which body (or group), and the size asked for. */
export interface BlockedResize {
  objectId: ObjectId;
  /** The bodies controlled by sketches that the change would have stretched. */
  bodies: ObjectId[];
  /** For a single body: the size that was asked for. */
  size?: [number, number, number];
}

/** A profile body linked to a sketch record (its outline is the sketch's). */
export function sketchControlled(doc: ModelDocument, o: ModelDocument['objects'][string] | undefined): o is ShapeObject {
  return o?.kind === 'shape' && o.shape === 'profile' && !!o.sketch && !!o.sketchId && !!sketchRecords(doc)[o.sketchId];
}

const changed = (a: number, b: number) => Math.abs(a - b) > 1e-9;

/**
 * Check a change: undo it entirely if it stretches a sketch-controlled body's outline (reported
 * in `blocked`), and turn a height change of an extruded one into its new depth.
 */
export function guardSketchBodies(prev: ModelDocument, next: ModelDocument): { doc: ModelDocument; blocked: BlockedResize | null } {
  const stretched: ShapeObject[] = [];
  const depths: { id: ObjectId; depth: number }[] = [];
  for (const o of Object.values(next.objects)) {
    if (!sketchControlled(next, o)) continue;
    const before = prev.objects[o.id];
    // Only a pure resize: a new sketch or new extrude settings are a rebuild, not a stretch.
    if (!before || before.kind !== 'shape' || before.size === o.size) continue;
    if (before.sketch !== o.sketch || before.params !== o.params || before.sketchId !== o.sketchId) continue;
    const revolve = (o.params.op ?? 0) >= 1;
    const [dx, dy, dz] = [0, 1, 2].map((i) => changed(before.size[i], o.size[i]));
    if (dx || dy || (dz && revolve)) stretched.push(o);
    else if (dz) depths.push({ id: o.id, depth: o.size[2] });
  }
  if (stretched.length) {
    // One body resized on its own, or part of a bigger change (a group being scaled)?
    const ids = new Set(stretched.map((b) => b.id));
    const others = Object.values(next.objects).filter((o) => {
      const p = prev.objects[o.id];
      return !ids.has(o.id) && p && (p.transform !== o.transform || (o.kind === 'shape' && p.kind === 'shape' && p.size !== o.size));
    });
    const single = stretched.length === 1 && !others.length ? stretched[0] : null;
    const scaled = others.find((o) => o.kind === 'group') ?? others[0];
    return {
      doc: prev,
      blocked: {
        objectId: single ? single.id : (scaled?.id ?? stretched[0].id),
        bodies: [...ids],
        ...(single ? { size: [...single.size] as [number, number, number] } : {}),
      },
    };
  }
  if (!depths.length) return { doc: next, blocked: null };
  return {
    doc: produce(next, (d) => {
      for (const { id, depth } of depths) {
        const t = d.objects[id] as ShapeObject;
        t.params = { ...t.params, depth };
      }
    }),
    blocked: null,
  };
}
