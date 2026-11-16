/**
 * Recovery drafts: the unsaved state of an open design, written continuously while it is edited,
 * so a refresh or a closed tab loses nothing. A draft never changes the saved project: the user
 * restores it (and saves) or discards it. Kept on this device, in a database of its own, so
 * the project database is untouched (and cloud projects get local drafts too).
 */
import type { ProjectData } from './project';

export interface DraftInfo {
  /** The project id the draft belongs to. */
  id: string;
  name: string;
  /** When the draft was written. */
  updatedAt: number;
  /** When the project was last saved (absent: never saved). */
  savedAt?: number;
}

export interface DraftStore {
  save(data: ProjectData): Promise<void>;
  load(id: string): Promise<ProjectData | null>;
  remove(id: string): Promise<void>;
  list(): Promise<DraftInfo[]>;
}

const info = (p: ProjectData): DraftInfo => ({
  id: p.meta.id,
  name: p.meta.name,
  updatedAt: Date.now(),
  ...(p.meta.savedAt ? { savedAt: p.meta.savedAt } : {}),
});

export class MemoryDraftStore implements DraftStore {
  private store = new Map<string, { info: DraftInfo; data: ProjectData }>();
  async save(p: ProjectData) {
    this.store.set(p.meta.id, { info: info(p), data: structuredClone(p) });
  }
  async load(id: string) {
    const d = this.store.get(id);
    return d ? structuredClone(d.data) : null;
  }
  async remove(id: string) {
    this.store.delete(id);
  }
  async list() {
    return [...this.store.values()].map((d) => d.info).sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export class IndexedDbDraftStore implements DraftStore {
  private db: Promise<IDBDatabase>;
  constructor(factory: IDBFactory = indexedDB, name = 'modellio-drafts') {
    this.db = new Promise((resolve, reject) => {
      const open = factory.open(name, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains('drafts')) open.result.createObjectStore('drafts', { keyPath: 'info.id' });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }
  private async store(mode: IDBTransactionMode) {
    return (await this.db).transaction('drafts', mode).objectStore('drafts');
  }
  async save(p: ProjectData) {
    await req((await this.store('readwrite')).put({ info: info(p), data: p }));
  }
  async load(id: string) {
    const d = (await req((await this.store('readonly')).get(id))) as { data: ProjectData } | undefined;
    return d?.data ?? null;
  }
  async remove(id: string) {
    await req((await this.store('readwrite')).delete(id));
  }
  async list() {
    const all = (await req((await this.store('readonly')).getAll())) as { info: DraftInfo }[];
    return all.map((d) => d.info).sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

export async function createDraftStore(): Promise<DraftStore> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB');
    const s = new IndexedDbDraftStore();
    await s.list();
    return s;
  } catch {
    return new MemoryDraftStore();
  }
}
