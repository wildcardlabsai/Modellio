import { vi } from 'vitest';

// Same browser globals as projectStore.test.ts, plus a storage check we can hold open, so the
// project store's start-up is still running when a project is opened.
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});
vi.stubGlobal('location', { hash: '', pathname: '/', search: '', origin: 'http://test' });
vi.stubGlobal('requestAnimationFrame', (f: () => void) => f());
vi.stubGlobal('window', {
  location: { href: 'http://test/' },
  history: { pushState: () => undefined },
  scrollTo: () => undefined,
  addEventListener: () => undefined,
});
let release!: () => void;
const gate = new Promise<boolean>((r) => (release = () => r(true)));
vi.stubGlobal('navigator', { storage: { persisted: () => gate, persist: async () => true } });

const { useProjects } = await import('./projectStore');
const { useEditor } = await import('./editorStore');
const { createEmptyDocument, addObjectDraft, createShape } = await import('@/cad/document');
const { produce } = await import('immer');

describe('start-up race', () => {
  it('a project opened while start-up is still running stays open (start-up does not replace it)', async () => {
    const starting = useProjects.getState().init();
    for (let i = 0; i < 100 && !useProjects.getState().repo; i++) await new Promise((r) => setTimeout(r, 1));
    const repo = useProjects.getState().repo!;
    // A maker project (so start-up would otherwise open a new blank design instead).
    const doc = produce(createEmptyDocument(), (d) => void addObjectDraft(d, createShape(d, 'box')));
    const now = Date.now();
    await repo.save({
      meta: { id: 'prj_vase', name: 'Studio vase', createdAt: now, updatedAt: now, objectCount: 1, workspace: 'vase', savedAt: now },
      document: doc,
      assets: {},
      maker: { studio: 'vase', schema: 1, state: {} },
    });
    await useProjects.getState().refresh();
    expect(await useProjects.getState().openInDesign('prj_vase')).toBe(true);
    release();
    await starting;
    expect(useProjects.getState().current?.id).toBe('prj_vase');
    expect(useEditor.getState().doc.rootIds).toHaveLength(1);
  });

  it('start-up opening the last design does not replace one the user opened while it was loading', async () => {
    const repo = useProjects.getState().repo!;
    const now = Date.now();
    const other = produce(createEmptyDocument(), (d) => {
      addObjectDraft(d, createShape(d, 'box'));
      addObjectDraft(d, createShape(d, 'sphere'));
    });
    await repo.save({
      meta: { id: 'prj_other', name: 'Other', createdAt: now, updatedAt: now, objectCount: 2, savedAt: now },
      document: other,
      assets: {},
    });
    await repo.save({
      meta: { id: 'prj_third', name: 'Third', createdAt: now, updatedAt: now, objectCount: 2, savedAt: now },
      document: other,
      assets: {},
    });
    await useProjects.getState().refresh();
    // A second start-up (as after a reload) whose load of the last design is slow.
    const { openUnlessSwitched } = await import('./projectStore');
    let releaseLoad!: () => void;
    const held = new Promise<void>((r) => (releaseLoad = r));
    const load = repo.load.bind(repo);
    repo.load = async (id: string) => {
      if (id === 'prj_other') await held;
      return load(id);
    };
    const startup = openUnlessSwitched('prj_other');
    expect(await useProjects.getState().openInDesign('prj_third')).toBe(true);
    releaseLoad();
    expect(await startup).toBe(false);
    expect(useProjects.getState().current?.id).toBe('prj_third');
    repo.load = load;
  });
});
