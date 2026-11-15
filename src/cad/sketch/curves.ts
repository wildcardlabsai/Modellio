/**
 * Sketch curves as functions of a parameter t, and where they meet. Lines, arcs, circles and
 * Béziers all go through one numeric path: their sampled polylines are crossed to find
 * candidates, which Newton's method then refines to the true intersection (exact in one step for
 * two lines). Used by the trim, extend and offset tools.
 */
import type { Sketch, SketchEntity } from './types';

export type Pt = [number, number];

export interface Curve {
  /** The point at t ∈ [0, 1] (a circle wraps around: t and t + 1 are the same point). */
  at: (t: number) => Pt;
  closed: boolean;
  /** How many straight pieces approximate it when looking for crossings. */
  n: number;
}

const TAU = 2 * Math.PI;

/** Sketch arcs run a → b counter-clockwise: start angle and sweep (0, 2π]. */
export function arcAngles(c: Pt, a: Pt, b: Pt): { a0: number; sweep: number; r: number } {
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  let sweep = Math.atan2(b[1] - c[1], b[0] - c[0]) - a0;
  while (sweep <= 1e-12) sweep += TAU;
  return { a0, sweep, r: Math.hypot(a[0] - c[0], a[1] - c[1]) };
}

export function bezierAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** The control points of the piece of a cubic Bézier between t0 and t1 (de Casteljau). */
export function bezierPiece(p: [Pt, Pt, Pt, Pt], t0: number, t1: number): [Pt, Pt, Pt, Pt] {
  const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const split = (q: [Pt, Pt, Pt, Pt], t: number): [[Pt, Pt, Pt, Pt], [Pt, Pt, Pt, Pt]] => {
    const [a, b, c, d] = q;
    const ab = lerp(a, b, t);
    const bc = lerp(b, c, t);
    const cd = lerp(c, d, t);
    const abc = lerp(ab, bc, t);
    const bcd = lerp(bc, cd, t);
    const m = lerp(abc, bcd, t);
    return [
      [a, ab, abc, m],
      [m, bcd, cd, d],
    ];
  };
  const left = t1 >= 1 ? p : split(p, t1)[0];
  return t0 <= 0 ? left : split(left, t0 / t1)[1];
}

export const pointMap = (s: Sketch) => new Map(s.points.map((p) => [p.id, [p.x, p.y] as Pt]));

/** An entity as a curve, or null when its points are missing. */
export function curveOf(pts: Map<string, Pt>, e: SketchEntity): Curve | null {
  const P = (id: string) => pts.get(id);
  if (e.kind === 'line') {
    const [a, b] = [P(e.a), P(e.b)];
    if (!a || !b) return null;
    return { at: (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], closed: false, n: 1 };
  }
  if (e.kind === 'circle') {
    const c = P(e.c);
    if (!c) return null;
    return { at: (t) => [c[0] + e.r * Math.cos(TAU * t), c[1] + e.r * Math.sin(TAU * t)], closed: true, n: 96 };
  }
  if (e.kind === 'arc') {
    const [c, a, b] = [P(e.c), P(e.a), P(e.b)];
    if (!c || !a || !b) return null;
    const { a0, sweep, r } = arcAngles(c, a, b);
    return {
      at: (t) => [c[0] + r * Math.cos(a0 + sweep * t), c[1] + r * Math.sin(a0 + sweep * t)],
      closed: false,
      n: Math.max(8, Math.ceil((sweep / TAU) * 96)),
    };
  }
  const [a, b, c1, c2] = [P(e.a), P(e.b), P(e.c1), P(e.c2)];
  if (!a || !b || !c1 || !c2) return null;
  return { at: (t) => bezierAt(a, c1, c2, b, t), closed: false, n: 64 };
}

/** A straight segment as a curve (for rays and extensions). */
export const segmentCurve = (a: Pt, b: Pt): Curve => ({
  at: (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
  closed: false,
  n: 1,
});

/** Where two straight pieces cross: their parameters, allowing a hair beyond the ends. */
function crossParams(p1: Pt, p2: Pt, p3: Pt, p4: Pt): [number, number] | null {
  const d1: Pt = [p2[0] - p1[0], p2[1] - p1[1]];
  const d2: Pt = [p4[0] - p3[0], p4[1] - p3[1]];
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-14) return null;
  const w: Pt = [p3[0] - p1[0], p3[1] - p1[1]];
  const s = (w[0] * d2[1] - w[1] * d2[0]) / den;
  const u = (w[0] * d1[1] - w[1] * d1[0]) / den;
  const e = 1e-6;
  return s >= -e && s <= 1 + e && u >= -e && u <= 1 + e ? [s, u] : null;
}

const wrap = (t: number) => t - Math.floor(t);

/**
 * Where curves A and B meet: pairs of parameters (tA, tB). Candidates from the sampled
 * polylines are refined with Newton's method on A(t) − B(u) = 0.
 */
export function intersect(A: Curve, B: Curve): { t: number; u: number; p: Pt }[] {
  const out: { t: number; u: number; p: Pt }[] = [];
  const pa = Array.from({ length: A.n + 1 }, (_, i) => A.at(i / A.n));
  const pb = Array.from({ length: B.n + 1 }, (_, j) => B.at(j / B.n));
  let scale = 1;
  for (const p of [...pa, ...pb]) scale = Math.max(scale, Math.abs(p[0]), Math.abs(p[1]));
  for (let i = 0; i < A.n; i++)
    for (let j = 0; j < B.n; j++) {
      const hit = crossParams(pa[i], pa[i + 1], pb[j], pb[j + 1]);
      if (!hit) continue;
      let t = (i + hit[0]) / A.n;
      let u = (j + hit[1]) / B.n;
      let ok = false;
      for (let it = 0; it < 30; it++) {
        const fa = A.at(t);
        const fb = B.at(u);
        const F: Pt = [fa[0] - fb[0], fa[1] - fb[1]];
        if (Math.hypot(F[0], F[1]) < 1e-11 * scale) {
          ok = true;
          break;
        }
        const h = 1e-7;
        const da = A.at(t + h);
        const db = B.at(u + h);
        const Ja: Pt = [(da[0] - fa[0]) / h, (da[1] - fa[1]) / h];
        const Jb: Pt = [-(db[0] - fb[0]) / h, -(db[1] - fb[1]) / h];
        const det = Ja[0] * Jb[1] - Ja[1] * Jb[0];
        if (Math.abs(det) < 1e-18) break;
        t -= (F[0] * Jb[1] - F[1] * Jb[0]) / det;
        u -= (Ja[0] * F[1] - Ja[1] * F[0]) / det;
      }
      if (!ok) continue;
      if (A.closed) t = wrap(t);
      if (B.closed) u = wrap(u);
      const e = 1e-9;
      if ((!A.closed && (t < -e || t > 1 + e)) || (!B.closed && (u < -e || u > 1 + e))) continue;
      t = Math.min(1, Math.max(0, t));
      u = Math.min(1, Math.max(0, u));
      const p = A.at(t);
      if (!out.some((o) => Math.hypot(o.p[0] - p[0], o.p[1] - p[1]) < 1e-7 * scale)) out.push({ t, u, p });
    }
  return out;
}

/** The parameter on a curve nearest to point q. */
export function closestParam(c: Curve, q: Pt): number {
  const n = c.n * 8;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= n; i++) {
    const p = c.at(i / n);
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < bestD) [best, bestD] = [i / n, d];
  }
  // Narrow down around the best sample.
  let [lo, hi] = [best - 1 / n, best + 1 / n];
  for (let k = 0; k < 40; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const d = (t: number) => {
      const p = c.at(c.closed ? wrap(t) : Math.min(1, Math.max(0, t)));
      return Math.hypot(p[0] - q[0], p[1] - q[1]);
    };
    if (d(m1) < d(m2)) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  return c.closed ? wrap(t) : Math.min(1, Math.max(0, t));
}
