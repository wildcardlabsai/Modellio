import { create } from 'zustand';

/**
 * Which sketch is open in the sketch editor: `null` id = a new sketch. `op` pre-selects how a new
 * sketch becomes solid (the toolbar's Extrude and Revolve buttons).
 */
export const useSketchSession = create<{
  editing: { id: string | null; op?: 'extrude' | 'revolve' } | null;
  open: (id: string | null, op?: 'extrude' | 'revolve') => void;
  close: () => void;
}>((set) => ({
  editing: null,
  open: (id, op) => set({ editing: { id, op } }),
  close: () => set({ editing: null }),
}));
