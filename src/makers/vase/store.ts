import { create } from 'zustand';
import { DEFAULT_VASE, type VaseParams, type VaseResult } from './geometry';
import { buildInWorker } from './client';
import { surprise, VASE_TEMPLATES } from './templates';

export type VaseTab = 'templates' | 'design';

interface VaseState {
  tab: VaseTab;
  params: VaseParams;
  /** Template the design started from (cleared once nothing of it is left to name). */
  templateId: string | null;
  result: VaseResult | null;
  error: string | null;
  building: boolean;
  past: VaseParams[];
  future: VaseParams[];
  setTab: (t: VaseTab) => void;
  /** Change parameters. `transient` updates (during a drag) don't add undo steps. */
  setParams: (patch: Partial<VaseParams>, opts?: { transient?: boolean }) => void;
  /** Call before a drag; the whole drag becomes one undo step. */
  beginGesture: () => void;
  applyTemplate: (id: string) => void;
  startBlank: () => void;
  surpriseMe: () => void;
  undo: () => void;
  redo: () => void;
  rebuild: () => void;
}

const KEY = 'modellio:vase';
function load(): Partial<Pick<VaseState, 'params' | 'templateId' | 'tab'>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}
const saved = typeof window === 'undefined' ? {} : load();

/** A blank design: a plain cylinder to shape from scratch. */
export const BLANK: VaseParams = {
  ...DEFAULT_VASE,
  height: 150,
  profile: [
    { t: 0, r: 35 },
    { t: 1, r: 35 },
  ],
};

let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

export const useVase = create<VaseState>((set, get) => {
  const persist = () => {
    const { params, templateId, tab } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ params, templateId, tab }));
    } catch {
      /* storage unavailable */
    }
  };
  const commit = (params: VaseParams, extra: Partial<VaseState> = {}) => {
    set({ params, past: [...get().past.slice(-99), get().params], future: [], ...extra });
    persist();
    get().rebuild();
  };
  return {
    tab: saved.tab ?? 'templates',
    params: saved.params ? { ...DEFAULT_VASE, ...saved.params } : { ...VASE_TEMPLATES[0].params },
    templateId: saved.templateId ?? (saved.params ? null : VASE_TEMPLATES[0].id),
    result: null,
    error: null,
    building: false,
    past: [],
    future: [],
    setTab: (tab) => {
      set({ tab });
      persist();
    },
    setParams: (patch, opts) => {
      const params = { ...get().params, ...patch };
      if (opts?.transient) {
        set({ params });
        persist();
        get().rebuild();
      } else commit(params);
    },
    beginGesture: () => set({ past: [...get().past.slice(-99), get().params], future: [] }),
    applyTemplate: (id) => {
      const tpl = VASE_TEMPLATES.find((x) => x.id === id);
      if (tpl) commit(structuredClone(tpl.params), { templateId: id });
    },
    startBlank: () => commit(structuredClone(BLANK), { templateId: null, tab: 'design' }),
    surpriseMe: () => commit(surprise(), { templateId: null }),
    undo: () => {
      const { past, params } = get();
      if (!past.length) return;
      set({ params: past[past.length - 1], past: past.slice(0, -1), future: [params, ...get().future] });
      persist();
      get().rebuild();
    },
    redo: () => {
      const { future, params } = get();
      if (!future.length) return;
      set({ params: future[0], future: future.slice(1), past: [...get().past, params] });
      persist();
      get().rebuild();
    },
    rebuild: () => {
      if (timer) clearTimeout(timer);
      set({ building: true });
      timer = setTimeout(async () => {
        const mine = ++generation;
        try {
          const result = await buildInWorker(get().params);
          if (mine === generation) set({ result, error: null, building: false });
        } catch (e) {
          if ((e as Error).message === 'superseded') return;
          if (mine === generation) set({ error: (e as Error).message, building: false });
        }
      }, 60);
    },
  };
});

/** Export-quality build (finer mesh) of the current design. */
export const buildFine = () => buildInWorker(useVase.getState().params, true);
