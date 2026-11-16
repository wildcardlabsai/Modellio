import { create } from 'zustand';
import { useEditor } from '@/store/editorStore';
import { buildBrepAsync } from '@/cad/brep/client';
import { solidRequest } from '@/cad/shapeRegistry';
import { createId } from '@/utils/id';
import {
  activeOps,
  type BrepBuild,
  type EdgeRef,
  type FaceRef,
  type FeatureOp,
  type FeatureRecipe,
  type HolePattern,
  type HoleSpec,
} from '@/cad/brep/types';
import type { ShapeObject, Vec3 } from '@/types/document';
import { onProjectSwitch } from '@/platform/projectScope';

/**
 * The solid-feature tool: Fillet and Chamfer (pick edges), Shell and Draft (pick faces) and Hole
 * (pick a point on a flat face). Set the sizes, see a live preview built by the real engine, then
 * Apply (one undo step) or Cancel (nothing changes).
 */
export type FeatureKind = FeatureOp['kind'];

/** What you click on the part for each kind of feature. */
export const pickMode = (k: FeatureKind): 'edges' | 'faces' | 'point' =>
  k === 'fillet' || k === 'chamfer' ? 'edges' : k === 'hole' ? 'point' : 'faces';

export interface HoleDraft {
  face: FaceRef | null;
  /** Where the hole goes, normalised like `FaceRef.centre`. */
  at: Vec3 | null;
  spec: HoleSpec;
  pattern?: HolePattern;
}

export interface FeatureSession {
  objectId: string;
  kind: FeatureKind;
  edges: EdgeRef[];
  faces: FaceRef[];
  hole: HoleDraft;
  /** Fillet radius, chamfer distance, shell wall (mm), or draft angle (degrees). */
  value: number;
  /** Editing an existing operation (its id), or adding a new one. */
  editingOpId: string | null;
  /** The solid before this operation: its edges and faces are the ones you can pick. */
  before: BrepBuild | null;
  preview: { state: 'idle' | 'building' | 'ok' | 'error'; build?: BrepBuild; message?: string };
}

interface FeatureToolState {
  session: FeatureSession | null;
  /** Start on an object (converting it to a precise solid first when needed). */
  start: (objectId: string, kind: FeatureKind, editingOpId?: string) => Promise<boolean>;
  /** Switch between Fillet and Chamfer (the only kinds that share a selection). */
  setKind: (kind: 'fillet' | 'chamfer') => void;
  toggleEdge: (ref: EdgeRef) => void;
  toggleFace: (ref: FaceRef) => void;
  placeHole: (face: FaceRef, at: Vec3) => void;
  setHole: (patch: Partial<HoleSpec>) => void;
  setPattern: (pattern: HolePattern | undefined) => void;
  setValue: (v: number) => void;
  apply: () => void;
  cancel: () => void;
}

export const sameRef = (a: EdgeRef | FaceRef, b: EdgeRef | FaceRef) => JSON.stringify(a) === JSON.stringify(b);
const newOpId = () => `op_${createId()}`;

const TITLE: Record<FeatureKind, string> = {
  fillet: 'Fillet',
  chamfer: 'Chamfer',
  shell: 'Shell',
  draft: 'Draft',
  hole: 'Hole',
};
export const featureTitle = (k: FeatureKind) => TITLE[k];

export const DEFAULT_HOLE: HoleSpec = { style: 'simple', diameter: 3, depth: 0, cbDiameter: 6, cbDepth: 2, csDiameter: 6, csAngle: 90 };

/** The object's ops before the one being edited (or all of them, for a new op). */
function opsBefore(feature: FeatureRecipe, editingOpId: string | null): FeatureOp[] {
  if (!editingOpId) return activeOps(feature);
  const i = feature.ops.findIndex((o) => o.id === editingOpId);
  return i < 0 ? feature.ops : feature.ops.slice(0, i);
}

/** The operation a session describes, or null while it is not complete (nothing picked yet). */
export function opFromSession(s: FeatureSession, id: string): FeatureOp | null {
  switch (s.kind) {
    case 'fillet':
      return s.edges.length ? { id, kind: 'fillet', edges: s.edges, radius: s.value } : null;
    case 'chamfer':
      return s.edges.length ? { id, kind: 'chamfer', edges: s.edges, distance: s.value } : null;
    case 'shell':
      return s.faces.length ? { id, kind: 'shell', thickness: s.value, faces: s.faces } : null;
    case 'draft':
      return s.faces.length ? { id, kind: 'draft', angle: s.value, faces: s.faces } : null;
    case 'hole': {
      const h = s.hole;
      if (!h.face || !h.at) return null;
      return { id, kind: 'hole', face: h.face, at: h.at, hole: h.spec, ...(h.pattern ? { pattern: h.pattern } : {}) };
    }
  }
}

/** The recipe with the session's operation in place (or as it was, while the session is incomplete). */
export function recipeWithSession(feature: FeatureRecipe, s: FeatureSession): { recipe: FeatureRecipe; opId: string } {
  const opId = s.editingOpId ?? '__preview__';
  const op = opFromSession(s, opId);
  if (!op) return { recipe: feature, opId };
  return { recipe: withOp(feature, op, s.editingOpId), opId };
}

/**
 * The recipe with `op` replacing the operation being edited, or added: at the end, or at the
 * rollback marker when the recipe is rolled back (the marker then moves past it).
 */
export function withOp(feature: FeatureRecipe, op: FeatureOp, editingOpId: string | null): FeatureRecipe {
  if (editingOpId) return { ...feature, ops: feature.ops.map((o) => (o.id === editingOpId ? op : o)) };
  if (feature.rollback === undefined) return { ...feature, ops: [...feature.ops, op] };
  const at = feature.rollback;
  return { ...feature, ops: [...feature.ops.slice(0, at), op, ...feature.ops.slice(at)], rollback: at + 1 };
}

const solidOf = (id: string): (ShapeObject & { feature: FeatureRecipe }) | null => {
  const o = useEditor.getState().doc.objects[id];
  return o?.kind === 'shape' && o.shape === 'solid' && o.feature ? (o as ShapeObject & { feature: FeatureRecipe }) : null;
};

/** Starting values for a new operation of this kind, from the part's size. */
function defaultValue(kind: FeatureKind, size: Vec3): number {
  const smallest = Math.min(...size);
  if (kind === 'draft') return 3;
  if (kind === 'shell') return Math.max(0.4, Math.round(Math.min(2, smallest / 6) * 10) / 10);
  return Math.max(0.2, Math.round(Math.min(2, smallest / 5) * 10) / 10);
}

function valueOf(op: FeatureOp): number {
  return op.kind === 'fillet'
    ? op.radius
    : op.kind === 'chamfer'
      ? op.distance
      : op.kind === 'shell'
        ? op.thickness
        : op.kind === 'draft'
          ? op.angle
          : 0;
}

let previewTimer: ReturnType<typeof setTimeout> | null = null;
let previewSeq = 0;

export const useFeatureTool = create<FeatureToolState>((set, get) => {
  /** Rebuild the preview shortly after the last change. */
  const schedulePreview = () => {
    if (previewTimer) clearTimeout(previewTimer);
    const s = get().session;
    if (!s) return;
    if (!opFromSession(s, 'x')) {
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
        const build = await buildBrepAsync(solidRequest({ feature: recipe, size: o.size })!, { lane: 'feature-preview' });
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

  const update = (patch: (s: FeatureSession) => Partial<FeatureSession>) => {
    const s = get().session;
    if (!s) return;
    set({ session: { ...s, ...patch(s) } });
    schedulePreview();
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
      const k = editing?.kind ?? kind;
      set({
        session: {
          objectId,
          kind: k,
          edges: editing && (editing.kind === 'fillet' || editing.kind === 'chamfer') ? [...editing.edges] : [],
          faces: editing && (editing.kind === 'shell' || editing.kind === 'draft') ? [...editing.faces] : [],
          hole:
            editing?.kind === 'hole'
              ? { face: editing.face, at: editing.at, spec: { ...DEFAULT_HOLE, ...editing.hole }, pattern: editing.pattern }
              : { face: null, at: null, spec: { ...DEFAULT_HOLE } },
          value: editing ? valueOf(editing) : defaultValue(k, o.size),
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
      if (!s || s.kind === kind || pickMode(s.kind) !== 'edges') return;
      update(() => ({ kind }));
    },

    toggleEdge: (ref) =>
      update((s) => ({ edges: s.edges.some((e) => sameRef(e, ref)) ? s.edges.filter((e) => !sameRef(e, ref)) : [...s.edges, ref] })),

    toggleFace: (ref) =>
      update((s) => ({ faces: s.faces.some((f) => sameRef(f, ref)) ? s.faces.filter((f) => !sameRef(f, ref)) : [...s.faces, ref] })),

    placeHole: (face, at) => update((s) => ({ hole: { ...s.hole, face, at } })),

    setHole: (patch) => update((s) => ({ hole: { ...s.hole, spec: { ...s.hole.spec, ...patch } } })),

    setPattern: (pattern) => update((s) => ({ hole: { ...s.hole, pattern } })),

    setValue: (value) => {
      if (!(value > 0)) return;
      update(() => ({ value }));
    },

    apply: () => {
      const s = get().session;
      const o = s && solidOf(s.objectId);
      if (!s || !o || s.preview.state !== 'ok') return;
      const op = opFromSession(s, s.editingOpId ?? newOpId());
      if (!op) return;
      const next = withOp(o.feature, op, s.editingOpId);
      useEditor.getState().setFeatureOps(s.objectId, next.ops, `${s.editingOpId ? 'Edit ' : ''}${TITLE[s.kind]}`, next.rollback);
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

// A newly opened design starts clean (see platform/projectScope).
onProjectSwitch('feature-tool', () => {
  if (useFeatureTool.getState().session) useFeatureTool.getState().cancel();
});
