import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { usePrintCheck } from '@/components/print/printCheck';

/** Highlights overhang (red) and thin-wall (amber) triangles from the last print check. */
export function PrintOverlay() {
  const { report, bodies, highlight } = usePrintCheck();
  const geometry = useMemo(() => {
    if (!report || !highlight) return null;
    const positions: number[] = [];
    const colors: number[] = [];
    const red = new THREE.Color('#EF4444');
    const amber = new THREE.Color('#F59E0B');
    report.bodies.forEach((r, i) => {
      const mesh = bodies[i]?.mesh;
      if (!mesh) return;
      const add = (t: number, c: THREE.Color) => {
        for (let k = 0; k < 3; k++) {
          const v = mesh.indices[t * 3 + k] * 3;
          positions.push(mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]);
          colors.push(c.r, c.g, c.b);
        }
      };
      r.overhangTris.forEach((t) => add(t, red));
      r.thinTris.forEach((t) => add(t, amber));
    });
    if (!positions.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }, [report, bodies, highlight]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} renderOrder={5} userData={{ noThumbnail: true }} name="print-highlights">
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.7}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
        depthWrite={false}
      />
    </mesh>
  );
}
