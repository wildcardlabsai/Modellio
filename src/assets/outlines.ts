import type { ManifoldToplevel, SimplePolygon } from 'manifold-3d';
import { svgOutlines } from '@/makers/cookie/svg';
import { maskFromRgba, traceMask } from '@/makers/cookie/trace';
import { readImageFile } from '@/makers/canvas/image';
import { manifoldToMeshData, type MeshData } from '@/cad/kernel/meshData';

/** 2D artwork from a file: closed outlines (Y up) and how to fill them. */
export interface Outline {
  polys: [number, number][][];
  fillRule: 'Positive' | 'EvenOdd';
  name: string;
}

const base = (name: string) => name.replace(/\.[^.]+$/, '') || 'Artwork';
export const isSvgFile = (name: string, type = '') => /\.svg$/i.test(name) || type === 'image/svg+xml';
export const isPictureFile = (name: string, type = '') =>
  !isSvgFile(name, type) && (/^image\//.test(type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name));
export const isOutlineFile = (name: string, type = '') => isSvgFile(name, type) || isPictureFile(name, type);

/** Trace an SVG (filled paths and strokes) or a picture (dark shapes on a light background, or a transparent PNG). */
export async function outlineFromFile(file: Blob & { name: string }): Promise<Outline> {
  let polys: [number, number][][];
  let fillRule: Outline['fillRule'] = 'Positive';
  if (isSvgFile(file.name, file.type)) polys = svgOutlines(await file.text()).polygons;
  else if (isPictureFile(file.name, file.type)) {
    const img = await readImageFile(file as File);
    const { mask } = maskFromRgba(img.rgba, img.width, img.height, img.threshold, false);
    polys = traceMask(mask, img.width, img.height, { tolerance: 0.9, smoothing: 2, minAreaFraction: 0.0008 });
    fillRule = 'EvenOdd';
  } else throw new Error(`"${file.name}" isn't an SVG or a picture.`);
  if (!polys.length) throw new Error(`Nothing to use was found in "${file.name}". Pictures need dark shapes on a light background.`);
  return { polys, fillRule, name: base(file.name) };
}

/**
 * Artwork as a solid: centred, scaled so its longest side is `longest` mm, extruded `height` mm,
 * resting on z = 0.
 */
export function outlineToMesh(k: ManifoldToplevel, o: Outline, longest = 40, height = 2): MeshData {
  const cs = new k.CrossSection(o.polys as SimplePolygon[], o.fillRule);
  try {
    if (cs.isEmpty()) throw new Error(`"${o.name}" has no filled area.`);
    const b = cs.bounds();
    const s = longest / Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]);
    const placed = cs.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2]).scale([s, s]);
    const solid = k.Manifold.extrude(placed, height);
    placed.delete();
    try {
      return manifoldToMeshData(solid);
    } finally {
      solid.delete();
    }
  } finally {
    cs.delete();
  }
}
