import type { ProjectData, ProjectMeta } from './project';

/**
 * Storage backend for projects. The app only talks to this interface, so a
 * cloud implementation (e.g. Supabase: auth + `projects` table + storage
 * bucket for meshes) can be added later without touching the editor.
 */
export interface ProjectRepository {
  readonly kind: 'indexeddb' | 'memory' | 'cloud';
  /** Most recently updated first. */
  list(): Promise<ProjectMeta[]>;
  load(id: string): Promise<ProjectData | null>;
  save(project: ProjectData): Promise<void>;
  remove(id: string): Promise<void>;
}

// ---------- IndexedDB ----------

const DB_NAME = 'modellio';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

/**
 * Two stores: `meta` (small rows for fast listing, with thumbnails) and
 * `data` (document + mesh assets as typed arrays — stored natively, no
 * encoding). Both are written in one transaction so they never disagree.
 */
export class IndexedDbProjectRepository implements ProjectRepository {
  readonly kind = 'indexeddb' as const;
  private db: Promise<IDBDatabase>;

  constructor(factory: IDBFactory = indexedDB, name = DB_NAME) {
    this.db = new Promise((resolve, reject) => {
      const open = factory.open(name, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('The project database is blocked by another tab.'));
    });
  }

  async list(): Promise<ProjectMeta[]> {
    const db = await this.db;
    const all = await req(db.transaction('meta').objectStore('meta').getAll() as IDBRequest<ProjectMeta[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<ProjectData | null> {
    const db = await this.db;
    const tx = db.transaction(['meta', 'data']);
    const [meta, data] = await Promise.all([
      req(tx.objectStore('meta').get(id) as IDBRequest<ProjectMeta | undefined>),
      req(tx.objectStore('data').get(id) as IDBRequest<Omit<ProjectData, 'meta'> | undefined>),
    ]);
    if (!meta || !data) return null;
    return { meta, document: data.document, assets: data.assets };
  }

  async save(p: ProjectData): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['meta', 'data'], 'readwrite');
    tx.objectStore('meta').put(p.meta);
    tx.objectStore('data').put({ document: p.document, assets: p.assets }, p.meta.id);
    await txDone(tx);
  }

  async remove(id: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['meta', 'data'], 'readwrite');
    tx.objectStore('meta').delete(id);
    tx.objectStore('data').delete(id);
    await txDone(tx);
  }
}

// ---------- in-memory fallback (private browsing without IndexedDB, tests) ----------

export class MemoryProjectRepository implements ProjectRepository {
  readonly kind = 'memory' as const;
  private store = new Map<string, ProjectData>();
  async list() {
    return [...this.store.values()].map((p) => p.meta).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async load(id: string) {
    const p = this.store.get(id);
    return p ? structuredClone(p) : null;
  }
  async save(p: ProjectData) {
    this.store.set(p.meta.id, structuredClone(p));
  }
  async remove(id: string) {
    this.store.delete(id);
  }
}

/** Pick the best available backend. */
export async function createDefaultRepository(): Promise<ProjectRepository> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB');
    const repo = new IndexedDbProjectRepository();
    await repo.list(); // fails fast if storage is blocked
    return repo;
  } catch {
    return new MemoryProjectRepository();
  }
}
