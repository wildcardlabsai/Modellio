import { forwardRef, useEffect, useLayoutEffect, useMemo, useState, type ComponentProps } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Line2, LineGeometry, LineMaterial, LineSegments2, LineSegmentsGeometry } from 'three-stdlib';

type Point = [number, number, number];

/**
 * Line materials are pooled rather than disposed: disposing the last material that uses a
 * shader frees the compiled program, so the next selection outline would compile it again.
 */
const pool: LineMaterial[] = [];
function acquireMaterial(): LineMaterial {
  return pool.pop() ?? new LineMaterial();
}
function releaseMaterial(m: LineMaterial) {
  if (pool.length < 64) pool.push(m);
  else m.dispose();
}

/** Edge lines of a geometry (cached per geometry and angle), as segment endpoints. */
const edgeCache = new WeakMap<THREE.BufferGeometry, Map<number, Point[]>>();
function edgePoints(geometry: THREE.BufferGeometry, threshold: number): Point[] {
  let byAngle = edgeCache.get(geometry);
  if (!byAngle) edgeCache.set(geometry, (byAngle = new Map()));
  let pts = byAngle.get(threshold);
  if (!pts) {
    const e = new THREE.EdgesGeometry(geometry, threshold);
    const a = e.getAttribute('position').array;
    pts = [];
    for (let i = 0; i < a.length; i += 3) pts.push([a[i], a[i + 1], a[i + 2]]);
    e.dispose();
    byAngle.set(threshold, pts);
  }
  return pts;
}

/** Outline edges for a mesh (place as a child of the mesh). Replaces drei's `<Edges>`. */
export function FastEdges({
  geometry,
  threshold = 20,
  ...line
}: { geometry: THREE.BufferGeometry; threshold?: number } & Omit<Props, 'points' | 'segments'>) {
  const points = useMemo(() => edgePoints(geometry, threshold), [geometry, threshold]);
  if (!points.length) return null;
  return <FastLine points={points} segments {...line} />;
}

interface Props extends Omit<ComponentProps<'primitive'>, 'object'> {
  points: Point[];
  segments?: boolean;
  color?: string;
  lineWidth?: number;
  dashed?: boolean;
  dashSize?: number;
  gapSize?: number;
  transparent?: boolean;
  opacity?: number;
  depthTest?: boolean;
}

/**
 * A fat line (like drei's `<Line>`) whose material lives as long as the component.
 *
 * drei's Line disposes its material whenever its points change, which throws away the
 * compiled shader; during a drag the selection outline changes every frame, so the shader
 * was recompiled on every mouse move (~100 ms each). Here only the geometry is rebuilt.
 */
export const FastLine = forwardRef<Line2 | LineSegments2, Props>(function FastLine(
  {
    points,
    segments,
    color = '#ffffff',
    lineWidth = 1,
    dashed,
    dashSize = 1,
    gapSize = 1,
    transparent,
    opacity = 1,
    depthTest = true,
    ...rest
  },
  ref,
) {
  const size = useThree((s) => s.size);
  const line = useMemo(() => (segments ? new LineSegments2() : new Line2()), [segments]);
  const [material] = useState(acquireMaterial);
  const geometry = useMemo(() => {
    const g = segments ? new LineSegmentsGeometry() : new LineGeometry();
    g.setPositions(points.flat());
    return g;
  }, [points, segments]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => releaseMaterial(material), [material]);
  useLayoutEffect(() => {
    line.geometry = geometry;
    if (dashed) line.computeLineDistances();
  }, [line, geometry, dashed]);
  useLayoutEffect(() => {
    if (dashed) material.defines.USE_DASH = '';
    else delete material.defines.USE_DASH;
    material.needsUpdate = true;
  }, [dashed, material]);
  useLayoutEffect(() => {
    material.color.set(color);
    material.linewidth = lineWidth;
    material.dashed = !!dashed;
    material.dashSize = dashSize;
    material.gapSize = gapSize;
    material.transparent = !!transparent;
    material.opacity = opacity;
    material.depthTest = depthTest;
    material.resolution.set(size.width, size.height);
  }, [material, color, lineWidth, dashed, dashSize, gapSize, transparent, opacity, depthTest, size.width, size.height]);
  useLayoutEffect(() => {
    line.material = material;
  }, [line, material]);
  // Helpers never take part in picking.
  return <primitive object={line} ref={ref} raycast={() => null} {...rest} />;
});
