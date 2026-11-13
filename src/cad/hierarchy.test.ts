import * as THREE from 'three';
import { produce } from 'immer';
import type { ModelDocument, ObjectId, ShapeObject, Vec3 } from '@/types/document';
import { addObjectDraft, createEmptyDocument, createShape } from './document';
import {
  alignDraft,
  canScaleNonUniform,
  distributeDraft,
  dropToWorkplaneDraft,
  groupDraft,
  groupLocalBounds,
  mirrorDraft,
  moveObjectsDraft,
  scaleGroupDraft,
  topLevel,
  ungroupDraft,
  worldBoundsOf,
  worldMatrix,
} from './hierarchy';
import { buildShapeGeometry } from './shapeRegistry';
import { analyzeMesh } from './geometry/validate';

function docWith(...specs: { type?: ShapeObject['shape']; pos: Vec3; rot?: Vec3; size?: Vec3 }[]) {
  let doc = createEmptyDocument();
  const ids: ObjectId[] = [];
  for (const s of specs) {
    const o = createShape(doc, s.type ?? 'box', s.pos);
    if (s.rot) o.transform.rotation = s.rot;
    if (s.size) o.size = s.size;
    ids.push(o.id);
    doc = produce(doc, (d) => addObjectDraft(d, o));
  }
  return { doc, ids };
}

const worldPos = (doc: ModelDocument, id: ObjectId) => new THREE.Vector3().setFromMatrixPosition(worldMatrix(doc, id));
const expectMatrixClose = (a: THREE.Matrix4, b: THREE.Matrix4) => a.elements.forEach((v, i) => expect(v).toBeCloseTo(b.elements[i], 3));

describe('grouping', () => {
  it('groups objects at their bounds centre without moving anything', () => {
    const { doc, ids } = docWith({ pos: [0, 0, 10] }, { pos: [40, 20, 10], rot: [0, 0, 30] });
    const before = ids.map((id) => worldMatrix(doc, id));
    const next = produce(doc, (d) => void groupDraft(d, ids, { id: 'g', name: 'Group' }));
    const g = next.objects.g;
    expect(g.kind).toBe('group');
    expect(next.rootIds).toEqual(['g']);
    if (g.kind === 'group') expect(g.children).toEqual(ids);
    ids.forEach((id, i) => expectMatrixClose(worldMatrix(next, id), before[i]));
    const c = worldBoundsOf(next, ['g']).getCenter(new THREE.Vector3());
    expect(new THREE.Vector3(...g.transform.position).distanceTo(c)).toBeLessThan(1e-3);
  });

  it('requires at least two top-level objects', () => {
    const { doc, ids } = docWith({ pos: [0, 0, 10] });
    let result: string | null = 'x';
    produce(doc, (d) => void (result = groupDraft(d, ids, { id: 'g', name: 'G' })));
    expect(result).toBeNull();
  });

  it('ungroup restores world placement after the group was moved and rotated', () => {
    const { doc, ids } = docWith({ pos: [0, 0, 10] }, { pos: [40, 0, 10] });
    let next = produce(doc, (d) => void groupDraft(d, ids, { id: 'g', name: 'G' }));
    next = produce(next, (d) => {
      d.objects.g.transform.rotation = [0, 0, 90];
      d.objects.g.transform.position[2] += 5;
    });
    const expected = ids.map((id) => worldMatrix(next, id));
    const after = produce(next, (d) => void ungroupDraft(d, ['g']));
    expect(after.objects.g).toBeUndefined();
    expect(after.rootIds).toEqual(ids);
    ids.forEach((id, i) => {
      expect(after.objects[id].parentId).toBeNull();
      expectMatrixClose(worldMatrix(after, id), expected[i]);
    });
    // the 90° group rotation is now on the children
    expect(after.objects[ids[0]].transform.rotation[2]).toBeCloseTo(90);
  });

  it('supports nested groups and topLevel filtering', () => {
    const { doc, ids } = docWith({ pos: [0, 0, 10] }, { pos: [30, 0, 10] }, { pos: [60, 0, 10] });
    let next = produce(doc, (d) => void groupDraft(d, [ids[0], ids[1]], { id: 'inner', name: 'I' }));
    next = produce(next, (d) => void groupDraft(d, ['inner', ids[2]], { id: 'outer', name: 'O' }));
    expect(next.rootIds).toEqual(['outer']);
    expect(topLevel(next, [ids[0], 'inner', 'outer'])).toEqual(['outer']);
    expect(worldPos(next, ids[1]).x).toBeCloseTo(30);
  });
});

describe('re-parenting', () => {
  it('moves objects into a group preserving world placement, and refuses cycles', () => {
    const { doc, ids } = docWith({ pos: [0, 0, 10] }, { pos: [30, 0, 10] }, { pos: [90, 50, 10], rot: [0, 0, 45] });
    let next = produce(doc, (d) => void groupDraft(d, [ids[0], ids[1]], { id: 'g', name: 'G' }));
    next = produce(next, (d) => void (d.objects.g.transform.rotation = [0, 0, 60]));
    const before = worldMatrix(next, ids[2]);
    next = produce(next, (d) => void moveObjectsDraft(d, [ids[2]], 'g', 0));
    expect(next.objects[ids[2]].parentId).toBe('g');
    expectMatrixClose(worldMatrix(next, ids[2]), before);
    let ok = true;
    produce(next, (d) => void (ok = moveObjectsDraft(d, ['g'], 'g', 0)));
    expect(ok).toBe(false);
  });

  it('reorders within the same list', () => {
    const { doc, ids } = docWith({ pos: [0, 0, 10] }, { pos: [30, 0, 10] }, { pos: [60, 0, 10] });
    const next = produce(doc, (d) => void moveObjectsDraft(d, [ids[0]], null, 3));
    expect(next.rootIds).toEqual([ids[1], ids[2], ids[0]]);
  });
});

describe('group scaling', () => {
  it('scales children sizes and positions about the bottom centre', () => {
    const { doc, ids } = docWith({ pos: [-10, 0, 10] }, { pos: [10, 0, 10] }); // 40 × 20 × 20 group
    const grouped = produce(doc, (d) => void groupDraft(d, ids, { id: 'g', name: 'G' }));
    const scaled = produce(grouped, (d) => scaleGroupDraft(d, grouped, 'g', [2, 1, 1.5]));
    const b = worldBoundsOf(scaled, ['g']);
    const s = b.getSize(new THREE.Vector3());
    expect(s.x).toBeCloseTo(80);
    expect(s.y).toBeCloseTo(20);
    expect(s.z).toBeCloseTo(30);
    expect(b.min.z).toBeCloseTo(0); // still on the workplane
    const a = scaled.objects[ids[0]] as ShapeObject;
    expect(a.size).toEqual([40, 20, 30]);
    // pivot stays at the bounds centre
    expect(groupLocalBounds(scaled, 'g').getCenter(new THREE.Vector3()).length()).toBeLessThan(1e-3);
  });

  it('maps factors through 90° child rotations', () => {
    const { doc, ids } = docWith({ pos: [0, 0, 5], size: [30, 10, 10], rot: [0, 0, 90] }, { pos: [30, 0, 5], size: [10, 10, 10] });
    const grouped = produce(doc, (d) => void groupDraft(d, ids, { id: 'g', name: 'G' }));
    expect(canScaleNonUniform(grouped, 'g')).toBe(true);
    const scaled = produce(grouped, (d) => scaleGroupDraft(d, grouped, 'g', [1, 2, 1]));
    // The rotated child's local X lies along the group's Y, so its X size doubles.
    expect((scaled.objects[ids[0]] as ShapeObject).size).toEqual([60, 10, 10]);
    expect((scaled.objects[ids[1]] as ShapeObject).size).toEqual([10, 20, 10]);
  });

  it('falls back to uniform scaling when a child is at an arbitrary angle', () => {
    const { doc, ids } = docWith({ pos: [0, 0, 10], rot: [0, 0, 30] }, { pos: [30, 0, 10] });
    const grouped = produce(doc, (d) => void groupDraft(d, ids, { id: 'g', name: 'G' }));
    expect(canScaleNonUniform(grouped, 'g')).toBe(false);
    const scaled = produce(grouped, (d) => scaleGroupDraft(d, grouped, 'g', [2, 1, 1]));
    expect((scaled.objects[ids[1]] as ShapeObject).size).toEqual([40, 40, 40]);
  });
});

describe('mirror', () => {
  it('mirrors a wedge across X with genuinely reflected, watertight geometry', () => {
    const { doc, ids } = docWith({ type: 'wedge', pos: [30, 0, 10] });
    const next = produce(doc, (d) => mirrorDraft(d, ids, 0, new THREE.Vector3(0, 0, 0)));
    const w = next.objects[ids[0]] as ShapeObject;
    expect(w.transform.position).toEqual([-30, 0, 10]);
    expect(w.transform.rotation).toEqual([0, 0, 0]); // aligned ⇒ no rotation introduced
    expect(w.mirror).toEqual([-1, 1, 1]);
    const g = buildShapeGeometry('wedge', w.size, w.params, w.mirror);
    const r = analyzeMesh(g);
    expect(r.watertight).toBe(true);
    expect(r.volume).toBeCloseTo(4000, 2);
    // Original wedge is tall at -X; mirrored one must be tall at +X.
    const pos = g.getAttribute('position');
    let topX = -Infinity;
    for (let i = 0; i < pos.count; i++) if (pos.getZ(i) > 9.9) topX = Math.max(topX, pos.getX(i));
    expect(topX).toBeCloseTo(10);
  });

  it('mirroring twice restores the original', () => {
    const { doc, ids } = docWith({ type: 'wedge', pos: [12, 5, 10], rot: [10, 20, 30] });
    const c = new THREE.Vector3(3, 0, 0);
    const twice = produce(doc, (d) => {
      mirrorDraft(d, ids, 1, c);
      mirrorDraft(d, ids, 1, c);
    });
    const a = doc.objects[ids[0]] as ShapeObject;
    const b = twice.objects[ids[0]] as ShapeObject;
    expectMatrixClose(worldMatrix(twice, ids[0]), worldMatrix(doc, ids[0]));
    expect(b.mirror ?? [1, 1, 1]).toEqual(a.mirror ?? [1, 1, 1]);
  });

  it('mirrors a group, keeping children consistent', () => {
    const { doc, ids } = docWith({ type: 'wedge', pos: [10, 0, 10] }, { pos: [40, 0, 10] });
    const grouped = produce(doc, (d) => void groupDraft(d, ids, { id: 'g', name: 'G' }));
    const next = produce(grouped, (d) => mirrorDraft(d, ['g'], 0, new THREE.Vector3(0, 0, 0)));
    expect(worldPos(next, ids[0]).x).toBeCloseTo(-10);
    expect(worldPos(next, ids[1]).x).toBeCloseTo(-40);
  });
});

describe('align, distribute, drop', () => {
  it('aligns left edges and centres', () => {
    const { doc, ids } = docWith({ pos: [0, 0, 10] }, { pos: [50, 30, 10], size: [40, 20, 20] });
    const left = produce(doc, (d) => alignDraft(d, ids, 0, 'min'));
    expect(worldBoundsOf(left, [ids[1]]).min.x).toBeCloseTo(-10);
    const mid = produce(doc, (d) => alignDraft(d, ids, 1, 'center'));
    expect(worldPos(mid, ids[0]).y).toBeCloseTo(worldPos(mid, ids[1]).y);
  });

  it('aligns a single object to the workplane', () => {
    const { doc, ids } = docWith({ pos: [33, 12, 40] });
    const c = produce(doc, (d) => {
      alignDraft(d, ids, 0, 'center');
      alignDraft(d, ids, 2, 'min');
    });
    expect(c.objects[ids[0]].transform.position).toEqual([0, 12, 10]);
  });

  it('distributes with equal gaps', () => {
    const { doc, ids } = docWith({ pos: [0, 0, 10] }, { pos: [25, 0, 10], size: [10, 20, 20] }, { pos: [100, 0, 10] });
    const next = produce(doc, (d) => distributeDraft(d, ids, 0));
    const b = ids.map((id) => worldBoundsOf(next, [id]));
    const gap1 = b[1].min.x - b[0].max.x;
    const gap2 = b[2].min.x - b[1].max.x;
    expect(gap1).toBeCloseTo(gap2);
  });

  it('drops a rotated group onto the workplane', () => {
    const { doc, ids } = docWith({ pos: [0, 0, 50] }, { pos: [30, 0, 70] });
    let next = produce(doc, (d) => void groupDraft(d, ids, { id: 'g', name: 'G' }));
    next = produce(next, (d) => {
      d.objects.g.transform.rotation = [25, 0, 0];
      dropToWorkplaneDraft(d, ['g']);
    });
    expect(worldBoundsOf(next, ['g']).min.z).toBeCloseTo(0, 3);
  });
});
