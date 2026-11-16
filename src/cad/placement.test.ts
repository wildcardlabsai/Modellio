import { createRequire } from 'node:module';
import * as THREE from 'three';
import type * as Replicad from 'replicad';
import { produce } from 'immer';
import { buildBrep } from './brep/build';
import type { BrepBuild, FeatureRecipe } from './brep/types';
import { createEmptyDocument, addObjectDraft, createShape } from './document';
import { initKernel } from './kernel/kernel';
import { bodyTransformOnFrame, faceFrame, frameNormal, planeFrame, sameFrame } from './placement';
import { applyResolutions, resolveFace } from './sketch/attachments';
import { addSketchRecordDraft } from './sketchRecords';
import { placeBodiesDraft, profileAnchor } from './sketchPlacement';
import { worldMatrix } from './hierarchy';
import { migrateDocument, projectFromFile, projectToFile, CURRENT_SCHEMA, PROJECT_FILE_VERSION } from './serialization/project';
import { transformToMatrix } from './transforms/transform';
import type { Frame, ModelDocument, ShapeObject, Vec3 } from '@/types/document';
import type { Sketch } from './sketch/types';

let r: typeof Replicad;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = require.resolve('replicad-opencascadejs/wasm');
  const { default: init } = await import('replicad-opencascadejs');
  const oc = await (init as unknown as (o: { locateFile: () => string }) => Promise<unknown>)({ locateFile: () => wasm });
  r = await import('replicad');
  r.setOC(oc as Parameters<typeof r.setOC>[0]);
  await initKernel();
}, 60000);

const near = (a: number[], b: number[], tol = 1e-6) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(tol));
const boxRecipe: FeatureRecipe = { base: { kind: 'primitive', shape: 'box', params: {} }, ops: [] };
const build = (recipe: FeatureRecipe, size: Vec3): BrepBuild => buildBrep(r, { recipe, size });
/** The flat face whose outward normal is closest to `n`. */
const faceToward = (b: BrepBuild, n: Vec3) =>
  b.faces.map((f, i) => ({ i, d: f.ref.normal[0] * n[0] + f.ref.normal[1] * n[1] + f.ref.normal[2] * n[2] })).sort((p, q) => q.d - p.d)[0]
    .i;
const square = (w: number): Sketch => ({
  points: [
    { id: 'a', x: -w / 2, y: -w / 2 },
    { id: 'b', x: w / 2, y: -w / 2 },
    { id: 'c', x: w / 2, y: w / 2 },
    { id: 'd', x: -w / 2, y: w / 2 },
  ],
  entities: [
    { id: 'l1', kind: 'line', a: 'a', b: 'b' },
    { id: 'l2', kind: 'line', a: 'b', b: 'c' },
    { id: 'l3', kind: 'line', a: 'c', b: 'd' },
    { id: 'l4', kind: 'line', a: 'd', b: 'a' },
  ],
  constraints: [],
});

describe('frames', () => {
  it('reference planes: the three main planes, offset along the normal and tilted about x', () => {
    const xy = planeFrame({ base: 'XY', offset: 5, tilt: 0 });
    near(xy.origin, [0, 0, 5]);
    near(frameNormal(xy), [0, 0, 1]);
    near(frameNormal(planeFrame({ base: 'XZ', offset: 0, tilt: 0 })), [0, -1, 0]);
    near(frameNormal(planeFrame({ base: 'YZ', offset: 0, tilt: 0 })), [1, 0, 0]);
    const tilted = planeFrame({ base: 'XY', offset: 0, tilt: 90 });
    near(tilted.x, [1, 0, 0]);
    near(frameNormal(tilted), [0, -1, 0]);
  });

  it("a box's top face: centred on the face, normal out of the solid, x along the body's X", () => {
    const b = build(boxRecipe, [20, 10, 6]);
    const f = faceFrame(b, faceToward(b, [0, 0, 1]), [20, 10, 6], undefined, new THREE.Matrix4())!;
    near(f.origin, [0, 0, 3]);
    near(frameNormal(f), [0, 0, 1]);
    near(f.x, [1, 0, 0]);
    // A side face: normal +X, x falls back to the body's Y.
    const side = faceFrame(b, faceToward(b, [1, 0, 0]), [20, 10, 6], undefined, new THREE.Matrix4())!;
    near(side.origin, [10, 0, 0]);
    near(frameNormal(side), [1, 0, 0]);
    near(side.x, [0, 1, 0]);
  });

  it('turns and moves with the body', () => {
    const b = build(boxRecipe, [20, 10, 6]);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(5, 0, 0),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
      new THREE.Vector3(1, 1, 1),
    );
    const f = faceFrame(b, faceToward(b, [0, 0, 1]), [20, 10, 6], undefined, m)!;
    near(f.origin, [5, 0, 3]);
    near(f.x, [0, 1, 0]);
  });

  it('a body on a frame: the extrusion grows out along the normal from the sketch', () => {
    const frame: Frame = { origin: [1, 2, 3], x: [0, 1, 0], y: [0, 0, 1] }; // normal +X
    const t = bodyTransformOnFrame(frame, false, [0, 0, 2.5]);
    // The mesh point (0, 0, 0) (sketch origin, base of the extrusion) lands on the frame's origin.
    const world = transformToMatrix(t);
    const p = new THREE.Vector3(0, 0, -2.5).applyMatrix4(world); // centred mesh: subtract the anchor
    near(p.toArray(), [1, 2, 3]);
    const top = new THREE.Vector3(0, 0, 2.5).applyMatrix4(world);
    near(top.toArray(), [6, 2, 3]);
  });
});

/** A design: a 20 × 20 × 10 box at the origin, and a square sketch attached to its top face with a 4 mm extrusion. */
function attachedDesign() {
  let doc: ModelDocument = createEmptyDocument();
  const box = createShape(doc, 'box', [0, 0, 5]);
  box.size = [20, 20, 10];
  const body = createShape(doc, 'profile', [50, 50, 2]);
  body.sketch = square(6);
  body.params = { op: 0, depth: 4, angle: 360 };
  body.size = [6, 6, 4];
  const b = build(boxRecipe, box.size);
  const top = faceToward(b, [0, 0, 1]);
  const frame = faceFrame(b, top, box.size, undefined, transformToMatrix(box.transform))!;
  doc = produce(doc, (d) => {
    addObjectDraft(d, box);
    addObjectDraft(d, body);
    const recId = addSketchRecordDraft(d, body.sketch!, 'Boss');
    (d.objects[body.id] as ShapeObject).sketchId = recId;
    d.sketches![recId].placement = { kind: 'face', objectId: box.id, face: b.faces[top].ref };
    d.sketches![recId].frame = frame;
    placeBodiesDraft(d, recId);
  });
  const recId = (doc.objects[body.id] as ShapeObject).sketchId!;
  return { doc, box, body, recId };
}
/** The face reference a record is attached to. */
const faceOf = (doc: ModelDocument, recId: string) => {
  const p = doc.sketches![recId].placement;
  if (p?.kind !== 'face') throw new Error('not attached to a face');
  return p.face;
};
const bottomOf = (doc: ModelDocument, id: string) => {
  const o = doc.objects[id] as ShapeObject;
  return new THREE.Vector3(0, 0, -o.size[2] / 2).applyMatrix4(worldMatrix(doc, id));
};

describe('sketches attached to faces', () => {
  it('a body made from the sketch stands on the face', () => {
    const { doc, body } = attachedDesign();
    expect(profileAnchor(body)).not.toBeNull();
    near(bottomOf(doc, body.id).toArray(), [0, 0, 10], 1e-3);
  });

  it('follows the face when the body changes (resize), found again by its reference', () => {
    const { doc, box, recId } = attachedDesign();
    const taller = produce(doc, (d) => {
      (d.objects[box.id] as ShapeObject).size = [30, 20, 16];
      d.objects[box.id].transform.position = [0, 0, 8];
    });
    const res = resolveFace(taller, taller.sketches![recId], build(boxRecipe, [30, 20, 16]));
    expect('frame' in res).toBe(true);
    const next = applyResolutions(taller, new Map([[recId, res]]));
    const body = Object.values(next.objects).find((o) => o.kind === 'shape' && o.sketchId === recId)!;
    near(bottomOf(next, body.id).toArray(), [0, 0, 16], 1e-3);
    expect(next.sketches![recId].broken).toBeUndefined();
  });

  it('when the face is gone, the attachment is reported broken and nothing moves', () => {
    const { doc, box, recId } = attachedDesign();
    // Shell the box with its top face open: the face the sketch was on no longer exists.
    const shelled: FeatureRecipe = {
      ...boxRecipe,
      ops: [
        {
          id: 'sh',
          kind: 'shell',
          thickness: 2,
          faces: [faceOf(doc, recId)],
        },
      ],
    };
    const res = resolveFace(doc, doc.sketches![recId], build(shelled, box.size));
    expect(res).toEqual({ broken: expect.stringMatching(/no longer exists/) });
    const next = applyResolutions(doc, new Map([[recId, res]]));
    expect(next.sketches![recId].broken).toMatch(/no longer exists/);
    // Bodies and the last good frame are untouched.
    for (const id of Object.keys(doc.objects)) expect(next.objects[id].transform).toBe(doc.objects[id].transform);
    expect(next.sketches![recId].frame).toEqual(doc.sketches![recId].frame);
  });

  it('a deleted body is reported, not guessed', () => {
    const { doc, box, recId } = attachedDesign();
    const gone = produce(doc, (d) => {
      delete d.objects[box.id];
      d.rootIds = d.rootIds.filter((i) => i !== box.id);
    });
    expect(resolveFace(gone, gone.sketches![recId], build(boxRecipe, box.size))).toEqual({ broken: expect.stringMatching(/deleted/) });
  });
});

describe('schema 3+ files (current schema 4)', () => {
  it('keeps planes, placements and frames through save and reopen', () => {
    expect(CURRENT_SCHEMA).toBe(4);
    expect(PROJECT_FILE_VERSION).toBe(6);
    const { doc, recId } = attachedDesign();
    const withPlane = produce(doc, (d) => {
      d.planes = { p1: { id: 'p1', name: 'Mid', base: 'XZ', offset: 4, tilt: 10, visible: true } };
    });
    const meta = { id: 'p', name: 'P', createdAt: 1, updatedAt: 2, objectCount: 2 };
    const back = projectFromFile(projectToFile({ meta, document: withPlane, assets: {} })).document;
    expect(back.planes).toEqual(withPlane.planes);
    expect(back.sketches![recId]).toEqual(withPlane.sketches![recId]);
    expect(sameFrame(back.sketches![recId].frame, withPlane.sketches![recId].frame)).toBe(true);
  });

  it('upgrades a schema 2 document (no planes, unplaced sketches) and drops malformed placements', () => {
    const { doc, recId } = attachedDesign();
    const raw = JSON.parse(JSON.stringify(doc));
    raw.schemaVersion = 2;
    delete raw.planes;
    const v2 = JSON.parse(JSON.stringify(raw));
    for (const r of Object.values(v2.sketches) as { placement?: unknown; frame?: unknown }[]) {
      delete r.placement;
      delete r.frame;
    }
    const up = migrateDocument(v2);
    expect(up.schemaVersion).toBe(CURRENT_SCHEMA);
    expect(up.planes).toEqual({});
    expect(up.sketches![recId].placement).toBeUndefined();
    raw.sketches[recId].placement = { kind: 'plane', planeId: 'missing' };
    expect(migrateDocument(raw).sketches![recId].placement).toBeUndefined();
    raw.sketches[recId].placement = {
      kind: 'face',
      objectId: 'gone',
      face: faceOf(doc, recId),
    };
    // A face placement whose body is missing is kept, to be reported as broken.
    expect(migrateDocument(raw).sketches![recId].placement).toMatchObject({ kind: 'face', objectId: 'gone' });
  });
});
