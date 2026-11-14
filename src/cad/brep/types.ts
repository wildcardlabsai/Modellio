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
  | { kind: 'sketch'; sketch: Sketch; op: 'extrude' | 'revolve'; depth: number; angle: number };

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
}

export type FeatureOp =
  | { id: string; kind: 'fillet'; edges: EdgeRef[]; radius: number; suppressed?: boolean }
  | { id: string; kind: 'chamfer'; edges: EdgeRef[]; distance: number; suppressed?: boolean };

export interface FeatureRecipe {
  base: FeatureBase;
  ops: FeatureOp[];
}

/** One edge of a built solid, for display and picking (object-local mm, centred like the mesh). */
export interface BrepEdge {
  ref: EdgeRef;
  /** Polyline x,y,z,x,y,z… */
  points: number[];
}

export interface BrepBuild {
  positions: Float32Array;
  indices: Uint32Array;
  edges: BrepEdge[];
  volume: number;
  /** Size of the solid in mm (X, Y, Z). */
  size: Vec3;
  /**
   * Operations that were skipped: their edges could not be found after an edit (never guessed),
   * or OpenCascade could not make them (e.g. a radius larger than the faces next to the edge).
   */
  problems: { id: string; reason: 'missing-edges' | 'failed'; message: string }[];
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
  return (e.kind === 'line' || e.kind === 'circle' || e.kind === 'curve') && vec3(e.mid) && vec3(e.dir) && finite(e.radius);
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
  } else return 'Unknown feature base.';
  if (!Array.isArray(ops)) return 'Feature operations missing.';
  for (const op of ops) {
    if (typeof op !== 'object' || op === null || typeof op.id !== 'string') return 'Invalid operation.';
    if (op.kind === 'fillet') {
      if (!finite(op.radius) || op.radius <= 0) return 'Fillet radius must be positive.';
    } else if (op.kind === 'chamfer') {
      if (!finite(op.distance) || op.distance <= 0) return 'Chamfer distance must be positive.';
    } else return 'Unknown operation.';
    if (!Array.isArray(op.edges) || !op.edges.length || !op.edges.every(validEdgeRef)) return 'Operation has no valid edges.';
  }
  return null;
}

/** A stable cache key for a build request. */
export const requestKey = (r: BrepRequest) => JSON.stringify([r.recipe, r.size.map((v) => Math.round(v * 1e4) / 1e4)]);
