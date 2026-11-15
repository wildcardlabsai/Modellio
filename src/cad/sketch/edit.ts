import { constraintRefs } from './describe';
import type { Sketch, SketchEntity } from './types';

/**
 * Join two points: `drop` becomes `keep` everywhere it is used. Lines that collapse to a point,
 * and constraints on removed geometry or between a point and itself, go too.
 */
export function mergePoints(sketch: Sketch, keep: string, drop: string): Sketch {
  const swap = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k !== 'id' && v === drop ? keep : v])) as T;
  const entities = sketch.entities.map(swap).filter((e) => !(e.kind === 'line' && e.a === e.b));
  const alive = new Set([...entities.map((e) => e.id), ...sketch.points.map((p) => p.id)]);
  const constraints = sketch.constraints
    .map(swap)
    .filter((c) => constraintRefs(c).every((r) => alive.has(r) && r !== drop))
    .filter((c) => !((c.kind === 'coincident' || c.kind === 'pointDistance') && c.a === c.b));
  return { points: sketch.points.filter((p) => p.id !== drop), entities, constraints };
}

type XY = [number, number];

/**
 * Draw a spline on to point `next`: a Bézier from the last anchor, with handles set Catmull-Rom
 * style so the curve passes smoothly through every anchor. At the anchor it leaves from, the
 * previous segment's handle is lined up and a `smooth` constraint keeps the two handles in line
 * (the solver holds it). Clicking the first anchor again closes the spline smoothly.
 * `newId(prefix)` makes ids; `anchors` are the spline's anchors so far, in order.
 */
export function extendSpline(
  s: Sketch,
  anchors: string[],
  next: string,
  newId: (prefix: string) => string,
  construction?: boolean,
): Sketch {
  const P = (id: string): XY => {
    const p = s.points.find((q) => q.id === id)!;
    return [p.x, p.y];
  };
  const prev = anchors[anchors.length - 1];
  if (!prev || prev === next) return s;
  const before = anchors[anchors.length - 2];
  const closing = anchors.length > 1 && next === anchors[0];
  const [p, n] = [P(prev), P(next)];
  // Tangent (÷3 of a Catmull-Rom tangent) at the anchor we leave from and the one we arrive at.
  const tPrev: XY = before ? [(n[0] - P(before)[0]) / 6, (n[1] - P(before)[1]) / 6] : [(n[0] - p[0]) / 3, (n[1] - p[1]) / 3];
  const tNext: XY = closing ? [(P(anchors[1])[0] - p[0]) / 6, (P(anchors[1])[1] - p[1]) / 6] : [(n[0] - p[0]) / 3, (n[1] - p[1]) / 3];
  const [c1, c2] = [newId('h'), newId('h')];
  const points = [...s.points, { id: c1, x: p[0] + tPrev[0], y: p[1] + tPrev[1] }, { id: c2, x: n[0] - tNext[0], y: n[1] - tNext[1] }];
  const bez = { id: newId('s'), kind: 'bezier' as const, a: prev, b: next, c1, c2, ...(construction ? { construction } : {}) };
  const constraints = [...s.constraints];
  const move = new Map<string, XY>();
  const isBez = (e: SketchEntity): e is Extract<SketchEntity, { kind: 'bezier' }> => e.kind === 'bezier';
  if (before) {
    const last = [...s.entities].reverse().find((e) => isBez(e) && e.a === before && e.b === prev) as Extract<
      SketchEntity,
      { kind: 'bezier' }
    >;
    if (last) {
      move.set(last.c2, [p[0] - tPrev[0], p[1] - tPrev[1]]);
      constraints.push({ id: newId('c'), kind: 'smooth', point: prev, h1: last.c2, h2: c1 });
    }
  }
  if (closing) {
    const first = s.entities.find((e) => isBez(e) && e.a === anchors[0] && e.b === anchors[1]) as Extract<SketchEntity, { kind: 'bezier' }>;
    if (first) {
      move.set(first.c1, [n[0] + tNext[0], n[1] + tNext[1]]);
      constraints.push({ id: newId('c'), kind: 'smooth', point: next, h1: c2, h2: first.c1 });
    }
  }
  return {
    points: points.map((q) => (move.has(q.id) ? { ...q, x: move.get(q.id)![0], y: move.get(q.id)![1] } : q)),
    entities: [...s.entities, bez],
    constraints,
  };
}

/** The handle of Bézier `e` next to its anchor `at`. */
export const handleAt = (e: Extract<SketchEntity, { kind: 'bezier' }>, at: string) => (e.a === at ? e.c1 : e.c2);
