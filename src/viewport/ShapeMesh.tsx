import { memo, useEffect, useMemo, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import type { ShapeObject } from '@/types/document';
import { buildGeometryForShape } from '@/cad/shapeRegistry';
import { useEditor } from '@/store/editorStore';
import { rootAncestor } from '@/cad/hierarchy';
import { gizmoRecentlyUsed } from './viewportBridge';
import { useCadReady } from './cadReady';
import { startSurfaceDrag } from './surfaceDrag';
import { DEG2RAD } from '@/utils/math';

export const HOLE_COLOR = '#8C97AB';

interface Props {
  object: ShapeObject;
  /** Directly selected. */
  selected: boolean;
  /** Part of a selected group. */
  highlighted: boolean;
  /** Part of a combined group: only drawn (as a translucent ghost) while selected. */
  ghost?: boolean;
}

/**
 * Renders one document shape (its transform is local to the enclosing group).
 * Geometry is regenerated only when it actually changes, and the previous
 * geometry is disposed so GPU memory is released. Holes render as translucent
 * grey "cutters".
 */
export const ShapeMesh = memo(function ShapeMesh({ object, selected, highlighted, ghost }: Props) {
  const { shape, size, params, transform, color, mirror, text, meshId, isHole } = object;
  const version = useCadReady((s) => (shape === 'text' || shape === 'mesh' ? s.version : 0));
  const key = JSON.stringify([shape, size, params, mirror, text, meshId, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => buildGeometryForShape(object), [key]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  const [hovered, setHovered] = useState(false);

  if (!geometry) return null;
  if (ghost && !selected) return null;

  /** Click selects the outermost group; Shift/Ctrl/⌘ toggles it in the selection. */
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || gizmoRecentlyUsed() || useEditor.getState().tool !== 'select') return;
    e.stopPropagation();
    const s = useEditor.getState();
    const target = ghost ? object.id : rootAncestor(s.doc, object.id);
    s.select([target], { toggle: e.shiftKey || e.ctrlKey || e.metaKey });
  };

  /** Double-click drills into a group and selects this exact shape. */
  const onDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    if (gizmoRecentlyUsed() || useEditor.getState().tool !== 'select') return;
    e.stopPropagation();
    useEditor.getState().select([object.id]);
  };

  const active = selected || highlighted;
  const translucent = isHole || ghost;

  return (
    <mesh
      name={object.id}
      userData={{ objectId: object.id, pickable: true }}
      geometry={geometry}
      position={transform.position}
      rotation={[transform.rotation[0] * DEG2RAD, transform.rotation[1] * DEG2RAD, transform.rotation[2] * DEG2RAD]}
      castShadow={!translucent}
      receiveShadow={!translucent}
      renderOrder={translucent ? 2 : 0}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onPointerDown={(e) => {
        e.stopPropagation();
        startSurfaceDrag(e, object.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {translucent ? (
        <meshStandardMaterial
          color={isHole ? HOLE_COLOR : color}
          transparent
          opacity={hovered || active ? 0.45 : 0.32}
          depthWrite={false}
          roughness={0.6}
          metalness={0}
        />
      ) : (
        <meshStandardMaterial
          color={color}
          roughness={0.42}
          metalness={0.04}
          emissive={color}
          emissiveIntensity={hovered && !active ? 0.12 : 0}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      )}
      {(active || isHole) && (
        <Edges
          threshold={20}
          color={isHole && !active ? '#5B6577' : '#0b3fb3'}
          lineWidth={selected ? 1.25 : 1}
          transparent
          opacity={selected ? 1 : isHole ? 0.7 : 0.55}
        />
      )}
    </mesh>
  );
});
