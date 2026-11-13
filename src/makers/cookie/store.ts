import { create } from 'zustand';
import { initKernel } from '@/cad/kernel/kernel';
import { DEFAULT_FONT, loadFont } from '@/cad/text/fonts';
import { textContours } from '@/cad/text/textGeometry';
import type { FontId } from '@/types/document';
import { buildCookie, DEFAULT_COOKIE_PARAMS, type CookieParams, type CookieResult, type CookieSource } from './geometry';
import { shapeById, type Poly } from './shapes';
import { maskFromRgba, otsu, traceMask } from './trace';

export type SourceTab = 'shape' | 'text' | 'picture';

export interface UploadedSvg {
  kind: 'svg';
  name: string;
  polygons: Poly[];
}
export interface UploadedImage {
  kind: 'image';
  name: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  threshold: number;
  invert: boolean;
  usesAlpha: boolean;
}

interface CookieState {
  tab: SourceTab;
  shapeId: string;
  text: string;
  font: FontId;
  upload: UploadedSvg | UploadedImage | null;
  params: CookieParams;
  result: CookieResult | null;
  error: string | null;
  building: boolean;
  setTab: (t: SourceTab) => void;
  setShape: (id: string) => void;
  setText: (t: string) => void;
  setFont: (f: FontId) => void;
  setUpload: (u: UploadedSvg | UploadedImage | null) => void;
  setImageOptions: (o: { threshold?: number; invert?: boolean }) => void;
  setParams: (p: Partial<CookieParams>) => void;
  rebuild: () => void;
}

const KEY = 'modellio:cookie';
function load(): Partial<Pick<CookieState, 'tab' | 'shapeId' | 'text' | 'font' | 'params'>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}
const saved = typeof window === 'undefined' ? {} : load();

let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

/** The design as outlines, from whichever source is active. */
export async function currentSource(s: Pick<CookieState, 'tab' | 'shapeId' | 'text' | 'font' | 'upload'>): Promise<CookieSource> {
  if (s.tab === 'shape') return { kind: 'shape', polygons: shapeById(s.shapeId).polygons(), fillRule: 'Positive' };
  if (s.tab === 'text') {
    const text = s.text.trim();
    if (!text) return { kind: 'text', polygons: [], fillRule: 'NonZero' };
    const font = await loadFont(s.font);
    return {
      kind: 'text',
      polygons: textContours(font, { content: text, fontSize: 20, depth: 1, curveSegments: 8 }) as Poly[],
      fillRule: 'NonZero',
    };
  }
  const u = s.upload;
  if (!u) return { kind: 'image', polygons: [], fillRule: 'EvenOdd' };
  if (u.kind === 'svg') return { kind: 'svg', polygons: u.polygons, fillRule: 'Positive' };
  const { mask } = maskFromRgba(u.rgba, u.width, u.height, u.threshold, u.invert);
  return {
    kind: 'image',
    polygons: traceMask(mask, u.width, u.height, { tolerance: 0.9, smoothing: 2, minAreaFraction: 0.0008 }),
    fillRule: 'EvenOdd',
  };
}

export const useCookie = create<CookieState>((set, get) => {
  const persist = () => {
    const { tab, shapeId, text, font, params } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ tab: tab === 'picture' ? 'shape' : tab, shapeId, text, font, params }));
    } catch {
      /* storage unavailable */
    }
  };
  const changed = (patch: Partial<CookieState>) => {
    set(patch);
    persist();
    get().rebuild();
  };
  return {
    tab: saved.tab ?? 'shape',
    shapeId: saved.shapeId ?? 'heart',
    text: saved.text ?? 'Ava',
    font: saved.font ?? DEFAULT_FONT,
    upload: null,
    params: { ...DEFAULT_COOKIE_PARAMS, ...saved.params },
    result: null,
    error: null,
    building: false,
    setTab: (tab) => {
      // Text needs a margin to join its letters into one cookie; shapes don't.
      const params = { ...get().params };
      if (tab === 'text' && params.outline < 2) params.outline = 4;
      if (tab === 'shape' && get().tab === 'text') params.outline = 0;
      changed({ tab, params });
    },
    setShape: (shapeId) => changed({ shapeId, tab: 'shape' }),
    setText: (text) => changed({ text: text.slice(0, 40) }),
    setFont: (font) => changed({ font }),
    setUpload: (upload) => changed({ upload, tab: 'picture' }),
    setImageOptions: (o) => {
      const u = get().upload;
      if (u?.kind === 'image') changed({ upload: { ...u, ...o } });
    },
    setParams: (p) => changed({ params: { ...get().params, ...p } }),
    rebuild: () => {
      if (timer) clearTimeout(timer);
      set({ building: true });
      timer = setTimeout(async () => {
        const mine = ++generation;
        try {
          const [k, source] = await Promise.all([initKernel(), currentSource(get())]);
          if (mine !== generation) return;
          if (!source.polygons.length) {
            set({
              result: null,
              building: false,
              error: get().tab === 'picture' ? null : 'There is no design yet. Pick a shape or type some text.',
            });
            return;
          }
          const result = buildCookie(k, source, get().params);
          if (mine === generation) set({ result, error: null, building: false });
        } catch (e) {
          if (mine === generation) set({ error: (e as Error).message, building: false, result: null });
        }
      }, 120);
    },
  };
});

/** Read a picture file (PNG/JPG/WebP) into RGBA pixels, scaled so the longest side is at most 600 px. */
export async function readImageFile(file: File): Promise<UploadedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const threshold = otsu(rgba, width * height);
  const { usesAlpha } = maskFromRgba(rgba, width, height, threshold, false);
  return { kind: 'image', name: file.name, width, height, rgba, threshold, invert: false, usesAlpha };
}
