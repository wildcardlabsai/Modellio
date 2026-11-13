import type { Manifold, ManifoldToplevel, Mat4 } from 'manifold-3d';
import { manifoldToMeshData, meshDataToManifold } from '@/cad/kernel/meshData';
import type { ImportIssue } from '../model/types';
import { planeBasis } from './inlay';
import { validatePart } from './split';
import type { Joint, SplitPart, Vec3 } from './types';

/**
 * Round peg / blind socket connectors between parts that meet along a joint face.
 *
 * Rules enforced here:
 *  - A peg is only ever added together with its socket (both Booleans succeed, or neither is kept).
 *  - Sockets are blind: the socket must stay inside its part with at least `minWall` behind it,
 *    verified on the real geometry after the cut; otherwise the connector is shortened or skipped.
 *  - Connectors need a flat-enough joint face with room for the socket and a side wall.
 */
export interface ConnectorSettings {
  enabled: boolean;
  /** Peg diameter (mm). */
  diameter: number;
  /** How far the peg sticks out of its part (mm). */
  length: number;
  /** Radial clearance between peg and socket (mm per side). */
  clearance: number;
  /** Extra socket depth beyond the peg (mm). */
  depthClearance: number;
  /** Minimum material around and behind a socket (mm). */
  minWall: number;
  /** Connectors per joint: 1, 2 (stops rotation), or auto (2 when the face is long enough). */
  perJoint: 'auto' | 1 | 2;
}

export const DEFAULT_CONNECTOR_SETTINGS: ConnectorSettings = {
  enabled: true,
  diameter: 3,
  length: 3,
  clearance: 0.15,
  depthClearance: 0.4,
  minWall: 1,
  perJoint: 'auto',
};

export interface Connector {
  id: string;
  jointId: string;
  pegPartId: string;
  socketPartId: string;
  /** Centre of the peg base on the joint face (assembly coordinates). */
  position: Vec3;
  /** Unit direction from the peg part into the socket part. */
  axis: Vec3;
  diameter: number;
  length: number;
  socketDiameter: number;
  socketDepth: number;
}

export interface ConnectorResult {
  parts: SplitPart[];
  connectors: Connector[];
  issues: ImportIssue[];
  /** Joints that got no connector, with the reason. */
  skipped: { jointId: string; reason: string }[];
}

const SEGMENTS = 48;

export function addConnectors(
  k: ManifoldToplevel,
  parts: SplitPart[],
  joints: Joint[],
  s: ConnectorSettings,
  only?: Set<string>,
): ConnectorResult {
  const out = new Map(parts.map((p) => [p.partId, { ...p }]));
  const connectors: Connector[] = [];
  const skipped: ConnectorResult['skipped'] = [];
  if (!s.enabled) return { parts, connectors, issues: [], skipped };
  const solids = new Map<string, Manifold>();
  const owned: Manifold[] = [];
  const own = (m: Manifold) => {
    owned.push(m);
    return m;
  };
  const solidOf = (p: SplitPart) => {
    let m = solids.get(p.partId);
    if (!m) {
      m = own(meshDataToManifold(k, p.mesh));
      if (m.status() !== 'NoError') throw new Error(`${p.name} is not a valid solid (${m.status()}).`);
      solids.set(p.partId, m);
    }
    return m;
  };
  const changed = new Set<string>();
  const r = s.diameter / 2;
  const rs = r + s.clearance;
  try {
    for (const j of joints) {
      if (only && !only.has(j.jointId)) continue;
      if (j.kind === 'inlay') {
        skipped.push({ jointId: j.jointId, reason: 'Inlay: the plug already locates the part.' });
        continue;
      }
      const A = out.get(j.partA)!;
      const B = out.get(j.partB)!;
      const cap = parts.find((p) => p.partId === j.partA)!.caps[j.capA];
      if (cap.deviation > 1.5) {
        skipped.push({ jointId: j.jointId, reason: `The joint face is curved (${cap.deviation.toFixed(1)} mm out of flat).` });
        continue;
      }
      // Candidate positions on the joint face with room for the socket and its side wall.
      const need = rs + s.minWall;
      const spots = pickSpots(cap.outline, cap.centroid, cap.normal, need, s.perJoint, s.diameter);
      if (!spots.length) {
        skipped.push({ jointId: j.jointId, reason: `The joint face is too small for a ${s.diameter} mm connector.` });
        continue;
      }
      const n = cap.normal; // out of A, into B
      let solidA: Manifold;
      let solidB: Manifold;
      try {
        solidA = solidOf(A);
        solidB = solidOf(B);
      } catch (e) {
        skipped.push({ jointId: j.jointId, reason: (e as Error).message });
        continue;
      }
      // Thickness of each part behind every spot.
      const thick = spots.map((p) => ({ a: rayDepth(A, p, neg(n)), b: rayDepth(B, p, n) }));
      const minA = Math.min(...thick.map((t) => t.a));
      const minB = Math.min(...thick.map((t) => t.b));
      // The socket goes into the part with more material behind the face.
      const socketInB = minB >= minA;
      const socketPart = socketInB ? B : A;
      const pegPart = socketInB ? A : B;
      const axis = socketInB ? n : neg(n);
      const socketRoom = socketInB ? minB : minA;
      const pegRoom = socketInB ? minA : minB;
      let length = Math.min(s.length, socketRoom - s.minWall - s.depthClearance);
      if (length < 1.5) {
        skipped.push({
          jointId: j.jointId,
          reason: `Not enough material for a blind socket (${socketRoom.toFixed(1)} mm behind the face).`,
        });
        continue;
      }
      length = Math.round(length * 10) / 10;
      const overlap = Math.min(0.6 + cap.deviation, pegRoom / 2);
      if (overlap < 0.2) {
        skipped.push({ jointId: j.jointId, reason: 'The part that would carry the peg is too thin at the joint.' });
        continue;
      }
      const depth = length + s.depthClearance;
      // Build all pegs and sockets for this joint, then commit only if every check passes.
      const pegs: Manifold[] = [];
      const sockets: Manifold[] = [];
      for (const p of spots) {
        pegs.push(own(peg(k, p, axis, r, length, overlap)));
        // The socket opens from just outside the (possibly uneven) joint face.
        sockets.push(own(cylinderAlong(k, p, axis, rs, -(cap.deviation + 0.02), depth)));
      }
      const pegUnion = own(k.Manifold.union(pegs));
      const socketUnion = own(k.Manifold.union(sockets));
      const socketSolid = socketInB ? solidB : solidA;
      const pegSolid = socketInB ? solidA : solidB;
      // Blind check: apart from the 0.02 mm entry, the socket must lie inside its part, with a wall behind it.
      const outside = own(socketUnion.subtract(socketSolid)).volume();
      const entry = spots.length * Math.PI * rs * rs * (cap.deviation * 2 + 0.02);
      const behind = spots.every((p) => rayDepth(socketPart, add(p, scale(axis, depth)), axis, true) >= s.minWall - 1e-6);
      if (outside > entry * 1.5 + 1e-3 || !behind) {
        skipped.push({ jointId: j.jointId, reason: 'The socket would break through the part; no connector was added.' });
        continue;
      }
      // The peg must not poke through the back of its own part.
      const pegInside = own(pegUnion.intersect(pegSolid)).volume();
      const expectedInside = spots.length * Math.PI * r * r * overlap;
      if (pegInside < expectedInside * 0.8) {
        skipped.push({ jointId: j.jointId, reason: 'The peg would not be anchored in its part.' });
        continue;
      }
      const newSocket = own(socketSolid.subtract(socketUnion));
      const newPeg = own(pegSolid.add(pegUnion));
      if (newSocket.status() !== 'NoError' || newPeg.status() !== 'NoError') {
        skipped.push({ jointId: j.jointId, reason: 'The connector Booleans failed.' });
        continue;
      }
      solids.set(socketPart.partId, newSocket);
      solids.set(pegPart.partId, newPeg);
      changed.add(socketPart.partId).add(pegPart.partId);
      spots.forEach((p, i) =>
        connectors.push({
          id: `${j.jointId}#${i}`,
          jointId: j.jointId,
          pegPartId: pegPart.partId,
          socketPartId: socketPart.partId,
          position: p,
          axis,
          diameter: s.diameter,
          length,
          socketDiameter: rs * 2,
          socketDepth: depth,
        }),
      );
    }
    for (const id of changed) {
      const p = out.get(id)!;
      const mesh = manifoldToMeshData(solids.get(id)!);
      const report = validatePart(mesh, 0);
      report.surfaceArea = p.report.surfaceArea;
      report.sourceOpenEdges = p.report.sourceOpenEdges;
      out.set(id, { ...p, mesh, report });
    }
  } finally {
    owned.forEach((m) => m.delete());
  }
  const issues: ImportIssue[] = [];
  if (connectors.length)
    issues.push({
      level: 'info',
      code: 'connectors',
      message: `${connectors.length} peg and socket pair(s) added.`,
      count: connectors.length,
    });
  const real = skipped.filter((x) => !x.reason.startsWith('Inlay'));
  if (real.length)
    issues.push({
      level: 'warning',
      code: 'connectors-skipped',
      message: `${real.length} joint(s) got no connector: ${real[0].reason}`,
      count: real.length,
    });
  return { parts: parts.map((p) => out.get(p.partId)!), connectors, issues, skipped };
}

const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

/** Cylinder of radius r along `axis` from base + axis·from to base + axis·to. */
function cylinderAlong(k: ManifoldToplevel, base: Vec3, axis: Vec3, r: number, from: number, to: number): Manifold {
  const c = k.Manifold.cylinder(to - from, r, r, SEGMENTS);
  const placed = c.transform(frame(base, axis, from));
  c.delete();
  return placed;
}

/** Peg: cylinder with a 0.3 mm chamfered tip, starting `overlap` inside its own part. */
function peg(k: ManifoldToplevel, base: Vec3, axis: Vec3, r: number, length: number, overlap: number): Manifold {
  const ch = Math.min(0.3, r / 3, length / 3);
  const body = k.Manifold.cylinder(length + overlap - ch, r, r, SEGMENTS);
  const tip = k.Manifold.cylinder(ch, r, r - ch, SEGMENTS).translate([0, 0, length + overlap - ch]);
  const whole = body.add(tip);
  body.delete();
  tip.delete();
  const placed = whole.transform(frame(base, axis, -overlap));
  whole.delete();
  return placed;
}

function frame(base: Vec3, w: Vec3, offset: number): Mat4 {
  const { u, v } = planeBasis(w);
  return [
    u[0],
    u[1],
    u[2],
    0,
    v[0],
    v[1],
    v[2],
    0,
    w[0],
    w[1],
    w[2],
    0,
    base[0] + w[0] * offset,
    base[1] + w[1] * offset,
    base[2] + w[2] * offset,
    1,
  ];
}

/**
 * Distance from `origin` along `dir` to where the ray leaves the part. With `fromInside`
 * the origin is known to be inside; otherwise it is on the part's surface.
 */
export function rayDepth(part: SplitPart, origin: Vec3, dir: Vec3, fromInside = false): number {
  const p = part.mesh.positions;
  const ix = part.mesh.indices;
  const o = add(origin, scale(dir, 1e-4));
  let best = Infinity;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3;
    const b = ix[t + 1] * 3;
    const c = ix[t + 2] * 3;
    const e1x = p[b] - p[a];
    const e1y = p[b + 1] - p[a + 1];
    const e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a];
    const e2y = p[c + 1] - p[a + 1];
    const e2z = p[c + 2] - p[a + 2];
    const px = dir[1] * e2z - dir[2] * e2y;
    const py = dir[2] * e2x - dir[0] * e2z;
    const pz = dir[0] * e2y - dir[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    // Exiting the solid means hitting a face that points along the ray.
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    if (nx * dir[0] + ny * dir[1] + nz * dir[2] <= 0) continue;
    const inv = 1 / det;
    const tx = o[0] - p[a];
    const ty = o[1] - p[a + 1];
    const tz = o[2] - p[a + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist > 0 && dist < best) best = dist;
  }
  void fromInside;
  return best === Infinity ? 0 : best + 1e-4;
}

/**
 * Peg positions on a joint face: the point deepest inside the outline (largest clearance),
 * or two well-separated points along the face's long axis when the face is long enough.
 */
export function pickSpots(
  outline: Float32Array,
  c: Vec3,
  n: Vec3,
  need: number,
  perJoint: ConnectorSettings['perJoint'],
  diameter: number,
): Vec3[] {
  const { u, v } = planeBasis(n);
  const pts: [number, number][] = [];
  for (let i = 0; i < outline.length; i += 3) {
    const dx = outline[i] - c[0];
    const dy = outline[i + 1] - c[1];
    const dz = outline[i + 2] - c[2];
    pts.push([dx * u[0] + dy * u[1] + dz * u[2], dx * v[0] + dy * v[1] + dz * v[2]]);
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const N = 48;
  const step = Math.max(maxX - minX, maxY - minY) / N || 1;
  const candidates: { x: number; y: number; clear: number }[] = [];
  for (let gx = 0; gx <= N; gx++)
    for (let gy = 0; gy <= N; gy++) {
      const x = minX + gx * step;
      const y = minY + gy * step;
      if (x > maxX || y > maxY || !inside(pts, x, y)) continue;
      const clear = distToOutline(pts, x, y);
      if (clear >= need) candidates.push({ x, y, clear });
    }
  if (!candidates.length) return [];
  candidates.sort((a, b) => b.clear - a.clear);
  const to3 = (x: number, y: number): Vec3 => [c[0] + u[0] * x + v[0] * y, c[1] + u[1] * x + v[1] * y, c[2] + u[2] * x + v[2] * y];
  const best = candidates[0];
  const wantTwo = perJoint === 2 || (perJoint === 'auto' && Math.max(maxX - minX, maxY - minY) >= diameter * 6);
  if (!wantTwo) return [to3(best.x, best.y)];
  // Farthest pair among the candidates, at least 2.5 diameters apart.
  let pair: [number, number] | null = null;
  let far = diameter * 2.5;
  const sample = candidates.slice(0, 600);
  for (let i = 0; i < sample.length; i++)
    for (let j = i + 1; j < sample.length; j++) {
      const d = Math.hypot(sample[i].x - sample[j].x, sample[i].y - sample[j].y);
      if (d > far) {
        far = d;
        pair = [i, j];
      }
    }
  if (!pair) return [to3(best.x, best.y)];
  // Pull the pair towards the middle so each keeps generous clearance.
  const [a, b] = pair.map((i) => sample[i]);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const pull = (q: { x: number; y: number }) => {
    let x = q.x;
    let y = q.y;
    for (let t = 0.25; t >= 0; t -= 0.05) {
      const px = q.x + (mx - q.x) * t;
      const py = q.y + (my - q.y) * t;
      if (inside(pts, px, py) && distToOutline(pts, px, py) >= need && Math.hypot(px - mx, py - my) >= diameter * 1.25) {
        x = px;
        y = py;
        break;
      }
    }
    return to3(x, y);
  };
  return [pull(a), pull(b)];
}

function inside(pts: [number, number][], x: number, y: number): boolean {
  let s = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) s = !s;
  }
  return s;
}

function distToOutline(pts: [number, number][], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}
