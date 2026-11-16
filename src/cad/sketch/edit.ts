import { constraintRefs, describeConstraint } from './describe';
import { arcAngles, bezierPiece, closestParam, curveOf, intersect, pointMap, segmentCurve } from './curves';
import { sketchOutlines } from './outline';
import { solveSketch } from './solver';
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

// ── Trim, extend, offset, corner fillet and chamfer ─────────────────────────────────────────────

/** The result of an editing tool: the new sketch and what happened, or why nothing was done. */
export type EditResult = { ok: true; sketch: Sketch; message: string } | { ok: false; reason: string };

type NewId = (prefix: string) => string;
type Line = Extract<SketchEntity, { kind: 'line' }>;

const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The sketch's size, for tolerances. */
function extent(s: Sketch): number {
  let m = 1;
  for (const p of s.points) m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
  return m;
}

/**
 * Finish an edit: drop points nothing uses and constraints on geometry that is gone, then make
 * sure the result still solves. Names the constraints that were removed.
 */
function finish(before: Sketch, after: Sketch, did: string, keepIds: Set<string> = new Set()): EditResult {
  const used = new Set(after.entities.flatMap(entityPointsOf));
  const points = after.points.filter((p) => used.has(p.id) || keepIds.has(p.id));
  const alive = new Set([...after.entities.map((e) => e.id), ...points.map((p) => p.id)]);
  const constraints = after.constraints.filter((c) => constraintRefs(c).every((r) => alive.has(r)));
  const out: Sketch = { points, entities: after.entities, constraints };
  const kept = new Set(constraints.map((c) => c.id));
  const dropped = before.constraints.filter((c) => !kept.has(c.id));
  const was = solveSketch(before).status.kind;
  const now = solveSketch(out);
  if (now.status.kind === 'conflicting' && was !== 'conflicting')
    return { ok: false, reason: `${did} would leave constraints that can't all be met, so nothing was changed.` };
  const note = dropped.length
    ? ` ${dropped.length} constraint${dropped.length === 1 ? '' : 's'} on the changed geometry ${dropped.length === 1 ? 'was' : 'were'} removed (${dropped.map(describeConstraint).join(', ')}).`
    : '';
  return { ok: true, sketch: now.sketch, message: `${did}.${note}` };
}

const entityPointsOf = (e: SketchEntity) =>
  e.kind === 'line' ? [e.a, e.b] : e.kind === 'arc' ? [e.a, e.b, e.c] : e.kind === 'circle' ? [e.c] : [e.a, e.b, e.c1, e.c2];

/** A point at `p`: an existing one there (so curves stay joined), or a new one. */
function pointAtOrNew(s: Sketch, p: XY, newId: NewId, tol: number): [Sketch, string] {
  const hit = s.points.find((q) => Math.hypot(q.x - p[0], q.y - p[1]) < tol);
  if (hit) return [s, hit.id];
  const id = newId('p');
  return [{ ...s, points: [...s.points, { id, x: p[0], y: p[1] }] }, id];
}

/**
 * Trim: remove the piece of a curve between the crossings either side of `click` (or up to its
 * end when there is no crossing on that side). A curve that crosses nothing is removed. A
 * circle needs two crossings and becomes an arc. Béziers are split exactly (de Casteljau).
 */
export function trimAt(s: Sketch, entityId: string, click: XY, newId: NewId): EditResult {
  const e = s.entities.find((x) => x.id === entityId);
  if (!e) return { ok: false, reason: 'Click a curve to trim.' };
  const pts = pointMap(s);
  const curve = curveOf(pts, e);
  if (!curve) return { ok: false, reason: 'That curve is missing points.' };
  const tol = 1e-7 * extent(s);
  const tc = closestParam(curve, click);
  const cuts: number[] = [];
  for (const o of s.entities) {
    if (o.id === e.id) continue;
    const oc = curveOf(pts, o);
    if (!oc) continue;
    for (const x of intersect(curve, oc)) if (!cuts.some((t) => Math.abs(t - x.t) < 1e-9)) cuts.push(x.t);
  }
  const inner = cuts.filter((t) => curve.closed || (t > 1e-9 && t < 1 - 1e-9)).sort((a, b) => a - b);
  let next: Sketch = s;
  if (e.kind === 'circle') {
    if (inner.length < 2)
      return { ok: false, reason: `A circle needs two crossings to trim it (it crosses ${inner.length === 1 ? 'once' : 'nothing'}).` };
    const lo = [...inner].reverse().find((t) => t <= tc) ?? inner[inner.length - 1];
    const hi = inner.find((t) => t > tc) ?? inner[0];
    let ia: string;
    let ib: string;
    [next, ia] = pointAtOrNew(next, curve.at(hi), newId, tol);
    [next, ib] = pointAtOrNew(next, curve.at(lo), newId, tol);
    // What is left runs from the crossing after the click, round to the one before it.
    const arc: SketchEntity = { id: e.id, kind: 'arc', c: e.c, a: ia, b: ib, ...(e.construction ? { construction: true } : {}) };
    next = { ...next, entities: next.entities.map((x) => (x.id === e.id ? arc : x)) };
    return finish(s, next, 'Trimmed the circle to an arc');
  }
  if (!inner.length) {
    next = { ...s, entities: s.entities.filter((x) => x.id !== e.id) };
    return finish(s, next, 'It crossed nothing, so it was removed');
  }
  const lo = [...inner].reverse().find((t) => t < tc) ?? 0;
  const hi = inner.find((t) => t > tc) ?? 1;
  const ranges = [
    [0, lo],
    [hi, 1],
  ].filter(([a, b]) => b - a > 1e-9 && dist(curve.at(a), curve.at(b)) > tol * 10);
  const pieces: SketchEntity[] = [];
  const endId = (t: number): string => {
    if (t === 0) return e.a;
    if (t === 1) return e.b;
    let id: string;
    [next, id] = pointAtOrNew(next, curve.at(t), newId, tol);
    return id;
  };
  ranges.forEach(([t0, t1], i) => {
    const id = i === 0 ? e.id : newId(e.kind === 'line' ? 'l' : e.kind === 'arc' ? 'a' : 's');
    const extra = e.construction ? { construction: true } : {};
    const [a, b] = [endId(t0), endId(t1)];
    if (e.kind === 'line') pieces.push({ id, kind: 'line', a, b, ...extra });
    else if (e.kind === 'arc') pieces.push({ id, kind: 'arc', c: e.c, a, b, ...extra });
    else if (e.kind === 'bezier') {
      const q = bezierPiece([pts.get(e.a)!, pts.get(e.c1)!, pts.get(e.c2)!, pts.get(e.b)!], t0, t1);
      const [h1, h2] = [newId('h'), newId('h')];
      next = { ...next, points: [...next.points, { id: h1, x: q[1][0], y: q[1][1] }, { id: h2, x: q[2][0], y: q[2][1] }] };
      pieces.push({ id, kind: 'bezier', a, b, c1: h1, c2: h2, ...extra });
    }
  });
  next = { ...next, entities: next.entities.flatMap((x) => (x.id === e.id ? pieces : [x])) };
  // Constraints: the piece that keeps the curve's id keeps those that still hold. A length no
  // longer holds; a direction (or a radius) does, so the second piece gets those too.
  const changedLength = (c: Sketch['constraints'][number]) =>
    (c.kind === 'distance' && c.line === e.id) ||
    (c.kind === 'midpoint' && c.line === e.id) ||
    (c.kind === 'equal' && e.kind === 'line' && (c.l1 === e.id || c.l2 === e.id));
  let constraints = next.constraints.filter((c) => !changedLength(c) || !pieces.some((p) => p.id === e.id));
  const second = pieces.find((p) => p.id !== e.id);
  if (second && pieces.some((p) => p.id === e.id)) {
    const copies: Sketch['constraints'] = [];
    for (const c of constraints) {
      const swap = (r: string) => (r === e.id ? second.id : r);
      if ((c.kind === 'horizontal' || c.kind === 'vertical') && c.line === e.id) copies.push({ ...c, id: newId('c'), line: second.id });
      if ((c.kind === 'parallel' || c.kind === 'perpendicular' || c.kind === 'angle') && (c.l1 === e.id || c.l2 === e.id))
        copies.push({ ...c, id: newId('c'), l1: swap(c.l1), l2: swap(c.l2) });
    }
    if (e.kind === 'arc') copies.push({ id: newId('c'), kind: 'equal', l1: e.id, l2: second.id });
    constraints = [...constraints, ...copies];
  }
  return finish(s, { ...next, constraints }, ranges.length ? 'Trimmed' : 'Trimmed away the whole curve');
}

/**
 * Extend a line from the end nearest `click` to the first curve it would meet. The end must be
 * free (not joined to other curves, not fixed).
 */
export function extendAt(s: Sketch, lineId: string, click: XY): EditResult {
  const e = s.entities.find((x) => x.id === lineId);
  if (!e) return { ok: false, reason: 'Click a line near the end to extend.' };
  if (e.kind !== 'line') return { ok: false, reason: 'Extend works on lines.' };
  const pts = pointMap(s);
  const [a, b] = [pts.get(e.a)!, pts.get(e.b)!];
  const [endId, otherId] = dist(click, a) < dist(click, b) ? [e.a, e.b] : [e.b, e.a];
  const end = pts.get(endId)!;
  const other = pts.get(otherId)!;
  if (s.entities.some((x) => x.id !== e.id && entityPointsOf(x).includes(endId)))
    return { ok: false, reason: 'That end is joined to other geometry; extending it would break the join.' };
  if (s.points.find((p) => p.id === endId)?.fixed) return { ok: false, reason: 'That end is fixed.' };
  const L = dist(end, other);
  if (L < 1e-12) return { ok: false, reason: 'The line has no length.' };
  const dir: XY = [(end[0] - other[0]) / L, (end[1] - other[1]) / L];
  const far = 20 * extent(s) + 1000;
  const ray = segmentCurve(end, [end[0] + dir[0] * far, end[1] + dir[1] * far]);
  let best: { t: number; p: XY } | null = null;
  for (const o of s.entities) {
    if (o.id === e.id) continue;
    const oc = curveOf(pts, o);
    if (!oc) continue;
    for (const x of intersect(ray, oc)) if (x.t * far > 1e-6 && (!best || x.t < best.t)) best = { t: x.t, p: x.p };
  }
  if (!best) return { ok: false, reason: 'There is nothing to extend to in that direction.' };
  const tol = 1e-7 * extent(s);
  const target = s.points.find((p) => p.id !== endId && Math.hypot(p.x - best!.p[0], p.y - best!.p[1]) < tol);
  // The end moves: its own point constraints and the line's length no longer hold.
  const constraints = s.constraints.filter(
    (c) =>
      !((c.kind === 'distance' || c.kind === 'midpoint') && c.line === e.id) &&
      !(c.kind === 'equal' && (c.l1 === e.id || c.l2 === e.id)) &&
      !constraintRefs(c).includes(endId),
  );
  const next: Sketch = target
    ? {
        points: s.points,
        entities: s.entities.map((x) => (x.id === e.id ? { ...e, [e.a === endId ? 'a' : 'b']: target.id } : x)),
        constraints,
      }
    : { points: s.points.map((p) => (p.id === endId ? { ...p, x: best!.p[0], y: best!.p[1] } : p)), entities: s.entities, constraints };
  return finish(s, next, 'Extended');
}

/** Two lines meeting at `pointId`: each line and its far end. */
function corner(s: Sketch, pointId: string): { l1: Line; l2: Line; far1: string; far2: string } | string {
  const at = s.entities.filter((e) => entityPointsOf(e).includes(pointId));
  const lines = at.filter((e): e is Line => e.kind === 'line');
  if (at.length !== 2 || lines.length !== 2) return 'Select a corner point where exactly two lines meet.';
  return {
    l1: lines[0],
    l2: lines[1],
    far1: lines[0].a === pointId ? lines[0].b : lines[0].a,
    far2: lines[1].a === pointId ? lines[1].b : lines[1].a,
  };
}

/** Round (fillet) or bevel (chamfer) a corner where two lines meet. */
export function cornerAt(s: Sketch, pointId: string, kind: 'fillet' | 'chamfer', size: number, newId: NewId): EditResult {
  const name = kind === 'fillet' ? 'radius' : 'distance';
  if (!(size > 0)) return { ok: false, reason: `The ${name} must be more than 0.` };
  const cn = corner(s, pointId);
  if (typeof cn === 'string') return { ok: false, reason: cn };
  const pts = pointMap(s);
  const P = pts.get(pointId)!;
  const [A, B] = [pts.get(cn.far1)!, pts.get(cn.far2)!];
  const [LA, LB] = [dist(A, P), dist(B, P)];
  const u1: XY = [(A[0] - P[0]) / LA, (A[1] - P[1]) / LA];
  const u2: XY = [(B[0] - P[0]) / LB, (B[1] - P[1]) / LB];
  const cos = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
  const angle = Math.acos(cos);
  if (angle < 1e-3 || angle > Math.PI - 1e-3) return { ok: false, reason: 'The lines are in line with each other: there is no corner.' };
  // How far back from the corner the new curve starts on each line.
  const back = kind === 'fillet' ? size / Math.tan(angle / 2) : size;
  if (back >= Math.min(LA, LB) - 1e-9)
    return {
      ok: false,
      reason: `A ${name} of ${+size.toFixed(3)} mm is too big for these lines (it needs ${+back.toFixed(2)} mm of each; the shorter is ${+Math.min(LA, LB).toFixed(2)} mm).`,
    };
  const t1: XY = [P[0] + u1[0] * back, P[1] + u1[1] * back];
  const t2: XY = [P[0] + u2[0] * back, P[1] + u2[1] * back];
  const [i1, i2] = [newId('p'), newId('p')];
  let next: Sketch = {
    ...s,
    points: [...s.points, { id: i1, x: t1[0], y: t1[1] }, { id: i2, x: t2[0], y: t2[1] }],
    entities: s.entities.map((e) =>
      e.id === cn.l1.id
        ? { ...cn.l1, [cn.l1.a === pointId ? 'a' : 'b']: i1 }
        : e.id === cn.l2.id
          ? { ...cn.l2, [cn.l2.a === pointId ? 'a' : 'b']: i2 }
          : e,
    ),
    // The lines are shorter now: their lengths no longer hold.
    constraints: s.constraints.filter(
      (c) =>
        !((c.kind === 'distance' || c.kind === 'midpoint') && (c.line === cn.l1.id || c.line === cn.l2.id)) &&
        !(c.kind === 'equal' && [c.l1, c.l2].some((l) => l === cn.l1.id || l === cn.l2.id)),
    ),
  };
  const construction = cn.l1.construction && cn.l2.construction ? { construction: true } : {};
  if (kind === 'chamfer') {
    const id = newId('l');
    next = {
      ...next,
      entities: [...next.entities, { id, kind: 'line', a: i1, b: i2, ...construction }],
      constraints: [...next.constraints, { id: newId('c'), kind: 'distance', line: id, value: dist(t1, t2) }],
    };
    return finish(s, next, `Chamfered the corner (${+size.toFixed(3)} mm back on each line)`);
  }
  const bis: XY = [(u1[0] + u2[0]) / 2, (u1[1] + u2[1]) / 2];
  const bl = Math.hypot(...bis);
  const cDist = size / Math.sin(angle / 2);
  const C: XY = [P[0] + (bis[0] / bl) * cDist, P[1] + (bis[1] / bl) * cDist];
  const ic = newId('p');
  // Sketch arcs run counter-clockwise from a to b.
  const ccw = (t1[0] - C[0]) * (t2[1] - C[1]) - (t1[1] - C[1]) * (t2[0] - C[0]) > 0;
  const arcId = newId('a');
  next = {
    ...next,
    points: [...next.points, { id: ic, x: C[0], y: C[1] }],
    entities: [...next.entities, { id: arcId, kind: 'arc', c: ic, a: ccw ? i1 : i2, b: ccw ? i2 : i1, ...construction }],
    constraints: [
      ...next.constraints,
      { id: newId('c'), kind: 'tangent', e1: cn.l1.id, e2: arcId },
      { id: newId('c'), kind: 'tangent', e1: cn.l2.id, e2: arcId },
      { id: newId('c'), kind: 'radius', entity: arcId, value: size },
    ],
  };
  return finish(s, next, `Filleted the corner (radius ${+size.toFixed(3)} mm)`);
}

/** Offset pieces: a line, or an arc around a centre point (walked counter-clockwise or not). */
type OSeg =
  | { kind: 'line'; from: XY; to: XY; src: string }
  | { kind: 'arc'; c: XY; cId: string; r: number; from: XY; to: XY; ccw: boolean; src: string };

/** Where two offset pieces' full curves (infinite line / whole circle) meet, nearest to `near`. */
function joinPoint(a: OSeg, b: OSeg, near: XY): XY | null {
  const cands: XY[] = [];
  const lineLine = (p1: XY, p2: XY, p3: XY, p4: XY) => {
    const d1: XY = [p2[0] - p1[0], p2[1] - p1[1]];
    const d2: XY = [p4[0] - p3[0], p4[1] - p3[1]];
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-12 * Math.hypot(...d1) * Math.hypot(...d2)) return;
    const t = ((p3[0] - p1[0]) * d2[1] - (p3[1] - p1[1]) * d2[0]) / den;
    cands.push([p1[0] + d1[0] * t, p1[1] + d1[1] * t]);
  };
  const lineCircle = (p1: XY, p2: XY, c: XY, r: number) => {
    const d: XY = [p2[0] - p1[0], p2[1] - p1[1]];
    const f: XY = [p1[0] - c[0], p1[1] - c[1]];
    const A = d[0] * d[0] + d[1] * d[1];
    const B = 2 * (f[0] * d[0] + f[1] * d[1]);
    const C = f[0] * f[0] + f[1] * f[1] - r * r;
    const disc = B * B - 4 * A * C;
    if (disc < -1e-9 * A * r * r) return;
    const sq = Math.sqrt(Math.max(0, disc));
    for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) cands.push([p1[0] + d[0] * t, p1[1] + d[1] * t]);
  };
  const circleCircle = (c1: XY, r1: number, c2: XY, r2: number) => {
    const d = dist(c1, c2);
    if (d < 1e-12) return;
    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const h2 = r1 * r1 - a * a;
    if (h2 < -1e-9 * r1 * r1) return;
    const h = Math.sqrt(Math.max(0, h2));
    const m: XY = [c1[0] + ((c2[0] - c1[0]) * a) / d, c1[1] + ((c2[1] - c1[1]) * a) / d];
    cands.push([m[0] + (h * (c2[1] - c1[1])) / d, m[1] - (h * (c2[0] - c1[0])) / d]);
    cands.push([m[0] - (h * (c2[1] - c1[1])) / d, m[1] + (h * (c2[0] - c1[0])) / d]);
  };
  if (a.kind === 'line' && b.kind === 'line') {
    lineLine(a.from, a.to, b.from, b.to);
    // Lines in line with each other: they already meet end to end.
    if (!cands.length && dist(a.to, b.from) < 1e-9 * (1 + Math.hypot(...near))) cands.push(a.to);
  } else if (a.kind === 'line' && b.kind === 'arc') lineCircle(a.from, a.to, b.c, b.r);
  else if (a.kind === 'arc' && b.kind === 'line') lineCircle(b.from, b.to, a.c, a.r);
  else if (a.kind === 'arc' && b.kind === 'arc') {
    if (dist(a.c, b.c) < 1e-9 && Math.abs(a.r - b.r) < 1e-9) cands.push(a.to);
    else circleCircle(a.c, a.r, b.c, b.r);
  }
  return cands.length ? cands.reduce((m, p) => (dist(p, near) < dist(m, near) ? p : m)) : null;
}

/**
 * Offset: a copy of a chain of lines and arcs (or a circle) at `distance`, joined at the corners.
 * For a closed chain or a circle, a positive distance is outward; for an open chain, to the left
 * of its first curve's direction. Splines are refused: a Bézier has no exact offset.
 */
export function offsetChain(s: Sketch, entityIds: string[], distance: number, newId: NewId): EditResult {
  if (!distance) return { ok: false, reason: 'The offset distance must not be 0.' };
  const sel = entityIds.map((id) => s.entities.find((e) => e.id === id)).filter((e): e is SketchEntity => !!e);
  if (!sel.length) return { ok: false, reason: 'Select the lines, arcs or circle to offset.' };
  if (sel.some((e) => e.kind === 'bezier'))
    return {
      ok: false,
      reason: 'Splines cannot be offset exactly (the offset of a Bézier is not a Bézier). Offset lines, arcs and circles.',
    };
  const pts = pointMap(s);
  if (sel.length === 1 && sel[0].kind === 'circle') {
    const e = sel[0];
    const r = e.r + distance;
    if (r <= 0)
      return { ok: false, reason: `An inward offset of ${+Math.abs(distance).toFixed(3)} mm is bigger than the circle's radius.` };
    const id = newId('o');
    return finish(s, { ...s, entities: [...s.entities, { id, kind: 'circle', c: e.c, r }] }, 'Offset the circle');
  }
  if (sel.some((e) => e.kind === 'circle')) return { ok: false, reason: 'Offset one circle on its own, or a chain of lines and arcs.' };
  const edges = sel as (Line | Extract<SketchEntity, { kind: 'arc' }>)[];
  // Walk the selection as one chain.
  const deg = new Map<string, number>();
  for (const e of edges) for (const p of [e.a, e.b]) deg.set(p, (deg.get(p) ?? 0) + 1);
  if ([...deg.values()].some((d) => d > 2)) return { ok: false, reason: 'The selection branches: select one chain of lines and arcs.' };
  const ends = [...deg].filter(([, d]) => d === 1).map(([p]) => p);
  const closed = ends.length === 0;
  if (!closed && ends.length !== 2) return { ok: false, reason: 'Select one connected chain of lines and arcs.' };
  const order: { e: (typeof edges)[number]; from: string }[] = [];
  let from = closed ? edges[0].a : (ends.find((p) => edges.find((e) => e.a === p || e.b === p) === edges[0]) ?? ends[0]);
  const used = new Set<string>();
  for (let k = 0; k < edges.length; k++) {
    const e = edges.find((x) => !used.has(x.id) && (x.a === from || x.b === from));
    if (!e) break;
    used.add(e.id);
    order.push({ e, from });
    from = e.a === from ? e.b : e.a;
  }
  if (order.length !== edges.length) return { ok: false, reason: 'Select one connected chain of lines and arcs.' };
  const segs: OSeg[] = order.map(({ e, from: f }) => {
    const to = e.a === f ? e.b : e.a;
    if (e.kind === 'line') return { kind: 'line', from: pts.get(f)!, to: pts.get(to)!, src: e.id };
    const c = pts.get(e.c)!;
    return { kind: 'arc', c, cId: e.c, r: dist(c, pts.get(e.a)!), from: pts.get(f)!, to: pts.get(to)!, ccw: e.a === f, src: e.id };
  });
  // Positive = outward for a closed chain: the left of a counter-clockwise walk is inside.
  let left = distance;
  if (closed) {
    const poly = segs.flatMap((g) => {
      if (g.kind === 'line') return [g.from];
      const { a0, sweep } = arcAngles(g.c, g.ccw ? g.from : g.to, g.ccw ? g.to : g.from);
      const mid: XY = [g.c[0] + g.r * Math.cos(a0 + sweep / 2), g.c[1] + g.r * Math.sin(a0 + sweep / 2)];
      return [g.from, mid];
    });
    const area = poly.reduce((t, p, i) => t + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0) / 2;
    left = area > 0 ? -distance : distance;
  }
  const moved: OSeg[] = [];
  for (const g of segs) {
    if (g.kind === 'line') {
      const L = dist(g.from, g.to);
      const n: XY = [-(g.to[1] - g.from[1]) / L, (g.to[0] - g.from[0]) / L];
      moved.push({ ...g, from: [g.from[0] + n[0] * left, g.from[1] + n[1] * left], to: [g.to[0] + n[0] * left, g.to[1] + n[1] * left] });
    } else {
      // Walking counter-clockwise, left is towards the centre.
      const r = g.ccw ? g.r - left : g.r + left;
      if (r <= 1e-9) return { ok: false, reason: `The offset is bigger than an arc's radius (${+g.r.toFixed(2)} mm).` };
      const at = (p: XY): XY => [g.c[0] + ((p[0] - g.c[0]) * r) / g.r, g.c[1] + ((p[1] - g.c[1]) * r) / g.r];
      moved.push({ ...g, r, from: at(g.from), to: at(g.to) });
    }
  }
  // Join neighbouring pieces where their curves meet.
  const n = moved.length;
  const starts: XY[] = moved.map((g) => g.from);
  const endsAt: XY[] = moved.map((g) => g.to);
  for (let k = 0; k < (closed ? n : n - 1); k++) {
    const a = moved[k];
    const b = moved[(k + 1) % n];
    const j = joinPoint(a, b, a.to);
    if (!j) return { ok: false, reason: 'At this distance, the offset curves no longer meet at a corner.' };
    endsAt[k] = j;
    starts[(k + 1) % n] = j;
  }
  // Each piece must still run the same way as the original (a reversed piece means it folded over).
  for (let k = 0; k < n; k++) {
    const [g, o] = [moved[k], segs[k]];
    if (g.kind === 'line' && o.kind === 'line') {
      const dot = (endsAt[k][0] - starts[k][0]) * (o.to[0] - o.from[0]) + (endsAt[k][1] - starts[k][1]) * (o.to[1] - o.from[1]);
      if (dot <= 1e-12) return { ok: false, reason: 'The offset is too big: a line would fold back on itself.' };
    } else if (g.kind === 'arc' && o.kind === 'arc') {
      const sw = (c: XY, p: XY, q: XY, ccw: boolean) => arcAngles(c, ccw ? p : q, ccw ? q : p).sweep;
      if (Math.abs(sw(g.c, starts[k], endsAt[k], g.ccw) - sw(o.c, o.from, o.to, o.ccw)) > Math.PI)
        return { ok: false, reason: 'The offset is too big: an arc would fold back on itself.' };
    }
  }
  let next: Sketch = s;
  const ids: string[] = [];
  const newPoint = (p: XY) => {
    const id = newId('p');
    next = { ...next, points: [...next.points, { id, x: p[0], y: p[1] }] };
    return id;
  };
  const startIds = starts.map((p) => newPoint(p));
  const endIds = closed ? startIds.map((_, k) => startIds[(k + 1) % n]) : [...startIds.slice(1), newPoint(endsAt[n - 1])];
  const created: SketchEntity[] = [];
  const extra: Sketch['constraints'] = [];
  moved.forEach((g, k) => {
    const [a, b] = [startIds[k], endIds[k]];
    if (g.kind === 'line') {
      const id = newId('l');
      created.push({ id, kind: 'line', a, b });
      extra.push({ id: newId('c'), kind: 'parallel', l1: g.src, l2: id });
    } else created.push({ id: newId('a'), kind: 'arc', c: g.cId, a: g.ccw ? a : b, b: g.ccw ? b : a });
    ids.push(created[created.length - 1].id);
  });
  next = { ...next, entities: [...next.entities, ...created], constraints: [...next.constraints, ...extra] };
  if (closed && sketchOutlines({ points: next.points, entities: created, constraints: [] }).crossing)
    return { ok: false, reason: 'The offset is too big: the copy would cross itself.' };
  return finish(s, next, `Offset ${n} curve${n === 1 ? '' : 's'} by ${+Math.abs(distance).toFixed(3)} mm`);
}

/**
 * A sketch scaled by fx along x and fy along y (for resizing a body that is made independent of
 * its sketch). Lengths scale with uniform scaling; any constraint the scaled geometry no longer
 * meets is removed, and its description returned.
 */
export function scaleSketch(s: Sketch, fx: number, fy: number): { sketch: Sketch; dropped: string[] } {
  const uniform = Math.abs(fx - fy) < 1e-9;
  const scaled: Sketch = {
    points: s.points.map((p) => ({ ...p, x: p.x * fx, y: p.y * fy })),
    entities: s.entities.map((e) => (e.kind === 'circle' ? { ...e, r: e.r * Math.sqrt(Math.abs(fx * fy)) } : e)),
    constraints: [],
  };
  const holds = (c: Sketch['constraints'][number]) => {
    const r = solveSketch({ ...scaled, constraints: [c] });
    if (r.status.kind === 'conflicting') return false;
    return r.sketch.points.every((p, i) => Math.hypot(p.x - scaled.points[i].x, p.y - scaled.points[i].y) < 1e-6);
  };
  const kept: Sketch['constraints'] = [];
  const dropped: string[] = [];
  for (const c of s.constraints) {
    const lengthLike = c.kind === 'distance' || c.kind === 'pointDistance' || c.kind === 'radius' || c.kind === 'pointLineDistance';
    // Positions scale on their own axis even when the scaling is not uniform.
    const candidate =
      c.kind === 'pointX'
        ? { ...c, value: c.value * fx }
        : c.kind === 'pointY'
          ? { ...c, value: c.value * fy }
          : uniform && lengthLike
            ? { ...c, value: c.value * fx }
            : c;
    if (holds(candidate)) kept.push(candidate);
    else dropped.push(describeConstraint(c));
  }
  return { sketch: { ...scaled, constraints: kept }, dropped };
}
