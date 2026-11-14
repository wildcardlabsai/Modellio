import * as THREE from 'three';
import type { ModelDocument, Vec3 } from '@/types/document';
import { centerMeshData, type MeshData } from './kernel/meshData';
import { addObjectDraft, createEmptyDocument, createShape, uniqueName } from './document';
import { groupDraft } from './hierarchy';
import { createId } from '@/utils/id';
import { roundTo } from '@/utils/math';

/**
 * A document holding meshes as ordinary mesh objects (as the Design Studio's import does),
 * centred on the plate and resting on it, grouped when there is more than one. Pure: the
 * meshes are returned as project assets rather than registered in the live asset store.
 */
export function buildMeshDocument(
  parts: { name: string; mesh: MeshData; color?: string }[],
  groupName = 'Design',
): { document: ModelDocument; assets: Record<string, MeshData> } {
  const document = createEmptyDocument();
  const assets: Record<string, MeshData> = {};
  if (!parts.length) return { document, assets };
  const all = new THREE.Box3();
  const centred = parts.map((p) => {
    const c = centerMeshData(p.mesh);
    all.expandByPoint(c.center.clone().sub(c.size.clone().multiplyScalar(0.5)));
    all.expandByPoint(c.center.clone().add(c.size.clone().multiplyScalar(0.5)));
    return { ...c, name: p.name, color: p.color };
  });
  const middle = all.getCenter(new THREE.Vector3());
  const shift = new THREE.Vector3(-middle.x, -middle.y, -all.min.z);
  const ids: string[] = [];
  for (const c of centred) {
    const meshId = createId('mesh');
    assets[meshId] = c.mesh;
    const shape = {
      ...createShape(document, 'box', [0, 0, 0]),
      name: uniqueName(document, c.name.slice(0, 40) || 'Part'),
      shape: 'mesh' as const,
      meshId,
      params: {},
      size: [roundTo(c.size.x), roundTo(c.size.y), roundTo(c.size.z)] as Vec3,
      color: c.color ?? '#64748B',
      transform: {
        position: [roundTo(c.center.x + shift.x), roundTo(c.center.y + shift.y), roundTo(c.center.z + shift.z)] as Vec3,
        rotation: [0, 0, 0] as Vec3,
      },
    };
    addObjectDraft(document, shape);
    ids.push(shape.id);
  }
  if (ids.length > 1) groupDraft(document, ids, { id: createId('grp'), name: groupName });
  return { document, assets };
}
