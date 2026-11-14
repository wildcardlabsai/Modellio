import { create } from 'zustand';

/** Which sketch is open in the sketch editor: `null` id = a new sketch. */
export const useSketchSession = create<{
  editing: { id: string | null } | null;
  open: (id: string | null) => void;
  close: () => void;
}>((set) => ({
  editing: null,
  open: (id) => set({ editing: { id } }),
  close: () => set({ editing: null }),
}));
