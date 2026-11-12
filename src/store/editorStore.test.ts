import { useEditor } from './editorStore';
import { createEmptyDocument } from '@/cad/document';
import { worldBounds } from '@/cad/transforms/transform';

const S = () => useEditor.getState();

beforeEach(() => {
  S().loadDocument(createEmptyDocument());
});

describe('editor store', () => {
  it('adds a box resting on the workplane and selects it', () => {
    const id = S().addShape('box');
    const o = S().doc.objects[id];
    expect(o.kind).toBe('shape');
    expect(S().selection).toEqual([id]);
    if (o.kind === 'shape') expect(worldBounds(o).min.z).toBeCloseTo(0);
  });

  it('does not stack new shapes on top of each other', () => {
    const a = S().addShape('box');
    const b = S().addShape('sphere');
    const ao = S().doc.objects[a];
    const bo = S().doc.objects[b];
    if (ao.kind === 'shape' && bo.kind === 'shape') expect(worldBounds(ao).intersectsBox(worldBounds(bo))).toBe(false);
  });

  it('undoes and redoes add, resize, move, rotate and delete', () => {
    const id = S().addShape('cylinder');
    S().setSize(id, [40, 30, 10]);
    S().setPosition(id, [5, 6, 7]);
    S().setRotation(id, [0, 0, 45]);
    S().deleteSelected();
    expect(S().doc.objects[id]).toBeUndefined();

    S().undo(); // delete
    expect(S().doc.objects[id]).toBeDefined();
    S().undo(); // rotate
    expect(S().doc.objects[id].transform.rotation).toEqual([0, 0, 0]);
    S().undo(); // move
    expect(S().doc.objects[id].transform.position).not.toEqual([5, 6, 7]);
    S().undo(); // resize
    const o = S().doc.objects[id];
    if (o.kind === 'shape') expect(o.size).toEqual([20, 20, 20]);
    S().undo(); // add
    expect(S().doc.rootIds).toHaveLength(0);
    expect(S().selection).toEqual([]);

    for (let i = 0; i < 5; i++) S().redo();
    expect(S().doc.objects[id]).toBeUndefined();
    S().undo();
    const r = S().doc.objects[id];
    if (r.kind === 'shape') expect(r.size).toEqual([40, 30, 10]);
    expect(r.transform.rotation).toEqual([0, 0, 45]);
  });

  it('clears the redo stack after a new change', () => {
    S().addShape('box');
    S().undo();
    expect(S().history.future).toHaveLength(1);
    S().addShape('sphere');
    expect(S().history.future).toHaveLength(0);
  });

  it('records a whole gizmo drag as a single undo step', () => {
    const id = S().addShape('box');
    const before = S().history.past.length;
    S().beginTransaction('Move');
    for (let x = 1; x <= 30; x++) {
      S().applyTransient((d) => {
        d.objects[id].transform.position[0] = x;
      });
    }
    S().commitTransaction();
    expect(S().history.past.length).toBe(before + 1);
    expect(S().doc.objects[id].transform.position[0]).toBe(30);
    S().undo();
    expect(S().doc.objects[id].transform.position[0]).toBe(0);
  });

  it('cancelling a transaction restores the original document', () => {
    const id = S().addShape('box');
    const doc = S().doc;
    S().beginTransaction('Move');
    S().applyTransient((d) => void (d.objects[id].transform.position[0] = 99));
    S().cancelTransaction();
    expect(S().doc).toBe(doc);
  });

  it('a no-op transaction does not create a history entry', () => {
    S().addShape('box');
    const n = S().history.past.length;
    S().beginTransaction('Move');
    S().commitTransaction();
    expect(S().history.past.length).toBe(n);
  });

  it('duplicates with an offset, selects the copy and keeps geometry', () => {
    const id = S().addShape('tube');
    S().setSize(id, [30, 30, 12]);
    S().duplicateSelected();
    const [copyId] = S().selection;
    expect(copyId).not.toBe(id);
    const src = S().doc.objects[id];
    const copy = S().doc.objects[copyId];
    if (src.kind === 'shape' && copy.kind === 'shape') {
      expect(copy.size).toEqual(src.size);
      expect(copy.params).toEqual(src.params);
      expect(copy.transform.position[0]).toBe(src.transform.position[0] + 10);
      expect(copy.name).toBe('Tube 2');
    }
  });

  it('never stores zero or negative dimensions', () => {
    const id = S().addShape('box');
    S().setSize(id, [0, -5, 10]);
    const o = S().doc.objects[id];
    if (o.kind === 'shape') {
      expect(o.size[0]).toBeGreaterThan(0);
      expect(o.size[1]).toBe(5);
    }
  });

  it('does not delete locked objects', () => {
    const id = S().addShape('box');
    S().setLocked(id, true);
    S().select([id]);
    S().deleteSelected();
    expect(S().doc.objects[id]).toBeDefined();
  });

  it('history snapshots share unchanged objects (structural sharing)', () => {
    const a = S().addShape('box');
    S().addShape('sphere');
    const before = S().doc;
    S().setPosition(S().selection[0], [50, 50, 10]);
    expect(S().doc.objects[a]).toBe(before.objects[a]);
  });
});
