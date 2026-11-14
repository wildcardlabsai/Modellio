import { create } from 'zustand';
import { useEditor } from '@/store/editorStore';
import { buildBrepAsync } from '@/cad/brep/client';
import { solidRequest } from '@/cad/shapeRegistry';
import { createId } from '@/utils/id';
import type { BrepBuild, EdgeRef, FeatureOp, FeatureRecipe } from '@/cad/brep/types';
import type { ShapeObject } from '@/types/document';

/**
 * The Fillet / Chamfer tool: pick edges on a precise solid, set a size, see a live preview built
 * by the real engine, then Apply (one undo step) or Cancel (nothing changes).
 */
export type FeatureKind = 'fillet' | 'chamfer';

export interface FeatureSession {
  objectId: string;
  kind: FeatureKind;
  edges: EdgeRef[];
  /** Radius (fillet) or distance (chamfer), mm. */
  value: number;
  /** Editing an existing operation (its id), or adding a new one. */
  editingOpId: string | null;
  /** The solid before this operation: its edges are the ones you can pick. */
  before: BrepBuild | null;
  preview: { state: 'idle' | 'building' | 'ok' | 'error'; build?: BrepBuild; message?: string };
}

interface FeatureToolState {
  session: FeatureSession | null;
  /** Start on an object (converting it to a precise solid first when needed). */
  start: (objectId: string, kind: FeatureKind, editingOpId?: string) => Promise<boolean>;
  setKind: (kind: FeatureKind) => void;
  toggleEdge: (ref: EdgeRef) => void;
  setValue: (v: number) => void;
  apply: () => void;
  cancel: () => void;
}

export const sameRef = (a: EdgeRef, b: EdgeRef) => JSON.stringify(a) === JSON.stringify(b);
const newOpId = () => `op_${createId()}`;

/** The object's ops before the one being edited (or all of them, for a new op). */
function opsBefore(feature: FeatureRecipe, editingOpId: string | null): FeatureOp[] {
  if (!editingOpId) return feature.ops;
  const i = feature.ops.findIndex((o) => o.id === editingOpId);
  return i < 0 ? feature.ops : feature.ops.slice(0, i);
}

/** The recipe with the session's operation in place. */
export function recipeWithSession(feature: FeatureRecipe, s: FeatureSession): { recipe: FeatureRecipe; opId: string } {
  const opId = s.editingOpId ?? '__preview__';
  const op: FeatureOp =
    s.kind === 'fillet'
      ? { id: opId, kind: 'fillet', edges: s.edges, radius: s.value }
      : { id: opId, kind: 'chamfer', edges: s.edges, distance: s.value };
  const ops = s.editingOpId ? feature.ops.map((o) => (o.id === s.editingOpId ? op : o)) : [...feature.ops, op];
  return { recipe: { ...feature, ops }, opId };
}

const solidOf = (id: string): (ShapeObject & { feature: FeatureRecipe }) | null => {
  const o = useEditor.getState().doc.objects[id];
  return o?.kind === 'shape' && o.shape === 'solid' && o.feature ? (o as ShapeObject & { feature: FeatureRecipe }) : null;
};

let previewTimer: ReturnType<typeof setTimeout> | null = null;
let previewSeq = 0;

export const useFeatureTool = create<FeatureToolState>((set, get) => {
  /** Rebuild the preview shortly after the last change. */
  const schedulePreview = () => {
    if (previewTimer) clearTimeout(previewTimer);
    const s = get().session;
    if (!s) return;
    if (!s.edges.length) {
      set({ session: { ...s, preview: { state: 'idle' } } });
      return;
    }
    set({ session: { ...s, preview: { ...s.preview, state: 'building' } } });
    previewTimer = setTimeout(async () => {
      const cur = get().session;
      const o = cur && solidOf(cur.objectId);
      if (!cur || !o) return;
      const seq = ++previewSeq;
      const { recipe, opId } = recipeWithSession(o.feature, cur);
      try {
        const build = await buildBrepAsync(solidRequest({ feature: recipe, size: o.size })!);
        if (seq !== previewSeq || !get().session) return;
        const problem = build.problems.find((p) => p.id === opId);
        const now = get().session!;
        set({
          session: {
            ...now,
            preview: problem ? { state: 'error', message: problem.message } : { state: 'ok', build },
          },
        });
      } catch (e) {
        if (seq !== previewSeq || !get().session) return;
        set({ session: { ...get().session!, preview: { state: 'error', message: e instanceof Error ? e.message : String(e) } } });
      }
    }, 250);
  };

  return {
    session: null,

    start: async (objectId, kind, editingOpId) => {
      const editor = useEditor.getState();
      const obj = editor.doc.objects[objectId];
      if (obj?.kind !== 'shape') return false;
      if (obj.shape !== 'solid' && !(await editor.convertToSolid(objectId))) return false;
      const o = solidOf(objectId);
      if (!o) return false;
      const editing = editingOpId ? o.feature.ops.find((x) => x.id === editingOpId) : undefined;
      let before: BrepBuild;
      try {
        before = await buildBrepAsync(
          solidRequest({ feature: { ...o.feature, ops: opsBefore(o.feature, editing?.id ?? null) }, size: o.size })!,
        );
      } catch (e) {
        editor.notify(e instanceof Error ? e.message : String(e));
        return false;
      }
      const smallest = Math.min(...o.size);
      set({
        session: {
          objectId,
          kind: editing?.kind ?? kind,
          edges: editing ? [...editing.edges] : [],
          value: editing
            ? editing.kind === 'fillet'
              ? editing.radius
              : editing.distance
            : Math.max(0.2, Math.round(Math.min(2, smallest / 5) * 10) / 10),
          editingOpId: editing?.id ?? null,
          before,
          preview: { state: 'idle' },
        },
      });
      editor.select([objectId]);
      editor.setTool('edges');
      if (editing) schedulePreview();
      return true;
    },

    setKind: (kind) => {
      const s = get().session;
      if (!s || s.kind === kind) return;
      set({ session: { ...s, kind } });
      schedulePreview();
    },

    toggleEdge: (ref) => {
      const s = get().session;
      if (!s) return;
      const has = s.edges.some((e) => sameRef(e, ref));
      set({ session: { ...s, edges: has ? s.edges.filter((e) => !sameRef(e, ref)) : [...s.edges, ref] } });
      schedulePreview();
    },

    setValue: (value) => {
      const s = get().session;
      if (!s || !(value > 0)) return;
      set({ session: { ...s, value } });
      schedulePreview();
    },

    apply: () => {
      const s = get().session;
      const o = s && solidOf(s.objectId);
      if (!s || !o || s.preview.state !== 'ok') return;
      const op: FeatureOp =
        s.kind === 'fillet'
          ? { id: s.editingOpId ?? newOpId(), kind: 'fillet', edges: s.edges, radius: s.value }
          : { id: s.editingOpId ?? newOpId(), kind: 'chamfer', edges: s.edges, distance: s.value };
      const ops = s.editingOpId ? o.feature.ops.map((x) => (x.id === s.editingOpId ? op : x)) : [...o.feature.ops, op];
      const label = `${s.editingOpId ? 'Edit ' : ''}${s.kind === 'fillet' ? 'Fillet' : 'Chamfer'}`;
      useEditor.getState().setFeatureOps(s.objectId, ops, label);
      get().cancel();
    },

    cancel: () => {
      if (previewTimer) clearTimeout(previewTimer);
      previewSeq++;
      set({ session: null });
      if (useEditor.getState().tool === 'edges') useEditor.getState().setTool('select');
    },
  };
});
