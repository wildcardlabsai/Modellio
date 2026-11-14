import { describe, expect, it } from 'vitest';
import { buildMeshDocument } from '@/cad/meshDocument';
import { projectFromFile, projectToFile, PROJECT_FILE_VERSION, workspaceOf, type ProjectData } from '@/cad/serialization/project';
import { createEmptyDocument } from '@/cad/document';
import { worldBoundsOf } from '@/cad/hierarchy';
import { MemoryProjectRepository } from '@/cad/serialization/repository';
import { numberedElements, tagCount, tagNumber } from '@/makers/keytag/numbering';
import type { DesignElement } from '@/makers/canvas/model';

const cube = (s: number, ox = 0) => {
  const p: number[] = [];
  for (const [x, y, z] of [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ])
    p.push(x * s + ox, y * s, z * s + 5);
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { positions: new Float32Array(p), indices: new Uint32Array(f) };
};

describe('shared project system', () => {
  it('turns maker parts into a document of mesh objects, centred and resting on the plate', () => {
    const { document, assets } = buildMeshDocument(
      [
        { name: 'Base', mesh: cube(10), color: '#ff0000' },
        { name: 'Top', mesh: cube(10, 20) },
      ],
      'Keyring',
    );
    expect(Object.keys(assets)).toHaveLength(2);
    expect(document.rootIds).toHaveLength(1);
    const g = document.objects[document.rootIds[0]];
    expect(g.kind === 'group' && g.children.length).toBe(2);
    const b = worldBoundsOf(document, document.rootIds);
    expect(b.min.z).toBeCloseTo(0, 5);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0, 5);
    const base = Object.values(document.objects).find((o) => o.name === 'Base');
    expect(base?.kind === 'shape' && base.color).toBe('#ff0000');
  });

  it('keeps a maker’s settings and workspace through the project file (v2)', () => {
    const { document, assets } = buildMeshDocument([{ name: 'Tag', mesh: cube(5) }]);
    const p: ProjectData = {
      meta: { id: 'prj_1', name: 'Locker tags', createdAt: 1, updatedAt: 2, objectCount: 1, workspace: 'keytag' },
      document,
      assets,
      maker: { studio: 'keytag', schema: 1, state: { params: { numbering: { start: 7 } } } },
    };
    const back = projectFromFile(projectToFile(p));
    expect(workspaceOf(back.meta)).toBe('keytag');
    expect(back.maker).toEqual(p.maker);
    expect(Object.keys(back.assets)).toHaveLength(1);
    expect(JSON.parse(projectToFile(p)).version).toBe(PROJECT_FILE_VERSION);
  });

  it('opens version 1 files as Design Studio projects', () => {
    const v1 = JSON.stringify({
      format: 'modellio-project',
      version: 1,
      meta: { id: 'a', name: 'Old' },
      document: createEmptyDocument(),
      assets: {},
    });
    const p = projectFromFile(v1);
    expect(workspaceOf(p.meta)).toBe('design');
    expect(p.maker).toBeUndefined();
  });

  it('the repository round-trips maker projects', async () => {
    const repo = new MemoryProjectRepository();
    const { document, assets } = buildMeshDocument([{ name: 'Sign', mesh: cube(5) }]);
    await repo.save({
      meta: { id: 'x', name: 'S', createdAt: 1, updatedAt: 1, objectCount: 1, workspace: 'sign' },
      document,
      assets,
      maker: { studio: 'sign', schema: 1, state: { a: 1 } },
    });
    const back = await repo.load('x');
    expect(back?.maker?.state).toEqual({ a: 1 });
    expect((await repo.list())[0].workspace).toBe('sign');
  });
});

describe('key tag numbering', () => {
  it('formats numbers with padding, steps and limits', () => {
    const n = { start: 7, count: 3, step: 5, pad: 3 };
    expect([0, 1, 2].map((i) => tagNumber(n, i))).toEqual(['007', '012', '017']);
    expect(tagCount({ ...n, count: 1000 })).toBe(100);
    expect(tagCount({ ...n, count: 0 })).toBe(1);
  });

  it('replaces {#} in text and leaves everything else alone', () => {
    const els = [
      { id: 't', kind: 'text', text: 'ROOM {#}', font: 'inter-bold', role: 'raised', x: 0, y: 0, w: 30, h: 8, rotation: 0 },
      { id: 's', kind: 'shape', shape: 'rect', role: 'plate', x: 0, y: 0, w: 40, h: 20, rotation: 0 },
    ] as DesignElement[];
    const out = numberedElements(els, { start: 101, count: 2, step: 1, pad: 3 }, 1);
    expect(out[0].kind === 'text' && out[0].text).toBe('ROOM 102');
    expect(out[1]).toBe(els[1]);
  });
});
