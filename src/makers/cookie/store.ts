import { initKernel } from '@/cad/kernel/kernel';
import { createMakerStore } from '../canvas/store';
import { ensureFonts, fitNatural, type DesignElement } from '../canvas/model';
import { buildCookieDesign, DEFAULT_COOKIE_PARAMS, type CookieParams, type CookieResult } from './geometry';
import { COOKIE_TEMPLATES, BLANK_COOKIE } from './templates';

const first = COOKIE_TEMPLATES[0];

export const useCookie = createMakerStore<CookieParams, CookieResult>({
  key: 'modellio:cookie-design',
  defaults: DEFAULT_COOKIE_PARAMS,
  initial: () => ({ elements: fitNatural(first.elements), params: { ...DEFAULT_COOKIE_PARAMS, ...first.params }, templateId: first.id }),
  build: async (elements, params) => {
    await ensureFonts(elements);
    const fitted = fitNatural(elements);
    if (fitted !== elements) useCookie.setState({ elements: fitted });
    return buildCookieDesign(await initKernel(), fitted, params);
  },
});

export async function openCookieTemplate(id: string) {
  const t = COOKIE_TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  await ensureFonts(t.elements);
  useCookie.getState().load(fitNatural(t.elements), { ...DEFAULT_COOKIE_PARAMS, ...t.params }, id);
}

export function startBlankCookie() {
  useCookie.getState().load(BLANK_COOKIE.elements, BLANK_COOKIE.params, null);
}

/** Scale the whole design about its centre so its longest side is `size` mm. */
export function resizeDesign(elements: DesignElement[], size: number, current: number): DesignElement[] {
  if (!(current > 0) || !(size > 0)) return elements;
  const f = size / current;
  return elements.map((e) => ({
    ...e,
    x: e.x * f,
    y: e.y * f,
    w: e.w * f,
    h: e.h * f,
    ...(e.kind === 'draw' ? { width: e.width * f } : {}),
  })) as DesignElement[];
}
