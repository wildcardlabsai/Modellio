import { create } from 'zustand';
import { useEditor } from '@/store/editorStore';
import { buildBrepAsync } from '@/cad/brep/client';
import { findFreePosition } from '@/cad/document';
import type { BrepBuild, FeatureBase, LoftSection } from '@/cad/brep/types';
import type { Sketch } from '@/cad/sketch/types';
import type { Vec3 } from '@/types/document';

/**
 * Loft and Sweep: build a new precise solid from sketches (or edit one), with a live preview in
 * the 3D view built by the real engine. Create / Update is one undo step; Cancel changes nothing.
 */
export type LoftBase = Extract<FeatureBase, { kind: 'loft' }>;
export type SweepBase = Extract<FeatureBase, { kind: 'sweep' }>;
export type SketchTarget = { kind: 'section'; index: number } | { kind: 'profile' } | { kind: 'path' };

export interface BuilderSession {
  /** Which opening of the panel this is (the view frames the preview once per opening). */
  seq: number;
  base: LoftBase | SweepBase;
  /** Editing an existing solid, or creating a new one. */
  editingId: string | null;
  sketching: SketchTarget | null;
  preview: { state: 'building' | 'ok' | 'error'; build?: BrepBuild; message?: string; position?: Vec3 };
}

// --- default sketches --------------------------------------------------------------------------
let n = 0;
const id = (p: string) => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;
export function circleSketch(r: number): Sketch {
  const c = id('p');
  return { points: [{ id: c, x: 0, y: 0 }], entities: [{ id: id('o'), kind: 'circle', c, r }], constraints: [] };
}
export function rectSketch(w: number, h: number): Sketch {
  const p = [id('p'), id('p'), id('p'), id('p')];
  const xy: [number, number][] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  const l = [id('l'), id('l'), id('l'), id('l')];
  return {
    points: p.map((pid, i) => ({ id: pid, x: xy[i][0], y: xy[i][1] })),
    entities: l.map((lid, i) => ({ id: lid, kind: 'line' as const, a: p[i], b: p[(i + 1) % 4] })),
    constraints: [
      { id: id('c'), kind: 'horizontal', line: l[0] },
      { id: id('c'), kind: 'vertical', line: l[1] },
      { id: id('c'), kind: 'horizontal', line: l[2] },
      { id: id('c'), kind: 'vertical', line: l[3] },
    ],
  };
}
export function polylineSketch(pts: [number, number][]): Sketch {
  const p = pts.map(() => id('p'));
  return {
    points: p.map((pid, i) => ({ id: pid, x: pts[i][0], y: pts[i][1] })),
    entities: pts.slice(1).map((_, i) => ({ id: id('l'), kind: 'line' as const, a: p[i], b: p[i + 1] })),
    constraints: [],
  };
}

export const defaultLoft = (): LoftBase => ({
  kind: 'loft',
  ruled: false,
  sections: [
    { sketch: circleSketch(15), height: 0, offset: [0, 0] },
    { sketch: rectSketch(16, 16), height: 30, offset: [0, 0] },
  ],
});
export const defaultSweep = (): SweepBase => ({
  kind: 'sweep',
  profile: circleSketch(3),
  path: polylineSketch([
    [0, 0],
    [0, 30],
    [30, 30],
  ]),
  pathPlane: 'XZ',
  orientation: 'follow',
  corners: 'round',
});

// --- store -------------------------------------------------------------------------------------
interface BuilderState {
  session: BuilderSession | null;
  open: (kind: 'loft' | 'sweep', editingId?: string) => void;
  update: (fn: (base: LoftBase | SweepBase) => LoftBase | SweepBase) => void;
  setSections: (sections: LoftSection[]) => void;
  startSketch: (target: SketchTarget) => void;
  finishSketch: (sketch: Sketch) => void;
  cancelSketch: () => void;
  apply: () => void;
  cancel: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let opened = 0;
let seq = 0;

export const useSolidBuilder = create<BuilderState>((set, get) => {
  const preview = () => {
    if (timer) clearTimeout(timer);
    const s = get().session;
    if (!s) return;
    set({ session: { ...s, preview: { ...s.preview, state: 'building' } } });
    timer = setTimeout(async () => {
      const cur = get().session;
      if (!cur) return;
      const mine = ++seq;
      try {
        const build = await buildBrepAsync({ recipe: { base: cur.base, ops: [] }, size: [0, 0, 0] }, { lane: 'loft-sweep-preview' });
        if (mine !== seq || !get().session) return;
        const editor = useEditor.getState();
        const existing = cur.editingId ? editor.doc.objects[cur.editingId] : undefined;
        const position: Vec3 = existing ? [...existing.transform.position] : findFreePosition(editor.doc, build.size);
        set({ session: { ...get().session!, preview: { state: 'ok', build, position } } });
      } catch (e) {
        if (mine !== seq || !get().session) return;
        set({ session: { ...get().session!, preview: { state: 'error', message: e instanceof Error ? e.message : String(e) } } });
      }
    }, 250);
  };

  return {
    session: null,

    open: (kind, editingId) => {
      const editor = useEditor.getState();
      let base: LoftBase | SweepBase = kind === 'loft' ? defaultLoft() : defaultSweep();
      if (editingId) {
        const o = editor.doc.objects[editingId];
        const b = o?.kind === 'shape' ? o.feature?.base : undefined;
        if (b?.kind !== kind) return;
        base = structuredClone(b);
      }
      editor.setTool('select');
      set({ session: { seq: ++opened, base, editingId: editingId ?? null, sketching: null, preview: { state: 'building' } } });
      preview();
    },

    update: (fn) => {
      const s = get().session;
      if (!s) return;
      set({ session: { ...s, base: fn(s.base) } });
      preview();
    },

    setSections: (sections) => get().update((b) => (b.kind === 'loft' ? { ...b, sections } : b)),

    startSketch: (target) => {
      const s = get().session;
      if (s) set({ session: { ...s, sketching: target } });
    },

    finishSketch: (sketch) => {
      const s = get().session;
      if (!s?.sketching) return;
      const t = s.sketching;
      set({ session: { ...s, sketching: null } });
      get().update((b) => {
        if (b.kind === 'loft' && t.kind === 'section')
          return { ...b, sections: b.sections.map((sec, i) => (i === t.index ? { ...sec, sketch } : sec)) };
        if (b.kind === 'sweep' && t.kind === 'profile') return { ...b, profile: sketch };
        if (b.kind === 'sweep' && t.kind === 'path') return { ...b, path: sketch };
        return b;
      });
    },

    cancelSketch: () => {
      const s = get().session;
      if (s) set({ session: { ...s, sketching: null } });
    },

    apply: () => {
      const s = get().session;
      if (!s || s.preview.state !== 'ok' || !s.preview.build) return;
      const editor = useEditor.getState();
      const label = s.base.kind === 'loft' ? 'Loft' : 'Sweep';
      if (s.editingId) editor.setSolidBase(s.editingId, s.base, s.preview.build.size, `Edit ${label.toLowerCase()}`);
      else editor.addSolid({ base: s.base, ops: [] }, s.preview.build.size, label);
      editor.requestFrame();
      get().cancel();
    },

    cancel: () => {
      if (timer) clearTimeout(timer);
      seq++;
      set({ session: null });
    },
  };
});
