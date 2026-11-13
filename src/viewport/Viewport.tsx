import { Suspense, useState, type DragEvent } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditor } from '@/store/editorStore';
import type { PrimitiveType } from '@/types/document';
import { Workplane } from './Workplane';
import { SceneNode } from './SceneNode';
import { isEffectivelyVisible, topLevel } from '@/cad/hierarchy';
import { SelectionOverlay } from './SelectionOverlay';
import { TransformGizmo } from './TransformGizmo';
import { CameraController } from './CameraController';
import { ViewCube } from './ViewCube';
import { VIEW_DIRECTIONS, gizmoRecentlyUsed, screenToWorkplane } from './viewportBridge';
import { snapTo } from '@/utils/math';
import { ViewportOverlay } from './ViewportOverlay';
import { MeasureTool } from './MeasureTool';
import { handleFiles } from '@/components/files/fileIntake';

export const SHAPE_DRAG_MIME = 'application/x-modellio-shape';

function SceneObjects() {
  const doc = useEditor((s) => s.doc);
  const rootIds = useEditor((s) => s.doc.rootIds);
  const selection = useEditor((s) => s.selection);
  const items = topLevel(doc, selection).filter((id) => isEffectivelyVisible(doc, id));

  return (
    <>
      {rootIds.map((id) => (
        <SceneNode key={id} id={id} />
      ))}
      {items.map((id) => (
        <SelectionOverlay key={id} doc={doc} id={id} showDimensions={items.length === 1} />
      ))}
    </>
  );
}

function Lights() {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#c7d2e6', 1.4]} position={[0, 0, 1]} />
      <directionalLight
        position={[120, -160, 260]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-200}
        shadow-camera-right={200}
        shadow-camera-top={200}
        shadow-camera-bottom={-200}
        shadow-camera-near={10}
        shadow-camera-far={900}
        shadow-bias={-0.0004}
        shadow-normalBias={0.4}
      />
      <directionalLight position={[-200, 140, 120]} intensity={0.55} />
      <directionalLight position={[0, 200, -80]} intensity={0.25} />
    </>
  );
}

/** The central 3D modelling workspace. */
export function Viewport() {
  const workplane = useEditor((s) => s.doc.settings.workplane);
  const showGrid = useEditor((s) => s.showGrid);
  const [dragOver, setDragOver] = useState(false);
  const home = VIEW_DIRECTIONS.home.clone().multiplyScalar(240);

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(SHAPE_DRAG_MIME) && !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const onDrop = (e: DragEvent) => {
    setDragOver(false);
    if (e.dataTransfer.files.length) {
      // STL / OBJ / .modellio files dropped from the desktop.
      e.preventDefault();
      const hit = screenToWorkplane(e.clientX, e.clientY);
      void handleFiles([...e.dataTransfer.files], hit ? [hit.x, hit.y] : undefined);
      return;
    }
    const type = e.dataTransfer.getData(SHAPE_DRAG_MIME) as PrimitiveType;
    if (!type) return;
    e.preventDefault();
    const hit = screenToWorkplane(e.clientX, e.clientY);
    const { snap, addShape, addText } = useEditor.getState();
    if (type.startsWith('text:')) {
      const step = snap.enabled ? snap.translate : 0;
      void addText(type.slice(5) || 'Text', hit ? [snapTo(hit.x, step), snapTo(hit.y, step)] : undefined);
      return;
    }
    if (!hit) {
      addShape(type);
      return;
    }
    const step = snap.enabled ? snap.translate : 0;
    addShape(type, [snapTo(hit.x, step), snapTo(hit.y, step)], { exact: true });
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-canvas"
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="viewport"
    >
      <Canvas
        shadows="percentage"
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping }}
        camera={{ position: [home.x, home.y, home.z], fov: 40, near: 0.5, far: 20000, up: [0, 0, 1] }}
        onPointerMissed={(e) => {
          if (e.type !== 'click' || gizmoRecentlyUsed() || useEditor.getState().tool === 'measure') return;
          if (!(e.shiftKey || e.ctrlKey || e.metaKey)) useEditor.getState().clearSelection();
        }}
      >
        <color attach="background" args={['#f5f7fb']} />
        <fog attach="fog" args={['#f5f7fb', 1200, 4000]} />
        <Lights />
        <Workplane size={workplane} showGrid={showGrid} />
        <Suspense fallback={null}>
          <SceneObjects />
        </Suspense>
        <TransformGizmo />
        <CameraController />
        <ViewCube />
        <MeasureTool />
      </Canvas>
      <ViewportOverlay />
      {dragOver && (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand/60 bg-brand/5">
          <span className="rounded-lg bg-white/90 px-3 py-1.5 text-[13px] font-medium text-brand shadow-panel">Drop to add · STL, OBJ or .modellio files</span>
        </div>
      )}
    </div>
  );
}
