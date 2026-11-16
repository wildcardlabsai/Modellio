import type { Sketch } from '@/cad/sketch/types';
import type { FaceRef, FeatureRecipe } from '@/cad/brep/types';
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
  /** Involute spur gear (teeth, pressure angle, bore). */
  | 'gear'
  /** 3D text: outlines from `text` extruded by the kernel. */
  | 'text'
  /** Arbitrary mesh from the asset store (Boolean bakes, separated parts, imports). */
  | 'mesh'
  /** A 2D sketch extruded or revolved (`sketch` + params op/depth/angle). */
  | 'profile'
  /** A precise (OpenCascade) solid built from `feature`: a base plus fillets and chamfers. */
  | 'solid';

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
  /**
   * Schema 4: inside a component instance, which part of the component this is. The same in every
   * instance, so linked instances can be kept identical part by part.
   */
  defNode?: string;
  /** Schema 4: fixed in place in the assembly (it can't be moved until ungrounded). */
  grounded?: boolean;
  /** Schema 4: where "Reset position" puts it back to. */
  home?: Transform;
  /** Schema 4: left out of the design (not shown, combined, exported or checked) but kept. */
  suppressed?: boolean;
}

/** On-screen surface finish. Appearance only: it does not change geometry or exports. */
export type SurfaceFinish = 'matte' | 'satin' | 'gloss';

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
  /** How the surface looks on screen (view only; never exported). Omitted means satin. */
  finish?: SurfaceFinish;
  /** On-screen opacity, 0.1–1 (view only; never exported). Omitted means 1. */
  opacity?: number;
  /**
   * Per-local-axis reflection (+1 or -1). Mirroring is genuine: the generated
   * mesh is reflected and its winding corrected. Omitted means [1, 1, 1].
   */
  mirror?: Vec3;
  /** Text shapes only. */
  text?: TextContent;
  /** Mesh shapes only: id in the immutable asset store (mesh is centred on its bounds). */
  meshId?: string;
  /** Profile shapes only: the editable 2D sketch the solid is made from (its resolved copy). */
  sketch?: Sketch;
  /**
   * Profile shapes only (schema 2+): the standalone sketch this body is built from. Editing that
   * sketch updates every body that uses it; `sketch` is kept equal to it.
   */
  sketchId?: SketchId;
  /** Solid shapes only: the feature recipe (base + ordered operations). */
  feature?: FeatureRecipe;
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
  /** A component (schema 2+): a named, reusable part listed under Components. Plain groups are assemblies. */
  component?: boolean;
  /**
   * Schema 4: the component this group is an instance of. Instances of the same component are
   * linked: editing the parts of one changes them in every other.
   */
  componentId?: ComponentId;
  /** Child ids in display order. Children's transforms are relative to this group. */
  children: ObjectId[];
}

export type SceneObject = ShapeObject | GroupObject;

export interface DocumentSettings {
  units: 'mm';
  /** Workplane (print bed) size in mm. */
  workplane: [number, number];
}

export type SketchId = string;
export type ComponentId = string;

/** A component definition (schema 4): its instances are the groups whose `componentId` is this. */
export interface ComponentDef {
  id: ComponentId;
  name: string;
  createdAt: number;
}

export type JointKind = 'rigid' | 'revolute' | 'slider' | 'cylindrical' | 'planar';
export type JointValue = 'angle' | 'offset' | 'u' | 'v';

/**
 * A joint (schema 4) connecting part A to part B. Each has a frame (a 4×4 matrix, column-major,
 * in the part's own coordinates); the joint's axis is the frame's Z. B's placement follows from
 * A's and the values (angle in degrees about the axis; offset along it; u, v across the plane).
 */
export interface Joint {
  id: string;
  name: string;
  kind: JointKind;
  a: ObjectId;
  b: ObjectId;
  frameA: number[];
  frameB: number[];
  values: Partial<Record<JointValue, number>>;
  /** Allowed range per value, [min, max]. */
  limits?: Partial<Record<JointValue, [number, number]>>;
  suppressed?: boolean;
}

/** One step of an exploded view: these objects move by `offset` (world mm). */
export interface ExplodeStep {
  id: string;
  name?: string;
  objectIds: ObjectId[];
  offset: Vec3;
}

/** An exploded view (schema 4): display only, it never moves the design itself. */
export interface ExplodeView {
  id: string;
  name: string;
  steps: ExplodeStep[];
}

/**
 * A sketch's plane in the world (schema 3+): `origin` is the sketch's (0, 0), `x` and `y` its
 * axes (unit, at right angles). The sketch's normal, x × y, is the way extrusions grow.
 */
export interface Frame {
  origin: Vec3;
  x: Vec3;
  y: Vec3;
}

export type PlaneId = string;

/**
 * A reference plane (schema 3+): one of the three main planes, moved along its normal by
 * `offset` mm and optionally tilted by `tilt` degrees about its own x axis.
 */
export interface RefPlane {
  id: PlaneId;
  name: string;
  base: 'XY' | 'XZ' | 'YZ';
  offset: number;
  tilt: number;
  visible: boolean;
}

/**
 * Where a standalone sketch sits (schema 3+): on a reference plane, or attached to a flat face
 * of a body (found again by its reference after the body changes).
 */
export type SketchPlacement = { kind: 'plane'; planeId: PlaneId } | { kind: 'face'; objectId: ObjectId; face: FaceRef };

/** A standalone sketch (schema 2+): exists on its own and can drive several bodies. */
export interface SketchRecord {
  id: SketchId;
  name: string;
  sketch: Sketch;
  /** Schema 3+: where the sketch sits. Without one, its bodies are placed freely (as in schema 2). */
  placement?: SketchPlacement;
  /** The placement's last resolved frame: bodies built from the sketch sit on it. */
  frame?: Frame;
  /** Why the placement can no longer be resolved (its face is gone, …). Nothing is moved while broken. */
  broken?: string;
}

export interface ModelDocument {
  /**
   * 2 adds standalone sketches and components; 3 adds reference planes and sketch placements.
   * Older documents are migrated on load.
   */
  schemaVersion: 1 | 2 | 3 | 4;
  /** Standalone sketches by id (schema 2+; absent in version 1 documents). */
  sketches?: Record<SketchId, SketchRecord>;
  /** Reference planes by id (schema 3+). */
  planes?: Record<PlaneId, RefPlane>;
  /** Component definitions (schema 4+). */
  components?: Record<ComponentId, ComponentDef>;
  /** Assembly joints (schema 4+). */
  joints?: Record<string, Joint>;
  /** Exploded views (schema 4+). */
  explodeViews?: Record<string, ExplodeView>;
  objects: Record<ObjectId, SceneObject>;
  /** Top-level draw / hierarchy order. */
  rootIds: ObjectId[];
  settings: DocumentSettings;
}

export type TransformMode = 'translate' | 'rotate' | 'scale';
export type Axis = 0 | 1 | 2;
export type AlignMode = 'min' | 'center' | 'max';
