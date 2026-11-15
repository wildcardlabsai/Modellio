import type { Constraint, Sketch, SketchEntity, SketchStatus } from './types';

/**
 * Geometric constraint solver.
 *
 * Unknowns are the coordinates of points that some equation uses (and circle radii); points in no
 * equation are never touched. Every constraint contributes one or two residual equations (plus one
 * per arc, keeping both ends on the same radius). The unknowns split into independent groups
 * (points linked by equations), each solved on its own by Levenberg–Marquardt with a sparse
 * numeric Jacobian, so a new constraint can only move the geometry it is connected to.
 * Degrees of freedom are the unknowns minus the Jacobian's rank at the solution.
 */

type V2 = [number, number];
type Getter = { P: (id: string) => V2; R: (entityId: string) => number };

interface Equation {
  /** Constraint id (or '' for an entity's own consistency, e.g. an arc keeping its radius). */
  from: string;
  /** Points and circles this equation reads (decides which unknowns it can move). */
  points: string[];
  circles: string[];
  f: (g: Getter) => number[];
}

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: V2) => Math.hypot(a[0], a[1]);
const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const unit = (a: V2): V2 => {
  const n = len(a) || 1;
  return [a[0] / n, a[1] / n];
};

/** The points an entity is made of (for dependency tracking). */
export function entityPoints(e: SketchEntity): string[] {
  if (e.kind === 'line') return [e.a, e.b];
  if (e.kind === 'arc') return [e.a, e.b, e.c];
  if (e.kind === 'circle') return [e.c];
  return [e.a, e.b, e.c1, e.c2];
}

function equations(s: Sketch): Equation[] {
  const ents = new Map(s.entities.map((e) => [e.id, e]));
  const ent = (id: string) => ents.get(id);
  const ptsOf = (id: string) => {
    const e = ent(id);
    return e ? entityPoints(e) : [];
  };
  const circlesOf = (id: string) => (ent(id)?.kind === 'circle' ? [id] : []);
  const line = (g: Getter, id: string): [V2, V2] => {
    const e = ent(id);
    if (e?.kind !== 'line')
      return [
        [0, 0],
        [1, 0],
      ];
    return [g.P(e.a), g.P(e.b)];
  };
  const centre = (g: Getter, id: string): V2 => {
    const e = ent(id);
    return e && (e.kind === 'arc' || e.kind === 'circle') ? g.P(e.c) : [0, 0];
  };
  /** Direction of a curve at one of its end points (or anywhere along a line). */
  const tangentAt = (g: Getter, id: string, at: string): V2 => {
    const e = ent(id);
    if (!e) return [1, 0];
    if (e.kind === 'line') return sub(g.P(e.b), g.P(e.a));
    if (e.kind === 'arc' || e.kind === 'circle') {
      const r = sub(g.P(at), g.P(e.c));
      return [-r[1], r[0]];
    }
    // Bézier: leaving a along c1 − a, arriving at b along b − c2.
    return at === e.a ? sub(g.P(e.c1), g.P(e.a)) : sub(g.P(e.b), g.P(e.c2));
  };

  const out: Equation[] = [];
  for (const e of s.entities)
    if (e.kind === 'arc')
      out.push({
        from: '',
        points: [e.a, e.b, e.c],
        circles: [],
        f: (g) => [len(sub(g.P(e.b), g.P(e.c))) - len(sub(g.P(e.a), g.P(e.c)))],
      });

  for (const c of s.constraints) {
    const eq = (points: string[], circles: string[], f: Equation['f']) => out.push({ from: c.id, points, circles, f });
    switch (c.kind) {
      case 'horizontal':
        eq(ptsOf(c.line), [], (g) => {
          const [a, b] = line(g, c.line);
          return [b[1] - a[1]];
        });
        break;
      case 'vertical':
        eq(ptsOf(c.line), [], (g) => {
          const [a, b] = line(g, c.line);
          return [b[0] - a[0]];
        });
        break;
      case 'distance':
        eq(ptsOf(c.line), [], (g) => {
          const [a, b] = line(g, c.line);
          return [len(sub(b, a)) - c.value];
        });
        break;
      case 'radius':
        eq(ptsOf(c.entity), circlesOf(c.entity), (g) => [g.R(c.entity) - c.value]);
        break;
      case 'coincident':
        eq([c.a, c.b], [], (g) => sub(g.P(c.a), g.P(c.b)));
        break;
      case 'parallel':
      case 'perpendicular':
        eq([...ptsOf(c.l1), ...ptsOf(c.l2)], [], (g) => {
          const [a1, b1] = line(g, c.l1);
          const [a2, b2] = line(g, c.l2);
          const u = unit(sub(b1, a1));
          const w = unit(sub(b2, a2));
          return [c.kind === 'parallel' ? cross(u, w) : dot(u, w)];
        });
        break;
      case 'equal':
        eq([...ptsOf(c.l1), ...ptsOf(c.l2)], [...circlesOf(c.l1), ...circlesOf(c.l2)], (g) => {
          const size = (id: string) => {
            if (ent(id)?.kind === 'line') {
              const [a, b] = line(g, id);
              return len(sub(b, a));
            }
            return g.R(id);
          };
          return [size(c.l1) - size(c.l2)];
        });
        break;
      case 'pointX':
        eq([c.point], [], (g) => [g.P(c.point)[0] - c.value]);
        break;
      case 'pointY':
        eq([c.point], [], (g) => [g.P(c.point)[1] - c.value]);
        break;
      case 'tangent': {
        const k1 = ent(c.e1)?.kind;
        const k2 = ent(c.e2)?.kind;
        const pts = [...ptsOf(c.e1), ...ptsOf(c.e2)];
        const circ = [...circlesOf(c.e1), ...circlesOf(c.e2)];
        if (c.at) {
          // At a shared end point: the two directions line up.
          eq(pts, circ, (g) => [cross(unit(tangentAt(g, c.e1, c.at!)), unit(tangentAt(g, c.e2, c.at!)))]);
        } else if ((k1 === 'line') !== (k2 === 'line')) {
          // A line tangent to an arc or circle: the centre is one radius from the line.
          const [l, k] = k1 === 'line' ? [c.e1, c.e2] : [c.e2, c.e1];
          eq(pts, circ, (g) => {
            const [a, b] = line(g, l);
            const d = sub(b, a);
            return [Math.abs(cross(d, sub(centre(g, k), a))) / (len(d) || 1) - g.R(k)];
          });
        } else {
          // Two arcs or circles touching outside (or inside).
          eq(pts, circ, (g) => {
            const d = len(sub(centre(g, c.e1), centre(g, c.e2)));
            return [d - (c.inside ? Math.abs(g.R(c.e1) - g.R(c.e2)) : g.R(c.e1) + g.R(c.e2))];
          });
        }
        break;
      }
      case 'concentric':
        eq([...ptsOf(c.e1), ...ptsOf(c.e2)], [], (g) => sub(centre(g, c.e1), centre(g, c.e2)));
        break;
      case 'symmetric':
        eq([c.a, c.b, ...ptsOf(c.line)], [], (g) => {
          const [la, lb] = line(g, c.line);
          const d = sub(lb, la);
          const a = g.P(c.a);
          const b = g.P(c.b);
          const m: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const n = len(d) || 1;
          return [cross(d, sub(m, la)) / n, dot(sub(b, a), d) / n];
        });
        break;
      case 'midpoint':
        eq([c.point, ...ptsOf(c.line)], [], (g) => {
          const [a, b] = line(g, c.line);
          const p = g.P(c.point);
          return [p[0] - (a[0] + b[0]) / 2, p[1] - (a[1] + b[1]) / 2];
        });
        break;
      case 'pointOnLine':
        eq([c.point, ...ptsOf(c.line)], [], (g) => {
          const [a, b] = line(g, c.line);
          const d = sub(b, a);
          return [cross(d, sub(g.P(c.point), a)) / (len(d) || 1)];
        });
        break;
      case 'pointOnCurve':
        eq([c.point, ...ptsOf(c.entity)], circlesOf(c.entity), (g) => [len(sub(g.P(c.point), centre(g, c.entity))) - g.R(c.entity)]);
        break;
      case 'angle':
        eq([...ptsOf(c.l1), ...ptsOf(c.l2)], [], (g) => {
          const [a1, b1] = line(g, c.l1);
          const [a2, b2] = line(g, c.l2);
          const u = sub(b1, a1);
          const w = sub(b2, a2);
          let d = Math.atan2(cross(u, w), dot(u, w)) - (c.value * Math.PI) / 180;
          d = Math.atan2(Math.sin(d), Math.cos(d)); // wrap to (−π, π]
          return [d];
        });
        break;
      case 'pointDistance':
        eq([c.a, c.b], [], (g) => [len(sub(g.P(c.a), g.P(c.b))) - c.value]);
        break;
      case 'pointLineDistance':
        eq([c.point, ...ptsOf(c.line)], [], (g) => {
          const [a, b] = line(g, c.line);
          const d = sub(b, a);
          return [Math.abs(cross(d, sub(g.P(c.point), a))) / (len(d) || 1) - c.value];
        });
        break;
      case 'smooth':
        eq([c.point, c.h1, c.h2], [], (g) => {
          const p = g.P(c.point);
          return [cross(unit(sub(g.P(c.h1), p)), unit(sub(g.P(c.h2), p)))];
        });
        break;
    }
  }
  return out;
}

/** Radius of an arc (from its points) or circle (its own value). */
function radiusOf(ents: Map<string, SketchEntity>, P: (id: string) => V2, circleR: (id: string) => number | undefined) {
  return (id: string) => {
    const e = ents.get(id);
    if (!e) return 0;
    if (e.kind === 'circle') return circleR(id) ?? e.r;
    if (e.kind === 'arc') return len(sub(P(e.a), P(e.c)));
    return 0;
  };
}

/** Solve A x = b (A square) by Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Numerical rank of a matrix (row echelon with a relative tolerance). */
function rank(J: number[][], cols: number): number {
  const M = J.map((r) => r.slice());
  let rk = 0;
  let scale = 1e-12;
  for (const row of M) for (const x of row) scale = Math.max(scale, Math.abs(x));
  for (let c = 0; c < cols && rk < M.length; c++) {
    let p = rk;
    for (let r = rk + 1; r < M.length; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-7 * scale) continue;
    [M[rk], M[p]] = [M[p], M[rk]];
    for (let r = rk + 1; r < M.length; r++) {
      const f = M[r][c] / M[rk][c];
      if (f) for (let k = c; k < cols; k++) M[r][k] -= f * M[rk][k];
    }
    rk++;
  }
  return rk;
}

const norm2 = (r: number[]) => r.reduce((s, x) => s + x * x, 0);

export interface SolveResult {
  sketch: Sketch;
  status: SketchStatus;
  /** Largest remaining constraint error (mm or radians). */
  error: number;
}

/** One independent group of unknowns and the equations that link them. */
interface Group {
  vars: { kind: 'x' | 'y' | 'r'; id: string }[];
  eqs: Equation[];
}

/**
 * Move the sketch so its constraints hold. `pinned` points stay where they are (the one being
 * dragged). Returns the solved sketch (a new object) and whether it is under / fully / over
 * constrained or conflicting. With `diagnose`, a bad status also names the constraints involved.
 */
export function solveSketch(s: Sketch, pinned: string[] = [], opts: { diagnose?: boolean } = {}): SolveResult {
  if (!s.points.length) return { sketch: s, status: { kind: 'empty' }, error: 0 };
  const res = solveOnce(s, new Set(pinned));
  if (opts.diagnose && (res.status.kind === 'conflicting' || res.status.kind === 'over')) {
    res.status = { ...res.status, culprits: diagnose(s, res.status) };
  }
  return res;
}

function solveOnce(s: Sketch, pinned: Set<string>): SolveResult {
  const eqs = equations(s);
  const fixed = new Set(s.points.filter((p) => p.fixed || pinned.has(p.id)).map((p) => p.id));
  const coords = new Map(s.points.map((p) => [p.id, [p.x, p.y] as V2]));
  const radii = new Map(s.entities.filter((e) => e.kind === 'circle').map((e) => [e.id, (e as { r: number }).r]));
  const ents = new Map(s.entities.map((e) => [e.id, e]));

  // Group unknowns: points and circles joined by equations (union-find).
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = k;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const keysOf = (e: Equation) => [
    ...e.points.filter((p) => coords.has(p) && !fixed.has(p)).map((p) => `p:${p}`),
    ...e.circles.map((c) => `c:${c}`),
  ];
  for (const e of eqs) {
    const keys = keysOf(e);
    for (const k of keys) if (!parent.has(k)) parent.set(k, k);
    for (let i = 1; i < keys.length; i++) parent.set(find(keys[i]), find(keys[0]));
  }
  const groups = new Map<string, Group>();
  const loose: Equation[] = []; // equations on fixed points only: they can only be checked
  for (const e of eqs) {
    const keys = keysOf(e);
    if (!keys.length) {
      loose.push(e);
      continue;
    }
    const root = find(keys[0]);
    if (!groups.has(root)) groups.set(root, { vars: [], eqs: [] });
    groups.get(root)!.eqs.push(e);
  }
  for (const k of parent.keys()) {
    const g = groups.get(find(k));
    if (!g) continue;
    const id = k.slice(2);
    if (k.startsWith('p:')) g.vars.push({ kind: 'x', id }, { kind: 'y', id });
    else g.vars.push({ kind: 'r', id });
  }

  let worst = 0;
  let unknowns = 0;
  let ranks = 0;
  let rows = 0;
  for (const g of groups.values()) {
    const r = solveGroup(ents, g, coords, radii);
    worst = Math.max(worst, r.error);
    unknowns += g.vars.length;
    ranks += r.rank;
    rows += r.rows;
  }
  const getter: Getter = { P: (id) => coords.get(id) ?? [0, 0], R: () => 0 };
  getter.R = radiusOf(ents, getter.P, (id) => radii.get(id));
  for (const e of loose) for (const x of e.f(getter)) worst = Math.max(worst, Math.abs(x));
  rows += loose.reduce((n, e) => n + e.f(getter).length, 0);

  const sketch: Sketch = {
    points: s.points.map((p) => {
      const c = coords.get(p.id)!;
      return c[0] === p.x && c[1] === p.y ? p : { ...p, x: c[0], y: c[1] };
    }),
    entities: s.entities.map((e) => (e.kind === 'circle' && radii.get(e.id) !== e.r ? { ...e, r: Math.abs(radii.get(e.id)!) } : e)),
    constraints: s.constraints,
  };
  // Points in no equation are free too (2 each), circles in none have a free radius.
  const usedPoints = new Set<string>();
  const usedCircles = new Set<string>();
  for (const e of eqs) {
    e.points.forEach((p) => usedPoints.add(p));
    e.circles.forEach((c) => usedCircles.add(c));
  }
  let freeExtra = 0;
  for (const p of s.points) if (!p.fixed && !usedPoints.has(p.id)) freeExtra += 2;
  for (const e of s.entities) if (e.kind === 'circle' && !usedCircles.has(e.id)) freeExtra += 1;
  const dof = unknowns - ranks + freeExtra;
  let status: SketchStatus;
  if (worst > 1e-4) status = { kind: 'conflicting', error: worst };
  else if (rows > ranks) status = { kind: 'over', redundant: rows - ranks };
  else if (dof > 0) status = { kind: 'under', dof };
  else status = { kind: 'fully' };
  return { sketch, status, error: worst };
}

/** Levenberg–Marquardt on one group, writing the result back into `coords` / `radii`. */
function solveGroup(
  ents: Map<string, SketchEntity>,
  g: Group,
  coords: Map<string, V2>,
  radii: Map<string, number>,
): { error: number; rank: number; rows: number } {
  const n = g.vars.length;
  const idx = new Map(g.vars.map((v, i) => [`${v.kind}:${v.id}`, i]));
  let v = g.vars.map((x) => (x.kind === 'r' ? radii.get(x.id)! : coords.get(x.id)![x.kind === 'x' ? 0 : 1]));
  const getterFor = (vals: number[]): Getter => {
    const P = (id: string): V2 => {
      const ix = idx.get(`x:${id}`);
      if (ix === undefined) return coords.get(id) ?? [0, 0];
      return [vals[ix], vals[idx.get(`y:${id}`)!]];
    };
    const R = radiusOf(ents, P, (id) => {
      const ir = idx.get(`r:${id}`);
      return ir === undefined ? radii.get(id) : vals[ir];
    });
    return { P, R };
  };
  // The columns each equation can affect.
  const cols = g.eqs.map((e) => {
    const c: number[] = [];
    for (const p of e.points) {
      const ix = idx.get(`x:${p}`);
      if (ix !== undefined && !c.includes(ix)) c.push(ix, idx.get(`y:${p}`)!);
    }
    for (const ci of e.circles) {
      const ir = idx.get(`r:${ci}`);
      if (ir !== undefined && !c.includes(ir)) c.push(ir);
    }
    return c;
  });
  const residuals = (vals: number[]) => {
    const gt = getterFor(vals);
    return g.eqs.map((e) => e.f(gt));
  };
  /** Sparse numeric Jacobian: each equation is differentiated only by the unknowns it reads. */
  const jacobian = (vals: number[], r0: number[][]): number[][] => {
    const J: number[][] = [];
    const x = vals.slice();
    g.eqs.forEach((e, k) => {
      const rowsK: number[][] = r0[k].map(() => new Array(n).fill(0));
      for (const j of cols[k]) {
        const h = 1e-6 * Math.max(1, Math.abs(vals[j]));
        x[j] = vals[j] + h;
        const r1 = e.f(getterFor(x));
        x[j] = vals[j];
        for (let i = 0; i < r1.length; i++) rowsK[i][j] = (r1[i] - r0[k][i]) / h;
      }
      J.push(...rowsK);
    });
    return J;
  };
  let r = residuals(v);
  let flat = r.flat();
  let lambda = 1e-3;
  for (let it = 0; it < 80 && flat.length && n; it++) {
    const e = norm2(flat);
    if (e < 1e-20) break;
    const J = jacobian(v, r);
    const JtJ: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const Jtr = new Array(n).fill(0);
    for (let i = 0; i < J.length; i++) {
      const row = J[i];
      const nz: number[] = [];
      for (let a = 0; a < n; a++) if (row[a]) nz.push(a);
      for (const a of nz) {
        Jtr[a] += row[a] * flat[i];
        for (const b of nz) JtJ[a][b] += row[a] * row[b];
      }
    }
    let improved = false;
    for (let tries = 0; tries < 10; tries++) {
      const A = JtJ.map((row, a) => row.map((x, b) => (a === b ? x + lambda * (1 + x) : x)));
      const step = solveLinear(
        A,
        Jtr.map((x) => -x),
      );
      if (!step) {
        lambda *= 10;
        continue;
      }
      const nv = v.map((x, i) => x + step[i]);
      const nr = residuals(nv);
      const nflat = nr.flat();
      if (norm2(nflat) < e) {
        v = nv;
        r = nr;
        flat = nflat;
        lambda = Math.max(1e-12, lambda / 3);
        improved = true;
        break;
      }
      lambda *= 10;
    }
    if (!improved) break;
  }
  g.vars.forEach((x, i) => {
    if (x.kind === 'r') radii.set(x.id, v[i]);
    else {
      const c = coords.get(x.id)!;
      coords.set(x.id, x.kind === 'x' ? [v[i], c[1]] : [c[0], v[i]]);
    }
  });
  const error = Math.sqrt(Math.max(0, ...flat.map((x) => x * x)));
  const J = flat.length ? jacobian(v, r) : [];
  return { error, rank: flat.length ? rank(J, n) : 0, rows: flat.length };
}

/**
 * Which constraints are behind a conflict (or a redundancy): each one that, removed, makes the
 * sketch solvable (or less redundant). Solved from the same starting geometry.
 */
function diagnose(s: Sketch, status: Extract<SketchStatus, { kind: 'over' | 'conflicting' }>): string[] {
  const out: string[] = [];
  for (const c of s.constraints) {
    const without = solveOnce({ ...s, constraints: s.constraints.filter((x) => x.id !== c.id) }, new Set());
    if (status.kind === 'conflicting') {
      if (without.status.kind !== 'conflicting') out.push(c.id);
    } else if (without.status.kind !== 'over' || without.status.redundant < status.redundant) out.push(c.id);
  }
  return out;
}

/**
 * Add (or change) a constraint only if the sketch can still be solved. Returns the solved sketch,
 * or the constraints it conflicts with, leaving the original untouched.
 */
export function tryConstraint(s: Sketch, c: Constraint): { ok: true; result: SolveResult } | { ok: false; culprits: string[] } {
  const constraints = s.constraints.some((x) => x.id === c.id) ? s.constraints.map((x) => (x.id === c.id ? c : x)) : [...s.constraints, c];
  const next = { ...s, constraints };
  const result = solveSketch(next, [], { diagnose: true });
  if (result.status.kind !== 'conflicting') return { ok: true, result };
  return { ok: false, culprits: (result.status.culprits ?? []).filter((id) => id !== c.id) };
}
