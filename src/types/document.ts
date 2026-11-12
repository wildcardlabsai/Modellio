/**
 * MODELLIO document model.
 *
 * Coordinate system: right-handed, Z-up, 1 world unit = 1 millimetre.
 * The workplane is the XY plane at Z = 0. Rotations are stored as Euler
 * angles in DEGREES using the XYZ order (the same convention Three.js uses).
 *
 * Every object owns an authoritative `size` (its local, unrotated bounding
 * box in millimetres). Geometry is regenerated from `size` + `params`, so the
 * dimensions shown in the inspector always equal the exported geometry.
 * Objects never carry a residual scale factor.
 *
 * The document is plain JSON (no class instances), which makes it trivially
 * serializable and lets the undo history share unchanged subtrees.
 */

export type Vec3 = [number, number, number];
export type ObjectId = string;

export type PrimitiveType =
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'pyramid'
  | 'wedge'
  | 'roof'
  | 'torus'
  | 'tube'
  | 'halfSphere'
  | 'polygon';

/** Numeric shape parameters (segments, wall thickness, polygon sides, ...). */
export type ShapeParams = Record<string, number>;

export interface Transform {
  /** Centre of the object's local bounding box, in mm (world space). */
  position: Vec3;
  /** Euler rotation in degrees, XYZ order. */
  rotation: Vec3;
}

interface BaseObject {
  id: ObjectId;
  name: string;
  transform: Transform;
  visible: boolean;
  locked: boolean;
  parentId: ObjectId | null;
}

export interface ShapeObject extends BaseObject {
  kind: 'shape';
  shape: PrimitiveType;
  params: ShapeParams;
  /** Local bounding-box dimensions in mm (X, Y, Z). Always positive. */
  size: Vec3;
  /** Hex colour, e.g. "#2463EB". */
  color: string;
  /** Holes are used by Boolean subtraction (Phase 3). */
  isHole: boolean;
}

export interface GroupObject extends BaseObject {
  kind: 'group';
  children: ObjectId[];
}

export type SceneObject = ShapeObject | GroupObject;

export interface DocumentSettings {
  units: 'mm';
  /** Workplane (print bed) size in mm. */
  workplane: [number, number];
}

export interface ModelDocument {
  schemaVersion: 1;
  objects: Record<ObjectId, SceneObject>;
  /** Top-level draw / hierarchy order. */
  rootIds: ObjectId[];
  settings: DocumentSettings;
}

export type TransformMode = 'translate' | 'rotate' | 'scale';
