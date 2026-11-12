import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import * as THREE from 'three';
import type { AlignMode, Axis, ModelDocument, ObjectId, PrimitiveType, ShapeObject, ShapeParams, TransformMode, Vec3 } from '@/types/document';
import {
  addObjectDraft,
  clampSize,
  copySubtrees,
  createEmptyDocument,
  createShape,
  duplicateObjectsDraft,
  findFreePosition,
  pasteDraft,
  removeObjectsDraft,
  uniqueName,
  type ClipboardData,
} from '@/cad/document';
import {
  alignDraft,
  descendantShapes,
  distributeDraft,
  dropToWorkplaneDraft,
  groupDraft,
  groupLocalBounds,
  isEffectivelyLocked,
  mirrorDraft,
  moveObjectsDraft,
  scaleGroupDraft,
  topLevel,
  ungroupDraft,
  worldBoundsOf,
  worldMatrix,
} from '@/cad/hierarchy';
import { getShapeDefinition } from '@/cad/shapeRegistry';
import { matrixToTransform } from '@/cad/transforms/transform';
import { emptyHistory, pushHistory, redoHistory, undoHistory, type History } from './history';
import { normalizeDegrees, roundTo } from '@/utils/math';
import { createId } from '@/utils/id';

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
  showGrid: boolean;
  /** Groups collapsed in the object tree (UI state, not part of the document). */
  collapsed: Record<ObjectId, boolean>;
  clipboard: ClipboardData | null;
  /** Bumped whenever the user asks the camera to frame the selection/scene. */
  frameRequest: number;
  lastAction: string | null;
  /** Increments on every recorded action, undo or redo (for UI feedback). */
  actionSeq: number;
  /** Short message for the UI (e.g. why an operation is unavailable). */
  notice: { text: string; seq: number } | null;

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
  notify: (text: string) => void;

  // --- selection & modes ---
  select: (ids: ObjectId[], opts?: { additive?: boolean; toggle?: boolean }) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setMode: (mode: TransformMode) => void;
  setSnap: (snap: Partial<SnapSettings>) => void;
  setLockProportions: (v: boolean) => void;
  setShowGrid: (v: boolean) => void;
  toggleCollapsed: (id: ObjectId) => void;
  requestFrame: () => void;

  // --- modelling commands ---
  /** Add a primitive. With `exact`, it is placed precisely at `at` (drag & drop). */
  addShape: (type: PrimitiveType, at?: [number, number], opts?: { exact?: boolean }) => ObjectId;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  cutSelected: () => void;
  paste: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  alignSelected: (axis: Axis, mode: AlignMode) => void;
  distributeSelected: (axis: Axis) => void;
  mirrorSelected: (axis: Axis) => void;
  moveInTree: (ids: ObjectId[], parentId: ObjectId | null, index: number) => void;
  setSize: (id: ObjectId, size: Vec3) => void;
  setGroupSize: (id: ObjectId, size: Vec3) => void;
  setPosition: (id: ObjectId, position: Vec3) => void;
  setRotation: (id: ObjectId, rotation: Vec3) => void;
  setParam: (id: ObjectId, key: string, value: number) => void;
  setColor: (id: ObjectId, color: string) => void;
  rename: (id: ObjectId, name: string) => void;
  setVisible: (id: ObjectId, visible: boolean) => void;
  setLocked: (id: ObjectId, locked: boolean) => void;
  dropToWorkplane: (ids: ObjectId[]) => void;
  setWorkplaneSize: (size: [number, number]) => void;
}

const DUPLICATE_OFFSET: Vec3 = [10, 10, 0];
const AXIS_NAMES = ['X', 'Y', 'Z'];

const validSelection = (doc: ModelDocument, ids: ObjectId[]) => ids.filter((id) => !!doc.objects[id]);

export const useEditor = create<EditorState>()((set, get) => {
  /** Shape-only mutation helper for a single object. */
  const editShape = (id: ObjectId, label: string, fn: (o: Draft<ShapeObject>) => void) =>
    get().apply(label, (doc) => {
      const o = doc.objects[id];
      if (o && o.kind === 'shape') fn(o);
    });

  /** Top-level, unlocked selected ids. */
  const editableSelection = () => {
    const { doc, selection } = get();
    return topLevel(doc, selection).filter((id) => !isEffectivelyLocked(doc, id));
  };

  return {
    doc: createEmptyDocument(),
    history: emptyHistory(),
    transaction: null,
    selection: [],
    mode: 'translate',
    snap: { enabled: true, translate: 1, rotate: 15 },
    lockProportions: false,
    showGrid: true,
    collapsed: {},
    clipboard: null,
    frameRequest: 0,
    lastAction: null,
    actionSeq: 0,
    notice: null,

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

    loadDocument: (doc) => set({ doc, history: emptyHistory(), transaction: null, selection: [], collapsed: {} }),
    notify: (text) => set({ notice: { text, seq: (get().notice?.seq ?? 0) + 1 } }),

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
    setShowGrid: (showGrid) => set({ showGrid }),
    toggleCollapsed: (id) => set({ collapsed: { ...get().collapsed, [id]: !get().collapsed[id] } }),
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
      const ids = editableSelection();
      if (!ids.length) {
        if (selection.length) get().notify('Locked objects cannot be deleted.');
        return;
      }
      get().apply(ids.length > 1 ? `Delete ${ids.length} objects` : `Delete ${doc.objects[ids[0]].name}`, (d) => removeObjectsDraft(d, ids));
      set({ selection: validSelection(get().doc, selection) });
    },

    duplicateSelected: () => {
      const ids = topLevel(get().doc, get().selection);
      if (!ids.length) return;
      let created: ObjectId[] = [];
      get().apply(ids.length > 1 ? `Duplicate ${ids.length} objects` : 'Duplicate', (d) => {
        created = duplicateObjectsDraft(d, ids, DUPLICATE_OFFSET);
      });
      set({ selection: created });
    },

    copySelected: () => {
      const { doc, selection } = get();
      const ids = topLevel(doc, selection);
      if (!ids.length) return;
      set({ clipboard: copySubtrees(doc, ids, (id) => matrixToTransform(worldMatrix(doc, id))) });
      get().notify(`Copied ${ids.length} object${ids.length > 1 ? 's' : ''}`);
    },

    cutSelected: () => {
      if (!editableSelection().length) return;
      get().copySelected();
      get().deleteSelected();
    },

    paste: () => {
      const clip = get().clipboard;
      if (!clip) return;
      let created: ObjectId[] = [];
      get().apply('Paste', (d) => {
        created = pasteDraft(d, clip, DUPLICATE_OFFSET);
      });
      // Successive pastes cascade instead of stacking.
      set({
        selection: created,
        clipboard: {
          ...clip,
          roots: clip.roots.map((r) => ({ ...r, world: { ...r.world, position: r.world.position.map((v, i) => v + DUPLICATE_OFFSET[i]) as Vec3 } })),
        },
      });
    },

    groupSelected: () => {
      const { doc } = get();
      const ids = editableSelection();
      if (ids.length < 2) {
        get().notify('Select two or more objects to group.');
        return;
      }
      const gid = createId('grp');
      get().apply('Group', (d) => void groupDraft(d, ids, { id: gid, name: uniqueName(doc, 'Group') }));
      if (get().doc.objects[gid]) set({ selection: [gid] });
    },

    ungroupSelected: () => {
      const { doc, selection } = get();
      const groups = selection.filter((id) => doc.objects[id]?.kind === 'group' && !isEffectivelyLocked(doc, id));
      if (!groups.length) {
        get().notify('Select a group to ungroup.');
        return;
      }
      let released: ObjectId[] = [];
      get().apply('Ungroup', (d) => {
        released = ungroupDraft(d, groups);
      });
      set({ selection: released });
    },

    alignSelected: (axis, mode) => {
      const ids = editableSelection();
      if (!ids.length) return;
      const label = ids.length === 1 ? `Align to workplane ${AXIS_NAMES[axis]}` : `Align ${AXIS_NAMES[axis]}`;
      get().apply(label, (d) => alignDraft(d, ids, axis, mode));
    },

    distributeSelected: (axis) => {
      const ids = editableSelection();
      if (ids.length < 3) {
        get().notify('Select three or more objects to distribute.');
        return;
      }
      get().apply(`Distribute ${AXIS_NAMES[axis]}`, (d) => distributeDraft(d, ids, axis));
    },

    mirrorSelected: (axis) => {
      const { doc } = get();
      const ids = editableSelection();
      if (!ids.length) return;
      const center = worldBoundsOf(doc, ids).getCenter(new THREE.Vector3());
      get().apply(`Mirror ${AXIS_NAMES[axis]}`, (d) => mirrorDraft(d, ids, axis, center));
    },

    moveInTree: (ids, parentId, index) => {
      const { doc } = get();
      const items = topLevel(doc, ids).filter((id) => !isEffectivelyLocked(doc, id));
      if (!items.length) return;
      const leaving = items.some((id) => doc.objects[id].parentId !== parentId);
      get().apply(leaving ? (parentId ? 'Move into group' : 'Move out of group') : 'Reorder', (d) => void moveObjectsDraft(d, items, parentId, index));
    },

    setSize: (id, size) => editShape(id, 'Resize', (o) => void (o.size = clampSize(size))),

    setGroupSize: (id, size) => {
      const { doc } = get();
      if (doc.objects[id]?.kind !== 'group') return;
      const cur = groupLocalBounds(doc, id).getSize(new THREE.Vector3()).toArray() as Vec3;
      const f = size.map((v, i) => (cur[i] > 1e-9 ? Math.max(0.01, v) / cur[i] : 1)) as Vec3;
      get().apply('Resize group', (d) => scaleGroupDraft(d, doc, id, f));
    },

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
    setColor: (id, color) =>
      get().apply('Change colour', (doc) => {
        // Colouring a group colours every shape inside it.
        for (const s of descendantShapes(doc, [id])) (doc.objects[s.id] as ShapeObject).color = color;
      }),
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
    dropToWorkplane: (ids) => get().apply('Drop to workplane', (doc) => dropToWorkplaneDraft(doc, ids)),
    setWorkplaneSize: (size) =>
      get().apply('Workplane size', (doc) => {
        doc.settings.workplane = [Math.max(20, roundTo(size[0], 2)), Math.max(20, roundTo(size[1], 2))];
      }),
  };
});

/** Convenience selectors */
export const selectPrimaryId = (s: EditorState) => s.selection[s.selection.length - 1] ?? null;
