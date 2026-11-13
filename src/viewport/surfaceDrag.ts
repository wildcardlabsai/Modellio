import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useEditor } from '@/store/editorStore';
import { collectSubtree } from '@/cad/document';
import { isEffectivelyLocked, parentWorldMatrix, topLevel, worldBoundsOf } from '@/cad/hierarchy';
import type { ObjectId, Transform } from '@/types/document';
import { heightUnder, rayFromClient, setOrbitEnabled, viewport } from './viewportBridge';
import { smartSnap } from '@/cad/snapping';
import { useGuides } from './guides';
import { roundTo, snapTo } from '@/utils/math';

const DRAG_THRESHOLD_PX = 4;

/**
 * Tinkercad-style direct dragging: press on an object and drag to slide it
 * across the workplane. The object rests on whatever upward-facing surface
 * is under the cursor (so you can stack parts), X/Y snap to the grid and to
 * neighbouring objects' edges and centres. One drag = one undo step.
 */
export function startSurfaceDrag(e: ThreeEvent<PointerEvent>, clickedId: ObjectId) {
  const s0 = useEditor.getState();
  if (e.button !== 0 || s0.tool !== 'select' || viewport.gizmoActive) return;
  const doc = s0.doc;
  // Drag what a click would select: the clicked object if it is selected (drilled in), else its outermost group.
  const selected = s0.selection.includes(clickedId);
  let target = clickedId;
  if (!selected) {
    let p = doc.objects[clickedId]?.parentId;
    while (p) {
      target = p;
      p = doc.objects[p]?.parentId ?? null;
    }
  }
  if (isEffectivelyLocked(doc, target)) return;

  // Stop the camera from orbiting while an object is pressed.
  setOrbitEnabled(false);
  const startX = e.nativeEvent.clientX;
  const startY = e.nativeEvent.clientY;
  // Where the object was grabbed, on its own surface.
  const grabPoint = e.point.clone();
  let engaged = false;
  let items: ObjectId[] = [];
  let starts: { id: ObjectId; transform: Transform; parentInvQuat: THREE.Quaternion }[] = [];
  let startBounds = new THREE.Box3();
  let others: THREE.Box3[] = [];
  let grabOffset = new THREE.Vector2();
  let excluded = new Set<string>();

  const engage = () => {
    engaged = true;
    viewport.gizmoActive = true;
    const s = useEditor.getState();
    if (!s.selection.includes(target)) s.select([target]);
    const d = useEditor.getState().doc;
    const sel = useEditor.getState().selection;
    items = topLevel(d, sel.includes(target) ? sel : [target]).filter((id) => !isEffectivelyLocked(d, id));
    starts = items.map((id) => {
      const q = new THREE.Quaternion();
      parentWorldMatrix(d, id).invert().decompose(new THREE.Vector3(), q, new THREE.Vector3());
      return { id, transform: d.objects[id].transform, parentInvQuat: q };
    });
    startBounds = worldBoundsOf(d, items);
    const moving = new Set(collectSubtree(d, items));
    excluded = new Set([...moving, ...[...moving].map((id) => `${id}:result`)]);
    others = d.rootIds.filter((id) => !moving.has(id) && d.objects[id]?.visible).map((id) => worldBoundsOf(d, [id]));
    // Keep the grabbed point under the cursor (relative to the object's footprint).
    const base = startBounds.getCenter(new THREE.Vector3());
    grabOffset = new THREE.Vector2(grabPoint.x - base.x, grabPoint.y - base.y);
    s.beginTransaction(items.length > 1 ? `Move ${items.length} objects` : 'Move');
  };

  const onMove = (ev: PointerEvent) => {
    if (!engaged) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
      engage();
    }
    // X/Y follow the cursor 1:1 on a horizontal plane at the height where the object was grabbed.
    const ray = rayFromClient(ev.clientX, ev.clientY);
    const onGrabPlane = new THREE.Vector3();
    if (!ray || !ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -grabPoint.z), onGrabPlane)) return;
    const { snap } = useEditor.getState();
    const base = startBounds.getCenter(new THREE.Vector3());
    const step = snap.enabled ? snap.translate : 0;
    const targetX = step ? snapTo(onGrabPlane.x - grabOffset.x, step) : onGrabPlane.x - grabOffset.x;
    const targetY = step ? snapTo(onGrabPlane.y - grabOffset.y, step) : onGrabPlane.y - grabOffset.y;
    let delta = new THREE.Vector3(targetX - base.x, targetY - base.y, 0);
    // Object-to-object alignment wins over the grid when close.
    const snapped = smartSnap(startBounds, others, delta, Math.max(1.5, step * 0.75));
    delta = snapped.delta;
    // Z: rest on the highest surface under the object's footprint (stacking), or on the plate.
    const fp = startBounds.clone().translate(delta);
    const ix = (fp.max.x - fp.min.x) * 0.3;
    const iy = (fp.max.y - fp.min.y) * 0.3;
    const cx = (fp.min.x + fp.max.x) / 2;
    const cy = (fp.min.y + fp.max.y) / 2;
    const restZ = heightUnder(
      [
        [cx, cy],
        [cx - ix, cy - iy],
        [cx + ix, cy - iy],
        [cx - ix, cy + iy],
        [cx + ix, cy + iy],
      ],
      (n) => excluded.has(n),
    );
    delta.z = restZ - startBounds.min.z;
    useGuides.setState({ guides: snapped.guides });
    useEditor.getState().applyTransient((draft) => {
      for (const st of starts) {
        const o = draft.objects[st.id];
        if (!o) continue;
        const local = delta.clone().applyQuaternion(st.parentInvQuat);
        o.transform.position = [
          roundTo(st.transform.position[0] + local.x),
          roundTo(st.transform.position[1] + local.y),
          roundTo(st.transform.position[2] + local.z),
        ];
      }
    });
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    setOrbitEnabled(true);
    useGuides.setState({ guides: [] });
    if (engaged) {
      useEditor.getState().commitTransaction();
      viewport.gizmoActive = false;
      viewport.lastGizmoRelease = performance.now();
    }
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}
