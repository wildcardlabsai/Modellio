import type { MeshData } from './kernel/meshData';
import { createId } from '@/utils/id';

/**
 * Immutable mesh asset store (Boolean bakes, separated parts; imported STL/OBJ
 * in Phase 4). Documents reference assets by id, so undo snapshots never copy
 * geometry. Assets are never mutated; unused ones can be garbage-collected
 * when a project is saved (Phase 4).
 */
const assets = new Map<string, MeshData>();

export function addMeshAsset(mesh: MeshData, id = createId('mesh')): string {
  assets.set(id, mesh);
  return id;
}

export function getMeshAsset(id: string): MeshData | undefined {
  return assets.get(id);
}

export function allMeshAssets(): ReadonlyMap<string, MeshData> {
  return assets;
}
