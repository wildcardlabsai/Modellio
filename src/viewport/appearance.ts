import type { ShapeObject, SurfaceFinish } from '@/types/document';

/** Material settings for each on-screen finish. Satin is the original MODELLIO look. */
export const FINISH_MATERIAL: Record<SurfaceFinish, { roughness: number; metalness: number }> = {
  matte: { roughness: 0.85, metalness: 0 },
  satin: { roughness: 0.42, metalness: 0.04 },
  gloss: { roughness: 0.15, metalness: 0.1 },
};

/** The material props for a shape's appearance (finish and opacity). View only. */
export function appearanceProps(o: Pick<ShapeObject, 'finish' | 'opacity'> | undefined) {
  const m = FINISH_MATERIAL[o?.finish ?? 'satin'];
  const opacity = o?.opacity !== undefined && o.opacity < 1 ? o.opacity : 1;
  return { ...m, opacity, transparent: opacity < 1, depthWrite: opacity >= 1 };
}
