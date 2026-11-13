import { produce } from 'immer';
import { addObjectDraft, createEmptyDocument, createShape } from '../document';
import { decodeShareFragment, encodeShareFragment } from './share';
import type { ProjectData } from './project';

describe('share links', () => {
  const project = (): ProjectData => {
    let doc = createEmptyDocument();
    for (let i = 0; i < 20; i++) {
      const o = createShape(doc, i % 2 ? 'sphere' : 'box', [i * 25, 0, 10]);
      doc = produce(doc, (d) => addObjectDraft(d, o));
    }
    const m = createShape(doc, 'mesh', [0, 50, 5]);
    m.meshId = 'mesh_a';
    doc = produce(doc, (d) => addObjectDraft(d, m));
    return {
      meta: { id: 'p', name: 'Shared thing', createdAt: 1, updatedAt: 2, objectCount: 21 },
      document: doc,
      assets: {
        mesh_a: {
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
          indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
        },
      },
    };
  };

  it('round-trips the design (including mesh assets) through a URL-safe fragment', () => {
    const p = project();
    const frag = encodeShareFragment(p);
    expect(frag.startsWith('#share=')).toBe(true);
    expect(/^#share=[A-Za-z0-9_-]+$/.test(frag)).toBe(true);
    const back = decodeShareFragment(frag);
    expect(back.document).toEqual(p.document);
    expect([...back.assets.mesh_a.indices]).toEqual([...p.assets.mesh_a.indices]);
    expect(back.meta.name).toBe('Shared thing');
  });

  it('compresses well (20 objects in a few kB)', () => {
    expect(encodeShareFragment(project()).length).toBeLessThan(4000);
  });

  it('rejects damaged links with a readable message', () => {
    const frag = encodeShareFragment(project());
    expect(() => decodeShareFragment(frag.slice(0, frag.length / 2))).toThrow(/incomplete or damaged/);
    expect(() => decodeShareFragment('#other')).toThrow(/not a MODELLIO share link/);
  });
});
