import { create } from 'zustand';
import type { Frame, SketchPlacement } from '@/types/document';

/** Where a new sketch sits: a reference plane or a flat face, its frame, and words for it. */
export interface SketchPlace {
  placement: SketchPlacement;
  frame: Frame;
  label: string;
}

/**
 * Which sketch is open in the sketch editor: `null` id = a new sketch. `op` pre-selects how a new
 * sketch becomes solid (the toolbar's Extrude and Revolve buttons). `record` edits a standalone
 * sketch directly (every body built from it is rebuilt when it is saved). `place` puts a new
 * sketch on a reference plane or a face.
 */
export const useSketchSession = create<{
  editing: { id: string | null; op?: 'extrude' | 'revolve'; record?: string; place?: SketchPlace } | null;
  open: (id: string | null, op?: 'extrude' | 'revolve') => void;
  openRecord: (sketchId: string) => void;
  /** A new sketch on a plane or face. */
  openOn: (place: SketchPlace) => void;
  close: () => void;
}>((set) => ({
  editing: null,
  open: (id, op) => set({ editing: { id, op } }),
  openRecord: (record) => set({ editing: { id: null, record } }),
  openOn: (place) => set({ editing: { id: null, place } }),
  close: () => set({ editing: null }),
}));
