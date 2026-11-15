/**
 * Keeps placed sketches on their planes and faces (schema 3).
 *
 * After every document change, each placed sketch's frame is worked out again: a reference
 * plane's from its numbers; an attached face's by finding the face again on the body's exact
 * build (by its reference, the same matching fillets and holes use). When it moved, the sketch's
 * frame and its bodies follow, written onto the current state without a new undo step: the step
 * that changed the body already holds the state before it, so one undo restores both.
 *
 * When the face can't be found (it was removed, or can no longer be told apart from another one)
 * or the body is gone, nothing moves: the sketch is marked broken, with the reason, until it is
 * re-attached or detached.
 */
import { produce } from 'immer';
import type { BrepBuild } from '@/cad/brep/types';
import type { Frame, ModelDocument, SketchRecord } from '@/types/document';
import { AMBIGUOUS, NO_MATCH, matchFaces } from '@/cad/brep/build';
import { buildBrepAsync } from '@/cad/brep/client';
import { solidConversion } from '@/cad/brep/convert';
import { worldMatrix } from '@/cad/hierarchy';
import { initKernel } from '@/cad/kernel/kernel';
import { faceFrame, planeFrame, sameFrame, sameTransform } from '@/cad/placement';
import { solidRequest } from '@/cad/shapeRegistry';
import { placedTransform } from '@/cad/sketchPlacement';
import { sketchRecords, sketchUsers } from '@/cad/sketchRecords';

export type Resolution = { frame: Frame } | { broken: string };

/** A face attachment against a body's exact build: the frame, or why it can't be found. */
export function resolveFace(doc: ModelDocument, rec: SketchRecord, build: BrepBuild): Resolution {
  if (rec.placement?.kind !== 'face') return { broken: 'Not attached to a face.' };
  const o = doc.objects[rec.placement.objectId];
  if (o?.kind !== 'shape') return { broken: 'The body it was attached to has been deleted.' };
  const [i] = matchFaces(
    [rec.placement.face],
    build.faces.map((f) => f.ref),
  );
  if (i === NO_MATCH) return { broken: `The face of ${o.name} it was attached to no longer exists (the body's shape changed).` };
  if (i === AMBIGUOUS) return { broken: `The face of ${o.name} it was attached to can no longer be told apart from another face.` };
  const frame = faceFrame(build, i, o.size, o.mirror, worldMatrix(doc, o.id));
  return frame ? { frame } : { broken: `The face of ${o.name} it was attached to is no longer flat.` };
}

/** Where a placed record is now, once its body's build is ready. */
async function resolve(doc: ModelDocument, rec: SketchRecord): Promise<Resolution | null> {
  const p = rec.placement;
  if (!p) return null;
  if (p.kind === 'plane') {
    const plane = doc.planes?.[p.planeId];
    return plane ? { frame: planeFrame(plane) } : { broken: 'Its reference plane has been deleted.' };
  }
  const o = doc.objects[p.objectId];
  if (o?.kind !== 'shape') return { broken: 'The body it was attached to has been deleted.' };
  const conv = solidConversion(o);
  if (!conv.ok) return { broken: `The body it was attached to has no exact faces any more (${conv.reason})` };
  try {
    const build = await buildBrepAsync(solidRequest({ feature: conv.recipe, size: o.size })!);
    return resolveFace(doc, rec, build);
  } catch (e) {
    return { broken: `The body it was attached to could not be built: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * The document with every placed sketch (and its bodies) where its placement now puts it, or the
 * same document when nothing needs to change.
 */
export function applyResolutions(doc: ModelDocument, found: Map<string, Resolution>): ModelDocument {
  return produce(doc, (d) => {
    for (const [id, r] of found) {
      const rec = d.sketches?.[id];
      if (!rec?.placement) continue;
      if ('broken' in r) {
        if (rec.broken !== r.broken) rec.broken = r.broken;
        continue;
      }
      if (rec.broken) delete rec.broken;
      if (!sameFrame(rec.frame, r.frame)) rec.frame = r.frame;
      for (const u of sketchUsers(d as ModelDocument, id)) {
        const t = placedTransform(d as ModelDocument, rec as SketchRecord, u);
        if (t && !sameTransform(t, u.transform)) d.objects[u.id].transform = t;
      }
    }
  });
}

/**
 * Watch an editor store and keep its placed sketches resolved. `get` / `set` read and silently
 * replace the document; `busy` says when not to (during a drag). Returns a stop function.
 */
export function watchAttachments(store: {
  subscribe: (fn: () => void) => () => void;
  get: () => ModelDocument;
  set: (doc: ModelDocument) => void;
  busy: () => boolean;
}): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  let last: ModelDocument | null = null;
  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    const doc = store.get();
    if (doc === last || store.busy()) return;
    const placed = Object.values(sketchRecords(doc)).filter((r) => r.placement);
    if (!placed.length) {
      last = doc;
      return;
    }
    running = true;
    try {
      await initKernel();
      const found = new Map<string, Resolution>();
      for (const rec of placed) {
        const r = await resolve(doc, rec);
        if (r) found.set(rec.id, r);
      }
      // Only write onto the state these results were worked out for.
      if (store.get() === doc && !store.busy()) {
        const next = applyResolutions(doc, found);
        last = next;
        if (next !== doc) store.set(next);
      }
    } finally {
      running = false;
      if (again || store.get() !== last) {
        again = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), 60);
  };
  const stop = store.subscribe(schedule);
  schedule();
  return () => {
    stop();
    if (timer) clearTimeout(timer);
  };
}
