import { create } from 'zustand';
import { Line } from '@react-three/drei';
import type { SnapGuide } from '@/cad/snapping';

/** Transient snap guides shown while dragging. */
export const useGuides = create<{ guides: SnapGuide[] }>(() => ({ guides: [] }));

export function SnapGuides() {
  const guides = useGuides((s) => s.guides);
  return (
    <group userData={{ noThumbnail: true }}>
      {guides.map((g, i) => (
        <Line
          key={i}
          points={
            g.axis === 0
              ? [
                  [g.value, g.from, g.z],
                  [g.value, g.to, g.z],
                ]
              : [
                  [g.from, g.value, g.z],
                  [g.to, g.value, g.z],
                ]
          }
          color="#EC4899"
          lineWidth={1.5}
          dashed
          dashSize={2}
          gapSize={1.5}
          depthTest={false}
          renderOrder={15}
        />
      ))}
    </group>
  );
}
