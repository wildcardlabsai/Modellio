import * as THREE from 'three';
import type { ExportBody } from './collect';

/**
 * Binary glTF (GLB) for viewers, game engines and AR. glTF is Y-up in metres, so millimetres
 * Z-up are converted: (x, y, z) mm → (x, z, −y) / 1000 m. Each body is a named mesh with its
 * colour as a PBR material.
 */
export async function writeGlb(bodies: ExportBody[], title = 'MODELLIO design'): Promise<ArrayBuffer> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const scene = new THREE.Scene();
  scene.name = title;
  const disposables: { dispose(): void }[] = [];
  for (const b of bodies) {
    const src = b.mesh.positions;
    const pos = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      pos[i] = src[i] / 1000;
      pos[i + 1] = src[i + 2] / 1000;
      pos[i + 2] = -src[i + 1] / 1000;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(b.mesh.indices, 1));
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.5, metalness: 0 });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = b.name;
    scene.add(mesh);
    disposables.push(g, m);
  }
  try {
    const out = await new GLTFExporter().parseAsync(scene, { binary: true });
    if (!(out instanceof ArrayBuffer)) throw new Error('The GLB exporter returned JSON instead of binary.');
    return out;
  } finally {
    disposables.forEach((d) => d.dispose());
  }
}
