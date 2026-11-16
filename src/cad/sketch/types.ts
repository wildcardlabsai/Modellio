/**
 * A 2D sketch: points, the lines/arcs/circles drawn between them, and geometric constraints.
 * Plain JSON so it lives on a shape in the document (undo, save, share all just work).
 * Millimetres, Y up. Lines and arcs share endpoints by id, so connected means coincident.
 */
export interface SketchPoint {
  id: string;
  x: number;
  y: number;
  /** Fixed in place (a "fix" constraint). */
  fixed?: boolean;
}

export type SketchEntity =
  | { id: string; kind: 'line'; a: string; b: string; construction?: boolean }
  /** Arc around centre `c` from `a` to `b`, counter-clockwise. Its radius is |a − c| (and |b − c|). */
  | { id: string; kind: 'arc'; a: string; b: string; c: string; construction?: boolean }
  | { id: string; kind: 'circle'; c: string; r: number; construction?: boolean }
  /**
   * A cubic Bézier segment from anchor `a` to anchor `b`, shaped by handle points `c1` (leaving a)
   * and `c2` (arriving at b). Handles are ordinary sketch points, so they can be dragged and
   * constrained. A spline is a chain of these sharing anchors.
   */
  | { id: string; kind: 'bezier'; a: string; b: string; c1: string; c2: string; construction?: boolean };

export type Constraint =
  | { id: string; kind: 'horizontal' | 'vertical'; line: string }
  /** Length of a line. */
  | { id: string; kind: 'distance'; line: string; value: number }
  /** Radius of a circle or arc. */
  | { id: string; kind: 'radius'; entity: string; value: number }
  | { id: string; kind: 'coincident'; a: string; b: string }
  | { id: string; kind: 'parallel' | 'perpendicular' | 'equal'; l1: string; l2: string }
  /** A point on the X or Y axis value, e.g. to place a profile on the revolve axis. */
  | { id: string; kind: 'pointX' | 'pointY'; point: string; value: number }
  /**
   * Two curves touch without crossing. Line with arc or circle: the line is a tangent (anywhere).
   * Arc or circle with arc or circle: they touch outside (or inside, `inside`). At a shared end
   * point `at` (any pair, Béziers included): their directions there line up.
   */
  | { id: string; kind: 'tangent'; e1: string; e2: string; at?: string; inside?: boolean }
  /** Arcs or circles share a centre. */
  | { id: string; kind: 'concentric'; e1: string; e2: string }
  /** Points `a` and `b` mirror each other across `line`. */
  | { id: string; kind: 'symmetric'; a: string; b: string; line: string }
  /** `point` is the middle of `line`. */
  | { id: string; kind: 'midpoint'; point: string; line: string }
  /** `point` lies on (the infinite extension of) `line`. */
  | { id: string; kind: 'pointOnLine'; point: string; line: string }
  /** `point` lies on an arc's or circle's circle. */
  | { id: string; kind: 'pointOnCurve'; point: string; entity: string }
  /** Angle from `l1` to `l2`, degrees, counter-clockwise. */
  | { id: string; kind: 'angle'; l1: string; l2: string; value: number }
  /** Straight distance between two points (mm). */
  | { id: string; kind: 'pointDistance'; a: string; b: string; value: number }
  /** Distance from a point to a line's extension (mm). */
  | { id: string; kind: 'pointLineDistance'; point: string; line: string; value: number }
  /** A spline is smooth at `point`: its two handles `h1`, `h2` line up through it. */
  | { id: string; kind: 'smooth'; point: string; h1: string; h2: string };

export type ConstraintKind = Constraint['kind'];

export interface Sketch {
  points: SketchPoint[];
  entities: SketchEntity[];
  constraints: Constraint[];
}

export const emptySketch = (): Sketch => ({ points: [], entities: [], constraints: [] });

export type SketchStatus =
  | { kind: 'empty' }
  /** Free to move in `dof` ways. */
  | { kind: 'under'; dof: number }
  | { kind: 'fully' }
  /** Constraints that repeat each other (consistent, but more than needed). `culprits`: their ids. */
  | { kind: 'over'; redundant: number; culprits?: string[] }
  /** Constraints that can't all be met. `culprits`: the ones involved (removing any one helps). */
  | { kind: 'conflicting'; error: number; culprits?: string[] };
