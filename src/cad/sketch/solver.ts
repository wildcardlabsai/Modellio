import type { Constraint, Sketch, SketchEntity, SketchStatus } from './types';

/**
 * Geometric constraint solver. Unknowns are the free point coordinates and circle radii;
 * every constraint contributes one or two residual equations (plus one per arc, keeping
 * both ends on the same radius). Levenberg–Marquardt on a numeric Jacobian moves the sketch
 * as little as possible to satisfy them, so dragging feels natural. Degrees of freedom are
 * the unknowns minus the Jacobian's rank at the solution.
 */
interface Vars {
  values: number[];
  /** point id → index of its x in `values` (−1 when fixed). */
  pointIndex: Map<string, number>;
  circleIndex: Map<string, number>;
}

function collect(s: Sketch, pinned: Set<string>): Vars {
  const values: number[] = [];
  const pointIndex = new Map<string, number>();
  const circleIndex = new Map<string, number>();
  for (const p of s.points) {
    if (p.fixed || pinned.has(p.id)) {
      pointIndex.set(p.id, -1);
      continue;
    }
    pointIndex.set(p.id, values.length);
    values.push(p.x, p.y);
  }
  for (const e of s.entities)
    if (e.kind === 'circle') {
      circleIndex.set(e.id, values.length);
      values.push(e.r);
    }
  return { values, pointIndex, circleIndex };
}

type Residuals = (v: number[]) => number[];

function residualFn(s: Sketch, vars: Vars): Residuals {
  const pts = new Map(s.points.map((p) => [p.id, p]));
  const ents = new Map(s.entities.map((e) => [e.id, e]));
  const P = (v: number[], id: string): [number, number] => {
    const i = vars.pointIndex.get(id);
    if (i === undefined || i < 0) {
      const p = pts.get(id)!;
      return [p.x, p.y];
    }
    return [v[i], v[i + 1]];
  };
  const dir = (v: number[], lineId: string): [number, number] => {
    const l = ents.get(lineId) as Extract<SketchEntity, { kind: 'line' }> | undefined;
    if (!l || l.kind !== 'line') return [1, 0];
    const a = P(v, l.a);
    const b = P(v, l.b);
    return [b[0] - a[0], b[1] - a[1]];
  };
  const radius = (v: number[], id: string): number => {
    const e = ents.get(id);
    if (!e) return 0;
    if (e.kind === 'circle') return v[vars.circleIndex.get(e.id)!];
    if (e.kind === 'arc') {
      const a = P(v, e.a);
      const c = P(v, e.c);
      return Math.hypot(a[0] - c[0], a[1] - c[1]);
    }
    return 0;
  };
  const eqs: ((v: number[]) => number[])[] = [];
  for (const e of s.entities)
    if (e.kind === 'arc')
      eqs.push((v) => {
        const a = P(v, e.a);
        const b = P(v, e.b);
        const c = P(v, e.c);
        return [Math.hypot(b[0] - c[0], b[1] - c[1]) - Math.hypot(a[0] - c[0], a[1] - c[1])];
      });
  for (const c of s.constraints) eqs.push(constraintEq(c, P, dir, radius, ents));
  return (v) => eqs.flatMap((f) => f(v));
}

function constraintEq(
  c: Constraint,
  P: (v: number[], id: string) => [number, number],
  dir: (v: number[], id: string) => [number, number],
  radius: (v: number[], id: string) => number,
  ents: Map<string, SketchEntity>,
): (v: number[]) => number[] {
  const unit = (d: [number, number]) => {
    const n = Math.hypot(d[0], d[1]) || 1;
    return [d[0] / n, d[1] / n];
  };
  switch (c.kind) {
    case 'horizontal':
      return (v) => [dir(v, c.line)[1]];
    case 'vertical':
      return (v) => [dir(v, c.line)[0]];
    case 'distance':
      return (v) => {
        const d = dir(v, c.line);
        return [Math.hypot(d[0], d[1]) - c.value];
      };
    case 'radius':
      return (v) => [radius(v, c.entity) - c.value];
    case 'coincident':
      return (v) => {
        const a = P(v, c.a);
        const b = P(v, c.b);
        return [a[0] - b[0], a[1] - b[1]];
      };
    case 'parallel':
      return (v) => {
        const [ax, ay] = unit(dir(v, c.l1));
        const [bx, by] = unit(dir(v, c.l2));
        return [ax * by - ay * bx];
      };
    case 'perpendicular':
      return (v) => {
        const [ax, ay] = unit(dir(v, c.l1));
        const [bx, by] = unit(dir(v, c.l2));
        return [ax * bx + ay * by];
      };
    case 'equal':
      return (v) => {
        const k1 = ents.get(c.l1)?.kind;
        const k2 = ents.get(c.l2)?.kind;
        const len = (id: string, k?: string) => {
          if (k === 'line') {
            const d = dir(v, id);
            return Math.hypot(d[0], d[1]);
          }
          return radius(v, id);
        };
        return [len(c.l1, k1) - len(c.l2, k2)];
      };
    case 'pointX':
      return (v) => [P(v, c.point)[0] - c.value];
    case 'pointY':
      return (v) => [P(v, c.point)[1] - c.value];
  }
}

function jacobian(f: Residuals, v: number[], r0: number[]): number[][] {
  const J: number[][] = r0.map(() => new Array(v.length).fill(0));
  const x = v.slice();
  for (let j = 0; j < v.length; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(v[j]));
    x[j] = v[j] + h;
    const r1 = f(x);
    x[j] = v[j];
    for (let i = 0; i < r0.length; i++) J[i][j] = (r1[i] - r0[i]) / h;
  }
  return J;
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
  const scale = Math.max(1e-12, ...M.flat().map(Math.abs));
  for (let c = 0; c < cols && rk < M.length; c++) {
    let p = rk;
    for (let r = rk + 1; r < M.length; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-7 * scale) continue;
    [M[rk], M[p]] = [M[p], M[rk]];
    for (let r = rk + 1; r < M.length; r++) {
      const f = M[r][c] / M[rk][c];
      for (let k = c; k < cols; k++) M[r][k] -= f * M[rk][k];
    }
    rk++;
  }
  return rk;
}

const norm2 = (r: number[]) => r.reduce((s, x) => s + x * x, 0);

export interface SolveResult {
  sketch: Sketch;
  status: SketchStatus;
  /** Largest remaining constraint error (mm or unitless). */
  error: number;
}

/**
 * Move the sketch so its constraints hold. `pinned` points stay where they are (the one being
 * dragged). Returns the solved sketch (a new object) and whether it is under/fully/over
 * constrained or conflicting.
 */
export function solveSketch(s: Sketch, pinned: string[] = []): SolveResult {
  if (!s.points.length) return { sketch: s, status: { kind: 'empty' }, error: 0 };
  const vars = collect(s, new Set(pinned));
  const f = residualFn(s, vars);
  let v = vars.values.slice();
  let r = f(v);
  let lambda = 1e-3;
  for (let it = 0; it < 60 && r.length && v.length; it++) {
    const e = norm2(r);
    if (e < 1e-18) break;
    const J = jacobian(f, v, r);
    const n = v.length;
    const JtJ: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const Jtr = new Array(n).fill(0);
    for (let i = 0; i < r.length; i++)
      for (let a = 0; a < n; a++) {
        const ja = J[i][a];
        if (!ja) continue;
        Jtr[a] += ja * r[i];
        for (let b = 0; b < n; b++) JtJ[a][b] += ja * J[i][b];
      }
    let improved = false;
    for (let tries = 0; tries < 8; tries++) {
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
      const nr = f(nv);
      if (norm2(nr) < e) {
        v = nv;
        r = nr;
        lambda = Math.max(1e-9, lambda / 3);
        improved = true;
        break;
      }
      lambda *= 10;
    }
    if (!improved) break;
  }
  // Write back.
  const out: Sketch = {
    points: s.points.map((p) => {
      const i = vars.pointIndex.get(p.id)!;
      return i >= 0 ? { ...p, x: v[i], y: v[i + 1] } : p;
    }),
    entities: s.entities.map((e) => (e.kind === 'circle' ? { ...e, r: Math.abs(v[vars.circleIndex.get(e.id)!]) } : e)),
    constraints: s.constraints,
  };
  const error = Math.sqrt(Math.max(0, ...r.map((x) => x * x)));
  // Status from the unpinned problem (dragging doesn't count as a constraint).
  const free = pinned.length ? collect(out, new Set()) : collect(out, new Set());
  const ff = residualFn(out, free);
  const rr = ff(free.values);
  const J = rr.length ? jacobian(ff, free.values, rr) : [];
  const rk = rr.length ? rank(J, free.values.length) : 0;
  const dof = free.values.length - rk;
  let status: SketchStatus;
  if (error > 1e-4) status = { kind: 'conflicting', error };
  else if (rr.length > rk) status = { kind: 'over', redundant: rr.length - rk };
  else if (dof > 0) status = { kind: 'under', dof };
  else status = { kind: 'fully' };
  return { sketch: out, status, error };
}
