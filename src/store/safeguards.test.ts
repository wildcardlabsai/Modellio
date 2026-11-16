import { useEditor } from './editorStore';
import { createEmptyDocument } from '@/cad/document';
import { initKernel } from '@/cad/kernel/kernel';
import { guardSketchBodies } from '@/cad/sketchBodies';
import { scaleSketch } from '@/cad/sketch/edit';
import { splineIssues } from '@/cad/sketch/splineCheck';
import { solveSketch } from '@/cad/sketch/solver';
import { sketchUsers } from '@/cad/sketchRecords';
import type { Sketch } from '@/cad/sketch/types';
import type { ShapeObject, Vec3 } from '@/types/document';

const S = () => useEditor.getState();
const rect = (w: number, h: number): Sketch => ({
  points: [
    { id: 'a', x: 0, y: 0, fixed: true },
    { id: 'b', x: w, y: 0 },
    { id: 'c', x: w, y: h },
    { id: 'd', x: 0, y: h },
  ],
  entities: [
    { id: 'l1', kind: 'line', a: 'a', b: 'b' },
    { id: 'l2', kind: 'line', a: 'b', b: 'c' },
    { id: 'l3', kind: 'line', a: 'c', b: 'd' },
    { id: 'l4', kind: 'line', a: 'd', b: 'a' },
  ],
  constraints: [
    { id: 'h1', kind: 'horizontal', line: 'l1' },
    { id: 'v1', kind: 'vertical', line: 'l2' },
    { id: 'h2', kind: 'horizontal', line: 'l3' },
    { id: 'v2', kind: 'vertical', line: 'l4' },
    { id: 'w', kind: 'distance', line: 'l1', value: w },
    { id: 'ht', kind: 'distance', line: 'l2', value: h },
  ],
});
/** A single cubic Bézier from (0,0) to (1,0) with the given handles, closed by a line. */
const spline = (c1: [number, number], c2: [number, number]): Sketch => ({
  points: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 1, y: 0 },
    { id: 'h1', x: c1[0], y: c1[1] },
    { id: 'h2', x: c2[0], y: c2[1] },
  ],
  entities: [
    { id: 's', kind: 'bezier', a: 'a', b: 'b', c1: 'h1', c2: 'h2' },
    { id: 'l', kind: 'line', a: 'b', b: 'a' },
  ],
  constraints: [],
});

beforeAll(async () => {
  await initKernel();
});
beforeEach(() => {
  S().loadDocument(createEmptyDocument());
  S().clearBlockedResize();
});

describe('bodies controlled by a sketch', () => {
  const make = async () => (await S().saveSketch(null, rect(40, 20), { kind: 'extrude', depth: 5, angle: 360 }))!;
  const body = (id: string) => S().doc.objects[id] as ShapeObject;

  it('refuses stretching the outline, explains why, and changes nothing', async () => {
    const id = await make();
    const before = S().doc;
    S().setSize(id, [60, 20, 5]);
    expect(S().doc).toBe(before);
    expect(S().blockedResize).toMatchObject({ objectId: id, bodies: [id], size: [60, 20, 5] });
  });

  it('a new height on an extruded body becomes its depth (it still matches the sketch)', async () => {
    const id = await make();
    S().setSize(id, [40, 20, 12]);
    expect(body(id).size).toEqual([40, 20, 12]);
    expect(body(id).params.depth).toBe(12);
    expect(S().blockedResize).toBeNull();
    S().undo();
    expect(body(id).params.depth).toBe(5);
  });

  it("refuses a revolve's height and a group scale that would stretch a sketched body", async () => {
    const id = (await S().saveSketch(null, rect(10, 20), { kind: 'revolve', depth: 5, angle: 360 }))!;
    S().setSize(id, [body(id).size[0], body(id).size[1], 30]);
    expect(S().blockedResize?.objectId).toBe(id);
    S().clearBlockedResize();
    const box = S().addShape('box');
    S().select([id, box]);
    S().groupSelected();
    const g = body(id).parentId!;
    const before = S().doc;
    S().setGroupSize(g, [100, 100, 100]);
    expect(S().doc).toBe(before);
    expect(S().blockedResize).toMatchObject({ objectId: g, bodies: [id] });
    expect(S().blockedResize?.size).toBeUndefined();
  });

  it('“Make independent and resize” gives it its own scaled sketch, in one undo step', async () => {
    const id = await make();
    const shared = body(id).sketchId!;
    await S().resizeIndependent(id, [60, 30, 8]);
    const b = body(id);
    expect(b.sketchId).not.toBe(shared);
    expect(sketchUsers(S().doc, shared)).toHaveLength(0);
    (b.size as Vec3).forEach((v, i) => expect(v).toBeCloseTo([60, 30, 8][i], 6));
    // Uniform scaling keeps the dimensions, rescaled.
    expect(b.sketch!.constraints.find((c) => c.id === 'w')).toMatchObject({ value: 60 });
    expect(solveSketch(b.sketch!).status.kind).not.toBe('conflicting');
    S().undo();
    expect(body(id).sketchId).toBe(shared);
    expect(body(id).size).toEqual([40, 20, 5]);
  });

  it('scaling unevenly removes the dimensions that no longer hold, and names them', () => {
    const r = scaleSketch(rect(40, 20), 2, 1);
    expect(r.dropped).toEqual(['Length 40.00 mm']);
    expect(r.sketch.constraints.map((c) => c.id)).toEqual(['h1', 'v1', 'h2', 'v2', 'ht']);
  });

  it('a rebuild (new sketch or depth) is not a stretch', async () => {
    const id = await make();
    const prev = S().doc;
    await S().saveSketch(id, rect(50, 20), { kind: 'extrude', depth: 5, angle: 360 });
    expect(guardSketchBodies(prev, S().doc).blocked).toBeNull();
    expect(body(id).size[0]).toBeCloseTo(50, 6);
  });
});

describe('spline validity', () => {
  it('a well-shaped spline has no problems', () => {
    expect(splineIssues(spline([0.3, 0.6], [0.7, 0.6]))).toEqual([]);
  });
  it('finds a cusp (the curve stops and turns back) and a loop', () => {
    // Handles crossed exactly: B′(½) = 0.
    expect(splineIssues(spline([1, 0.6], [0, 0.6])).map((i) => i.kind)).toEqual(['cusp']);
    expect(splineIssues(spline([1.6, 0.8], [-0.6, 0.8])).map((i) => i.kind)).toEqual(['self-crossing']);
  });
  it('finds folded and flat smooth joins', () => {
    const s: Sketch = {
      points: [
        { id: 'p', x: 0, y: 0 },
        { id: 'h1', x: 1, y: 1 },
        { id: 'h2', x: 1, y: 0.5 },
        { id: 'h3', x: 0, y: 0 },
      ],
      entities: [],
      constraints: [
        { id: 'k1', kind: 'smooth', point: 'p', h1: 'h1', h2: 'h2' },
        { id: 'k2', kind: 'smooth', point: 'p', h1: 'h1', h2: 'h3' },
      ],
    };
    expect(splineIssues(s).map((i) => i.kind)).toEqual(['folded-join', 'flat-handle']);
  });
  it('the smooth constraint puts handles on opposite sides (a fold is not "solved")', () => {
    const s: Sketch = {
      points: [
        { id: 'p', x: 0, y: 0, fixed: true },
        { id: 'h1', x: 2, y: 0.2, fixed: true },
        { id: 'h2', x: 2, y: -0.2 },
      ],
      entities: [],
      constraints: [{ id: 'k', kind: 'smooth', point: 'p', h1: 'h1', h2: 'h2' }],
    };
    const r = solveSketch(s).sketch;
    const h2 = r.points.find((q) => q.id === 'h2')!;
    expect(h2.x).toBeLessThan(0);
    expect(Math.abs(h2.y * 2 - 0.2 * h2.x)).toBeLessThan(1e-6); // on the line through h1 and p
  });
  it('a tangent join carries straight on rather than doubling back', () => {
    const s: Sketch = {
      points: [
        { id: 'a', x: -5, y: 0, fixed: true },
        { id: 'p', x: 0, y: 0, fixed: true },
        { id: 'h1', x: -1, y: 0.5 },
        { id: 'h2', x: 3, y: 2 },
        { id: 'b', x: 4, y: 3, fixed: true },
      ],
      entities: [
        { id: 'l', kind: 'line', a: 'a', b: 'p' },
        { id: 's', kind: 'bezier', a: 'p', b: 'b', c1: 'h1', c2: 'h2' },
      ],
      constraints: [{ id: 't', kind: 'tangent', e1: 'l', e2: 's', at: 'p' }],
    };
    const h1 = solveSketch(s).sketch.points.find((q) => q.id === 'h1')!;
    expect(h1.x).toBeGreaterThan(0);
    expect(Math.abs(h1.y)).toBeLessThan(1e-6);
  });
  it('a sketch with spline problems is not built', async () => {
    const r = await S().saveSketch(null, spline([1, 0.6], [0, 0.6]), { kind: 'extrude', depth: 2, angle: 360 });
    expect(r).toBeNull();
    expect(Object.keys(S().doc.objects)).toHaveLength(0);
  });
});
