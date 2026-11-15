import type * as Replicad from 'replicad';
import type { Sketch, SketchEntity } from '@/cad/sketch/types';
import { pointMap, segmentOf, sketchOutlines, solidEdges, type Segment } from '@/cad/sketch/outline';
import type { Vec3 } from '@/types/document';
import type { BrepBuild, BrepEdge, BrepFace, BrepRequest, EdgeRef, FaceRef, FeatureBase, FeatureOp, HolePattern, HoleSpec } from './types';

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
/** Two candidates closer than this to each other's score are "equally good": refuse, don't guess. */
const AMBIGUITY = MATCH_TOLERANCE / 4;
const FACE_TOLERANCE = 0.05;

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

export { sketchOutlines };

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

/** One closed outline (no holes), as a drawing: what loft sections and sweep profiles need. */
export function singleOutline(r: R, s: Sketch, what: string): Drawing {
  const { chains, circles } = sketchOutlines(s);
  const n = chains.length + circles.length;
  if (n === 0) throw new BrepError(`${what} has no closed outline.`);
  if (n > 1) throw new BrepError(`${what} must be a single closed outline (it has ${n}).`);
  return sketchDrawing(r, s)!;
}

/**
 * A sweep path: one connected chain of lines and arcs (open or closed), or a single circle.
 * Returns an error message when the sketch is not one chain.
 */
export function sketchPath(s: Sketch): { segments: Segment[]; closed: boolean } | { circle: { c: [number, number]; r: number } } | string {
  const pts = pointMap(s);
  const edges = solidEdges(s);
  const circles = s.entities.filter((e): e is Extract<SketchEntity, { kind: 'circle' }> => e.kind === 'circle' && !e.construction);
  if (!edges.length && circles.length === 1 && pts.has(circles[0].c)) return { circle: { c: pts.get(circles[0].c)!, r: circles[0].r } };
  if (circles.length) return 'A path is one chain of lines and arcs (or a single circle).';
  if (!edges.length) return 'Draw a path: connected lines and arcs.';
  const degree = new Map<string, number>();
  for (const e of edges) for (const id of [e.a, e.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
  if ([...degree.values()].some((d) => d > 2)) return 'The path branches; it must be a single chain.';
  const ends = [...degree].filter(([, d]) => d === 1).map(([id]) => id);
  if (ends.length !== 0 && ends.length !== 2) return 'The path must be one connected chain.';
  const closed = ends.length === 0;
  let from = closed ? edges[0].a : ends[0];
  const used = new Set<string>();
  const segments: Segment[] = [];
  for (let guard = 0; guard < edges.length; guard++) {
    const e = edges.find((x) => !used.has(x.id) && (x.a === from || x.b === from));
    if (!e) break;
    used.add(e.id);
    const to = e.a === from ? e.b : e.a;
    segments.push(segmentOf(pts, e, from));
    from = to;
  }
  if (used.size !== edges.length) return 'The path must be one connected chain.';
  return { segments, closed };
}

function loftBase(r: R, base: Extract<FeatureBase, { kind: 'loft' }>): Shape3D {
  if (base.sections.length < 2) throw new BrepError('A loft needs at least two sections.');
  const sketches = base.sections.map((sec, i) =>
    asSketch(
      singleOutline(r, sec.sketch, `Section ${i + 1}`)
        .translate(sec.offset[0], sec.offset[1])
        .sketchOnPlane('XY', [0, 0, sec.height]),
    ),
  );
  for (let i = 1; i < base.sections.length; i++)
    if (Math.abs(base.sections[i].height - base.sections[i - 1].height) < 1e-6)
      throw new BrepError(`Sections ${i} and ${i + 1} are at the same height.`);
  return as3d(sketches[0].loftWith(sketches.slice(1), { ruled: base.ruled }));
}

function sweepBase(r: R, base: Extract<FeatureBase, { kind: 'sweep' }>): Shape3D {
  const path = sketchPath(base.path);
  if (typeof path === 'string') throw new BrepError(path);
  singleOutline(r, base.profile, 'The profile'); // validates before the (slower) sweep
  let pathDrawing: Drawing;
  if ('circle' in path) pathDrawing = r.drawCircle(path.circle.r).translate(path.circle.c[0], path.circle.c[1]);
  else {
    let pen = r.draw(path.segments[0].from);
    for (const seg of path.segments) pen = seg.kind === 'line' ? pen.lineTo(seg.to) : pen.threePointsArcTo(seg.to, seg.mid);
    pathDrawing = path.closed ? pen.close() : pen.done();
  }
  const pathSketch = asSketch(pathDrawing.sketchOnPlane(base.pathPlane));
  return as3d(
    // The plane replicad passes is already placed at the start of the path, square to it.
    pathSketch.sweepSketch((plane) => asSketch(singleOutline(r, base.profile, 'The profile').sketchOnPlane(plane)), {
      frenet: base.orientation === 'frenet',
      transitionMode: base.corners === 'round' ? 'round' : 'right',
    }),
  );
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
function describeEdge(e: Replicad.Edge, centre: V, half: V, faces?: [V, V]): EdgeInfo {
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
    // A circle is fixed by centre, axis and radius; face normals vary along it (and between the two
    // halves OpenCascade splits it into), so they are not part of its reference.
    return { ref: tidy({ kind, mid: scaleN(centreC), dir: canon(norm(axis)), radius: radius / meanHalf }), points };
  }
  const t = v(e.tangentAt(0.5));
  return {
    ref: tidy({ kind, mid: scaleN(at(0.5)), dir: canon(norm([t[0] / half[0], t[1] / half[1], t[2] / half[2]])), radius: 0, faces }),
    points,
  };
}

/** Rounded so the two halves of a circle (and repeated builds) give identical references. */
const q9 = (x: number) => Math.round(x * 1e9) / 1e9 + 0; // + 0 turns −0 into 0
const tidy = (ref: EdgeRef): EdgeRef => {
  const out: EdgeRef = { kind: ref.kind, mid: ref.mid.map(q9) as Vec3, dir: ref.dir.map(q9) as Vec3, radius: q9(ref.radius) };
  if (ref.faces) out.faces = ref.faces.map((n) => n.map(q9)) as [Vec3, Vec3];
  return out;
};

/** A surface normal in the normalised space of `mid` (normals scale by the inverse, i.e. by `half`). */
const scaleNormal = (n: V, half: V): V => norm([n[0] * half[0], n[1] * half[1], n[2] * half[2]]);
/** The two face normals in a fixed order, so a reference does not depend on face order. */
const sortPair = (a: V, b: V): [V, V] => ((a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) <= 0 ? [a, b] : [b, a]);

const FACE_KIND: Record<string, FaceRef['kind']> = {
  PLANE: 'plane',
  CYLINDRE: 'cylinder',
  CONE: 'cone',
  SPHERE: 'sphere',
  TORUS: 'torus',
};

/** Reference of one face, relative to `centre` and half-extents `half`. */
function describeFace(r: R, f: Replicad.Face, centre: V, half: V): FaceRef {
  const c = sub(v(f.center), centre);
  // A point on the surface itself (the centroid of a curved face may lie off it, e.g. on a cylinder's axis).
  const onSurface = f.pointOnSurface(0.5, 0.5);
  const nv = f.normalAt(onSurface);
  const raw = norm(v(nv));
  nv.delete();
  onSurface.delete();
  // Area in the normalised space: a patch with unit normal m scales by |h ⊙ m| / (hx·hy·hz). Exact
  // for flat faces, a good estimate for curved ones (taken at their representative normal).
  const k = Math.hypot(raw[0] * half[0], raw[1] * half[1], raw[2] * half[2]) / (half[0] * half[1] * half[2]);
  return {
    kind: FACE_KIND[f.geomType] ?? 'other',
    centre: [q9(c[0] / half[0]), q9(c[1] / half[1]), q9(c[2] / half[2])],
    normal: scaleNormal(raw, half).map(q9) as Vec3,
    area: q9(r.measureArea(f) * k),
  };
}

/**
 * The solid's real edges, each with the normals of its two faces, and the references of all its
 * faces (in the order OpenCascade meshes them). Everything OpenCascade allocated is released.
 */
function topology(r: R, shape: Shape3D, centre: V, half: V): { edges: EdgeInfo[]; faces: FaceRef[]; faceHashes: number[] } {
  const faceList = shape.faces;
  const byEdge = new Map<number, number[]>();
  faceList.forEach((f, fi) => {
    for (const e of f.edges) {
      const list = byEdge.get(e.hashCode) ?? [];
      if (!list.includes(fi)) list.push(fi);
      byEdge.set(e.hashCode, list);
      e.delete();
    }
  });
  const edges: EdgeInfo[] = [];
  for (const e of shape.edges) {
    const owners = byEdge.get(e.hashCode) ?? [];
    // Seam edges (where a curved face meets itself) belong to one face: not edges of the part.
    if (owners.length >= 2) {
      const p = e.pointAt(0.5);
      const normals = owners.slice(0, 2).map((fi) => {
        const nv = faceList[fi].normalAt(p);
        const out = scaleNormal(v(nv), half);
        nv.delete();
        return out;
      });
      p.delete();
      edges.push(describeEdge(e, centre, half, sortPair(normals[0], normals[1])));
    }
    e.delete();
  }
  const faces = faceList.map((f) => describeFace(r, f, centre, half));
  const faceHashes = faceList.map((f) => f.hashCode);
  faceList.forEach((f) => f.delete());
  return { edges, faces, faceHashes };
}

/** How different two face-normal pairs are (0 = the same), whichever way round they are stored. */
const pairCost = (a: [Vec3, Vec3], b: [Vec3, Vec3]) =>
  Math.min(2 - dot(a[0], b[0]) - dot(a[1], b[1]), 2 - dot(a[0], b[1]) - dot(a[1], b[0])) / 2;

const distance = (a: EdgeRef, b: EdgeRef) =>
  a.kind !== b.kind
    ? Infinity
    : Math.hypot(...sub(a.mid, b.mid)) +
      0.5 * (1 - Math.abs(dot(a.dir, b.dir))) +
      Math.abs(a.radius - b.radius) +
      (a.faces && b.faces ? 0.25 * pairCost(a.faces, b.faces) : 0);

const faceDistance = (a: FaceRef, b: FaceRef) =>
  a.kind !== b.kind
    ? Infinity
    : Math.hypot(...sub(a.centre, b.centre)) +
      0.5 * (1 - dot(a.normal, b.normal)) +
      (0.5 * Math.abs(a.area - b.area)) / Math.max(a.area, b.area, EPS);

/** Not found, or more than one candidate fits equally well. */
export const NO_MATCH = -1;
export const AMBIGUOUS = -2;

/**
 * For each reference, the index of the closest candidate within `tolerance`. Returns NO_MATCH when
 * nothing is close enough and AMBIGUOUS when a different candidate is (almost) as close: the
 * caller then flags the operation instead of guessing. Candidates with identical references (the
 * two halves OpenCascade splits a full circle into) count as one.
 */
function match<T>(refs: T[], cands: T[], dist: (a: T, b: T) => number, tolerance: number): number[] {
  return refs.map((ref) => {
    let best = NO_MATCH;
    let bestD = tolerance;
    cands.forEach((c, i) => {
      const d = dist(ref, c);
      if (d < bestD) [best, bestD] = [i, d];
    });
    if (best < 0) return NO_MATCH;
    for (let i = 0; i < cands.length; i++) {
      if (i === best || dist(cands[best], cands[i]) < 1e-9) continue;
      const d = dist(ref, cands[i]);
      if (d < tolerance && d - bestD < AMBIGUITY) return AMBIGUOUS;
    }
    return best;
  });
}

export const matchEdges = (refs: EdgeRef[], edges: EdgeRef[]) => match(refs, edges, distance, MATCH_TOLERANCE);
export const matchFaces = (refs: FaceRef[], faces: FaceRef[]) => match(refs, faces, faceDistance, FACE_TOLERANCE);

const friendly = (e: unknown, what: string) => {
  if (e instanceof BrepError) return e.message;
  const msg = e instanceof Error ? e.message : '';
  return msg && !/WebAssembly|object Object/.test(msg)
    ? `${what}: ${msg}`
    : `${what} could not be made on these edges. Try a smaller size.`;
};

// --- operations ---------------------------------------------------------------------------------
const OP_LABEL: Record<FeatureOp['kind'], string> = {
  fillet: 'This fillet',
  chamfer: 'This chamfer',
  shell: 'This shell',
  draft: 'This draft',
  hole: 'This hole',
};

/** Record why references could not be used (and say so); false when they were all found. */
function refusal(hit: number[], what: 'edges' | 'faces', id: string, problems: BrepBuild['problems']): boolean {
  if (hit.some((i) => i === NO_MATCH)) {
    problems.push({
      id,
      reason: what === 'edges' ? 'missing-edges' : 'missing-faces',
      message: `Some of its ${what} no longer exist after an earlier change.`,
    });
    return true;
  }
  if (hit.some((i) => i === AMBIGUOUS)) {
    problems.push({
      id,
      reason: what === 'edges' ? 'ambiguous-edges' : 'ambiguous-faces',
      message: `After an earlier change, more than one of the part's ${what} fits equally well, so none was chosen.`,
    });
    return true;
  }
  return false;
}

/** The profile of a hole (radius against depth, the surface at 0), revolved about +Z. */
function holeTool(r: R, h: HoleSpec, through: number): Shape3D {
  const rad = h.diameter / 2;
  const depth = h.depth > 0 ? h.depth : through;
  const lift = 0.01; // start just above the surface so the cut never leaves a skin
  const pts: [number, number][] = [[0, lift]];
  if (h.style === 'counterbore' && h.cbDiameter && h.cbDepth) {
    const cb = h.cbDiameter / 2;
    pts.push([cb, lift], [cb, -h.cbDepth], [rad, -h.cbDepth]);
  } else if (h.style === 'countersink' && h.csDiameter && h.csAngle) {
    const cs = h.csDiameter / 2;
    const sink = (cs - rad) / Math.tan(((h.csAngle / 2) * Math.PI) / 180);
    pts.push([cs, lift], [cs, 0], [rad, -sink]);
  } else pts.push([rad, lift]);
  pts.push([rad, -depth], [0, -depth]);
  let pen = r.draw(pts[0]);
  for (const p of pts.slice(1)) pen = pen.lineTo(p);
  return as3d(pen.close().sketchOnPlane('XZ').revolve([0, 0, 1]));
}

/** Turn a tool built along +Z so +Z points along `n`, then move it to `p`. */
function orient(tool: Shape3D, n: V, p: V): Shape3D {
  const c = n[2];
  let t = tool;
  if (c < -0.999999) t = t.rotate(180, [0, 0, 0], [1, 0, 0]);
  else if (c < 0.999999) t = t.rotate((Math.acos(c) * 180) / Math.PI, [0, 0, 0], norm(cross([0, 0, 1], n)));
  return t.translate(p);
}

/** Rotate point p about the axis through `o` along unit `k` by `deg` degrees (Rodrigues). */
function rotateAbout(p: V, o: V, k: V, deg: number): V {
  const a = (deg * Math.PI) / 180;
  const v0 = sub(p, o);
  const kv = cross(k, v0);
  const kd = dot(k, v0);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [0, 1, 2].map((i) => o[i] + v0[i] * c + kv[i] * s + k[i] * kd * (1 - c)) as V;
}

/** Where each copy of a hole goes (base coordinates). */
export function holePositions(p: V, n: V, pattern: HolePattern | undefined, centre: V, half: V): V[] {
  if (!pattern || pattern.count <= 1) return [p];
  const out: V[] = [];
  if (pattern.kind === 'linear') {
    const d = norm(pattern.dir as V);
    for (let i = 0; i < pattern.count; i++)
      out.push([p[0] + d[0] * pattern.spacing * i, p[1] + d[1] * pattern.spacing * i, p[2] + d[2] * pattern.spacing * i]);
  } else {
    const o: V = [
      centre[0] + pattern.centre[0] * half[0],
      centre[1] + pattern.centre[1] * half[1],
      centre[2] + pattern.centre[2] * half[2],
    ];
    // A full turn spaces copies evenly without doubling the first; a part turn includes both ends.
    const full = Math.abs(Math.abs(pattern.angle) - 360) < 1e-6;
    const step = pattern.angle / (full ? pattern.count : Math.max(1, pattern.count - 1));
    for (let i = 0; i < pattern.count; i++) out.push(rotateAbout(p, o, n, step * i));
  }
  return out;
}

/** Cut a hole (and its pattern copies) into the shape at a point of the chosen face. */
function cutHole(r: R, shape: Shape3D, op: Extract<FeatureOp, { kind: 'hole' }>, face: FaceRef, centre: V, half: V, diag: number): Shape3D {
  if (face.kind !== 'plane') throw new BrepError('Holes go into flat faces.');
  const p: V = [centre[0] + op.at[0] * half[0], centre[1] + op.at[1] * half[1], centre[2] + op.at[2] * half[2]];
  // The face's real outward normal (the reference's is in normalised space).
  const n = norm([face.normal[0] / half[0], face.normal[1] / half[1], face.normal[2] / half[2]]);
  let tools: Shape3D | null = null;
  for (const at of holePositions(p, n, op.pattern, centre, half)) {
    const one = orient(holeTool(r, op.hole, diag * 2 + 1), n, at);
    tools = tools ? (tools.fuse(one) as Shape3D) : one;
  }
  return shape.clone().cut(tools!) as Shape3D;
}

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
          : recipe.base.kind === 'loft'
            ? loftBase(r, recipe.base)
            : recipe.base.kind === 'sweep'
              ? sweepBase(r, recipe.base)
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

  const zMin = bb0.bounds[0][2];
  const diag = Math.hypot(bb0.width, bb0.height, bb0.depth);

  for (const op of recipe.ops) {
    if (op.suppressed) continue;
    const label = OP_LABEL[op.kind];
    try {
      let next: Shape3D | null = null;
      if (op.kind === 'fillet' || op.kind === 'chamfer') {
        const infos = topology(r, shape, centre, half).edges;
        const hit = matchEdges(
          op.edges,
          infos.map((i) => i.ref),
        );
        if (refusal(hit, 'edges', op.id, problems)) continue;
        const chosen = hit.map((i) => infos[i].ref);
        const pick = (f: Replicad.EdgeFinder) =>
          f.when(({ element }) => {
            const ref = describeEdge(element, centre, half).ref;
            return chosen.some((c) => distance(c, ref) < 1e-6);
          });
        next = op.kind === 'fillet' ? shape.clone().fillet(op.radius, pick) : shape.clone().chamfer(op.distance, pick);
      } else {
        const faces = topology(r, shape, centre, half).faces;
        const refs = op.kind === 'hole' ? [op.face] : op.faces;
        const hit = matchFaces(refs, faces);
        if (refusal(hit, 'faces', op.id, problems)) continue;
        const chosen = hit.map((i) => faces[i]);
        const pick = (f: Replicad.FaceFinder) =>
          f.when(({ element }) => {
            const ref = describeFace(r, element, centre, half);
            return chosen.some((c) => faceDistance(c, ref) < 1e-6);
          });
        if (op.kind === 'shell') {
          if (op.thickness >= Math.min(...half)) throw new BrepError('These walls are too thick for this part.');
          next = shape.clone().shell(op.thickness, pick); // positive: walls grow inwards
          // OpenCascade can return a malformed result instead of failing: an inward shell must stay
          // inside the part and take material away.
          const nb = next.boundingBox;
          const grew = [0, 1, 2].some(
            (k) => nb.bounds[0][k] < shape.boundingBox.bounds[0][k] - 1e-4 || nb.bounds[1][k] > shape.boundingBox.bounds[1][k] + 1e-4,
          );
          if (grew || r.measureVolume(next) >= r.measureVolume(shape) - EPS) {
            next.delete();
            throw new BrepError('These walls are too thick for this part.');
          }
        } else if (op.kind === 'draft') next = shape.clone().draft(op.angle, pick, r.makePlane('XY', zMin));
        else next = cutHole(r, shape, op, chosen[0], centre, half, diag);
      }
      if (next) {
        // A failed boolean or offset can quietly give an empty result: never accept one.
        if (!next.solids?.length || r.measureVolume(next) <= EPS) {
          next.delete();
          problems.push({ id: op.id, reason: 'failed', message: `${label} would leave no solid. Try a smaller size.` });
          continue;
        }
        shape.delete();
        shape = next;
      }
    } catch (e) {
      problems.push({ id: op.id, reason: 'failed', message: friendly(e, label) });
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
    const topo = topology(r, shape, centre, half);
    const edges: BrepEdge[] = topo.edges;
    // OpenCascade meshes face by face; each group names its face by hash code.
    const faces: BrepFace[] = [];
    for (const g of mesh.faceGroups) {
      const fi = topo.faceHashes.indexOf(g.faceId);
      if (fi >= 0) faces.push({ ref: topo.faces[fi], start: g.start / 3, count: g.count / 3 });
    }
    return {
      positions,
      indices: Uint32Array.from(mesh.triangles),
      edges,
      faces,
      volume: r.measureVolume(shape),
      size,
      centre: [...centre] as Vec3,
      half: [...half] as Vec3,
      problems,
    };
  } finally {
    shape.delete();
  }
}
