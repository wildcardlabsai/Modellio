import type * as THREE from 'three';
import type { PrimitiveType, ShapeObject, ShapeParams, Vec3 } from '@/types/document';
import { PRIMITIVE_BUILDERS, type ParametricType } from './geometry/primitives';
import { MIN_DIMENSION, fitToSize, mirrorGeometry } from './geometry/geometryUtils';
import { getKernel } from './kernel/kernel';
import { geometryToMeshData, manifoldToMeshData, meshDataToGeometry, meshDataToManifold, type MeshData } from './kernel/meshData';
import { getMeshAsset } from './assets';
import { getLoadedFont } from './text/fonts';
import { buildTextMesh } from './text/textGeometry';

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  integer?: boolean;
}

export interface ShapeDefinition {
  type: PrimitiveType;
  /** Shown in the shape library. */
  library?: boolean;
  label: string;
  /** Default dimensions in mm (X, Y, Z). */
  defaultSize: Vec3;
  defaultParams: ShapeParams;
  defaultColor: string;
  /** Editable shape parameters shown in the inspector. */
  params: ParamSpec[];
  /** True when X/Y should stay equal by default (round shapes). */
  roundXY?: boolean;
}

const SEGMENTS: ParamSpec = { key: 'segments', label: 'Smoothness', min: 8, max: 128, step: 1, integer: true };

/**
 * The shape library. To add a primitive: write a builder in
 * `geometry/primitives`, add its type to `PrimitiveType` and register it here.
 */
const FILLET: ParamSpec[] = [
  { key: 'radius', label: 'Fillet radius', min: 0, max: 500, step: 0.5, unit: 'mm' },
  { key: 'filletSegments', label: 'Fillet smoothness', min: 1, max: 16, step: 1, integer: true },
  { key: 'chamfer', label: 'Chamfer', min: 0, max: 500, step: 0.5, unit: 'mm' },
];

export const SHAPES: ShapeDefinition[] = (
  [
    {
      type: 'box',
      label: 'Box',
      defaultSize: [20, 20, 20],
      defaultParams: { radius: 0, filletSegments: 4 },
      defaultColor: '#2463EB',
      params: FILLET,
    },
    {
      type: 'cylinder',
      label: 'Cylinder',
      defaultSize: [20, 20, 20],
      defaultParams: { segments: 64 },
      defaultColor: '#8B5CF6',
      params: [SEGMENTS],
      roundXY: true,
    },
    {
      type: 'sphere',
      label: 'Sphere',
      defaultSize: [20, 20, 20],
      defaultParams: { segments: 48 },
      defaultColor: '#0EA5E9',
      params: [SEGMENTS],
      roundXY: true,
    },
    {
      type: 'cone',
      label: 'Cone',
      defaultSize: [20, 20, 20],
      defaultParams: { segments: 64, topRatio: 0 },
      defaultColor: '#EC4899',
      roundXY: true,
      params: [SEGMENTS, { key: 'topRatio', label: 'Top radius', min: 0, max: 1, step: 0.05 }],
    },
    { type: 'pyramid', label: 'Pyramid', defaultSize: [20, 20, 20], defaultParams: {}, defaultColor: '#F59E0B', params: [] },
    { type: 'roof', label: 'Roof', defaultSize: [20, 20, 20], defaultParams: {}, defaultColor: '#10B981', params: [] },
    {
      type: 'torus',
      label: 'Torus',
      defaultSize: [20, 20, 4],
      defaultParams: { segments: 64 },
      defaultColor: '#7C3AED',
      params: [SEGMENTS],
      roundXY: true,
    },
    {
      type: 'tube',
      label: 'Tube',
      defaultSize: [20, 20, 20],
      defaultParams: { segments: 64, wall: 2 },
      defaultColor: '#F97316',
      roundXY: true,
      params: [SEGMENTS, { key: 'wall', label: 'Wall thickness', min: 0.1, max: 500, step: 0.1, unit: 'mm' }],
    },
    { type: 'wedge', label: 'Wedge', defaultSize: [20, 20, 20], defaultParams: {}, defaultColor: '#3B82F6', params: [] },
    {
      type: 'halfSphere',
      label: 'Half Sphere',
      defaultSize: [20, 20, 10],
      defaultParams: { segments: 48 },
      defaultColor: '#F43F5E',
      params: [SEGMENTS],
      roundXY: true,
    },
    {
      type: 'polygon',
      label: 'Polygon',
      defaultSize: [20, 20, 10],
      defaultParams: { sides: 6 },
      defaultColor: '#6366F1',
      params: [{ key: 'sides', label: 'Sides', min: 3, max: 64, step: 1, integer: true }],
    },
    {
      type: 'star',
      label: 'Star',
      defaultSize: [20, 20, 6],
      defaultParams: { points: 5, innerRatio: 0.5 },
      defaultColor: '#EAB308',
      params: [
        { key: 'points', label: 'Points', min: 3, max: 32, step: 1, integer: true },
        { key: 'innerRatio', label: 'Inner radius', min: 0.05, max: 0.95, step: 0.05 },
      ],
    },
    {
      type: 'capsule',
      label: 'Capsule',
      defaultSize: [12, 12, 30],
      defaultParams: { segments: 48 },
      defaultColor: '#14B8A6',
      params: [SEGMENTS],
      roundXY: true,
    },
    {
      type: 'paraboloid',
      label: 'Paraboloid',
      defaultSize: [20, 20, 20],
      defaultParams: { segments: 48 },
      defaultColor: '#A855F7',
      params: [SEGMENTS],
      roundXY: true,
    },
  ] as unknown as ShapeDefinition[]
)
  .map((d): ShapeDefinition => ({ ...d, library: true }))
  .concat([
    {
      type: 'text',
      label: 'Text',
      defaultSize: [40, 10, 5],
      defaultParams: { fontSize: 14, segments: 6 },
      defaultColor: '#2463EB',
      params: [{ key: 'segments', label: 'Curve smoothness', min: 2, max: 24, step: 1, integer: true }],
    },
    { type: 'mesh', label: 'Mesh', defaultSize: [20, 20, 20], defaultParams: {}, defaultColor: '#64748B', params: [] },
  ]);

export const LIBRARY_SHAPES = SHAPES.filter((s) => s.library);

const SHAPE_MAP = new Map(SHAPES.map((s) => [s.type, s]));

export function getShapeDefinition(type: PrimitiveType): ShapeDefinition {
  const def = SHAPE_MAP.get(type);
  if (!def) throw new Error(`Unknown shape type: ${type}`);
  return def;
}

const safeSize = (size: Vec3): Vec3 => [
  Math.max(MIN_DIMENSION, Math.abs(size[0])),
  Math.max(MIN_DIMENSION, Math.abs(size[1])),
  Math.max(MIN_DIMENSION, Math.abs(size[2])),
];

/** Generate the real geometry of a parametric primitive. Caller owns (and disposes) the result. */
export function buildShapeGeometry(type: ParametricType, size: Vec3, params: ShapeParams, mirror?: Vec3): THREE.BufferGeometry {
  const geometry = PRIMITIVE_BUILDERS[type](safeSize(size), params);
  return mirror ? mirrorGeometry(geometry, mirror) : geometry;
}

const shellCache = new Map<string, MeshData>();

/**
 * Hollow version of a primitive: the shape minus an inset copy of itself
 * (size − 2 × wall), optionally open at the top. Wall thickness is exact on
 * flat sides (boxes, prisms) and approximate on curved/sloped ones. Needs the
 * kernel; returns null until it is loaded, and the solid shape if the wall is
 * too thick to leave a cavity.
 */
export function buildShellMesh(type: ParametricType, size: Vec3, params: ShapeParams): MeshData | null | 'solid' {
  const wall = params.shell ?? 0;
  const s = safeSize(size);
  const open = (params.openTop ?? 0) > 0;
  const inner: Vec3 = [s[0] - 2 * wall, s[1] - 2 * wall, open ? s[2] - wall + 1 : s[2] - 2 * wall];
  if (wall <= 0 || inner.some((v) => v <= 0.05)) return 'solid';
  const k = getKernel();
  if (!k) return null;
  const key = JSON.stringify([type, s, params]);
  const hit = shellCache.get(key);
  if (hit) return hit;
  const outerGeo = PRIMITIVE_BUILDERS[type](s, params);
  const innerParams = { ...params, radius: Math.max(0, (params.radius ?? 0) - wall), chamfer: Math.max(0, (params.chamfer ?? 0) - wall) };
  const innerGeo = PRIMITIVE_BUILDERS[type](inner, innerParams);
  // Open top: the cavity starts one wall above the bottom and overshoots the top by 1 mm (no coplanar faces).
  if (open) innerGeo.translate(0, 0, (wall + 1) / 2);
  const a = meshDataToManifold(k, geometryToMeshData(outerGeo));
  const b = meshDataToManifold(k, geometryToMeshData(innerGeo));
  outerGeo.dispose();
  innerGeo.dispose();
  const r = a.subtract(b);
  try {
    const mesh = manifoldToMeshData(r);
    shellCache.set(key, mesh);
    if (shellCache.size > 64) shellCache.delete(shellCache.keys().next().value!);
    return mesh;
  } finally {
    a.delete();
    b.delete();
    r.delete();
  }
}

// Text meshes are comparatively expensive (kernel extrusion); keep a small cache.
const textCache = new Map<string, MeshData>();
const TEXT_CACHE_LIMIT = 48;

/** Natural (unstretched) text mesh at the shape's font size; depth = 1 mm, scaled later. */
export function getTextMesh(o: Pick<ShapeObject, 'text' | 'params'>): MeshData | null {
  if (!o.text) return null;
  const k = getKernel();
  const font = getLoadedFont(o.text.font);
  if (!k || !font) return null;
  const fontSize = o.params.fontSize ?? 14;
  const segs = Math.round(o.params.segments ?? 6);
  const key = `${o.text.font}|${fontSize}|${segs}|${o.text.content}`;
  let mesh = textCache.get(key);
  if (!mesh) {
    mesh = buildTextMesh(k, font, { content: o.text.content, fontSize, depth: 1, curveSegments: segs }) ?? undefined;
    if (!mesh) return null;
    textCache.set(key, mesh);
    if (textCache.size > TEXT_CACHE_LIMIT) textCache.delete(textCache.keys().next().value!);
  }
  return mesh;
}

/**
 * Geometry for any shape object (primitives, text, meshes), fitted to its
 * authoritative size and mirrored. Returns null when it depends on something
 * still loading (kernel, font) or missing (asset). Caller owns the result.
 */
export function buildGeometryForShape(o: ShapeObject): THREE.BufferGeometry | null {
  if (o.shape === 'text') {
    const mesh = getTextMesh(o);
    if (!mesh) return null;
    const g = fitToSize(meshDataToGeometry(mesh, (40 * Math.PI) / 180), safeSize(o.size));
    return o.mirror ? mirrorGeometry(g, o.mirror) : g;
  }
  if (o.shape === 'mesh') {
    const asset = o.meshId ? getMeshAsset(o.meshId) : undefined;
    if (!asset) return null;
    const g = fitToSize(meshDataToGeometry(asset), safeSize(o.size));
    return o.mirror ? mirrorGeometry(g, o.mirror) : g;
  }
  if ((o.params.shell ?? 0) > 0) {
    const shell = buildShellMesh(o.shape, o.size, o.params);
    if (shell === null) return null; // kernel still loading
    if (shell !== 'solid') {
      const g = meshDataToGeometry(shell);
      return o.mirror ? mirrorGeometry(g, o.mirror) : g;
    }
  }
  return buildShapeGeometry(o.shape, o.size, o.params, o.mirror);
}
