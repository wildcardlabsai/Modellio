import type { Manifold, ManifoldToplevel, Mat4 } from 'manifold-3d';
import { manifoldToMeshData, meshDataToManifold } from '@/cad/kernel/meshData';
import type { CapRecord, SplitPart, SplitResult, Vec3 } from './types';
import { validatePart } from './split';

/**
 * Inlays for thin colour regions.
 *
 * A colour painted on a flat face has no thickness of its own, and a region on a gently
 * curved surface is only a thin lens. For each joint where one side is thinner than the
 * inlay depth, the boundary outline is extruded into the other part (clipped to it):
 * that plug is added to the thin part and subtracted from its neighbour. The assembled
 * shape is unchanged; the thin part becomes a solid inlay sitting in a matching pocket.
 */
export function applyInlays(k: ManifoldToplevel, result: SplitResult, depth: number): SplitResult {
  if (depth <= 0 || !result.joints.length) return result;
  const parts = new Map(result.parts.map((p) => [p.partId, p]));
  const solids = new Map<string, Manifold | null>();
  const owned: Manifold[] = [];
  const own = (m: Manifold) => {
    owned.push(m);
    return m;
  };
  const solid = (p: SplitPart): Manifold | null => {
    if (solids.has(p.partId)) return solids.get(p.partId)!;
    let m: Manifold | null = null;
    if (p.report.watertight && p.report.volume > 1e-6) {
      try {
        m = own(meshDataToManifold(k, p.mesh));
        if (m.status() !== 'NoError' || m.isEmpty()) m = null;
      } catch {
        m = null;
      }
    }
    solids.set(p.partId, m);
    return m;
  };
  const changed = new Set<string>();
  let made = 0;
  let skipped = 0;
  try {
    for (const j of result.joints) {
      const a = parts.get(j.partA)!;
      const b = parts.get(j.partB)!;
      const capA = a.caps[j.capA];
      const capB = b.caps[j.capB];
      const tA = Math.abs(a.report.volume) / Math.max(capA.area, 1e-9);
      const tB = Math.abs(b.report.volume) / Math.max(capB.area, 1e-9);
      const thinA = tA < depth;
      const thinB = tB < depth;
      if (!thinA && !thinB) continue;
      const [thin, body, cap] = thinA && (!thinB || tA <= tB) ? [a, b, capA] : [b, a, capB];
      const bodySolid = solid(body);
      if (!bodySolid) {
        skipped++;
        continue;
      }
      const prism = makePrism(k, cap, depth);
      if (!prism) {
        skipped++;
        continue;
      }
      own(prism);
      const plug = own(prism.intersect(bodySolid));
      if (plug.isEmpty()) {
        skipped++;
        continue;
      }
      solids.set(body.partId, own(bodySolid.subtract(prism)));
      const thinSolid = solid(thin);
      solids.set(thin.partId, thinSolid ? own(thinSolid.add(plug)) : plug);
      changed.add(body.partId).add(thin.partId);
      if (thin === b) {
        // Keep "part A = the inlay" for joint consumers.
        Object.assign(j, { partA: b.partId, partB: a.partId, capA: j.capB, capB: j.capA, normal: neg(j.normal) });
      }
      j.kind = 'inlay';
      made++;
    }
    for (const id of changed) {
      const p = parts.get(id)!;
      const m = solids.get(id)!;
      const mesh = manifoldToMeshData(m);
      const report = validatePart(mesh, 0);
      report.surfaceArea = p.report.surfaceArea;
      report.sourceOpenEdges = p.report.sourceOpenEdges;
      p.mesh = mesh;
      p.report = report;
      // Cap triangle ranges no longer apply; outline, centroid and normal still describe the joints.
      p.caps = p.caps.map((c) => ({ ...c, firstTriangle: -1, triangleCount: 0 }));
    }
  } finally {
    owned.forEach((m) => m.delete());
  }
  const issues = result.issues.filter((i) => i.code !== 'tiny-parts' && i.code !== 'not-watertight');
  if (made)
    issues.push({
      level: 'info',
      code: 'inlays',
      message: `${made} thin colour region(s) became ${depth} mm deep inlays with a matching pocket in the part behind them.`,
      count: made,
    });
  if (skipped)
    issues.push({
      level: 'warning',
      code: 'inlay-skipped',
      message: `${skipped} thin region(s) could not be given depth because the part behind them is not a valid solid.`,
      count: skipped,
    });
  // Re-evaluate the checks that depend on geometry.
  const bad = result.parts.filter((p) => !p.report.watertight);
  if (bad.length)
    issues.push({
      level: 'error',
      code: 'not-watertight',
      message: `${bad.length} part(s) are not closed solids and should not be printed as they are.`,
      count: bad.length,
    });
  const tiny = result.parts.filter((p) => Math.abs(p.report.volume) < 1);
  if (tiny.length)
    issues.push({
      level: 'warning',
      code: 'tiny-parts',
      message: `${tiny.length} part(s) are smaller than 1 mm³ and may not print.`,
      count: tiny.length,
    });
  return { ...result, issues };
}

const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];

/** Basis (u, v) of the plane with normal n. */
export function planeBasis(n: Vec3): { u: Vec3; v: Vec3 } {
  const ax = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u: Vec3 = [n[1] * ax[2] - n[2] * ax[1], n[2] * ax[0] - n[0] * ax[2], n[0] * ax[1] - n[1] * ax[0]];
  const l = Math.hypot(...u);
  u = [u[0] / l, u[1] / l, u[2] / l];
  const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return { u, v };
}

/** The cap outline extruded along its normal (out of the thin part, into its neighbour). */
function makePrism(k: ManifoldToplevel, cap: CapRecord, depth: number): Manifold | null {
  const n = cap.normal;
  const c = cap.centroid;
  const { u, v } = planeBasis(n);
  const pts: [number, number][] = [];
  for (let i = 0; i < cap.outline.length; i += 3) {
    const dx = cap.outline[i] - c[0];
    const dy = cap.outline[i + 1] - c[1];
    const dz = cap.outline[i + 2] - c[2];
    pts.push([dx * u[0] + dy * u[1] + dz * u[2], dx * v[0] + dy * v[1] + dz * v[2]]);
  }
  const cs = new k.CrossSection([pts], 'NonZero');
  try {
    if (cs.area() < 1e-6) return null;
    // Start just below the cap (covering its deviation from flat) and go `depth` into the neighbour.
    const start = -(cap.deviation + 0.01);
    const solid = k.Manifold.extrude(cs, depth - start);
    const m: Mat4 = [
      u[0],
      u[1],
      u[2],
      0,
      v[0],
      v[1],
      v[2],
      0,
      n[0],
      n[1],
      n[2],
      0,
      c[0] + n[0] * start,
      c[1] + n[1] * start,
      c[2] + n[2] * start,
      1,
    ];
    const placed = solid.transform(m);
    solid.delete();
    return placed;
  } finally {
    cs.delete();
  }
}
