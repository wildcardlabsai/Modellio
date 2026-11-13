import { useEffect, type ReactNode } from 'react';
import * as THREE from 'three';
import { create } from 'zustand';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * Screen-space labels for the 3D view (dimensions, elevation, measurements).
 *
 * Labels are ordinary DOM in the main React tree (no per-label React roots),
 * positioned by a projector inside the canvas that writes CSS transforms
 * directly every frame — so moving the camera never re-renders React.
 */
export interface Label {
  key: string;
  position: [number, number, number];
  content: ReactNode;
  /** Pixel offset from the projected point, to keep labels off handles. */
  offset?: [number, number];
}

interface LabelState {
  byOwner: Record<string, Label[]>;
  set: (owner: string, labels: Label[]) => void;
  clear: (owner: string) => void;
}

export const useLabels = create<LabelState>()((set) => ({
  byOwner: {},
  set: (owner, labels) => set((s) => ({ byOwner: { ...s.byOwner, [owner]: labels } })),
  clear: (owner) =>
    set((s) => {
      const next = { ...s.byOwner };
      delete next[owner];
      return { byOwner: next };
    }),
}));

/** Publish labels from inside the scene; they are removed on unmount. */
export function usePublishLabels(owner: string, labels: Label[] | null) {
  const set = useLabels((s) => s.set);
  const clear = useLabels((s) => s.clear);
  useEffect(() => {
    if (labels && labels.length) set(owner, labels);
    else clear(owner);
  }, [owner, labels, set, clear]);
  useEffect(() => () => clear(owner), [owner, clear]);
}

const elements = new Map<string, HTMLDivElement>();
const tmp = new THREE.Vector3();

/** Inside the canvas: projects every label each frame. */
export function LabelProjector() {
  const byOwner = useLabels((s) => s.byOwner);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  // Make sure a frame is drawn when labels change, so new labels are positioned immediately.
  useEffect(() => invalidate(), [byOwner, invalidate]);
  useFrame(({ camera }) => {
    for (const labels of Object.values(byOwner)) {
      for (const l of labels) {
        const el = elements.get(l.key);
        if (!el) continue;
        tmp.set(...l.position).project(camera);
        const visible = tmp.z < 1 && tmp.z > -1;
        const x = ((tmp.x + 1) / 2) * size.width + (l.offset?.[0] ?? 0);
        const y = ((1 - tmp.y) / 2) * size.height + (l.offset?.[1] ?? 0);
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        el.style.visibility = visible ? 'visible' : 'hidden';
      }
    }
  });
  return null;
}

/** Outside the canvas (DOM): renders the label elements. */
export function LabelLayer() {
  const byOwner = useLabels((s) => s.byOwner);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {Object.values(byOwner)
        .flat()
        .map((l) => (
          <div
            key={l.key}
            data-label={l.key}
            ref={(el) => {
              if (el) elements.set(l.key, el);
              else elements.delete(l.key);
            }}
            className="absolute left-0 top-0 whitespace-nowrap"
            style={{ visibility: 'hidden' }}
          >
            {l.content}
          </div>
        ))}
    </div>
  );
}
