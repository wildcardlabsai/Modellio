import { initKernel } from '@/cad/kernel/kernel';
import { createMakerStore } from '../canvas/store';
import { designBounds, ensureFonts, fitNatural, type DesignElement } from '../canvas/model';
import { buildKeyring, DEFAULT_KEYRING, type KeyringParams, type KeyringResult } from './geometry';
import { KEYRING_TEMPLATES, BLANK_KEYRING } from './templates';

export const useKeyring = createMakerStore<KeyringParams, KeyringResult>({
  key: 'modellio:keyring',
  defaults: DEFAULT_KEYRING,
  initial: () => ({
    elements: KEYRING_TEMPLATES[0].elements,
    params: { ...DEFAULT_KEYRING, ...KEYRING_TEMPLATES[0].params },
    templateId: KEYRING_TEMPLATES[0].id,
  }),
  build: async (elements, params) => {
    await ensureFonts(elements);
    const fixed = fitNatural(elements);
    if (fixed !== elements) useKeyring.setState({ elements: fixed });
    // A blank design gets its ring placed on the first thing added.
    if (autoHole && fixed.length) {
      autoHole = false;
      const hole = holeAtEdge(fixed, params);
      if (hole) {
        params = { ...params, hole };
        useKeyring.setState({ params });
      }
    }
    return buildKeyring(await initKernel(), fixed, params);
  },
});

export async function openKeyringTemplate(id: string) {
  const t = KEYRING_TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  await ensureFonts(t.elements);
  useKeyring.getState().load(fitNatural(t.elements), { ...DEFAULT_KEYRING, ...t.params }, id);
}

let autoHole = false;

/** The key ring hole on the left edge of the design, centred vertically, overlapping it by the ring wall. */
export function holeAtEdge(elements: DesignElement[], p: KeyringParams): KeyringParams['hole'] | null {
  const b = designBounds(elements.filter((e) => e.role !== 'cut'));
  if (!b) return null;
  const extra = p.plateMode === 'bubble' ? p.margin : 0;
  const x = b.minX - extra - p.hole.diameter / 2 - 0.5;
  return { ...p.hole, enabled: true, x: Math.round(x * 2) / 2, y: Math.round(((b.minY + b.maxY) / 2) * 2) / 2 };
}

export function placeHoleAtEdge() {
  const { elements, params, setParams, result } = useKeyring.getState();
  const h = params.hole;
  const reach = h.diameter / 2 + h.rim + 0.3;
  // The leftmost point of the built tag (ignoring the ring itself), else the design's box.
  let best: [number, number] | null = null;
  for (const poly of result?.outline ?? [])
    for (const pt of poly) if (Math.hypot(pt[0] - h.x, pt[1] - h.y) > reach && (!best || pt[0] < best[0])) best = pt;
  const hole = best
    ? { ...h, enabled: true, x: Math.round((best[0] - h.diameter / 2 - 0.5) * 2) / 2, y: Math.round(best[1] * 2) / 2 }
    : holeAtEdge(elements, params);
  if (hole) setParams({ hole });
}

export function startBlankKeyring() {
  autoHole = true;
  useKeyring.getState().load(BLANK_KEYRING.elements, BLANK_KEYRING.params, null);
}
