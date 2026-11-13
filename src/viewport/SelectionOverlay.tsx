import { useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { usePublishLabels, type Label } from './labels';
import type { ModelDocument, ObjectId } from '@/types/document';
import { formatMm } from '@/utils/math';
import { groupLocalBounds, worldBoundsOf, worldMatrix } from '@/cad/hierarchy';

interface Props {
  doc: ModelDocument;
  id: ObjectId;
  showDimensions: boolean;
}

const label = 'pointer-events-none whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums shadow-sm text-white';

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
    const xs = [min.x, max.x],
      ys = [min.y, max.y],
      zs = [min.z, max.z];
    const pts: [number, number, number][] = [];
    for (const y of ys) for (const z of zs) pts.push([min.x, y, z], [max.x, y, z]);
    for (const x of xs) for (const z of zs) pts.push([x, min.y, z], [x, max.y, z]);
    for (const x of xs) for (const y of ys) pts.push([x, y, min.z], [x, y, max.z]);
    return pts;
  }, [box]);

  const world = useMemo(() => worldBoundsOf(doc, [id]), [doc, id]);
  const isGroup = o.kind === 'group';

  // Dimension and elevation labels (world positions; offset in pixels off the edges/handles).
  const labels = useMemo<Label[] | null>(() => {
    if (!showDimensions || box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(matrix).toArray() as [number, number, number];
    const out: Label[] = [
      {
        key: `${id}:x`,
        position: at(c.x, box.min.y, box.min.z),
        offset: [0, 18],
        content: <div className={`${label} bg-axis-x`}>{formatMm(size.x)}</div>,
      },
      {
        key: `${id}:y`,
        position: at(box.max.x, c.y, box.min.z),
        offset: [30, 0],
        content: <div className={`${label} bg-axis-y`}>{formatMm(size.y)}</div>,
      },
      {
        key: `${id}:z`,
        position: at(box.max.x, box.min.y, c.z),
        offset: [30, 0],
        content: <div className={`${label} bg-axis-z`}>{formatMm(size.z)}</div>,
      },
    ];
    if (Math.abs(world.min.z) > 0.005) {
      out.push({
        key: `${id}:elev`,
        position: [world.min.x, world.min.y, world.min.z / 2],
        content: <div className={`${label} bg-navy/85`}>↕ {formatMm(world.min.z)}</div>,
      });
    }
    return out;
  }, [showDimensions, box, matrix, world, id]);
  usePublishLabels(`sel:${id}`, labels);

  if (box.isEmpty()) return null;
  const elevation = world.min.z;

  return (
    <>
      <group matrix={matrix} matrixAutoUpdate={false} userData={{ noThumbnail: true }}>
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
      </group>
      {showDimensions && Math.abs(elevation) > 0.005 && (
        <Line
          userData={{ noThumbnail: true }}
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
      )}
    </>
  );
}
