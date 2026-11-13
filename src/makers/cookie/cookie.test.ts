import { describe, expect, it } from 'vitest';
import { initKernel } from '@/cad/kernel/kernel';
import { buildCookie, DEFAULT_COOKIE_PARAMS, type CookieParams, type CookieSource } from './geometry';
import { capsule, shapeById, SHAPES } from './shapes';
import { maskFromRgba, otsu, signedArea, traceMask } from './trace';

const shape = (id: string): CookieSource => ({ kind: 'shape', polygons: shapeById(id).polygons(), fillRule: 'Positive' });
const make = async (src: CookieSource, p: Partial<CookieParams> = {}) =>
  buildCookie(await initKernel(), src, { ...DEFAULT_COOKIE_PARAMS, ...p });
const part = (r: Awaited<ReturnType<typeof make>>, id: string) => r.parts.find((x) => x.id === id)!;
const bounds = (positions: Float32Array) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  return { min, max };
};

describe('cookie cutter and stamp', () => {
  it('builds every built-in shape as closed, printable solids', async () => {
    for (const s of SHAPES) {
      const r = await make(shape(s.id));
      expect(
        r.parts.map((p) => p.id),
        s.id,
      ).toEqual(['cutter', 'stamp', 'handle']);
      for (const p of r.parts) {
        expect(p.watertight, `${s.id} ${p.id}`).toBe(true);
        expect(p.volume, `${s.id} ${p.id}`).toBeGreaterThan(0);
      }
      // Every part sits on the bed.
      for (const p of r.parts) expect(bounds(p.mesh.positions).min[2]).toBeCloseTo(0, 5);
    }
  });

  it('sizes the cookie exactly and builds the cutter around it', async () => {
    const r = await make(shape('circle'), { size: 60, smoothing: 0 });
    expect(Math.max(r.cookie.width, r.cookie.height)).toBeCloseTo(60, 1);
    const c = part(r, 'cutter');
    // Outer size = cookie + 2 × (blade + flange).
    expect(c.size[0]).toBeCloseTo(60 + 2 * (0.9 + 3), 0);
    expect(c.size[2]).toBeCloseTo(14, 5);
    // Wall volume ≈ blade ring × height + flange ring × flange height.
    const ring = (r0: number, r1: number) => Math.PI * (r1 * r1 - r0 * r0);
    expect(c.volume).toBeCloseTo(ring(30, 30.9) * 14 + ring(30.9, 33.9) * 2, -1);
    // The stamp fits inside the cutter with the gap.
    const st = part(r, 'stamp');
    expect(st.size[0]).toBeCloseTo(60 - 2 * 0.6, 1);
    expect(st.size[2]).toBeCloseTo(4 + 2, 5);
  });

  it('mirrors asymmetric designs so the cookie comes out the right way round', async () => {
    // An "L": the long bar on the left in the design.
    const L: CookieSource = {
      kind: 'shape',
      fillRule: 'Positive',
      polygons: [
        [
          [0, 0],
          [3, 0],
          [3, 1],
          [1, 1],
          [1, 4],
          [0, 4],
        ],
      ],
    };
    const plain = await make(L, { mirror: false, make: 'stamp', handle: false, stampStyle: 'filled' });
    const mirrored = await make(L, { mirror: true, make: 'stamp', handle: false, stampStyle: 'filled' });
    // Centroid of the top (relief) layer is left of centre in the design, right of centre when mirrored.
    const topCentroidX = (pos: Float32Array) => {
      const b = bounds(pos);
      let sx = 0;
      let n = 0;
      for (let i = 0; i < pos.length; i += 3)
        if (pos[i + 2] > b.max[2] - 1e-6) {
          sx += pos[i] - (b.min[0] + b.max[0]) / 2;
          n++;
        }
      return sx / n;
    };
    expect(topCentroidX(part(plain, 'stamp').mesh.positions)).toBeLessThan(0);
    expect(topCentroidX(part(mirrored, 'stamp').mesh.positions)).toBeGreaterThan(0);
  });

  it('joins separate pieces with an outline margin and reports when it cannot', async () => {
    const twoDots: CookieSource = {
      kind: 'text',
      fillRule: 'Positive',
      polygons: [capsule(0, 0, 0, 3, 1), capsule(2.4, 0, 2.4, 3, 1)],
    };
    const apart = await make(twoDots, { outline: 0 });
    expect(apart.pieces).toBe(2);
    expect(apart.warnings.join(' ')).toMatch(/2 separate pieces/);
    const joined = await make(twoDots, { outline: 4 });
    expect(joined.pieces).toBe(1);
    // Text uses the filled stamp style: the letters are raised.
    expect(part(joined, 'stamp').size[2]).toBeCloseTo(6, 5);
  });

  it('fits the handle peg into a blind socket in the stamp', async () => {
    const r = await make(shape('heart'), { size: 80 });
    const stamp = part(r, 'stamp');
    const handle = part(r, 'handle');
    expect(r.notes.join(' ')).toMatch(/press-fits/);
    // Handle: knob (16 mm) plus the peg (socket depth − 0.3 = 2.3 mm).
    expect(handle.size[2]).toBeCloseTo(16 + 2.3, 4);
    // The stamp lost exactly the socket volume (blind: the plate stays one closed solid).
    const noHandle = part(await make(shape('heart'), { size: 80, handle: false }), 'stamp');
    const socket = Math.PI * (3.15 * 3.15) * 2.6;
    expect(noHandle.volume - stamp.volume).toBeCloseTo(socket, 0);
  });

  it('warns about thin necks and very large cutters', async () => {
    const narrow: CookieSource = {
      kind: 'shape',
      fillRule: 'Positive',
      polygons: [capsule(-10, 0, 10, 0, 0.6), capsule(-10, -4, -10, 4, 3), capsule(10, -4, 10, 4, 3)],
    };
    const r = await make(narrow, { size: 80, smoothing: 0 });
    expect(r.warnings.join(' ')).toMatch(/narrower than 5 mm/);
    const big = await make(shape('circle'), { size: 240 });
    expect(big.warnings.join(' ')).toMatch(/larger than many build plates/);
  });

  it('makes only the requested parts', async () => {
    expect((await make(shape('star'), { make: 'cutter' })).parts.map((p) => p.id)).toEqual(['cutter']);
    expect((await make(shape('star'), { make: 'stamp', handle: false })).parts.map((p) => p.id)).toEqual(['stamp']);
  });

  it('rejects an empty design with a readable message', async () => {
    await expect(make({ kind: 'svg', fillRule: 'NonZero', polygons: [] })).rejects.toThrow(/no design/);
  });
});

describe('bitmap tracing', () => {
  it('traces a ring into an outer outline and a hole', () => {
    const W = 80;
    const mask = new Uint8Array(W * W);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const r = Math.hypot(x - 40 + 0.5, y - 40 + 0.5);
        if (r < 30 && r > 15) mask[y * W + x] = 1;
      }
    const loops = traceMask(mask, W, W);
    expect(loops).toHaveLength(2);
    const areas = loops.map((l) => Math.abs(signedArea(l))).sort((a, b) => b - a);
    expect(areas[0]).toBeCloseTo(Math.PI * 30 * 30, -2);
    expect(areas[1]).toBeCloseTo(Math.PI * 15 * 15, -2);
    // Simplified: far fewer points than pixel edges.
    expect(loops[0].length).toBeLessThan(600);
  });

  it('picks the design from dark-on-light pixels or from transparency', () => {
    const W = 10;
    const rgba = new Uint8Array(W * W * 4);
    for (let i = 0; i < W * W; i++) {
      const dark = i % W < 5;
      rgba.set(dark ? [20, 20, 20, 255] : [240, 240, 240, 255], i * 4);
    }
    const th = otsu(rgba, W * W);
    expect(th).toBeGreaterThan(20);
    expect(th).toBeLessThan(241);
    expect(maskFromRgba(rgba, W, W, th, false).coverage).toBeCloseTo(0.5, 5);
    expect(maskFromRgba(rgba, W, W, th, true).coverage).toBeCloseTo(0.5, 5);
    const transparent = new Uint8Array(W * W * 4);
    for (let i = 0; i < 30; i++) transparent.set([255, 255, 255, 255], i * 4);
    const m = maskFromRgba(transparent, W, W, 128, false);
    expect(m.usesAlpha).toBe(true);
    expect(m.coverage).toBeCloseTo(0.3, 5);
  });

  it('turns a traced picture into a cookie', async () => {
    const W = 120;
    const mask = new Uint8Array(W * W);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) if (Math.hypot(x - 60, y - 60) < 50 && !(Math.hypot(x - 60, y - 40) < 10)) mask[y * W + x] = 1;
    const r = await make({ kind: 'image', fillRule: 'EvenOdd', polygons: traceMask(mask, W, W) }, { size: 60 });
    for (const p of r.parts) expect(p.watertight).toBe(true);
    expect(Math.max(r.cookie.width, r.cookie.height)).toBeCloseTo(60, 0);
  });
});
