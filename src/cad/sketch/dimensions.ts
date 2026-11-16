import type { Constraint, Sketch } from './types';

type Pt = [number, number];

/** How one dimensional constraint is drawn on the canvas, and how a typed number maps back to it. */
export interface DimensionMark {
  /** The constraint's id. */
  id: string;
  text: string;
  /** The number shown and typed: a diameter for a radius constraint. */
  shown: number;
  unit: 'mm' | '°';
  /** The constraint value for a typed number, or null if the number makes no sense for it. */
  toValue: (typed: number) => number | null;
  /** Lines to draw (extension lines, the dimension line, leaders), in sketch coordinates. */
  lines: [Pt, Pt][];
  /** Where the label goes. */
  at: Pt;
}

export const fmtDim = (v: number) => String(+v.toFixed(2));
const positive = (v: number) => (v > 0 ? v : null);

/**
 * The on-canvas dimension for every constraint that carries a value: lengths and distances as
 * offset dimension lines, diameters with a leader, angles with an arc, point X / Y from the axes.
 * `off` is the offset from the geometry (sketch units; a few pixels' worth).
 */
export function dimensionMarks(s: Sketch, off: number): DimensionMark[] {
  const pts = new Map(s.points.map((p) => [p.id, [p.x, p.y] as Pt]));
  const ents = new Map(s.entities.map((e) => [e.id, e]));
  const lineEnds = (id: string): [Pt, Pt] | null => {
    const e = ents.get(id);
    if (e?.kind !== 'line') return null;
    const [a, b] = [pts.get(e.a), pts.get(e.b)];
    return a && b ? [a, b] : null;
  };
  const out: DimensionMark[] = [];
  // Linear dimensions go on the side away from the sketch's middle, outside the outline.
  const centre: Pt = s.points.length
    ? [s.points.reduce((t, p) => t + p.x, 0) / s.points.length, s.points.reduce((t, p) => t + p.y, 0) / s.points.length]
    : [0, 0];
  /** A linear dimension between two points, offset to the outer side of a → b. */
  const linear = (c: Constraint & { value: number }, a: Pt, b: Pt) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let n: Pt = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
    const m: Pt = [(a[0] + b[0]) / 2 - centre[0], (a[1] + b[1]) / 2 - centre[1]];
    if (n[0] * m[0] + n[1] * m[1] < -1e-9) n = [-n[0], -n[1]];
    const sh = (p: Pt, k: number): Pt => [p[0] + n[0] * off * k, p[1] + n[1] * off * k];
    out.push({
      id: c.id,
      text: fmtDim(c.value),
      shown: c.value,
      unit: 'mm',
      toValue: positive,
      lines: [
        [sh(a, 0.3), sh(a, 1.25)],
        [sh(b, 0.3), sh(b, 1.25)],
        [sh(a, 1), sh(b, 1)],
      ],
      at: sh([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 1.9),
    });
  };
  for (const c of s.constraints) {
    switch (c.kind) {
      case 'distance': {
        const ab = lineEnds(c.line);
        if (ab) linear(c, ab[0], ab[1]);
        break;
      }
      case 'pointDistance': {
        const [a, b] = [pts.get(c.a), pts.get(c.b)];
        if (a && b) linear(c, a, b);
        break;
      }
      case 'radius': {
        const e = ents.get(c.entity);
        if (e?.kind !== 'circle' && e?.kind !== 'arc') break;
        const ctr = pts.get(e.c);
        if (!ctr) break;
        const r = e.kind === 'circle' ? e.r : Math.hypot(pts.get(e.a)![0] - ctr[0], pts.get(e.a)![1] - ctr[1]);
        const u: Pt = [Math.SQRT1_2, Math.SQRT1_2];
        out.push({
          id: c.id,
          text: `⌀${fmtDim(c.value * 2)}`,
          shown: c.value * 2,
          unit: 'mm',
          toValue: (d) => (d > 0 ? d / 2 : null),
          lines: [[ctr, [ctr[0] + u[0] * (r + off), ctr[1] + u[1] * (r + off)]]],
          at: [ctr[0] + u[0] * (r + off * 2), ctr[1] + u[1] * (r + off * 2)],
        });
        break;
      }
      case 'angle': {
        const [l1, l2] = [lineEnds(c.l1), lineEnds(c.l2)];
        if (!l1 || !l2) break;
        const u: Pt = [l1[1][0] - l1[0][0], l1[1][1] - l1[0][1]];
        const w: Pt = [l2[1][0] - l2[0][0], l2[1][1] - l2[0][1]];
        const den = u[0] * w[1] - u[1] * w[0];
        // Where the lines meet (or the second line's middle when they are parallel).
        let x: Pt = [(l2[0][0] + l2[1][0]) / 2, (l2[0][1] + l2[1][1]) / 2];
        if (Math.abs(den) > 1e-9) {
          const t = ((l2[0][0] - l1[0][0]) * w[1] - (l2[0][1] - l1[0][1]) * w[0]) / den;
          x = [l1[0][0] + u[0] * t, l1[0][1] + u[1] * t];
        }
        const R = off * 2.5;
        const a0 = Math.atan2(u[1], u[0]);
        const sweep = Math.atan2(den, u[0] * w[0] + u[1] * w[1]);
        const arc: Pt[] = Array.from({ length: 17 }, (_, i) => {
          const t = a0 + (sweep * i) / 16;
          return [x[0] + R * Math.cos(t), x[1] + R * Math.sin(t)];
        });
        const mid = a0 + sweep / 2;
        out.push({
          id: c.id,
          text: `${fmtDim(c.value)}°`,
          shown: c.value,
          unit: '°',
          toValue: (v) => (Math.abs(v) <= 360 ? v : null),
          lines: arc.slice(1).map((p, i) => [arc[i], p]),
          at: [x[0] + R * 1.6 * Math.cos(mid), x[1] + R * 1.6 * Math.sin(mid)],
        });
        break;
      }
      case 'pointLineDistance': {
        const p = pts.get(c.point);
        const ab = lineEnds(c.line);
        if (!p || !ab) break;
        const [a, b] = ab;
        const d: Pt = [b[0] - a[0], b[1] - a[1]];
        const t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1);
        const foot: Pt = [a[0] + d[0] * t, a[1] + d[1] * t];
        out.push({
          id: c.id,
          text: fmtDim(c.value),
          shown: c.value,
          unit: 'mm',
          toValue: (v) => (v >= 0 ? v : null),
          lines: [[p, foot]],
          at: [(p[0] + foot[0]) / 2 + off * 0.8, (p[1] + foot[1]) / 2 + off * 0.8],
        });
        break;
      }
      case 'pointX':
      case 'pointY': {
        const p = pts.get(c.point);
        if (!p) break;
        const isX = c.kind === 'pointX';
        out.push({
          id: c.id,
          text: `${isX ? 'X' : 'Y'} ${fmtDim(c.value)}`,
          shown: c.value,
          unit: 'mm',
          toValue: (v) => v,
          lines: [[isX ? [0, p[1]] : [p[0], 0], p]],
          at: isX ? [p[0] / 2, p[1] + off * 0.9] : [p[0] + off * 0.9, p[1] / 2],
        });
        break;
      }
    }
  }
  return out;
}
