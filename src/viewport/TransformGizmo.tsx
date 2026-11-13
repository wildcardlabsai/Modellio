import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { useEditor } from '@/store/editorStore';
import type { ModelDocument, ObjectId, Transform } from '@/types/document';
import { matrixToTransform } from '@/cad/transforms/transform';
import { isEffectivelyLocked, isEffectivelyVisible, parentWorldMatrix, topLevel, worldBoundsOf, worldMatrix } from '@/cad/hierarchy';
import { viewport } from './viewportBridge';
import { DEG2RAD, roundTo } from '@/utils/math';
import { collectSubtree } from '@/cad/document';
import { smartSnap } from '@/cad/snapping';
import { useGuides } from './guides';

interface DragItem {
  id: ObjectId;
  kind: 'shape' | 'group';
  /** Local transform at drag start. */
  transform: Transform;
  /** World matrix at drag start. */
  world: THREE.Matrix4;
  /** Inverse of the parent's world matrix (world → parent frame). */
  parentInv: THREE.Matrix4;
  parentInvQuat: THREE.Quaternion;
}

interface DragState {
  proxyStart: THREE.Matrix4;
  proxyStartPos: THREE.Vector3;
  items: DragItem[];
  /** For smart snapping: the selection's world bounds at drag start, and its neighbours'. */
  startBounds: THREE.Box3;
  others: THREE.Box3[];
}

const LABELS = { translate: 'Move', rotate: 'Rotate', scale: 'Resize' } as const;

/** The objects the gizmo manipulates: visible, top-level members of the selection. */
function gizmoItems(doc: ModelDocument, selection: ObjectId[]): ObjectId[] {
  return topLevel(doc, selection).filter((id) => isEffectivelyVisible(doc, id));
}

/**
 * Translate / rotate / scale gizmo.
 *
 * The gizmo manipulates an invisible proxy object placed at the selection's
 * pivot (in WORLD space, so it works at any depth of the group hierarchy). Every change is converted into document edits (position, rotation,
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
    helper.userData.noThumbnail = true;
    viewport.gizmoHovered = () => !!controls.object && controls.axis !== null;
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

  const items = gizmoItems(doc, selection);
  const blocked = items.some((id) => isEffectivelyLocked(doc, id));
  // Resizing uses the one-sided ResizeHandles instead of the gizmo's scale mode.
  const enabled = items.length > 0 && !blocked && mode !== 'scale';

  const syncProxy = useCallback(() => {
    const { doc: d, selection: sel } = useEditor.getState();
    const ids = gizmoItems(d, sel);
    if (!ids.length) return;
    if (ids.length === 1) {
      worldMatrix(d, ids[0]).decompose(proxy.position, proxy.quaternion, new THREE.Vector3());
    } else {
      worldBoundsOf(d, ids).getCenter(proxy.position);
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
    const { doc: d } = useEditor.getState();
    const moving = new Set(collectSubtree(d, items));
    drag.current = {
      startBounds: worldBoundsOf(d, items),
      others: d.rootIds.filter((id) => !moving.has(id) && d.objects[id]?.visible).map((id) => worldBoundsOf(d, [id])),
      proxyStart: proxy.matrix.clone(),
      proxyStartPos: proxy.position.clone(),
      items: items.map((id) => {
        const o = d.objects[id];
        const parentInv = parentWorldMatrix(d, id).invert();
        const parentInvQuat = new THREE.Quaternion();
        parentInv.decompose(new THREE.Vector3(), parentInvQuat, new THREE.Vector3());
        return {
          id,
          kind: o.kind,
          transform: o.transform,
          world: worldMatrix(d, id),
          parentInv,
          parentInvQuat,
        };
      }),
    };
    viewport.gizmoActive = true;
    useEditor.getState().beginTransaction(items.length > 1 ? `${LABELS[mode]} ${items.length} objects` : LABELS[mode]);
  };

  const onObjectChange = () => {
    const d = drag.current;
    if (!d) return;
    proxy.updateMatrix();
    const { applyTransient, snap: snapSettings } = useEditor.getState();

    if (mode === 'translate') {
      // World delta → each object's parent frame. Rotation is left untouched.
      let delta = proxy.position.clone().sub(d.proxyStartPos);
      // Align with neighbouring objects (edges/centres) when close; Z is left to the gizmo.
      if (Math.abs(delta.x) + Math.abs(delta.y) > 0) {
        const z = delta.z;
        const snapped = smartSnap(
          d.startBounds,
          d.others,
          delta,
          Math.max(1.5, (snapSettings.enabled ? snapSettings.translate : 0) * 0.75),
        );
        delta = snapped.delta.setZ(z);
        useGuides.setState({ guides: snapped.guides });
      }
      applyTransient((draft) => {
        for (const item of d.items) {
          const o = draft.objects[item.id];
          if (!o) continue;
          const local = delta.clone().applyQuaternion(item.parentInvQuat);
          o.transform.position = [
            roundTo(item.transform.position[0] + local.x),
            roundTo(item.transform.position[1] + local.y),
            roundTo(item.transform.position[2] + local.z),
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
          if (o) o.transform = matrixToTransform(item.parentInv.clone().multiply(delta).multiply(item.world));
        }
      });
      return;
    }
  };

  const onMouseUp = () => {
    useGuides.setState({ guides: [] });
    drag.current = null;
    viewport.gizmoActive = false;
    viewport.lastGizmoRelease = performance.now();
    useEditor.getState().commitTransaction();
    syncProxy();
  };

  handlers.current = { onMouseDown, onObjectChange, onMouseUp };

  useEffect(() => {
    controls.setMode(mode === 'scale' ? 'translate' : mode);
    controls.setSpace('world');
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
