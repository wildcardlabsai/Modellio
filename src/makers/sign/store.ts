import { initKernel } from '@/cad/kernel/kernel';
import { createMakerStore } from '../canvas/store';
import { ensureFonts, fitNatural } from '../canvas/model';
import { buildSign, DEFAULT_SIGN, type SignParams, type SignResult } from './geometry';
import { BLANK_SIGN, SIGN_TEMPLATES } from './templates';

export const useSign = createMakerStore<SignParams, SignResult>({
  key: 'modellio:sign',
  defaults: DEFAULT_SIGN,
  initial: () => ({
    elements: SIGN_TEMPLATES[0].elements,
    params: { ...DEFAULT_SIGN, ...SIGN_TEMPLATES[0].params },
    templateId: SIGN_TEMPLATES[0].id,
  }),
  build: async (elements, params) => {
    await ensureFonts(elements);
    const fixed = fitNatural(elements);
    if (fixed !== elements) useSign.setState({ elements: fixed });
    return buildSign(await initKernel(), fixed, params);
  },
});

export async function openSignTemplate(id: string) {
  const t = SIGN_TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  await ensureFonts(t.elements);
  useSign.getState().load(fitNatural(t.elements), { ...DEFAULT_SIGN, ...t.params }, id);
}

export function startBlankSign() {
  useSign.getState().load(BLANK_SIGN.elements, BLANK_SIGN.params, null);
}
