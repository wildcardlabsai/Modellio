import { memo, useEffect, useMemo, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import { useEditor } from '@/store/editorStore';
import type { ObjectId } from '@/types/document';
import { computeCombined } from '@/cad/operations/combine';
import { meshDataToGeometry } from '@/cad/kernel/meshData';
import { rootAncestor } from '@/cad/hierarchy';
import { gizmoRecentlyUsed } from './viewportBridge';
import { useCadReady } from './cadReady';
import { HOLE_COLOR } from './ShapeMesh';

/**
 * The live Boolean result of a combined group, rendered in the group's local
 * frame. Recomputed (via the kernel's cache) whenever any part changes.
 */
export const CombinedMesh = memo(function CombinedMesh({
  id,
  selected,
  highlighted,
}: {
  id: ObjectId;
  selected: boolean;
  highlighted: boolean;
}) {
  const doc = useEditor((s) => s.doc);
  const version = useCadReady((s) => s.version);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => computeCombined(doc, id), [doc, id, version]);
  const geometry = useMemo(() => (result?.mesh ? meshDataToGeometry(result.mesh) : null), [result?.mesh]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  const [hovered, setHovered] = useState(false);

  if (!geometry || !result) return null;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || gizmoRecentlyUsed() || useEditor.getState().tool === 'measure') return;
    e.stopPropagation();
    const s = useEditor.getState();
    s.select([rootAncestor(s.doc, id)], { toggle: e.shiftKey || e.ctrlKey || e.metaKey });
  };
  const active = selected || highlighted;

  return (
    <mesh
      name={`${id}:result`}
      userData={{ pickable: true }}
      geometry={geometry}
      castShadow={!result.isHole}
      receiveShadow={!result.isHole}
      onClick={onClick}
      onDoubleClick={(e) => {
        if (gizmoRecentlyUsed() || useEditor.getState().tool === 'measure') return;
        e.stopPropagation();
        useEditor.getState().select([id]);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {result.isHole ? (
        <meshStandardMaterial color={HOLE_COLOR} transparent opacity={0.35} depthWrite={false} />
      ) : (
        <meshStandardMaterial
          color={result.color}
          roughness={0.42}
          metalness={0.04}
          emissive={result.color}
          emissiveIntensity={hovered && !active ? 0.12 : 0}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      )}
      {active && <Edges threshold={25} color="#0b3fb3" lineWidth={selected ? 1.25 : 1} transparent opacity={selected ? 1 : 0.55} />}
    </mesh>
  );
});
