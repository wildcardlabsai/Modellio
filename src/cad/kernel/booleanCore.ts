import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { manifoldToMeshData, meshDataToManifold, type MeshData } from './meshData';

/** A self-contained Boolean job: every part already in the group's frame. */
export interface BooleanJob {
  mode: 'union' | 'intersect';
  parts: { name: string; mesh: MeshData; hole: boolean }[];
}

export interface BooleanOutcome {
  mesh: MeshData | null;
  error: string | null;
  /** True when the combination contains only holes (it then acts as a hole). */
  isHole: boolean;
}

/**
 * result = (union | intersection)(solids) − union(holes)
 *
 * Pure apart from the kernel: runs identically on the main thread and in the
 * Boolean worker. Every Manifold object is freed before returning.
 */
export function runBoolean(k: ManifoldToplevel, job: BooleanJob): BooleanOutcome {
  const owned: Manifold[] = [];
  const own = (m: Manifold) => {
    owned.push(m);
    return m;
  };
  try {
    const solids: Manifold[] = [];
    const holes: Manifold[] = [];
    for (const part of job.parts) {
      let m: Manifold;
      try {
        m = own(meshDataToManifold(k, part.mesh));
      } catch {
        return { mesh: null, error: `“${part.name}” is not a closed solid, so it can't be combined.`, isHole: false };
      }
      if (m.status() !== 'NoError') return { mesh: null, error: `“${part.name}” is not a closed solid (${m.status()}).`, isHole: false };
      (part.hole ? holes : solids).push(m);
    }
    let base: Manifold | null = null;
    let isHole = false;
    if (solids.length) {
      base = own(job.mode === 'intersect' ? k.Manifold.intersection(solids) : k.Manifold.union(solids));
      if (holes.length) base = own(base.subtract(own(k.Manifold.union(holes))));
    } else if (holes.length) {
      base = own(k.Manifold.union(holes));
      isHole = true;
    }
    if (!base || base.isEmpty()) {
      return {
        mesh: null,
        error: solids.length ? 'Nothing is left: the result of this combination is empty.' : 'This group has no visible parts.',
        isHole,
      };
    }
    return { mesh: manifoldToMeshData(base), error: null, isHole };
  } catch (e) {
    return { mesh: null, error: e instanceof Error ? e.message : String(e), isHole: false };
  } finally {
    owned.forEach((m) => m.delete());
  }
}
