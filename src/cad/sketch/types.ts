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
  | { id: string; kind: 'circle'; c: string; r: number; construction?: boolean };

export type Constraint =
  | { id: string; kind: 'horizontal' | 'vertical'; line: string }
  /** Length of a line. */
  | { id: string; kind: 'distance'; line: string; value: number }
  /** Radius of a circle or arc. */
  | { id: string; kind: 'radius'; entity: string; value: number }
  | { id: string; kind: 'coincident'; a: string; b: string }
  | { id: string; kind: 'parallel' | 'perpendicular' | 'equal'; l1: string; l2: string }
  /** A point on the X or Y axis value, e.g. to place a profile on the revolve axis. */
  | { id: string; kind: 'pointX' | 'pointY'; point: string; value: number };

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
  /** Constraints that repeat each other (consistent, but more than needed). */
  | { kind: 'over'; redundant: number }
  /** Constraints that can't all be met. */
  | { kind: 'conflicting'; error: number };
