import { create } from 'zustand';

/**
 * Which sketch is open in the sketch editor: `null` id = a new sketch. `op` pre-selects how a new
 * sketch becomes solid (the toolbar's Extrude and Revolve buttons). `record` edits a standalone
 * sketch directly (every body built from it is rebuilt when it is saved).
 */
export const useSketchSession = create<{
  editing: { id: string | null; op?: 'extrude' | 'revolve'; record?: string } | null;
  open: (id: string | null, op?: 'extrude' | 'revolve') => void;
  openRecord: (sketchId: string) => void;
  close: () => void;
}>((set) => ({
  editing: null,
  open: (id, op) => set({ editing: { id, op } }),
  openRecord: (record) => set({ editing: { id: null, record } }),
  close: () => set({ editing: null }),
}));
