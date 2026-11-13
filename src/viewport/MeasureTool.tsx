import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { usePublishLabels, type Label } from './labels';
import { useEditor } from '@/store/editorStore';
import type { Vec3 } from '@/types/document';
import { formatMm, roundTo } from '@/utils/math';

const SNAP_PX = 10;

/**
 * Measure tool (M): click two points on any surface or on the workplane to
 * read the distance and its X/Y/Z components. Points snap to a nearby mesh
 * vertex (within 10 px) for exact edge-to-edge measurements.
 */
export function MeasureTool() {
  const tool = useEditor((s) => s.tool);
  const points = useEditor((s) => s.measurePoints);
  const { camera, gl, scene, invalidate } = useThree();

  useEffect(() => {
    if (tool !== 'measure') return;
    const el = gl.domElement;
    el.style.cursor = 'crosshair';
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const targets: THREE.Object3D[] = [];
      scene.traverseVisible((o) => {
        if ((o as THREE.Mesh).isMesh && o.userData.pickable) targets.push(o);
      });
      const hit = ray.intersectObjects(targets, false)[0];
      let p: THREE.Vector3 | null = null;
      if (hit) {
        p = hit.point.clone();
        // Snap to the closest vertex of the hit triangle if it is near on screen.
        const mesh = hit.object as THREE.Mesh;
        const pos = mesh.geometry.getAttribute('position');
        const face = hit.face;
        if (face) {
          let best = SNAP_PX;
          for (const i of [face.a, face.b, face.c]) {
            const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
            const s = v.clone().project(camera);
            const px = Math.hypot(((s.x - ndc.x) / 2) * rect.width, ((s.y - ndc.y) / 2) * rect.height);
            if (px < best) {
              best = px;
              p = v;
            }
          }
        }
      } else {
        const onPlane = new THREE.Vector3();
        if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), onPlane)) p = onPlane;
      }
      if (p) {
        useEditor.getState().addMeasurePoint([roundTo(p.x, 3), roundTo(p.y, 3), roundTo(p.z, 3)]);
        invalidate();
      }
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.style.cursor = '';
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
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
                  <div className="text-[14px] font-bold tabular-nums">{formatMm(info.d.length())} mm</div>
                  <div className="mt-0.5 flex gap-2 text-[11px] font-medium tabular-nums">
                    <span className="text-[#ff8a8d]">ΔX {formatMm(Math.abs(info.d.x))}</span>
                    <span className="text-[#6ee7a8]">ΔY {formatMm(Math.abs(info.d.y))}</span>
                    <span className="text-[#93b4ff]">ΔZ {formatMm(Math.abs(info.d.z))}</span>
                  </div>
                </div>
              ),
            },
          ]
        : null,
    [tool, info],
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
      {info && (
        <>
          <Line points={[info.a, info.b]} color="#F59E0B" lineWidth={2.5} depthTest={false} renderOrder={19} />
        </>
      )}
    </group>
  );
}
