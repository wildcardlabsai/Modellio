import { memo, useEffect, useMemo, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import type { ShapeObject } from '@/types/document';
import { buildShapeGeometry } from '@/cad/shapeRegistry';
import { useEditor } from '@/store/editorStore';
import { rootAncestor } from '@/cad/hierarchy';
import { gizmoRecentlyUsed } from './viewportBridge';
import { DEG2RAD } from '@/utils/math';

interface Props {
  object: ShapeObject;
  /** Directly selected. */
  selected: boolean;
  /** Part of a selected group. */
  highlighted: boolean;
}

/**
 * Renders one document shape (its transform is local to the enclosing group).
 * Geometry is regenerated only when type, size, params or mirror change, and
 * the previous geometry is disposed so GPU memory is released.
 */
export const ShapeMesh = memo(function ShapeMesh({ object, selected, highlighted }: Props) {
  const { shape, size, params, transform, color, mirror } = object;
  const sizeKey = size.join(',');
  const paramKey = JSON.stringify(params);
  const mirrorKey = mirror?.join(',') ?? '';
  const geometry = useMemo(
    () => buildShapeGeometry(shape, size, params, mirror),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape, sizeKey, paramKey, mirrorKey],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  const [hovered, setHovered] = useState(false);

  /** Click selects the outermost group; Shift/Ctrl/⌘ toggles it in the selection. */
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    // Ignore clicks that ended a camera orbit or a gizmo drag.
    if (e.delta > 4 || gizmoRecentlyUsed()) return;
    e.stopPropagation();
    const s = useEditor.getState();
    const target = rootAncestor(s.doc, object.id);
    s.select([target], { toggle: e.shiftKey || e.ctrlKey || e.metaKey });
  };

  /** Double-click drills into a group and selects this exact shape. */
  const onDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    if (gizmoRecentlyUsed()) return;
    e.stopPropagation();
    useEditor.getState().select([object.id]);
  };

  const active = selected || highlighted;

  return (
    <mesh
      name={object.id}
      userData={{ objectId: object.id }}
      geometry={geometry}
      position={transform.position}
      rotation={[transform.rotation[0] * DEG2RAD, transform.rotation[1] * DEG2RAD, transform.rotation[2] * DEG2RAD]}
      castShadow
      receiveShadow
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
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
      {active && <Edges threshold={20} color="#0b3fb3" lineWidth={selected ? 1.25 : 1} transparent opacity={selected ? 1 : 0.55} />}
    </mesh>
  );
});
