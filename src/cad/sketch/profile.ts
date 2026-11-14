import type { ManifoldToplevel, SimplePolygon } from 'manifold-3d';
import { manifoldToMeshData, type MeshData } from '../kernel/meshData';
import type { Sketch, SketchEntity } from './types';

/** How a sketch becomes a solid. */
export interface ProfileOp {
  kind: 'extrude' | 'revolve';
  /** Extrude distance (mm). */
  depth: number;
  /** Revolve angle (degrees, 1–360) around the sketch's Y axis. */
  angle: number;
}

const ARC_STEP = (2 * Math.PI) / 96;

/** Points along an arc from a to b around c, counter-clockwise (excluding b). */
function arcPoints(a: [number, number], b: [number, number], c: [number, number]): [number, number][] {
  const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  let a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
  while (a1 <= a0 + 1e-9) a1 += 2 * Math.PI;
  const n = Math.max(2, Math.ceil((a1 - a0) / ARC_STEP));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = a0 + ((a1 - a0) * i) / n;
    out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return out;
}

/**
 * The sketch's closed regions as polygons: chains of lines and arcs that return to their
 * start, plus full circles. Construction geometry is ignored. Also returns how many open
 * chains were left over (so the editor can say the outline isn't closed).
 */
export function sketchLoops(s: Sketch): { loops: SimplePolygon[]; open: number } {
  const pts = new Map(s.points.map((p) => [p.id, [p.x, p.y] as [number, number]]));
  const edges = s.entities.filter(
    (e): e is Extract<SketchEntity, { kind: 'line' | 'arc' }> => (e.kind === 'line' || e.kind === 'arc') && !e.construction,
  );
  const loops: SimplePolygon[] = [];
  for (const e of s.entities)
    if (e.kind === 'circle' && !e.construction) {
      const c = pts.get(e.c);
      if (!c || e.r <= 0) continue;
      const ring: [number, number][] = [];
      for (let i = 0; i < 96; i++)
        ring.push([c[0] + e.r * Math.cos((i / 96) * 2 * Math.PI), c[1] + e.r * Math.sin((i / 96) * 2 * Math.PI)]);
      loops.push(ring);
    }
  // Walk chains: each point should join exactly two edges in a closed loop.
  const byPoint = new Map<string, typeof edges>();
  for (const e of edges)
    for (const id of [e.a, e.b]) {
      if (!byPoint.has(id)) byPoint.set(id, []);
      byPoint.get(id)!.push(e);
    }
  const used = new Set<string>();
  let open = 0;
  for (const start of edges) {
    if (used.has(start.id)) continue;
    const ring: [number, number][] = [];
    let e = start;
    let from = start.a;
    let closed = false;
    for (let guard = 0; guard <= edges.length; guard++) {
      used.add(e.id);
      const to = e.a === from ? e.b : e.a;
      const pa = pts.get(from)!;
      const pb = pts.get(to)!;
      if (e.kind === 'arc') {
        const c = pts.get(e.c)!;
        // Arcs run a → b counter-clockwise; walked backwards, reverse the points.
        if (from === e.a) ring.push(...arcPoints(pa, pb, c));
        else ring.push(...arcPoints(pb, pa, c).concat([pa]).reverse().slice(0, -1));
      } else ring.push(pa);
      if (to === start.a) {
        closed = true;
        break;
      }
      const next = (byPoint.get(to) ?? []).find((x) => x.id !== e.id && !used.has(x.id));
      if (!next) break;
      from = to;
      e = next;
    }
    if (closed && ring.length >= 3) loops.push(ring);
    else open++;
  }
  return { loops, open };
}

/**
 * The solid for a sketch: its loops filled even-odd (loops inside loops are holes), then
 * extruded along Z or revolved around the sketch's Y axis (which becomes Z).
 */
export function buildProfileMesh(k: ManifoldToplevel, s: Sketch, op: ProfileOp): MeshData | null {
  const { loops } = sketchLoops(s);
  if (!loops.length) return null;
  const cs = new k.CrossSection(loops, 'EvenOdd');
  try {
    if (cs.isEmpty()) return null;
    const solid =
      op.kind === 'revolve'
        ? k.Manifold.revolve(cs, 96, Math.max(1, Math.min(360, op.angle)))
        : k.Manifold.extrude(cs, Math.max(0.01, op.depth));
    try {
      if (solid.isEmpty()) return null;
      return manifoldToMeshData(solid);
    } finally {
      solid.delete();
    }
  } finally {
    cs.delete();
  }
}
