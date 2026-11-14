import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSolidBuilder } from '@/components/features/solidBuilder';
import { geometryFromBuild } from '@/cad/shapeRegistry';
import { FastEdges } from './FastLine';
import { viewport } from './viewportBridge';

/** The loft / sweep being set up, drawn where it will appear (translucent violet). */
export function SolidPreview() {
  const preview = useSolidBuilder((s) => (s.session?.preview.state === 'ok' ? s.session.preview : null));
  const editingId = useSolidBuilder((s) => s.session?.editingId ?? null);
  const geometry = useMemo(
    () => (preview?.build ? geometryFromBuild(preview.build, { size: preview.build.size }) : null),
    [preview?.build],
  );
  useEffect(() => () => geometry?.dispose(), [geometry]);
  // Bring the preview into view once per opening of the panel (later edits leave the camera alone).
  const seq = useSolidBuilder((s) => s.session?.seq ?? 0);
  const framed = useRef(0);
  useEffect(() => {
    if (!preview?.build || !preview.position || framed.current === seq) return;
    framed.current = seq;
    // The panel covers the left of the view: frame a box that reaches as far again to the camera's
    // left, so the preview sits in the visible right-hand part.
    const half = new THREE.Vector3(...preview.build.size).multiplyScalar(0.6);
    const c = new THREE.Vector3(...preview.position);
    const box = new THREE.Box3(c.clone().sub(half), c.clone().add(half));
    if (viewport.camera) {
      const right = new THREE.Vector3().setFromMatrixColumn(viewport.camera.matrixWorld, 0).normalize();
      box.expandByPoint(c.clone().addScaledVector(right, -2.2 * Math.max(...preview.build.size)));
    }
    viewport.frame(box);
  }, [preview, seq]);
  if (!geometry || !preview?.position) return null;
  return (
    <group position={preview.position} userData={{ noThumbnail: true }}>
      <mesh geometry={geometry} renderOrder={3} data-testid="solid-preview" name={editingId ? 'solid-preview-edit' : 'solid-preview'}>
        <meshStandardMaterial color="#7C3AED" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <FastEdges geometry={geometry} color="#5B21B6" lineWidth={1.2} />
    </group>
  );
}
