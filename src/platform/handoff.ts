import { create } from 'zustand';

/** A maker project waiting to be opened by its maker (makers are loaded on demand). */
export interface PendingMakerProject {
  projectId: string;
  name: string;
  studio: string;
  schema: number;
  state: unknown;
}

interface HandoffState {
  pending: PendingMakerProject | null;
  /** Hand a saved maker project to its maker. */
  give: (p: PendingMakerProject) => void;
  /** Called by a maker when it opens: returns (and clears) a project meant for it. */
  take: (studio: string) => PendingMakerProject | null;
}

export const useMakerHandoff = create<HandoffState>((set, get) => ({
  pending: null,
  give: (pending) => set({ pending }),
  take: (studio) => {
    const p = get().pending;
    if (!p || p.studio !== studio) return null;
    set({ pending: null });
    return p;
  },
}));
