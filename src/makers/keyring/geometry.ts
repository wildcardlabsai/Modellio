import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { manifoldToMeshData, type MeshData } from '@/cad/kernel/meshData';
import { validatePart } from '@/split/geometry/split';
import { unionOf, type DesignElement } from '../canvas/model';

/**
 * Keyring and name tag geometry. Element roles:
 *  - plate:    the tag's shape (ignored when the plate is a bubble around the content)
 *  - raised:   stands up from the plate (second colour)
 *  - engraved: cut into the plate
 *  - inlay:    flush second-colour areas (a shallow pocket filled with the top colour)
 *  - cut:      holes through the plate
 * Millimetres, printed flat on the bed.
 */
export type KeyringRole = 'plate' | 'raised' | 'engraved' | 'inlay' | 'cut';

export interface KeyringParams {
  plateMode: 'elements' | 'bubble';
  /** Bubble margin around the content (mm). */
  margin: number;
  thickness: number;
  raisedHeight: number;
  engraveDepth: number;
  inlayDepth: number;
  border: { enabled: boolean; width: number };
  hole: { enabled: boolean; x: number; y: number; diameter: number; rim: number };
  twoColour: boolean;
  baseColour: string;
  topColour: string;
}

export const DEFAULT_KEYRING: KeyringParams = {
  plateMode: 'bubble',
  margin: 3,
  thickness: 3,
  raisedHeight: 1.2,
  engraveDepth: 0.8,
  inlayDepth: 0.6,
  border: { enabled: false, width: 1.2 },
  hole: { enabled: true, x: -38, y: 0, diameter: 5, rim: 2.5 },
  twoColour: true,
  baseColour: '#F4F4F2',
  topColour: '#2463EB',
};

export interface KeyringPart {
  id: 'base' | 'top' | 'tag';
  name: string;
  colour: string;
  mesh: MeshData;
  size: [number, number, number];
  volume: number;
  watertight: boolean;
}

export interface KeyringResult {
  parts: KeyringPart[];
  width: number;
  height: number;
  thickness: number;
  /** The plate's outline (after holes), for drawing on the design canvas. */
  outline: [number, number][][];
  warnings: string[];
  notes: string[];
}

export function buildKeyring(k: ManifoldToplevel, elements: DesignElement[], p: KeyringParams): KeyringResult {
  const owned: { delete(): void }[] = [];
  const own = <T extends { delete(): void }>(x: T): T => {
    owned.push(x);
    return x;
  };
  const warnings: string[] = [];
  const notes: string[] = [];
  try {
    const raised = own(unionOf(k, elements, ['raised']));
    const engraved = own(unionOf(k, elements, ['engraved']));
    const inlay = own(unionOf(k, elements, ['inlay']));
    const cuts = own(unionOf(k, elements, ['cut']));
    let plate: CrossSection;
    if (p.plateMode === 'bubble') {
      const content = own(unionOf(k, elements, ['plate', 'raised', 'engraved', 'inlay']));
      if (content.isEmpty()) throw new Error('Add some text or a shape to make a tag.');
      plate = own(own(own(content.offset(p.margin + 1.5, 'Round', 2, 48)).offset(-1.5, 'Round', 2, 48)).simplify(0.02));
    } else {
      plate = own(unionOf(k, elements, ['plate']));
      if (plate.isEmpty())
        throw new Error('There is no plate. Add a shape and set its role to "Plate", or switch the plate to "Around the content".');
    }
    // The ring: a reinforced tab around the hole.
    let holeCs: CrossSection | null = null;
    if (p.hole.enabled) {
      const r = p.hole.diameter / 2;
      const tab = own(own(k.CrossSection.circle(r + p.hole.rim, 48)).translate([p.hole.x, p.hole.y]));
      if (own(tab.intersect(plate)).isEmpty()) warnings.push('The ring is not touching the tag. Drag it onto the edge of the tag.');
      plate = own(plate.add(tab));
      holeCs = own(own(k.CrossSection.circle(r, 48)).translate([p.hole.x, p.hole.y]));
      if (p.hole.rim < 1.5) warnings.push('The ring is thinner than 1.5 mm around the hole and may snap.');
      if (p.hole.diameter < 3) warnings.push('The hole is smaller than 3 mm; most key rings won’t fit.');
    }
    let through = cuts;
    if (holeCs) through = own(through.add(holeCs));
    const plate2d = own(plate.subtract(through));
    if (plate2d.isEmpty()) throw new Error('Nothing is left of the plate after the holes.');
    const pb = plate2d.bounds();

    // Base: the plate, minus engraving and inlay pockets.
    let base: Manifold = own(k.Manifold.extrude(plate2d, p.thickness));
    const inner = own(plate2d.offset(-0.6, 'Round', 2, 32));
    const engr = own(engraved.intersect(inner));
    if (!engr.isEmpty()) {
      const depth = Math.min(p.engraveDepth, p.thickness - 0.8);
      base = own(base.subtract(own(own(k.Manifold.extrude(engr, depth + 0.01)).translate([0, 0, p.thickness - depth]))));
    }
    const inl = own(own(inlay.intersect(inner)).subtract(engr));
    const inlayDepth = Math.min(p.inlayDepth, p.thickness - 0.8);
    if (!inl.isEmpty())
      base = own(base.subtract(own(own(k.Manifold.extrude(inl, inlayDepth + 0.01)).translate([0, 0, p.thickness - inlayDepth]))));

    // Top colour: raised areas (clipped to the plate), an optional border, and the inlay fill.
    let top2d = own(own(raised.intersect(plate2d)).subtract(engr));
    if (p.border.enabled) {
      const rim = own(plate.subtract(own(plate.offset(-p.border.width, 'Round', 2, 32))));
      top2d = own(top2d.add(own(rim.subtract(through))));
    }
    const parts: Manifold[] = [];
    if (!top2d.isEmpty()) parts.push(own(own(k.Manifold.extrude(top2d, p.raisedHeight)).translate([0, 0, p.thickness])));
    if (!inl.isEmpty()) parts.push(own(own(k.Manifold.extrude(inl, inlayDepth)).translate([0, 0, p.thickness - inlayDepth])));
    const top = parts.length ? own(k.Manifold.union(parts)) : null;

    // Detail check: strokes thinner than a 0.4 mm nozzle line are lost.
    const detail = own(top2d.add(engr));
    if (!detail.isEmpty()) {
      const kept = own(own(detail.offset(-0.4, 'Round', 2, 16)).offset(0.4, 'Round', 2, 16));
      if (kept.area() < detail.area() * 0.92)
        warnings.push('Some lettering or detail is thinner than 0.8 mm and may not print. Make it bigger or choose a bolder font.');
    }
    if (p.thickness < 1.6) warnings.push('A plate thinner than 1.6 mm bends easily.');

    const out: KeyringPart[] = [];
    const add = (id: KeyringPart['id'], name: string, colour: string, m: Manifold) => {
      const mesh = manifoldToMeshData(m);
      const r = validatePart(mesh);
      const b = m.boundingBox();
      out.push({
        id,
        name,
        colour,
        mesh,
        size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
        volume: r.volume,
        watertight: r.watertight,
      });
    };
    if (p.twoColour && top) {
      add('base', 'Base', p.baseColour, base);
      add('top', 'Top colour', p.topColour, top);
      const swap = !inl.isEmpty() ? p.thickness - inlayDepth : p.thickness;
      notes.push(
        `One nozzle? Add a filament change (pause) at ${swap.toFixed(2)} mm and swap to the top colour. With an AMS or MMU, the two parts are ready as separate colours in the 3MF.`,
      );
    } else {
      add('tag', 'Tag', p.baseColour, top ? own(base.add(top)) : base);
    }
    return {
      parts: out,
      width: pb.max[0] - pb.min[0],
      height: pb.max[1] - pb.min[1],
      thickness: p.thickness + (top2d.isEmpty() ? 0 : p.raisedHeight),
      outline: plate2d.toPolygons().map((poly) => poly.map(([x, y]) => [x, y] as [number, number])),
      warnings,
      notes,
    };
  } finally {
    for (const o of owned.reverse())
      try {
        o.delete();
      } catch {
        /* freed */
      }
  }
}
