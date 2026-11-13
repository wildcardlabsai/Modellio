import { applyToPoint, multiply, rotationBetween, translation } from '../model/mat4';
import type { Mat4 } from '../model/types';
import type { SplitPart, Vec3 } from './types';

/**
 * Print layout: orient each part for printing and pack the parts onto build plates.
 * This is a separate transform per part; it never changes part geometry, and the
 * explode view (display only) never feeds into it.
 */
export interface PlateSettings {
  /** Build plate size in mm. */
  width: number;
  depth: number;
  /** Gap between parts (mm). */
  spacing: number;
  /** One colour per plate (for single-colour printers). */
  groupByColour: boolean;
  /** "flat": lay each part on its largest flat face; "assembly": keep the assembled orientation. */
  orientation: 'flat' | 'assembly';
}

export const DEFAULT_PLATE_SETTINGS: PlateSettings = { width: 256, depth: 256, spacing: 6, groupByColour: true, orientation: 'flat' };

export const PLATE_PRESETS: { id: string; label: string; width: number; depth: number }[] = [
  { id: 'bambu-x1', label: 'Bambu X1 / P1 / A1 (256 × 256)', width: 256, depth: 256 },
  { id: 'bambu-a1mini', label: 'Bambu A1 mini (180 × 180)', width: 180, depth: 180 },
  { id: 'prusa-mk4', label: 'Prusa MK4 (250 × 210)', width: 250, depth: 210 },
  { id: 'prusa-mini', label: 'Prusa MINI (180 × 180)', width: 180, depth: 180 },
  { id: 'ender3', label: 'Ender 3 (220 × 220)', width: 220, depth: 220 },
];

export interface Placement {
  partId: string;
  plate: number;
  /** Assembly coordinates → plate coordinates (plate origin at its front-left corner, bed at z = 0). */
  transform: Mat4;
  size: Vec3;
  /** Larger than the plate: placed alone and reported. */
  oversize: boolean;
  /** Contact area with the bed (mm²). */
  contactArea: number;
}

export interface Plate {
  index: number;
  name: string;
  materialId: number | null;
  colour: string | null;
  partIds: string[];
}

export interface Layout {
  plates: Plate[];
  placements: Record<string, Placement>;
  warnings: string[];
}

const DOWN: Vec3 = [0, 0, -1];

/** The best "down" direction: the one whose extreme plane carries the most surface area. */
export function chooseDown(part: SplitPart): { down: Vec3; contact: number } {
  const p = part.mesh.positions;
  const ix = part.mesh.indices;
  const candidates: Vec3[] = [DOWN, [0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
  for (const c of part.caps) if (c.deviation < 0.05) candidates.push(c.normal);
  const score = (d: Vec3) => {
    let extreme = -Infinity;
    for (let i = 0; i < p.length; i += 3) extreme = Math.max(extreme, p[i] * d[0] + p[i + 1] * d[1] + p[i + 2] * d[2]);
    const tol = 0.02;
    let area = 0;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3;
      const b = ix[t + 1] * 3;
      const c = ix[t + 2] * 3;
      const ha = p[a] * d[0] + p[a + 1] * d[1] + p[a + 2] * d[2];
      const hb = p[b] * d[0] + p[b + 1] * d[1] + p[b + 2] * d[2];
      const hc = p[c] * d[0] + p[c + 1] * d[1] + p[c + 2] * d[2];
      if (extreme - ha > tol || extreme - hb > tol || extreme - hc > tol) continue;
      const ux = p[b] - p[a];
      const uy = p[b + 1] - p[a + 1];
      const uz = p[b + 2] - p[a + 2];
      const wx = p[c] - p[a];
      const wy = p[c + 1] - p[a + 1];
      const wz = p[c + 2] - p[a + 2];
      const nx = uy * wz - uz * wy;
      const ny = uz * wx - ux * wz;
      const nz = ux * wy - uy * wx;
      // Only faces that face the bed count.
      if (nx * d[0] + ny * d[1] + nz * d[2] > 0) area += Math.hypot(nx, ny, nz) / 2;
    }
    return area;
  };
  const scores = candidates.map(score);
  let best = 0;
  for (let i = 1; i < candidates.length; i++) if (scores[i] > scores[best] * 1.02) best = i;
  // Keep the assembled orientation unless another face is clearly better.
  if (scores[0] >= scores[best] * 0.9) best = 0;
  return { down: candidates[best], contact: scores[best] };
}

function orientedBounds(part: SplitPart, m: Mat4): { min: Vec3; max: Vec3 } {
  const p = part.mesh.positions;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const q = [0, 0, 0];
  for (let i = 0; i < p.length; i += 3) {
    applyToPoint(m, p[i], p[i + 1], p[i + 2], q);
    for (let k = 0; k < 3; k++) {
      if (q[k] < min[k]) min[k] = q[k];
      if (q[k] > max[k]) max[k] = q[k];
    }
  }
  return { min, max };
}

export function layoutPlates(parts: SplitPart[], s: PlateSettings): Layout {
  const warnings: string[] = [];
  const placements: Record<string, Placement> = {};
  const oriented = parts.map((part) => {
    const { down, contact } = s.orientation === 'flat' ? chooseDown(part) : { down: DOWN, contact: 0 };
    const rot = rotationBetween(down, DOWN);
    const b = orientedBounds(part, rot);
    return { part, rot, b, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] as Vec3, contact };
  });
  const groups = new Map<string, typeof oriented>();
  for (const o of oriented) {
    const key = s.groupByColour ? `m${o.part.materialId}` : 'all';
    let l = groups.get(key);
    if (!l) groups.set(key, (l = []));
    l.push(o);
  }
  const plates: Plate[] = [];
  for (const [key, list] of groups) {
    const first = list[0].part;
    const label = s.groupByColour ? first.materialName : 'All colours';
    list.sort((a, b) => b.size[1] - a.size[1] || b.size[0] - a.size[0]);
    let plate: Plate | null = null;
    let x = 0;
    let y = 0;
    let rowDepth = 0;
    const newPlate = () => {
      const count = plates.filter((p) => p.name.startsWith(label)).length;
      plate = {
        index: plates.length,
        name: count ? `${label} (${count + 1})` : label,
        materialId: s.groupByColour ? first.materialId : null,
        colour: s.groupByColour ? first.colour : null,
        partIds: [],
      };
      plates.push(plate);
      x = y = rowDepth = 0;
      return plate;
    };
    for (const o of list) {
      const [w, d] = o.size;
      const oversize = w > s.width || d > s.depth;
      if (oversize) {
        const p = newPlate();
        place(o, p, (s.width - w) / 2, (s.depth - d) / 2, true);
        warnings.push(`"${o.part.name}" (${w.toFixed(0)} × ${d.toFixed(0)} mm) is larger than the plate.`);
        plate = null;
        continue;
      }
      if (!plate) newPlate();
      if (x > 0 && x + w > s.width) {
        x = 0;
        y += rowDepth + s.spacing;
        rowDepth = 0;
      }
      if (y + d > s.depth) newPlate();
      place(o, plate!, x, y, false);
      x += w + s.spacing;
      rowDepth = Math.max(rowDepth, d);
    }
    void key;
  }
  function place(o: (typeof oriented)[number], p: Plate, x: number, y: number, oversize: boolean) {
    const t = translation(x - o.b.min[0], y - o.b.min[1], -o.b.min[2]);
    placements[o.part.partId] = {
      partId: o.part.partId,
      plate: p.index,
      transform: multiply(t, o.rot),
      size: o.size,
      oversize,
      contactArea: o.contact,
    };
    p.partIds.push(o.part.partId);
  }
  return { plates, placements, warnings };
}

/** Where plate i is drawn in the viewport (plates side by side along X). */
export function plateOffset(i: number, s: PlateSettings): Vec3 {
  return [i * (s.width + 24), 0, 0];
}
