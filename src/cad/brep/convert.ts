import type { ShapeObject } from '@/types/document';
import { SOLID_PRIMITIVES, type FeatureRecipe, type SolidPrimitive } from './types';

/**
 * Which shapes can become a precise solid, and the exact recipe for them. Meshes, text and the
 * mesh-only primitives cannot: there is no exact surface to fillet, so we say so instead.
 */
export type Conversion = { ok: true; recipe: FeatureRecipe } | { ok: false; reason: string };

export const CONVERTIBLE_LABEL = 'boxes, cylinders, cones, spheres, tori, wedges, tubes and sketches';

export function solidConversion(o: ShapeObject): Conversion {
  if (o.shape === 'solid') return o.feature ? { ok: true, recipe: o.feature } : { ok: false, reason: 'This solid has no recipe.' };
  if ((o.params.shell ?? 0) > 0) return { ok: false, reason: 'Turn off Hollow first; hollow shapes cannot be made precise yet.' };
  if (o.shape === 'profile') {
    if (!o.sketch) return { ok: false, reason: 'This sketch is empty.' };
    const p = o.params;
    return {
      ok: true,
      recipe: {
        base: {
          kind: 'sketch',
          sketch: o.sketch,
          op: (p.op ?? 0) >= 1 ? 'revolve' : 'extrude',
          depth: p.depth ?? 5,
          angle: p.angle ?? 360,
        },
        ops: [],
      },
    };
  }
  if (!SOLID_PRIMITIVES.includes(o.shape as SolidPrimitive)) {
    const what = o.shape === 'mesh' ? 'An imported or merged mesh' : o.shape === 'text' ? 'Text' : 'This shape';
    return { ok: false, reason: `${what} has no exact surfaces to fillet. Fillet and chamfer work on ${CONVERTIBLE_LABEL}.` };
  }
  if (o.shape === 'torus' && Math.abs(o.size[0] - o.size[1]) > 1e-6)
    return { ok: false, reason: 'Make the torus round (equal width and depth) first.' };
  const keep: Record<SolidPrimitive, string[]> = {
    box: ['radius', 'chamfer'],
    cylinder: [],
    cone: ['topRatio'],
    sphere: [],
    torus: [],
    wedge: [],
    tube: ['wall'],
  };
  const params: Record<string, number> = {};
  for (const k of keep[o.shape as SolidPrimitive]) if (typeof o.params[k] === 'number') params[k] = o.params[k];
  return { ok: true, recipe: { base: { kind: 'primitive', shape: o.shape as SolidPrimitive, params }, ops: [] } };
}
