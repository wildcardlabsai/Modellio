/**
 * Linked components (schema 4). A component is a definition (`doc.components`); each placement of
 * it is an *instance*: a group with `component: true` and its `componentId`. Every object inside
 * an instance carries a `defNode`, the same in every instance of that component, so the parts of
 * different instances can be matched one to one.
 *
 * Instances are real objects (so rendering, picking, Booleans, export, print checks and sketches
 * work on them unchanged). What links them is `syncLinks`: after every change, an edit made inside
 * one instance (a part added, removed, moved, resized, recoloured, its sketch or recipe changed…)
 * is copied to every other instance of the same component, inside the same undo step. Each
 * instance keeps its own placement: the instance group's position, rotation, name, visibility,
 * lock, grounding and suppression are its own.
 */
import { produce, type Draft } from 'immer';
import type { GroupObject, ModelDocument, ObjectId, SceneObject } from '@/types/document';
import { createId } from '@/utils/id';
import { collectSubtree } from '../document';

/** The instance an object belongs to (the nearest enclosing instance group, or itself), or null. */
export function instanceRootOf(doc: ModelDocument, id: ObjectId): ObjectId | null {
  for (let o = doc.objects[id]; o; o = o.parentId ? doc.objects[o.parentId] : (undefined as never))
    if (o.kind === 'group' && o.componentId) return o.id;
  return null;
}

/** Every instance (group) of a component. */
export const instancesOf = (doc: ModelDocument, componentId: string): GroupObject[] =>
  Object.values(doc.objects).filter((o): o is GroupObject => o.kind === 'group' && o.componentId === componentId);

/** How deep an object sits in the tree (top level = 0). */
function depth(doc: ModelDocument, id: ObjectId) {
  let n = 0;
  for (let o = doc.objects[id]; o?.parentId; o = doc.objects[o.parentId]) n++;
  return n;
}

/** Make `rootId` (a group) an instance of a new or given component: it and every part inside it get their link ids. */
export function linkInstanceDraft(d: Draft<ModelDocument> | ModelDocument, rootId: ObjectId, componentId: string, name: string) {
  const root = d.objects[rootId];
  if (root?.kind !== 'group') return;
  d.components ??= {};
  if (!d.components[componentId]) d.components[componentId] = { id: componentId, name, createdAt: Date.now() };
  root.component = true;
  root.componentId = componentId;
  for (const id of collectSubtree(d as ModelDocument, [rootId]).slice(1)) {
    const o = d.objects[id];
    // Parts of a nested instance keep their own links; everything gets a node id here.
    if (!o.defNode) o.defNode = createId('dn');
  }
}

/** Give a copy its own identity: new link ids throughout (it is no longer linked to anything). */
export function unlinkDraft(d: Draft<ModelDocument> | ModelDocument, rootId: ObjectId, componentId: string, name: string) {
  for (const id of collectSubtree(d as ModelDocument, [rootId]).slice(1)) delete d.objects[id].defNode;
  const root = d.objects[rootId];
  if (root?.kind === 'group') delete root.componentId;
  linkInstanceDraft(d, rootId, componentId, name);
}

/** Fields of an instance group that belong to that placement, not to the component. */
const OWN_ROOT_FIELDS = new Set([
  'id',
  'name',
  'transform',
  'visible',
  'locked',
  'parentId',
  'grounded',
  'home',
  'suppressed',
  'componentId',
  'children',
  'defNode',
]);

/** Whether the content of instance `rootId` differs between two documents (not its own placement). */
function contentChanged(prev: ModelDocument, next: ModelDocument, rootId: ObjectId): boolean {
  const a = prev.objects[rootId];
  const b = next.objects[rootId];
  if (!a || !b || a.kind !== 'group' || b.kind !== 'group') return false;
  if (a.componentId !== b.componentId) return false;
  if (a.children.length !== b.children.length || a.children.some((c, i) => c !== b.children[i])) return true;
  for (const k of Object.keys({ ...a, ...b }))
    if (!OWN_ROOT_FIELDS.has(k) && JSON.stringify(a[k as keyof GroupObject]) !== JSON.stringify(b[k as keyof GroupObject])) return true;
  for (const id of collectSubtree(next, [rootId]).slice(1)) if (prev.objects[id] !== next.objects[id]) return true;
  return false;
}

/** A component that contains an instance of itself (directly or deeper): it can't be built. */
export function findCycle(doc: ModelDocument): string | null {
  for (const r of Object.values(doc.objects)) {
    if (r.kind !== 'group' || !r.componentId) continue;
    for (const id of collectSubtree(doc, [r.id]).slice(1)) {
      const o = doc.objects[id];
      if (o.kind === 'group' && o.componentId === r.componentId) return doc.components?.[r.componentId]?.name ?? r.name;
    }
  }
  return null;
}

/** Copy the content of instance `src` onto instance `dst` (same component), matching parts by `defNode`. */
function copyContent(d: Draft<ModelDocument>, src: GroupObject, dstId: ObjectId) {
  const doc = d as ModelDocument;
  const dst = d.objects[dstId] as GroupObject;
  const srcIds = collectSubtree(doc, [src.id]).slice(1);
  const dstByNode = new Map<string, ObjectId>();
  for (const id of collectSubtree(doc, [dstId]).slice(1)) {
    const n = d.objects[id].defNode;
    if (n) dstByNode.set(n, id);
  }
  const srcNodes = new Set(srcIds.map((id) => d.objects[id].defNode));
  // Parts no longer in the component.
  for (const [node, id] of dstByNode)
    if (!srcNodes.has(node)) {
      for (const sub of collectSubtree(doc, [id])) delete d.objects[sub];
      dstByNode.delete(node);
    }
  // New ids for parts that are new to this instance.
  const idFor = new Map<ObjectId, ObjectId>([[src.id, dstId]]);
  for (const id of srcIds) {
    const node = d.objects[id].defNode!;
    idFor.set(id, dstByNode.get(node) ?? createId());
  }
  for (const id of srcIds) {
    const s = JSON.parse(JSON.stringify(d.objects[id])) as SceneObject;
    const tid = idFor.get(id)!;
    s.id = tid;
    s.parentId = s.parentId ? (idFor.get(s.parentId) ?? dstId) : dstId;
    if (s.kind === 'group') s.children = s.children.map((c) => idFor.get(c)!).filter(Boolean);
    d.objects[tid] = s;
  }
  dst.children = src.children.map((c) => idFor.get(c)!).filter(Boolean);
  // Component-level settings of the group itself (e.g. how it combines its parts).
  for (const k of Object.keys({ ...src, ...dst }) as (keyof GroupObject)[])
    if (!OWN_ROOT_FIELDS.has(k)) (dst as unknown as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(src[k] ?? null)) ?? undefined;
  for (const k of Object.keys(dst) as (keyof GroupObject)[]) if (dst[k] === undefined) delete dst[k];
}

/** Copy the content of one instance onto another (Replace component). */
export function replaceContentDraft(d: Draft<ModelDocument>, srcId: ObjectId, dstId: ObjectId) {
  const src = d.objects[srcId];
  const dst = d.objects[dstId];
  if (src?.kind !== 'group' || dst?.kind !== 'group') return;
  // Nothing of the old content matches the new component: start from empty.
  for (const c of dst.children) for (const sub of collectSubtree(d as ModelDocument, [c])) delete d.objects[sub];
  dst.children = [];
  dst.componentId = src.componentId;
  copyContent(d, src as GroupObject, dstId);
}

/**
 * Keep linked instances the same: for each component whose content changed in one instance
 * (innermost first), copy that instance's content to the others. Returns the document with
 * every instance in step, or `cycle` (and the previous document) when a component would contain
 * itself.
 */
export function syncLinks(prev: ModelDocument, next: ModelDocument): { doc: ModelDocument; cycle: string | null } {
  if (prev === next) return { doc: next, cycle: null };
  const roots = Object.values(next.objects).filter((o): o is GroupObject => o.kind === 'group' && !!o.componentId);
  if (!roots.length) return { doc: next, cycle: null };
  const cycle = findCycle(next);
  if (cycle) return { doc: prev, cycle };
  const changed = roots.filter((r) => contentChanged(prev, next, r.id)).sort((a, b) => depth(next, b.id) - depth(next, a.id));
  if (!changed.length) return { doc: next, cycle: null };
  const doc = produce(next, (d) => {
    const done = new Set<string>();
    for (const r of changed) {
      if (done.has(r.componentId!)) continue;
      done.add(r.componentId!);
      const src = d.objects[r.id] as GroupObject;
      // Parts added to this instance join the component; a part copied inside it gets its own link id.
      const seen = new Set<string>();
      for (const id of collectSubtree(d as ModelDocument, [src.id]).slice(1)) {
        const o = d.objects[id];
        if (!o.defNode || seen.has(o.defNode)) o.defNode = createId('dn');
        seen.add(o.defNode);
      }
      for (const t of instancesOf(d as ModelDocument, r.componentId!)) if (t.id !== src.id) copyContent(d, src, t.id);
    }
  });
  return { doc, cycle: null };
}
