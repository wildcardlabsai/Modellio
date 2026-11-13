import * as THREE from 'three';
import { buildGeometryForShape, buildShapeGeometry } from '@/cad/shapeRegistry';
import { createEmptyDocument, createShape } from '@/cad/document';
import { initKernel } from '@/cad/kernel/kernel';
import { analyzeMesh } from './validate';
import type { ShapeParams, Vec3 } from '@/types/document';

beforeAll(() => initKernel());

const shape = (type: 'box' | 'cylinder' | 'sphere', size: Vec3, params: ShapeParams) => {
  const o = createShape(createEmptyDocument(), type, [0, 0, 0]);
  o.size = size;
  o.params = { ...o.params, ...params };
  return o;
};

describe('hollow (shell)', () => {
  it('box with a 2 mm wall has exactly outer − inner volume and stays watertight', () => {
    const g = buildGeometryForShape(shape('box', [40, 30, 20], { shell: 2 }))!;
    const r = analyzeMesh(g);
    expect(r.watertight).toBe(true);
    expect(r.volume).toBeCloseTo(40 * 30 * 20 - 36 * 26 * 16, 1);
    g.computeBoundingBox();
    expect(
      g
        .boundingBox!.getSize(new THREE.Vector3())
        .toArray()
        .map((v) => +v.toFixed(3)),
    ).toEqual([40, 30, 20]);
  });

  it('open top removes the lid: a 2 mm-walled tray', () => {
    const r = analyzeMesh(buildGeometryForShape(shape('box', [40, 30, 20], { shell: 2, openTop: 1 }))!);
    expect(r.watertight).toBe(true);
    expect(r.volume).toBeCloseTo(40 * 30 * 20 - 36 * 26 * 18, 1);
  });

  it('cylinder cup and hollow sphere are watertight', () => {
    for (const o of [
      shape('cylinder', [30, 30, 40], { shell: 1.5, openTop: 1, segments: 64 }),
      shape('sphere', [30, 30, 30], { shell: 2, segments: 48 }),
    ]) {
      const r = analyzeMesh(buildGeometryForShape(o)!);
      expect(r.watertight).toBe(true);
      expect(r.volume).toBeGreaterThan(0);
    }
  });

  it('a wall too thick to leave a cavity gives the solid shape', () => {
    const r = analyzeMesh(buildGeometryForShape(shape('box', [10, 10, 10], { shell: 6 }))!);
    expect(r.volume).toBeCloseTo(1000, 3);
  });
});

describe('chamfered box', () => {
  it('is watertight, keeps its bounding box, and removes the edge prisms', () => {
    const c = 2;
    const g = buildShapeGeometry('box', [40, 30, 20], { chamfer: c });
    const r = analyzeMesh(g);
    expect(r.watertight).toBe(true);
    g.computeBoundingBox();
    expect(
      g
        .boundingBox!.getSize(new THREE.Vector3())
        .toArray()
        .map((v) => +v.toFixed(3)),
    ).toEqual([40, 30, 20]);
    // Every edge loses a c²/2 triangular prism along its straight part; each corner loses less than c³.
    const edges = 4 * (40 - 2 * c) + 4 * (30 - 2 * c) + 4 * (20 - 2 * c);
    const withoutEdges = 40 * 30 * 20 - (c * c * edges) / 2;
    expect(r.volume).toBeLessThan(withoutEdges);
    expect(r.volume).toBeGreaterThan(withoutEdges - 8 * c * c * c);
    // The top face is inset by the chamfer on every side.
    const pos = g.getAttribute('position');
    let maxTopX = -Infinity;
    for (let i = 0; i < pos.count; i++) if (pos.getZ(i) > 9.999) maxTopX = Math.max(maxTopX, pos.getX(i));
    expect(maxTopX).toBeCloseTo(20 - c, 4);
  });
});
