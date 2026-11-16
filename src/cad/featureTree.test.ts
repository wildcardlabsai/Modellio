import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { addObjectDraft, createEmptyDocument, createShape } from './document';
import { groupDraft } from './hierarchy';
import { changedObjectIds, deriveFeatureTree, deriveSketches } from './featureTree';
import type { ModelDocument, ShapeObject } from '@/types/document';
import type { Sketch } from './sketch/types';

const sketch = (): Sketch =>
  ({
    points: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 10, y: 0 },
      { id: 'c', x: 10, y: 10 },
    ],
    entities: [
      { id: 'l1', kind: 'line', a: 'a', b: 'b' },
      { id: 'l2', kind: 'line', a: 'b', b: 'c' },
      { id: 'l3', kind: 'line', a: 'c', b: 'a' },
    ],
    constraints: [],
  }) as unknown as Sketch;

function design(): { doc: ModelDocument; ids: Record<string, string> } {
  let doc = createEmptyDocument();
  const box = createShape(doc, 'box');
  const hole = createShape(doc, 'cylinder');
  hole.isHole = true;
  const solid = createShape(doc, 'solid' as ShapeObject['shape']);
  solid.feature = {
    base: { kind: 'primitive', shape: 'box', params: {} },
    ops: [
      { id: 'f1', kind: 'fillet', radius: 2, edges: [{ kind: 'line', mid: [0, 0, 0], dir: [1, 0, 0], radius: 0 }] },
      { id: 'c1', kind: 'chamfer', distance: 1, edges: [], suppressed: true },
    ],
  };
  const loft = createShape(doc, 'solid' as ShapeObject['shape']);
  loft.name = 'Vase';
  loft.feature = {
    base: {
      kind: 'loft',
      ruled: false,
      sections: [
        { sketch: sketch(), height: 0, offset: [0, 0] },
        { sketch: sketch(), height: 20, offset: [0, 0] },
      ],
    },
    ops: [],
  };
  const profile = createShape(doc, 'profile' as ShapeObject['shape']);
  profile.name = 'Bracket';
  profile.sketch = sketch();
  profile.params = { op: 0, depth: 8 };
  doc = produce(doc, (d) => {
    for (const o of [box, hole, solid, loft, profile]) addObjectDraft(d, o);
    groupDraft(d, [box.id, hole.id], { id: 'g1', name: 'Plate' });
    (d.objects.g1 as { combine?: string }).combine = 'union';
  });
  return { doc, ids: { box: box.id, hole: hole.id, solid: solid.id, loft: loft.id, profile: profile.id } };
}

describe('feature tree', () => {
  it('shows a Boolean with its bodies and cutters', () => {
    const { doc, ids } = design();
    const tree = deriveFeatureTree(doc);
    const plate = tree.find((n) => n.objectId === 'g1')!;
    expect(plate.kind).toBe('boolean');
    expect(plate.detail).toBe('Union · 1 body − 1 cutter');
    expect(plate.children.map((c) => [c.objectId, c.kind])).toEqual([
      [ids.box, 'body'],
      [ids.hole, 'cutter'],
    ]);
  });

  it('lists a precise solid’s base then its operations, with real edit targets and the suppressed state', () => {
    const { doc, ids } = design();
    const solid = deriveFeatureTree(doc).find((n) => n.objectId === ids.solid)!;
    expect(solid.children.map((c) => c.label)).toEqual(['Box', 'Fillet', 'Chamfer']);
    expect(solid.children[0].edit).toBeUndefined(); // a precise primitive is sized in Properties, not "edited" as a feature
    expect(solid.children[1]).toMatchObject({
      detail: 'R 2 mm · 1 edge',
      suppressed: false,
      edit: { kind: 'op', opId: 'f1', op: 'fillet' },
    });
    expect(solid.children[2]).toMatchObject({ suppressed: true, detail: '1 mm · 0 edges · off' });
  });

  it('shows the rollback marker and greys out the operations after it', () => {
    const { doc, ids } = design();
    const rolled = produce(doc, (d) => {
      (d.objects[ids.solid] as ShapeObject).feature!.rollback = 1;
    });
    const solid = deriveFeatureTree(rolled).find((n) => n.objectId === ids.solid)!;
    expect(solid.children.map((c) => c.kind)).toEqual(['base', 'op', 'rollback', 'op']);
    expect(solid.children[3]).toMatchObject({ rolledBack: true, edit: undefined });
    expect(solid.children[1]).toMatchObject({ rolledBack: false, index: 0 });
  });

  it('offers editing only where it really exists', () => {
    const { doc, ids } = design();
    const tree = deriveFeatureTree(doc);
    expect(tree.find((n) => n.objectId === ids.loft)!.children[0].edit).toEqual({ kind: 'loft', objectId: ids.loft });
    expect(tree.find((n) => n.objectId === ids.profile)!.children[0]).toMatchObject({
      label: 'Extrude',
      detail: 'Sketch · 8 mm',
      edit: { kind: 'sketch' },
    });
  });

  it('collects every sketch with the body it drives', () => {
    const { doc, ids } = design();
    const sketches = deriveSketches(doc);
    expect(sketches.map((s) => [s.label, s.owners[0], s.source.kind])).toEqual([
      ['Section 1', 'Vase', 'section'],
      ['Section 2', 'Vase', 'section'],
      ['Bracket sketch', 'Bracket', 'profile'],
    ]);
    expect(sketches[2]).toMatchObject({ objectId: ids.profile, editable: true, entities: 3 });
  });

  it('finds the objects a step changed, added or removed', () => {
    const { doc, ids } = design();
    expect(changedObjectIds(doc, doc)).toEqual([]);
    const moved = produce(doc, (d) => {
      d.objects[ids.solid].transform.position[0] = 50;
    });
    expect(changedObjectIds(doc, moved)).toEqual([ids.solid]);
    const removed = produce(doc, (d) => {
      delete d.objects[ids.profile];
      d.rootIds = d.rootIds.filter((i) => i !== ids.profile);
    });
    expect(changedObjectIds(doc, removed)).toEqual([ids.profile]);
  });
});
