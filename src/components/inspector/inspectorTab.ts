import { create } from 'zustand';
import { onProjectSwitch } from '@/platform/projectScope';

/** Which Inspector tab is showing; remembered while you move between objects (not saved). */
export type InspectorTab = 'properties' | 'appearance' | 'features' | 'print';

export const useInspectorTab = create<{ tab: InspectorTab; setTab: (t: InspectorTab) => void }>((set) => ({
  tab: 'properties',
  setTab: (tab) => set({ tab }),
}));

// A newly opened design starts clean (see platform/projectScope).
onProjectSwitch('inspector-tab', () => useInspectorTab.setState({ tab: 'properties' }));
