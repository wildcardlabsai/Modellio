import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { geometryToMeshData, meshDataBounds, type MeshData } from '../kernel/meshData';
import { analyzeMesh } from '../geometry/validate';

export type ImportUnit = 'mm' | 'cm' | 'm' | 'in';
export const UNIT_SCALE: Record<ImportUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

export interface ImportedPart {
  name: string;
  /** Raw mesh in file units and file axes. */
  mesh: MeshData;
}

export interface ParsedFile {
  fileName: string;
  format: 'stl' | 'obj';
  parts: ImportedPart[];
  triangles: number;
  /** Raw extents (file units). */
  size: THREE.Vector3;
  /** Best guess at units, from the model's raw size. */
  suggestedUnit: ImportUnit;
  /** Most OBJ files come from Y-up tools; STL is usually Z-up. */
  suggestedUp: 'z' | 'y';
}

export class ImportError extends Error {}

export const SUPPORTED_IMPORT = ['.stl', '.obj'];

/** Parse an STL (binary or ASCII) or OBJ file into welded triangle meshes. */
export function parseMeshFile(fileName: string, data: ArrayBuffer): ParsedFile {
  const ext = fileName.toLowerCase().split('.').pop();
  let parts: ImportedPart[] = [];
  const base = fileName.replace(/\.[^.]+$/, '') || 'Imported';
  try {
    if (ext === 'stl') {
      const geo = new STLLoader().parse(data);
      parts = [{ name: base, mesh: geometryToMeshData(geo) }];
      geo.dispose();
    } else if (ext === 'obj') {
      const text = new TextDecoder().decode(data);
      const root = new OBJLoader().parse(text);
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const md = geometryToMeshData(mesh.geometry, mesh.matrixWorld);
        if (md.indices.length) parts.push({ name: mesh.name || `${base} ${parts.length + 1}`, mesh: md });
        mesh.geometry.dispose();
      });
    } else {
      throw new ImportError(`“.${ext}” files are not supported. Use STL or OBJ.`);
    }
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(`Could not read ${fileName}: ${e instanceof Error ? e.message : String(e)}`);
  }
  parts = parts.filter((p) => p.mesh.indices.length >= 3);
  if (!parts.length) throw new ImportError(`${fileName} contains no triangles.`);
  for (const p of parts) {
    for (const v of p.mesh.positions)
      if (!Number.isFinite(v)) throw new ImportError(`${fileName} contains invalid (non-finite) coordinates.`);
  }

  const bounds = new THREE.Box3();
  parts.forEach((p) => bounds.union(meshDataBounds(p.mesh)));
  const size = bounds.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  return {
    fileName,
    format: ext as 'stl' | 'obj',
    parts,
    triangles: parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0),
    size,
    // Models under ~1 unit across are almost always authored in metres.
    suggestedUnit: maxDim > 0 && maxDim < 1 ? 'm' : 'mm',
    suggestedUp: ext === 'obj' ? 'y' : 'z',
  };
}

/** Scale to millimetres and convert to MODELLIO's Z-up axes. Returns a new mesh. */
export function normalizeMesh(mesh: MeshData, unit: ImportUnit, up: 'z' | 'y'): MeshData {
  const s = UNIT_SCALE[unit];
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = mesh.positions[i] * s,
      y = mesh.positions[i + 1] * s,
      z = mesh.positions[i + 2] * s;
    if (up === 'z') {
      positions[i] = x;
      positions[i + 1] = y;
      positions[i + 2] = z;
    } else {
      // Y-up → Z-up: a proper rotation of +90° about X, so winding is preserved.
      positions[i] = x;
      positions[i + 1] = -z;
      positions[i + 2] = y;
    }
  }
  return { positions, indices: mesh.indices };
}

export function isWatertight(mesh: MeshData): boolean {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return analyzeMesh(g).watertight;
}
