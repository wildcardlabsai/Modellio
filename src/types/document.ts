/**
 * MODELLIO document model.
 *
 * Coordinate system: right-handed, Z-up, 1 world unit = 1 millimetre.
 * The workplane is the XY plane at Z = 0. Rotations are stored as Euler
 * angles in DEGREES using the XYZ order (the same convention Three.js uses).
 *
 * Objects form a scene graph: an object's `transform` is LOCAL to its parent
 * group (or to the world for top-level objects). World matrices are composed
 * on demand (see cad/hierarchy.ts).
 *
 * Every shape owns an authoritative `size` (its local, unrotated bounding
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
  | 'polygon'
  | 'star'
  | 'capsule'
  | 'paraboloid'
  /** 3D text: outlines from `text` extruded by the kernel. */
  | 'text'
  /** Arbitrary mesh from the asset store (Boolean bakes, separated parts, imports). */
  | 'mesh';

export type FontId = 'inter-bold' | 'inter' | 'roboto-slab' | 'bebas-neue' | 'pacifico' | 'space-mono';

export interface TextContent {
  content: string;
  font: FontId;
}

/** Numeric shape parameters (segments, wall thickness, polygon sides, ...). */
export type ShapeParams = Record<string, number>;

export interface Transform {
  /** Shapes: centre of the local bounding box. Groups: the group's pivot. In mm, relative to the parent. */
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
  /**
   * Per-local-axis reflection (+1 or -1). Mirroring is genuine: the generated
   * mesh is reflected and its winding corrected. Omitted means [1, 1, 1].
   */
  mirror?: Vec3;
  /** Text shapes only. */
  text?: TextContent;
  /** Mesh shapes only: id in the immutable asset store (mesh is centred on its bounds). */
  meshId?: string;
}

/**
 * How a group combines its parts:
 *  - undefined: a plain assembly (parts keep their own colours, nothing is cut)
 *  - 'union':     result = union(solids) − union(holes)
 *  - 'intersect': result = intersection(solids) − union(holes)
 * The result is computed live by the kernel, so parts stay editable.
 */
export type CombineMode = 'union' | 'intersect';

export interface GroupObject extends BaseObject {
  kind: 'group';
  combine?: CombineMode;
  /** Child ids in display order. Children's transforms are relative to this group. */
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
export type Axis = 0 | 1 | 2;
export type AlignMode = 'min' | 'center' | 'max';
