import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEditor } from '@/store/editorStore';
import type { ModelDocument, ObjectId, Vec3 } from '@/types/document';
import {
  canScaleNonUniform,
  groupLocalBounds,
  isEffectivelyLocked,
  isEffectivelyVisible,
  scaleGroupDraft,
  topLevel,
  worldMatrix,
} from '@/cad/hierarchy';
import { eulerFromDegrees } from '@/cad/transforms/transform';
import { rayFromClient, setOrbitEnabled, viewport } from './viewportBridge';
import { roundTo, snapTo } from '@/utils/math';
import { MIN_DIMENSION } from '@/cad/geometry/geometryUtils';

/** Handle direction in the object's local frame: x/y ∈ {-1,0,1}; z = 1 is the top (height) handle. */
interface HandleDef {
  key: string;
  x: number;
  y: number;
  z: 0 | 1;
}

const HANDLES: HandleDef[] = [
  ...[-1, 1].flatMap((x) => [-1, 1].map((y) => ({ key: `c${x}${y}`, x, y, z: 0 as const }))),
  { key: 'e+x', x: 1, y: 0, z: 0 },
  { key: 'e-x', x: -1, y: 0, z: 0 },
  { key: 'e+y', x: 0, y: 1, z: 0 },
  { key: 'e-y', x: 0, y: -1, z: 0 },
  { key: 'top', x: 0, y: 0, z: 1 },
];

/** Local bounding box of a shape (centred) or group (its parts, in the group frame). */
function localBox(doc: ModelDocument, id: ObjectId): THREE.Box3 {
  const o = doc.objects[id];
  if (o.kind === 'shape') {
    const h = new THREE.Vector3(...o.size).multiplyScalar(0.5);
    return new THREE.Box3(h.clone().negate(), h);
  }
  return groupLocalBounds(doc, id);
}

/**
 * Compute the new local box for a handle drag. The side opposite the handle
 * stays fixed; `uniform` scales all three axes by the dominant factor.
 */
export function resizeBox(start: THREE.Box3, h: HandleDef, pointLocal: THREE.Vector3, uniform: boolean, step: number): THREE.Box3 {
  const ext = start.getSize(new THREE.Vector3());
  const next = ext.clone();
  const fit = (v: number) => Math.max(MIN_DIMENSION, step ? snapTo(v, step) || step : v);
  if (h.z === 1) next.z = fit(pointLocal.z - start.min.z);
  if (h.x > 0) next.x = fit(pointLocal.x - start.min.x);
  if (h.x < 0) next.x = fit(start.max.x - pointLocal.x);
  if (h.y > 0) next.y = fit(pointLocal.y - start.min.y);
  if (h.y < 0) next.y = fit(start.max.y - pointLocal.y);
  if (uniform) {
    const factors = [next.x / ext.x, next.y / ext.y, next.z / ext.z];
    const f = factors.reduce((best, v) => (Math.abs(v - 1) > Math.abs(best - 1) ? v : best), 1);
    next.set(ext.x * f, ext.y * f, ext.z * f);
  }
  const out = start.clone();
  // X/Y: anchor the opposite side, or keep centred when the handle doesn't act on that axis.
  for (const [axis, dir] of [
    ['x', h.x],
    ['y', h.y],
  ] as const) {
    const size = next[axis];
    if (dir > 0) out.max[axis] = start.min[axis] + size;
    else if (dir < 0) out.min[axis] = start.max[axis] - size;
    else {
      const c = (start.min[axis] + start.max[axis]) / 2;
      out.min[axis] = c - size / 2;
      out.max[axis] = c + size / 2;
    }
  }
  // Z always grows from the bottom so objects stay on what they rest on.
  out.max.z = start.min.z + next.z;
  return out;
}

const HANDLE_PX = 0.011;
/** Shared by every handle (never disposed: one tiny geometry for the app's lifetime). */
const HANDLE_EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));

/**
 * One-sided resize handles (Resize mode, R): bottom corners resize X and Y,
 * edge midpoints resize one axis, the top handle sets the height. Shift (or
 * locked proportions) resizes uniformly. Values snap to the grid step.
 */
export function ResizeHandles() {
  const mode = useEditor((s) => s.mode);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const items = topLevel(doc, selection).filter((id) => isEffectivelyVisible(doc, id));
  const id = items.length === 1 ? items[0] : null;
  if (mode !== 'scale' || tool !== 'select' || !id || isEffectivelyLocked(doc, id)) return null;
  return <Handles id={id} doc={doc} />;
}

function Handles({ id, doc }: { id: ObjectId; doc: ModelDocument }) {
  const matrix = useMemo(() => worldMatrix(doc, id), [doc, id]);
  const box = useMemo(() => localBox(doc, id), [doc, id]);
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const positions = HANDLES.map((h) => {
    const c = box.getCenter(new THREE.Vector3());
    const hx = (box.max.x - box.min.x) / 2;
    const hy = (box.max.y - box.min.y) / 2;
    return h.z === 1 ? new THREE.Vector3(c.x, c.y, box.max.z) : new THREE.Vector3(c.x + h.x * hx, c.y + h.y * hy, box.min.z);
  });

  // Keep handles the same size on screen.
  useFrame(({ camera }) => {
    const wp = new THREE.Vector3();
    refs.current.forEach((m) => {
      if (!m) return;
      m.getWorldPosition(wp);
      m.scale.setScalar(camera.position.distanceTo(wp) * HANDLE_PX);
    });
  });

  const onDown = (e: ThreeEvent<PointerEvent>, h: HandleDef) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = useEditor.getState();
    const base = s.doc;
    const o = base.objects[id];
    const startBox = localBox(base, id);
    const W = worldMatrix(base, id);
    const Winv = W.clone().invert();
    const zAxis = new THREE.Vector3().setFromMatrixColumn(W, 2).normalize();
    const bottomPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(zAxis, new THREE.Vector3(0, 0, startBox.min.z).applyMatrix4(W));
    const axisOrigin = startBox.getCenter(new THREE.Vector3()).setZ(startBox.min.z).applyMatrix4(W);
    const rotation = new THREE.Quaternion().setFromEuler(eulerFromDegrees(o.transform.rotation));
    const startPos = new THREE.Vector3(...o.transform.position);
    const startCenter = startBox.getCenter(new THREE.Vector3());
    const groupUniform = o.kind === 'group' && !canScaleNonUniform(base, id);

    setOrbitEnabled(false);
    viewport.gizmoActive = true;
    setActive(h.key);
    s.beginTransaction('Resize');

    const onMove = (ev: PointerEvent) => {
      const ray = rayFromClient(ev.clientX, ev.clientY);
      if (!ray) return;
      let pLocal: THREE.Vector3;
      if (h.z === 1) {
        // Closest point on the object's vertical axis to the mouse ray.
        const w0 = axisOrigin.clone().sub(ray.origin);
        const a = zAxis.dot(zAxis),
          b = zAxis.dot(ray.direction),
          c = ray.direction.dot(ray.direction);
        const d = zAxis.dot(w0),
          e2 = ray.direction.dot(w0);
        const denom = a * c - b * b;
        if (Math.abs(denom) < 1e-9) return;
        const t = (b * e2 - c * d) / denom;
        pLocal = new THREE.Vector3(0, 0, startBox.min.z + t);
      } else {
        const hit = new THREE.Vector3();
        if (!ray.intersectPlane(bottomPlane, hit)) return;
        pLocal = hit.applyMatrix4(Winv);
      }
      const st = useEditor.getState();
      const uniform = ev.shiftKey || st.lockProportions || groupUniform;
      const next = resizeBox(startBox, h, pLocal, uniform, st.snap.enabled ? st.snap.translate : 0);
      const size = next.getSize(new THREE.Vector3());
      const shift = next.getCenter(new THREE.Vector3()).sub(startCenter).applyQuaternion(rotation);
      const position: Vec3 = [roundTo(startPos.x + shift.x), roundTo(startPos.y + shift.y), roundTo(startPos.z + shift.z)];
      st.applyTransient((draft) => {
        const t = draft.objects[id];
        if (!t) return;
        if (t.kind === 'shape') {
          t.size = [roundTo(size.x), roundTo(size.y), roundTo(size.z)];
        } else {
          const ext = startBox.getSize(new THREE.Vector3());
          scaleGroupDraft(draft, base, id, [size.x / ext.x, size.y / ext.y, size.z / ext.z]);
        }
        draft.objects[id].transform.position = position;
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setOrbitEnabled(true);
      setActive(null);
      viewport.gizmoActive = false;
      viewport.lastGizmoRelease = performance.now();
      useEditor.getState().commitTransaction();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <group matrix={matrix} matrixAutoUpdate={false} userData={{ noThumbnail: true }}>
      {HANDLES.map((h, i) => {
        const hot = hover === h.key || active === h.key;
        return (
          <mesh
            key={h.key}
            name={`handle:${h.key}`}
            userData={{ handle: true }}
            ref={(m) => void (refs.current[i] = m)}
            position={positions[i]}
            renderOrder={30}
            onPointerDown={(e) => onDown(e, h)}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHover(h.key);
              document.body.style.cursor = h.z ? 'ns-resize' : h.x && h.y ? 'nwse-resize' : 'ew-resize';
            }}
            onPointerOut={() => {
              setHover(null);
              document.body.style.cursor = '';
            }}
          >
            <boxGeometry args={h.z ? [1.1, 1.1, 1.1] : [1, 1, 1]} />
            <meshBasicMaterial color={hot ? '#2463eb' : h.z ? '#dbe6fd' : '#ffffff'} depthTest={false} transparent />
            {/* Outline */}
            <lineSegments renderOrder={31} geometry={HANDLE_EDGES} dispose={null}>
              <lineBasicMaterial color="#2463eb" depthTest={false} transparent />
            </lineSegments>
          </mesh>
        );
      })}
    </group>
  );
}
