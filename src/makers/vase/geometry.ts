import type { ManifoldToplevel, SimplePolygon } from 'manifold-3d';
import { manifoldToMeshData, meshDataToManifold, type MeshData } from '@/cad/kernel/meshData';
import { validatePart } from '@/split/geometry/split';

/**
 * Vase, pot and lampshade generator.
 *
 * A body is a profile (radius by height) swept around a cross-section shape, rotated by a
 * twist and modulated by a surface pattern:
 *
 *   outer(t, θ) = R(t) · S(θ − twist(t)) + A · P(θ, t) · fade(t)
 *
 * with t = z / height. Walls are a true inward offset of the cross-section (Manifold 2D
 * offset, resampled radially), so star and flower shapes keep their wall thickness at the
 * points as well as the sides. Millimetres, Z up, printed as built (base on the bed).
 */
export type BodyType = 'vase' | 'pot' | 'lampshade';
export type ShapeKind = 'circle' | 'polygon' | 'star' | 'flower' | 'gear' | 'squircle';
export type PatternKind = 'none' | 'ribs' | 'spiral' | 'waves' | 'diamond' | 'bubbles' | 'noise' | 'steps';

export interface ProfilePoint {
  /** Height fraction, 0 = base, 1 = rim. */
  t: number;
  /** Radius at that height (mm), measured to the outermost point of the shape. */
  r: number;
}

export interface VaseParams {
  type: BodyType;
  height: number;
  profile: ProfilePoint[];
  shape: { kind: ShapeKind; sides: number; depth: number; rounding: number };
  twist: number;
  twistStyle: 'linear' | 'ease' | 'wave';
  pattern: { kind: PatternKind; count: number; amplitude: number; turns: number; rows: number; sharpness: number; seed: number };
  /** Vases only: a solid body for the slicer's spiral ("vase") mode, or real walls. */
  vaseMode: boolean;
  wall: number;
  base: number;
  drainage: { holes: 0 | 1 | 5; diameter: number };
  saucer: boolean;
  /** Lampshades: hole in the top for the lamp holder (mm). */
  bulbHole: number;
}

export const DEFAULT_VASE: VaseParams = {
  type: 'vase',
  height: 160,
  profile: [
    { t: 0, r: 30 },
    { t: 0.35, r: 46 },
    { t: 0.75, r: 26 },
    { t: 1, r: 32 },
  ],
  shape: { kind: 'circle', sides: 6, depth: 0.25, rounding: 0.2 },
  twist: 0,
  twistStyle: 'linear',
  pattern: { kind: 'none', count: 24, amplitude: 1.5, turns: 1, rows: 12, sharpness: 0.3, seed: 1 },
  vaseMode: true,
  wall: 2,
  base: 3,
  drainage: { holes: 1, diameter: 8 },
  saucer: true,
  bulbHole: 42,
};

export interface VasePart {
  id: 'body' | 'saucer';
  name: string;
  mesh: MeshData;
  size: [number, number, number];
  volume: number;
  watertight: boolean;
}

export interface VaseResult {
  parts: VasePart[];
  /** Largest outside diameter and height (mm). */
  width: number;
  height: number;
  /** Inside volume in millilitres (approximate in vase mode). */
  capacity: number;
  /** Steepest outward lean of the outside (degrees from vertical). */
  maxOverhang: number;
  warnings: string[];
  notes: string[];
}

export interface Resolution {
  /** Points around. */
  around: number;
  /** Rings per mm of height. */
  perMm: number;
}
export const DRAFT: Resolution = { around: 160, perMm: 0.8 };
export const FINE: Resolution = { around: 320, perMm: 2 };

// ---------------------------------------------------------------------------------------------
// Profile and shape functions

/** Monotone cubic (Fritsch–Carlson) interpolation of the profile: no overshoot between points. */
export function profileFunction(points: ProfilePoint[]): (t: number) => number {
  const p = [...points].sort((a, b) => a.t - b.t);
  if (p.length === 1) return () => p[0].r;
  const n = p.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1].r - p[i].r) / Math.max(1e-9, p[i + 1].t - p[i].t));
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (t: number) => {
    if (t <= p[0].t) return p[0].r;
    if (t >= p[n - 1].t) return p[n - 1].r;
    let i = 0;
    while (i < n - 2 && t > p[i + 1].t) i++;
    const h = p[i + 1].t - p[i].t;
    const u = (t - p[i].t) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
    const h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2;
    const h11 = u ** 3 - u ** 2;
    return h00 * p[i].r + h10 * h * m[i] + h01 * p[i + 1].r + h11 * h * m[i + 1];
  };
}

/** Cross-section radius multiplier S(θ), normalised so its maximum is 1. */
export function shapeFunction(shape: VaseParams['shape']): (theta: number) => number {
  const n = Math.max(2, Math.round(shape.sides));
  const depth = Math.min(0.9, Math.max(0, shape.depth));
  const round = Math.min(1, Math.max(0, shape.rounding));
  let f: (th: number) => number;
  switch (shape.kind) {
    case 'polygon': {
      const a = (2 * Math.PI) / n;
      f = (th) => {
        const local = (((th % a) + a) % a) - a / 2;
        const poly = Math.cos(Math.PI / n) / Math.cos(local);
        return (1 - round) * poly + round;
      };
      break;
    }
    case 'star':
      f = (th) => {
        const u = ((((th * n) / (2 * Math.PI)) % 1) + 1) % 1;
        const tri = Math.abs(u - 0.5) * 2; // 1 at the points, 0 between
        const smooth = 0.5 + 0.5 * Math.cos(n * th);
        return 1 - depth * (1 - ((1 - round) * tri + round * smooth));
      };
      break;
    case 'flower':
      f = (th) => 1 - depth * (1 - Math.abs(Math.cos((n * th) / 2)) ** (0.35 + round));
      break;
    case 'gear':
      f = (th) => {
        const k = 2 + 18 * (1 - round);
        return 1 - depth * (1 - (0.5 + 0.5 * Math.tanh(k * Math.cos(n * th))));
      };
      break;
    case 'squircle': {
      const p = 2 + 8 * (1 - round);
      f = (th) => (Math.abs(Math.cos(th)) ** p + Math.abs(Math.sin(th)) ** p) ** (-1 / p);
      break;
    }
    default:
      f = () => 1;
  }
  let max = 0;
  for (let i = 0; i < 2048; i++) max = Math.max(max, f((i / 2048) * 2 * Math.PI));
  return (th) => f(th) / max;
}

function twistFunction(p: VaseParams): (t: number) => number {
  const total = (p.twist * Math.PI) / 180;
  if (p.twistStyle === 'ease') return (t) => total * t * t * (3 - 2 * t);
  if (p.twistStyle === 'wave') return (t) => total * Math.sin(Math.PI * t);
  return (t) => total * t;
}

/** Seeded pseudo-random numbers (mulberry32). */
function rng(seed: number) {
  let a = Math.floor(seed * 2654435761) >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Surface pattern P(θ, t) in [0, 1]. */
export function patternFunction(pt: VaseParams['pattern'], height: number, meanRadius: number): (theta: number, t: number) => number {
  const c = Math.max(1, Math.round(pt.count));
  const sharp = 1 + Math.min(1, Math.max(0, pt.sharpness)) * 7;
  const wave = (x: number) => (0.5 + 0.5 * Math.cos(x)) ** sharp;
  switch (pt.kind) {
    case 'ribs':
      return (th) => wave(c * th);
    case 'spiral':
      return (th, t) => wave(c * th + 2 * Math.PI * pt.turns * t * c);
    case 'waves':
      return (_, t) => wave(2 * Math.PI * pt.rows * t);
    case 'steps':
      return (_, t) => {
        const u = (pt.rows * t) % 1;
        return u ** (1 + (sharp - 1) * 0.5);
      };
    case 'diamond':
      return (th, t) => wave(c * th + 2 * Math.PI * pt.turns * t * c) * wave(c * th - 2 * Math.PI * pt.turns * t * c);
    case 'bubbles': {
      // Staggered grid of round bumps, sized so cells are roughly square on the surface.
      const rows = Math.max(1, Math.round((height / ((2 * Math.PI * meanRadius) / c)) * 1)) || 1;
      return (th, t) => {
        const v = t * rows;
        const row = Math.floor(v);
        const u = (th / (2 * Math.PI)) * c + (row % 2 ? 0.5 : 0);
        const du = u - Math.floor(u) - 0.5;
        const dv = v - row - 0.5;
        const d = Math.hypot(du, dv) / 0.48;
        return d >= 1 ? 0 : Math.sqrt(1 - d * d) ** (1 + (sharp - 1) * 0.3);
      };
    }
    case 'noise': {
      const r = rng(pt.seed);
      const waves = Array.from({ length: 7 }, () => ({
        k: 1 + Math.floor(r() * c),
        l: 0.5 + r() * pt.rows,
        ph: r() * 2 * Math.PI,
        ph2: r() * 2 * Math.PI,
        a: 0.4 + r(),
      }));
      const sum = waves.reduce((s, w) => s + w.a, 0);
      return (th, t) => {
        let v = 0;
        for (const w of waves) v += w.a * Math.sin(w.k * th + w.ph) * Math.cos(2 * Math.PI * w.l * t + w.ph2);
        return Math.min(1, Math.max(0, 0.5 + 0.5 * (v / sum) * 1.6));
      };
    }
    default:
      return () => 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Body

interface Surfaces {
  around: number;
  /** Outer rings: radii[i][j] at heights zs[i]. */
  zs: number[];
  outer: Float64Array[];
  /** Inner rings at heights zi (empty for a solid body). */
  zi: number[];
  inner: Float64Array[];
  floorZ: number;
}

/** Radius of a closed polygon set along a ray from the origin (nearest crossing). */
function rayRadius(polys: SimplePolygon[], ang: number): number {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  let best = Infinity;
  for (const p of polys)
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [ax, ay] = p[j];
      const [bx, by] = p[i];
      const ex = bx - ax;
      const ey = by - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const s = (ax * ey - ay * ex) / den;
      const u = (ax * dy - ay * dx) / den;
      if (s > 0 && u >= -1e-9 && u <= 1 + 1e-9 && s < best) best = s;
    }
  return best === Infinity ? 0 : best;
}

function sampleSurfaces(k: ManifoldToplevel, p: VaseParams, res: Resolution): Surfaces {
  const M = res.around;
  const R = profileFunction(p.profile);
  const S = shapeFunction(p.shape);
  const tw = twistFunction(p);
  const H = p.height;
  const meanR = p.profile.reduce((s, q) => s + q.r, 0) / p.profile.length;
  const P = patternFunction(p.pattern, H, meanR);
  const A = p.pattern.kind === 'none' ? 0 : p.pattern.amplitude;
  const fadeLen = Math.min(4, H * 0.08);
  const fade = (z: number) => Math.min(1, z / fadeLen, (H - z) / fadeLen) ** 0.7;
  const N = Math.max(24, Math.min(1200, Math.round(H * res.perMm)));
  const angles = Array.from({ length: M }, (_, j) => (2 * Math.PI * j) / M);

  const zs: number[] = [];
  const outer: Float64Array[] = [];
  for (let i = 0; i <= N; i++) {
    const z = (H * i) / N;
    const t = z / H;
    const r = R(t);
    const rot = tw(t);
    const f = fade(Math.max(0, Math.min(H, z)));
    const ring = new Float64Array(M);
    for (let j = 0; j < M; j++) ring[j] = Math.max(0.3, r * S(angles[j] - rot) + A * P(angles[j], t) * f);
    zs.push(z);
    outer.push(ring);
  }
  const solid = p.type === 'vase' && p.vaseMode;
  if (solid) return { around: M, zs, outer, zi: [], inner: [], floorZ: 0 };

  // Inner wall: the plain cross-section (no pattern) offset inward by the wall, resampled radially.
  const wall = p.wall + Math.max(0, -A);
  const base = Math.min(p.base, H - 1);
  const isCircle = p.shape.kind === 'circle';
  // Inward offset of the unit shape scaled by R depends only on wall / R: precompute a table.
  const table = new Map<number, Float64Array>();
  const STEP = 1 / 400;
  const tableRing = (key: number): Float64Array => {
    let ring = table.get(key);
    if (ring) return ring;
    ring = new Float64Array(M);
    const poly: [number, number][] = [];
    const Q = 720;
    for (let q = 0; q < Q; q++) {
      const a = (2 * Math.PI * q) / Q;
      const sv = S(a);
      poly.push([sv * Math.cos(a), sv * Math.sin(a)]);
    }
    const cs = new k.CrossSection([poly], 'Positive');
    const off = cs.offset(-key * STEP, 'Round', 2, 64);
    const polys = off.toPolygons();
    cs.delete();
    off.delete();
    for (let j = 0; j < M; j++) ring[j] = polys.length ? rayRadius(polys, angles[j]) : 0;
    table.set(key, ring);
    return ring;
  };
  /** Inner ring of the unit shape offset by `ratio` (wall / radius); exact for circles, interpolated otherwise. */
  const offsetRing = (ratio: number): Float64Array => {
    if (isCircle) return new Float64Array(M).fill(Math.max(0, 1 - ratio));
    const x = ratio / STEP;
    const k0 = Math.floor(x);
    const f = x - k0;
    const a = tableRing(k0);
    const b = tableRing(k0 + 1);
    const out = new Float64Array(M);
    for (let j = 0; j < M; j++) out[j] = a[j] * (1 - f) + b[j] * f;
    return out;
  };
  const zi: number[] = [base];
  for (const z of zs) if (z > base + 1e-6) zi.push(z);
  const inner = zi.map((z) => {
    const t = z / H;
    const r = R(t);
    const rot = tw(t);
    const unit = offsetRing(wall / Math.max(r, 1e-3));
    const ring = new Float64Array(M);
    // The unit ring is in the shape's own frame; rotate by sampling at θ − rot.
    for (let j = 0; j < M; j++) {
      const a = angles[j] - rot;
      const x = ((a / (2 * Math.PI)) * M) % M;
      const j0 = Math.floor((x + M) % M);
      const fr = ((x + M) % M) - j0;
      const v = unit[j0] * (1 - fr) + unit[(j0 + 1) % M] * fr;
      ring[j] = Math.max(0.2, v * r);
    }
    return ring;
  });
  return { around: M, zs, outer, zi, inner, floorZ: base };
}

/** Triangle mesh of the body: outer wall, bottom, and either a top cap (solid) or rim, inner wall and floor. */
function meshSurfaces(s: Surfaces): MeshData {
  const M = s.around;
  const angles = Array.from({ length: M }, (_, j) => (2 * Math.PI * j) / M);
  const cos = angles.map(Math.cos);
  const sin = angles.map(Math.sin);
  const pos: number[] = [];
  const idx: number[] = [];
  const ring = (radii: Float64Array, z: number) => {
    const start = pos.length / 3;
    for (let j = 0; j < M; j++) pos.push(radii[j] * cos[j], radii[j] * sin[j], z);
    return start;
  };
  const centre = (z: number) => {
    pos.push(0, 0, z);
    return pos.length / 3 - 1;
  };
  const outerStarts = s.zs.map((z, i) => ring(s.outer[i], z));
  for (let i = 0; i < outerStarts.length - 1; i++) {
    const a0 = outerStarts[i];
    const b0 = outerStarts[i + 1];
    for (let j = 0; j < M; j++) {
      const j1 = (j + 1) % M;
      idx.push(a0 + j, a0 + j1, b0 + j1, a0 + j, b0 + j1, b0 + j);
    }
  }
  // Bottom (faces down).
  const c0 = centre(0);
  const bot = outerStarts[0];
  for (let j = 0; j < M; j++) idx.push(c0, bot + ((j + 1) % M), bot + j);
  const top = outerStarts[outerStarts.length - 1];
  if (!s.inner.length) {
    const ct = centre(s.zs[s.zs.length - 1]);
    for (let j = 0; j < M; j++) idx.push(ct, top + j, top + ((j + 1) % M));
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
  }
  const innerStarts = s.zi.map((z, i) => ring(s.inner[i], z));
  // Rim between the outer and inner top rings (faces up).
  const itop = innerStarts[innerStarts.length - 1];
  for (let j = 0; j < M; j++) {
    const j1 = (j + 1) % M;
    idx.push(top + j, top + j1, itop + j1, top + j, itop + j1, itop + j);
  }
  // Inner wall (faces inwards).
  for (let i = 0; i < innerStarts.length - 1; i++) {
    const a0 = innerStarts[i];
    const b0 = innerStarts[i + 1];
    for (let j = 0; j < M; j++) {
      const j1 = (j + 1) % M;
      idx.push(a0 + j, b0 + j1, a0 + j1, a0 + j, b0 + j, b0 + j1);
    }
  }
  // Floor (faces up).
  const cf = centre(s.floorZ);
  const fl = innerStarts[0];
  for (let j = 0; j < M; j++) idx.push(cf, fl + j, fl + ((j + 1) % M));
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

function ringArea(radii: Float64Array, shrink = 0): number {
  const M = radii.length;
  let a = 0;
  for (let j = 0; j < M; j++) {
    const r0 = Math.max(0, radii[j] - shrink);
    const r1 = Math.max(0, radii[(j + 1) % M] - shrink);
    a += 0.5 * r0 * r1 * Math.sin((2 * Math.PI) / M);
  }
  return a;
}

export function buildVase(k: ManifoldToplevel, p: VaseParams, res: Resolution = DRAFT): VaseResult {
  const warnings: string[] = [];
  const notes: string[] = [];
  if (p.profile.length < 2) throw new Error('The profile needs at least two points.');
  if (!(p.height > 5)) throw new Error('The height must be more than 5 mm.');
  const s = sampleSurfaces(k, p, res);
  let mesh = meshSurfaces(s);

  // Holes: drainage (pots) or the lamp holder (lampshades), cut with Manifold.
  const holes: [number, number, number][] = [];
  const floorR = s.inner.length ? Math.min(...s.inner[0]) : 0;
  if (p.type === 'pot' && p.drainage.holes > 0 && s.inner.length) {
    const d = Math.min(p.drainage.diameter, floorR * 0.6);
    if (d >= 2) {
      holes.push([0, 0, d / 2]);
      if (p.drainage.holes === 5 && floorR > d * 2.5)
        for (let q = 0; q < 4; q++)
          holes.push([
            Math.cos((q * Math.PI) / 2 + Math.PI / 4) * floorR * 0.55,
            Math.sin((q * Math.PI) / 2 + Math.PI / 4) * floorR * 0.55,
            d / 2.4,
          ]);
    } else warnings.push('The floor is too small for drainage holes.');
  }
  if (p.type === 'lampshade' && s.inner.length) {
    const d = p.bulbHole;
    if (d / 2 > floorR - 3) warnings.push(`The top is too narrow for a ${d} mm lamp-holder hole; it was left closed.`);
    else holes.push([0, 0, d / 2]);
  }
  if (holes.length) {
    const body = meshDataToManifold(k, mesh);
    let cut = body;
    for (const [x, y, r] of holes) {
      const cyl = k.Manifold.cylinder(p.base + 2, r, r, 64).translate([x, y, -1]);
      const next = cut.subtract(cyl);
      cyl.delete();
      if (cut !== body) cut.delete();
      cut = next;
    }
    mesh = manifoldToMeshData(cut);
    if (cut !== body) cut.delete();
    body.delete();
  }

  const parts: VasePart[] = [];
  const add = (id: VasePart['id'], name: string, m: MeshData) => {
    const r = validatePart(m);
    const b = r.bounds;
    parts.push({
      id,
      name,
      mesh: m,
      size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
      volume: r.volume,
      watertight: r.watertight,
    });
  };
  add('body', p.type === 'pot' ? 'Pot' : p.type === 'lampshade' ? 'Lampshade' : 'Vase', mesh);

  if (p.type === 'pot' && p.saucer) {
    const foot: [number, number][] = [];
    const M = s.around;
    for (let j = 0; j < M; j++) {
      const a = (2 * Math.PI * j) / M;
      foot.push([s.outer[0][j] * Math.cos(a), s.outer[0][j] * Math.sin(a)]);
    }
    const fp = new k.CrossSection([foot], 'Positive');
    const inside = fp.offset(1.5, 'Round', 2, 64);
    const outside = inside.offset(2, 'Round', 2, 64);
    const hgt = Math.min(18, Math.max(10, p.height * 0.1));
    const shell = k.Manifold.extrude(outside, hgt);
    const cavity = k.Manifold.extrude(inside, hgt).translate([0, 0, 2]);
    const saucer = shell.subtract(cavity);
    const b = saucer.boundingBox();
    const placed = saucer.translate([s.outer[0].reduce((m, v) => Math.max(m, v), 0) + (b.max[0] - b.min[0]) / 2 + 12, 0, 0]);
    add('saucer', 'Saucer', manifoldToMeshData(placed));
    [fp, inside, outside, shell, cavity, saucer, placed].forEach((x) => x.delete());
  }

  // Measurements and checks.
  let width = 0;
  for (const ring of s.outer)
    for (let j = 0; j < ring.length / 2; j++) width = Math.max(width, ring[j] + ring[(j + ring.length / 2) % ring.length]);
  let capacity = 0;
  if (s.inner.length) {
    for (let i = 0; i < s.inner.length - 1; i++)
      capacity += ((ringArea(s.inner[i]) + ringArea(s.inner[i + 1])) / 2) * (s.zi[i + 1] - s.zi[i]);
  } else {
    // Vase mode: the slicer prints one line (~0.45 mm) around the outside; the bottom is a few layers.
    for (let i = 0; i < s.outer.length - 1; i++) {
      if (s.zs[i] < 1) continue;
      capacity += ((ringArea(s.outer[i], 0.45) + ringArea(s.outer[i + 1], 0.45)) / 2) * (s.zs[i + 1] - s.zs[i]);
    }
  }
  let maxOverhang = 0;
  const step = Math.max(1, Math.floor(s.around / 72));
  for (let i = 0; i < s.outer.length - 1; i++) {
    const dz = s.zs[i + 1] - s.zs[i];
    for (let j = 0; j < s.around; j += step) {
      const dr = s.outer[i + 1][j] - s.outer[i][j];
      if (dr > 0) maxOverhang = Math.max(maxOverhang, (Math.atan2(dr, dz) * 180) / Math.PI);
    }
  }
  if (maxOverhang > 60)
    warnings.push(
      `Parts of the outside lean out ${Math.round(maxOverhang)}° from vertical and will droop. Reduce the flare or the pattern depth.`,
    );
  else if (maxOverhang > 45)
    notes.push(`The steepest outward lean is ${Math.round(maxOverhang)}°: fine on most printers, slow down the outer wall if it curls.`);
  const baseWidth = (s.outer[0].reduce((m, v) => m + v, 0) / s.outer[0].length) * 2;
  if (p.height > baseWidth * 3.5) warnings.push('Tall and narrow: it may tip over. Widen the base or add weight inside.');
  if (s.inner.length) {
    if (p.wall < 0.8) warnings.push('Walls thinner than 0.8 mm may not print solidly.');
    const neck = Math.min(...s.inner.map((r) => Math.min(...r)));
    if (neck < 3) warnings.push('The opening is narrower than 6 mm somewhere: it may be closed off or hard to clean.');
  } else {
    notes.push(
      'Vase mode: turn on "Spiral vase" in Bambu Studio, OrcaSlicer or PrusaSlicer ("Spiralize outer contour" in Cura). The slicer prints one continuous wall and a solid bottom.',
    );
  }
  if (p.type === 'lampshade') notes.push('Printed with the top on the bed. Use an LED bulb only: printed plastics soften near hot bulbs.');
  for (const part of parts) if (!part.watertight) warnings.push(`${part.name} is not a closed solid; adjust the shape or pattern.`);
  return { parts, width, height: p.height, capacity: capacity / 1000, maxOverhang, warnings, notes };
}
