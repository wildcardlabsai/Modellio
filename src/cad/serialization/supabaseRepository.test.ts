import { produce } from 'immer';
import { addObjectDraft, createEmptyDocument, createShape } from '../document';
import { SupabaseProjectRepository, type ProjectRow, type SupabaseLike } from './supabaseRepository';
import type { ProjectData } from './project';

/** In-memory stand-in for the Supabase client: table rows + storage objects, scoped to one user. */
function fakeClient(userId: string | null) {
  const rows = new Map<string, ProjectRow>();
  const files = new Map<string, Blob>();
  const client: SupabaseLike = {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: () => ({
      select: () => ({ order: async () => ({ data: [...rows.values()].sort((a, b) => b.updated_at - a.updated_at), error: null }) }),
      upsert: async (row) => (rows.set(row.id, row), { error: null }),
      delete: () => ({ eq: async (_c, v) => (rows.delete(v), { error: null }) }),
    }),
    storage: {
      from: () => ({
        upload: async (path, body) => (files.set(path, body), { error: null }),
        download: async (path) => ({ data: files.get(path) ?? null, error: files.has(path) ? null : new Error('not found') }),
        remove: async (paths) => (paths.forEach((p) => files.delete(p)), { error: null }),
      }),
    },
  };
  return { client, rows, files };
}

function project(id: string, updatedAt: number): ProjectData {
  let doc = createEmptyDocument();
  const o = createShape(doc, 'box', [0, 0, 10]);
  doc = produce(doc, (d) => addObjectDraft(d, o));
  return { meta: { id, name: `P ${id}`, createdAt: 1, updatedAt, objectCount: 1 }, document: doc, assets: {} };
}

describe('Supabase project repository (with a fake client)', () => {
  it('stores metadata in the table and the file under the owner folder, and round-trips', async () => {
    const { client, rows, files } = fakeClient('user-1');
    const repo = new SupabaseProjectRepository(client);
    const a = project('a', 5);
    await repo.save(a);
    await repo.save(project('b', 9));
    expect([...files.keys()].sort()).toEqual(['user-1/a.modellio', 'user-1/b.modellio']);
    expect(rows.get('a')?.name).toBe('P a');
    expect((await repo.list()).map((m) => m.id)).toEqual(['b', 'a']);
    const loaded = await repo.load('a');
    expect(loaded?.document).toEqual(a.document);
    expect(loaded?.meta.updatedAt).toBe(5);
  });

  it('deletes both the row and the file', async () => {
    const { client, rows, files } = fakeClient('user-1');
    const repo = new SupabaseProjectRepository(client);
    await repo.save(project('a', 5));
    await repo.remove('a');
    expect(rows.size).toBe(0);
    expect(files.size).toBe(0);
  });

  it('refuses to save when signed out', async () => {
    const repo = new SupabaseProjectRepository(fakeClient(null).client);
    await expect(repo.save(project('a', 1))).rejects.toThrow(/Not signed in/);
  });
});
