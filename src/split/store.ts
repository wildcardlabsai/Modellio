import { create } from 'zustand';
import { computeColourComponents } from './model/components';
import type { ColourComponent, ImportIssue, ThreeMFDocument } from './model/types';
import { ImportCancelledError, ImportFailedError, importInWorker, runStudioJob } from './worker/client';
import { jobDocument, jobParts } from './worker/jobs';
import { DEFAULT_SPLIT_OPTIONS, type SplitOptions, type SplitPart, type SplitResult } from './geometry/types';
import { DEFAULT_CONNECTOR_SETTINGS, type Connector, type ConnectorSettings } from './geometry/connectors';
import { DEFAULT_PLATE_SETTINGS, layoutPlates, type Layout, type PlateSettings } from './geometry/layout';

export type SplitStep = 'import' | 'split' | 'connect' | 'export';

export const STEPS: { id: SplitStep; label: string }[] = [
  { id: 'import', label: 'Import' },
  { id: 'split', label: 'Split' },
  { id: 'connect', label: 'Connect' },
  { id: 'export', label: 'Export' },
];

const ORDER: SplitStep[] = ['import', 'split', 'connect', 'export'];

export interface ConnectResult {
  parts: SplitPart[];
  connectors: Connector[];
  issues: ImportIssue[];
  skipped: { jointId: string; reason: string }[];
  /** Settings and split result the connectors were made for. */
  key: string;
}

interface Settings {
  splitOptions: SplitOptions;
  connectorSettings: ConnectorSettings;
  plateSettings: PlateSettings;
}

interface SplitState extends Settings {
  doc: ThreeMFDocument | null;
  components: ColourComponent[];
  /** Import in progress (the previous document stays visible until it succeeds). */
  importing: { fileName: string; fraction: number; stage: string } | null;
  error: string | null;
  step: SplitStep;
  selectedMaterial: number | null;
  /** Material IDs hidden in the preview. */
  hidden: number[];

  split: (SplitResult & { key: string }) | null;
  connected: ConnectResult | null;
  /** A split / connect / export job in progress. */
  job: { kind: 'split' | 'connect' | 'export'; fraction: number; stage: string } | null;
  selectedPart: string | null;
  hiddenParts: string[];
  /** 0 = assembled, 1 = fully exploded (display only). */
  explode: number;
  past: Settings[];
  future: Settings[];

  importFile: (file: Blob & { name?: string }) => Promise<void>;
  cancelImport: () => void;
  dismissError: () => void;
  closeDocument: () => void;
  setStep: (step: SplitStep) => void;
  canEnter: (step: SplitStep) => boolean;
  select: (materialId: number | null) => void;
  toggleHidden: (materialId: number) => void;
  showAll: () => void;
  isolate: (materialId: number) => void;

  setSplitOptions: (patch: Partial<SplitOptions>) => void;
  setConnectorSettings: (patch: Partial<ConnectorSettings>) => void;
  setPlateSettings: (patch: Partial<PlateSettings>) => void;
  undo: () => void;
  redo: () => void;
  selectPart: (id: string | null) => void;
  togglePartHidden: (id: string) => void;
  showAllParts: () => void;
  setExplode: (v: number) => void;
  cancelJob: () => void;
  /** Re-run whatever the current step needs (split, connectors). */
  ensure: () => Promise<void>;
  exportPackage: (opts: {
    plates3mf: boolean;
    partsStl: boolean;
  }) => Promise<{ zip: Uint8Array; files: string[]; invalidParts: string[]; fileName: string } | null>;
}

let controller: AbortController | null = null;
let jobController: AbortController | null = null;

/** Largest file the browser importer accepts (keeps memory predictable on tablets). */
export const MAX_FILE_BYTES = 250 * 1024 * 1024;

const splitKey = (o: SplitOptions) => JSON.stringify(o);
const connectKey = (s: ConnectorSettings, split: { key: string } | null) => `${JSON.stringify(s)}|${split?.key ?? ''}`;

/** Parts as they currently stand (after connectors when they were made). */
export function currentParts(s: Pick<SplitState, 'split' | 'connected'>): SplitPart[] {
  return s.connected?.parts ?? s.split?.parts ?? [];
}

const layoutCache = { parts: null as SplitPart[] | null, settings: null as PlateSettings | null, layout: null as Layout | null };
/** Plate layout for the current parts (memoised). */
export function currentLayout(s: Pick<SplitState, 'split' | 'connected' | 'plateSettings'>): Layout {
  const parts = currentParts(s);
  if (layoutCache.parts !== parts || layoutCache.settings !== s.plateSettings || !layoutCache.layout) {
    layoutCache.parts = parts;
    layoutCache.settings = s.plateSettings;
    layoutCache.layout = layoutPlates(parts, s.plateSettings);
  }
  return layoutCache.layout;
}

const STORAGE_KEY = 'modellio:split-settings';
function loadSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>;
  } catch {
    return {};
  }
}
function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
const saved = typeof window === 'undefined' ? {} : loadSettings();

export const useSplit = create<SplitState>((set, get) => {
  const settings = (): Settings => ({
    splitOptions: get().splitOptions,
    connectorSettings: get().connectorSettings,
    plateSettings: get().plateSettings,
  });
  const change = (patch: Partial<Settings>) => {
    const before = settings();
    set({ ...patch, past: [...get().past.slice(-49), before], future: [] });
    saveSettings(settings());
    void get().ensure();
  };

  const runSplit = async () => {
    const { doc, splitOptions } = get();
    if (!doc) return;
    jobController?.abort();
    const mine = new AbortController();
    jobController = mine;
    set({ job: { kind: 'split', fraction: 0, stage: 'Splitting colours' }, error: null });
    try {
      const r = await runStudioJob(
        { type: 'split', doc: jobDocument(doc), options: splitOptions },
        {
          signal: mine.signal,
          onProgress: (fraction, stage) => jobController === mine && set({ job: { kind: 'split', fraction, stage } }),
        },
      );
      if (jobController !== mine) return;
      const keep = get().selectedPart;
      set({
        split: { ...r.result, key: splitKey(splitOptions) },
        connected: null,
        job: null,
        selectedPart: r.result.parts.some((p) => p.partId === keep) ? keep : null,
        hiddenParts: [],
      });
    } catch (e) {
      if (jobController !== mine) return;
      set({ job: null, error: e instanceof ImportCancelledError ? null : `Splitting failed: ${(e as Error).message}` });
      throw e;
    } finally {
      if (jobController === mine) jobController = null;
    }
  };

  const runConnect = async () => {
    const { split, connectorSettings } = get();
    if (!split) return;
    const key = connectKey(connectorSettings, split);
    if (!connectorSettings.enabled || !split.joints.length) {
      set({ connected: { parts: split.parts, connectors: [], issues: [], skipped: [], key } });
      return;
    }
    jobController?.abort();
    const mine = new AbortController();
    jobController = mine;
    set({ job: { kind: 'connect', fraction: 0, stage: 'Adding connectors' }, error: null });
    try {
      const r = await runStudioJob(
        { type: 'connect', parts: jobParts(split.parts), joints: split.joints, settings: connectorSettings },
        {
          signal: mine.signal,
          onProgress: (fraction, stage) => jobController === mine && set({ job: { kind: 'connect', fraction, stage } }),
        },
      );
      if (jobController !== mine) return;
      set({ connected: { parts: r.parts, connectors: r.connectors, issues: r.issues, skipped: r.skipped, key }, job: null });
    } catch (e) {
      if (jobController !== mine) return;
      set({ job: null, error: e instanceof ImportCancelledError ? null : `Adding connectors failed: ${(e as Error).message}` });
      throw e;
    } finally {
      if (jobController === mine) jobController = null;
    }
  };

  return {
    doc: null,
    components: [],
    importing: null,
    error: null,
    step: 'import',
    selectedMaterial: null,
    hidden: [],
    split: null,
    connected: null,
    job: null,
    selectedPart: null,
    hiddenParts: [],
    explode: 0,
    past: [],
    future: [],
    splitOptions: { ...DEFAULT_SPLIT_OPTIONS, ...saved.splitOptions },
    connectorSettings: { ...DEFAULT_CONNECTOR_SETTINGS, ...saved.connectorSettings },
    plateSettings: { ...DEFAULT_PLATE_SETTINGS, ...saved.plateSettings },

    importFile: async (file) => {
      const fileName = file.name ?? 'model.3mf';
      if (!/\.3mf$/i.test(fileName)) {
        set({ error: `"${fileName}" is not a 3MF file. Split Studio imports .3mf files exported from a slicer or CAD tool.` });
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        set({
          error: `"${fileName}" is ${(file.size / 1048576).toFixed(0)} MB. Files up to ${MAX_FILE_BYTES / 1048576} MB can be imported.`,
        });
        return;
      }
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      set({ importing: { fileName, fraction: 0, stage: 'Starting' }, error: null });
      try {
        const doc = await importInWorker(file, {
          signal: mine.signal,
          onProgress: (fraction, stage) => {
            if (controller === mine) set({ importing: { fileName, fraction, stage } });
          },
        });
        if (controller !== mine) return;
        jobController?.abort();
        jobController = null;
        set({
          doc,
          components: computeColourComponents(doc),
          importing: null,
          selectedMaterial: null,
          hidden: defaultHidden(doc),
          step: 'import',
          split: null,
          connected: null,
          job: null,
          selectedPart: null,
          hiddenParts: [],
          explode: 0,
        });
      } catch (e) {
        if (controller !== mine) return;
        if (e instanceof ImportCancelledError) set({ importing: null });
        else set({ importing: null, error: e instanceof ImportFailedError ? e.message : `Import failed: ${(e as Error).message}` });
      } finally {
        if (controller === mine) controller = null;
      }
    },
    cancelImport: () => {
      controller?.abort();
      controller = null;
      set({ importing: null });
    },
    dismissError: () => set({ error: null }),
    closeDocument: () => {
      jobController?.abort();
      jobController = null;
      set({
        doc: null,
        components: [],
        selectedMaterial: null,
        hidden: [],
        step: 'import',
        split: null,
        connected: null,
        job: null,
        selectedPart: null,
        hiddenParts: [],
      });
    },
    canEnter: (step) => {
      const s = get();
      if (step === 'import') return true;
      if (!s.doc) return false;
      if (step === 'split') return true;
      return !!s.split && s.split.parts.length > 0;
    },
    setStep: (step) => {
      if (!get().canEnter(step)) return;
      set({ step });
      void get().ensure();
    },
    select: (selectedMaterial) => set({ selectedMaterial }),
    toggleHidden: (id) => set((s) => ({ hidden: s.hidden.includes(id) ? s.hidden.filter((h) => h !== id) : [...s.hidden, id] })),
    showAll: () => set({ hidden: [] }),
    isolate: (id) => set((s) => ({ hidden: s.components.map((c) => c.materialId).filter((m) => m !== id), selectedMaterial: id })),

    setSplitOptions: (patch) => change({ splitOptions: { ...get().splitOptions, ...patch } }),
    setConnectorSettings: (patch) => change({ connectorSettings: { ...get().connectorSettings, ...patch } }),
    setPlateSettings: (patch) => change({ plateSettings: { ...get().plateSettings, ...patch } }),
    undo: () => {
      const { past } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set({ ...prev, past: past.slice(0, -1), future: [settings(), ...get().future] });
      saveSettings(settings());
      void get().ensure();
    },
    redo: () => {
      const { future } = get();
      if (!future.length) return;
      const next = future[0];
      set({ ...next, future: future.slice(1), past: [...get().past, settings()] });
      saveSettings(settings());
      void get().ensure();
    },
    selectPart: (selectedPart) => set({ selectedPart }),
    togglePartHidden: (id) =>
      set((s) => ({ hiddenParts: s.hiddenParts.includes(id) ? s.hiddenParts.filter((h) => h !== id) : [...s.hiddenParts, id] })),
    showAllParts: () => set({ hiddenParts: [] }),
    setExplode: (explode) => set({ explode: Math.max(0, Math.min(1, explode)) }),
    cancelJob: () => {
      jobController?.abort();
      jobController = null;
      set({ job: null });
    },
    ensure: async () => {
      const s = get();
      if (!s.doc) return;
      const at = ORDER.indexOf(s.step);
      try {
        if (at >= 1 && (!s.split || s.split.key !== splitKey(s.splitOptions))) await runSplit();
        const t = get();
        if (at >= 2 && t.split && (!t.connected || t.connected.key !== connectKey(t.connectorSettings, t.split))) await runConnect();
      } catch {
        /* reported in state */
      }
    },
    exportPackage: async ({ plates3mf, partsStl }) => {
      const s = get();
      const parts = currentParts(s);
      if (!parts.length || !s.doc) return null;
      const layout = currentLayout(s);
      jobController?.abort();
      const mine = new AbortController();
      jobController = mine;
      const title = (s.doc.metadata.Title || s.doc.fileName.replace(/\.3mf$/i, '')).trim() || 'model';
      set({ job: { kind: 'export', fraction: 0, stage: 'Writing files' } });
      try {
        const r = await runStudioJob(
          { type: 'export', parts: jobParts(parts), layout, connectors: s.connected?.connectors ?? [], title, plates3mf, partsStl },
          {
            signal: mine.signal,
            onProgress: (fraction, stage) => jobController === mine && set({ job: { kind: 'export', fraction, stage } }),
          },
        );
        if (jobController !== mine) return null;
        set({ job: null });
        return { zip: r.zip, files: r.files, invalidParts: r.invalidParts, fileName: `${title.replace(/[^\w-]+/g, '-')}-split.zip` };
      } catch (e) {
        if (jobController === mine)
          set({ job: null, error: e instanceof ImportCancelledError ? null : `Export failed: ${(e as Error).message}` });
        return null;
      } finally {
        if (jobController === mine) jobController = null;
      }
    },
  };
});

/** Non-printing slicer volumes (modifiers, negative parts) start hidden: they are not part of the print. */
function defaultHidden(doc: ThreeMFDocument): number[] {
  return doc.materials.filter((m) => m.materialType === 'nonprinting').map((m) => m.materialId);
}
