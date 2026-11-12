import * as THREE from 'three';
import { SHAPES, buildShapeGeometry } from '@/cad/shapeRegistry';
import { analyzeMesh } from './validate';
import type { Vec3 } from '@/types/document';

const sizes: Vec3[] = [
  [20, 20, 20],
  [180, 80, 60],
  [5, 33.3, 0.5],
];

describe('primitive geometry', () => {
  for (const def of SHAPES) {
    describe(def.type, () => {
      for (const size of sizes) {
        it(`has an exact ${size.join('×')} mm bounding box centred on the origin`, () => {
          const g = buildShapeGeometry(def.type, size, def.defaultParams);
          g.computeBoundingBox();
          const ext = g.boundingBox!.getSize(new THREE.Vector3());
          const c = g.boundingBox!.getCenter(new THREE.Vector3());
          expect(ext.x).toBeCloseTo(size[0], 3);
          expect(ext.y).toBeCloseTo(size[1], 3);
          expect(ext.z).toBeCloseTo(size[2], 3);
          expect(c.length()).toBeLessThan(1e-4);
          g.dispose();
        });
      }

      it('is a closed, consistently oriented (watertight) mesh with positive volume', () => {
        const g = buildShapeGeometry(def.type, [20, 20, 20], def.defaultParams);
        const r = analyzeMesh(g);
        expect(r.boundaryEdges).toBe(0);
        expect(r.nonManifoldEdges).toBe(0);
        expect(r.watertight).toBe(true);
        expect(r.volume).toBeGreaterThan(0);
        g.dispose();
      });

      it('has unit-length normals for every vertex', () => {
        const g = buildShapeGeometry(def.type, [30, 10, 5], def.defaultParams);
        const n = g.getAttribute('normal');
        expect(n).toBeDefined();
        for (let i = 0; i < n.count; i++) {
          const len = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
          expect(len).toBeCloseTo(1, 3);
        }
        g.dispose();
      });
    });
  }

  it('produces analytically correct volumes', () => {
    const box = analyzeMesh(buildShapeGeometry('box', [10, 20, 30], {}));
    expect(box.volume).toBeCloseTo(6000, 3);
    const cyl = analyzeMesh(buildShapeGeometry('cylinder', [20, 20, 10], { segments: 256 }));
    expect(cyl.volume).toBeCloseTo(Math.PI * 100 * 10, -1); // within ~1%
    const pyr = analyzeMesh(buildShapeGeometry('pyramid', [10, 10, 30], {}));
    expect(pyr.volume).toBeCloseTo(1000, 3);
    const wedge = analyzeMesh(buildShapeGeometry('wedge', [10, 10, 10], {}));
    expect(wedge.volume).toBeCloseTo(500, 3);
  });

  it('respects absolute tube wall thickness', () => {
    const g = buildShapeGeometry('tube', [40, 40, 10], { segments: 256, wall: 5 });
    const v = analyzeMesh(g).volume;
    expect(v).toBeCloseTo(Math.PI * (20 * 20 - 15 * 15) * 10, -1);
  });

  it('clamps zero/negative sizes to a valid minimum instead of producing NaN', () => {
    const g = buildShapeGeometry('box', [0, -5, 10], {});
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(Number.isFinite(p.getX(i))).toBe(true);
  });
});
