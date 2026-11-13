export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Round to a fixed number of decimals, removing floating point noise (and -0). */
export function roundTo(v: number, decimals = 4): number {
  const f = 10 ** decimals;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function snapTo(v: number, step: number): number {
  if (!step || step <= 0) return v;
  return roundTo(Math.round(v / step) * step, 6);
}

/** Normalise an angle in degrees to the range (-180, 180]. */
export function normalizeDegrees(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return roundTo(d, 4);
}

export function formatMm(v: number): string {
  return roundTo(v, 2).toFixed(2);
}
