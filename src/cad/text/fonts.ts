import opentype from 'opentype.js';
import type { FontId } from '@/types/document';

/**
 * Fonts for 3D text. All are SIL Open Font License fonts from Fontsource,
 * bundled with the app (no network dependency) and parsed with opentype.js.
 */
export interface FontDef {
  id: FontId;
  label: string;
  load: () => Promise<string>; // resolves to a URL of the WOFF file
}

export const FONTS: FontDef[] = [
  { id: 'inter-bold', label: 'Inter Bold', load: () => import('@fontsource/inter/files/inter-latin-700-normal.woff?url').then((m) => m.default) },
  { id: 'inter', label: 'Inter', load: () => import('@fontsource/inter/files/inter-latin-400-normal.woff?url').then((m) => m.default) },
  { id: 'roboto-slab', label: 'Roboto Slab', load: () => import('@fontsource/roboto-slab/files/roboto-slab-latin-700-normal.woff?url').then((m) => m.default) },
  { id: 'bebas-neue', label: 'Bebas Neue', load: () => import('@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff?url').then((m) => m.default) },
  { id: 'pacifico', label: 'Pacifico', load: () => import('@fontsource/pacifico/files/pacifico-latin-400-normal.woff?url').then((m) => m.default) },
  { id: 'space-mono', label: 'Space Mono', load: () => import('@fontsource/space-mono/files/space-mono-latin-700-normal.woff?url').then((m) => m.default) },
];

export const DEFAULT_FONT: FontId = 'inter-bold';

const loaded = new Map<FontId, opentype.Font>();
const pending = new Map<FontId, Promise<opentype.Font>>();
const listeners = new Set<() => void>();

/** Register an already-available font (used by tests and future custom-font upload). */
export function registerFont(id: FontId, buffer: ArrayBuffer): opentype.Font {
  const font = opentype.parse(buffer);
  loaded.set(id, font);
  listeners.forEach((l) => l());
  return font;
}

export function getLoadedFont(id: FontId): opentype.Font | null {
  return loaded.get(id) ?? null;
}

export function loadFont(id: FontId): Promise<opentype.Font> {
  const existing = loaded.get(id);
  if (existing) return Promise.resolve(existing);
  let p = pending.get(id);
  if (!p) {
    const def = FONTS.find((f) => f.id === id);
    if (!def) return Promise.reject(new Error(`Unknown font ${id}`));
    p = def
      .load()
      .then((url) => fetch(url))
      .then((r) => {
        if (!r.ok) throw new Error(`Font download failed (${r.status})`);
        return r.arrayBuffer();
      })
      .then((buf) => registerFont(id, buf));
    pending.set(id, p);
  }
  return p;
}

export function onFontLoaded(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
