import { describe, expect, it } from 'vitest';
import { initKernel } from '@/cad/kernel/kernel';
import { buildKeyring, DEFAULT_KEYRING, type KeyringParams } from './geometry';
import { boxCorners, designBounds, unionOf, worldPolygons, type DesignElement } from '../canvas/model';

const shape = (shape: string, role: string, o: Partial<DesignElement> = {}): DesignElement =>
  ({ id: Math.random().toString(36), kind: 'shape', shape, role, x: 0, y: 0, w: 40, h: 20, rotation: 0, ...o }) as DesignElement;
const make = async (els: DesignElement[], p: Partial<KeyringParams> = {}) =>
  buildKeyring(await initKernel(), els, { ...DEFAULT_KEYRING, ...p, hole: { ...DEFAULT_KEYRING.hole, ...p.hole } });

describe('design canvas model', () => {
  it('places, sizes, rotates and flips elements in millimetres', () => {
    const el = shape('rect', 'plate', { x: 10, y: 5, w: 40, h: 20, rotation: 90 });
    const b = designBounds([el])!;
    expect(b.maxX - b.minX).toBeCloseTo(20, 6);
    expect(b.maxY - b.minY).toBeCloseTo(40, 6);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(10, 6);
    const polys = worldPolygons(el)!;
    const xs = polys[0].map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(20, 6);
    expect(boxCorners(el)).toHaveLength(4);
    // Flipping keeps the polygon counter-clockwise (positive area).
    const flipped = worldPolygons({ ...el, rotation: 0, flipX: true })![0];
    let a = 0;
    for (let i = 0; i < flipped.length; i++) {
      const [x0, y0] = flipped[i];
      const [x1, y1] = flipped[(i + 1) % flipped.length];
      a += x0 * y1 - x1 * y0;
    }
    expect(a).toBeGreaterThan(0);
  });

  it('unions elements by role, and turns freehand strokes into outlines', async () => {
    const k = await initKernel();
    const els = [
      shape('rect', 'a', { w: 10, h: 10 }),
      shape('rect', 'a', { x: 5, w: 10, h: 10 }),
      shape('rect', 'b', { x: 100, w: 10, h: 10 }),
      {
        id: 'd',
        kind: 'draw',
        role: 'a',
        x: 0,
        y: 30,
        w: 20,
        h: 0.5,
        rotation: 0,
        width: 2,
        points: [
          [-0.5, 0],
          [0.5, 0],
        ],
      } as DesignElement,
    ];
    const cs = unionOf(k, els, ['a']);
    // 15 × 10 union + a 20 mm stroke 2 mm wide with round ends.
    expect(cs.area()).toBeCloseTo(150 + 20 * 2 + Math.PI, 0);
    cs.delete();
  });
});

describe('keyring geometry', () => {
  it('makes a plate with a ring, as closed solids, with the hole through it', async () => {
    const r = await make([shape('rounded', 'plate', { w: 60, h: 25 }), shape('star', 'raised', { w: 14, h: 14 })], {
      plateMode: 'elements',
      hole: { enabled: true, x: -30, y: 0, diameter: 5, rim: 2.5 } as KeyringParams['hole'],
    });
    expect(r.parts.map((p) => p.id)).toEqual(['base', 'top']);
    for (const p of r.parts) expect(p.watertight, p.id).toBe(true);
    const base = r.parts[0];
    expect(base.size[2]).toBeCloseTo(3, 6);
    expect(r.parts[1].size[2]).toBeCloseTo(1.2, 6);
    // The tab sticks out past the plate's left edge.
    expect(r.width).toBeCloseTo(60 / 2 + 30 + 2.5 + 2.5, 0);
    expect(r.notes.join(' ')).toMatch(/3\.00 mm/);
  });

  it('builds a bubble plate around the content with the margin', async () => {
    const r = await make([shape('rect', 'raised', { w: 40, h: 10 })], {
      plateMode: 'bubble',
      margin: 3,
      hole: { enabled: false } as KeyringParams['hole'],
    });
    expect(r.width).toBeCloseTo(46, 1);
    expect(r.height).toBeCloseTo(16, 1);
  });

  it('engraves into the plate and fills inlays flush', async () => {
    const plate = shape('rect', 'plate', { w: 50, h: 30 });
    const plain = await make([plate], { plateMode: 'elements', hole: { enabled: false } as KeyringParams['hole'], twoColour: false });
    const engraved = await make([plate, shape('rect', 'engraved', { w: 20, h: 10 })], {
      plateMode: 'elements',
      hole: { enabled: false } as KeyringParams['hole'],
      twoColour: false,
    });
    expect(plain.parts[0].volume - engraved.parts[0].volume).toBeCloseTo(20 * 10 * 0.8, 1);
    const inlay = await make([plate, shape('rect', 'inlay', { w: 20, h: 10 })], {
      plateMode: 'elements',
      hole: { enabled: false } as KeyringParams['hole'],
    });
    const [base, top] = inlay.parts;
    expect(top.volume).toBeCloseTo(20 * 10 * 0.6, 1);
    expect(base.volume + top.volume).toBeCloseTo(plain.parts[0].volume, 1);
    expect(top.size[2]).toBeCloseTo(0.6, 5);
    expect(inlay.notes.join(' ')).toMatch(/2\.40 mm/);
  });

  it('adds a raised border and cut-through holes', async () => {
    const plate = shape('rect', 'plate', { w: 50, h: 30 });
    const r = await make([plate, shape('circle', 'cut', { x: 10, w: 8, h: 8 })], {
      plateMode: 'elements',
      border: { enabled: true, width: 1.5 },
      hole: { enabled: false } as KeyringParams['hole'],
    });
    const [base, top] = r.parts;
    const ring = Math.PI * 16;
    expect(base.volume).toBeCloseTo((1500 - ring * 0.995) * 3, -1);
    expect(top.volume).toBeCloseTo((1500 - 47 * 27) * 1.2, 0);
  });

  it('warns about a detached ring, a thin rim and fine detail', async () => {
    const r = await make([shape('rect', 'plate', { w: 40, h: 20 }), shape('rect', 'raised', { w: 20, h: 0.5 })], {
      plateMode: 'elements',
      hole: { enabled: true, x: -60, y: 0, diameter: 2, rim: 1 } as KeyringParams['hole'],
    });
    const w = r.warnings.join(' ');
    expect(w).toMatch(/not touching/);
    expect(w).toMatch(/thinner than 1\.5 mm/);
    expect(w).toMatch(/smaller than 3 mm/);
    expect(w).toMatch(/thinner than 0\.8 mm/);
  });

  it('explains an empty design', async () => {
    await expect(make([], { plateMode: 'bubble' })).rejects.toThrow(/Add some text/);
    await expect(make([shape('rect', 'raised')], { plateMode: 'elements' })).rejects.toThrow(/no plate/);
  });
});

describe('keyring templates', () => {
  it('builds every shape-only template piece and has enough templates', async () => {
    const { KEYRING_TEMPLATES, KEYRING_CATEGORIES } = await import('./templates');
    expect(KEYRING_TEMPLATES.length).toBeGreaterThanOrEqual(25);
    for (const c of KEYRING_CATEGORIES) expect(KEYRING_TEMPLATES.some((t) => t.category === c)).toBe(true);
    const detached: string[] = [];
    // Text needs fonts (browser); build the templates with their shapes only to check plates and rings.
    for (const t of KEYRING_TEMPLATES) {
      const shapes = t.elements.filter((e) => e.kind !== 'text');
      if (t.params.plateMode === 'bubble' || !shapes.some((e) => e.role === 'plate')) continue;
      const r = await make(shapes, t.params as KeyringParams);
      for (const p of r.parts) expect(p.watertight, `${t.id} ${p.id}`).toBe(true);
      if (r.warnings.some((w) => /not touching/.test(w))) detached.push(t.id);
    }
    expect(detached).toEqual([]);
  });
});
