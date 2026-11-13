import { create } from 'zustand';

/**
 * Studios are separate workspaces in one app. The active studio lives in the URL query
 * (`?studio=split`) so it survives reloads, can be linked to, works with Back/Forward and
 * never collides with `#share=` links (which use the hash).
 */
export type StudioId = 'design' | 'split';

export const STUDIOS: { id: StudioId; label: string; description: string }[] = [
  { id: 'design', label: 'Design', description: 'Model with shapes' },
  { id: 'split', label: 'Split Studio', description: 'Separate a multi-colour 3MF into printable parts' },
];

const fromUrl = (): StudioId => {
  try {
    return new URLSearchParams(window.location.search).get('studio') === 'split' ? 'split' : 'design';
  } catch {
    return 'design';
  }
};

interface StudioState {
  studio: StudioId;
  setStudio: (id: StudioId) => void;
}

export const useStudio = create<StudioState>((set, get) => ({
  studio: typeof window === 'undefined' ? 'design' : fromUrl(),
  setStudio: (id) => {
    if (get().studio === id) return;
    const url = new URL(window.location.href);
    if (id === 'design') url.searchParams.delete('studio');
    else url.searchParams.set('studio', id);
    window.history.pushState({ studio: id }, '', url);
    set({ studio: id });
  },
}));

if (typeof window !== 'undefined') window.addEventListener('popstate', () => useStudio.setState({ studio: fromUrl() }));
