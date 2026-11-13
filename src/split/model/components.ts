import { applyToPoint, uniformScale } from './mat4';
import type { ColourComponent, ThreeMFDocument, ThreeMFMesh } from './types';

/** Area of each triangle of a mesh in object space (mm²). */
export function triangleAreas(mesh: ThreeMFMesh, transform?: number[]): Float64Array {
  const { vertices: v, triangles: t } = mesh;
  const n = t.length / 3;
  const out = new Float64Array(n);
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const ia = t[i * 3] * 3;
    const ib = t[i * 3 + 1] * 3;
    const ic = t[i * 3 + 2] * 3;
    if (transform) {
      applyToPoint(transform, v[ia], v[ia + 1], v[ia + 2], a);
      applyToPoint(transform, v[ib], v[ib + 1], v[ib + 2], b);
      applyToPoint(transform, v[ic], v[ic + 1], v[ic + 2], c);
    } else {
      a[0] = v[ia];
      a[1] = v[ia + 1];
      a[2] = v[ia + 2];
      b[0] = v[ib];
      b[1] = v[ib + 1];
      b[2] = v[ib + 2];
      c[0] = v[ic];
      c[1] = v[ic + 1];
      c[2] = v[ic + 2];
    }
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const wx = c[0] - a[0];
    const wy = c[1] - a[1];
    const wz = c[2] - a[2];
    out[i] = 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
  }
  return out;
}

/**
 * Group every placed triangle by resolved material. The mapping is stable: component order
 * follows material IDs (order of first appearance in the file), and each component lists the
 * instances and objects it came from, so later phases can trace any region back to its source.
 */
export function computeColourComponents(doc: ThreeMFDocument): ColourComponent[] {
  const acc = new Map<number, { triangles: number; area: number; instances: Set<string>; objects: Set<number> }>();
  const objectAreas = new Map<number, Float64Array>();
  for (const inst of doc.instances) {
    const obj = doc.objects[inst.objectIndex];
    const mesh = obj.mesh;
    if (!mesh) continue;
    const s = uniformScale(inst.transform);
    let areas: Float64Array;
    let factor = 1;
    if (s !== null) {
      let base = objectAreas.get(inst.objectIndex);
      if (!base) objectAreas.set(inst.objectIndex, (base = triangleAreas(mesh)));
      areas = base;
      factor = s * s;
    } else areas = triangleAreas(mesh, inst.transform);
    const ids = mesh.perTriangleMaterialIds;
    for (let t = 0; t < ids.length; t++) {
      let e = acc.get(ids[t]);
      if (!e) acc.set(ids[t], (e = { triangles: 0, area: 0, instances: new Set(), objects: new Set() }));
      e.triangles++;
      e.area += areas[t] * factor;
      e.instances.add(inst.instanceId);
      e.objects.add(obj.objectId);
    }
  }
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([materialId, e]) => {
      const m = doc.materials[materialId];
      return {
        materialId,
        key: m.key,
        name: m.name,
        colour: m.colour,
        materialType: m.materialType,
        approximate: m.approximate,
        triangleCount: e.triangles,
        area: e.area,
        instanceIds: [...e.instances],
        objectIds: [...e.objects],
      };
    });
}
