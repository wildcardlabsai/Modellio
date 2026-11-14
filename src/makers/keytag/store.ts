import { initKernel } from '@/cad/kernel/kernel';
import { createMakerStore } from '../canvas/store';
import { ensureFonts, fitNatural } from '../canvas/model';
import { buildKeyring, DEFAULT_KEYRING, type KeyringParams, type KeyringResult } from '../keyring/geometry';
import { holeAtEdge } from '../keyring/store';
import { numberedElements, tagCount, type Numbering } from './numbering';
import { BLANK_KEYTAG, DEFAULT_NUMBERING, KEYTAG_TEMPLATES } from './templates';

export interface KeyTagParams extends KeyringParams {
  numbering: Numbering;
  /** Which tag of the run the preview shows (0-based). */
  preview: number;
}

export const DEFAULT_KEYTAG: KeyTagParams = { ...DEFAULT_KEYRING, numbering: DEFAULT_NUMBERING, preview: 0 };

export const useKeyTag = createMakerStore<KeyTagParams, KeyringResult>({
  key: 'modellio:keytag',
  defaults: DEFAULT_KEYTAG,
  initial: () => ({
    elements: KEYTAG_TEMPLATES[0].elements,
    params: { ...DEFAULT_KEYTAG, ...KEYTAG_TEMPLATES[0].params },
    templateId: KEYTAG_TEMPLATES[0].id,
  }),
  build: async (elements, params) => {
    await ensureFonts(elements);
    const fixed = fitNatural(elements);
    if (fixed !== elements) useKeyTag.setState({ elements: fixed });
    const index = Math.min(params.preview, tagCount(params.numbering) - 1);
    return buildKeyring(await initKernel(), numberedElements(fixed, params.numbering, index), params);
  },
});

export async function openKeyTagTemplate(id: string) {
  const t = KEYTAG_TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  await ensureFonts(t.elements);
  useKeyTag.getState().load(fitNatural(t.elements), { ...DEFAULT_KEYTAG, ...t.params }, id);
}

export function startBlankKeyTag() {
  useKeyTag.getState().load(BLANK_KEYTAG.elements, { ...DEFAULT_KEYTAG, ...BLANK_KEYTAG.params }, null);
}

export function placeKeyTagHole() {
  const { elements, params, setParams } = useKeyTag.getState();
  const hole = holeAtEdge(elements, params);
  if (hole) setParams({ hole });
}

/** Build every tag in the run (for the batch download). */
export async function buildAllTags(onProgress?: (done: number, total: number) => void): Promise<KeyringResult[]> {
  const { elements, params } = useKeyTag.getState();
  await ensureFonts(elements);
  const k = await initKernel();
  const total = tagCount(params.numbering);
  const out: KeyringResult[] = [];
  for (let i = 0; i < total; i++) {
    out.push(buildKeyring(k, numberedElements(elements, params.numbering, i), params));
    onProgress?.(i + 1, total);
    // Let the page breathe between tags.
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}
