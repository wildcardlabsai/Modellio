import { useMemo } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import type { ShapeObject } from '@/types/document';
import { DEG2RAD, formatMm } from '@/utils/math';
import { worldBounds } from '@/cad/transforms/transform';

interface Props {
  object: ShapeObject;
  showDimensions: boolean;
}

const label =
  'pointer-events-none whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums shadow-sm text-white';

/**
 * Oriented bounding box of the primary selection with live X/Y/Z dimension
 * read-outs and an elevation indicator when the object is lifted off the plate.
 */
export function SelectionOverlay({ object, showDimensions }: Props) {
  const { size, transform } = object;
  const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];

  // All 12 box edges as one segments object (a single draw call).
  const edges = useMemo(() => {
    const c = (x: number, y: number, z: number) => [x * hx, y * hy, z * hz] as [number, number, number];
    const pts: [number, number, number][] = [];
    const corners = [-1, 1];
    for (const y of corners) for (const z of corners) pts.push(c(-1, y, z), c(1, y, z));
    for (const x of corners) for (const z of corners) pts.push(c(x, -1, z), c(x, 1, z));
    for (const x of corners) for (const y of corners) pts.push(c(x, y, -1), c(x, y, 1));
    return pts;
  }, [hx, hy, hz]);

  const bounds = useMemo(() => worldBounds(object), [object]);
  const elevation = bounds.min.z;
  const rotation = new THREE.Euler(transform.rotation[0] * DEG2RAD, transform.rotation[1] * DEG2RAD, transform.rotation[2] * DEG2RAD);

  return (
    <>
      <group position={transform.position} rotation={rotation}>
        <Line points={edges} segments color="#2463eb" lineWidth={1.5} transparent opacity={0.85} depthTest={false} renderOrder={10} />
        {showDimensions && (
          <>
            <Html position={[0, -hy, -hz]} center zIndexRange={[20, 0]}>
              <div className={`${label} bg-axis-x`}>{formatMm(size[0])}</div>
            </Html>
            <Html position={[hx, 0, -hz]} center zIndexRange={[20, 0]}>
              <div className={`${label} bg-axis-y`}>{formatMm(size[1])}</div>
            </Html>
            <Html position={[hx, -hy, 0]} center zIndexRange={[20, 0]}>
              <div className={`${label} bg-axis-z`}>{formatMm(size[2])}</div>
            </Html>
          </>
        )}
      </group>
      {showDimensions && Math.abs(elevation) > 0.005 && (
        <group>
          <Line
            points={[
              [bounds.min.x, bounds.min.y, 0],
              [bounds.min.x, bounds.min.y, bounds.min.z],
            ]}
            color="#101828"
            lineWidth={1}
            dashed
            dashSize={1.5}
            gapSize={1}
          />
          <Html position={[bounds.min.x, bounds.min.y, bounds.min.z / 2]} center zIndexRange={[20, 0]}>
            <div className={`${label} bg-navy/85`}>↕ {formatMm(elevation)}</div>
          </Html>
        </group>
      )}
    </>
  );
}
