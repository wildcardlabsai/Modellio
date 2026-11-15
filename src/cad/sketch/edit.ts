import { constraintRefs } from './describe';
import type { Sketch } from './types';

/**
 * Join two points: `drop` becomes `keep` everywhere it is used. Lines that collapse to a point,
 * and constraints on removed geometry or between a point and itself, go too.
 */
export function mergePoints(sketch: Sketch, keep: string, drop: string): Sketch {
  const swap = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k !== 'id' && v === drop ? keep : v])) as T;
  const entities = sketch.entities.map(swap).filter((e) => !(e.kind === 'line' && e.a === e.b));
  const alive = new Set([...entities.map((e) => e.id), ...sketch.points.map((p) => p.id)]);
  const constraints = sketch.constraints
    .map(swap)
    .filter((c) => constraintRefs(c).every((r) => alive.has(r) && r !== drop))
    .filter((c) => !((c.kind === 'coincident' || c.kind === 'pointDistance') && c.a === c.b));
  return { points: sketch.points.filter((p) => p.id !== drop), entities, constraints };
}
