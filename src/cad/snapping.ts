import * as THREE from 'three';

/** A guide line explaining a snap: on `axis`, at world coordinate `value`. */
export interface SnapGuide {
  axis: 0 | 1;
  value: number;
  /** Extent of the guide along the other horizontal axis. */
  from: number;
  to: number;
  z: number;
}

/**
 * Smart (object-to-object) snapping in X and Y. Given the bounds an object
 * WOULD have after moving by `delta`, nudge `delta` so that its min, centre
 * or max lines up with the min, centre or max of a neighbouring object when
 * within `threshold` mm. Returns the adjusted delta and guides to draw.
 */
export function smartSnap(
  moving: THREE.Box3,
  others: THREE.Box3[],
  delta: THREE.Vector3,
  threshold: number,
): { delta: THREE.Vector3; guides: SnapGuide[] } {
  const out = delta.clone();
  const guides: SnapGuide[] = [];
  const moved = moving.clone().translate(delta);
  for (const axis of [0, 1] as const) {
    const mine = [
      moved.min.getComponent(axis),
      (moved.min.getComponent(axis) + moved.max.getComponent(axis)) / 2,
      moved.max.getComponent(axis),
    ];
    let best: { diff: number; value: number; other: THREE.Box3 } | null = null;
    for (const o of others) {
      const theirs = [o.min.getComponent(axis), (o.min.getComponent(axis) + o.max.getComponent(axis)) / 2, o.max.getComponent(axis)];
      for (const a of mine) {
        for (const b of theirs) {
          const diff = b - a;
          if (Math.abs(diff) <= threshold && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { diff, value: b, other: o };
        }
      }
    }
    if (best) {
      out.setComponent(axis, out.getComponent(axis) + best.diff);
      const other = axis === 0 ? 1 : 0;
      const snapped = moved.clone().translate(new THREE.Vector3().setComponent(axis, best.diff));
      guides.push({
        axis,
        value: best.value,
        from: Math.min(snapped.min.getComponent(other), best.other.min.getComponent(other)) - 4,
        to: Math.max(snapped.max.getComponent(other), best.other.max.getComponent(other)) + 4,
        z: Math.max(0, Math.min(snapped.min.z, best.other.min.z)) + 0.05,
      });
    }
  }
  return { delta: out, guides };
}
