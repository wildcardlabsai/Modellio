import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { FastLine } from './FastLine';
import { usePublishLabels, type Label } from './labels';
import { useEditor } from '@/store/editorStore';
import type { Vec3 } from '@/types/document';
import { roundTo } from '@/utils/math';
import { formatLength } from '@/utils/units';

const SNAP_PX = 10;

/**
 * Measure tool (M): click two points on any surface or on the workplane to
 * read the distance and its X/Y/Z components. Points snap to a nearby mesh
 * vertex (within 10 px) for exact edge-to-edge measurements, and to the snap
 * grid on the bare workplane. A marker shows where the next click will land
 * (green when snapped).
 */
export function MeasureTool() {
  const tool = useEditor((s) => s.tool);
  const points = useEditor((s) => s.measurePoints);
  const units = useEditor((s) => s.units);
  const { camera, gl, scene, invalidate } = useThree();

  /** Where a click would land right now (shown before clicking), and whether it snapped to a corner. */
  const [cursor, setCursor] = useState<{ p: Vec3; snapped: boolean } | null>(null);

  useEffect(() => {
    if (tool !== 'measure') return;
    const el = gl.domElement;
    el.style.cursor = 'crosshair';
    let down: { x: number; y: number } | null = null;
    let frame = 0;

    /** The point under the pointer: a surface point snapped to a nearby corner, or a workplane point on the snap grid. */
    const pick = (e: PointerEvent): { p: Vec3; snapped: boolean } | null => {
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const targets: THREE.Object3D[] = [];
      scene.traverseVisible((o) => {
        if ((o as THREE.Mesh).isMesh && o.userData.pickable) targets.push(o);
      });
      const hit = ray.intersectObjects(targets, false)[0];
      if (hit) {
        let p = hit.point.clone();
        let snapped = false;
        // Snap to the closest vertex of the hit triangle if it is near on screen.
        const mesh = hit.object as THREE.Mesh;
        const pos = mesh.geometry.getAttribute('position');
        const face = hit.face;
        if (face) {
          let best = SNAP_PX;
          for (const i of [face.a, face.b, face.c]) {
            const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
            const sp = v.clone().project(camera);
            const px = Math.hypot(((sp.x - ndc.x) / 2) * rect.width, ((sp.y - ndc.y) / 2) * rect.height);
            if (px < best) {
              best = px;
              p = v;
              snapped = true;
            }
          }
        }
        return { p: [roundTo(p.x, 3), roundTo(p.y, 3), roundTo(p.z, 3)], snapped };
      }
      const onPlane = new THREE.Vector3();
      if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), onPlane)) return null;
      // On the bare workplane, follow the snap grid (when snapping is on).
      const snap = useEditor.getState().snap;
      const step = snap.enabled ? snap.translate : 0;
      const q = (v: number) => (step ? Math.round(v / step) * step : v);
      return { p: [roundTo(q(onPlane.x), 3), roundTo(q(onPlane.y), 3), 0], snapped: step > 0 };
    };

    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const hit = pick(e);
      if (hit) {
        useEditor.getState().addMeasurePoint(hit.p);
        invalidate();
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons) return; // orbiting or panning
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setCursor(pick(e));
        invalidate();
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(frame);
      setCursor(null);
      invalidate();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      setCursor(null);
      el.style.cursor = '';
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [tool, camera, gl, scene, invalidate]);

  const info = useMemo(() => {
    if (points.length < 2) return null;
    const [a, b] = points.map((p) => new THREE.Vector3(...p));
    return { a, b, mid: a.clone().lerp(b, 0.5), d: b.clone().sub(a) };
  }, [points]);

  const labels = useMemo<Label[] | null>(
    () =>
      tool === 'measure' && info
        ? [
            {
              key: 'measure',
              position: info.mid.toArray() as [number, number, number],
              content: (
                <div className="rounded-lg bg-navy px-2.5 py-1.5 text-center text-white shadow-float" data-testid="measure-label">
                  <div className="text-[14px] font-bold tabular-nums">
                    {formatLength(info.d.length(), units)} {units}
                  </div>
                  <div className="mt-0.5 flex gap-2 text-[11px] font-medium tabular-nums">
                    <span className="text-[#ff8a8d]">ΔX {formatLength(Math.abs(info.d.x), units)}</span>
                    <span className="text-[#6ee7a8]">ΔY {formatLength(Math.abs(info.d.y), units)}</span>
                    <span className="text-[#93b4ff]">ΔZ {formatLength(Math.abs(info.d.z), units)}</span>
                  </div>
                </div>
              ),
            },
          ]
        : null,
    [tool, info, units],
  );
  usePublishLabels('measure', labels);

  if (tool !== 'measure') return null;
  return (
    <group userData={{ noThumbnail: true }}>
      {points.map((p, i) => (
        <mesh key={i} position={p as Vec3} renderOrder={20}>
          <sphereGeometry args={[0.9, 16, 12]} />
          <meshBasicMaterial color="#F59E0B" depthTest={false} />
        </mesh>
      ))}
      {cursor && (
        // Where the next click lands: green when it is snapped to a corner or the grid.
        <mesh position={cursor.p as Vec3} renderOrder={21} name="measure-cursor" userData={{ snapped: cursor.snapped }}>
          <sphereGeometry args={[cursor.snapped ? 1.1 : 0.7, 16, 12]} />
          <meshBasicMaterial color={cursor.snapped ? '#10B981' : '#F59E0B'} transparent opacity={0.85} depthTest={false} />
        </mesh>
      )}
      {info && (
        <>
          <FastLine points={[info.a.toArray(), info.b.toArray()]} color="#F59E0B" lineWidth={2.5} depthTest={false} renderOrder={19} />
        </>
      )}
    </group>
  );
}
