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
  /** A maker asked to start a new, blank design (from New design). */
  fresh: string | null;
  /** Hand a saved maker project to its maker. */
  give: (p: PendingMakerProject) => void;
  /** Ask a maker to start a new design. */
  giveFresh: (studio: string) => void;
  /** Called by a maker when it opens: returns (and clears) a project meant for it. */
  take: (studio: string) => PendingMakerProject | null;
  /** Called by a maker when it opens: whether a new design was asked for (and clears it). */
  takeFresh: (studio: string) => boolean;
}

export const useMakerHandoff = create<HandoffState>((set, get) => ({
  pending: null,
  fresh: null,
  give: (pending) => set({ pending, fresh: null }),
  giveFresh: (fresh) => set({ fresh, pending: null }),
  take: (studio) => {
    const p = get().pending;
    if (!p || p.studio !== studio) return null;
    set({ pending: null });
    return p;
  },
  takeFresh: (studio) => {
    if (get().fresh !== studio) return false;
    set({ fresh: null });
    return true;
  },
}));
