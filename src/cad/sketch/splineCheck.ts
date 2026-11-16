/**
 * Splines that look fine but are not valid outlines: a Bézier that crosses itself, one that stops
 * and turns back on itself mid-way (a cusp: its speed drops to zero), a smooth join whose handles
 * fold onto the same side, or a smooth join with a handle sitting on its anchor (no direction).
 * Such outlines fail later (in extrudes, lofts and sweeps, in either engine), so they are caught
 * while drawing instead.
 */
import type { Sketch } from './types';

type P = [number, number];
export type SplineIssueKind = 'self-crossing' | 'cusp' | 'folded-join' | 'flat-handle';
export interface SplineIssue {
  /** The spline (or, for a join, the anchor point). */
  id: string;
  kind: SplineIssueKind;
  message: string;
}

const bez = (p: P[], t: number): P => {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [w.reduce((s, k, i) => s + k * p[i][0], 0), w.reduce((s, k, i) => s + k * p[i][1], 0)];
};
/** Speed |B′(t)| of a cubic Bézier. */
const speed = (p: P[], t: number) => {
  const u = 1 - t;
  const d = (i: number) => 3 * (u * u * (p[1][i] - p[0][i]) + 2 * u * t * (p[2][i] - p[1][i]) + t * t * (p[3][i] - p[2][i]));
  return Math.hypot(d(0), d(1));
};
const crosses = (a: P, b: P, c: P, d: P) => {
  const o = (p: P, q: P, r: P) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const [d1, d2, d3, d4] = [o(c, d, a), o(c, d, b), o(a, b, c), o(a, b, d)];
  const e = 1e-12;
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
};

/** Problems with the sketch's splines (empty when they are all valid). */
export function splineIssues(s: Sketch): SplineIssue[] {
  const pts = new Map(s.points.map((p) => [p.id, [p.x, p.y] as P]));
  const out: SplineIssue[] = [];
  for (const e of s.entities) {
    if (e.kind !== 'bezier') continue;
    const cp = [e.a, e.c1, e.c2, e.b].map((id) => pts.get(id));
    if (cp.some((p) => !p)) continue;
    const p = cp as P[];
    const L =
      Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) +
      Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]) +
      Math.hypot(p[3][0] - p[2][0], p[3][1] - p[2][1]);
    if (L < 1e-9) continue;
    // A cusp: the curve slows to a stop inside the segment and turns back.
    const n = 200;
    let slow = Infinity;
    let at = 0;
    for (let i = 2; i < n - 1; i++) {
      const v = speed(p, i / n);
      if (v < slow) [slow, at] = [v, i / n];
    }
    // Refine around the slowest sample.
    let [lo, hi] = [at - 1 / n, at + 1 / n];
    for (let k = 0; k < 40; k++) {
      const [m1, m2] = [lo + (hi - lo) / 3, hi - (hi - lo) / 3];
      if (speed(p, m1) < speed(p, m2)) hi = m2;
      else lo = m1;
    }
    slow = Math.min(slow, speed(p, (lo + hi) / 2));
    if (slow < 1e-3 * L) {
      out.push({ id: e.id, kind: 'cusp', message: 'A spline doubles back on itself into a sharp point. Move its handles apart.' });
      continue;
    }
    // Crossing itself: any two pieces of the sampled curve that are not neighbours cross.
    const m = 96;
    const poly = Array.from({ length: m + 1 }, (_, i) => bez(p, i / m));
    let crossing = false;
    for (let i = 0; i < m && !crossing; i++)
      for (let j = i + 2; j < m && !crossing; j++) crossing = crosses(poly[i], poly[i + 1], poly[j], poly[j + 1]);
    if (crossing)
      out.push({ id: e.id, kind: 'self-crossing', message: 'A spline loops over itself. Pull its handles back so it no longer crosses.' });
  }
  for (const c of s.constraints) {
    if (c.kind !== 'smooth') continue;
    const [o, h1, h2] = [pts.get(c.point), pts.get(c.h1), pts.get(c.h2)];
    if (!o || !h1 || !h2) continue;
    const u: P = [h1[0] - o[0], h1[1] - o[1]];
    const w: P = [h2[0] - o[0], h2[1] - o[1]];
    if (Math.hypot(...u) < 1e-6 || Math.hypot(...w) < 1e-6)
      out.push({
        id: c.point,
        kind: 'flat-handle',
        message: 'A smooth spline join has a handle on its point, so it has no direction. Drag the handle out.',
      });
    else if (u[0] * w[0] + u[1] * w[1] > 0)
      out.push({
        id: c.point,
        kind: 'folded-join',
        message: 'A smooth spline join folds back: both handles point the same way. Make it a corner, or move a handle across.',
      });
  }
  return out;
}
