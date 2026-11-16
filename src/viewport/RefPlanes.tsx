import { useMemo } from 'react';
import * as THREE from 'three';
import { useEditor } from '@/store/editorStore';
import { planeFrame } from '@/cad/placement';
import type { RefPlane } from '@/types/document';

/** A reference plane drawn as a translucent square (80 mm) with its outline, centred on its origin. */
function PlaneQuad({ plane }: { plane: RefPlane }) {
  const { matrix, outline } = useMemo(() => {
    const f = planeFrame(plane);
    const x = new THREE.Vector3(...f.x);
    const y = new THREE.Vector3(...f.y);
    const n = x.clone().cross(y);
    const m = new THREE.Matrix4().makeBasis(x, y, n).setPosition(...f.origin);
    const h = 40;
    const pts = [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
      [-h, -h],
    ].map(([a, b]) => new THREE.Vector3(a, b, 0));
    return { matrix: m, outline: new THREE.BufferGeometry().setFromPoints(pts) };
  }, [plane]);
  return (
    <group matrix={matrix} matrixAutoUpdate={false} name={`plane-${plane.id}`}>
      <mesh renderOrder={2}>
        <planeGeometry args={[80, 80]} />
        <meshBasicMaterial color="#F59E0B" transparent opacity={0.12} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <lineLoop geometry={outline}>
        <lineBasicMaterial color="#D97706" transparent opacity={0.8} />
      </lineLoop>
    </group>
  );
}

/** The design's visible reference planes. */
export function RefPlanes() {
  const planes = useEditor((s) => s.doc.planes);
  const list = useMemo(() => Object.values(planes ?? {}).filter((p) => p.visible), [planes]);
  return (
    <group userData={{ noThumbnail: true }}>
      {list.map((p) => (
        <PlaneQuad key={p.id} plane={p} />
      ))}
    </group>
  );
}
