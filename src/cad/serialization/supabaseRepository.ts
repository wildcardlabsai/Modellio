import type { ProjectData, ProjectMeta } from './project';
import { projectFromFile, projectToFile } from './project';
import type { ProjectRepository } from './repository';

/**
 * The subset of the Supabase client this repository uses (so it can be
 * tested with a fake, and the real client is only loaded when configured).
 */
export interface SupabaseLike {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } }> };
  from(table: 'projects'): {
    select(cols: string): {
      order(col: string, o: { ascending: boolean }): PromiseLike<{ data: ProjectRow[] | null; error: Error | null }>;
    };
    upsert(row: ProjectRow): PromiseLike<{ error: Error | null }>;
    delete(): { eq(col: string, v: string): PromiseLike<{ error: Error | null }> };
  };
  storage: {
    from(bucket: 'projects'): {
      upload(path: string, body: Blob, o: { upsert: boolean; contentType: string }): PromiseLike<{ error: Error | null }>;
      download(path: string): PromiseLike<{ data: Blob | null; error: Error | null }>;
      remove(paths: string[]): PromiseLike<{ error: Error | null }>;
    };
  };
}

export interface ProjectRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  object_count: number;
  thumbnail: string | null;
}

const toMeta = (r: ProjectRow): ProjectMeta => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  objectCount: r.object_count,
  thumbnail: r.thumbnail ?? undefined,
});

/**
 * Cloud projects: metadata in the `projects` table (row-level security limits
 * every query to the signed-in owner) and the full project file — document
 * plus meshes — in the private `projects` storage bucket.
 * See supabase/migrations/0001_projects.sql.
 */
export class SupabaseProjectRepository implements ProjectRepository {
  readonly kind = 'cloud' as const;
  constructor(private client: SupabaseLike) {}

  private async path(id: string) {
    const { data } = await this.client.auth.getUser();
    if (!data.user) throw new Error('Not signed in');
    return `${data.user.id}/${id}.modellio`;
  }

  async list(): Promise<ProjectMeta[]> {
    const { data, error } = await this.client
      .from('projects')
      .select('id,name,created_at,updated_at,object_count,thumbnail')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(toMeta);
  }

  async load(id: string): Promise<ProjectData | null> {
    const { data, error } = await this.client.storage.from('projects').download(await this.path(id));
    if (error || !data) return null;
    const p = projectFromFile(await data.text());
    const meta = (await this.list()).find((m) => m.id === id);
    return { ...p, meta: meta ?? { ...p.meta, id } };
  }

  async save(p: ProjectData): Promise<void> {
    // File first: a listed project must always have its file.
    const up = await this.client.storage
      .from('projects')
      .upload(await this.path(p.meta.id), new Blob([projectToFile(p)], { type: 'application/json' }), {
        upsert: true,
        contentType: 'application/json',
      });
    if (up.error) throw up.error;
    const { error } = await this.client.from('projects').upsert({
      id: p.meta.id,
      name: p.meta.name,
      created_at: p.meta.createdAt,
      updated_at: p.meta.updatedAt,
      object_count: p.meta.objectCount,
      thumbnail: p.meta.thumbnail ?? null,
    });
    if (error) throw error;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client.from('projects').delete().eq('id', id);
    if (error) throw error;
    await this.client.storage.from('projects').remove([await this.path(id)]);
  }
}

/** Cloud sync is available when the app was built with Supabase settings. */
export const cloudConfigured = () => !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

let clientPromise: Promise<SupabaseLike & { auth: SupabaseAuth }> | null = null;
export interface SupabaseAuth {
  getUser(): Promise<{ data: { user: { id: string; email?: string } | null } }>;
  signInWithOtp(o: { email: string; options?: { emailRedirectTo?: string } }): Promise<{ error: Error | null }>;
  signOut(): Promise<unknown>;
}

/** Lazily load the Supabase client (only when configured). */
export function getSupabase() {
  clientPromise ??= import('@supabase/supabase-js').then(
    ({ createClient }) =>
      createClient(
        import.meta.env.VITE_SUPABASE_URL as string,
        import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      ) as unknown as SupabaseLike & { auth: SupabaseAuth },
  );
  return clientPromise;
}
