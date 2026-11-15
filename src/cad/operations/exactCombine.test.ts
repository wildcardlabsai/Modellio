import { createRequire } from 'node:module';
import * as THREE from 'three';
import { produce } from 'immer';
import type * as Replicad from 'replicad';
import type { ModelDocument, ObjectId, ShapeObject, Vec3 } from '@/types/document';
import { addObjectDraft, createEmptyDocument, createShape } from '../document';
import { groupDraft, worldMatrix } from '../hierarchy';
import { initKernel } from '../kernel/kernel';
import { buildBrep } from '../brep/build';
import { meshMeasures } from './meshTools';
import { computeCombined, exactBooleanBase, exactCombineRequest, setBooleanSync, solidFromGroupDraft } from './combine';

let r: typeof Replicad;
beforeAll(async () => {
  await initKernel();
  setBooleanSync(true);
  const require = createRequire(import.meta.url);
  const wasm = require.resolve('replicad-opencascadejs/wasm');
  const { default: init } = await import('replicad-opencascadejs');
  const oc = await (init as unknown as (o: { locateFile: () => string }) => Promise<unknown>)({ locateFile: () => wasm });
  r = await import('replicad');
  r.setOC(oc as Parameters<typeof r.setOC>[0]);
}, 60000);

function design(specs: { type?: ShapeObject['shape']; pos: Vec3; size?: Vec3; hole?: boolean; rot?: Vec3 }[]): ModelDocument {
  let doc = createEmptyDocument();
  const ids: ObjectId[] = [];
  for (const s of specs) {
    const o = createShape(doc, s.type ?? 'box', s.pos);
    if (s.size) o.size = s.size;
    if (s.rot) o.transform.rotation = s.rot;
    o.isHole = !!s.hole;
    ids.push(o.id);
    doc = produce(doc, (d) => addObjectDraft(d, o));
  }
  return produce(doc, (d) => {
    groupDraft(d, ids, { id: 'g', name: 'Plate' });
    (d.objects.g as { combine?: string }).combine = 'union';
  });
}

describe('exact combinations of document groups', () => {
  // A plate with a tilted, off-centre cylinder hole through it.
  const doc = design([
    { pos: [5, 0, 5], size: [40, 30, 10] },
    { type: 'cylinder', pos: [12, 4, 5], size: [6, 6, 30], hole: true, rot: [20, 0, 0] },
  ]);

  it('builds the true volume, matching the mesh Boolean within faceting', () => {
    const x = exactCombineRequest(doc, 'g');
    expect('req' in x).toBe(true);
    const exact = buildBrep(r, (x as { req: Parameters<typeof buildBrep>[1] }).req);
    const mesh = computeCombined(doc, 'g')!;
    const meshVol = meshMeasures(mesh.mesh!).volume;
    // Exact: a Ø6 hole tilted 20° through a 10 mm plate removes π·3²·10 / cos 20°.
    expect(exact.volume).toBeCloseTo(12000 - (Math.PI * 9 * 10) / Math.cos((20 * Math.PI) / 180), 4);
    // The mesh result agrees within faceting (its polygonal hole removes a little less).
    expect(meshVol).toBeGreaterThan(exact.volume);
    expect(Math.abs(exact.volume - meshVol) / exact.volume).toBeLessThan(0.002);
  });

  it('becomes one precise solid in exactly the same place', () => {
    const x = exactCombineRequest(doc, 'g') as { req: Parameters<typeof buildBrep>[1] };
    const build = buildBrep(r, x.req);
    let id: ObjectId | null = null;
    const next = produce(doc, (d) => {
      id = solidFromGroupDraft(d, 'g', x.req.recipe.base as never, build);
    });
    const solid = next.objects[id!] as ShapeObject;
    expect(solid.shape).toBe('solid');
    expect(next.objects.g).toBeUndefined();
    // Its box in the world matches the combination's box in the world.
    const groupBox = computeCombined(doc, 'g')!.bounds.clone().applyMatrix4(worldMatrix(doc, 'g'));
    const half = new THREE.Vector3(...solid.size).multiplyScalar(0.5);
    const centre = new THREE.Vector3(...solid.transform.position);
    expect(centre.distanceTo(groupBox.getCenter(new THREE.Vector3()))).toBeLessThan(0.05);
    expect(half.clone().multiplyScalar(2).distanceTo(groupBox.getSize(new THREE.Vector3()))).toBeLessThan(0.1);
  });

  it('says why a group cannot be exact', () => {
    const withText = produce(doc, (d) => {
      const t = createShape(d, 'text', [0, 0, 5]);
      t.text = { content: 'Hi', font: 'inter' } as ShapeObject['text'];
      addObjectDraft(d, t);
      (d.objects.g as { children: string[] }).children.push(t.id);
      d.objects[t.id].parentId = 'g';
      d.rootIds = d.rootIds.filter((i) => i !== t.id);
    });
    const b = exactBooleanBase(withText, 'g');
    expect('why' in b && b.why).toMatch(/Text/);
  });
});
