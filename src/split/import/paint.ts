/**
 * Decoder for slicer "painted" triangle data: Bambu/Orca `paint_color` and
 * PrusaSlicer `slic3rpe:mmu_segmentation` attributes. Both use PrusaSlicer's
 * TriangleSelector serialisation:
 *
 * - The hex string is read from the LAST character to the first; each character is one
 *   4-bit nibble (bits least-significant first).
 * - Each node is one nibble. The low two bits are the number of split sides (0–3).
 *   - 0 → leaf. The high two bits are the state (0–2); the value 0b11 means "extended":
 *     the state is the next nibble + 3.
 *   - n > 0 → the triangle is split into n + 1 children, which follow depth-first.
 *     The high two bits are the "special side" (geometry only).
 * - State 0 means "not painted" (the part's own filament); state k means filament/extruder k.
 *
 * Whole-triangle paint (a single leaf) is exact. A split triangle contains sub-triangle
 * regions of different colours: its exact geometry needs the slicer's subdivision, which
 * Phase 3 performs. Here it is detected and summarised by approximate area per state.
 */
export interface PaintInfo {
  /** State of an unsplit triangle; null when the triangle is subdivided. */
  state: number | null;
  /** Approximate area fraction per state (sums to 1). */
  areas: Map<number, number>;
  /** Most common state by area (ties → lowest state). */
  majority: number;
  split: boolean;
}

/** Child area fractions for 1, 2 and 3 split sides (2 sides: a corner quarter plus a quad cut in two; approximate). */
const CHILD_AREAS: Record<number, number[]> = { 1: [0.5, 0.5], 2: [0.25, 0.375, 0.375], 3: [0.25, 0.25, 0.25, 0.25] };

export class PaintDecodeError extends Error {}

export function decodePaint(hex: string): PaintInfo {
  const nibbles: number[] = [];
  for (let i = hex.length - 1; i >= 0; i--) {
    const v = parseInt(hex[i], 16);
    if (Number.isNaN(v)) throw new PaintDecodeError(`invalid paint character "${hex[i]}"`);
    nibbles.push(v);
  }
  let pos = 0;
  const next = () => {
    if (pos >= nibbles.length) throw new PaintDecodeError('paint data ended early');
    return nibbles[pos++];
  };
  const areas = new Map<number, number>();
  let split = false;
  let leafState: number | null = null;
  const node = (area: number, depth: number) => {
    if (depth > 32) throw new PaintDecodeError('paint data is nested too deeply');
    const code = next();
    const sides = code & 0b11;
    if (sides === 0) {
      const state = (code & 0b1100) === 0b1100 ? next() + 3 : code >> 2;
      areas.set(state, (areas.get(state) ?? 0) + area);
      if (depth === 0) leafState = state;
      return;
    }
    split = true;
    for (const f of CHILD_AREAS[sides]) node(area * f, depth + 1);
  };
  if (hex.length === 0) {
    areas.set(0, 1);
    return { state: 0, areas, majority: 0, split: false };
  }
  node(1, 0);
  let majority = 0;
  let best = -1;
  for (const [s, a] of [...areas].sort((x, y) => x[0] - y[0]))
    if (a > best + 1e-9) {
      best = a;
      majority = s;
    }
  return { state: split ? null : leafState, areas, majority, split };
}

/** Encode a whole-triangle state (used by tests and fixtures). */
export function encodeWholeState(state: number): string {
  if (state < 3) return (state << 2).toString(16).toUpperCase();
  // Extended: first nibble 0b1100, second nibble state − 3; written reversed.
  return (state - 3).toString(16).toUpperCase() + 'C';
}
