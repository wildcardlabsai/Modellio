import type { ManifoldToplevel } from 'manifold-3d';
import { manifoldToMeshData } from '@/cad/kernel/meshData';
import { validatePart } from '@/split/geometry/split';
import { designBounds, type DesignElement } from '../canvas/model';
import { buildKeyring, DEFAULT_KEYRING, type KeyringParams, type KeyringPart, type KeyringResult } from '../keyring/geometry';

/**
 * Signs: the keyring plate engine (raised / engraved / flush text, borders, two colours) plus
 * mounting — screw holes or keyhole slots cut through the plate — and an optional desk stand,
 * printed as a separate part with a slot the sign drops into.
 */
export interface SignParams extends KeyringParams {
  mount: {
    kind: 'none' | 'screw' | 'keyhole';
    /** Screw holes: 2 (left and right) or 4 (corners). Keyholes are always 2. */
    count: 2 | 4;
    /** Screw shank diameter (mm): the hole, and the narrow part of a keyhole. */
    diameter: number;
    /** Distance from the plate edge to the hole centre (mm). */
    inset: number;
  };
  stand: { enabled: boolean; angle: number };
}

export const DEFAULT_SIGN: SignParams = {
  ...DEFAULT_KEYRING,
  plateMode: 'elements',
  thickness: 4,
  raisedHeight: 1.6,
  engraveDepth: 1.2,
  border: { enabled: true, width: 2.5 },
  hole: { ...DEFAULT_KEYRING.hole, enabled: false },
  baseColour: '#1D1D1F',
  topColour: '#F4F4F2',
  mount: { kind: 'screw', count: 2, diameter: 4.5, inset: 10 },
  stand: { enabled: false, angle: 15 },
};

let n = 0;
const cut = (shape: string, x: number, y: number, w: number, h: number): DesignElement =>
  ({ id: `mount${n++}`, kind: 'shape', shape, role: 'cut', x, y, w, h, rotation: 0, name: 'Mounting' }) as DesignElement;

/** The sign's outline box (plate shapes, or the content plus the margin around it). */
export function signBounds(elements: DesignElement[], p: SignParams) {
  const front = elements.filter((e) => (e.side ?? 'front') === 'front');
  if (p.plateMode === 'elements') return designBounds(front.filter((e) => e.role === 'plate'));
  const b = designBounds(front.filter((e) => e.role !== 'cut'));
  return b && { minX: b.minX - p.margin, maxX: b.maxX + p.margin, minY: b.minY - p.margin, maxY: b.maxY + p.margin };
}

/** Mounting holes as through-cut elements, placed from the sign's outline. */
export function mountingCuts(elements: DesignElement[], p: SignParams): DesignElement[] {
  const b = signBounds(elements, p);
  if (!b || p.mount.kind === 'none') return [];
  const d = p.mount.diameter;
  const inset = Math.min(p.mount.inset, (b.maxX - b.minX) / 4, (b.maxY - b.minY) / 2);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const left = b.minX + inset;
  const right = b.maxX - inset;
  if (p.mount.kind === 'keyhole') {
    // A head-sized opening with a shank-wide slot rising from it: hang on a screw left proud of the wall.
    const head = d * 2;
    const top = b.maxY - inset;
    const slot = Math.max(d * 2, 7);
    return [left, right].flatMap((x) =>
      [cut('circle', x, top - slot, head, head), cut('pill', x, top - slot / 2, d, slot + d)].map((e, i) =>
        i === 1 ? ({ ...e, rotation: 90, w: slot + d, h: d } as DesignElement) : e,
      ),
    );
  }
  const points =
    p.mount.count === 4
      ? [
          [left, b.minY + inset],
          [right, b.minY + inset],
          [left, b.maxY - inset],
          [right, b.maxY - inset],
        ]
      : [
          [left, cy],
          [right, cy],
        ];
  void cx;
  return points.map(([x, y]) => cut('circle', x, y, d, d));
}

export interface SignResult extends KeyringResult {
  stand?: { slot: number; angle: number };
}

/** A desk stand: a block with a slot leaning back by `angle`, sized to the sign's thickness. */
function buildStand(k: ManifoldToplevel, signWidth: number, signThickness: number, angle: number): KeyringPart {
  const w = Math.max(30, Math.min(signWidth * 0.6, 160));
  const length = 34;
  const height = 16;
  const slotW = signThickness + 0.5;
  const block = k.Manifold.cube([w, length, height]);
  const slotBox = k.Manifold.cube([w + 2, slotW, 40]);
  const tilted = slotBox.rotate([-Math.min(Math.max(angle, 0), 30), 0, 0]);
  const slot = tilted.translate([-1, length * 0.38, 3]);
  const solid = block.subtract(slot);
  // Trim the front top edge to a 45° bevel so it prints cleanly and looks finished.
  const bevel = k.Manifold.cube([w + 2, 12, 12])
    .rotate([45, 0, 0])
    .translate([-1, 0, height - 0.5]);
  const stand = solid.subtract(bevel);
  const placed = stand.translate([-w / 2, -length / 2, 0]);
  try {
    const mesh = manifoldToMeshData(placed);
    const r = validatePart(mesh);
    const b = placed.boundingBox();
    return {
      id: 'stand',
      name: 'Desk stand',
      colour: '#9AA1AD',
      mesh,
      size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
      volume: r.volume,
      watertight: r.watertight,
    };
  } finally {
    for (const m of [block, slotBox, tilted, slot, solid, bevel, stand, placed]) m.delete();
  }
}

/** The sign: plate, text and mounting cuts via the plate engine; a desk stand beside it if asked. */
export function buildSign(k: ManifoldToplevel, elements: DesignElement[], p: SignParams): SignResult {
  const all = [...elements, ...mountingCuts(elements, p)];
  const result: SignResult = buildKeyring(k, all, { ...p, hole: { ...p.hole, enabled: false } });
  if (p.mount.kind === 'keyhole')
    result.notes.push(
      `Keyholes: leave each screw head about ${(p.thickness - 1).toFixed(0)} mm out from the wall, then hang the sign and slide it down.`,
    );
  if (p.mount.kind === 'screw')
    result.notes.push(
      `Screw holes are ${p.mount.diameter} mm across: use ${p.mount.diameter >= 4.5 ? 'No. 8 / M4' : 'No. 6 / M3'} screws with plugs suited to your wall.`,
    );
  if (p.stand.enabled) {
    const stand = buildStand(k, result.width, p.thickness, p.stand.angle);
    // Lay it out in front of the sign so both are visible and fit one plate.
    const dy = -(result.height / 2 + stand.size[1] / 2 + 10);
    const pos = stand.mesh.positions;
    for (let i = 1; i < pos.length; i += 3) pos[i] += dy;
    result.parts.push(stand);
    result.stand = { slot: p.thickness + 0.5, angle: p.stand.angle };
    result.notes.push(
      `The stand’s slot is ${(p.thickness + 0.5).toFixed(1)} mm wide (the sign plus 0.5 mm) and leans back ${p.stand.angle}°.`,
    );
  }
  return result;
}
