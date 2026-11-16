import { vi } from 'vitest';

// Same browser globals as projectStore.test.ts.
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

const { useProjects } = await import('./projectStore');
const { useEditor } = await import('./editorStore');

describe('first visit', () => {
  it('keeps work started before project storage was ready (unsaved), instead of wiping it', async () => {
    const box = useEditor.getState().addShape('box');
    useEditor.getState().select([box]);
    await useProjects.getState().init();
    expect(useEditor.getState().doc.objects[box]).toBeTruthy();
    expect(useEditor.getState().selection).toEqual([box]);
    expect(useProjects.getState().current?.name).toBe('Untitled design');
    expect(useProjects.getState().status).toBe('unsaved');
  });
});
