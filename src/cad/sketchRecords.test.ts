import { describe, expect, it, beforeEach } from 'vitest';
import { produce } from 'immer';
import { addObjectDraft, createEmptyDocument, createShape } from './document';
import { CURRENT_SCHEMA, migrateDocument, projectFromFile, projectToFile } from './serialization/project';
import { forkSketchLinksDraft, sketchUsers } from './sketchRecords';
import { decodeShareFragment, encodeShareFragment } from './serialization/share';
import { circleSketch, rectSketch } from '@/components/features/solidBuilder';
import { useEditor } from '@/store/editorStore';
import type { ModelDocument, ShapeObject } from '@/types/document';

/** A version 1 document with one sketched body and a group (as saved before schema 2). */
function versionOne() {
  let doc = createEmptyDocument();
  const p = createShape(doc, 'profile' as ShapeObject['shape']);
  p.name = 'Bracket';
  p.sketch = rectSketch(20, 10);
  p.params = { op: 0, depth: 4 };
  doc = produce(doc, (d) => addObjectDraft(d, p));
  const raw = JSON.parse(JSON.stringify(doc));
  raw.schemaVersion = 1;
  delete raw.sketches;
  return { raw, id: p.id };
}

describe('schema 2: standalone sketches and components', () => {
  it('upgrades a version 1 document: each sketched body gets its own standalone sketch', () => {
    const { raw, id } = versionOne();
    const doc = migrateDocument(raw);
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA);
    const body = doc.objects[id] as ShapeObject;
    expect(body.sketchId).toBeTruthy();
    const rec = doc.sketches![body.sketchId!];
    expect(rec.name).toBe('Bracket sketch');
    expect(rec.sketch).toEqual(body.sketch);
    expect(sketchUsers(doc, rec.id).map((u) => u.id)).toEqual([id]);
  });

  it('keeps sketches on their own, drops broken ones and repairs links that disagree', () => {
    const { raw, id } = versionOne();
    raw.schemaVersion = 2;
    raw.sketches = {
      lonely: { id: 'lonely', name: 'Idea', sketch: circleSketch(5) },
      broken: { id: 'broken', name: 'Bad', sketch: { points: 'no' } },
      shared: { id: 'shared', name: 'Other', sketch: circleSketch(9) },
    };
    raw.objects[id].sketchId = 'shared'; // disagrees with the body's own copy
    const doc = migrateDocument(raw);
    expect(Object.keys(doc.sketches!).sort()).toEqual(['lonely', 'shared', `sk_${id}`].sort());
    expect((doc.objects[id] as ShapeObject).sketchId).toBe(`sk_${id}`);
    expect(doc.sketches![`sk_${id}`].sketch).toEqual((doc.objects[id] as ShapeObject).sketch);
  });

  it('keeps only a real component flag', () => {
    const { raw } = versionOne();
    raw.objects.g = {
      id: 'g',
      name: 'Lid',
      kind: 'group',
      children: [],
      parentId: null,
      visible: true,
      locked: false,
      component: 'yes',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    };
    raw.objects.h = { ...raw.objects.g, id: 'h', component: true };
    raw.rootIds.push('g', 'h');
    const doc = migrateDocument(raw);
    expect((doc.objects.g as { component?: boolean }).component).toBeUndefined();
    expect((doc.objects.h as { component?: boolean }).component).toBe(true);
  });

  it('round-trips sketches through a project file, and still opens version 3 files', () => {
    const doc = migrateDocument(versionOne().raw);
    const meta = { id: 'p', name: 'P', createdAt: 1, updatedAt: 2, objectCount: 1 };
    const back = projectFromFile(projectToFile({ meta, document: doc, assets: {} }));
    expect(back.document.sketches).toEqual(doc.sketches);
    const v3 = JSON.parse(projectToFile({ meta, document: doc, assets: {} }));
    v3.version = 3;
    v3.document = versionOne().raw;
    expect(projectFromFile(JSON.stringify(v3)).document.schemaVersion).toBe(CURRENT_SCHEMA);
  });

  it('survives a share link', () => {
    const doc = migrateDocument(versionOne().raw);
    const meta = { id: 'p', name: 'P', createdAt: 1, updatedAt: 2, objectCount: 1 };
    const back = decodeShareFragment(encodeShareFragment({ meta, document: doc, assets: {} }));
    expect(back.document.sketches).toEqual(doc.sketches);
    expect(back.document.objects).toEqual(doc.objects);
  });

  it('copies get a sketch of their own', () => {
    const doc = migrateDocument(versionOne().raw);
    const id = Object.keys(doc.objects)[0];
    const next = produce(doc, (d: ModelDocument) => {
      const copy = { ...JSON.parse(JSON.stringify(d.objects[id])), id: 'copy' } as ShapeObject;
      d.objects.copy = copy;
      d.rootIds.push('copy');
      forkSketchLinksDraft(d, ['copy']);
    });
    const a = next.objects[id] as ShapeObject;
    const b = next.objects.copy as ShapeObject;
    expect(b.sketchId).not.toBe(a.sketchId);
    expect(next.sketches![b.sketchId!].sketch).toEqual(a.sketch);
  });
});

describe('editor store: shared sketches', () => {
  const S = () => useEditor.getState();
  beforeEach(() => S().loadDocument(createEmptyDocument()));

  it('a sketch saved on its own can build several bodies, and editing it rebuilds all of them', async () => {
    const sk = S().saveSketchOnly(rectSketch(20, 10), 'Plate outline')!;
    expect(S().doc.sketches![sk].name).toBe('Plate outline');
    const a = (await S().bodyFromSketch(sk, { kind: 'extrude', depth: 4, angle: 360 }))!;
    const b = (await S().bodyFromSketch(sk, { kind: 'extrude', depth: 10, angle: 360 }))!;
    expect(
      sketchUsers(S().doc, sk)
        .map((u) => u.id)
        .sort(),
    ).toEqual([a, b].sort());
    expect((S().doc.objects[a] as ShapeObject).size).toEqual([20, 10, 4]);

    await S().updateSketchRecord(sk, rectSketch(30, 12));
    expect((S().doc.objects[a] as ShapeObject).size).toEqual([30, 12, 4]);
    expect((S().doc.objects[b] as ShapeObject).size).toEqual([30, 12, 10]);
    S().undo();
    expect((S().doc.objects[b] as ShapeObject).size).toEqual([20, 10, 10]);
  });

  it('editing one body’s shared sketch updates the other; unlinking stops that', async () => {
    const sk = S().saveSketchOnly(rectSketch(20, 10))!;
    const a = (await S().bodyFromSketch(sk, { kind: 'extrude', depth: 4, angle: 360 }))!;
    const b = (await S().bodyFromSketch(sk, { kind: 'extrude', depth: 6, angle: 360 }))!;
    await S().saveSketch(a, rectSketch(40, 10), { kind: 'extrude', depth: 4, angle: 360 });
    expect((S().doc.objects[b] as ShapeObject).size).toEqual([40, 10, 6]);
    S().unlinkSketch(b);
    await S().saveSketch(a, rectSketch(50, 10), { kind: 'extrude', depth: 4, angle: 360 });
    expect((S().doc.objects[b] as ShapeObject).size).toEqual([40, 10, 6]);
  });

  it('duplicates stay independent, and a used sketch cannot be deleted', async () => {
    const id = (await S().saveSketch(null, rectSketch(20, 10), { kind: 'extrude', depth: 4, angle: 360 }))!;
    S().select([id]);
    S().duplicateSelected();
    const copy = S().selection[0];
    await S().saveSketch(id, rectSketch(40, 10), { kind: 'extrude', depth: 4, angle: 360 });
    expect((S().doc.objects[copy] as ShapeObject).size).toEqual([20, 10, 4]);
    const sk = (S().doc.objects[id] as ShapeObject).sketchId!;
    S().deleteSketchRecord(sk);
    expect(S().doc.sketches![sk]).toBeTruthy();
  });

  it('makes components and inserts independent copies', () => {
    const a = S().addShape('box');
    const b = S().addShape('cylinder');
    S().select([a, b]);
    S().makeComponent();
    const g = S().selection[0];
    expect(S().doc.objects[g]).toMatchObject({ kind: 'group', component: true });
    S().insertComponent(g);
    const copy = S().selection[0];
    expect(copy).not.toBe(g);
    expect(S().doc.objects[copy]).toMatchObject({ kind: 'group', component: true });
    S().undo();
    expect(S().doc.objects[copy]).toBeUndefined();
  });
});
