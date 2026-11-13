import { useEffect } from 'react';
import { create } from 'zustand';

/** Below this width, side panels become slide-over drawers (tablets, small laptops). */
export const COMPACT_QUERY = '(max-width: 1100px)';

interface LayoutState {
  compact: boolean;
  leftOpen: boolean;
  inspectorOpen: boolean;
  setLeftOpen: (v: boolean) => void;
  setInspectorOpen: (v: boolean) => void;
}

export const useLayout = create<LayoutState>()((set) => ({
  compact: typeof matchMedia !== 'undefined' && matchMedia(COMPACT_QUERY).matches,
  leftOpen: false,
  inspectorOpen: false,
  setLeftOpen: (leftOpen) => set({ leftOpen }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
}));

/** Track the compact breakpoint. */
export function useResponsiveLayout() {
  useEffect(() => {
    const mq = matchMedia(COMPACT_QUERY);
    const update = () => useLayout.setState({ compact: mq.matches, leftOpen: false, inspectorOpen: false });
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
}
