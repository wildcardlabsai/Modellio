import type { ImportIssue } from '../model/types';

export type Vec3 = [number, number, number];

/** Indexed triangle mesh in millimetres. */
export interface PartMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/** A surface added to close a part where it met another colour (or an opening in the source). */
export interface CapRecord {
  /** Same key on both parts of an exact joint. */
  loopKey: string;
  /** Range of the cap's triangles inside the part's index buffer. */
  firstTriangle: number;
  triangleCount: number;
  area: number;
  centroid: Vec3;
  /** Unit normal pointing out of this part. */
  normal: Vec3;
  /** Largest distance of the boundary from the cap's best-fit plane (mm). */
  deviation: number;
  /** "planar" for a flat triangulation of the boundary, "fan" for the fallback around the centroid. */
  method: 'planar' | 'fan';
  /** Boundary vertices (x, y, z …) in a canonical order shared by both sides of the joint. */
  outline: Float32Array;
  /** The part on the other side, when exactly one other part shares this boundary. */
  neighbourPartId: string | null;
}

export interface PartReport {
  watertight: boolean;
  boundaryEdges: number;
  nonManifoldEdges: number;
  /** mm³; positive when the surface faces outwards. */
  volume: number;
  /** Surface area of the original (coloured) surface, mm². */
  surfaceArea: number;
  shells: number;
  bounds: { min: Vec3; max: Vec3 };
  /** Edges that were already open in the source model and were closed by a cap. */
  sourceOpenEdges: number;
  warnings: string[];
}

export interface SplitPart {
  partId: string;
  name: string;
  materialId: number;
  colour: string;
  materialName: string;
  instanceIds: string[];
  objectIds: number[];
  /** Assembly (world) coordinates. */
  mesh: PartMesh;
  surfaceTriangles: number;
  caps: CapRecord[];
  report: PartReport;
}

/** Two parts that touch along a shared, identically capped boundary. */
export interface Joint {
  jointId: string;
  partA: string;
  partB: string;
  capA: number;
  capB: number;
  area: number;
  centroid: Vec3;
  /** Unit normal pointing out of part A (into part B). */
  normal: Vec3;
  deviation: number;
  /** "inlay": part A was given depth as a plug in a pocket of part B (no connectors needed). */
  kind: 'surface' | 'inlay';
}

export interface SplitOptions {
  /** One part per connected piece (otherwise one part per colour per object). */
  separateIslands: boolean;
  /** Keep each placed object's parts separate (otherwise merge equal colours across objects). */
  keepObjectsSeparate: boolean;
  /** Subdivide fine (sub-triangle) slicer paint exactly. */
  exactPaint: boolean;
  /**
   * Inlay depth (mm) for thin colour regions (e.g. paint on a flat face, which has no thickness of its own):
   * the region becomes a plug of this depth and the part behind it gets a matching pocket. 0 = off.
   */
  inlayDepth: number;
}

export const DEFAULT_SPLIT_OPTIONS: SplitOptions = { separateIslands: true, keepObjectsSeparate: true, exactPaint: true, inlayDepth: 1 };

export interface SplitResult {
  parts: SplitPart[];
  joints: Joint[];
  issues: ImportIssue[];
  stats: { parts: number; joints: number; triangles: number; paintedSubTriangles: number; ms: number };
}
