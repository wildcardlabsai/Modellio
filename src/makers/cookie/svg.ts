import { ShapeUtils, Vector2 } from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { Poly } from './shapes';

/**
 * SVG → outlines (browser only: uses DOMParser through three's SVGLoader).
 * Filled paths keep their fill rule's holes; paths that are only stroked (line drawings)
 * become their stroke outline. Y is flipped to Y-up. Units don't matter: the cookie maker
 * scales the design to the chosen size.
 */
export function svgOutlines(text: string): { polygons: Poly[]; filled: number; stroked: number } {
  const data = new SVGLoader().parse(text);
  const polygons: Poly[] = [];
  let filled = 0;
  let stroked = 0;
  const ccw = (pts: Vector2[], wantCcw: boolean): Poly => {
    const p = pts.map((v) => [v.x, -v.y] as [number, number]);
    const isCcw = ShapeUtils.area(p.map(([x, y]) => new Vector2(x, y))) > 0;
    return isCcw === wantCcw ? p : p.reverse();
  };
  for (const path of data.paths) {
    const style = (path.userData?.style ?? {}) as { fill?: string; stroke?: string; strokeWidth?: number; fillOpacity?: number };
    const hasFill = style.fill !== undefined && style.fill !== 'none' && style.fillOpacity !== 0;
    if (hasFill) {
      for (const shape of SVGLoader.createShapes(path)) {
        const { shape: outer, holes } = shape.extractPoints(16);
        if (outer.length >= 3) polygons.push(ccw(dedupe(outer), true));
        for (const h of holes) if (h.length >= 3) polygons.push(ccw(dedupe(h), false));
        filled++;
      }
    } else if (style.stroke && style.stroke !== 'none') {
      const width = style.strokeWidth || 1;
      const strokeStyle = SVGLoader.getStrokeStyle(width, style.stroke, 'round', 'round', 4);
      for (const sub of path.subPaths) {
        const geom = SVGLoader.pointsToStroke(sub.getPoints(), strokeStyle);
        if (!geom) continue;
        const pos = geom.getAttribute('position');
        for (let i = 0; i < pos.count; i += 3) {
          const tri = [0, 1, 2].map((k) => new Vector2(pos.getX(i + k), pos.getY(i + k)));
          if (Math.abs(ShapeUtils.area(tri)) > 1e-9) polygons.push(ccw(tri, true));
        }
        geom.dispose();
        stroked++;
      }
    }
  }
  return { polygons, filled, stroked };
}

function dedupe(pts: Vector2[]): Vector2[] {
  const out: Vector2[] = [];
  for (const p of pts) if (!out.length || out[out.length - 1].distanceTo(p) > 1e-9) out.push(p);
  if (out.length > 1 && out[0].distanceTo(out[out.length - 1]) < 1e-9) out.pop();
  return out;
}
