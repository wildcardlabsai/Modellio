import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { ModelDocument, ObjectId, PrimitiveType, ShapeParams, TransformMode, Vec3 } from '@/types/document';
import {
  addObjectDraft,
  clampSize,
  createEmptyDocument,
  createShape,
  duplicateObjectsDraft,
  findFreePosition,
  removeObjectsDraft,
} from '@/cad/document';
import { getShapeDefinition } from '@/cad/shapeRegistry';
import { dropToWorkplaneZ } from '@/cad/transforms/transform';
import { emptyHistory, pushHistory, redoHistory, undoHistory, type History } from './history';
import { normalizeDegrees, roundTo } from '@/utils/math';

type Recipe = (doc: Draft<ModelDocument>) => void;

export interface SnapSettings {
  enabled: boolean;
  /** Translation increment in mm. */
  translate: number;
  /** Rotation increment in degrees. */
  rotate: number;
}

interface Transaction {
  label: string;
  base: ModelDocument;
}

export interface EditorState {
  doc: ModelDocument;
  history: History<ModelDocument>;
  /** Active continuous edit (gizmo drag). Intermediate steps are not recorded. */
  transaction: Transaction | null;

  selection: ObjectId[];
  mode: TransformMode;
  snap: SnapSettings;
  lockProportions: boolean;
  /** Bumped whenever the user asks the camera to frame the selection/scene. */
  frameRequest: number;
  lastAction: string | null;
  /** Increments on every recorded action, undo or redo (for UI feedback). */
  actionSeq: number;

  // --- generic mutation API ---
  /** Apply a recorded (undoable) change. Inside a transaction it is folded into the transaction. */
  apply: (label: string, recipe: Recipe) => void;
  beginTransaction: (label: string) => void;
  /** Update during a transaction without creating history entries. */
  applyTransient: (recipe: Recipe) => void;
  commitTransaction: () => void;
  cancelTransaction: () => void;
  undo: () => void;
  redo: () => void;
  loadDocument: (doc: ModelDocument) => void;

  // --- selection & modes ---
  select: (ids: ObjectId[], opts?: { additive?: boolean; toggle?: boolean }) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setMode: (mode: TransformMode) => void;
  setSnap: (snap: Partial<SnapSettings>) => void;
  setLockProportions: (v: boolean) => void;
  requestFrame: () => void;

  // --- modelling commands ---
  /** Add a primitive. With `exact`, it is placed precisely at `at` (drag & drop). */
  addShape: (type: PrimitiveType, at?: [number, number], opts?: { exact?: boolean }) => ObjectId;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  setSize: (id: ObjectId, size: Vec3) => void;
  setPosition: (id: ObjectId, position: Vec3) => void;
  setRotation: (id: ObjectId, rotation: Vec3) => void;
  setParam: (id: ObjectId, key: string, value: number) => void;
  setColor: (id: ObjectId, color: string) => void;
  rename: (id: ObjectId, name: string) => void;
  setVisible: (id: ObjectId, visible: boolean) => void;
  setLocked: (id: ObjectId, locked: boolean) => void;
  dropToWorkplane: (ids: ObjectId[]) => void;
}

const DUPLICATE_OFFSET: Vec3 = [10, 10, 0];

const validSelection = (doc: ModelDocument, ids: ObjectId[]) => ids.filter((id) => !!doc.objects[id]);

export const useEditor = create<EditorState>()((set, get) => {
  /** Shape-only mutation helper for a single object. */
  const editShape = (id: ObjectId, label: string, fn: (o: Draft<Extract<ModelDocument['objects'][string], { kind: 'shape' }>>) => void) =>
    get().apply(label, (doc) => {
      const o = doc.objects[id];
      if (o && o.kind === 'shape') fn(o);
    });

  return {
    doc: createEmptyDocument(),
    history: emptyHistory(),
    transaction: null,
    selection: [],
    mode: 'translate',
    snap: { enabled: true, translate: 1, rotate: 15 },
    lockProportions: false,
    frameRequest: 0,
    lastAction: null,
    actionSeq: 0,

    apply: (label, recipe) => {
      const { doc, history, transaction } = get();
      const next = produce(doc, recipe);
      if (next === doc) return;
      if (transaction) {
        set({ doc: next });
        return;
      }
      set({ doc: next, history: pushHistory(history, doc, label), lastAction: label, actionSeq: get().actionSeq + 1 });
    },

    beginTransaction: (label) => {
      if (get().transaction) get().commitTransaction();
      set({ transaction: { label, base: get().doc } });
    },

    applyTransient: (recipe) => {
      const { doc } = get();
      const next = produce(doc, recipe);
      if (next !== doc) set({ doc: next });
    },

    commitTransaction: () => {
      const { transaction, doc, history } = get();
      if (!transaction) return;
      if (doc === transaction.base) {
        set({ transaction: null });
        return;
      }
      set({
        transaction: null,
        history: pushHistory(history, transaction.base, transaction.label),
        lastAction: transaction.label,
        actionSeq: get().actionSeq + 1,
      });
    },

    cancelTransaction: () => {
      const { transaction } = get();
      if (!transaction) return;
      set({ doc: transaction.base, transaction: null });
    },

    undo: () => {
      get().commitTransaction();
      const { history, doc, selection } = get();
      const r = undoHistory(history, doc);
      if (!r) return;
      set({ doc: r.state, history: r.history, selection: validSelection(r.state, selection), lastAction: `Undo ${r.label}`, actionSeq: get().actionSeq + 1 });
    },

    redo: () => {
      get().commitTransaction();
      const { history, doc, selection } = get();
      const r = redoHistory(history, doc);
      if (!r) return;
      set({ doc: r.state, history: r.history, selection: validSelection(r.state, selection), lastAction: `Redo ${r.label}`, actionSeq: get().actionSeq + 1 });
    },

    loadDocument: (doc) => set({ doc, history: emptyHistory(), transaction: null, selection: [] }),

    select: (ids, opts) => {
      const { selection, doc } = get();
      const valid = validSelection(doc, ids);
      if (opts?.toggle) {
        const s = new Set(selection);
        for (const id of valid) {
          if (s.has(id)) s.delete(id);
          else s.add(id);
        }
        set({ selection: [...s] });
      } else if (opts?.additive) {
        set({ selection: [...selection.filter((id) => !valid.includes(id)), ...valid] });
      } else {
        set({ selection: valid });
      }
    },
    selectAll: () => set({ selection: get().doc.rootIds.filter((id) => get().doc.objects[id]?.visible) }),
    clearSelection: () => set({ selection: [] }),
    setMode: (mode) => set({ mode }),
    setSnap: (snap) => set({ snap: { ...get().snap, ...snap } }),
    setLockProportions: (lockProportions) => set({ lockProportions }),
    requestFrame: () => set({ frameRequest: get().frameRequest + 1 }),

    addShape: (type, at, opts) => {
      const def = getShapeDefinition(type);
      const doc = get().doc;
      const position: Vec3 =
        opts?.exact && at
          ? [roundTo(at[0]), roundTo(at[1]), def.defaultSize[2] / 2]
          : findFreePosition(doc, def.defaultSize, at ?? [0, 0]);
      const obj = createShape(doc, type, position);
      get().apply(`Add ${def.label}`, (d) => addObjectDraft(d, obj));
      set({ selection: [obj.id] });
      return obj.id;
    },

    deleteSelected: () => {
      const { selection, doc } = get();
      const ids = selection.filter((id) => doc.objects[id] && !doc.objects[id].locked);
      if (!ids.length) return;
      get().apply(ids.length > 1 ? `Delete ${ids.length} objects` : `Delete ${doc.objects[ids[0]].name}`, (d) =>
        removeObjectsDraft(d, ids),
      );
      set({ selection: validSelection(get().doc, selection) });
    },

    duplicateSelected: () => {
      const { selection } = get();
      if (!selection.length) return;
      let created: ObjectId[] = [];
      get().apply(selection.length > 1 ? `Duplicate ${selection.length} objects` : 'Duplicate', (d) => {
        created = duplicateObjectsDraft(d, selection, DUPLICATE_OFFSET);
      });
      set({ selection: created });
    },

    setSize: (id, size) => editShape(id, 'Resize', (o) => void (o.size = clampSize(size))),
    setPosition: (id, position) =>
      get().apply('Move', (doc) => {
        const o = doc.objects[id];
        if (o) o.transform.position = position.map((v) => roundTo(v)) as Vec3;
      }),
    setRotation: (id, rotation) =>
      get().apply('Rotate', (doc) => {
        const o = doc.objects[id];
        if (o) o.transform.rotation = rotation.map((v) => normalizeDegrees(v)) as Vec3;
      }),
    setParam: (id, key, value) => editShape(id, 'Change shape', (o) => void ((o.params as ShapeParams)[key] = value)),
    setColor: (id, color) => editShape(id, 'Change colour', (o) => void (o.color = color)),
    rename: (id, name) =>
      get().apply('Rename', (doc) => {
        const o = doc.objects[id];
        const trimmed = name.trim();
        if (o && trimmed) o.name = trimmed;
      }),
    setVisible: (id, visible) =>
      get().apply(visible ? 'Show' : 'Hide', (doc) => {
        const o = doc.objects[id];
        if (o) o.visible = visible;
      }),
    setLocked: (id, locked) =>
      get().apply(locked ? 'Lock' : 'Unlock', (doc) => {
        const o = doc.objects[id];
        if (o) o.locked = locked;
      }),
    dropToWorkplane: (ids) =>
      get().apply('Drop to workplane', (doc) => {
        for (const id of ids) {
          const o = doc.objects[id];
          if (o?.kind === 'shape' && !o.locked) o.transform.position[2] = dropToWorkplaneZ(o);
        }
      }),
  };
});

/** Convenience selectors */
export const selectPrimaryId = (s: EditorState) => s.selection[s.selection.length - 1] ?? null;
