import { vi } from 'vitest';

// The project store runs in the browser: give it the few globals it reads.
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

const { useProjects, flushDraft } = await import('./projectStore');
const { useEditor } = await import('./editorStore');
const { useSketchSession } = await import('@/components/sketch/sketchSession');
const { useHover } = await import('@/viewport/hover');
const { projectScopeNames } = await import('@/platform/projectScope');

const P = () => useProjects.getState();
const E = () => useEditor.getState();
/** Wait for the store to ask something, then answer it. */
async function answer(kind: 'guard' | 'name', value: string | null) {
  for (let i = 0; i < 200 && P().prompt?.kind !== kind; i++) await new Promise((r) => setTimeout(r, 5));
  const p = P().prompt;
  if (!p || p.kind !== kind) throw new Error(`no ${kind} prompt`);
  if (p.kind === 'guard') p.resolve(value as 'save' | 'discard' | 'cancel');
  else p.resolve(value);
}
const stored = (id: string) => P().repo!.load(id);

beforeAll(async () => {
  await P().init();
});

describe('project lifecycle (explicit save, recovery drafts)', () => {
  it('starts with a new design that is not saved anywhere yet', () => {
    expect(P().current?.name).toBe('Untitled design');
    expect(P().current?.savedAt).toBeUndefined();
    expect(P().projects).toHaveLength(0);
    expect(P().status).toBe('saved');
  });

  it('changes make it unsaved and go to a recovery draft, never to a project', async () => {
    E().addShape('box');
    expect(P().status).toBe('unsaved');
    await flushDraft();
    expect((await P().drafts!.list()).map((d) => d.id)).toEqual([P().current!.id]);
    expect(await P().repo!.list()).toHaveLength(0);
  });

  it('the first Save asks for a name, writes the project and clears the draft', async () => {
    const saving = P().save();
    await answer('name', 'Bracket');
    expect(await saving).toBe(true);
    const id = P().current!.id;
    expect((await stored(id))?.meta).toMatchObject({ name: 'Bracket', objectCount: 1 });
    expect(P().current?.savedAt).toBeGreaterThan(0);
    expect(P().status).toBe('saved');
    expect(await P().drafts!.list()).toHaveLength(0);
    // Later saves don't ask again.
    E().addShape('sphere');
    expect(await P().save()).toBe(true);
    expect(P().prompt).toBeNull();
    expect((await stored(id))?.meta.objectCount).toBe(2);
  });

  it('Save As makes an independent project and leaves the original as saved', async () => {
    const original = P().current!.id;
    E().addShape('cone');
    const ok = P().saveAs();
    await answer('name', 'Bracket v2');
    expect(await ok).toBe(true);
    expect(P().current!.id).not.toBe(original);
    expect((await stored(original))?.meta.objectCount).toBe(2);
    expect((await stored(P().current!.id))?.meta).toMatchObject({ name: 'Bracket v2', objectCount: 3 });
  });

  it('leaving unsaved work asks Save / Discard / Cancel, and Cancel keeps everything', async () => {
    const id = P().current!.id;
    E().addShape('box');
    const going = P().newProject();
    await answer('guard', 'cancel');
    expect(await going).toBe(false);
    expect(P().current!.id).toBe(id);
    expect(P().status).toBe('unsaved');
  });

  it('Discard starts the new design without touching the saved project; nothing leaks across', async () => {
    const id = P().current!.id;
    const before = (await stored(id))!.meta.objectCount;
    E().select(Object.keys(E().doc.objects).slice(0, 1));
    useSketchSession.getState().open(null);
    useHover.getState().set(Object.keys(E().doc.objects));
    E().setTool('measure');
    const going = P().newProject();
    await answer('guard', 'discard');
    expect(await going).toBe(true);
    expect(P().current!.id).not.toBe(id);
    expect(P().current!.name).toBe('Untitled design');
    expect((await stored(id))!.meta.objectCount).toBe(before);
    // A clean slate: no geometry, selection, tool, sketch, hover or history from before.
    expect(Object.keys(E().doc.objects)).toHaveLength(0);
    expect(E().selection).toEqual([]);
    expect(E().tool).toBe('select');
    expect(E().history.past).toHaveLength(0);
    expect(useSketchSession.getState().editing).toBeNull();
    expect(useHover.getState().ids).toEqual([]);
  });

  it('opening a project switches to it, and Recent lists by last activity', async () => {
    const all = await P().repo!.list();
    const bracket = all.find((p) => p.name === 'Bracket')!;
    await P().open(bracket.id);
    expect(P().current!.id).toBe(bracket.id);
    expect(Object.keys(E().doc.objects)).toHaveLength(2);
    expect(E().history.past).toHaveLength(0);
    expect(P().recent()[0].id).toBe(bracket.id);
    expect(
      new Set(
        P()
          .recent()
          .map((p) => p.id),
      ).size,
    ).toBe(P().recent().length);
  });

  it('unsaved work found later is offered back, and restoring does not save it', async () => {
    const id = P().current!.id;
    const saved = (await stored(id))!;
    // A draft newer than the save (as if the tab had been closed with unsaved changes).
    E().addShape('torus');
    await flushDraft();
    // As if the tab had closed: the in-memory changes are gone, the draft is not.
    useProjects.setState({ status: 'saved' });
    const other = (await P().repo!.list()).find((p) => p.id !== id)!;
    await P().open(other.id);
    await P().open(id);
    for (let i = 0; i < 100 && !P().recovery; i++) await new Promise((r) => setTimeout(r, 5));
    expect(P().recovery?.id).toBe(id);
    expect(Object.keys(E().doc.objects)).toHaveLength(saved.meta.objectCount);
    await P().restoreRecovery();
    expect(Object.keys(E().doc.objects)).toHaveLength(saved.meta.objectCount + 1);
    expect(P().status).toBe('unsaved');
    expect((await stored(id))!.meta.objectCount).toBe(saved.meta.objectCount);
  });

  it('renaming, duplicating and deleting the open design', async () => {
    const id = P().current!.id;
    await P().rename(id, 'Bracket final');
    expect(P().current!.name).toBe('Bracket final');
    expect((await stored(id))!.meta.name).toBe('Bracket final');
    await P().duplicate(id);
    expect(P().projects.some((p) => p.name === 'Bracket final (copy)')).toBe(true);
    await P().remove(id);
    expect(await stored(id)).toBeNull();
    expect(P().current!.id).not.toBe(id);
    expect(Object.keys(E().doc.objects)).toHaveLength(0);
  });

  it('a maker project opens in the Design Studio as the same project, keeping its maker settings', async () => {
    const mesh = {
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]),
      indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
    };
    const id = await P().saveMakerProject({
      name: 'Gift tag',
      studio: 'keyring',
      schema: 1,
      state: { params: { a: 1 } },
      parts: [{ name: 'Base', mesh }],
    });
    expect(await P().openInDesign(id)).toBe(true);
    expect(P().current!.id).toBe(id);
    expect(P().currentMaker).toMatchObject({ studio: 'keyring', state: { params: { a: 1 } } });
    // Edit and save in the Design Studio: the same project, marked as changed there.
    E().addShape('box');
    await P().save();
    const after = (await stored(id))!;
    expect(after.maker?.state).toEqual({ params: { a: 1 } });
    expect(after.meta.studioEdited).toBe(true);
    expect(P().projects.filter((p) => p.name === 'Gift tag')).toHaveLength(1);
    // Saving it again from the maker rebuilds it and clears the mark.
    await P().saveMakerProject({
      id,
      name: 'Gift tag',
      studio: 'keyring',
      schema: 1,
      state: { params: { a: 2 } },
      parts: [{ name: 'Base', mesh }],
    });
    expect((await stored(id))!.meta.studioEdited).toBeUndefined();
  });

  it('every per-project store is registered for the reset on switching', async () => {
    // Each registers when its module loads (the Design Studio loads them all).
    await Promise.all([
      import('@/components/features/featureTool'),
      import('@/components/sketch/facePick'),
      import('@/components/features/solidBuilder'),
      import('@/viewport/guides'),
      import('@/components/inspector/inspectorTab'),
      import('@/components/files/fileIntake'),
      import('@/components/print/printCheck'),
    ]);
    expect(projectScopeNames().sort()).toEqual(
      [
        'editor',
        'face-pick',
        'feature-tool',
        'file-ui',
        'guides',
        'hover',
        'inspector-tab',
        'print-check',
        'sketch-session',
        'solid-builder',
      ].sort(),
    );
  });
});
