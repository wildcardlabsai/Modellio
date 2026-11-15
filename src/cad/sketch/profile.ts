import type { ManifoldToplevel, SimplePolygon } from 'manifold-3d';
import { manifoldToMeshData, type MeshData } from '../kernel/meshData';
import type { Sketch } from './types';
import { chainPolygon, circlePolygon, sketchOutlines } from './outline';

/** How a sketch becomes a solid. */
export interface ProfileOp {
  kind: 'extrude' | 'revolve';
  /** Extrude distance (mm). */
  depth: number;
  /** Revolve angle (degrees, 1–360) around the sketch's Y axis. */
  angle: number;
}

/**
 * The sketch's closed regions as polygons (arcs sampled): closed chains of lines and arcs plus
 * full circles, from the shared outline walk. Also says how many open chains were left over, how
 * many points branch, and whether outlines cross (so the editor can explain what is wrong).
 */
export function sketchLoops(s: Sketch): { loops: SimplePolygon[]; open: number; branches: number; crossing: boolean } {
  const o = sketchOutlines(s);
  const loops: SimplePolygon[] = [...o.circles.map((c) => circlePolygon(c.c, c.r, 96)), ...o.chains.map((c) => chainPolygon(c))];
  return { loops, open: o.open, branches: o.branches, crossing: o.crossing };
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
