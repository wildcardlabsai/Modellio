/**
 * Split Studio — structured representation of an imported 3MF package.
 *
 * Coordinates: right-handed, Z-up, MILLIMETRES (converted from the model's
 * unit at import). Meshes are stored once in object space; instances carry
 * their own composed transform so identical objects placed twice remain
 * distinct and source data is never altered.
 *
 * Everything here is plain data with typed arrays, so it can cross the worker
 * boundary (transferables) and be serialised later.
 */

/** Row-major 4×4 matrix (16 numbers) in the THREE.Matrix4 `elements` (column-major) layout. */
export type Mat4 = number[];

export type ThreeMFUnit = 'micron' | 'millimeter' | 'centimeter' | 'inch' | 'foot' | 'meter';

export const UNIT_TO_MM: Record<ThreeMFUnit, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

export interface ThreeMFMesh {
  /** Vertex positions in object space, mm (x, y, z). */
  vertices: Float32Array;
  /** Triangle vertex indices (v1, v2, v3). */
  triangles: Uint32Array;
  /**
   * Resolved material for each triangle: an index into `ThreeMFDocument.materials`.
   * Resolution follows the precedence in MaterialResolver (vendor paint → vendor part extruder →
   * triangle property → object-level property → unassigned).
   */
  perTriangleMaterialIds: Uint32Array;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

export type MaterialKind =
  | 'base' // <basematerials>
  | 'colour' // <m:colorgroup>
  | 'texture' // <m:texture2dgroup> (not resolvable to one colour; flagged)
  | 'composite' // <m:compositematerials> (blended colour; flagged approximate)
  | 'multi' // <m:multiproperties> (first colour-bearing layer; flagged)
  | 'filament' // vendor (Bambu/Prusa) extruder / filament assignment
  | 'nonprinting' // slicer modifier / negative / support volumes: geometry that is not printed
  | 'unassigned'; // no material information at all

export interface ThreeMFMaterial {
  /** Index in `ThreeMFDocument.materials` (stable for this import). */
  materialId: number;
  /** Stable key: identical keys are the same physical material. */
  key: string;
  name: string;
  /** #RRGGBB (alpha kept separately). */
  colour: string;
  alpha: number;
  materialType: MaterialKind;
  /** Where it came from, e.g. "basematerials #5[2]" or "Bambu filament 3". */
  sourceDefinition: string;
  /** True when the displayed colour is an approximation of richer data (textures, composites, gradients, paint). */
  approximate: boolean;
}

export interface ThreeMFComponentRef {
  objectId: number;
  /** Package path of the model part that defines the referenced object (production extension). */
  path: string;
  transform: Mat4;
}

export interface ThreeMFObject {
  /** Model resource ID (as written in the file). */
  objectId: number;
  /** Model part path the object lives in ("/3D/3dmodel.model" for the root). */
  path: string;
  name: string;
  type: string;
  /** Present for mesh objects. */
  mesh: ThreeMFMesh | null;
  /** Present for components objects. */
  componentReferences: ThreeMFComponentRef[];
  /** Object-level default property, if any (lib3mf unique resource ID + property ID). */
  objectLevelProperty: { resourceId: number; propertyId: number } | null;
  /** Vendor (slicer) settings for this object, e.g. its extruder. */
  vendor?: { extruder?: number; name?: string };
}

export interface ThreeMFBuildItem {
  index: number;
  objectId: number;
  path: string;
  transform: Mat4;
  partNumber: string;
}

/** One placed copy of a mesh object: build item → component path → mesh. */
export interface ThreeMFInstance {
  /** Stable id, e.g. "b0/c1/c0" (build item 0, component 1, component 0). */
  instanceId: string;
  buildItemIndex: number;
  /** Component indices from the build item's object down to the mesh. */
  componentPath: number[];
  /** Index into `ThreeMFDocument.objects` of the mesh object. */
  objectIndex: number;
  /** Composed world transform (build item × components), mm. */
  transform: Mat4;
  name: string;
}

export interface ImportIssue {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  count?: number;
}

export interface ThreeMFDocument {
  fileName: string;
  fileSize: number;
  metadata: Record<string, string>;
  /** Unit declared in the file; geometry is already converted to mm. */
  units: ThreeMFUnit;
  /** Detected producer, e.g. "Bambu Studio", from metadata. */
  application: string | null;
  /** Extension namespaces used by the package. */
  extensions: string[];
  materials: ThreeMFMaterial[];
  objects: ThreeMFObject[];
  buildItems: ThreeMFBuildItem[];
  instances: ThreeMFInstance[];
  /** Package parts (paths) and the relationships that reference them. */
  relationships: { source: string; target: string; type: string }[];
  issues: ImportIssue[];
  stats: { triangles: number; vertices: number; meshObjects: number; instances: number; placedTriangles: number };
}

/** A group of triangles (across instances) sharing one resolved material — the unit of colour splitting. */
export interface ColourComponent {
  materialId: number;
  key: string;
  name: string;
  colour: string;
  materialType: MaterialKind;
  approximate: boolean;
  /** Triangles of this colour across all placed instances. */
  triangleCount: number;
  /** Surface area in mm² across all placed instances. */
  area: number;
  /** Instances that contain this colour. */
  instanceIds: string[];
  objectIds: number[];
}
