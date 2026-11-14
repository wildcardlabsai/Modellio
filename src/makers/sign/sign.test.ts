import { describe, expect, it } from 'vitest';
import { initKernel } from '@/cad/kernel/kernel';
import type { DesignElement } from '../canvas/model';
import { buildSign, DEFAULT_SIGN, mountingCuts, type SignParams } from './geometry';

const plate = (w = 120, h = 60) =>
  ({ id: 'p', kind: 'shape', shape: 'rect', role: 'plate', x: 0, y: 0, w, h, rotation: 0 }) as DesignElement;
const make = async (p: Partial<SignParams>) =>
  buildSign(await initKernel(), [plate()], {
    ...DEFAULT_SIGN,
    border: { enabled: false, width: 2 },
    twoColour: false,
    ...p,
    mount: { ...DEFAULT_SIGN.mount, ...p.mount },
    stand: { ...DEFAULT_SIGN.stand, ...p.stand },
  });

describe('sign maker', () => {
  it('cuts two screw holes through the plate', async () => {
    const none = await make({ mount: { ...DEFAULT_SIGN.mount, kind: 'none' } });
    const two = await make({ mount: { ...DEFAULT_SIGN.mount, kind: 'screw', count: 2, diameter: 5 } });
    expect(none.parts[0].volume).toBeCloseTo(120 * 60 * 4, -1);
    const hole = Math.PI * 2.5 * 2.5 * 4;
    expect(none.parts[0].volume - two.parts[0].volume).toBeCloseTo(2 * hole, -1);
    for (const p of two.parts) expect(p.watertight).toBe(true);
    expect(two.notes.some((n) => /Screw holes are 5 mm/.test(n))).toBe(true);
  });

  it('places four holes at the corners, inset from the edges', () => {
    const cuts = mountingCuts([plate()], { ...DEFAULT_SIGN, mount: { kind: 'screw', count: 4, diameter: 4, inset: 10 } });
    expect(cuts.map((c) => [c.x, c.y])).toEqual([
      [-50, -20],
      [50, -20],
      [-50, 20],
      [50, 20],
    ]);
  });

  it('keyhole slots: a head opening with a narrower slot above it', async () => {
    const r = await make({ mount: { kind: 'keyhole', count: 2, diameter: 4, inset: 10 } });
    expect(r.parts[0].watertight).toBe(true);
    expect(mountingCuts([plate()], { ...DEFAULT_SIGN, mount: { kind: 'keyhole', count: 2, diameter: 4, inset: 10 } })).toHaveLength(4);
    expect(r.notes.some((n) => /Keyholes/.test(n))).toBe(true);
  });

  it('adds a watertight desk stand with a slot for the sign', async () => {
    const r = await make({ mount: { ...DEFAULT_SIGN.mount, kind: 'none' }, stand: { enabled: true, angle: 15 } });
    const stand = r.parts.find((p) => p.id === 'stand')!;
    expect(stand.watertight).toBe(true);
    expect(stand.size[2]).toBeCloseTo(16, 1);
    // The slot removes material: less than the full block.
    expect(stand.volume).toBeLessThan(stand.size[0] * 34 * 16 * 0.95);
    expect(r.stand?.slot).toBeCloseTo(4.5);
  });
});
