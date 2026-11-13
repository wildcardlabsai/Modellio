import * as THREE from 'three';
import { LIBRARY_SHAPES, buildShapeGeometry } from '@/cad/shapeRegistry';
import type { ParametricType } from '@/cad/geometry/primitives';
import type { PrimitiveType } from '@/types/document';

let cache: Partial<Record<PrimitiveType, string>> | null = null;

/**
 * Render a preview of every primitive from its real CAD geometry, using one
 * temporary WebGL context that is released afterwards. Returns data URLs.
 */
export function renderShapeThumbnails(px = 128): Partial<Record<PrimitiveType, string>> {
  if (cache) return cache;
  const out: Partial<Record<PrimitiveType, string>> = {};
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(px, px, false);
    renderer.toneMapping = THREE.NeutralToneMapping;

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#9aa8c0', 1.6));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(2, -3, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight('#ffffff', 0.6);
    fill.position.set(-4, 2, 1);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(30, 1, 1, 1000);
    camera.up.set(0, 0, 1);

    for (const def of LIBRARY_SHAPES) {
      const geometry = buildShapeGeometry(def.type as ParametricType, def.defaultSize, def.defaultParams);
      const material = new THREE.MeshStandardMaterial({ color: def.defaultColor, roughness: 0.35, metalness: 0.05 });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      const radius = new THREE.Vector3(...def.defaultSize).length() / 2;
      const dist = (radius / Math.sin(THREE.MathUtils.degToRad(15))) * 1.02;
      camera.position.set(1, -1.3, 0.9).normalize().multiplyScalar(dist);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      out[def.type] = canvas.toDataURL('image/png');
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    }
  } catch (err) {
    console.warn('[modellio] Shape thumbnails unavailable:', err);
  } finally {
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
  cache = out;
  return out;
}
