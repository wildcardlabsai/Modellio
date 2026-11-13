import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Maximize } from 'lucide-react';
import { meshDataToGeometry, type MeshData } from '@/cad/kernel/meshData';
import { IconButton } from '@/components/ui/IconButton';

export interface PreviewPart {
  id: string;
  colour: string;
  mesh: MeshData;
  /** Offset for laying parts out side by side. */
  offset?: [number, number, number];
}

/** A small orbitable 3D view of a maker's parts, fitted to them whenever they change size. */
export function MakerPreview({
  parts,
  contentKey,
  label,
  testId,
  compact = false,
}: {
  parts: PreviewPart[];
  contentKey: string;
  label: string;
  testId?: string;
  compact?: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const fit = useRef<() => void>(() => {});
  return (
    <div className="relative h-full w-full" data-testid={testId} role="region" aria-label={label}>
      <Canvas
        camera={{ position: [80, -120, 110], fov: 35, near: 0.5, far: 10000, up: [0, 0, 1] }}
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => gl.setClearColor('#f5f7fb')}
      >
        <hemisphereLight args={['#ffffff', '#b9c2d0', 1.5]} />
        <directionalLight position={[120, -160, 260]} intensity={1.7} />
        <directionalLight position={[-160, 120, 80]} intensity={0.5} />
        <gridHelper args={[400, 40, '#c9d1de', '#e3e8f0']} rotation={[Math.PI / 2, 0, 0]} />
        <group ref={group}>
          {parts.map((p) => (
            <PartMesh key={`${p.id}-${p.mesh.indices.length}-${p.mesh.positions.length}`} part={p} />
          ))}
        </group>
        <FitControls target={group} fitRef={fit} contentKey={contentKey} />
      </Canvas>
      {!compact && (
        <div className="absolute right-3 top-3 rounded-xl bg-white/95 p-1 shadow-panel">
          <IconButton label="Fit in view" tooltipSide="left" onClick={() => fit.current()}>
            <Maximize size={17} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

function PartMesh({ part }: { part: PreviewPart }) {
  const geometry = useMemo(() => meshDataToGeometry(part.mesh, (35 * Math.PI) / 180), [part.mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} name={part.id} position={part.offset ?? [0, 0, 0]}>
      <meshStandardMaterial color={part.colour} roughness={0.5} metalness={0.02} side={THREE.DoubleSide} />
    </mesh>
  );
}

function FitControls({
  target,
  fitRef,
  contentKey,
}: {
  target: React.RefObject<THREE.Group | null>;
  fitRef: React.MutableRefObject<() => void>;
  contentKey: string;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useEffect(() => {
    fitRef.current = () => {
      const c = controls.current;
      const g = target.current;
      if (!c || !g) return;
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const dist = (Math.max(sphere.radius, 1) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.1;
      c.target.copy(sphere.center);
      camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(0.3, -0.75, 0.9).normalize(), dist);
      camera.near = Math.max(0.05, dist / 1000);
      camera.far = dist * 50;
      camera.updateProjectionMatrix();
      c.update();
    };
    const id = requestAnimationFrame(() => fitRef.current());
    return () => cancelAnimationFrame(id);
  }, [contentKey, camera, target, fitRef]);
  return <OrbitControls ref={controls} makeDefault enableDamping={false} />;
}

export function downloadBytes(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const slugify = (name: string) =>
  name
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'design';
