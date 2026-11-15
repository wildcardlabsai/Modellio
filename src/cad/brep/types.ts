import type { Sketch } from '@/cad/sketch/types';
import type { Vec3 } from '@/types/document';

/**
 * Feature recipes for precise solids (`solid` shapes). The document stores only the recipe; the
 * OpenCascade worker rebuilds the exact solid from it and returns a mesh plus its edges.
 * Pure data, no OpenCascade imports: usable on the main thread, in tests and in the worker.
 */

/** Primitives with an exact OpenCascade equivalent. */
export const SOLID_PRIMITIVES = ['box', 'cylinder', 'cone', 'sphere', 'torus', 'wedge', 'tube'] as const;
export type SolidPrimitive = (typeof SOLID_PRIMITIVES)[number];

export type FeatureBase =
  | {
      kind: 'primitive';
      shape: SolidPrimitive;
      /** Extra primitive parameters: box `radius` / `chamfer` (all edges), cone `topRatio`, tube `wall`. */
      params: Record<string, number>;
    }
  | { kind: 'sketch'; sketch: Sketch; op: 'extrude' | 'revolve'; depth: number; angle: number }
  /**
   * An exact solid stored as it is (OpenCascade BRep text), e.g. one solid from a STEP file. Its
   * shape has no parametric history; it can be moved, filleted and chamfered.
   */
  | { kind: 'brep'; data: string; source: string }
  /**
   * A solid through cross-sections: each section is a sketch (one closed outline) lying flat at a
   * height (mm) above the first, optionally shifted in X/Y. Smooth or ruled (straight) between them.
   */
  | { kind: 'loft'; sections: LoftSection[]; ruled: boolean }
  /**
   * A closed profile moved along a path. The path is a sketch (one connected chain of lines and arcs,
   * open or closed) drawn on the XZ plane (upright) or the XY plane (flat). The profile is placed
   * square to the start of the path.
   */
  | { kind: 'sweep'; profile: Sketch; path: Sketch; pathPlane: 'XZ' | 'XY'; orientation: 'follow' | 'frenet'; corners: 'round' | 'sharp' };

export interface LoftSection {
  sketch: Sketch;
  height: number;
  offset: [number, number];
}

/**
 * Where an edge is, independent of the solid's size: the edge's kind, its midpoint and direction
 * divided by the base's half-extents, and (for circles) its radius divided by the mean half-extent.
 * Used to find "the same edge" again after an edit.
 */
export interface EdgeRef {
  kind: 'line' | 'circle' | 'curve';
  mid: Vec3;
  dir: Vec3;
  radius: number;
  /**
   * Outward normals of the two faces that meet at the edge, at its midpoint (in the same
   * normalised space as `mid`). They tell apart edges that sit close together, e.g. the inner and
   * outer rim of a thin wall. Absent in references saved before MODELLIO 2.3.
   */
  faces?: [Vec3, Vec3];
}

/**
 * A face of a solid, described so it can be found again after the part changes (the same idea as
 * `EdgeRef`): surface kind, centre and outward normal relative to the base's bounding box
 * (normalised by its half-extents), and area relative to the mean half-extent squared.
 */
export interface FaceRef {
  kind: 'plane' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'other';
  centre: Vec3;
  normal: Vec3;
  area: number;
}

/** What a hole looks like, in mm. A depth of 0 goes right through the part. */
export interface HoleSpec {
  style: 'simple' | 'counterbore' | 'countersink';
  diameter: number;
  depth: number;
  /** Counterbore: the wider recess at the top. */
  cbDiameter?: number;
  cbDepth?: number;
  /** Countersink: the cone at the top (its diameter at the surface and its included angle in degrees). */
  csDiameter?: number;
  csAngle?: number;
}

/**
 * Copies of a hole: in a row (count, spacing in mm, direction in the part's own axes), or round
 * a centre (count over a total angle, about the face normal through `centre`, normalised like
 * `FaceRef.centre`).
 */
export type HolePattern =
  | { kind: 'linear'; count: number; spacing: number; dir: Vec3 }
  | { kind: 'circular'; count: number; angle: number; centre: Vec3 };

export type FeatureOp =
  | { id: string; kind: 'fillet'; edges: EdgeRef[]; radius: number; suppressed?: boolean }
  | { id: string; kind: 'chamfer'; edges: EdgeRef[]; distance: number; suppressed?: boolean }
  /** Hollow the solid inwards, leaving walls of `thickness` mm, with the chosen faces removed (left open). */
  | { id: string; kind: 'shell'; thickness: number; faces: FaceRef[]; suppressed?: boolean }
  /** Taper the chosen faces by `angle` degrees, inwards going up, from the bottom of the part (+Z is the pull). */
  | { id: string; kind: 'draft'; angle: number; faces: FaceRef[]; suppressed?: boolean }
  /** A hole into `face` at `at` (normalised like `FaceRef.centre`), along the face's inward normal. */
  | { id: string; kind: 'hole'; face: FaceRef; at: Vec3; hole: HoleSpec; pattern?: HolePattern; suppressed?: boolean };

export type FeatureOpKind = FeatureOp['kind'];

export interface FeatureRecipe {
  base: FeatureBase;
  ops: FeatureOp[];
}

/** One face of a built solid: its reference and its triangles in the display mesh (for picking). */
export interface BrepFace {
  ref: FaceRef;
  /** First triangle index (into `indices`, in triangles not indices) and triangle count. */
  start: number;
  count: number;
}

/** One edge of a built solid, for display and picking (object-local mm, centred like the mesh). */
export interface BrepEdge {
  ref: EdgeRef;
  /** Polyline x,y,z,x,y,z… */
  points: number[];
}

export type BrepProblemReason = 'missing-edges' | 'ambiguous-edges' | 'missing-faces' | 'ambiguous-faces' | 'failed';

export interface BrepBuild {
  positions: Float32Array;
  indices: Uint32Array;
  edges: BrepEdge[];
  /** The solid's faces, in mesh order, with their triangles (for face picking). */
  faces: BrepFace[];
  volume: number;
  /** Size of the solid in mm (X, Y, Z). */
  size: Vec3;
  /** Centre of the base's bounding box in its own coordinates (mesh and edges are relative to it). */
  centre: Vec3;
  /** Half-extents of the base's bounding box: references and hole positions are normalised by these. */
  half: Vec3;
  /**
   * Operations that were skipped: their edges could not be found after an edit, or more than one
   * edge fitted equally well (never guessed), or OpenCascade could not make them (e.g. a radius
   * larger than the faces next to the edge).
   */
  problems: { id: string; reason: BrepProblemReason; message: string }[];
}

/** The build request: the recipe at the object's current size. */
export interface BrepRequest {
  recipe: FeatureRecipe;
  size: Vec3;
}

// --- validation ----------------------------------------------------------------------------
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(finite);

function validEdgeRef(r: unknown): r is EdgeRef {
  if (typeof r !== 'object' || r === null) return false;
  const e = r as EdgeRef;
  return (
    (e.kind === 'line' || e.kind === 'circle' || e.kind === 'curve') &&
    vec3(e.mid) &&
    vec3(e.dir) &&
    finite(e.radius) &&
    (e.faces === undefined || (Array.isArray(e.faces) && e.faces.length === 2 && e.faces.every(vec3)))
  );
}

const FACE_KINDS: FaceRef['kind'][] = ['plane', 'cylinder', 'cone', 'sphere', 'torus', 'other'];
export function validFaceRef(r: unknown): r is FaceRef {
  if (typeof r !== 'object' || r === null) return false;
  const f = r as FaceRef;
  return FACE_KINDS.includes(f.kind) && vec3(f.centre) && vec3(f.normal) && finite(f.area) && f.area >= 0;
}

/** Check a recipe read from a file or a share link. Returns an error message, or null when valid. */
export function validateRecipe(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'Feature recipe missing.';
  const { base, ops } = raw as FeatureRecipe;
  if (typeof base !== 'object' || base === null) return 'Feature base missing.';
  if (base.kind === 'primitive') {
    if (!SOLID_PRIMITIVES.includes(base.shape)) return `Unknown solid primitive "${String(base.shape)}".`;
    if (typeof base.params !== 'object' || base.params === null || !Object.values(base.params).every(finite))
      return 'Invalid primitive parameters.';
  } else if (base.kind === 'sketch') {
    if (typeof base.sketch !== 'object' || base.sketch === null || !Array.isArray(base.sketch.points)) return 'Invalid sketch.';
    if (base.op !== 'extrude' && base.op !== 'revolve') return 'Invalid sketch operation.';
    if (!finite(base.depth) || !finite(base.angle)) return 'Invalid sketch depth or angle.';
  } else if (base.kind === 'loft') {
    if (!Array.isArray(base.sections) || base.sections.length < 2) return 'A loft needs at least two sections.';
    for (const sec of base.sections) {
      if (typeof sec !== 'object' || sec === null || typeof sec.sketch !== 'object' || !finite(sec.height)) return 'Invalid loft section.';
      if (!Array.isArray(sec.offset) || sec.offset.length !== 2 || !sec.offset.every(finite)) return 'Invalid loft section offset.';
    }
    if (typeof base.ruled !== 'boolean') return 'Invalid loft option.';
  } else if (base.kind === 'sweep') {
    if (typeof base.profile !== 'object' || base.profile === null || typeof base.path !== 'object' || base.path === null)
      return 'A sweep needs a profile and a path.';
    if (base.pathPlane !== 'XZ' && base.pathPlane !== 'XY') return 'Invalid sweep path plane.';
    if (base.orientation !== 'follow' && base.orientation !== 'frenet') return 'Invalid sweep orientation.';
    if (base.corners !== 'round' && base.corners !== 'sharp') return 'Invalid sweep corners.';
  } else if (base.kind === 'brep') {
    if (typeof base.data !== 'string' || !base.data.length) return 'Stored solid is missing.';
    if (typeof base.source !== 'string') return 'Stored solid has no source.';
  } else return 'Unknown feature base.';
  if (!Array.isArray(ops)) return 'Feature operations missing.';
  for (const op of ops) {
    if (typeof op !== 'object' || op === null || typeof op.id !== 'string') return 'Invalid operation.';
    if (op.kind === 'fillet' || op.kind === 'chamfer') {
      if (op.kind === 'fillet' ? !finite(op.radius) || op.radius <= 0 : !finite(op.distance) || op.distance <= 0)
        return op.kind === 'fillet' ? 'Fillet radius must be positive.' : 'Chamfer distance must be positive.';
      if (!Array.isArray(op.edges) || !op.edges.length || !op.edges.every(validEdgeRef)) return 'Operation has no valid edges.';
    } else if (op.kind === 'shell') {
      if (!finite(op.thickness) || op.thickness <= 0) return 'Shell thickness must be positive.';
      if (!Array.isArray(op.faces) || !op.faces.length || !op.faces.every(validFaceRef)) return 'A shell needs at least one open face.';
    } else if (op.kind === 'draft') {
      if (!finite(op.angle) || op.angle <= 0 || op.angle >= 45) return 'Draft angle must be between 0° and 45°.';
      if (!Array.isArray(op.faces) || !op.faces.length || !op.faces.every(validFaceRef)) return 'A draft needs at least one face.';
    } else if (op.kind === 'hole') {
      if (!validFaceRef(op.face) || !vec3(op.at)) return 'A hole needs a face and a position.';
      const h = op.hole as HoleSpec | undefined;
      if (typeof h !== 'object' || h === null || !['simple', 'counterbore', 'countersink'].includes(h.style)) return 'Invalid hole.';
      if (!finite(h.diameter) || h.diameter <= 0 || !finite(h.depth) || h.depth < 0) return 'Invalid hole size.';
      if (h.style === 'counterbore' && !(finite(h.cbDiameter) && h.cbDiameter > h.diameter && finite(h.cbDepth) && h.cbDepth > 0))
        return 'A counterbore must be wider than the hole and have a depth.';
      if (
        h.style === 'countersink' &&
        !(finite(h.csDiameter) && h.csDiameter > h.diameter && finite(h.csAngle) && h.csAngle > 0 && h.csAngle < 180)
      )
        return 'A countersink must be wider than the hole, with an angle between 0° and 180°.';
      const pt = op.pattern;
      if (pt !== undefined) {
        if (typeof pt !== 'object' || pt === null || !Number.isInteger(pt.count) || pt.count < 1 || pt.count > 100) return 'Invalid hole pattern.';
        if (pt.kind === 'linear' ? !(finite(pt.spacing) && vec3(pt.dir)) : !(pt.kind === 'circular' && finite(pt.angle) && vec3(pt.centre)))
          return 'Invalid hole pattern.';
      }
    } else return 'Unknown operation.';
  }
  return null;
}

// Stored solids can be megabytes of text: key them by a hash (remembered per string).
const hashes = new Map<string, string>();
function hashOf(s: string): string {
  let h = hashes.get(s);
  if (h) return h;
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  h = `#${s.length}:${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
  hashes.set(s, h);
  if (hashes.size > 256) hashes.delete(hashes.keys().next().value!);
  return h;
}
const compact = (_k: string, v: unknown) => (typeof v === 'string' && v.length > 512 ? hashOf(v) : v);

/** A stable, compact key for a feature recipe. */
export const featureKey = (f: FeatureRecipe | undefined) => (f ? JSON.stringify(f, compact) : '');

/** A stable cache key for a build request. */
export const requestKey = (r: BrepRequest) => `${featureKey(r.recipe)}|${r.size.map((v) => Math.round(v * 1e4) / 1e4).join(',')}`;
