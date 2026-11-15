import * as THREE from 'three';
import type { ModelDocument, ObjectId, Vec3 } from '@/types/document';
import { solidConversion } from '../brep/convert';
import type { BrepRequest } from '../brep/types';
import { buildGeometryForShape, solidRequest } from '../shapeRegistry';
import { computeCombined, exactCombineRequest } from '../operations/combine';
import { worldMatrix } from '../hierarchy';
import { geometryToMeshData, meshDataBounds, type MeshData } from '../kernel/meshData';
import { analyzeMesh } from '../geometry/validate';

/** One printable body in world space (mm, Z-up). */
export interface ExportBody {
  id: ObjectId;
  name: string;
  color: string;
  mesh: MeshData;
  watertight: boolean;
  /**
   * Exact geometry, for STEP: precise solids and standard primitives (recipe, size, mirror and
   * world matrix). Absent for meshes, text and Boolean results, which STEP writes as facets.
   */
  exact?: { req: BrepRequest; size: Vec3; mirror?: Vec3; matrix: number[] };
}

export interface ExportCollection {
  bodies: ExportBody[];
  /** Holes that are not inside a combination (they have no material, so they are skipped). */
  skippedHoles: number;
  /** Objects whose geometry was not ready (font or kernel still loading) or failed to combine. */
  failed: { name: string; reason: string }[];
  triangles: number;
  bounds: THREE.Box3;
}

/**
 * Collect the solid geometry to export: Boolean results are evaluated, every
 * transform is applied (so files contain final world positions in mm), holes
 * outside combinations are skipped and hidden objects are left out.
 */
export function collectExportBodies(doc: ModelDocument, ids?: ObjectId[]): ExportCollection {
  const out: ExportCollection = { bodies: [], skippedHoles: 0, failed: [], triangles: 0, bounds: new THREE.Box3() };

  const add = (id: ObjectId, name: string, color: string, mesh: MeshData, exact?: ExportBody['exact']) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const report = analyzeMesh(geo, 1e-4);
    out.bodies.push({ id, name, color, mesh, watertight: report.watertight, ...(exact ? { exact } : {}) });
    out.triangles += mesh.indices.length / 3;
    out.bounds.union(meshDataBounds(mesh));
  };

  const visit = (id: ObjectId) => {
    const o = doc.objects[id];
    if (!o || !o.visible) return;
    if (o.kind === 'shape') {
      if (o.isHole) {
        out.skippedHoles++;
        return;
      }
      const geo = buildGeometryForShape(o);
      if (!geo) {
        out.failed.push({ name: o.name, reason: 'Still loading (font or engine)' });
        return;
      }
      const matrix = worldMatrix(doc, id);
      const conv = solidConversion(o);
      const req = conv.ok ? solidRequest({ feature: conv.recipe, size: o.size }) : null;
      add(
        id,
        o.name,
        o.color,
        geometryToMeshData(geo, matrix),
        req ? { req, size: [...o.size] as Vec3, ...(o.mirror ? { mirror: o.mirror } : {}), matrix: matrix.toArray() } : undefined,
      );
      geo.dispose();
      return;
    }
    if (o.combine) {
      const r = computeCombined(doc, id);
      if (!r || r.stale) {
        out.failed.push({ name: o.name, reason: 'Still computing' });
        return;
      }
      if (!r.mesh) {
        out.failed.push({ name: o.name, reason: r.error ?? 'Empty result' });
        return;
      }
      if (r.isHole) {
        out.skippedHoles++;
        return;
      }
      const m = worldMatrix(doc, id);
      const positions = new Float32Array(r.mesh.positions.length);
      const v = new THREE.Vector3();
      for (let i = 0; i < positions.length; i += 3) {
        v.set(r.mesh.positions[i], r.mesh.positions[i + 1], r.mesh.positions[i + 2]).applyMatrix4(m);
        positions[i] = v.x;
        positions[i + 1] = v.y;
        positions[i + 2] = v.z;
      }
      // An exact combination is written to STEP exactly, placed at the centre of its box.
      let exact: ExportBody['exact'];
      const x = r.exact ? exactCombineRequest(doc, id) : null;
      if (x && 'req' in x) {
        const c = r.bounds.getCenter(new THREE.Vector3());
        const size = r.bounds.getSize(new THREE.Vector3()).toArray() as Vec3;
        exact = {
          req: x.req,
          size,
          matrix: m
            .clone()
            .multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z))
            .toArray(),
        };
      }
      add(id, o.name, r.color, { positions, indices: r.mesh.indices }, exact);
      return;
    }
    o.children.forEach(visit);
  };

  (ids ?? doc.rootIds).forEach(visit);
  return out;
}
