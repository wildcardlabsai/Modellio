import { produce } from 'immer';
import { addObjectDraft, createEmptyDocument, createShape } from '../document';
import { collectExportBodies } from '../export/collect';
import { analyzePrintability, findOverhangs, findThinWalls } from './printability';
import type { ModelDocument, ShapeObject, Vec3 } from '@/types/document';
import { geometryToMeshData } from '../kernel/meshData';
import { buildShapeGeometry } from '../shapeRegistry';

function doc(...shapes: { type?: ShapeObject['shape']; size: Vec3; pos: Vec3; rot?: Vec3 }[]): ModelDocument {
  let d = createEmptyDocument();
  for (const s of shapes) {
    const o = createShape(d, s.type ?? 'box', s.pos);
    o.size = s.size;
    if (s.rot) o.transform.rotation = s.rot;
    d = produce(d, (dr) => addObjectDraft(dr, o));
  }
  return d;
}

const report = (d: ModelDocument, minWall = 0.8) =>
  analyzePrintability(collectExportBodies(d).bodies, { overhangAngle: 45, minWall, plate: [200, 200] });

describe('printability', () => {
  it('a box on the plate is fine', () => {
    const r = report(doc({ size: [20, 20, 20], pos: [0, 0, 10] }));
    expect(r.issues).toEqual([{ level: 'ok', text: expect.stringContaining('Looks printable') }]);
  });

  it('a lifted box is floating and its whole bottom is an overhang', () => {
    const r = report(doc({ size: [20, 10, 5], pos: [0, 0, 12.5] }));
    expect(r.bodies[0].floating).toBe(true);
    expect(r.bodies[0].overhangArea).toBeCloseTo(200, 3);
    expect(r.issues.map((i) => i.level)).toContain('warning');
  });

  it('respects the overhang angle: 30° slopes are fine at 45°, 60° slopes are not', () => {
    const tri = (deg: number) => {
      // one downward triangle tilted `deg` from horizontal, lifted off the bed
      const s = Math.sin((deg * Math.PI) / 180),
        c = Math.cos((deg * Math.PI) / 180);
      return { positions: new Float32Array([0, 0, 10, 0, 10, 10, 10 * c, 0, 10 + 10 * s]), indices: new Uint32Array([0, 1, 2]) };
    };
    // facing down: normal z = −cos(tilt from horizontal)
    expect(findOverhangs(tri(30), 45).tris).toHaveLength(1); // 30° from horizontal = 60° from vertical → overhang
    expect(findOverhangs(tri(60), 45).tris).toHaveLength(0); // 60° from horizontal → printable
  });

  it('measures wall thickness and flags thin walls', () => {
    const thin = geometryToMeshData(buildShapeGeometry('box', [30, 30, 0.5], {}));
    const r = findThinWalls(thin, 0.8);
    expect(r.thinnest).toBeCloseTo(0.5, 2);
    expect(r.tris.length).toBeGreaterThan(0);
    const thick = findThinWalls(geometryToMeshData(buildShapeGeometry('box', [30, 30, 5], {})), 0.8);
    expect(thick.tris).toHaveLength(0);
  });

  it('reports parts below or outside the plate', () => {
    const r = report(doc({ size: [20, 20, 20], pos: [195, 0, 5] }));
    expect(r.offPlate).toBe(true);
    expect(r.bodies[0].belowPlate).toBe(true);
    expect(r.issues.filter((i) => i.level === 'error')).toHaveLength(2);
  });
});
