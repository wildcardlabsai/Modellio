import type { MeshData } from '@/cad/kernel/meshData';
import type { ThreeMFDocument } from '@/split/model/types';
import { applyToPoint, determinant3 } from '@/split/model/mat4';

export interface ColouredPart {
  name: string;
  mesh: MeshData;
  /** The part's main colour (the material on most of its triangles), if the file has one. */
  color?: string;
}

/**
 * The placed objects of a 3MF as separate meshes in world millimetres (one per build
 * instance), each with its main colour. Mirrored placements get their winding fixed.
 */
export function threeMfParts(doc: ThreeMFDocument): ColouredPart[] {
  const out: ColouredPart[] = [];
  const p = [0, 0, 0];
  for (const inst of doc.instances) {
    const obj = doc.objects[inst.objectIndex];
    const m = obj?.mesh;
    if (!m || !m.triangles.length) continue;
    const t = inst.transform;
    const positions = new Float32Array(m.vertices.length);
    for (let i = 0; i < m.vertices.length; i += 3) {
      applyToPoint(t, m.vertices[i], m.vertices[i + 1], m.vertices[i + 2], p);
      positions[i] = p[0];
      positions[i + 1] = p[1];
      positions[i + 2] = p[2];
    }
    const indices = new Uint32Array(m.triangles);
    if (determinant3(t) < 0)
      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i + 1];
        indices[i + 1] = indices[i + 2];
        indices[i + 2] = a;
      }
    // Main colour by triangle count.
    const counts = new Map<number, number>();
    for (const id of m.perTriangleMaterialIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    let best = -1;
    let bestN = 0;
    for (const [id, c] of counts) if (c > bestN && doc.materials[id]) [best, bestN] = [id, c];
    out.push({
      name: inst.name || obj.name || `Part ${out.length + 1}`,
      mesh: { positions, indices },
      color: best >= 0 ? doc.materials[best].colour : undefined,
    });
  }
  return out;
}
