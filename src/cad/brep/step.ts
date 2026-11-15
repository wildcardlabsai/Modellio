import type * as Replicad from 'replicad';
import type { Vec3 } from '@/types/document';
import { buildBrep, buildShape, BrepError, rigid } from './build';
import type { BrepBuild, BrepRequest } from './types';

/**
 * STEP import and export with OpenCascade. Runs where the engine is loaded (worker, tests).
 *
 * Export: precise solids and standard primitives are written as exact geometry; meshes and Boolean
 * results become faceted solids (their triangles sewn together). Import: every solid in the file
 * becomes an exact solid that can be moved, filleted and chamfered (no parametric history).
 */
type R = typeof Replicad;
type Shape3D = Replicad.Shape3D;

export const STEP_LIMITS = { bytes: 60 * 1024 * 1024, solids: 200, facetedTriangles: 150_000 };

// --- export ----------------------------------------------------------------------------------
export type StepExportItem =
  | {
      kind: 'exact';
      name: string;
      color: string;
      req: BrepRequest;
      /** Target size in mm (the object's size). */
      size: Vec3;
      mirror?: Vec3;
      /** World matrix (column-major 4×4, rotation + translation). */
      matrix: number[];
    }
  | { kind: 'mesh'; name: string; color: string; positions: Float32Array; indices: Uint32Array };

export interface StepExportResult {
  bytes: Uint8Array;
  exact: string[];
  faceted: string[];
}

function facetedSolid(r: R, positions: Float32Array | number[], indices: Uint32Array | number[]): Shape3D {
  const faces: Replicad.Face[] = [];
  const p = (i: number): [number, number, number] => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  for (let t = 0; t < indices.length; t += 3) {
    const a = p(indices[t]);
    const b = p(indices[t + 1]);
    const c = p(indices[t + 2]);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const area = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]);
    if (area < 1e-10) continue;
    faces.push(r.makePolygon([a, b, c]));
  }
  if (!faces.length) throw new BrepError('Nothing to export.');
  try {
    return r.makeSolid(faces);
  } catch {
    // Not closed: keep the surfaces so nothing is lost.
    return r.makeCompound(faces) as Shape3D;
  }
}

/** Place an exact solid like the displayed object: centre, fit to size, mirror, rotate, move. */
function placeExact(r: R, item: Extract<StepExportItem, { kind: 'exact' }>): Shape3D | null {
  const { shape: raw, centre } = buildShape(r, item.req);
  let s = raw.translate([-centre[0], -centre[1], -centre[2]]) as Shape3D;
  // Recentre on the final solid (operations rarely change the box, but be exact).
  const bb = s.boundingBox;
  const c: Vec3 = [
    (bb.bounds[0][0] + bb.bounds[1][0]) / 2,
    (bb.bounds[0][1] + bb.bounds[1][1]) / 2,
    (bb.bounds[0][2] + bb.bounds[1][2]) / 2,
  ];
  s = s.translate([-c[0], -c[1], -c[2]]) as Shape3D;
  const k = [item.size[0] / bb.width, item.size[1] / bb.height, item.size[2] / bb.depth];
  if (k.some((v) => !Number.isFinite(v))) return null;
  const uniform = Math.abs(k[0] - k[1]) < 1e-6 && Math.abs(k[1] - k[2]) < 1e-6;
  if (!uniform) {
    s.delete();
    return null; // stretched unevenly: cannot stay exact
  }
  if (Math.abs(k[0] - 1) > 1e-9) s = s.scale(k[0], [0, 0, 0]) as Shape3D;
  const m = item.mirror ?? [1, 1, 1];
  if (m[0] < 0) s = s.mirror('YZ', [0, 0, 0]) as Shape3D;
  if (m[1] < 0) s = s.mirror('XZ', [0, 0, 0]) as Shape3D;
  if (m[2] < 0) s = s.mirror('XY', [0, 0, 0]) as Shape3D;
  const { axis, angle, t } = rigid(item.matrix);
  if (angle > 1e-9) s = s.rotate(angle, [0, 0, 0], axis) as Shape3D;
  return s.translate(t) as Shape3D;
}

export async function exportStep(r: R, items: StepExportItem[]): Promise<StepExportResult> {
  const shapes: { shape: Shape3D; name: string; color: string }[] = [];
  try {
    const res = { exact: [] as string[], faceted: [] as string[] };
    let triangles = 0;
    for (const item of items) {
      if (item.kind === 'exact') {
        const s = placeExact(r, item);
        if (!s) throw new BrepError(`"${item.name}" is stretched unevenly and cannot be written exactly.`);
        shapes.push({ shape: s, name: item.name, color: item.color });
        res.exact.push(item.name);
      } else {
        triangles += item.indices.length / 3;
        if (triangles > STEP_LIMITS.facetedTriangles)
          throw new BrepError(
            'Too many mesh triangles for STEP (meshes are written as faceted solids). Export meshes as 3MF or STL instead.',
          );
        shapes.push({ shape: facetedSolid(r, item.positions, item.indices), name: item.name, color: item.color });
        res.faceted.push(item.name);
      }
    }
    if (!shapes.length) throw new BrepError('Nothing to export.');
    const blob = r.exportSTEP(shapes, { unit: 'MM', modelUnit: 'MM' });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ...res };
  } finally {
    for (const s of shapes) s.shape.delete();
  }
}

// --- import ----------------------------------------------------------------------------------
export interface StepSolid {
  name: string;
  /** Exact geometry (BRep text) for a `brep` recipe base. */
  data: string;
  build: BrepBuild;
}

export async function importStep(r: R, bytes: Uint8Array, fileName: string): Promise<StepSolid[]> {
  if (bytes.byteLength > STEP_LIMITS.bytes) throw new BrepError(`This STEP file is larger than ${STEP_LIMITS.bytes / 1024 / 1024} MB.`);
  const head = new TextDecoder().decode(bytes.subarray(0, 64));
  if (!/ISO-10303-21/.test(head)) throw new BrepError('This is not a STEP file (ISO 10303-21).');
  let shape: Replicad.AnyShape;
  try {
    shape = await r.importSTEP(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  } catch {
    throw new BrepError('The STEP file could not be read. It may be damaged or use features this reader does not support.');
  }
  const base = fileName.replace(/\.(step|stp)$/i, '');
  try {
    const solids = (shape as Shape3D).solids ?? [];
    if (!solids.length)
      throw new BrepError('The STEP file has no closed solids (only surfaces or curves), so there is nothing to make solid.');
    if (solids.length > STEP_LIMITS.solids)
      throw new BrepError(`The STEP file has ${solids.length} solids; the limit is ${STEP_LIMITS.solids}.`);
    const out: StepSolid[] = [];
    solids.forEach((solid, i) => {
      const data = solid.serialize();
      solid.delete();
      const build = buildBrep(r, { recipe: { base: { kind: 'brep', data, source: fileName }, ops: [] }, size: [0, 0, 0] });
      out.push({ name: solids.length > 1 ? `${base} ${i + 1}` : base, data, build });
    });
    return out;
  } finally {
    shape.delete();
  }
}
