import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Maximize } from 'lucide-react';
import { useSplit } from '../store';
import type { ThreeMFDocument } from '../model/types';
import { buildPreviewGeometry, placedBounds } from './previewGeometry';
import { IconButton } from '@/components/ui/IconButton';

/** Bridge for the "fit view" button and automated tests. */
export const splitView = { fit: () => {}, ready: false };

/**
 * Original-model preview: every instance rendered with its own transform and the resolved
 * colour of each triangle. Geometry is built once per mesh object and shared by instances.
 */
export function SplitViewport() {
  const doc = useSplit((s) => s.doc);
  return (
    <div className="relative h-full w-full" data-testid="split-viewport" role="region" aria-label="3D preview of the imported model">
      <Canvas
        camera={{ position: [120, -160, 120], fov: 40, near: 0.5, far: 20000, up: [0, 0, 1] }}
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => gl.setClearColor('#f5f7fb')}
      >
        <hemisphereLight args={['#ffffff', '#b9c2d0', 1.6]} />
        <directionalLight position={[80, -120, 200]} intensity={1.6} />
        <directionalLight position={[-120, 100, 60]} intensity={0.5} />
        <gridHelper args={[400, 40, '#c9d1de', '#e3e8f0']} rotation={[Math.PI / 2, 0, 0]} />
        {doc && <DocumentMeshes doc={doc} />}
        <Controls doc={doc} />
      </Canvas>
      {doc && (
        <div className="absolute right-3 top-3 rounded-xl bg-white/95 p-1 shadow-panel">
          <IconButton label="Fit model in view" tooltipSide="left" onClick={() => splitView.fit()} data-testid="split-fit">
            <Maximize size={17} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

function DocumentMeshes({ doc }: { doc: ThreeMFDocument }) {
  const hidden = useSplit((s) => s.hidden);
  const selected = useSplit((s) => s.selectedMaterial);
  const select = useSplit((s) => s.select);

  const geometries = useMemo(
    () => doc.objects.map((o) => (o.mesh && o.mesh.triangles.length ? buildPreviewGeometry(o.mesh) : null)),
    [doc],
  );
  const materials = useMemo(
    () =>
      doc.materials.map(
        (m) =>
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(m.colour),
            roughness: 0.62,
            metalness: 0.02,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
          }),
      ),
    [doc],
  );
  useEffect(
    () => () => {
      geometries.forEach((g) => g?.dispose());
      materials.forEach((m) => m.dispose());
    },
    [geometries, materials],
  );
  // Visibility and selection emphasis are material properties, so toggling is instant.
  useEffect(() => {
    materials.forEach((mat, id) => {
      mat.visible = !hidden.includes(id);
      const dim = selected !== null && selected !== id;
      mat.transparent = dim;
      mat.opacity = dim ? 0.18 : 1;
      mat.depthWrite = !dim;
      mat.emissive.set(selected === id ? '#1d55d4' : '#000000');
      mat.emissiveIntensity = selected === id ? 0.18 : 0;
      mat.needsUpdate = true;
    });
  }, [materials, hidden, selected]);

  return (
    <group>
      {doc.instances.map((inst) => {
        const geometry = geometries[inst.objectIndex];
        if (!geometry) return null;
        return (
          <mesh
            key={inst.instanceId}
            name={inst.instanceId}
            geometry={geometry}
            material={materials}
            matrixAutoUpdate={false}
            matrix={new THREE.Matrix4().fromArray(inst.transform)}
            onClick={(e) => {
              if (e.delta > 4) return;
              e.stopPropagation();
              const id = e.face?.materialIndex;
              if (id !== undefined && !hidden.includes(id)) select(id === selected ? null : id);
            }}
          />
        );
      })}
    </group>
  );
}

function Controls({ doc }: { doc: ThreeMFDocument | null }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    splitView.fit = () => {
      const c = controls.current;
      if (!c || !doc) return;
      const box = placedBounds(doc);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const dist = (Math.max(sphere.radius, 1) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 0.9;
      const dir = new THREE.Vector3(0.55, -0.75, 0.6).normalize();
      c.target.copy(sphere.center);
      camera.position.copy(sphere.center).addScaledVector(dir, dist);
      camera.near = Math.max(0.05, dist / 1000);
      camera.far = dist * 50;
      camera.updateProjectionMatrix();
      c.update();
      invalidate();
    };
    splitView.fit();
    splitView.ready = !!doc;
    return () => {
      splitView.ready = false;
    };
  }, [doc, camera, invalidate]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={false}
      mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
    />
  );
}
