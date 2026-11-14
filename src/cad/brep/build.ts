import type * as Replicad from 'replicad';
import type { Sketch, SketchEntity } from '@/cad/sketch/types';
import type { Vec3 } from '@/types/document';
import type { BrepBuild, BrepEdge, BrepRequest, EdgeRef, FeatureBase } from './types';

/**
 * Recipe → exact OpenCascade solid → mesh, edges and volume. Runs wherever OpenCascade is
 * loaded (the worker in the app, Node in tests). Every OpenCascade object is released here.
 */
type R = typeof Replicad;
type Shape3D = Replicad.Shape3D;
type Drawing = Replicad.Drawing;

export class BrepError extends Error {}

const EPS = 1e-6;
/** Transforms are typed as returning any shape; ours are always solids. */
const as3d = (s: Replicad.AnyShape) => s as Shape3D;
/** A single closed drawing sketches to one Sketch. */
const asSketch = (s: ReturnType<Drawing['sketchOnPlane']>) => s as Replicad.Sketch;
const MATCH_TOLERANCE = 0.02;

// --- bases -----------------------------------------------------------------------------------
function primitive(r: R, base: Extract<FeatureBase, { kind: 'primitive' }>, size: Vec3): Shape3D {
  const [sx, sy, sz] = size.map((v) => Math.max(0.01, v)) as Vec3;
  const p = base.params;
  const round = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(a, b, 1);
  /** A circle or an ellipse with these diameters, centred. */
  const oval = (dx: number, dy: number): Drawing =>
    round(dx, dy) ? r.drawCircle(dx / 2) : dx >= dy ? r.drawEllipse(dx / 2, dy / 2) : r.drawEllipse(dy / 2, dx / 2).rotate(90);
  switch (base.shape) {
    case 'box': {
      let s: Shape3D = as3d(r.makeBaseBox(sx, sy, sz).translate([0, 0, -sz / 2]));
      const radius = Math.min(p.radius ?? 0, Math.min(sx, sy, sz) / 2 - 0.01);
      const chamfer = Math.min(p.chamfer ?? 0, Math.min(sx, sy, sz) / 2 - 0.01);
      if (radius > 0.001) s = s.fillet(radius);
      else if (chamfer > 0.001) s = s.chamfer(chamfer);
      return s;
    }
    case 'cylinder':
      return as3d(
        oval(sx, sy)
          .sketchOnPlane('XY', [0, 0, -sz / 2])
          .extrude(sz),
      );
    case 'tube': {
      const wall = Math.max(0.05, Math.min(p.wall ?? 2, Math.min(sx, sy) / 2 - 0.05));
      return as3d(
        oval(sx, sy)
          .cut(oval(sx - 2 * wall, sy - 2 * wall))
          .sketchOnPlane('XY', [0, 0, -sz / 2])
          .extrude(sz),
      );
    }
    case 'cone': {
      const t = Math.max(0, Math.min(1, p.topRatio ?? 0));
      const bottom = asSketch(oval(sx, sy).sketchOnPlane('XY', [0, 0, -sz / 2]));
      if (t < 0.001) return as3d(bottom.loftWith([], { ruled: true, endPoint: [0, 0, sz / 2] }));
      return as3d(bottom.loftWith(asSketch(oval(sx * t, sy * t).sketchOnPlane('XY', [0, 0, sz / 2])), { ruled: true }));
    }
    case 'sphere':
      return round(sx, sy) && round(sy, sz) ? r.makeSphere(sx / 2) : r.makeEllipsoid(sx / 2, sy / 2, sz / 2);
    case 'torus': {
      const tube = Math.min(sz / 2, Math.max(sx, sy) / 2 - 0.01);
      const ring = Math.max(sx, sy) / 2 - tube;
      return as3d(r.drawCircle(tube).translate(ring, 0).sketchOnPlane('XZ').revolve());
    }
    case 'wedge':
      // Full height at −X, sloping down to +X (as the mesh primitive).
      return as3d(
        r
          .draw([-sx / 2, -sz / 2])
          .lineTo([sx / 2, -sz / 2])
          .lineTo([-sx / 2, sz / 2])
          .close()
          .sketchOnPlane('XZ', [0, sy / 2, 0])
          .extrude(sy),
      );
  }
}

type Segment =
  | { kind: 'line'; from: [number, number]; to: [number, number] }
  | { kind: 'arc'; from: [number, number]; to: [number, number]; mid: [number, number] };

/** Closed outlines of a sketch with exact arcs: chains of lines/arcs, and circles. */
export function sketchOutlines(s: Sketch): { chains: Segment[][]; circles: { c: [number, number]; r: number }[] } {
  const pts = new Map(s.points.map((p) => [p.id, [p.x, p.y] as [number, number]]));
  const edges = s.entities.filter(
    (e): e is Extract<SketchEntity, { kind: 'line' | 'arc' }> => (e.kind === 'line' || e.kind === 'arc') && !e.construction,
  );
  const circles = s.entities
    .filter((e): e is Extract<SketchEntity, { kind: 'circle' }> => e.kind === 'circle' && !e.construction && e.r > 0 && pts.has(e.c))
    .map((e) => ({ c: pts.get(e.c)!, r: e.r }));
  const byPoint = new Map<string, typeof edges>();
  for (const e of edges)
    for (const id of [e.a, e.b]) {
      if (!byPoint.has(id)) byPoint.set(id, []);
      byPoint.get(id)!.push(e);
    }
  const used = new Set<string>();
  const chains: Segment[][] = [];
  for (const start of edges) {
    if (used.has(start.id)) continue;
    const chain: Segment[] = [];
    let e = start;
    let from = start.a;
    let closed = false;
    for (let guard = 0; guard <= edges.length; guard++) {
      used.add(e.id);
      const to = e.a === from ? e.b : e.a;
      const pa = pts.get(from)!;
      const pb = pts.get(to)!;
      if (e.kind === 'arc') {
        // Arcs run a → b counter-clockwise around c.
        const c = pts.get(e.c)!;
        const [ea, eb] = [pts.get(e.a)!, pts.get(e.b)!];
        const a0 = Math.atan2(ea[1] - c[1], ea[0] - c[0]);
        let sweep = Math.atan2(eb[1] - c[1], eb[0] - c[0]) - a0;
        while (sweep <= 0) sweep += 2 * Math.PI;
        const rad = Math.hypot(ea[0] - c[0], ea[1] - c[1]);
        const mid: [number, number] = [c[0] + rad * Math.cos(a0 + sweep / 2), c[1] + rad * Math.sin(a0 + sweep / 2)];
        chain.push({ kind: 'arc', from: pa, to: pb, mid });
      } else chain.push({ kind: 'line', from: pa, to: pb });
      if (to === start.a) {
        closed = true;
        break;
      }
      const next = (byPoint.get(to) ?? []).find((x) => x.id !== e.id && !used.has(x.id));
      if (!next) break;
      from = to;
      e = next;
    }
    if (closed && chain.length >= 2) chains.push(chain);
  }
  return { chains, circles };
}

function polygonOf(chain: Segment[]): [number, number][] {
  const out: [number, number][] = [];
  for (const s of chain) {
    out.push(s.from);
    if (s.kind === 'arc') out.push(s.mid);
  }
  return out;
}
function inside(p: [number, number], poly: [number, number][]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** The sketch's filled region as one drawing (nested outlines alternate solid / hole). */
export function sketchDrawing(r: R, s: Sketch): Drawing | null {
  const { chains, circles } = sketchOutlines(s);
  const items: { drawing: () => Drawing; poly: [number, number][]; probe: [number, number] }[] = [];
  for (const chain of chains) {
    items.push({
      drawing: () => {
        let pen = r.draw(chain[0].from);
        for (const seg of chain) pen = seg.kind === 'line' ? pen.lineTo(seg.to) : pen.threePointsArcTo(seg.to, seg.mid);
        return pen.close();
      },
      poly: polygonOf(chain),
      probe: chain[0].from,
    });
  }
  for (const c of circles) {
    const poly: [number, number][] = Array.from({ length: 48 }, (_, i) => [
      c.c[0] + c.r * Math.cos((i / 48) * 2 * Math.PI),
      c.c[1] + c.r * Math.sin((i / 48) * 2 * Math.PI),
    ]);
    items.push({ drawing: () => r.drawCircle(c.r).translate(c.c[0], c.c[1]), poly, probe: poly[0] });
  }
  if (!items.length) return null;
  const depth = items.map((it, i) => items.filter((o, j) => j !== i && inside(it.probe, o.poly)).length);
  const order = items.map((_, i) => i).sort((a, b) => depth[a] - depth[b]);
  let out: Drawing | null = null;
  for (const i of order) {
    const d = items[i].drawing();
    if (!out) out = d;
    else out = depth[i] % 2 === 0 ? out.fuse(d) : out.cut(d);
  }
  return out;
}

/** A stored exact solid (e.g. from a STEP file). */
function brepBase(r: R, data: string): Shape3D {
  const s = r.deserializeShape(data);
  const solids = (s as Shape3D).solids;
  if (!solids?.length) throw new BrepError('The stored solid is empty.');
  return s as Shape3D;
}

function sketchBase(r: R, base: Extract<FeatureBase, { kind: 'sketch' }>): Shape3D {
  let d = sketchDrawing(r, base.sketch);
  if (!d) throw new BrepError('The sketch has no closed outline.');
  if (base.op === 'extrude') return as3d(d.sketchOnPlane('XY').extrude(Math.max(0.01, base.depth)));
  // Revolve around the sketch's Y axis (as the mesh profile does): keep the part right of the axis.
  const B = 1e5;
  d = d.cut(r.drawRectangle(2 * B, 2 * B).translate(-B, 0));
  return as3d(d.sketchOnPlane('XZ').revolve([0, 0, 1], { angle: Math.max(1, Math.min(360, base.angle)) }));
}

// --- edges -----------------------------------------------------------------------------------
type V = [number, number, number];
const v = (p: { x: number; y: number; z: number }): V => [p.x, p.y, p.z];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V): V => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Canonical direction: the first clearly non-zero component is positive. */
const canon = (a: V): V => {
  const i = a.findIndex((c) => Math.abs(c) > 1e-6);
  return i >= 0 && a[i] < 0 ? [-a[0], -a[1], -a[2]] : a;
};

interface EdgeInfo {
  ref: EdgeRef;
  points: number[];
}

/** Signature and display polyline of one edge, relative to `centre` and half-extents `half`. */
function describeEdge(e: Replicad.Edge, centre: V, half: V): EdgeInfo {
  const type = e.geomType;
  const kind: EdgeRef['kind'] = type === 'LINE' ? 'line' : type === 'CIRCLE' ? 'circle' : 'curve';
  const at = (t: number) => sub(v(e.pointAt(t)), centre);
  const n = kind === 'line' ? 1 : 32;
  const points: number[] = [];
  for (let i = 0; i <= n; i++) points.push(...at(i / n));
  const scaleN = (p: V): V => [p[0] / half[0], p[1] / half[1], p[2] / half[2]];
  const meanHalf = (half[0] + half[1] + half[2]) / 3;
  if (kind === 'circle') {
    // Centre and axis of the circle through three of its points.
    const [a, b, c] = [at(0), at(0.25), at(0.5)];
    const ab = sub(b, a);
    const ac = sub(c, a);
    const axis = cross(ab, ac);
    const d = 2 * dot(axis, axis) || 1;
    const t1 = cross(axis, ab).map((x) => x * dot(ac, ac));
    const t2 = cross(ac, axis).map((x) => x * dot(ab, ab));
    const centreC: V = [a[0] + (t1[0] + t2[0]) / d, a[1] + (t1[1] + t2[1]) / d, a[2] + (t1[2] + t2[2]) / d];
    const radius = Math.hypot(...sub(a, centreC));
    return { ref: tidy({ kind, mid: scaleN(centreC), dir: canon(norm(axis)), radius: radius / meanHalf }), points };
  }
  const t = v(e.tangentAt(0.5));
  return {
    ref: tidy({ kind, mid: scaleN(at(0.5)), dir: canon(norm([t[0] / half[0], t[1] / half[1], t[2] / half[2]])), radius: 0 }),
    points,
  };
}

/** Rounded so the two halves of a circle (and repeated builds) give identical references. */
const tidy = (ref: EdgeRef): EdgeRef => {
  const q = (x: number) => Math.round(x * 1e9) / 1e9 + 0; // + 0 turns −0 into 0
  return { kind: ref.kind, mid: ref.mid.map(q) as Vec3, dir: ref.dir.map(q) as Vec3, radius: q(ref.radius) };
};

/**
 * The solid's real edges. Seam edges (where a curved face meets itself, e.g. the join line of a
 * cylinder's side) belong to a single face: they are not edges of the part and cannot be filleted.
 */
function realEdges(shape: Shape3D): Replicad.Edge[] {
  const faces = new Map<number, Set<number>>();
  shape.faces.forEach((f, fi) => {
    for (const e of f.edges) {
      const h = e.hashCode;
      if (!faces.has(h)) faces.set(h, new Set());
      faces.get(h)!.add(fi);
      e.delete();
    }
    f.delete();
  });
  return shape.edges.filter((e) => {
    const keep = (faces.get(e.hashCode)?.size ?? 0) !== 1;
    if (!keep) e.delete();
    return keep;
  });
}

const distance = (a: EdgeRef, b: EdgeRef) =>
  a.kind !== b.kind ? Infinity : Math.hypot(...sub(a.mid, b.mid)) + 0.5 * (1 - Math.abs(dot(a.dir, b.dir))) + Math.abs(a.radius - b.radius);

/** For each reference, the closest edge of the same kind within tolerance (or −1). */
export function matchEdges(refs: EdgeRef[], edges: EdgeRef[]): number[] {
  return refs.map((ref) => {
    let best = -1;
    let bestD = MATCH_TOLERANCE;
    edges.forEach((e, i) => {
      const d = distance(ref, e);
      if (d < bestD) [best, bestD] = [i, d];
    });
    return best;
  });
}

const friendly = (e: unknown, what: string) => {
  const msg = e instanceof Error ? e.message : '';
  return msg && !/WebAssembly|object Object/.test(msg)
    ? `${what}: ${msg}`
    : `${what} could not be made on these edges. Try a smaller size.`;
};

// --- build -----------------------------------------------------------------------------------
export interface BuildOptions {
  /** Chord tolerance of the display mesh in mm (default: from the size). */
  tolerance?: number;
}

/**
 * The exact solid for a request, with its operations applied, plus the base's bounding-box centre
 * (references and display meshes are relative to it). The caller owns (and must delete) `shape`.
 */
export function buildShape(r: R, req: BrepRequest): { shape: Shape3D; centre: V; half: V; problems: BrepBuild['problems'] } {
  const { recipe } = req;
  let shape: Shape3D;
  try {
    shape =
      recipe.base.kind === 'primitive'
        ? primitive(r, recipe.base, req.size)
        : recipe.base.kind === 'brep'
          ? brepBase(r, recipe.base.data)
          : sketchBase(r, recipe.base);
  } catch (e) {
    if (e instanceof BrepError) throw e;
    throw new BrepError(friendly(e, 'The base shape'));
  }
  // Centre on the base's bounding box: references are relative to it.
  const bb0 = shape.boundingBox;
  const centre: V = [
    (bb0.bounds[0][0] + bb0.bounds[1][0]) / 2,
    (bb0.bounds[0][1] + bb0.bounds[1][1]) / 2,
    (bb0.bounds[0][2] + bb0.bounds[1][2]) / 2,
  ];
  const half: V = [Math.max(EPS, bb0.width / 2), Math.max(EPS, bb0.height / 2), Math.max(EPS, bb0.depth / 2)];
  const problems: BrepBuild['problems'] = [];

  for (const op of recipe.ops) {
    if (op.suppressed) continue;
    const infos = realEdges(shape).map((e) => {
      const info = describeEdge(e, centre, half);
      e.delete();
      return info;
    });
    const hit = matchEdges(
      op.edges,
      infos.map((i) => i.ref),
    );
    if (hit.some((i) => i < 0)) {
      problems.push({ id: op.id, reason: 'missing-edges', message: 'Some of its edges no longer exist after an earlier change.' });
      continue;
    }
    const chosen = hit.map((i) => infos[i].ref);
    const pick = (f: Replicad.EdgeFinder) =>
      f.when(({ element }) => {
        const ref = describeEdge(element, centre, half).ref;
        return chosen.some((c) => distance(c, ref) < 1e-6);
      });
    try {
      const next = op.kind === 'fillet' ? shape.clone().fillet(op.radius, pick) : shape.clone().chamfer(op.distance, pick);
      shape.delete();
      shape = next;
    } catch (e) {
      problems.push({ id: op.id, reason: 'failed', message: friendly(e, op.kind === 'fillet' ? 'This fillet' : 'This chamfer') });
    }
  }

  return { shape, centre, half, problems };
}

export function buildBrep(r: R, req: BrepRequest, opts: BuildOptions = {}): BrepBuild {
  const { shape, centre, half, problems } = buildShape(r, req);
  try {
    const bb = shape.boundingBox;
    const size: Vec3 = [bb.width, bb.height, bb.depth];
    const diag = Math.hypot(...size);
    const mesh = shape.mesh({ tolerance: opts.tolerance ?? Math.max(0.005, diag * 0.0008), angularTolerance: 0.2 });
    const positions = new Float32Array(mesh.vertices.length);
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      positions[i] = mesh.vertices[i] - centre[0];
      positions[i + 1] = mesh.vertices[i + 1] - centre[1];
      positions[i + 2] = mesh.vertices[i + 2] - centre[2];
    }
    const edges: BrepEdge[] = realEdges(shape).map((e) => {
      const info = describeEdge(e, centre, half);
      e.delete();
      return info;
    });
    return {
      positions,
      indices: Uint32Array.from(mesh.triangles),
      edges,
      volume: r.measureVolume(shape),
      size,
      centre: [...centre] as Vec3,
      problems,
    };
  } finally {
    shape.delete();
  }
}
