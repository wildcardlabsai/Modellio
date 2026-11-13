import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import * as THREE from 'three';
import type {
  AlignMode,
  Axis,
  ModelDocument,
  ObjectId,
  PrimitiveType,
  ShapeObject,
  ShapeParams,
  TransformMode,
  Vec3,
} from '@/types/document';
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
import { getShapeDefinition, getTextMesh } from '@/cad/shapeRegistry';
import { bakeGroupDraft, computeCombined, separateDraft } from '@/cad/operations/combine';
import { initKernel } from '@/cad/kernel/kernel';
import { DEFAULT_FONT, loadFont } from '@/cad/text/fonts';
import { centerMeshData, meshDataBounds, type MeshData } from '@/cad/kernel/meshData';
import { addMeshAsset } from '@/cad/assets';
import type { CombineMode, TextContent } from '@/types/document';
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
  /** Active viewport tool. */
  tool: 'select' | 'measure';
  /** Measure tool: up to two picked world points (mm). */
  measurePoints: Vec3[];
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
  setTool: (tool: 'select' | 'measure') => void;
  addMeasurePoint: (p: Vec3) => void;
  toggleCollapsed: (id: ObjectId) => void;
  requestFrame: () => void;

  // --- modelling commands ---
  /** Add a primitive. With `exact`, it is placed precisely at `at` (drag & drop). */
  addShape: (
    type: PrimitiveType,
    at?: [number, number],
    opts?: { exact?: boolean; /** Rest on a surface: world point + outward normal. */ surface?: { point: Vec3; normal: Vec3 } },
  ) => ObjectId;
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

  // --- Phase 3: solid modelling ---
  /** Combine 2+ objects. 'subtract' keeps the first-selected object and turns the rest into holes. */
  combineSelected: (op: 'union' | 'subtract' | 'intersect') => void;
  setCombineMode: (groupId: ObjectId, mode: CombineMode | null) => void;
  /** Make the selected objects holes (or solids again). */
  setHole: (ids: ObjectId[], hole: boolean) => void;
  /** Replace a combined group with a single mesh ("flatten"). */
  bakeSelected: () => void;
  /** Split a mesh into its disconnected parts. */
  separateSelected: () => void;
  addText: (content?: string, at?: [number, number]) => Promise<ObjectId | null>;
  /**
   * Add imported meshes (already in mm, Z-up) as mesh shapes, resting on the
   * workplane. Several parts keep their relative placement and are grouped.
   */
  importMeshes: (parts: { name: string; mesh: MeshData }[], opts?: { at?: [number, number]; groupName?: string }) => ObjectId[];
  setText: (id: ObjectId, patch: Partial<TextContent> & { fontSize?: number }) => Promise<void>;
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
    tool: 'select',
    measurePoints: [],
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
      set({
        doc: r.state,
        history: r.history,
        selection: validSelection(r.state, selection),
        lastAction: `Undo ${r.label}`,
        actionSeq: get().actionSeq + 1,
      });
    },

    redo: () => {
      get().commitTransaction();
      const { history, doc, selection } = get();
      const r = redoHistory(history, doc);
      if (!r) return;
      set({
        doc: r.state,
        history: r.history,
        selection: validSelection(r.state, selection),
        lastAction: `Redo ${r.label}`,
        actionSeq: get().actionSeq + 1,
      });
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
    setTool: (tool) => set({ tool, measurePoints: [] }),
    addMeasurePoint: (p) => {
      const pts = get().measurePoints;
      set({ measurePoints: pts.length >= 2 ? [p] : [...pts, p] });
    },
    toggleCollapsed: (id) => set({ collapsed: { ...get().collapsed, [id]: !get().collapsed[id] } }),
    requestFrame: () => set({ frameRequest: get().frameRequest + 1 }),

    addShape: (type, at, opts) => {
      const def = getShapeDefinition(type);
      const doc = get().doc;
      const position: Vec3 =
        opts?.exact && at ? [roundTo(at[0]), roundTo(at[1]), def.defaultSize[2] / 2] : findFreePosition(doc, def.defaultSize, at ?? [0, 0]);
      const obj = createShape(doc, type, position);
      if (opts?.surface) {
        // Stand the shape on the face: local +Z along the face normal, base on the hit point.
        const n = new THREE.Vector3(...opts.surface.normal).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        const p = new THREE.Vector3(...opts.surface.point).addScaledVector(n, def.defaultSize[2] / 2);
        obj.transform = matrixToTransform(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
      }
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
      get().apply(ids.length > 1 ? `Delete ${ids.length} objects` : `Delete ${doc.objects[ids[0]].name}`, (d) =>
        removeObjectsDraft(d, ids),
      );
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
          roots: clip.roots.map((r) => ({
            ...r,
            world: { ...r.world, position: r.world.position.map((v, i) => v + DUPLICATE_OFFSET[i]) as Vec3 },
          })),
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
      get().apply(
        leaving ? (parentId ? 'Move into group' : 'Move out of group') : 'Reorder',
        (d) => void moveObjectsDraft(d, items, parentId, index),
      );
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
    combineSelected: (op) => {
      const { doc, selection } = get();
      const ids = editableSelection();
      if (ids.length < 2) {
        get().notify('Select two or more objects to combine.');
        return;
      }
      // Keep the user's selection order: the first-selected object is the one we cut into.
      const ordered = selection.filter((id) => ids.includes(id));
      const gid = createId('grp');
      const name = uniqueName(doc, op === 'union' ? 'Union' : op === 'subtract' ? 'Difference' : 'Intersection');
      get().apply(op === 'union' ? 'Union' : op === 'subtract' ? 'Subtract' : 'Intersect', (d) => {
        if (op === 'subtract') {
          for (const s of descendantShapes(d, ordered.slice(1))) (d.objects[s.id] as ShapeObject).isHole = true;
          for (const s of descendantShapes(d, [ordered[0]])) (d.objects[s.id] as ShapeObject).isHole = false;
        }
        if (groupDraft(d, ordered, { id: gid, name })) {
          const g = d.objects[gid];
          if (g.kind === 'group') g.combine = op === 'intersect' ? 'intersect' : 'union';
        }
      });
      if (get().doc.objects[gid]) set({ selection: [gid] });
    },

    setCombineMode: (groupId, mode) =>
      get().apply(mode ? (mode === 'union' ? 'Combine: union' : 'Combine: intersect') : 'Uncombine', (d) => {
        const g = d.objects[groupId];
        if (g?.kind !== 'group') return;
        if (mode) g.combine = mode;
        else delete g.combine;
      }),

    setHole: (ids, hole) => {
      const { doc } = get();
      const targets = topLevel(doc, ids).filter((id) => !isEffectivelyLocked(doc, id));
      if (!targets.length) return;
      get().apply(hole ? 'Make hole' : 'Make solid', (d) => {
        for (const s of descendantShapes(d, targets)) (d.objects[s.id] as ShapeObject).isHole = hole;
      });
    },

    bakeSelected: () => {
      const { doc, selection } = get();
      const groups = selection.filter((id) => {
        const o = doc.objects[id];
        return o?.kind === 'group' && o.combine && !isEffectivelyLocked(doc, id);
      });
      if (!groups.length) {
        get().notify('Select a combined group to flatten it into one mesh.');
        return;
      }
      const failed = groups.filter((id) => !computeCombined(doc, id)?.mesh);
      if (failed.length) {
        get().notify(computeCombined(doc, failed[0])?.error ?? 'The combined result is not ready yet.');
        return;
      }
      const created: ObjectId[] = [];
      get().apply('Flatten to mesh', (d) => {
        for (const id of groups) {
          const nid = bakeGroupDraft(d, id, doc.objects[id].name);
          if (nid) created.push(nid);
        }
      });
      set({ selection: created });
    },

    separateSelected: () => {
      const { doc, selection } = get();
      const meshes = selection.filter((id) => {
        const o = doc.objects[id];
        return o?.kind === 'shape' && o.shape === 'mesh' && !isEffectivelyLocked(doc, id);
      });
      if (!meshes.length) {
        get().notify('Select a mesh (e.g. a flattened combination) to separate.');
        return;
      }
      const created: ObjectId[] = [];
      get().apply('Separate', (d) => {
        for (const id of meshes) created.push(...separateDraft(d, id));
      });
      if (created.length) set({ selection: created });
      else get().notify('This mesh is already a single connected solid.');
    },

    importMeshes: (parts, opts) => {
      if (!parts.length) return [];
      const doc = get().doc;
      const all = new THREE.Box3();
      const centred = parts.map((p) => {
        const c = centerMeshData(p.mesh);
        all.expandByPoint(c.center.clone().sub(c.size.clone().multiplyScalar(0.5)));
        all.expandByPoint(c.center.clone().add(c.size.clone().multiplyScalar(0.5)));
        return { ...c, name: p.name };
      });
      const allSize = all.getSize(new THREE.Vector3());
      const allCenter = all.getCenter(new THREE.Vector3());
      const target: Vec3 = opts?.at
        ? [roundTo(opts.at[0]), roundTo(opts.at[1]), 0]
        : (() => {
            const p = findFreePosition(doc, [allSize.x, allSize.y, allSize.z]);
            return [p[0], p[1], 0] as Vec3;
          })();
      // Shift so the combined model is centred on the target and rests on the plate.
      const shift = new THREE.Vector3(target[0] - allCenter.x, target[1] - allCenter.y, -all.min.z);
      const colors = ['#64748B', '#2463EB', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6'];
      const shapes = centred.map((c, i) => {
        const base = createShape(doc, 'box', [0, 0, 0]);
        return {
          ...base,
          name: uniqueName(doc, c.name.slice(0, 40) || 'Imported'),
          shape: 'mesh' as const,
          meshId: addMeshAsset(c.mesh),
          params: {},
          size: [roundTo(c.size.x), roundTo(c.size.y), roundTo(c.size.z)] as Vec3,
          color: colors[i % colors.length],
          transform: {
            position: [roundTo(c.center.x + shift.x), roundTo(c.center.y + shift.y), roundTo(c.center.z + shift.z)] as Vec3,
            rotation: [0, 0, 0] as Vec3,
          },
        };
      });
      const gid = createId('grp');
      get().apply(parts.length > 1 ? `Import ${parts.length} parts` : 'Import mesh', (d) => {
        for (const sh of shapes) addObjectDraft(d, sh);
        if (shapes.length > 1)
          groupDraft(
            d,
            shapes.map((x) => x.id),
            { id: gid, name: uniqueName(doc, opts?.groupName ?? 'Imported') },
          );
      });
      const sel = shapes.length > 1 ? [gid] : [shapes[0].id];
      set({ selection: sel });
      get().requestFrame();
      return sel;
    },

    addText: async (content = 'Text', at) => {
      try {
        await Promise.all([initKernel(), loadFont(DEFAULT_FONT)]);
      } catch (e) {
        get().notify(`Text is unavailable: ${e instanceof Error ? e.message : e}`);
        return null;
      }
      const doc = get().doc;
      const def = getShapeDefinition('text');
      const params = { ...def.defaultParams };
      const text: TextContent = { content, font: DEFAULT_FONT };
      const mesh = getTextMesh({ text, params });
      if (!mesh) return null;
      const ext = meshDataBounds(mesh).getSize(new THREE.Vector3());
      const depth = def.defaultSize[2];
      const size: Vec3 = [roundTo(ext.x), roundTo(ext.y), depth];
      const position = at ? ([roundTo(at[0]), roundTo(at[1]), depth / 2] as Vec3) : findFreePosition(doc, size);
      const obj = {
        ...createShape(doc, 'text', position),
        text,
        params,
        size,
        name: uniqueName(doc, content.split('\n')[0].slice(0, 24) || 'Text'),
      };
      get().apply('Add text', (d) => addObjectDraft(d, obj));
      set({ selection: [obj.id] });
      return obj.id;
    },

    setText: async (id, patch) => {
      const o = get().doc.objects[id];
      if (o?.kind !== 'shape' || o.shape !== 'text' || !o.text) return;
      const text: TextContent = { content: patch.content ?? o.text.content, font: patch.font ?? o.text.font };
      if (!text.content.trim()) {
        get().notify('Text cannot be empty.');
        return;
      }
      await Promise.all([initKernel(), loadFont(text.font)]);
      const params = { ...o.params, ...(patch.fontSize ? { fontSize: patch.fontSize } : {}) };
      const mesh = getTextMesh({ text, params });
      if (!mesh) return;
      const ext = meshDataBounds(mesh).getSize(new THREE.Vector3());
      // New text keeps its depth; width/height follow the new layout.
      get().apply('Edit text', (d) => {
        const t = d.objects[id];
        if (t?.kind !== 'shape') return;
        t.text = text;
        t.params = params;
        t.size = [roundTo(ext.x), roundTo(ext.y), t.size[2]];
      });
    },

    setWorkplaneSize: (size) =>
      get().apply('Workplane size', (doc) => {
        doc.settings.workplane = [Math.max(20, roundTo(size[0], 2)), Math.max(20, roundTo(size[1], 2))];
      }),
  };
});

/** Convenience selectors */
export const selectPrimaryId = (s: EditorState) => s.selection[s.selection.length - 1] ?? null;
