import { useMemo } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import type { ModelDocument, ObjectId } from '@/types/document';
import { formatMm } from '@/utils/math';
import { groupLocalBounds, worldBoundsOf, worldMatrix } from '@/cad/hierarchy';

interface Props {
  doc: ModelDocument;
  id: ObjectId;
  showDimensions: boolean;
}

const label =
  'pointer-events-none whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums shadow-sm text-white';

/**
 * Oriented bounding box of a selected shape or group, with live X/Y/Z
 * dimensions (in the object's own frame) and an elevation indicator when the
 * object is lifted off the plate.
 */
export function SelectionOverlay({ doc, id, showDimensions }: Props) {
  const o = doc.objects[id];
  const { matrix, box } = useMemo(() => {
    const m = worldMatrix(doc, id);
    if (o.kind === 'shape') {
      const h = new THREE.Vector3(...o.size).multiplyScalar(0.5);
      return { matrix: m, box: new THREE.Box3(h.clone().negate(), h) };
    }
    return { matrix: m, box: groupLocalBounds(doc, id) };
  }, [doc, id, o]);

  const edges = useMemo(() => {
    const { min, max } = box;
    const xs = [min.x, max.x], ys = [min.y, max.y], zs = [min.z, max.z];
    const pts: [number, number, number][] = [];
    for (const y of ys) for (const z of zs) pts.push([min.x, y, z], [max.x, y, z]);
    for (const x of xs) for (const z of zs) pts.push([x, min.y, z], [x, max.y, z]);
    for (const x of xs) for (const y of ys) pts.push([x, y, min.z], [x, y, max.z]);
    return pts;
  }, [box]);

  const world = useMemo(() => worldBoundsOf(doc, [id]), [doc, id]);
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const elevation = world.min.z;
  const isGroup = o.kind === 'group';

  return (
    <>
      <group matrix={matrix} matrixAutoUpdate={false}>
        <Line
          points={edges}
          segments
          color="#2463eb"
          lineWidth={1.5}
          dashed={isGroup}
          dashSize={3}
          gapSize={2}
          transparent
          opacity={0.85}
          depthTest={false}
          renderOrder={10}
        />
        {showDimensions && (
          <>
            <Html position={[c.x, box.min.y, box.min.z]} center zIndexRange={[20, 0]}>
              <div className={`${label} bg-axis-x`}>{formatMm(size.x)}</div>
            </Html>
            <Html position={[box.max.x, c.y, box.min.z]} center zIndexRange={[20, 0]}>
              <div className={`${label} bg-axis-y`}>{formatMm(size.y)}</div>
            </Html>
            <Html position={[box.max.x, box.min.y, c.z]} center zIndexRange={[20, 0]}>
              <div className={`${label} bg-axis-z`}>{formatMm(size.z)}</div>
            </Html>
          </>
        )}
      </group>
      {showDimensions && Math.abs(elevation) > 0.005 && (
        <group>
          <Line
            points={[
              [world.min.x, world.min.y, 0],
              [world.min.x, world.min.y, world.min.z],
            ]}
            color="#101828"
            lineWidth={1}
            dashed
            dashSize={1.5}
            gapSize={1}
          />
          <Html position={[world.min.x, world.min.y, world.min.z / 2]} center zIndexRange={[20, 0]}>
            <div className={`${label} bg-navy/85`}>↕ {formatMm(elevation)}</div>
          </Html>
        </group>
      )}
    </>
  );
}
