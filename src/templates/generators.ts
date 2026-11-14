import type { EditorState } from '@/store/editorStore';
import type { ObjectId } from '@/types/document';
import { combine, part } from './templates';

export interface BoxLidOptions {
  /** Inside of the box (mm). */
  width: number;
  depth: number;
  height: number;
  wall: number;
  /** Depth of the lid's lip that sits inside the box (mm). */
  lip: number;
  /** Gap between the lip and the box wall, per side (mm). Printers vary: 0.15–0.4 is typical. */
  clearance: number;
  radius: number;
}

export const DEFAULT_BOX_LID: BoxLidOptions = { width: 60, depth: 40, height: 30, wall: 2, lip: 5, clearance: 0.25, radius: 3 };

/**
 * A box and a lid that fits it, built from ordinary editable shapes and real Booleans
 * (hollow box, plate + lip ring), laid side by side ready to print — the box open side up,
 * the lid lip up.
 */
export async function buildBoxAndLid(e: EditorState, o: BoxLidOptions): Promise<{ box: ObjectId; lid: ObjectId }> {
  const W = o.width + 2 * o.wall;
  const D = o.depth + 2 * o.wall;
  const H = o.height + o.wall;
  const r = Math.min(o.radius, W / 2 - 0.5, D / 2 - 0.5);
  const box = part(e, 'box', [W, D, H], [-(W / 2 + 5), 0, H / 2], {
    name: 'Box',
    color: '#2463EB',
    params: { shell: o.wall, openTop: 1, radius: r },
  });
  e.rename(box, 'Box');
  const lx = W / 2 + 5;
  const lipW = o.width - 2 * o.clearance;
  const lipD = o.depth - 2 * o.clearance;
  const plate = part(e, 'box', [W, D, o.wall], [lx, 0, o.wall / 2], { name: 'Lid plate', color: '#7C3AED', params: { radius: r } });
  const lip = part(e, 'box', [lipW, lipD, o.lip], [lx, 0, o.wall + o.lip / 2], {
    name: 'Lid lip',
    color: '#7C3AED',
    params: { radius: Math.max(0, r - o.wall - o.clearance) },
  });
  const cut = part(e, 'box', [lipW - 2 * o.wall, lipD - 2 * o.wall, o.lip + 0.02], [lx, 0, o.wall + o.lip / 2 + 0.01], {
    name: 'Lip hollow',
    hole: true,
    params: { radius: Math.max(0, r - 2 * o.wall - o.clearance) },
  });
  const lid = combine(e, [plate, lip, cut], 'Lid');
  e.select([box, lid]);
  return { box, lid };
}
