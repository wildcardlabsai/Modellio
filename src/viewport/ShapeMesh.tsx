import { memo, useEffect, useMemo, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import type { ShapeObject } from '@/types/document';
import { buildShapeGeometry } from '@/cad/shapeRegistry';
import { useEditor } from '@/store/editorStore';
import { gizmoRecentlyUsed } from './viewportBridge';
import { DEG2RAD } from '@/utils/math';

interface Props {
  object: ShapeObject;
  selected: boolean;
}

/**
 * Renders one document shape. Geometry is (re)generated from the CAD engine
 * only when shape type, size or parameters change, and the previous geometry
 * is disposed so GPU memory is released.
 */
export const ShapeMesh = memo(function ShapeMesh({ object, selected }: Props) {
  const { shape, size, params, transform, color, visible } = object;
  const sizeKey = size.join(',');
  const paramKey = JSON.stringify(params);
  const geometry = useMemo(
    () => buildShapeGeometry(shape, size, params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape, sizeKey, paramKey],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  const [hovered, setHovered] = useState(false);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    // Ignore clicks that ended a camera orbit or a gizmo drag.
    if (e.delta > 4 || gizmoRecentlyUsed()) return;
    e.stopPropagation();
    const multi = e.shiftKey || e.ctrlKey || e.metaKey;
    useEditor.getState().select([object.id], { toggle: multi });
  };

  if (!visible) return null;

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
        emissiveIntensity={hovered && !selected ? 0.12 : 0}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
      {selected && <Edges threshold={20} color="#0b3fb3" lineWidth={1.25} />}
    </mesh>
  );
});
