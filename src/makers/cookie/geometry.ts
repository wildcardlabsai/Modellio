import type { CrossSection, Manifold, ManifoldToplevel, SimplePolygon } from 'manifold-3d';
import { manifoldToMeshData, type MeshData } from '@/cad/kernel/meshData';
import { validatePart } from '@/split/geometry/split';
import type { Poly } from './shapes';

/**
 * Cookie cutter and stamp generator.
 *
 * Coordinates are millimetres, Z up, and every part is returned in its print orientation
 * on the bed (z = 0). Parts are modelled for how they are printed and then flipped to use:
 *  - the cutter prints flange-down with the blade up, and is turned over to cut;
 *  - the stamp prints face-up (no supports), and is turned over to press.
 * Both flips mirror the design, so with `mirror` on (default) the design is mirrored once
 * here and the cookie comes out the right way round.
 */
export interface CookieSource {
  kind: 'shape' | 'text' | 'svg' | 'image';
  polygons: Poly[];
  fillRule: 'Positive' | 'NonZero' | 'EvenOdd';
}

export interface CookieParams {
  make: 'cutter' | 'stamp' | 'both';
  /** Longest side of the cookie (the cut shape), mm. */
  size: number;
  /** Extra margin around the design (a "bubble" outline that also joins separate letters), mm. */
  outline: number;
  /** Rounds off tight corners and thin slivers the cutter can't follow, mm. */
  smoothing: number;
  mirror: boolean;
  cutterHeight: number;
  blade: number;
  rimWidth: number;
  rimHeight: number;
  stampStyle: 'auto' | 'outline' | 'filled';
  reliefHeight: number;
  lineWidth: number;
  plateThickness: number;
  /** Gap between the stamp and the inside of the cutter, mm per side. */
  gap: number;
  handle: boolean;
}

export const DEFAULT_COOKIE_PARAMS: CookieParams = {
  make: 'both',
  size: 70,
  outline: 0,
  smoothing: 0.6,
  mirror: true,
  cutterHeight: 14,
  blade: 0.9,
  rimWidth: 3,
  rimHeight: 2,
  stampStyle: 'auto',
  reliefHeight: 2,
  lineWidth: 1.4,
  plateThickness: 4,
  gap: 0.6,
  handle: true,
};

export interface CookiePart {
  id: 'cutter' | 'stamp' | 'handle';
  name: string;
  /** Print orientation, placed side by side for preview. */
  mesh: MeshData;
  size: [number, number, number];
  volume: number;
  watertight: boolean;
}

export interface CookieResult {
  parts: CookiePart[];
  /** Size of the cookie itself (the cut shape), mm. */
  cookie: { width: number; height: number; area: number };
  pieces: number;
  warnings: string[];
  notes: string[];
}

const PEG = 6;
/** Outline tolerance: far below print resolution, but keeps vertex counts (and time) low. */
const TOL = 0.03;
const PEG_CLEARANCE = 0.15;

export function buildCookie(k: ManifoldToplevel, source: CookieSource, p: CookieParams): CookieResult {
  const owned: { delete(): void }[] = [];
  const own = <T extends { delete(): void }>(x: T): T => {
    owned.push(x);
    return x;
  };
  const warnings: string[] = [];
  const notes: string[] = [];
  try {
    if (!source.polygons.length) throw new Error('There is no design yet. Pick a shape, type some text or upload a picture.');
    const raw = own(new k.CrossSection(source.polygons as SimplePolygon[], source.fillRule));
    if (raw.isEmpty() || raw.area() <= 0) throw new Error('The design has no filled area.');
    // Scale the design so the finished cookie's longest side is `size`.
    const rb = raw.bounds();
    const longest = Math.max(rb.max[0] - rb.min[0], rb.max[1] - rb.min[1]);
    const target = Math.max(5, p.size - 2 * p.outline);
    const s = target / longest;
    const cx = (rb.min[0] + rb.max[0]) / 2;
    const cy = (rb.min[1] + rb.max[1]) / 2;
    const art = own(own(raw.translate([-cx, -cy]).scale([p.mirror ? -s : s, s])).simplify(TOL));
    // The cut shape: the design's outer silhouette (holes filled), with the bubble margin and smoothing.
    const outer = art.toPolygons().filter((poly) => polyArea(poly) > 0);
    let cut = own(new k.CrossSection(outer, 'Positive'));
    if (p.outline > 0) cut = own(cut.offset(p.outline, 'Round', 2, 64));
    if (p.smoothing > 0)
      cut = own(
        own(
          own(own(cut.offset(p.smoothing, 'Round', 2, 48)).offset(-p.smoothing, 'Round', 2, 48)).offset(-p.smoothing, 'Round', 2, 48),
        ).offset(p.smoothing, 'Round', 2, 48),
      );
    if (cut.isEmpty()) throw new Error('The design is too thin to make a cookie at this size.');
    const cb = cut.bounds();
    const cookie = { width: cb.max[0] - cb.min[0], height: cb.max[1] - cb.min[1], area: cut.area() };
    const pieces = cut.decompose();
    pieces.forEach(own);
    const pieceCount = pieces.length;
    if (pieceCount > 1)
      warnings.push(
        `The outline has ${pieceCount} separate pieces, so the cutter makes ${pieceCount} cookies. Increase "Outline margin" to join them.`,
      );
    // Parts narrower than 5 mm break when the dough is lifted.
    const opened = own(own(cut.offset(-2.5, 'Round', 2, 32)).offset(2.5, 'Round', 2, 32));
    if (opened.area() < cut.area() * 0.97)
      warnings.push('Some parts of the cookie are narrower than 5 mm and may break. Try a larger size or more outline margin.');
    if (Math.max(cookie.width, cookie.height) + 2 * (p.blade + p.rimWidth) > 230)
      warnings.push('The cutter is larger than many build plates (230 mm).');

    const parts: CookiePart[] = [];
    let x = 0;
    const place = (id: CookiePart['id'], name: string, m: Manifold) => {
      const b = m.boundingBox();
      const moved = own(m.translate([x - b.min[0], -(b.min[1] + b.max[1]) / 2, -b.min[2]]));
      const mesh = manifoldToMeshData(moved);
      const r = validatePart(mesh);
      parts.push({
        id,
        name,
        mesh,
        size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
        volume: r.volume,
        watertight: r.watertight,
      });
      x += b.max[0] - b.min[0] + 12;
    };

    if (p.make !== 'stamp') {
      const blade = own(own(own(cut.offset(p.blade, 'Round', 2, 32)).simplify(TOL)).subtract(cut));
      const rim = own(own(own(cut.offset(p.blade + p.rimWidth, 'Round', 2, 32)).simplify(TOL)).subtract(cut));
      const cutter = own(own(k.Manifold.extrude(blade, p.cutterHeight)).add(own(k.Manifold.extrude(rim, p.rimHeight))));
      place('cutter', 'Cookie cutter', cutter);
    }

    if (p.make !== 'cutter') {
      const plate2d = own(own(cut.offset(-p.gap, 'Round', 2, 32)).simplify(TOL));
      if (plate2d.isEmpty()) throw new Error('The cookie is too small for a stamp with this gap.');
      const style = p.stampStyle === 'auto' ? (source.kind === 'text' || p.outline > 0 ? 'filled' : 'outline') : p.stampStyle;
      const w = p.lineWidth;
      let relief2d: CrossSection;
      if (style === 'filled') {
        relief2d = own(art.intersect(own(plate2d.offset(-0.8, 'Round', 2, 32))));
      } else {
        const lines = own(own(art.offset(w / 2, 'Round', 2, 32)).subtract(own(art.offset(-w / 2, 'Round', 2, 32))));
        const inset = 2.5;
        const border = own(own(plate2d.offset(-inset, 'Round', 2, 32)).subtract(own(plate2d.offset(-inset - w, 'Round', 2, 32))));
        relief2d = own(own(lines.add(border)).intersect(own(plate2d.offset(-w, 'Round', 2, 32))));
      }
      // Drop slivers too thin to print.
      relief2d = own(own(own(relief2d.offset(-0.2, 'Round', 2, 24)).offset(0.2, 'Round', 2, 24)).simplify(TOL));
      if (relief2d.isEmpty()) notes.push('The design has no inner detail, so the stamp is a plain plate. Try the "Filled" style.');
      let stamp = own(k.Manifold.extrude(plate2d, p.plateThickness));
      if (!relief2d.isEmpty())
        stamp = own(stamp.add(own(own(k.Manifold.extrude(relief2d, p.reliefHeight)).translate([0, 0, p.plateThickness]))));
      let handle: Manifold | null = null;
      if (p.handle) {
        const spot = deepestPoint(plate2d.toPolygons());
        const socketR = PEG / 2 + PEG_CLEARANCE;
        const socketDepth = Math.min(2.6, p.plateThickness - 1.2);
        if (!spot || spot.clearance < socketR + 1.5 || socketDepth < 1.5) {
          warnings.push('The stamp is too small or thin for a handle, so it has none.');
        } else {
          const socket = own(own(k.Manifold.cylinder(socketDepth + 0.01, socketR, socketR, 48)).translate([spot.x, spot.y, -0.01]));
          stamp = own(stamp.subtract(socket));
          const minSide = Math.min(cookie.width, cookie.height);
          const d = Math.min(26, Math.max(14, minSide * 0.35));
          const h = 16;
          const ch = 1.2;
          const body = own(own(k.Manifold.cylinder(h - ch, d / 2, d / 2, 64)).translate([0, 0, ch]));
          const chamfer = own(k.Manifold.cylinder(ch, d / 2 - ch, d / 2, 64));
          const peg = own(own(k.Manifold.cylinder(socketDepth - 0.3, PEG / 2, PEG / 2 - 0.2, 48)).translate([0, 0, h]));
          handle = own(own(body.add(chamfer)).add(peg));
          notes.push(
            `The handle's peg (Ø${PEG} mm) press-fits a Ø${(socketR * 2).toFixed(1)} mm socket in the back of the stamp. Add a drop of food-safe glue if it is loose.`,
          );
        }
      }
      place('stamp', 'Stamp', stamp);
      if (handle) place('handle', 'Stamp handle', handle);
    }
    return { parts, cookie, pieces: pieceCount, warnings, notes };
  } finally {
    for (const o of owned.reverse()) {
      try {
        o.delete();
      } catch {
        /* already freed */
      }
    }
  }
}

function polyArea(p: SimplePolygon): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** The point inside the polygons farthest from their edges (grid search). */
export function deepestPoint(polys: SimplePolygon[]): { x: number; y: number; clearance: number } | null {
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
  if (!Number.isFinite(minX)) return null;
  const N = 60;
  const step = Math.max(maxX - minX, maxY - minY) / N;
  let best: { x: number; y: number; clearance: number } | null = null;
  for (let gx = 0; gx <= N; gx++)
    for (let gy = 0; gy <= N; gy++) {
      const x = minX + gx * step;
      const y = minY + gy * step;
      let inside = false;
      let d = Infinity;
      for (const p of polys)
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          const [xi, yi] = p[i];
          const [xj, yj] = p[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
          const dx = xi - xj;
          const dy = yi - yj;
          const l2 = dx * dx + dy * dy || 1e-12;
          const t = Math.max(0, Math.min(1, ((x - xj) * dx + (y - yj) * dy) / l2));
          d = Math.min(d, Math.hypot(x - xj - t * dx, y - yj - t * dy));
        }
      if (inside && (!best || d > best.clearance)) best = { x, y, clearance: d };
    }
  return best;
}
