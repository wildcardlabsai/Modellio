import { create } from 'zustand';
import { computeColourComponents } from './model/components';
import type { ColourComponent, ThreeMFDocument } from './model/types';
import { ImportCancelledError, ImportFailedError, importInWorker } from './worker/client';

export type SplitStep = 'import' | 'split' | 'connect' | 'export';

export const STEPS: { id: SplitStep; label: string }[] = [
  { id: 'import', label: 'Import' },
  { id: 'split', label: 'Split' },
  { id: 'connect', label: 'Connect' },
  { id: 'export', label: 'Export' },
];

/** Steps whose tools exist. The guided flow only lets you move to these. */
export const AVAILABLE_STEPS: SplitStep[] = ['import'];

interface SplitState {
  doc: ThreeMFDocument | null;
  components: ColourComponent[];
  /** Import in progress (the previous document stays visible until it succeeds). */
  importing: { fileName: string; fraction: number; stage: string } | null;
  error: string | null;
  step: SplitStep;
  selectedMaterial: number | null;
  /** Material IDs hidden in the preview. */
  hidden: number[];
  importFile: (file: Blob & { name?: string }) => Promise<void>;
  cancelImport: () => void;
  dismissError: () => void;
  closeDocument: () => void;
  setStep: (step: SplitStep) => void;
  select: (materialId: number | null) => void;
  toggleHidden: (materialId: number) => void;
  showAll: () => void;
  isolate: (materialId: number) => void;
}

let controller: AbortController | null = null;

/** Largest file the browser importer accepts (keeps memory predictable on tablets). */
export const MAX_FILE_BYTES = 250 * 1024 * 1024;

export const useSplit = create<SplitState>((set) => ({
  doc: null,
  components: [],
  importing: null,
  error: null,
  step: 'import',
  selectedMaterial: null,
  hidden: [],

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
      set({
        doc,
        components: computeColourComponents(doc),
        importing: null,
        selectedMaterial: null,
        hidden: defaultHidden(doc),
        step: 'import',
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
  closeDocument: () => set({ doc: null, components: [], selectedMaterial: null, hidden: [], step: 'import' }),
  setStep: (step) => {
    if (AVAILABLE_STEPS.includes(step)) set({ step });
  },
  select: (selectedMaterial) => set({ selectedMaterial }),
  toggleHidden: (id) => set((s) => ({ hidden: s.hidden.includes(id) ? s.hidden.filter((h) => h !== id) : [...s.hidden, id] })),
  showAll: () => set({ hidden: [] }),
  isolate: (id) => set((s) => ({ hidden: s.components.map((c) => c.materialId).filter((m) => m !== id), selectedMaterial: id })),
}));

/** Non-printing slicer volumes (modifiers, negative parts) start hidden: they are not part of the print. */
function defaultHidden(doc: ThreeMFDocument): number[] {
  return doc.materials.filter((m) => m.materialType === 'nonprinting').map((m) => m.materialId);
}

/** For tests and debugging. */
export const splitDebug = { get: () => useSplit.getState() };
