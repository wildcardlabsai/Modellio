import * as THREE from 'three';
import { geometryToMeshData } from '../kernel/meshData';
import type { ImportedPart, ParsedFile } from './importMesh';

/**
 * glTF (.gltf with embedded data, or .glb) → meshes in file units and axes (glTF is metres,
 * Y-up; the import dialog suggests both). Node transforms are applied; material base
 * colours are kept.
 */
export async function parseGltf(fileName: string, data: ArrayBuffer): Promise<ParsedFile> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const base = fileName.replace(/\.[^.]+$/, '') || 'Imported';
  let gltf: { scene: THREE.Object3D };
  try {
    gltf = await new GLTFLoader().parseAsync(data, '');
  } catch (e) {
    const err = new Error(
      `“${fileName}” could not be read as glTF${/\.gltf$/i.test(fileName) ? ' (a .gltf whose data is in separate files cannot be opened; export it as .glb)' : ''}: ${e instanceof Error ? e.message : e}`,
    );
    err.name = 'ImportError';
    throw err;
  }
  gltf.scene.updateMatrixWorld(true);
  const parts: ImportedPart[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const md = geometryToMeshData(mesh.geometry, mesh.matrixWorld);
    if (!md.indices.length) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
    parts.push({
      name: mesh.name || `${base} ${parts.length + 1}`,
      mesh: md,
      color: mat?.color ? `#${mat.color.getHexString()}` : undefined,
    });
  });
  if (!parts.length) {
    const err = new Error(`“${fileName}” has no meshes to import.`);
    err.name = 'ImportError';
    throw err;
  }
  const box = new THREE.Box3();
  for (const p of parts)
    for (let i = 0; i < p.mesh.positions.length; i += 3)
      box.expandByPoint(new THREE.Vector3(p.mesh.positions[i], p.mesh.positions[i + 1], p.mesh.positions[i + 2]));
  const size = box.getSize(new THREE.Vector3());
  return {
    fileName,
    format: 'gltf',
    parts,
    triangles: parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0),
    size,
    // glTF is defined in metres with Y up; tiny models were probably authored in millimetres.
    suggestedUnit: Math.max(size.x, size.y, size.z) > 20 ? 'mm' : 'm',
    suggestedUp: 'y',
  };
}
