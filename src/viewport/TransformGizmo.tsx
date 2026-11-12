import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { useEditor } from '@/store/editorStore';
import type { ObjectId, ShapeObject, Transform, Vec3 } from '@/types/document';
import { eulerFromDegrees, matrixToTransform, transformToMatrix } from '@/cad/transforms/transform';
import { selectionBounds } from './bounds';
import { viewport } from './viewportBridge';
import { DEG2RAD, roundTo, snapTo } from '@/utils/math';
import { MIN_DIMENSION } from '@/cad/geometry/geometryUtils';

interface DragItem {
  id: ObjectId;
  transform: Transform;
  matrix: THREE.Matrix4;
  size: Vec3;
}

interface DragState {
  proxyStart: THREE.Matrix4;
  proxyStartPos: THREE.Vector3;
  items: DragItem[];
}

const LABELS = { translate: 'Move', rotate: 'Rotate', scale: 'Resize' } as const;

/**
 * Translate / rotate / scale gizmo.
 *
 * The gizmo manipulates an invisible proxy object placed at the selection's
 * pivot. Every change is converted into document edits (position, rotation,
 * size) inside a single transaction, so the document stays the single source
 * of truth and one drag = one undo step. Scale is never left on objects: it is
 * baked into the authoritative `size`, keeping inspector values and exported
 * geometry identical.
 */
export function TransformGizmo() {
  const selection = useEditor((s) => s.selection);
  const doc = useEditor((s) => s.doc);
  const mode = useEditor((s) => s.mode);
  const snap = useEditor((s) => s.snap);
  const transaction = useEditor((s) => s.transaction);

  const proxy = useMemo(() => new THREE.Object3D(), []);
  const drag = useRef<DragState | null>(null);

  // One TransformControls instance for the lifetime of the viewport. It is
  // attached/detached as the selection changes (never re-created), and its
  // gizmo geometry is disposed when the viewport unmounts.
  const camera = useThree((st) => st.camera);
  const gl = useThree((st) => st.gl);
  const scene = useThree((st) => st.scene);
  const orbit = useThree((st) => st.controls) as unknown as { enabled: boolean } | null;
  const invalidate = useThree((st) => st.invalidate);
  const controls = useMemo(() => new TransformControls(camera, gl.domElement), [camera, gl]);
  const handlers = useRef({ onMouseDown: () => {}, onObjectChange: () => {}, onMouseUp: () => {} });

  useEffect(() => {
    const helper = controls.getHelper();
    scene.add(helper);
    const onChange = () => invalidate();
    const onDown = () => handlers.current.onMouseDown();
    const onUp = () => handlers.current.onMouseUp();
    const onObj = () => handlers.current.onObjectChange();
    controls.addEventListener('change', onChange);
    controls.addEventListener('mouseDown', onDown);
    controls.addEventListener('mouseUp', onUp);
    controls.addEventListener('objectChange', onObj);
    return () => {
      controls.removeEventListener('change', onChange);
      controls.removeEventListener('mouseDown', onDown);
      controls.removeEventListener('mouseUp', onUp);
      controls.removeEventListener('objectChange', onObj);
      controls.detach();
      scene.remove(helper);
      controls.dispose();
    };
  }, [controls, scene, invalidate]);

  // Disable camera orbiting while a gizmo handle is being dragged.
  useEffect(() => {
    if (!orbit) return;
    const onDragging = (e: { value: unknown }) => void (orbit.enabled = !e.value);
    controls.addEventListener('dragging-changed', onDragging);
    return () => controls.removeEventListener('dragging-changed', onDragging);
  }, [controls, orbit]);

  const shapes = selection.map((id) => doc.objects[id]).filter((o): o is ShapeObject => o?.kind === 'shape' && o.visible);
  const blocked = shapes.some((o) => o.locked);
  const enabled = shapes.length > 0 && !blocked && !(mode === 'scale' && shapes.length > 1);

  const syncProxy = useCallback(() => {
    const { doc: d, selection: sel } = useEditor.getState();
    const objs = sel.map((id) => d.objects[id]).filter((o): o is ShapeObject => o?.kind === 'shape');
    if (!objs.length) return;
    if (objs.length === 1) {
      proxy.position.set(...objs[0].transform.position);
      proxy.quaternion.setFromEuler(eulerFromDegrees(objs[0].transform.rotation));
    } else {
      selectionBounds(d, sel).getCenter(proxy.position);
      proxy.quaternion.identity();
    }
    proxy.scale.set(1, 1, 1);
    proxy.updateMatrix();
    proxy.updateMatrixWorld(true);
  }, [proxy]);

  // Keep the proxy at the selection pivot whenever the document changes outside a drag
  // (inspector edits, undo/redo, selection changes).
  useLayoutEffect(() => {
    if (!drag.current) syncProxy();
  }, [doc, selection, mode, syncProxy]);

  // If the transaction was ended elsewhere (undo pressed mid-drag), drop the drag state.
  useLayoutEffect(() => {
    if (!transaction && drag.current) {
      drag.current = null;
      syncProxy();
    }
  }, [transaction, syncProxy]);

  const onMouseDown = () => {
    proxy.updateMatrix();
    drag.current = {
      proxyStart: proxy.matrix.clone(),
      proxyStartPos: proxy.position.clone(),
      items: shapes.map((o) => ({
        id: o.id,
        transform: o.transform,
        matrix: transformToMatrix(o.transform),
        size: [...o.size] as Vec3,
      })),
    };
    viewport.gizmoActive = true;
    useEditor.getState().beginTransaction(shapes.length > 1 ? `${LABELS[mode]} ${shapes.length} objects` : LABELS[mode]);
  };

  const onObjectChange = () => {
    const d = drag.current;
    if (!d) return;
    proxy.updateMatrix();
    const { applyTransient, snap: snapSettings } = useEditor.getState();

    if (mode === 'translate') {
      const delta = proxy.position.clone().sub(d.proxyStartPos);
      applyTransient((draft) => {
        for (const item of d.items) {
          const o = draft.objects[item.id];
          if (!o) continue;
          o.transform.position = [
            roundTo(item.transform.position[0] + delta.x),
            roundTo(item.transform.position[1] + delta.y),
            roundTo(item.transform.position[2] + delta.z),
          ];
        }
      });
      return;
    }

    if (mode === 'rotate') {
      const delta = proxy.matrix.clone().multiply(d.proxyStart.clone().invert());
      applyTransient((draft) => {
        for (const item of d.items) {
          const o = draft.objects[item.id];
          if (o) o.transform = matrixToTransform(delta.clone().multiply(item.matrix));
        }
      });
      return;
    }

    // Scale: single object. Convert the proxy scale into a new size.
    const item = d.items[0];
    let factors = [Math.abs(proxy.scale.x), Math.abs(proxy.scale.y), Math.abs(proxy.scale.z)];
    if (useEditor.getState().lockProportions) {
      const dominant = factors.reduce((best, f) => (Math.abs(f - 1) > Math.abs(best - 1) ? f : best), 1);
      factors = [dominant, dominant, dominant];
    }
    const step = snapSettings.enabled ? snapSettings.translate : 0;
    const size = item.size.map((s, i) => {
      if (factors[i] === 1) return s;
      return Math.max(MIN_DIMENSION, roundTo(step ? snapTo(s * factors[i], step) || step : s * factors[i]));
    }) as Vec3;
    // Keep the object's local bottom face anchored, so resizing an object
    // that rests on the workplane does not push it through the plate.
    const lift = new THREE.Vector3(0, 0, (size[2] - item.size[2]) / 2).applyEuler(eulerFromDegrees(item.transform.rotation));
    applyTransient((draft) => {
      const o = draft.objects[item.id];
      if (!o || o.kind !== 'shape') return;
      o.size = size;
      o.transform.position = [
        roundTo(item.transform.position[0] + lift.x),
        roundTo(item.transform.position[1] + lift.y),
        roundTo(item.transform.position[2] + lift.z),
      ];
    });
  };

  const onMouseUp = () => {
    drag.current = null;
    viewport.gizmoActive = false;
    viewport.lastGizmoRelease = performance.now();
    useEditor.getState().commitTransaction();
    syncProxy();
  };

  handlers.current = { onMouseDown, onObjectChange, onMouseUp };

  useEffect(() => {
    controls.setMode(mode);
    controls.setSpace(mode === 'scale' ? 'local' : 'world');
    controls.setSize(0.85);
    controls.setTranslationSnap(snap.enabled ? snap.translate : null);
    controls.setRotationSnap(snap.enabled ? snap.rotate * DEG2RAD : null);
    if (enabled) {
      if (controls.object !== proxy) controls.attach(proxy);
    } else if (controls.object) {
      controls.detach();
    }
    invalidate();
  }, [controls, proxy, mode, snap, enabled, invalidate]);

  return <primitive object={proxy} />;
}
