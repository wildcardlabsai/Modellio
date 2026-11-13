import { ShapeUtils, Vector2 } from 'three';
import type { ImportIssue, ThreeMFDocument, ThreeMFInstance } from '../model/types';
import { applyToPoint } from '../model/mat4';
import { expandPaint, parsePaintTree, PaintDecodeError, type PaintNode } from '../import/paint';
import type { CapRecord, Joint, PartReport, SplitOptions, SplitPart, SplitResult, Vec3 } from './types';

/**
 * Colour splitting: turns every placed instance into closed, single-colour solids.
 *
 * Per instance (in assembly coordinates, mm):
 *  1. Weld identical vertices, drop degenerate triangles.
 *  2. Expand fine slicer paint into its exact sub-triangles, then make the mesh conforming
 *     again (neighbours of subdivided edges are re-triangulated around the new vertices).
 *  3. Group triangles into regions: one per colour, or one per connected piece of a colour.
 *  4. Trace each region's boundary loops (where it meets another colour, or where the source
 *     was open) and close each loop with a cap. A loop's cap is triangulated once, from a
 *     canonical vertex order, and shared by both regions with opposite orientation, so two
 *     parts that meet along a two-colour boundary have identical mating faces.
 *  5. Validate every part (closed, manifold, positive volume) and report what was approximated.
 *
 * Source data is never modified; parts are new meshes.
 */
export function splitDocument(doc: ThreeMFDocument, options: SplitOptions, onProgress: (f: number) => void = () => {}): SplitResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const issues: ImportIssue[] = [];
  const parts: SplitPart[] = [];
  const joints: Joint[] = [];
  let paintedSubTriangles = 0;
  const counters = { degenerate: 0, paintInvalid: 0, fanCaps: 0, nonPlanarCaps: 0, sharedLoopsMissing: 0, sourceOpen: 0 };

  const printable = doc.instances.filter((i) => doc.objects[i.objectIndex].mesh?.triangles.length);
  printable.forEach((inst, k) => {
    const r = splitInstance(doc, inst, options, counters);
    paintedSubTriangles += r.paintedSubTriangles;
    parts.push(...r.parts);
    joints.push(...r.joints);
    onProgress((k + 1) / Math.max(1, printable.length));
  });

  let finalParts = parts;
  let finalJoints = joints;
  if (!options.keepObjectsSeparate) ({ parts: finalParts, joints: finalJoints } = mergeAcrossInstances(doc, parts, joints, options));

  if (counters.degenerate)
    issues.push({
      level: 'info',
      code: 'degenerate',
      message: `${counters.degenerate} degenerate (zero-area) triangle(s) were ignored.`,
      count: counters.degenerate,
    });
  if (counters.paintInvalid)
    issues.push({
      level: 'warning',
      code: 'paint-invalid',
      message: `${counters.paintInvalid} painted triangle(s) could not be decoded and keep their main colour.`,
      count: counters.paintInvalid,
    });
  if (paintedSubTriangles)
    issues.push({
      level: 'info',
      code: 'paint-exact',
      message: `Fine paint was split exactly into ${paintedSubTriangles} sub-triangles.`,
      count: paintedSubTriangles,
    });
  if (counters.fanCaps)
    issues.push({
      level: 'warning',
      code: 'fan-caps',
      message: `${counters.fanCaps} joint surface(s) could not be filled flat and were filled around their centre instead; check those parts.`,
      count: counters.fanCaps,
    });
  if (counters.nonPlanarCaps)
    issues.push({
      level: 'info',
      code: 'curved-caps',
      message: `${counters.nonPlanarCaps} joint surface(s) are not flat (their colour boundary is curved).`,
      count: counters.nonPlanarCaps,
    });
  if (counters.sharedLoopsMissing)
    issues.push({
      level: 'warning',
      code: 'multi-colour-joints',
      message: `${counters.sharedLoopsMissing} boundary(ies) touch three or more colours, so the neighbouring parts were closed separately and may not fit perfectly.`,
      count: counters.sharedLoopsMissing,
    });
  if (counters.sourceOpen)
    issues.push({
      level: 'warning',
      code: 'source-open',
      message: `${counters.sourceOpen} edge(s) were already open in the original model; they were closed.`,
      count: counters.sourceOpen,
    });
  const bad = finalParts.filter((p) => !p.report.watertight);
  if (bad.length)
    issues.push({
      level: 'error',
      code: 'not-watertight',
      message: `${bad.length} part(s) are not closed solids and should not be printed as they are: ${bad
        .slice(0, 4)
        .map((p) => p.name)
        .join(', ')}${bad.length > 4 ? '…' : ''}.`,
      count: bad.length,
    });
  const tiny = finalParts.filter((p) => Math.abs(p.report.volume) < 1);
  if (tiny.length)
    issues.push({
      level: 'warning',
      code: 'tiny-parts',
      message: `${tiny.length} part(s) are smaller than 1 mm³ and may not print.`,
      count: tiny.length,
    });

  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return {
    parts: finalParts,
    joints: finalJoints,
    issues,
    stats: {
      parts: finalParts.length,
      joints: finalJoints.length,
      triangles: finalParts.reduce((s, p) => s + p.mesh.indices.length / 3, 0),
      paintedSubTriangles,
      ms,
    },
  };
}

type Counters = {
  degenerate: number;
  paintInvalid: number;
  fanCaps: number;
  nonPlanarCaps: number;
  sharedLoopsMissing: number;
  sourceOpen: number;
};

const KEY = 67108864; // 2^26: edge keys a * KEY + b stay below 2^53

function splitInstance(doc: ThreeMFDocument, inst: ThreeMFInstance, options: SplitOptions, counters: Counters) {
  const obj = doc.objects[inst.objectIndex];
  const mesh = obj.mesh!;
  const nonPrinting = new Set(doc.materials.filter((m) => m.materialType === 'nonprinting').map((m) => m.materialId));

  // 1. World positions, welded.
  const pos: number[] = [];
  const remap = new Uint32Array(mesh.vertices.length / 3);
  const table = new Map<string, number>();
  const p = [0, 0, 0];
  for (let v = 0; v < remap.length; v++) {
    applyToPoint(inst.transform, mesh.vertices[v * 3], mesh.vertices[v * 3 + 1], mesh.vertices[v * 3 + 2], p);
    const x = Math.fround(p[0]);
    const y = Math.fround(p[1]);
    const z = Math.fround(p[2]);
    const key = `${x},${y},${z}`;
    let id = table.get(key);
    if (id === undefined) {
      id = pos.length / 3;
      pos.push(x, y, z);
      table.set(key, id);
    }
    remap[v] = id;
  }
  if (pos.length / 3 >= KEY) throw new Error('This object has too many vertices to split (more than 67 million).');
  // Mirrored instances flip winding; restore outward orientation.
  const flip =
    inst.transform[0] * (inst.transform[5] * inst.transform[10] - inst.transform[9] * inst.transform[6]) -
      inst.transform[4] * (inst.transform[1] * inst.transform[10] - inst.transform[9] * inst.transform[2]) +
      inst.transform[8] * (inst.transform[1] * inst.transform[6] - inst.transform[5] * inst.transform[2]) <
    0;

  // 2. Triangles (+ exact paint).
  const tris: number[] = [];
  const mats: number[] = [];
  const mid = new Map<number, number>();
  const midpoint = (a: number, b: number) => {
    const k = a < b ? a * KEY + b : b * KEY + a;
    let m = mid.get(k);
    if (m === undefined) {
      m = pos.length / 3;
      pos.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2);
      mid.set(k, m);
    }
    return m;
  };
  const paint = mesh.paint;
  const trees = new Map<number, PaintNode | null>();
  let paintedSubTriangles = 0;
  const leafBuf: number[] = [];
  for (let t = 0; t < mesh.perTriangleMaterialIds.length; t++) {
    const a = remap[mesh.triangles[t * 3]];
    let b = remap[mesh.triangles[t * 3 + 1]];
    let c = remap[mesh.triangles[t * 3 + 2]];
    if (flip) [b, c] = [c, b];
    if (a === b || b === c || a === c) {
      counters.degenerate++;
      continue;
    }
    const mat = mesh.perTriangleMaterialIds[t];
    const code = paint?.codes[t] ?? 0;
    if (options.exactPaint && code && paint && !nonPrinting.has(mat)) {
      let tree = trees.get(code);
      if (tree === undefined) {
        try {
          tree = parsePaintTree(paint.strings[code - 1]);
        } catch (e) {
          if (!(e instanceof PaintDecodeError)) throw e;
          tree = null;
        }
        trees.set(code, tree);
      }
      if (tree === null) counters.paintInvalid++;
      else if (!('state' in tree)) {
        leafBuf.length = 0;
        // Paint trees are defined on the source vertex order; a mirrored instance swaps b and c back.
        expandPaint(tree, flip ? [a, c, b] : [a, b, c], midpoint, leafBuf);
        for (let i = 0; i < leafBuf.length; i += 4) {
          const st = leafBuf[i + 3];
          const m = st > 0 ? (doc.filamentMaterials[st] ?? mat) : (paint.base?.[t] ?? mat);
          if (flip) tris.push(leafBuf[i], leafBuf[i + 2], leafBuf[i + 1]);
          else tris.push(leafBuf[i], leafBuf[i + 1], leafBuf[i + 2]);
          mats.push(m);
          paintedSubTriangles++;
        }
        continue;
      }
    }
    tris.push(a, b, c);
    mats.push(mat);
  }
  // Conforming pass: any triangle edge that was subdivided elsewhere gets its midpoint vertices.
  let triangles = tris;
  let materials = mats;
  if (mid.size) {
    const chain = (a: number, b: number, out: number[]) => {
      const m = mid.get(a < b ? a * KEY + b : b * KEY + a);
      if (m === undefined) return;
      chain(a, m, out);
      out.push(m);
      chain(m, b, out);
    };
    const t2: number[] = [];
    const m2: number[] = [];
    const ring: number[] = [];
    for (let t = 0; t < tris.length / 3; t++) {
      const a = tris[t * 3];
      const b = tris[t * 3 + 1];
      const c = tris[t * 3 + 2];
      ring.length = 0;
      ring.push(a);
      chain(a, b, ring);
      ring.push(b);
      chain(b, c, ring);
      ring.push(c);
      chain(c, a, ring);
      if (ring.length === 3) {
        t2.push(a, b, c);
        m2.push(mats[t]);
        continue;
      }
      // Fan around the centroid (the polygon is the triangle with extra points on its edges: convex).
      const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3;
      const cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
      const cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
      const ci = pos.length / 3;
      pos.push(cx, cy, cz);
      for (let i = 0; i < ring.length; i++) {
        t2.push(ci, ring[i], ring[(i + 1) % ring.length]);
        m2.push(mats[t]);
      }
    }
    triangles = t2;
    materials = m2;
  }
  const nt = materials.length;

  // 3. Regions (union-find over edge-adjacent triangles of the same material).
  const parent = new Int32Array(nt);
  for (let i = 0; i < nt; i++) parent[i] = i;
  const find = (x: number) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const directed = new Map<number, number>(); // directed edge → first triangle owning it
  const undirected = new Map<number, number>();
  for (let t = 0; t < nt; t++)
    for (let e = 0; e < 3; e++) {
      const a = triangles[t * 3 + e];
      const b = triangles[t * 3 + ((e + 1) % 3)];
      const dk = a * KEY + b;
      if (!directed.has(dk)) directed.set(dk, t);
      const uk = a < b ? a * KEY + b : b * KEY + a;
      const other = undirected.get(uk);
      if (other === undefined) undirected.set(uk, t);
      else if (materials[other] === materials[t]) {
        const ra = find(other);
        const rb = find(t);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  const regionOf = new Int32Array(nt);
  const regions = new Map<string, number[]>(); // region key → triangles
  for (let t = 0; t < nt; t++) {
    if (nonPrinting.has(materials[t])) {
      regionOf[t] = -1;
      continue;
    }
    const key = options.separateIslands ? `${materials[t]}:${find(t)}` : `${materials[t]}`;
    let list = regions.get(key);
    if (!list) regions.set(key, (list = []));
    list.push(t);
  }
  // Stable ids: per material, islands ordered by their first triangle.
  const regionList = [...regions.entries()].sort((x, y) => materials[x[1][0]] - materials[y[1][0]] || x[1][0] - y[1][0]);
  const islandIndex = new Map<number, number>();
  const regionIds: string[] = [];
  regionList.forEach(([, list], r) => {
    const m = materials[list[0]];
    const k = islandIndex.get(m) ?? 0;
    islandIndex.set(m, k + 1);
    regionIds.push(`${inst.instanceId}|m${m}|${k}`);
    for (const t of list) regionOf[t] = r;
  });

  // 4. Boundary loops per region and shared caps.
  const capCache = new Map<string, CapGeometry>();
  const loopUsers = new Map<string, { region: number; cap: number }[]>();
  const built: {
    region: number;
    triangles: number[];
    caps: { key: string; canonicalDir: boolean; geom: CapGeometry }[];
    sourceOpen: number;
  }[] = [];
  regionList.forEach(([, list], r) => {
    const out = new Map<number, number[]>(); // from vertex → to vertices (boundary edges)
    let sourceOpen = 0;
    for (const t of list)
      for (let e = 0; e < 3; e++) {
        const a = triangles[t * 3 + e];
        const b = triangles[t * 3 + ((e + 1) % 3)];
        const opp = directed.get(b * KEY + a);
        if (opp !== undefined && regionOf[opp] === r) continue;
        if (opp === undefined) sourceOpen++;
        let l = out.get(a);
        if (!l) out.set(a, (l = []));
        l.push(b);
      }
    const caps: (typeof built)[number]['caps'] = [];
    for (const loop of traceLoops(out)) {
      if (loop.length < 3) continue;
      const { key, order, sameDir } = canonicalLoop(loop);
      let geom = capCache.get(key);
      if (!geom) {
        geom = triangulateLoop(order, pos, (a, b) => undirected.has(a < b ? a * KEY + b : b * KEY + a));
        capCache.set(key, geom);
        if (geom.method === 'fan') counters.fanCaps++;
        else if (geom.deviation > 0.05) counters.nonPlanarCaps++;
      }
      let users = loopUsers.get(key);
      if (!users) loopUsers.set(key, (users = []));
      users.push({ region: r, cap: caps.length });
      caps.push({ key, canonicalDir: sameDir, geom });
    }
    counters.sourceOpen += sourceOpen;
    built.push({ region: r, triangles: list, caps, sourceOpen });
  });

  // 5. Assemble parts.
  const instParts: SplitPart[] = [];
  const multiColour = new Set<string>();
  for (const [key, users] of loopUsers) if (users.length === 1) multiColour.add(key);
  counters.sharedLoopsMissing += [...multiColour].filter((k) => !capCache.get(k)!.sourceOnly).length;
  for (const b of built) {
    const list = b.triangles;
    const m = materials[list[0]];
    const material = doc.materials[m];
    const local = new Map<number, number>();
    const positions: number[] = [];
    const idx: number[] = [];
    const vertexOf = (v: number) => {
      let id = local.get(v);
      if (id === undefined) {
        id = positions.length / 3;
        local.set(v, id);
        positions.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      }
      return id;
    };
    for (const t of list) idx.push(vertexOf(triangles[t * 3]), vertexOf(triangles[t * 3 + 1]), vertexOf(triangles[t * 3 + 2]));
    const surfaceTriangles = list.length;
    const caps: CapRecord[] = [];
    for (const c of b.caps) {
      const first = idx.length / 3;
      const g = c.geom;
      // Extra vertices (a fan centre) get their own vertex; both parts of a joint use the same coordinates.
      const extraIds: number[] = [];
      for (let e = 0; e < g.extra.length; e += 3) {
        extraIds.push(positions.length / 3);
        positions.push(g.extra[e], g.extra[e + 1], g.extra[e + 2]);
      }
      const vid = (i: number) => (i < g.order.length ? vertexOf(g.order[i]) : extraIds[i - g.order.length]);
      // Cap triangles follow the canonical loop direction; a region whose boundary runs the same way needs them reversed.
      for (let i = 0; i < g.tris.length; i += 3) {
        const x = vid(g.tris[i]);
        const y = vid(g.tris[i + 1]);
        const z = vid(g.tris[i + 2]);
        if (c.canonicalDir) idx.push(x, z, y);
        else idx.push(x, y, z);
      }
      const n = c.canonicalDir ? g.normal.map((v) => -v) : g.normal;
      caps.push({
        loopKey: `${inst.instanceId}|${c.key}`,
        firstTriangle: first,
        triangleCount: g.tris.length / 3,
        area: g.area,
        centroid: g.centroid,
        normal: n as Vec3,
        deviation: g.deviation,
        method: g.method,
        outline: new Float32Array(g.order.flatMap((v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]])),
        neighbourPartId: null,
      });
    }
    const partMesh = { positions: new Float32Array(positions), indices: new Uint32Array(idx) };
    const report = validatePart(partMesh, surfaceTriangles);
    report.sourceOpenEdges = b.sourceOpen;
    if (b.sourceOpen) report.warnings.push(`${b.sourceOpen} edge(s) were open in the original model and were closed.`);
    for (const c of caps) {
      if (c.method === 'fan')
        report.warnings.push('A joint surface was filled around its centre because its boundary is not flat enough to triangulate.');
    }
    const regionId = regionIds[b.region];
    const island = Number(regionId.split('|')[2]);
    const sameColourCount = islandIndex.get(m) ?? 1;
    instParts.push({
      partId: regionId,
      name: `${material.name}${sameColourCount > 1 ? ` ${island + 1}` : ''} — ${inst.name}`,
      materialId: m,
      colour: material.colour,
      materialName: material.name,
      instanceIds: [inst.instanceId],
      objectIds: [obj.objectId],
      mesh: partMesh,
      surfaceTriangles,
      caps,
      report,
    });
  }

  // Joints: loops shared by exactly two regions.
  const instJoints: Joint[] = [];
  for (const [key, users] of loopUsers) {
    if (users.length !== 2) continue;
    const [u, v] = users;
    const pa = instParts[u.region];
    const pb = instParts[v.region];
    const capA = pa.caps[u.cap];
    const capB = pb.caps[v.cap];
    capA.neighbourPartId = pb.partId;
    capB.neighbourPartId = pa.partId;
    instJoints.push({
      jointId: `${inst.instanceId}|${key}`,
      partA: pa.partId,
      partB: pb.partId,
      capA: u.cap,
      capB: v.cap,
      area: capA.area,
      centroid: capA.centroid,
      normal: capA.normal,
      deviation: capA.deviation,
      kind: 'surface',
    });
  }
  return { parts: instParts, joints: instJoints, paintedSubTriangles };
}

interface CapGeometry {
  /** Loop vertices (instance vertex ids) in canonical order. */
  order: number[];
  /** Triangles: indices into `order`, or ≥ order.length for extra vertices (the fan centre). */
  tris: number[];
  extra: number[];
  area: number;
  centroid: Vec3;
  /** Normal of the canonical orientation. */
  normal: Vec3;
  deviation: number;
  method: 'planar' | 'fan';
  sourceOnly?: boolean;
}

/** Decompose boundary edges into closed loops (every vertex has equal in- and out-degree). */
function traceLoops(out: Map<number, number[]>): number[][] {
  const loops: number[][] = [];
  for (const [start, list] of out) {
    while (list.length) {
      const loop: number[] = [start];
      let cur = list.pop()!;
      let guard = 0;
      while (cur !== start && guard++ < 10_000_000) {
        loop.push(cur);
        const next = out.get(cur);
        if (!next || !next.length) break; // open chain (shouldn't happen on oriented input)
        cur = next.pop()!;
      }
      loops.push(loop);
    }
  }
  return loops;
}

/** Rotate a loop to start at its smallest vertex id and pick the direction whose second vertex is smaller. */
function canonicalLoop(loop: number[]): { key: string; order: number[]; sameDir: boolean } {
  let mi = 0;
  for (let i = 1; i < loop.length; i++) if (loop[i] < loop[mi]) mi = i;
  const n = loop.length;
  const fwdNext = loop[(mi + 1) % n];
  const backNext = loop[(mi - 1 + n) % n];
  const sameDir = fwdNext < backNext;
  const order: number[] = [];
  for (let k = 0; k < n; k++) order.push(sameDir ? loop[(mi + k) % n] : loop[(mi - k + n) % n]);
  return { key: order.join(','), order, sameDir };
}

/** Close a loop: planar projection + ear clipping, or a centroid fan when that fails. */
function triangulateLoop(order: number[], pos: number[], meshHasEdge: (a: number, b: number) => boolean): CapGeometry {
  const n = order.length;
  // Newell normal and centroid.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    const a = order[i] * 3;
    const b = order[(i + 1) % n] * 3;
    nx += (pos[a + 1] - pos[b + 1]) * (pos[a + 2] + pos[b + 2]);
    ny += (pos[a + 2] - pos[b + 2]) * (pos[a] + pos[b]);
    nz += (pos[a] - pos[b]) * (pos[a + 1] + pos[b + 1]);
    cx += pos[a];
    cy += pos[a + 1];
    cz += pos[a + 2];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  const len = Math.hypot(nx, ny, nz);
  const centroid: Vec3 = [cx, cy, cz];
  const normal: Vec3 = len > 1e-12 ? [nx / len, ny / len, nz / len] : [0, 0, 1];
  let deviation = 0;
  for (let i = 0; i < n; i++) {
    const a = order[i] * 3;
    deviation = Math.max(deviation, Math.abs((pos[a] - cx) * normal[0] + (pos[a + 1] - cy) * normal[1] + (pos[a + 2] - cz) * normal[2]));
  }
  const fan = (): CapGeometry => {
    const tris: number[] = [];
    for (let i = 0; i < n; i++) tris.push(n, i, (i + 1) % n);
    // Fan normal: area-weighted sum of its triangles (same orientation as the loop).
    let area = 0;
    let fx = 0;
    let fy = 0;
    let fz = 0;
    for (let i = 0; i < n; i++) {
      const a = order[i] * 3;
      const b = order[(i + 1) % n] * 3;
      const ux = pos[a] - cx;
      const uy = pos[a + 1] - cy;
      const uz = pos[a + 2] - cz;
      const vx = pos[b] - cx;
      const vy = pos[b + 1] - cy;
      const vz = pos[b + 2] - cz;
      const x = uy * vz - uz * vy;
      const y = uz * vx - ux * vz;
      const z = ux * vy - uy * vx;
      fx += x;
      fy += y;
      fz += z;
      area += Math.hypot(x, y, z) / 2;
    }
    const fl = Math.hypot(fx, fy, fz) || 1;
    return { order, tris, extra: [cx, cy, cz], area, centroid, normal: [fx / fl, fy / fl, fz / fl], deviation, method: 'fan' };
  };
  if (len < 1e-12 || n > 200_000) return fan();
  if (n === 3) return { order, tris: [0, 1, 2], extra: [], area: len / 2, centroid, normal, deviation, method: 'planar' };
  // Orthonormal basis of the plane.
  const ax = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ux = normal[1] * ax[2] - normal[2] * ax[1];
  let uy = normal[2] * ax[0] - normal[0] * ax[2];
  let uz = normal[0] * ax[1] - normal[1] * ax[0];
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = normal[1] * uz - normal[2] * uy;
  const vy = normal[2] * ux - normal[0] * uz;
  const vz = normal[0] * uy - normal[1] * ux;
  const pts: Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = order[i] * 3;
    const dx = pos[a] - cx;
    const dy = pos[a + 1] - cy;
    const dz = pos[a + 2] - cz;
    pts.push(new Vector2(dx * ux + dy * uy + dz * uz, dx * vx + dy * vy + dz * vz));
  }
  const polyArea = signedArea(pts);
  // Projection must keep the loop simple and non-degenerate.
  if (Math.abs(polyArea) < 1e-9 || selfIntersects(pts)) return fan();
  const faces = ShapeUtils.triangulateShape(pts.slice(), []);
  if (faces.length !== n - 2) return fan();
  const tris: number[] = [];
  let sum = 0;
  for (const [i, j, k] of faces) {
    const ar = (pts[j].x - pts[i].x) * (pts[k].y - pts[i].y) - (pts[k].x - pts[i].x) * (pts[j].y - pts[i].y);
    sum += Math.abs(ar) / 2;
    if (ar * polyArea >= 0) tris.push(i, j, k);
    else tris.push(i, k, j);
  }
  if (Math.abs(sum - Math.abs(polyArea)) > 1e-6 * Math.max(1, Math.abs(polyArea))) return fan();
  // A cap chord that is already a mesh edge (an "ear" triangle of the region lies on the boundary)
  // would double that edge. A centre fan has no chords; use it when it is valid (star-shaped loop).
  let conflict = false;
  for (let i = 0; i < tris.length && !conflict; i += 3)
    for (let e = 0; e < 3; e++) {
      const x = tris[i + e];
      const y = tris[i + ((e + 1) % 3)];
      const d = Math.abs(x - y);
      if (d !== 1 && d !== n - 1 && meshHasEdge(order[x], order[y])) {
        conflict = true;
        break;
      }
    }
  if (conflict) {
    let star = true;
    for (let i = 0; i < n && star; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if ((a.x * b.y - b.x * a.y) * polyArea <= 0) star = false;
    }
    if (star) return { ...fan(), method: 'planar' as const, normal, area: Math.abs(polyArea) };
  }
  // Normal in the loop's own orientation (Newell gives the polygon's orientation).
  return { order, tris, extra: [], area: Math.abs(polyArea), centroid, normal, deviation, method: 'planar' };
}

function signedArea(p: Vector2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** O(n²) segment test for small loops; larger loops use a uniform grid. */
function selfIntersects(p: Vector2[]): boolean {
  const n = p.length;
  if (n < 4) return false;
  const cross = (o: Vector2, a: Vector2, b: Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const hit = (i: number, j: number) => {
    const a = p[i];
    const b = p[(i + 1) % n];
    const c = p[j];
    const d = p[(j + 1) % n];
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  if (n <= 400) {
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1) && hit(i, j)) return true;
    return false;
  }
  // Grid broad phase.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of p) {
    minX = Math.min(minX, q.x);
    minY = Math.min(minY, q.y);
    maxX = Math.max(maxX, q.x);
    maxY = Math.max(maxY, q.y);
  }
  const g = Math.ceil(Math.sqrt(n));
  const sx = (maxX - minX) / g || 1;
  const sy = (maxY - minY) / g || 1;
  const cells = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    const x0 = Math.floor((Math.min(a.x, b.x) - minX) / sx);
    const x1 = Math.floor((Math.max(a.x, b.x) - minX) / sx);
    const y0 = Math.floor((Math.min(a.y, b.y) - minY) / sy);
    const y1 = Math.floor((Math.max(a.y, b.y) - minY) / sy);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = x * 100003 + y;
        let l = cells.get(k);
        if (!l) cells.set(k, (l = []));
        for (const j of l) {
          const adj = Math.abs(i - j) === 1 || Math.abs(i - j) === n - 1;
          if (!adj && hit(Math.min(i, j), Math.max(i, j))) return true;
        }
        l.push(i);
      }
  }
  return false;
}

/** Closed-solid validation: directed-edge pairing, volume, shells, bounds. */
export function validatePart(
  mesh: { positions: Float32Array; indices: Uint32Array },
  surfaceTriangles = mesh.indices.length / 3,
): PartReport {
  const { positions: p, indices: ix } = mesh;
  const nt = ix.length / 3;
  const directed = new Map<number, number>();
  let volume = 0;
  let surfaceArea = 0;
  for (let t = 0; t < nt; t++) {
    const a = ix[t * 3];
    const b = ix[t * 3 + 1];
    const c = ix[t * 3 + 2];
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = u * KEY + v;
      directed.set(k, (directed.get(k) ?? 0) + 1);
    }
    const ax = p[a * 3];
    const ay = p[a * 3 + 1];
    const az = p[a * 3 + 2];
    const bx = p[b * 3];
    const by = p[b * 3 + 1];
    const bz = p[b * 3 + 2];
    const cx = p[c * 3];
    const cy = p[c * 3 + 1];
    const cz = p[c * 3 + 2];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    if (t < surfaceTriangles) {
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const wx = cx - ax;
      const wy = cy - ay;
      const wz = cz - az;
      surfaceArea += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
    }
  }
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const [k, count] of directed) {
    const u = Math.floor(k / KEY);
    const v = k - u * KEY;
    const back = directed.get(v * KEY + u) ?? 0;
    if (count > 1) nonManifoldEdges++;
    else if (back !== 1) boundaryEdges++;
  }
  // Shells by vertex connectivity.
  const nv = p.length / 3;
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x: number) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let t = 0; t < nt; t++) {
    const r0 = find(ix[t * 3]);
    for (let k = 1; k < 3; k++) {
      const r = find(ix[t * 3 + k]);
      if (r !== r0) parent[r] = r0;
    }
  }
  const roots = new Set<number>();
  for (let i = 0; i < ix.length; i++) roots.add(find(ix[i]));
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  const watertight = boundaryEdges === 0 && nonManifoldEdges === 0 && nt > 0;
  const warnings: string[] = [];
  if (!watertight) warnings.push(`Not a closed solid: ${boundaryEdges} open and ${nonManifoldEdges} non-manifold edge(s).`);
  if (watertight && volume <= 0) warnings.push('The surface faces inwards (negative volume).');
  return {
    watertight,
    boundaryEdges,
    nonManifoldEdges,
    volume,
    surfaceArea,
    shells: roots.size,
    bounds: { min, max },
    sourceOpenEdges: 0,
    warnings,
  };
}

/** Merge equal-colour parts of different instances (when objects are not kept separate). */
function mergeAcrossInstances(
  doc: ThreeMFDocument,
  parts: SplitPart[],
  joints: Joint[],
  options: SplitOptions,
): { parts: SplitPart[]; joints: Joint[] } {
  void options;
  const byMat = new Map<number, SplitPart[]>();
  for (const p of parts) {
    let l = byMat.get(p.materialId);
    if (!l) byMat.set(p.materialId, (l = []));
    l.push(p);
  }
  const rename = new Map<string, { id: string; capOffset: number }>();
  const merged: SplitPart[] = [];
  for (const [m, list] of byMat) {
    if (list.length === 1) {
      merged.push(list[0]);
      rename.set(list[0].partId, { id: list[0].partId, capOffset: 0 });
      continue;
    }
    const id = `all|m${m}`;
    const positions: number[] = [];
    const indices: number[] = [];
    const caps: CapRecord[] = [];
    let surfaceTriangles = 0;
    for (const part of list) {
      const vOff = positions.length / 3;
      const tOff = indices.length / 3;
      rename.set(part.partId, { id, capOffset: caps.length });
      for (let i = 0; i < part.mesh.positions.length; i++) positions.push(part.mesh.positions[i]);
      for (let i = 0; i < part.mesh.indices.length; i++) indices.push(part.mesh.indices[i] + vOff);
      for (const c of part.caps) caps.push({ ...c, firstTriangle: c.firstTriangle + tOff });
      surfaceTriangles += part.surfaceTriangles;
    }
    const mesh = { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
    const report = validatePart(mesh);
    report.surfaceArea = list.reduce((s, p) => s + p.report.surfaceArea, 0);
    report.sourceOpenEdges = list.reduce((s, p) => s + p.report.sourceOpenEdges, 0);
    merged.push({
      partId: id,
      name: doc.materials[m].name,
      materialId: m,
      colour: list[0].colour,
      materialName: list[0].materialName,
      instanceIds: [...new Set(list.flatMap((p) => p.instanceIds))],
      objectIds: [...new Set(list.flatMap((p) => p.objectIds))],
      mesh,
      surfaceTriangles,
      caps,
      report,
    });
  }
  for (const p of merged)
    for (const c of p.caps) if (c.neighbourPartId) c.neighbourPartId = rename.get(c.neighbourPartId)?.id ?? c.neighbourPartId;
  const outJoints = joints.map((j) => ({
    ...j,
    partA: rename.get(j.partA)!.id,
    partB: rename.get(j.partB)!.id,
    capA: j.capA + rename.get(j.partA)!.capOffset,
    capB: j.capB + rename.get(j.partB)!.capOffset,
  }));
  return { parts: merged, joints: outJoints };
}
