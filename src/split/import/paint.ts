/**
 * Decoder for slicer "painted" triangle data: Bambu/Orca `paint_color` and PrusaSlicer
 * `slic3rpe:mmu_segmentation`. Both use PrusaSlicer's TriangleSelector serialisation:
 *
 * - The hex string is read from the LAST character to the first; each character is one
 *   4-bit nibble (bits least-significant first).
 * - Each node is one nibble. The low two bits are the number of split sides (0–3).
 *   - 0 → leaf. The high two bits are the state (0–2); the value 0b11 means "extended":
 *     the state is the next nibble + 3.
 *   - n > 0 → the triangle is split into n + 1 children. The high two bits are the
 *     "special side". Children are serialised in REVERSE order (child n first, child 0
 *     last), as PrusaSlicer does for compatibility with 2.3.1.
 * - State 0 means "not painted" (the part's own filament); state k means filament/extruder k.
 *
 * Geometry of a split (TriangleSelector::perform_split): the triangle's vertices are rotated
 * to start at index `special side` → (r0, r1, r2); new vertices are edge midpoints.
 *   1 side:  m12;            children (r0, r1, m12), (m12, r2, r0)
 *   2 sides: m01, m20;       children (r0, m01, m20), (m01, r1, m20), (r1, r2, m20)
 *   3 sides: m01, m12, m20;  children (r0, m01, m20), (m01, r1, m12), (m12, r2, m20), (m01, m12, m20)
 */
export type PaintNode = { state: number } | { sides: 1 | 2 | 3; special: number; children: PaintNode[] };

export interface PaintInfo {
  /** State of an unsplit triangle; null when the triangle is subdivided. */
  state: number | null;
  /** Exact area fraction per state (sums to 1). */
  areas: Map<number, number>;
  /** Most common state by area (ties → lowest state). */
  majority: number;
  split: boolean;
}

export class PaintDecodeError extends Error {}

/** Area of each child as a fraction of its parent, in child-index order. */
const CHILD_AREAS: Record<number, number[]> = { 1: [0.5, 0.5], 2: [0.25, 0.25, 0.5], 3: [0.25, 0.25, 0.25, 0.25] };

export function parsePaintTree(hex: string): PaintNode {
  if (hex.length === 0) return { state: 0 };
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
  const node = (depth: number): PaintNode => {
    if (depth > 32) throw new PaintDecodeError('paint data is nested too deeply');
    const code = next();
    const sides = code & 0b11;
    if (sides === 0) return { state: (code & 0b1100) === 0b1100 ? next() + 3 : code >> 2 };
    const children: PaintNode[] = new Array(sides + 1);
    for (let k = sides; k >= 0; k--) children[k] = node(depth + 1);
    return { sides: sides as 1 | 2 | 3, special: sides === 3 ? 0 : code >> 2, children };
  };
  const root = node(0);
  return root;
}

export function decodePaint(hex: string): PaintInfo {
  const root = parsePaintTree(hex);
  const areas = new Map<number, number>();
  const walk = (n: PaintNode, area: number) => {
    if ('state' in n) areas.set(n.state, (areas.get(n.state) ?? 0) + area);
    else n.children.forEach((c, i) => walk(c, area * CHILD_AREAS[n.sides][i]));
  };
  walk(root, 1);
  let majority = 0;
  let best = -1;
  for (const [s, a] of [...areas].sort((x, y) => x[0] - y[0]))
    if (a > best + 1e-9) {
      best = a;
      majority = s;
    }
  const split = !('state' in root);
  return { state: split ? null : (root as { state: number }).state, areas, majority, split };
}

/**
 * Expand a painted triangle into leaf triangles. `mid(a, b)` must return the vertex index of
 * the midpoint of edge (a, b), creating it if needed (callers share midpoints between
 * neighbouring triangles so the result stays conforming).
 */
export function expandPaint(node: PaintNode, v: [number, number, number], mid: (a: number, b: number) => number, out: number[]): void {
  if ('state' in node) {
    out.push(v[0], v[1], v[2], node.state);
    return;
  }
  const s = node.special;
  const r0 = v[s % 3];
  const r1 = v[(s + 1) % 3];
  const r2 = v[(s + 2) % 3];
  const c = node.children;
  if (node.sides === 1) {
    const m12 = mid(r1, r2);
    expandPaint(c[0], [r0, r1, m12], mid, out);
    expandPaint(c[1], [m12, r2, r0], mid, out);
  } else if (node.sides === 2) {
    const m01 = mid(r0, r1);
    const m20 = mid(r2, r0);
    expandPaint(c[0], [r0, m01, m20], mid, out);
    expandPaint(c[1], [m01, r1, m20], mid, out);
    expandPaint(c[2], [r1, r2, m20], mid, out);
  } else {
    const m01 = mid(r0, r1);
    const m12 = mid(r1, r2);
    const m20 = mid(r2, r0);
    expandPaint(c[0], [r0, m01, m20], mid, out);
    expandPaint(c[1], [m01, r1, m12], mid, out);
    expandPaint(c[2], [m12, r2, m20], mid, out);
    expandPaint(c[3], [m01, m12, m20], mid, out);
  }
}

/** Serialise a tree (used by tests and fixtures; mirrors PrusaSlicer's writer). */
export function encodePaintTree(root: PaintNode): string {
  const nibbles: number[] = [];
  const write = (n: PaintNode) => {
    if ('state' in n) {
      if (n.state < 3) nibbles.push(n.state << 2);
      else nibbles.push(0b1100, n.state - 3);
      return;
    }
    nibbles.push(n.sides | ((n.sides === 3 ? 0 : n.special) << 2));
    for (let k = n.sides; k >= 0; k--) write(n.children[k]);
  };
  write(root);
  return nibbles
    .map((x) => x.toString(16).toUpperCase())
    .reverse()
    .join('');
}

/** Encode a whole-triangle state. */
export function encodeWholeState(state: number): string {
  return encodePaintTree({ state });
}
