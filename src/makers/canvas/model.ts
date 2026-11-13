import type { CrossSection, ManifoldToplevel, SimplePolygon } from 'manifold-3d';
import type { FontId } from '@/types/document';
import { loadFont, getLoadedFont } from '@/cad/text/fonts';
import { textContours } from '@/cad/text/textGeometry';
import { canvasShape, type Poly } from './shapes';
import { capsule } from '../cookie/shapes';

/**
 * The shared maker design: a flat composition of elements in millimetres (Y up, origin at
 * the centre of the artboard). Each element has a transform and a role; makers decide what
 * roles mean (cookie: outline / stamp detail / hole; keyring: plate / raised / engraved / cut).
 */
export interface ElementBase {
  id: string;
  /** Centre (mm). */
  x: number;
  y: number;
  /** Size of the element's own box before rotation (mm). */
  w: number;
  h: number;
  /** Degrees, counter-clockwise. */
  rotation: number;
  flipX?: boolean;
  /**
   * Which face of a double-sided design the item is on (makers that support it). Back items
   * are stored as seen from behind, so text reads normally while editing the back.
   */
  side?: 'front' | 'back';
  role: string;
  name?: string;
}

export type DesignElement =
  | (ElementBase & { kind: 'shape'; shape: string })
  | (ElementBase & { kind: 'text'; text: string; font: FontId })
  | (ElementBase & { kind: 'outline'; polygons: Poly[]; fillRule: 'Positive' | 'NonZero' | 'EvenOdd' })
  | (ElementBase & { kind: 'draw'; points: [number, number][]; width: number });

export type FillRule = 'Positive' | 'NonZero' | 'EvenOdd';

/** Fit polygons into the unit box [-0.5, 0.5]² (stretching each axis), returning the natural aspect (w / h). */
export function normalise(polys: Poly[]): { polys: Poly[]; aspect: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polys)
    for (const [x, y] of p) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  return { polys: polys.map((p) => p.map(([x, y]) => [(x - minX) / w - 0.5, (y - minY) / h - 0.5] as [number, number])), aspect: w / h };
}

// Unit outlines are cached by content, so editing transforms never recomputes them.
const unitCache = new Map<string, { polys: Poly[]; aspect: number }>();
const listeners = new Set<() => void>();
/** Called when a font finishes loading (text outlines become available). */
export function onUnitsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function fillRuleOf(el: DesignElement): FillRule {
  if (el.kind === 'text') return 'NonZero';
  if (el.kind === 'outline') return el.fillRule;
  return 'Positive';
}

/** The element's outline in its unit box, or null while its font is loading. */
export function unitOutline(el: DesignElement): { polys: Poly[]; aspect: number } | null {
  if (el.kind === 'draw') return null;
  const key =
    el.kind === 'shape'
      ? `s|${el.shape}`
      : el.kind === 'text'
        ? `t|${el.font}|${el.text}`
        : `o|${el.id}|${el.polygons.length}|${el.polygons[0]?.length ?? 0}`;
  const hit = unitCache.get(key);
  if (hit) return hit;
  let out: { polys: Poly[]; aspect: number };
  if (el.kind === 'shape') out = normalise(canvasShape(el.shape).polygons());
  else if (el.kind === 'outline') out = normalise(el.polygons);
  else {
    const font = getLoadedFont(el.font);
    if (!font) {
      void loadFont(el.font).then(() => listeners.forEach((l) => l()));
      return null;
    }
    const contours = textContours(font, { content: el.text || ' ', fontSize: 10, depth: 1, curveSegments: 8 }) as Poly[];
    out = contours.length ? normalise(contours) : { polys: [], aspect: 1 };
  }
  unitCache.set(key, out);
  return out;
}

/** Natural aspect ratio of a new element's content (for sizing it without distortion). */
export function naturalAspect(el: DesignElement): number | null {
  return unitOutline(el)?.aspect ?? null;
}

/** World-space polygons of an element (mm), or null while loading. */
export function worldPolygons(el: DesignElement): Poly[] | null {
  const rad = (el.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const f = el.flipX ? -1 : 1;
  const tf = ([u, v]: [number, number]): [number, number] => {
    const lx = u * el.w * f;
    const ly = v * el.h;
    return [el.x + lx * c - ly * s, el.y + lx * s + ly * c];
  };
  if (el.kind === 'draw') {
    // Points are stored in the unit box; the stroke keeps its width in mm.
    const pts = el.points.map(tf);
    if (pts.length === 1) return [capsule(pts[0][0], pts[0][1], pts[0][0] + 0.01, pts[0][1], el.width / 2, 12)];
    const out: Poly[] = [];
    for (let i = 0; i < pts.length - 1; i++) out.push(capsule(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], el.width / 2, 12));
    return out;
  }
  const u = unitOutline(el);
  if (!u) return null;
  const polys = u.polys.map((p) => p.map(tf));
  // Mirroring reverses winding; restore it so fill rules keep working.
  return el.flipX ? polys.map((p) => [...p].reverse()) : polys;
}

/** Corners of the element's box in world space (for selection drawing and bounds). */
export function boxCorners(el: ElementBase): [number, number][] {
  const rad = (el.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ].map(([u, v]) => [el.x + u * el.w * c - v * el.h * s, el.y + u * el.w * s + v * el.h * c]);
}

export function designBounds(elements: ElementBase[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!elements.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements)
    for (const [x, y] of boxCorners(el)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  return { minX, minY, maxX, maxY };
}

/** Load every font the design uses (so worldPolygons returns outlines for all elements). */
export async function ensureFonts(elements: DesignElement[]): Promise<void> {
  await Promise.all(elements.filter((e) => e.kind === 'text').map((e) => loadFont((e as { font: FontId }).font)));
}

/**
 * Union of the elements with the given roles as a CrossSection (mm). Each element keeps its
 * own fill rule (text: non-zero, shapes: positive, traced pictures: even-odd).
 */
export function unionOf(k: ManifoldToplevel, elements: DesignElement[], roles: string[]): CrossSection {
  let acc = new k.CrossSection([[]], 'Positive');
  for (const el of elements) {
    if (!roles.includes(el.role)) continue;
    const polys = worldPolygons(el);
    if (!polys || !polys.length) continue;
    const cs = new k.CrossSection(polys as SimplePolygon[], fillRuleOf(el));
    const next = acc.add(cs);
    acc.delete();
    cs.delete();
    acc = next;
  }
  return acc;
}

let counter = 0;
export const newId = () => `e${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Give elements stored with w: 0 (template text and shapes) their natural width for their
 * height, so nothing is stretched. Text needs its font loaded first (see ensureFonts).
 */
export function fitNatural(elements: DesignElement[]): DesignElement[] {
  let changed = false;
  const out = elements.map((e) => {
    if (e.w > 0) return e;
    const a = naturalAspect(e);
    if (!a) return e;
    changed = true;
    return { ...e, w: Math.round(e.h * a * 10) / 10 };
  });
  return changed ? out : elements;
}

/** The side an element is on (front unless marked back). */
export const sideOf = (el: { side?: 'front' | 'back' }) => el.side ?? 'front';
