import type * as THREE from 'three';
import type { PrimitiveType, ShapeParams, Vec3 } from '@/types/document';
import { PRIMITIVE_BUILDERS } from './geometry/primitives';
import { MIN_DIMENSION, mirrorGeometry } from './geometry/geometryUtils';

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
export const SHAPES: ShapeDefinition[] = [
  { type: 'box', label: 'Box', defaultSize: [20, 20, 20], defaultParams: {}, defaultColor: '#2463EB', params: [] },
  { type: 'cylinder', label: 'Cylinder', defaultSize: [20, 20, 20], defaultParams: { segments: 64 }, defaultColor: '#8B5CF6', params: [SEGMENTS], roundXY: true },
  { type: 'sphere', label: 'Sphere', defaultSize: [20, 20, 20], defaultParams: { segments: 48 }, defaultColor: '#0EA5E9', params: [SEGMENTS], roundXY: true },
  {
    type: 'cone', label: 'Cone', defaultSize: [20, 20, 20], defaultParams: { segments: 64, topRatio: 0 }, defaultColor: '#EC4899', roundXY: true,
    params: [SEGMENTS, { key: 'topRatio', label: 'Top radius', min: 0, max: 1, step: 0.05 }],
  },
  { type: 'pyramid', label: 'Pyramid', defaultSize: [20, 20, 20], defaultParams: {}, defaultColor: '#F59E0B', params: [] },
  { type: 'roof', label: 'Roof', defaultSize: [20, 20, 20], defaultParams: {}, defaultColor: '#10B981', params: [] },
  { type: 'torus', label: 'Torus', defaultSize: [20, 20, 4], defaultParams: { segments: 64 }, defaultColor: '#7C3AED', params: [SEGMENTS], roundXY: true },
  {
    type: 'tube', label: 'Tube', defaultSize: [20, 20, 20], defaultParams: { segments: 64, wall: 2 }, defaultColor: '#F97316', roundXY: true,
    params: [SEGMENTS, { key: 'wall', label: 'Wall thickness', min: 0.1, max: 500, step: 0.1, unit: 'mm' }],
  },
  { type: 'wedge', label: 'Wedge', defaultSize: [20, 20, 20], defaultParams: {}, defaultColor: '#3B82F6', params: [] },
  { type: 'halfSphere', label: 'Half Sphere', defaultSize: [20, 20, 10], defaultParams: { segments: 48 }, defaultColor: '#F43F5E', params: [SEGMENTS], roundXY: true },
  {
    type: 'polygon', label: 'Polygon', defaultSize: [20, 20, 10], defaultParams: { sides: 6 }, defaultColor: '#6366F1',
    params: [{ key: 'sides', label: 'Sides', min: 3, max: 64, step: 1, integer: true }],
  },
];

const SHAPE_MAP = new Map(SHAPES.map((s) => [s.type, s]));

export function getShapeDefinition(type: PrimitiveType): ShapeDefinition {
  const def = SHAPE_MAP.get(type);
  if (!def) throw new Error(`Unknown shape type: ${type}`);
  return def;
}

/** Generate the real geometry of a primitive. Caller owns (and disposes) the result. */
export function buildShapeGeometry(type: PrimitiveType, size: Vec3, params: ShapeParams, mirror?: Vec3): THREE.BufferGeometry {
  const safe: Vec3 = [
    Math.max(MIN_DIMENSION, Math.abs(size[0])),
    Math.max(MIN_DIMENSION, Math.abs(size[1])),
    Math.max(MIN_DIMENSION, Math.abs(size[2])),
  ];
  const geometry = PRIMITIVE_BUILDERS[type](safe, params);
  return mirror ? mirrorGeometry(geometry, mirror) : geometry;
}
