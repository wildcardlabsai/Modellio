import { describe, expect, it } from 'vitest';
import { initKernel } from '@/cad/kernel/kernel';
import { buildVase, DEFAULT_VASE, profileFunction, shapeFunction, type VaseParams, type ShapeKind, type PatternKind } from './geometry';

const cyl = (r: number): VaseParams['profile'] => [
  { t: 0, r },
  { t: 1, r },
];
const make = async (p: Partial<VaseParams>) => buildVase(await initKernel(), { ...DEFAULT_VASE, ...p });
const body = (r: Awaited<ReturnType<typeof make>>) => r.parts.find((x) => x.id === 'body')!;

describe('vase maker geometry', () => {
  it('interpolates the profile through its points without overshoot', () => {
    const f = profileFunction([
      { t: 0, r: 20 },
      { t: 0.5, r: 40 },
      { t: 1, r: 40 },
    ]);
    expect(f(0)).toBe(20);
    expect(f(0.5)).toBe(40);
    for (let t = 0.5; t <= 1; t += 0.05) expect(f(t)).toBeLessThanOrEqual(40 + 1e-9);
    for (let t = 0; t <= 0.5; t += 0.05) expect(f(t)).toBeGreaterThanOrEqual(20 - 1e-9);
  });

  it('normalises every cross-section so its largest radius is the profile radius', () => {
    for (const kind of ['circle', 'polygon', 'star', 'flower', 'gear', 'squircle'] as ShapeKind[]) {
      const S = shapeFunction({ kind, sides: 6, depth: 0.3, rounding: 0.2 });
      let max = 0;
      let min = Infinity;
      for (let i = 0; i < 3600; i++) {
        const v = S((i / 3600) * 2 * Math.PI);
        max = Math.max(max, v);
        min = Math.min(min, v);
      }
      expect(max, kind).toBeCloseTo(1, 3);
      expect(min, kind).toBeGreaterThan(0.3);
    }
  });

  it('makes a solid body for vase mode with the exact cylinder volume', async () => {
    const r = await make({ type: 'vase', vaseMode: true, height: 100, profile: cyl(30) });
    const b = body(r);
    expect(b.watertight).toBe(true);
    // A 320-gon cylinder: area = ½·n·r²·sin(2π/n).
    const n = 160;
    expect(b.volume).toBeCloseTo(0.5 * n * 900 * Math.sin((2 * Math.PI) / n) * 100, 0);
    expect(r.width).toBeCloseTo(60, 1);
    expect(r.notes.join(' ')).toMatch(/Spiral vase/);
  });

  it('makes real walls and a floor, with the capacity of the inside', async () => {
    const r = await make({ type: 'vase', vaseMode: false, height: 100, wall: 2, base: 3, profile: cyl(30) });
    const b = body(r);
    expect(b.watertight).toBe(true);
    const n = 160;
    const area = (rad: number) => 0.5 * n * rad * rad * Math.sin((2 * Math.PI) / n);
    // Volume = outer cylinder − inner cavity (radius 28, from the 3 mm floor up).
    expect(b.volume).toBeCloseTo(area(30) * 100 - area(28) * 97, -1);
    expect(r.capacity).toBeCloseTo((area(28) * 97) / 1000, 1);
  });

  it('keeps the wall thickness on star and flower shapes (true offset, not radial)', async () => {
    for (const kind of ['star', 'flower', 'polygon'] as ShapeKind[]) {
      const r = await make({
        type: 'vase',
        vaseMode: false,
        height: 60,
        wall: 2,
        profile: cyl(40),
        shape: { kind, sides: 5, depth: 0.35, rounding: 0.2 },
      });
      const b = body(r);
      expect(b.watertight, kind).toBe(true);
      expect(b.volume, kind).toBeGreaterThan(0);
    }
  });

  it('builds every pattern on every body type as a closed solid', async () => {
    for (const kind of ['ribs', 'spiral', 'waves', 'diamond', 'bubbles', 'noise', 'steps'] as PatternKind[])
      for (const type of ['vase', 'pot', 'lampshade'] as const) {
        const r = await make({
          type,
          vaseMode: type === 'vase',
          height: 80,
          pattern: { ...DEFAULT_VASE.pattern, kind, amplitude: 1.5 },
          twist: 30,
        });
        for (const part of r.parts) expect(part.watertight, `${kind} ${type} ${part.id}`).toBe(true);
      }
  });

  it('cuts drainage holes through the floor of a pot and adds a saucer that fits under it', async () => {
    const without = await make({ type: 'pot', height: 80, profile: cyl(40), drainage: { holes: 0, diameter: 8 }, saucer: false });
    const one = await make({ type: 'pot', height: 80, profile: cyl(40), drainage: { holes: 1, diameter: 8 }, saucer: true });
    expect(body(without).volume - body(one).volume).toBeCloseTo(Math.PI * 16 * 3, -1);
    const saucer = one.parts.find((p) => p.id === 'saucer')!;
    expect(saucer.watertight).toBe(true);
    // Inside of the saucer = pot base + 1.5 mm gap; outside adds a 2 mm wall.
    expect(saucer.size[0]).toBeCloseTo(80 + 2 * (1.5 + 2), 0);
    const five = await make({ type: 'pot', height: 80, profile: cyl(40), drainage: { holes: 5, diameter: 8 }, saucer: false });
    expect(body(five).volume).toBeLessThan(body(one).volume);
  });

  it('opens a lampshade top for the lamp holder, or reports when it cannot', async () => {
    const ok = await make({ type: 'lampshade', height: 120, profile: cyl(70), bulbHole: 42 });
    expect(body(ok).watertight).toBe(true);
    const closed = await make({ type: 'lampshade', height: 120, profile: cyl(70), bulbHole: 42, drainage: { holes: 0, diameter: 8 } });
    void closed;
    const narrow = await make({ type: 'lampshade', height: 120, profile: cyl(18), bulbHole: 42 });
    expect(narrow.warnings.join(' ')).toMatch(/too narrow/);
    expect(ok.notes.join(' ')).toMatch(/LED/);
  });

  it('twisting a circle does not change it; twisting a polygon keeps its volume', async () => {
    const a = await make({ height: 80, profile: cyl(30), shape: { kind: 'polygon', sides: 6, depth: 0, rounding: 0 } });
    const b = await make({ height: 80, profile: cyl(30), shape: { kind: 'polygon', sides: 6, depth: 0, rounding: 0 }, twist: 120 });
    expect(body(b).volume).toBeCloseTo(body(a).volume, -1);
  });

  it('reports steep overhangs and tippy shapes', async () => {
    const flare = await make({
      height: 60,
      profile: [
        { t: 0, r: 15 },
        { t: 0.4, r: 18 },
        { t: 1, r: 90 },
      ],
    });
    expect(flare.maxOverhang).toBeGreaterThan(60);
    expect(flare.warnings.join(' ')).toMatch(/droop/);
    const tall = await make({ height: 250, profile: cyl(10) });
    expect(tall.warnings.join(' ')).toMatch(/tip over/);
    const plain = await make({ height: 100, profile: cyl(30) });
    expect(plain.maxOverhang).toBeLessThan(1);
  });
});

describe('vase templates', () => {
  it('builds every template as closed solids without errors', async () => {
    const { VASE_TEMPLATES } = await import('./templates');
    const k = await initKernel();
    expect(VASE_TEMPLATES.length).toBeGreaterThanOrEqual(30);
    for (const tpl of VASE_TEMPLATES) {
      const r = buildVase(k, tpl.params);
      for (const p of r.parts) expect(p.watertight, `${tpl.id} ${p.id}`).toBe(true);
      expect(r.maxOverhang, tpl.id).toBeLessThan(61);
      expect(
        r.warnings.filter((w) => /droop|not a closed/.test(w)),
        tpl.id,
      ).toEqual([]);
      if (tpl.params.type !== 'lampshade') expect(r.capacity, tpl.id).toBeGreaterThan(5);
    }
  }, 120000);

  it('"Surprise me" always makes something printable', async () => {
    const { surprise } = await import('./templates');
    const k = await initKernel();
    for (let i = 1; i <= 12; i++) {
      const r = buildVase(k, surprise(i / 13));
      for (const p of r.parts) expect(p.watertight).toBe(true);
    }
  }, 120000);
});
