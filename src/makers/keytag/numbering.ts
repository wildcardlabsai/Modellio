import { naturalAspect, type DesignElement } from '../canvas/model';

/** Sequential numbering for a run of tags. `{#}` in any text is replaced by the number. */
export interface Numbering {
  start: number;
  count: number;
  step: number;
  /** Minimum digits (zero-padded), e.g. 3 → 007. */
  pad: number;
}

export const NUMBER_TOKEN = '{#}';
export const MAX_TAGS = 100;

export function tagNumber(n: Numbering, index: number): string {
  const v = n.start + index * n.step;
  const s = String(Math.abs(Math.round(v))).padStart(Math.max(1, Math.min(8, n.pad)), '0');
  return v < 0 ? `-${s}` : s;
}

export const usesNumber = (elements: DesignElement[]) => elements.some((e) => e.kind === 'text' && e.text.includes(NUMBER_TOKEN));

/**
 * The design for tag `index`: every `{#}` replaced by its number. Text keeps its height and
 * centre; its width follows the new content (fonts must be loaded).
 */
export function numberedElements(elements: DesignElement[], n: Numbering, index: number): DesignElement[] {
  const num = tagNumber(n, index);
  return elements.map((e) => {
    if (e.kind !== 'text' || !e.text.includes(NUMBER_TOKEN)) return e;
    const next = { ...e, text: e.text.split(NUMBER_TOKEN).join(num) } as DesignElement;
    const a = naturalAspect(next);
    return a ? ({ ...next, w: Math.round(e.h * a * 10) / 10 } as DesignElement) : next;
  });
}

export const tagCount = (n: Numbering) => Math.max(1, Math.min(MAX_TAGS, Math.round(n.count)));
