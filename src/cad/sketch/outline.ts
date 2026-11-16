/**
 * How a sketch's curves join up into outlines: the one place that walks a sketch. Both geometry
 * engines use it: the mesh engine (Manifold) samples the outlines into polygons, the exact engine
 * (OpenCascade) draws them with true arcs. Construction geometry is ignored.
 */
import type { Sketch, SketchEntity } from './types';

export type Pt = [number, number];

/**
 * A line; an arc from `from` to `to` through `mid` around centre `c` (`ccw`: walked
 * counter-clockwise); or a cubic Bézier with handles `c1` (next to `from`) and `c2` (next to `to`).
 */
export type Segment =
  | { kind: 'line'; from: Pt; to: Pt }
  | { kind: 'arc'; from: Pt; to: Pt; mid: Pt; c: Pt; ccw: boolean }
  | { kind: 'bezier'; from: Pt; to: Pt; c1: Pt; c2: Pt };

export interface Outlines {
  /** Closed chains of lines, arcs and splines, in walking order. */
  chains: Segment[][];
  circles: { c: Pt; r: number }[];
  /** Chains that do not close up (they are not part of a solid). */
  open: number;
  /** Points where more than two curves meet: the outline there is ambiguous. */
  branches: number;
  /** Whether any outline crosses itself or another one. */
  crossing: boolean;
}

type Edge = Extract<SketchEntity, { kind: 'line' | 'arc' | 'bezier' }>;

/** Sketch arcs run a → b counter-clockwise around c. The segment for walking it from `from`. */
function arcSegment(pts: Map<string, Pt>, e: Extract<SketchEntity, { kind: 'arc' }>, from: string): Segment {
  const c = pts.get(e.c)!;
  const [ea, eb] = [pts.get(e.a)!, pts.get(e.b)!];
  const a0 = Math.atan2(ea[1] - c[1], ea[0] - c[0]);
  let sweep = Math.atan2(eb[1] - c[1], eb[0] - c[0]) - a0;
  while (sweep <= 0) sweep += 2 * Math.PI;
  const rad = Math.hypot(ea[0] - c[0], ea[1] - c[1]);
  const mid: Pt = [c[0] + rad * Math.cos(a0 + sweep / 2), c[1] + rad * Math.sin(a0 + sweep / 2)];
  const forward = from === e.a;
  return { kind: 'arc', from: forward ? ea : eb, to: forward ? eb : ea, mid, c, ccw: forward };
}

/** The segment for walking an edge starting at point `from`. */
export function segmentOf(pts: Map<string, Pt>, e: Edge, from: string): Segment {
  if (e.kind === 'arc') return arcSegment(pts, e, from);
  if (e.kind === 'bezier') {
    const fwd = e.a === from;
    const [a, b, c1, c2] = [pts.get(e.a)!, pts.get(e.b)!, pts.get(e.c1)!, pts.get(e.c2)!];
    return fwd ? { kind: 'bezier', from: a, to: b, c1, c2 } : { kind: 'bezier', from: b, to: a, c1: c2, c2: c1 };
  }
  const to = e.a === from ? e.b : e.a;
  return { kind: 'line', from: pts.get(from)!, to: pts.get(to)! };
}

export const pointMap = (s: Sketch) => new Map(s.points.map((p) => [p.id, [p.x, p.y] as Pt]));
export const solidEdges = (s: Sketch) =>
  s.entities.filter((e): e is Edge => (e.kind === 'line' || e.kind === 'arc' || e.kind === 'bezier') && !e.construction);

/** The point at t on a cubic Bézier from p0 to p3 with handles p1, p2. */
export function bezierPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** Points along a segment's Bézier, from `from` (included) to `to` (excluded). */
export function bezierPoints(sg: Extract<Segment, { kind: 'bezier' }>, n = 32): Pt[] {
  return Array.from({ length: n }, (_, i) => bezierPoint(sg.from, sg.c1, sg.c2, sg.to, i / n));
}

/** The sketch's outlines: closed chains (walked edge to edge) and circles, plus what is wrong with them. */
export function sketchOutlines(s: Sketch): Outlines {
  const pts = pointMap(s);
  const edges = solidEdges(s).filter((e) =>
    (e.kind === 'arc' ? [e.a, e.b, e.c] : e.kind === 'bezier' ? [e.a, e.b, e.c1, e.c2] : [e.a, e.b]).every((id) => pts.has(id)),
  );
  const circles = s.entities
    .filter((e): e is Extract<SketchEntity, { kind: 'circle' }> => e.kind === 'circle' && !e.construction && e.r > 0 && pts.has(e.c))
    .map((e) => ({ c: pts.get(e.c)!, r: e.r }));
  const byPoint = new Map<string, Edge[]>();
  for (const e of edges)
    for (const id of [e.a, e.b]) {
      if (!byPoint.has(id)) byPoint.set(id, []);
      byPoint.get(id)!.push(e);
    }
  const branches = [...byPoint.values()].filter((l) => l.length > 2).length;
  const used = new Set<string>();
  const chains: Segment[][] = [];
  let open = 0;
  for (const start of edges) {
    if (used.has(start.id)) continue;
    const chain: Segment[] = [];
    let e = start;
    let from = start.a;
    let closed = false;
    for (let guard = 0; guard <= edges.length; guard++) {
      used.add(e.id);
      const to = e.a === from ? e.b : e.a;
      chain.push(segmentOf(pts, e, from));
      if (to === start.a) {
        closed = true;
        break;
      }
      const next = (byPoint.get(to) ?? []).find((x) => x.id !== e.id && !used.has(x.id));
      if (!next) break;
      from = to;
      e = next;
    }
    // A real outline encloses an area: at least three distinct corners (an arc counts its middle).
    const corners = chain.flatMap((sg) =>
      sg.kind === 'arc' ? [sg.from, sg.mid] : sg.kind === 'bezier' ? [sg.from, bezierPoint(sg.from, sg.c1, sg.c2, sg.to, 0.5)] : [sg.from],
    );
    if (closed && new Set(corners.map((p) => p.join())).size >= 3) chains.push(chain);
    else open++;
  }
  // Coarse sampling is enough to spot crossings, and keeps this cheap while points are dragged.
  const polys = [...chains.map((c) => chainPolygon(c, (2 * Math.PI) / 24)), ...circles.map((c) => circlePolygon(c.c, c.r, 24))];
  return { chains, circles, open, branches, crossing: polygonsCross(polys) };
}

const ARC_STEP = (2 * Math.PI) / 96;

/** Points along an arc from a to b around c, counter-clockwise (excluding b). */
function arcPoints(a: Pt, b: Pt, c: Pt, step: number): Pt[] {
  const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  let a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
  while (a1 <= a0 + 1e-9) a1 += 2 * Math.PI;
  const n = Math.max(2, Math.ceil((a1 - a0) / step));
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = a0 + ((a1 - a0) * i) / n;
    out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return out;
}

/** A closed chain as a polygon (arcs sampled), without repeating the first point. */
export function chainPolygon(chain: Segment[], step = ARC_STEP): Pt[] {
  const out: Pt[] = [];
  for (const sg of chain) {
    if (sg.kind === 'line') out.push(sg.from);
    else if (sg.kind === 'bezier') out.push(...bezierPoints(sg, Math.max(8, Math.round((2 * Math.PI) / step / 3))));
    else if (sg.ccw) out.push(...arcPoints(sg.from, sg.to, sg.c, step));
    // Walked clockwise: sample it counter-clockwise from its far end, then reverse.
    else out.push(...arcPoints(sg.to, sg.from, sg.c, step).concat([sg.from]).reverse().slice(0, -1));
  }
  return out;
}

export function circlePolygon(c: Pt, r: number, n = 96): Pt[] {
  return Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((i / n) * 2 * Math.PI), c[1] + r * Math.sin((i / n) * 2 * Math.PI)]);
}

/** Whether segments p1p2 and p3p4 cross (proper crossings only; touching ends don't count). */
function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  const eps = 1e-9;
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

/** Whether any polygon crosses itself or another (skipped above a size cap: it's only a warning). */
export function polygonsCross(polys: Pt[][], cap = 1500): boolean {
  const segs: { a: Pt; b: Pt; ring: number; i: number; n: number }[] = [];
  polys.forEach((p, ring) => p.forEach((a, i) => segs.push({ a, b: p[(i + 1) % p.length], ring, i, n: p.length })));
  if (segs.length > cap) return false;
  for (let x = 0; x < segs.length; x++)
    for (let y = x + 1; y < segs.length; y++) {
      const s = segs[x];
      const t = segs[y];
      // Neighbouring segments of one ring share an end: not a crossing.
      if (s.ring === t.ring && (Math.abs(s.i - t.i) === 1 || Math.abs(s.i - t.i) === s.n - 1)) continue;
      if (segmentsCross(s.a, s.b, t.a, t.b)) return true;
    }
  return false;
}
