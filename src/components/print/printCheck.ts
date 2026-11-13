import { create } from 'zustand';
import { analyzePrintability, DEFAULT_PRINT_SETTINGS, type PrintReport, type PrintSettings } from '@/cad/analysis/printability';
import { collectExportBodies, type ExportBody } from '@/cad/export/collect';
import { useEditor } from '@/store/editorStore';

interface PrintCheckState {
  settings: PrintSettings;
  report: PrintReport | null;
  /** The bodies the report refers to (world-space meshes, for highlighting). */
  bodies: ExportBody[];
  running: boolean;
  /** The design changed since the last check. */
  stale: boolean;
  highlight: boolean;
  setSettings: (s: Partial<PrintSettings>) => void;
  setHighlight: (v: boolean) => void;
  run: () => Promise<void>;
  clear: () => void;
}

export const usePrintCheck = create<PrintCheckState>()((set, get) => ({
  settings: { ...DEFAULT_PRINT_SETTINGS },
  report: null,
  bodies: [],
  running: false,
  stale: false,
  highlight: true,
  setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
  setHighlight: (highlight) => set({ highlight }),
  clear: () => set({ report: null, bodies: [], stale: false }),
  run: async () => {
    set({ running: true });
    // Let the "Checking…" state paint before the (synchronous) analysis.
    await new Promise((r) => setTimeout(r, 30));
    const doc = useEditor.getState().doc;
    const bodies = collectExportBodies(doc).bodies;
    const report = analyzePrintability(bodies, { ...get().settings, plate: doc.settings.workplane });
    set({ report, bodies, running: false, stale: false });
  },
}));

// Results describe a specific version of the design: mark them stale on change.
useEditor.subscribe((s, prev) => {
  if (s.doc !== prev.doc && usePrintCheck.getState().report) usePrintCheck.setState({ stale: true });
});
