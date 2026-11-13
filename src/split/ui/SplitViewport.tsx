import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Maximize } from 'lucide-react';
import { currentLayout, currentParts, useSplit } from '../store';
import type { ThreeMFDocument } from '../model/types';
import type { SplitPart } from '../geometry/types';
import { plateOffset } from '../geometry/layout';
import { buildPreviewGeometry, geometryFromPreview } from './previewGeometry';
import { buildPreviewBuffers } from '../model/preview';
import { IconButton } from '@/components/ui/IconButton';

/** Bridge for the "fit view" button and automated tests. */
export const splitView = { fit: () => {}, ready: false };

/**
 * Split Studio viewport. Import: the original model with resolved colours. Split / Connect:
 * the parts, with the explode slider (display only). Export: the parts on their plates.
 */
export function SplitViewport() {
  const doc = useSplit((s) => s.doc);
  const step = useSplit((s) => s.step);
  const split = useSplit((s) => s.split);
  const connected = useSplit((s) => s.connected);
  const plateSettings = useSplit((s) => s.plateSettings);
  const parts = useMemo(() => currentParts({ split, connected }), [split, connected]);
  const mode: 'doc' | 'parts' | 'plates' = step === 'import' || !split ? 'doc' : step === 'export' ? 'plates' : 'parts';
  const contentKey = `${mode}|${doc?.fileName}|${split?.key}|${connected?.key ?? ''}|${mode === 'plates' ? JSON.stringify(plateSettings) : ''}`;
  return (
    <div
      className="relative h-full w-full"
      data-testid="split-viewport"
      data-mode={mode}
      role="region"
      aria-label="3D preview of the model"
    >
      <Canvas
        camera={{ position: [120, -160, 120], fov: 40, near: 0.5, far: 20000, up: [0, 0, 1] }}
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => gl.setClearColor('#f5f7fb')}
      >
        <hemisphereLight args={['#ffffff', '#b9c2d0', 1.6]} />
        <directionalLight position={[80, -120, 200]} intensity={1.6} />
        <directionalLight position={[-120, 100, 60]} intensity={0.5} />
        {mode !== 'plates' && <gridHelper args={[400, 40, '#c9d1de', '#e3e8f0']} rotation={[Math.PI / 2, 0, 0]} />}
        <Content mode={mode} doc={doc} parts={parts} contentKey={contentKey} />
      </Canvas>
      {doc && (
        <div className="absolute right-3 top-3 rounded-xl bg-white/95 p-1 shadow-panel">
          <IconButton label="Fit model in view" tooltipSide="left" onClick={() => splitView.fit()} data-testid="split-fit">
            <Maximize size={17} />
          </IconButton>
        </div>
      )}
      {mode === 'parts' && <ExplodeSlider />}
    </div>
  );
}

function ExplodeSlider() {
  const explode = useSplit((s) => s.explode);
  const setExplode = useSplit((s) => s.setExplode);
  return (
    <div className="absolute bottom-4 left-1/2 flex w-[min(420px,80%)] -translate-x-1/2 items-center gap-3 rounded-xl bg-white/95 px-4 py-2.5 shadow-panel">
      <label htmlFor="split-explode" className="text-[12px] font-semibold text-[#344054]">
        Explode
      </label>
      <input
        id="split-explode"
        type="range"
        min={0}
        max={100}
        value={Math.round(explode * 100)}
        onChange={(e) => setExplode(Number(e.target.value) / 100)}
        className="flex-1 accent-[#2463eb]"
        data-testid="split-explode"
      />
      <span className="w-9 text-right text-[12px] tabular-nums text-muted">{Math.round(explode * 100)}%</span>
    </div>
  );
}

function Content({
  mode,
  doc,
  parts,
  contentKey,
}: {
  mode: 'doc' | 'parts' | 'plates';
  doc: ThreeMFDocument | null;
  parts: SplitPart[];
  contentKey: string;
}) {
  const group = useRef<THREE.Group>(null);
  return (
    <>
      <group ref={group}>
        {mode === 'doc' && doc && <DocumentMeshes doc={doc} />}
        {mode === 'parts' && <PartMeshes parts={parts} />}
        {mode === 'plates' && <PlateMeshes parts={parts} />}
      </group>
      <Controls target={group} contentKey={contentKey} hasContent={!!doc} />
    </>
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
  useEffect(() => {
    materials.forEach((mat, id) => {
      mat.visible = !hidden.includes(id);
      emphasise(mat, selected === null ? null : selected === id);
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

/** Selection emphasis shared by both views: the selection glows, everything else fades. */
function emphasise(mat: THREE.MeshStandardMaterial, state: boolean | null) {
  const dim = state === false;
  mat.transparent = dim;
  mat.opacity = dim ? 0.18 : 1;
  mat.depthWrite = !dim;
  mat.emissive.set(state ? '#1d55d4' : '#000000');
  mat.emissiveIntensity = state ? 0.18 : 0;
  mat.needsUpdate = true;
}

function usePartResources(parts: SplitPart[]) {
  const geometries = useMemo(
    () =>
      new Map(
        parts.map((p) => [
          p.partId,
          geometryFromPreview(
            p.preview ?? buildPreviewBuffers(p.mesh.positions, p.mesh.indices, new Uint32Array(p.mesh.indices.length / 3)),
          ),
        ]),
      ),
    [parts],
  );
  const materials = useMemo(
    () =>
      new Map(
        parts.map((p) => [
          p.partId,
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(p.colour),
            roughness: 0.6,
            metalness: 0.02,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
          }),
        ]),
      ),
    [parts],
  );
  useEffect(
    () => () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
    [geometries, materials],
  );
  const selected = useSplit((s) => s.selectedPart);
  useEffect(() => materials.forEach((m, id) => emphasise(m, selected === null ? null : selected === id)), [materials, selected]);
  return { geometries, materials };
}

function PartMeshes({ parts }: { parts: SplitPart[] }) {
  const { geometries, materials } = usePartResources(parts);
  const explode = useSplit((s) => s.explode);
  const hidden = useSplit((s) => s.hiddenParts);
  const selected = useSplit((s) => s.selectedPart);
  const selectPart = useSplit((s) => s.selectPart);
  // Explode directions: from the assembly centre to each part's centre.
  const offsets = useMemo(() => {
    const all = new THREE.Box3();
    const centres = parts.map((p) => {
      const b = new THREE.Box3(new THREE.Vector3(...p.report.bounds.min), new THREE.Vector3(...p.report.bounds.max));
      all.union(b);
      return b.getCenter(new THREE.Vector3());
    });
    const c = all.getCenter(new THREE.Vector3());
    const size = all.getSize(new THREE.Vector3()).length() || 1;
    return centres.map((pc) => {
      const d = pc.clone().sub(c);
      if (d.length() < size * 0.02) d.set(0, 0, -1);
      // Spread proportionally (keeps relative layout) plus a fixed push so nested parts separate too.
      return d
        .clone()
        .multiplyScalar(1.6)
        .add(d.normalize().multiplyScalar(size * 0.35));
    });
  }, [parts]);
  return (
    <group>
      {parts.map((p, i) =>
        hidden.includes(p.partId) ? null : (
          <mesh
            key={p.partId}
            name={p.partId}
            geometry={geometries.get(p.partId)}
            material={materials.get(p.partId)}
            position={offsets[i].clone().multiplyScalar(explode)}
            onClick={(e) => {
              if (e.delta > 4) return;
              e.stopPropagation();
              selectPart(selected === p.partId ? null : p.partId);
            }}
          />
        ),
      )}
    </group>
  );
}

function PlateMeshes({ parts }: { parts: SplitPart[] }) {
  const { geometries, materials } = usePartResources(parts);
  const split = useSplit((s) => s.split);
  const connected = useSplit((s) => s.connected);
  const plateSettings = useSplit((s) => s.plateSettings);
  const selected = useSplit((s) => s.selectedPart);
  const selectPart = useSplit((s) => s.selectPart);
  const layout = useMemo(() => currentLayout({ split, connected, plateSettings }), [split, connected, plateSettings]);
  const plateGeom = useMemo(
    () => new THREE.BoxGeometry(plateSettings.width, plateSettings.depth, 0.8),
    [plateSettings.width, plateSettings.depth],
  );
  useEffect(() => () => plateGeom.dispose(), [plateGeom]);
  return (
    <group>
      {layout.plates.map((plate) => {
        const o = plateOffset(plate.index, plateSettings);
        return (
          <mesh key={plate.index} geometry={plateGeom} position={[o[0] + plateSettings.width / 2, o[1] + plateSettings.depth / 2, -0.41]}>
            <meshStandardMaterial color="#e4e8ef" roughness={0.9} />
          </mesh>
        );
      })}
      {parts.map((p) => {
        const pl = layout.placements[p.partId];
        if (!pl) return null;
        const o = plateOffset(pl.plate, plateSettings);
        const m = new THREE.Matrix4().makeTranslation(o[0], o[1], o[2]).multiply(new THREE.Matrix4().fromArray(pl.transform));
        return (
          <mesh
            key={p.partId}
            name={p.partId}
            geometry={geometries.get(p.partId)}
            material={materials.get(p.partId)}
            matrixAutoUpdate={false}
            matrix={m}
            onClick={(e) => {
              if (e.delta > 4) return;
              e.stopPropagation();
              selectPart(selected === p.partId ? null : p.partId);
            }}
          />
        );
      })}
    </group>
  );
}

function Controls({
  target,
  contentKey,
  hasContent,
}: {
  target: React.RefObject<THREE.Group | null>;
  contentKey: string;
  hasContent: boolean;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    splitView.fit = () => {
      const c = controls.current;
      const g = target.current;
      if (!c || !g) return;
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
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
    // Wait a frame so new meshes are in the scene graph.
    const id = requestAnimationFrame(() => splitView.fit());
    splitView.ready = hasContent;
    return () => {
      cancelAnimationFrame(id);
      splitView.ready = false;
    };
  }, [contentKey, camera, invalidate, target, hasContent]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={false}
      mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
    />
  );
}
