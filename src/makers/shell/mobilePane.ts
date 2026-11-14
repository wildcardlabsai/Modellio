import { create } from 'zustand';

/** On phones a maker shows one pane at a time: its tools, the canvas/preview, or settings & export. */
export type MakerPane = 'tools' | 'canvas' | 'settings';

export const useMakerPane = create<{ pane: MakerPane; setPane: (p: MakerPane) => void }>((set) => ({
  pane: 'canvas',
  setPane: (pane) => set({ pane }),
}));

/** Extra classes for a maker column: full width on phones, hidden unless it is the chosen pane. */
export const paneClass = (current: MakerPane, which: MakerPane) =>
  `max-md:w-full max-md:border-x-0 ${current === which ? '' : 'max-md:hidden'}`;
