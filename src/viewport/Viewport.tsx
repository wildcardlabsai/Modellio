import { Suspense, useEffect, useState, type DragEvent } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditor } from '@/store/editorStore';
import type { PrimitiveType, Vec3 } from '@/types/document';
import { Workplane } from './Workplane';
import { SceneNode } from './SceneNode';
import { isEffectivelyVisible, topLevel, worldBoundsOf } from '@/cad/hierarchy';
import { SelectionOverlay } from './SelectionOverlay';
import { TransformGizmo } from './TransformGizmo';
import { CameraController } from './CameraController';
import { ViewCube } from './ViewCube';
import {
  VIEW_DIRECTIONS,
  gizmoRecentlyUsed,
  pickSurface,
  screenToWorkplane,
  viewport,
  worldToScreen,
  manipulatorAt,
} from './viewportBridge';
import { snapTo } from '@/utils/math';
import { ViewportOverlay } from './ViewportOverlay';
import { MeasureTool } from './MeasureTool';
import { LayFlatTool } from './LayFlatTool';
import { PrintOverlay } from './PrintOverlay';
import { CrashProbe, useDebug } from '@/utils/debug';
import { SnapGuides } from './guides';
import { LabelLayer, LabelProjector } from './labels';
import { ResizeHandles } from './ResizeHandles';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ViewportCrash } from '@/components/layout/CrashScreens';

/** Renders nothing in the scene; reports the crash to the DOM layer. */
function ReportCrash({ error, onCrash }: { error: Error; onCrash: (e: Error) => void }) {
  useEffect(() => onCrash(error), [error, onCrash]);
  return null;
}
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
  const [sceneError, setSceneError] = useState<Error | null>(null);
  const [sceneKey, setSceneKey] = useState(0);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  /**
   * Shift + drag on empty space draws a selection box (it would otherwise pan).
   * Shift + click on an object still toggles it.
   */
  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (e.button !== 0 || !e.shiftKey || useEditor.getState().tool !== 'select') return;
    if (manipulatorAt(e.clientX, e.clientY) || pickSurface(e.clientX, e.clientY)?.objectName) return;
    e.stopPropagation();
    e.preventDefault();
    const host = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const start = { x0: e.clientX - host.left, y0: e.clientY - host.top };
    let rect = { ...start, x1: start.x0, y1: start.y0 };
    setMarquee(rect);
    const onMove = (ev: PointerEvent) => {
      rect = { ...start, x1: ev.clientX - host.left, y1: ev.clientY - host.top };
      setMarquee(rect);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setMarquee(null);
      if (Math.abs(rect.x1 - rect.x0) < 4 && Math.abs(rect.y1 - rect.y0) < 4) return;
      const [xa, xb] = [Math.min(rect.x0, rect.x1) + host.left, Math.max(rect.x0, rect.x1) + host.left];
      const [ya, yb] = [Math.min(rect.y0, rect.y1) + host.top, Math.max(rect.y0, rect.y1) + host.top];
      const { doc, select } = useEditor.getState();
      // An object is boxed when the centre of its bounds is inside the rectangle.
      const hits = doc.rootIds.filter((id) => {
        if (!doc.objects[id]?.visible) return false;
        const c = worldBoundsOf(doc, [id]).getCenter(new THREE.Vector3());
        const p = worldToScreen(c.x, c.y, c.z);
        return !!p && p.x >= xa && p.x <= xb && p.y >= ya && p.y <= yb;
      });
      if (hits.length) select(hits, { additive: true });
      viewport.lastGizmoRelease = performance.now(); // swallow the click that ends the drag
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
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
    // Dropped onto another object: stand the new shape on that face.
    const surface = pickSurface(e.clientX, e.clientY);
    if (surface?.objectName) {
      addShape(type, undefined, { surface: { point: surface.point.toArray() as Vec3, normal: surface.normal.toArray() as Vec3 } });
      return;
    }
    addShape(type, [snapTo(hit.x, step), snapTo(hit.y, step)], { exact: true });
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-canvas"
      onPointerDownCapture={onPointerDownCapture}
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
          if (e.type !== 'click' || gizmoRecentlyUsed() || useEditor.getState().tool !== 'select') return;
          if (!(e.shiftKey || e.ctrlKey || e.metaKey)) useEditor.getState().clearSelection();
        }}
      >
        <color attach="background" args={['#f5f7fb']} />
        <fog attach="fog" args={['#f5f7fb', 1200, 4000]} />
        <Lights />
        <CameraController />
        <LabelProjector />
        {/*
          Scene crashes are caught INSIDE the canvas, so the WebGL context and the
          canvas element survive; a DOM panel is shown over it until "Restart".
        */}
        <ErrorBoundary key={sceneKey} fallback={(error) => <ReportCrash error={error} onCrash={setSceneError} />}>
          <Workplane size={workplane} showGrid={showGrid} />
          <Suspense fallback={null}>
            <SceneObjects />
          </Suspense>
          <TransformGizmo />
          <ResizeHandles />
          <ViewCube />
          <MeasureTool />
          <LayFlatTool />
          <PrintOverlay />
          <SnapGuides />
          <CrashProbe />
        </ErrorBoundary>
      </Canvas>
      <LabelLayer />
      <ViewportOverlay />
      {marquee && (
        <div
          data-testid="marquee"
          className="pointer-events-none absolute border border-brand bg-brand/10"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}
      {sceneError && (
        <div className="absolute inset-0 z-10">
          <ViewportCrash
            error={sceneError}
            reset={() => {
              useDebug.setState({ crashViewport: false });
              setSceneError(null);
              setSceneKey((k) => k + 1);
            }}
          />
        </div>
      )}
      {dragOver && (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand/60 bg-brand/5">
          <span className="rounded-lg bg-white/90 px-3 py-1.5 text-[13px] font-medium text-brand shadow-panel">
            Drop to add · STL, OBJ or .modellio files
          </span>
        </div>
      )}
    </div>
  );
}
