import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { newId, type DesignElement } from './model';

/**
 * State shared by every maker built on the design canvas: the elements, the maker's own
 * settings, selection, undo/redo (covering both), templates, and a debounced rebuild of
 * the maker's result whenever anything changes.
 */
export interface MakerTemplate<P> {
  id: string;
  name: string;
  category: string;
  description: string;
  elements: DesignElement[];
  params: Partial<P>;
}

interface Snapshot<P> {
  elements: DesignElement[];
  params: P;
}

export interface MakerState<P, R> {
  elements: DesignElement[];
  params: P;
  selected: string | null;
  tool: 'select' | 'draw';
  /** The face being edited, for double-sided makers. New items go on this side. */
  side: 'front' | 'back';
  setSide: (side: 'front' | 'back') => void;
  templateId: string | null;
  result: R | null;
  error: string | null;
  building: boolean;
  past: Snapshot<P>[];
  future: Snapshot<P>[];
  select: (id: string | null) => void;
  setTool: (t: 'select' | 'draw') => void;
  add: (el: Omit<DesignElement, 'id'> & { id?: string }) => string;
  update: (id: string, patch: Partial<DesignElement>, opts?: { transient?: boolean }) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  reorder: (id: string, dir: 1 | -1) => void;
  setParams: (patch: Partial<P>, opts?: { transient?: boolean }) => void;
  /** Start of a drag: the whole drag becomes one undo step. */
  beginGesture: () => void;
  load: (elements: DesignElement[], params: P, templateId: string | null) => void;
  undo: () => void;
  redo: () => void;
  rebuild: () => void;
}

export function createMakerStore<P extends object, R>(opts: {
  key: string;
  initial: () => { elements: DesignElement[]; params: P; templateId: string | null };
  defaults: P;
  build: (elements: DesignElement[], params: P) => Promise<R>;
}): UseBoundStore<StoreApi<MakerState<P, R>>> {
  let saved: Partial<{ elements: DesignElement[]; params: P; templateId: string | null }> = {};
  if (typeof window !== 'undefined')
    try {
      saved = JSON.parse(localStorage.getItem(opts.key) ?? '{}');
    } catch {
      saved = {};
    }
  const init = saved.elements
    ? { elements: saved.elements, params: { ...opts.defaults, ...saved.params }, templateId: saved.templateId ?? null }
    : opts.initial();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  return create<MakerState<P, R>>((set, get) => {
    const persist = () => {
      const { elements, params, templateId } = get();
      try {
        localStorage.setItem(opts.key, JSON.stringify({ elements, params, templateId }));
      } catch {
        /* storage full or unavailable */
      }
    };
    const snapshot = (): Snapshot<P> => ({ elements: get().elements, params: get().params });
    const commit = (patch: Partial<MakerState<P, R>>, transient = false) => {
      if (!transient) set({ past: [...get().past.slice(-99), snapshot()], future: [] });
      set(patch);
      persist();
      get().rebuild();
    };
    return {
      ...init,
      selected: null,
      tool: 'select',
      side: 'front',
      setSide: (side) => set({ side, selected: null }),
      result: null,
      error: null,
      building: false,
      past: [],
      future: [],
      // Selecting an item (e.g. from Layers) shows the side it is on.
      select: (selected) => {
        const el = selected ? get().elements.find((e) => e.id === selected) : null;
        set({ selected, ...(el ? { side: el.side ?? 'front' } : {}) });
      },
      setTool: (tool) => set({ tool, selected: tool === 'draw' ? null : get().selected }),
      add: (el) => {
        const id = el.id || newId();
        const side = el.side ?? (get().side === 'back' ? 'back' : undefined);
        commit({ elements: [...get().elements, { ...el, id, ...(side ? { side } : {}) } as DesignElement], selected: id });
        return id;
      },
      update: (id, patch, o) =>
        commit({ elements: get().elements.map((e) => (e.id === id ? ({ ...e, ...patch } as DesignElement) : e)) }, o?.transient),
      remove: (id) =>
        commit({ elements: get().elements.filter((e) => e.id !== id), selected: get().selected === id ? null : get().selected }),
      duplicate: (id) => {
        const el = get().elements.find((e) => e.id === id);
        if (!el) return;
        const copy = { ...structuredClone(el), id: newId(), x: el.x + 4, y: el.y - 4 };
        commit({ elements: [...get().elements, copy], selected: copy.id });
      },
      reorder: (id, dir) => {
        const els = [...get().elements];
        const i = els.findIndex((e) => e.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= els.length) return;
        [els[i], els[j]] = [els[j], els[i]];
        commit({ elements: els });
      },
      setParams: (patch, o) => commit({ params: { ...get().params, ...patch } }, o?.transient),
      beginGesture: () => set({ past: [...get().past.slice(-99), snapshot()], future: [] }),
      load: (elements, params, templateId) =>
        commit({
          elements: structuredClone(elements),
          params: { ...opts.defaults, ...structuredClone(params) },
          templateId,
          selected: null,
          side: 'front',
        }),
      undo: () => {
        const { past } = get();
        if (!past.length) return;
        const prev = past[past.length - 1];
        set({ ...prev, past: past.slice(0, -1), future: [snapshot(), ...get().future], selected: null });
        persist();
        get().rebuild();
      },
      redo: () => {
        const { future } = get();
        if (!future.length) return;
        set({ ...future[0], future: future.slice(1), past: [...get().past, snapshot()], selected: null });
        persist();
        get().rebuild();
      },
      rebuild: () => {
        if (timer) clearTimeout(timer);
        set({ building: true });
        timer = setTimeout(async () => {
          const mine = ++generation;
          try {
            const result = await opts.build(get().elements, get().params);
            if (mine === generation) set({ result, error: null, building: false });
          } catch (e) {
            if ((e as Error).message === 'superseded') return;
            if (mine === generation) set({ error: (e as Error).message, building: false, result: null });
          }
        }, 90);
      },
    };
  });
}
