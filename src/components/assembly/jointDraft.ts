import * as THREE from 'three';
import { buildBrepAsync } from '@/cad/brep/client';
import { solidConversion } from '@/cad/brep/convert';
import type { BrepBuild } from '@/cad/brep/types';
import { solidRequest } from '@/cad/shapeRegistry';
import { worldMatrix } from '@/cad/hierarchy';
import { jointProblem } from '@/cad/assembly/joints';
import { mate } from '@/cad/assembly/references';
import type { JointKind, ModelDocument, ObjectId, ShapeObject } from '@/types/document';
import type { JointDraft } from './assemblyUi';

/** Exact builds of bodies being picked for joints (by body, rebuilt when its shape changes). */
type Entry =
  { key: string; state: 'loading' } | { key: string; state: 'ready'; build: BrepBuild } | { key: string; state: 'error'; why: string };
const builds = new Map<ObjectId, Entry>();

/** A body's exact build for picking: ready, loading (calls `onReady` when done), or why it has none. */
export function bodyBuild(o: ShapeObject, onReady: () => void): Entry {
  const conv = solidConversion(o);
  const key = conv.ok ? JSON.stringify([conv.recipe, o.size]) : 'none';
  const have = builds.get(o.id);
  if (have && have.key === key) return have;
  if (!conv.ok) {
    const e: Entry = {
      key,
      state: 'error',
      why: `${o.name} has no exact faces to pick (${conv.reason.replace(/\.$/, '')}). Use the quick axis placement for it.`,
    };
    builds.set(o.id, e);
    return e;
  }
  const e: Entry = { key, state: 'loading' };
  builds.set(o.id, e);
  buildBrepAsync(solidRequest({ feature: conv.recipe, size: o.size })!)
    .then((build) => {
      if (builds.get(o.id) === e) builds.set(o.id, { key, state: 'ready', build });
    })
    .catch((err) => {
      if (builds.get(o.id) === e) builds.set(o.id, { key, state: 'error', why: err instanceof Error ? err.message : String(err) });
    })
    .finally(onReady);
  return e;
}

/** The part a picked body belongs to for a joint: the given part (if the body is in it), or its top-level assembly. */
export function jointPartFor(doc: ModelDocument, bodyId: ObjectId, required: ObjectId | null): { part: ObjectId } | { error: string } {
  const chain: ObjectId[] = [];
  for (let o = doc.objects[bodyId]; o; o = o.parentId ? doc.objects[o.parentId] : (undefined as never)) chain.push(o.id);
  if (required) {
    if (chain.includes(required)) return { part: required };
    return {
      error: `That face is on ${doc.objects[bodyId]?.name}, not on ${doc.objects[required]?.name}. Pick a face or edge of ${doc.objects[required]?.name}.`,
    };
  }
  return { part: chain[chain.length - 1] };
}

export type DraftResult =
  | { state: 'waiting'; message: string }
  | { state: 'error'; message: string }
  | {
      state: 'ok';
      frameA: number[];
      frameB: number[];
      worldB: THREE.Matrix4;
      axisWorld: THREE.Matrix4;
      partA: ObjectId;
      partB: ObjectId;
      moved: boolean;
    };

/** What the New joint panel would make from its picks (or what is missing, or why it can't). */
export function draftResult(doc: ModelDocument, d: JointDraft, kind: JointKind): DraftResult {
  if (!d.a) return { state: 'waiting', message: 'Click a face or edge of the fixed part.' };
  if (!d.b) return { state: 'waiting', message: 'Now click a face or edge of the part that moves.' };
  const partA = d.a.part;
  const partB = d.b.part;
  if (!doc.objects[partA] || !doc.objects[partB]) return { state: 'error', message: 'A picked part was deleted. Pick again.' };
  if (partA === partB)
    return { state: 'error', message: `Both picks are on ${doc.objects[partA].name}. Pick the second face or edge on another part.` };
  const why = jointProblem(doc, { id: '', name: 'This joint', a: partA, b: partB }, { moves: d.snap });
  if (why) return { state: 'error', message: why };
  const worldB = worldMatrix(doc, partB);
  const m = mate({
    kind,
    a: d.a.geom,
    b: d.b.geom,
    worldA: worldMatrix(doc, partA),
    worldB,
    flip: d.flip,
    offset: d.offset,
    angle: d.angle,
    snap: d.snap,
  });
  if ('error' in m) return { state: 'error', message: m.error };
  const moved = m.worldB.elements.some((v, i) => Math.abs(v - worldB.elements[i]) > 1e-6);
  return { state: 'ok', ...m, partA, partB, moved };
}
