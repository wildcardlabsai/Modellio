import * as THREE from 'three';
import type { ExportBody } from '../export/collect';

export interface PrintSettings {
  /** Faces sloping down more than this from vertical need support (degrees, typically 45). */
  overhangAngle: number;
  /** Walls thinner than this (mm) may not print (≈ 2 × nozzle width). */
  minWall: number;
  /** Bed size (mm). */
  plate: [number, number];
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = { overhangAngle: 45, minWall: 0.8, plate: [200, 200] };

export interface BodyReport {
  id: string;
  name: string;
  /** Triangle indices (into the body's mesh) that are overhangs / thin. */
  overhangTris: number[];
  thinTris: number[];
  overhangArea: number;
  thinnestWall: number | null;
  floating: boolean;
  belowPlate: boolean;
  watertight: boolean;
}

export interface PrintReport {
  bodies: BodyReport[];
  offPlate: boolean;
  issues: { level: 'error' | 'warning' | 'ok'; text: string }[];
}

const BED_EPS = 0.2; // mm: faces this close to the bed are supported by it

/** Overhang faces: facing down more steeply than the threshold, and not lying on the bed. */
export function findOverhangs(mesh: { positions: Float32Array; indices: Uint32Array }, angleDeg: number): { tris: number[]; area: number } {
  const p = mesh.positions;
  const ix = mesh.indices;
  const limit = -Math.sin((angleDeg * Math.PI) / 180); // n.z below this ⇒ slope beyond the angle from vertical
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    n = new THREE.Vector3();
  const tris: number[] = [];
  let area = 0;
  for (let t = 0; t < ix.length / 3; t++) {
    a.fromArray(p, ix[t * 3] * 3);
    b.fromArray(p, ix[t * 3 + 1] * 3);
    c.fromArray(p, ix[t * 3 + 2] * 3);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const twiceArea = n.length();
    if (twiceArea < 1e-9) continue;
    n.divideScalar(twiceArea);
    if (n.z >= limit) continue;
    if (Math.max(a.z, b.z, c.z) < BED_EPS) continue; // sitting on the bed
    tris.push(t);
    area += twiceArea / 2;
  }
  return { tris, area };
}

/**
 * Thin walls: from sampled triangle centres, cast a ray inwards (against the
 * face normal) and measure the distance to the opposite surface.
 */
export function findThinWalls(
  mesh: { positions: Float32Array; indices: Uint32Array },
  minWall: number,
  maxSamples = 1500,
): { tris: number[]; thinnest: number | null } {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const obj = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  obj.updateMatrixWorld();
  const triCount = mesh.indices.length / 3;
  const stride = Math.max(1, Math.floor(triCount / maxSamples));
  const ray = new THREE.Raycaster();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    n = new THREE.Vector3(),
    centre = new THREE.Vector3();
  const tris: number[] = [];
  let thinnest: number | null = null;
  for (let t = 0; t < triCount; t += stride) {
    a.fromArray(mesh.positions, mesh.indices[t * 3] * 3);
    b.fromArray(mesh.positions, mesh.indices[t * 3 + 1] * 3);
    c.fromArray(mesh.positions, mesh.indices[t * 3 + 2] * 3);
    n.subVectors(b, a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    centre.copy(a).add(b).add(c).divideScalar(3);
    ray.set(centre.clone().addScaledVector(n, -1e-3), n.clone().negate());
    ray.far = Math.max(minWall * 4, 5);
    const hit = ray.intersectObject(obj, false).find((h) => h.distance > 1e-3);
    if (!hit) continue;
    const thickness = hit.distance + 1e-3;
    if (thinnest === null || thickness < thinnest) thinnest = thickness;
    if (thickness < minWall) tris.push(t);
  }
  geo.dispose();
  (obj.material as THREE.Material).dispose();
  return { tris, thinnest };
}

/** Full pre-print check of the export bodies (world space, mm). */
export function analyzePrintability(bodies: ExportBody[], settings: PrintSettings = DEFAULT_PRINT_SETTINGS): PrintReport {
  const reports: BodyReport[] = [];
  const all = new THREE.Box3();
  for (const body of bodies) {
    const bounds = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < body.mesh.positions.length; i += 3) bounds.expandByPoint(v.fromArray(body.mesh.positions, i));
    all.union(bounds);
    const over = findOverhangs(body.mesh, settings.overhangAngle);
    const thin = findThinWalls(body.mesh, settings.minWall);
    reports.push({
      id: body.id,
      name: body.name,
      overhangTris: over.tris,
      thinTris: thin.tris,
      overhangArea: over.area,
      thinnestWall: thin.thinnest,
      floating: bounds.min.z > 0.05,
      belowPlate: bounds.min.z < -0.01,
      watertight: body.watertight,
    });
  }
  const [w, d] = settings.plate;
  const offPlate =
    !all.isEmpty() && (all.min.x < -w / 2 - 1e-3 || all.max.x > w / 2 + 1e-3 || all.min.y < -d / 2 - 1e-3 || all.max.y > d / 2 + 1e-3);

  const issues: PrintReport['issues'] = [];
  for (const r of reports) {
    if (!r.watertight) issues.push({ level: 'error', text: `${r.name} is not watertight; the slicer may need to repair it.` });
    if (r.belowPlate) issues.push({ level: 'error', text: `${r.name} goes below the build plate. Use Drop to workplane (D).` });
    if (r.floating) issues.push({ level: 'warning', text: `${r.name} does not touch the plate: it will need supports, or drop it (D).` });
    if (r.thinTris.length)
      issues.push({
        level: 'warning',
        text: `${r.name} has walls thinner than ${settings.minWall} mm (thinnest ${r.thinnestWall?.toFixed(2)} mm).`,
      });
    if (r.overhangArea > 1)
      issues.push({
        level: 'warning',
        text: `${r.name}: ${r.overhangArea.toFixed(0)} mm² of overhangs steeper than ${settings.overhangAngle}° need supports.`,
      });
  }
  if (offPlate) issues.push({ level: 'error', text: `The design is larger than (or outside) the ${w} × ${d} mm plate.` });
  if (!issues.length && reports.length)
    issues.push({ level: 'ok', text: 'Looks printable: no overhangs, thin walls or placement problems found.' });
  return { bodies: reports, offPlate, issues };
}
