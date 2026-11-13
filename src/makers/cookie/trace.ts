import type { Poly } from './shapes';

/**
 * Bitmap tracing: a binary mask becomes closed outlines.
 *
 * 1. Every foreground pixel side that faces background becomes a directed edge on the
 *    pixel grid, and edges are chained into closed loops (exact, no gaps).
 * 2. Loops are simplified (Ramer–Douglas–Peucker) and lightly smoothed (Chaikin) so the
 *    staircase of pixels becomes a clean outline.
 * Loops are returned in image pixel units with Y up; combine them with the even-odd rule.
 */
export interface TraceOptions {
  /** Simplification tolerance in pixels. */
  tolerance?: number;
  /** Chaikin smoothing passes. */
  smoothing?: number;
  /** Ignore loops enclosing fewer pixels than this fraction of the image. */
  minAreaFraction?: number;
}

export function traceMask(mask: Uint8Array, width: number, height: number, o: TraceOptions = {}): Poly[] {
  const tol = o.tolerance ?? 0.8;
  const passes = o.smoothing ?? 2;
  const minArea = (o.minAreaFraction ?? 0.0005) * width * height;
  const W = width + 1;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] !== 0;
  // Outgoing edges per grid vertex.
  const next = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = y0 * W + x0;
    let l = next.get(k);
    if (!l) next.set(k, (l = []));
    l.push(y1 * W + x1);
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  const loops: Poly[] = [];
  for (const [start, outs] of next) {
    while (outs.length) {
      const pts: Poly = [];
      let cur = start;
      let to = outs.pop()!;
      let guard = 0;
      for (;;) {
        pts.push([cur % W, height - Math.floor(cur / W)]);
        cur = to;
        if (cur === start || guard++ > 50_000_000) break;
        const l = next.get(cur);
        if (!l || !l.length) break;
        to = l.pop()!;
      }
      const area = Math.abs(signedArea(pts));
      if (pts.length >= 4 && area >= minArea) loops.push(smooth(simplify(dropCollinear(pts), tol), passes));
    }
  }
  return loops;
}

export function signedArea(p: Poly): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [ax, ay] = p[i];
    const [bx, by] = p[(i + 1) % p.length];
    s += ax * by - bx * ay;
  }
  return s / 2;
}

function dropCollinear(p: Poly): Poly {
  const out: Poly = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[(i - 1 + p.length) % p.length];
    const b = p[i];
    const c = p[(i + 1) % p.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out.length >= 3 ? out : p;
}

/** Ramer–Douglas–Peucker on a closed loop. */
export function simplify(p: Poly, tol: number): Poly {
  if (p.length < 5 || tol <= 0) return p;
  // Split at the vertex farthest from the first.
  let far = 0;
  let best = -1;
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const half = (a: number, b: number): Poly => {
    const pts = a < b ? p.slice(a, b + 1) : [...p.slice(a), ...p.slice(0, b + 1)];
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack: [number, number][] = [[0, pts.length - 1]];
    while (stack.length) {
      const [i, j] = stack.pop()!;
      const [ax, ay] = pts[i];
      const [bx, by] = pts[j];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      let idx = -1;
      let dmax = tol;
      for (let k = i + 1; k < j; k++) {
        const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / len;
        if (d > dmax) {
          dmax = d;
          idx = k;
        }
      }
      if (idx >= 0) {
        keep[idx] = 1;
        stack.push([i, idx], [idx, j]);
      }
    }
    return pts.filter((_, k) => keep[k]);
  };
  const a = half(0, far);
  const b = half(far, 0);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : p;
}

/** Chaikin corner cutting (keeps the loop closed). */
export function smooth(p: Poly, passes: number): Poly {
  let pts = p;
  for (let k = 0; k < passes; k++) {
    const out: Poly = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    pts = out;
  }
  return pts;
}

/**
 * Foreground mask from RGBA pixels. With transparency, opaque pixels are the design;
 * otherwise pixels darker than `threshold` (0–255) are. `invert` swaps the two.
 */
export function maskFromRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold: number,
  invert: boolean,
): { mask: Uint8Array; usesAlpha: boolean; coverage: number } {
  const n = width * height;
  let transparent = 0;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] < 128) transparent++;
  const usesAlpha = transparent > n * 0.05;
  const mask = new Uint8Array(n);
  let on = 0;
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3];
    const lum = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
    let fg = usesAlpha ? a >= 128 : lum < threshold;
    if (invert) fg = usesAlpha ? a < 128 : !fg;
    if (fg) {
      mask[i] = 1;
      on++;
    }
  }
  return { mask, usesAlpha, coverage: on / n };
}

/** Otsu's threshold on luminance (opaque pixels only). */
export function otsu(rgba: Uint8ClampedArray | Uint8Array, n: number): number {
  const hist = new Array<number>(256).fill(0);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3] < 128) continue;
    hist[Math.round(0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2])]++;
    count++;
  }
  if (!count) return 128;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = count - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      th = t + 1;
    }
  }
  return th;
}
