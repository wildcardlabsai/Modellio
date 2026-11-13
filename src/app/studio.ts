import { create } from 'zustand';

/**
 * Where the app is: the landing page (`/`) or one of the studios. The studio lives in the URL
 * query (`?studio=design`, `?studio=split`) so it survives reloads, can be linked to, works with
 * Back/Forward and never collides with `#share=` links (which use the hash). Share links open the
 * Design studio, including older links that carry no `studio` parameter.
 */
export type StudioId = 'home' | 'design' | 'split' | 'cookie';

export const studioUrl = (id: StudioId) => (id === 'home' ? '/' : `/?studio=${id}`);

const fromUrl = (): StudioId => {
  try {
    const s = new URLSearchParams(window.location.search).get('studio');
    if (s === 'split') return 'split';
    if (s === 'cookie') return 'cookie';
    if (s === 'design') return 'design';
    if (window.location.hash.startsWith('#share=')) return 'design';
    return 'home';
  } catch {
    return 'home';
  }
};

interface StudioState {
  studio: StudioId;
  setStudio: (id: StudioId) => void;
}

export const useStudio = create<StudioState>((set, get) => ({
  studio: typeof window === 'undefined' ? 'home' : fromUrl(),
  setStudio: (id) => {
    if (get().studio === id) return;
    const url = new URL(window.location.href);
    if (id === 'home') url.searchParams.delete('studio');
    else url.searchParams.set('studio', id);
    // Section anchors (#faq) belong to the landing page; share links are handled by the Design studio.
    if (!url.hash.startsWith('#share=')) url.hash = '';
    window.history.pushState({ studio: id }, '', url);
    set({ studio: id });
    window.scrollTo?.(0, 0);
  },
}));

if (typeof window !== 'undefined') window.addEventListener('popstate', () => useStudio.setState({ studio: fromUrl() }));
