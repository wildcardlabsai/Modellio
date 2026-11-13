import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { produce } from 'immer';
import { addObjectDraft, createEmptyDocument, createShape } from '../document';
import { groupDraft } from '../hierarchy';
import { migrateDocument, projectFromFile, projectToFile, ProjectFormatError, type ProjectData } from './project';
import { IndexedDbProjectRepository } from './repository';
import type { ShapeObject } from '@/types/document';

function sampleProject(): ProjectData {
  let doc = createEmptyDocument();
  const a = createShape(doc, 'box', [0, 0, 10]);
  a.color = '#FF0000';
  a.mirror = [-1, 1, 1];
  const b = createShape(doc, 'text', [30, 0, 3]);
  b.text = { content: 'Hi', font: 'pacifico' };
  b.isHole = true;
  const m = createShape(doc, 'mesh', [60, 0, 5]);
  m.meshId = 'mesh_test';
  doc = produce(doc, (d) => {
    addObjectDraft(d, a);
    addObjectDraft(d, b);
    addObjectDraft(d, m);
    groupDraft(d, [a.id, b.id], { id: 'g1', name: 'Sign' });
    (d.objects.g1 as { combine?: string }).combine = 'union';
    d.settings.workplane = [256, 256];
  });
  return {
    meta: { id: 'p1', name: 'Test', createdAt: 1, updatedAt: 2, objectCount: 4 },
    document: doc,
    assets: {
      mesh_test: {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1.5]),
        indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
      },
      unused: { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) },
    },
  };
}

describe('project file (.modellio)', () => {
  it('round-trips document, hierarchy, colours, settings and mesh assets exactly', () => {
    const p = sampleProject();
    const back = projectFromFile(projectToFile(p));
    expect(back.document).toEqual(p.document);
    expect(back.meta.name).toBe('Test');
    expect([...back.assets.mesh_test.positions]).toEqual([...p.assets.mesh_test.positions]);
    expect([...back.assets.mesh_test.indices]).toEqual([...p.assets.mesh_test.indices]);
    expect(back.assets.unused).toBeUndefined(); // unreferenced assets are not written
  });

  it('rejects files that are not projects, newer versions and corrupt meshes', () => {
    expect(() => projectFromFile('not json')).toThrow(ProjectFormatError);
    expect(() => projectFromFile('{"format":"other"}')).toThrow(/not a MODELLIO project/);
    expect(() => projectFromFile(JSON.stringify({ format: 'modellio-project', version: 99 }))).toThrow(/newer/);
    const p = JSON.parse(projectToFile(sampleProject()));
    p.assets.mesh_test.indices = btoa('c\u0000\u0000\u0000'.repeat(3)); // index 99, out of range
    expect(() => projectFromFile(JSON.stringify(p))).toThrow(/corrupt/);
  });

  it('migration repairs dangling references instead of losing objects', () => {
    const p = sampleProject();
    const raw = JSON.parse(JSON.stringify(p.document));
    raw.objects.g1.children.push('ghost'); // missing child
    raw.rootIds = []; // lost root list
    const doc = migrateDocument(raw);
    expect((doc.objects.g1 as { children: string[] }).children).not.toContain('ghost');
    expect(doc.rootIds.sort()).toEqual(['g1', Object.values(doc.objects).find((o) => o.kind === 'shape' && o.shape === 'mesh')!.id].sort());
  });

  it('rejects objects with invalid transforms', () => {
    const raw = JSON.parse(JSON.stringify(sampleProject().document));
    const id = raw.rootIds[0];
    raw.objects[id].transform.position = [0, 'x', 0];
    expect(() => migrateDocument(raw)).toThrow(/invalid transform/);
  });
});

describe('IndexedDB repository', () => {
  it('saves, lists (newest first), loads typed arrays natively and deletes', async () => {
    const repo = new IndexedDbProjectRepository(new IDBFactory(), 'test-db');
    const p = sampleProject();
    await repo.save(p);
    await repo.save({ ...p, meta: { ...p.meta, id: 'p2', name: 'Newer', updatedAt: 10 } });
    const list = await repo.list();
    expect(list.map((m) => m.id)).toEqual(['p2', 'p1']);
    const loaded = (await repo.load('p1'))!;
    expect(loaded.document).toEqual(p.document);
    expect(loaded.assets.mesh_test.positions).toBeInstanceOf(Float32Array);
    expect((loaded.document.objects[loaded.document.rootIds[1]] as ShapeObject).meshId).toBe('mesh_test');
    await repo.remove('p1');
    expect(await repo.load('p1')).toBeNull();
    expect((await repo.list()).map((m) => m.id)).toEqual(['p2']);
  });
});
