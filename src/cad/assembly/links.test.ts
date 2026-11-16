import { useEditor } from '@/store/editorStore';
import { createEmptyDocument } from '@/cad/document';
import { instancesOf, syncLinks } from './links';
import { collectExportBodies } from '@/cad/export/collect';
import { migrateDocument } from '@/cad/serialization/project';
import type { GroupObject, ModelDocument, ShapeObject } from '@/types/document';

const S = () => useEditor.getState();
const obj = (id: string) => S().doc.objects[id];
const partsOf = (id: string) => (obj(id) as GroupObject).children.map((c) => obj(c) as ShapeObject);

beforeEach(() => S().loadDocument(createEmptyDocument()));

/** A bracket: a plate and a peg, made a component. Returns the component instance id. */
function bracket() {
  const plate = S().addShape('box');
  S().setSize(plate, [30, 10, 2]);
  const peg = S().addShape('cylinder');
  S().setSize(peg, [4, 4, 8]);
  S().select([plate, peg]);
  S().makeComponent();
  return S().selection[0];
}

describe('linked components', () => {
  it('making a component gives it a definition and every part a link id', () => {
    const id = bracket();
    const g = obj(id) as GroupObject;
    expect(g.componentId).toBeTruthy();
    expect(S().doc.components?.[g.componentId!]).toBeTruthy();
    expect(partsOf(id).every((p) => !!p.defNode)).toBe(true);
  });

  it('inserting places linked instances; editing one updates them all (one undo step)', () => {
    const id = bracket();
    const cid = (obj(id) as GroupObject).componentId!;
    for (let i = 0; i < 3; i++) S().insertComponent(id);
    expect(instancesOf(S().doc, cid)).toHaveLength(4);
    const [plateOfSecond] = partsOf(instancesOf(S().doc, cid)[1].id);
    const steps = S().history.past.length;
    S().setSize(plateOfSecond.id, [50, 12, 3]);
    for (const inst of instancesOf(S().doc, cid))
      expect(partsOf(inst.id).find((p) => p.defNode === plateOfSecond.defNode)!.size).toEqual([50, 12, 3]);
    expect(S().history.past.length).toBe(steps + 1);
    S().undo();
    for (const inst of instancesOf(S().doc, cid))
      expect(partsOf(inst.id).find((p) => p.defNode === plateOfSecond.defNode)!.size).toEqual([30, 10, 2]);
  });

  it('each instance keeps its own placement; adding or removing a part propagates', () => {
    const id = bracket();
    const copy = S().insertComponent(id)!;
    S().setPosition(copy, [100, 0, 0]);
    expect(obj(id).transform.position).not.toEqual([100, 0, 0]);
    const extra = S().addShape('sphere');
    S().moveInTree([extra], id, 0);
    expect(partsOf(copy)).toHaveLength(3);
    S().select([partsOf(copy)[0].id]);
    S().deleteSelected();
    expect(partsOf(id)).toHaveLength(2);
    S().setColor(partsOf(id)[0].id, '#FF0000');
    expect(partsOf(copy).find((p) => p.defNode === partsOf(id)[0].defNode)!.color).toBe('#FF0000');
  });

  it('breaking the link makes a copy independent', () => {
    const id = bracket();
    const copy = S().insertComponent(id)!;
    S().breakLink(copy);
    S().setSize(partsOf(id)[0].id, [44, 10, 2]);
    expect(partsOf(copy)[0].size).toEqual([30, 10, 2]);
    expect((obj(copy) as GroupObject).componentId).not.toBe((obj(id) as GroupObject).componentId);
  });

  it('an independent copy (Insert independent) is not linked', () => {
    const id = bracket();
    const copy = S().insertComponent(id, false)!;
    S().setSize(partsOf(id)[0].id, [44, 10, 2]);
    expect(partsOf(copy)[0].size).toEqual([30, 10, 2]);
  });

  it('nested components: editing the inner part updates it inside every outer instance', () => {
    const inner = bracket();
    const base = S().addShape('box');
    S().select([inner, base]);
    S().makeComponent();
    const outer = S().selection[0];
    const outer2 = S().insertComponent(outer)!;
    const innerCid = (obj(inner) as GroupObject).componentId!;
    expect(instancesOf(S().doc, innerCid)).toHaveLength(2);
    S().setSize(partsOf(inner)[1].id, [6, 6, 12]);
    for (const i of instancesOf(S().doc, innerCid)) expect(partsOf(i.id)[1].size).toEqual([6, 6, 12]);
    expect(obj(outer2)).toBeTruthy();
  });

  it('refuses putting a component inside itself', () => {
    const id = bracket();
    const copy = S().insertComponent(id)!;
    const before = S().doc;
    S().moveInTree([copy], id, 0);
    expect(S().doc).toBe(before);
  });

  it('grounded parts stay put; reset puts a moved part back home', () => {
    const id = bracket();
    S().setGrounded([id], true);
    const p0 = [...obj(id).transform.position];
    S().setPosition(id, [80, 80, 0]);
    expect(obj(id).transform.position).toEqual(p0);
    S().setGrounded([id], false);
    S().setPosition(id, [80, 80, 0]);
    S().resetToHome([id]);
    expect(obj(id).transform.position).toEqual(p0);
  });

  it('suppressed parts are left out of export', () => {
    const id = bracket();
    const n = collectExportBodies(S().doc).bodies.length;
    S().setSuppressed([id], true);
    expect(collectExportBodies(S().doc).bodies.length).toBe(n - 2);
  });

  it('a schema 3 document migrates: components get definitions, copies stay independent', () => {
    const id = bracket();
    const copy = S().insertComponent(id, false)!;
    const raw = JSON.parse(JSON.stringify(S().doc)) as ModelDocument & Record<string, unknown>;
    raw.schemaVersion = 3;
    delete raw.components;
    for (const o of Object.values(raw.objects) as unknown as Record<string, unknown>[]) {
      delete o.componentId;
      delete o.defNode;
    }
    const doc = migrateDocument(raw);
    const a = doc.objects[id] as GroupObject;
    const b = doc.objects[copy] as GroupObject;
    expect(a.componentId && b.componentId && a.componentId !== b.componentId).toBe(true);
    expect(syncLinks(doc, doc).doc).toBe(doc);
  });

  it('keeps up with larger assemblies (50 instances of a 20-part component)', () => {
    const parts: string[] = [];
    for (let i = 0; i < 20; i++) parts.push(S().addShape('box'));
    S().select(parts);
    S().makeComponent();
    const id = S().selection[0];
    for (let i = 0; i < 49; i++) S().insertComponent(id);
    const t = performance.now();
    S().setSize(partsOf(id)[0].id, [5, 5, 5]);
    const ms = performance.now() - t;
    expect(ms).toBeLessThan(300);
  });
});
