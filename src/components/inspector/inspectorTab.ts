import { create } from 'zustand';

/** Which Inspector tab is showing; remembered while you move between objects (not saved). */
export type InspectorTab = 'properties' | 'appearance' | 'features' | 'print';

export const useInspectorTab = create<{ tab: InspectorTab; setTab: (t: InspectorTab) => void }>((set) => ({
  tab: 'properties',
  setTab: (tab) => set({ tab }),
}));
