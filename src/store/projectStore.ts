import { create } from 'zustand';
import { createEmptyDocument } from '@/cad/document';
import { addMeshAsset, getMeshAsset } from '@/cad/assets';
import type { MeshData } from '@/cad/kernel/meshData';
import { projectFromFile, projectToFile, referencedAssets, type ProjectData, type ProjectMeta } from '@/cad/serialization/project';
import { createDefaultRepository, type ProjectRepository } from '@/cad/serialization/repository';
import { useEditor } from './editorStore';
import { createId } from '@/utils/id';
import { downloadBlob, safeFileName } from '@/utils/download';
import { viewport } from '@/viewport/viewportBridge';

export type SaveStatus = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error';

interface ProjectState {
  repo: ProjectRepository | null;
  projects: ProjectMeta[];
  current: ProjectMeta | null;
  status: SaveStatus;
  error: string | null;
  view: 'editor' | 'projects';
  /** Storage protection and usage (from the StorageManager API, when available). */
  storage: { persisted: boolean; usage: number; quota: number } | null;
  refreshStorage: () => Promise<void>;

  init: () => Promise<void>;
  setView: (view: 'editor' | 'projects') => void;
  refresh: () => Promise<void>;
  saveNow: () => Promise<void>;
  newProject: (name?: string) => Promise<void>;
  open: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  downloadProjectFile: () => Promise<void>;
  importProjectFile: (text: string) => Promise<void>;
}

const LAST_KEY = 'modellio:lastProject';
const AUTOSAVE_MS = 1200;

const remember = (id: string) => {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* storage unavailable: not critical */
  }
};
const recall = () => {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
};

/** Snapshot of the editor as a storable project. */
function snapshot(meta: ProjectMeta, withThumbnail: boolean): ProjectData {
  const doc = useEditor.getState().doc;
  const assets: Record<string, MeshData> = {};
  for (const id of referencedAssets(doc)) {
    const a = getMeshAsset(id);
    if (a) assets[id] = a;
  }
  const thumbnail = withThumbnail ? (viewport.captureThumbnail?.() ?? meta.thumbnail) : meta.thumbnail;
  return {
    meta: { ...meta, updatedAt: Date.now(), objectCount: Object.keys(doc.objects).length, thumbnail },
    document: doc,
    assets,
  };
}

/** Put a loaded project into the editor (assets first, so meshes can render). */
function loadIntoEditor(p: ProjectData) {
  for (const [id, mesh] of Object.entries(p.assets)) if (!getMeshAsset(id)) addMeshAsset(mesh, id);
  suppressAutosave = true;
  useEditor.getState().loadDocument(p.document);
  suppressAutosave = false;
  remember(p.meta.id);
}

let initPromise: Promise<void> | null = null;

async function initOnce() {
  const { getState: get, setState: set } = useProjects;
  const repo = await createDefaultRepository();
  set({ repo });
  // Ask the browser not to evict our data under storage pressure (best effort).
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported */
  }
  void get().refreshStorage();
  const projects = await repo.list();
  set({ projects });
  const last = recall();
  const target = projects.find((p) => p.id === last) ?? projects[0];
  if (target) await get().open(target.id);
  else await get().newProject();
  if (repo.kind === 'memory')
    set({ error: 'Browser storage is unavailable (private mode?). Projects are kept only until you close this tab.' });
}

let suppressAutosave = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;

export const useProjects = create<ProjectState>()((set, get) => ({
  repo: null,
  projects: [],
  current: null,
  status: 'loading',
  error: null,
  view: 'editor',

  // Idempotent: React StrictMode (and hot reloads) may call it more than once.
  init: () => (initPromise ??= initOnce()),

  storage: null,
  refreshStorage: async () => {
    try {
      if (!navigator.storage?.estimate) return;
      const [est, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted?.() ?? Promise.resolve(false)]);
      set({ storage: { persisted, usage: est.usage ?? 0, quota: est.quota ?? 0 } });
    } catch {
      /* not supported */
    }
  },

  setView: (view) => set({ view }),

  refresh: async () => {
    const repo = get().repo;
    if (repo) set({ projects: await repo.list() });
  },

  saveNow: async () => {
    const { repo, current } = get();
    if (!repo || !current) return;
    if (timer) clearTimeout(timer);
    timer = null;
    if (saving) await saving;
    const data = snapshot(current, true);
    set({ status: 'saving' });
    saving = repo
      .save(data)
      .then(async () => {
        // Only mark saved if nothing changed while we were writing.
        const stillSame = useEditor.getState().doc === data.document;
        set({ current: data.meta, status: stillSame ? 'saved' : 'unsaved', error: null });
        if (!stillSame) scheduleAutosave();
        await get().refresh();
      })
      .catch((e) => {
        const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
        set({
          status: 'error',
          error: quota
            ? 'Browser storage is full, so this design could not be saved. Download a project file as a backup, then delete old projects in My Projects.'
            : `Saving failed: ${e instanceof Error ? e.message : e}`,
        });
        useEditor.getState().notify(quota ? 'Storage is full: design not saved. Download a backup.' : 'Saving failed.');
      })
      .finally(() => {
        saving = null;
      });
    await saving;
  },

  newProject: async (name = 'Untitled design') => {
    const { repo, current, status } = get();
    if (!repo) return;
    if (current && status !== 'saved') await get().saveNow();
    const now = Date.now();
    const meta: ProjectMeta = { id: createId('prj'), name, createdAt: now, updatedAt: now, objectCount: 0 };
    const p: ProjectData = { meta, document: createEmptyDocument(), assets: {} };
    await repo.save(p);
    loadIntoEditor(p);
    set({ current: meta, status: 'saved', view: 'editor' });
    await get().refresh();
  },

  open: async (id) => {
    const { repo, current, status } = get();
    if (!repo) return;
    if (current && current.id !== id && status !== 'saved') await get().saveNow();
    set({ status: 'loading' });
    try {
      const p = await repo.load(id);
      if (!p) throw new Error('Project not found');
      loadIntoEditor(p);
      set({ current: p.meta, status: 'saved', view: 'editor', error: null });
      requestAnimationFrame(() => useEditor.getState().requestFrame());
    } catch (e) {
      set({ status: 'error', error: `Could not open the project: ${e instanceof Error ? e.message : e}` });
    }
  },

  rename: async (id, name) => {
    const { repo, current } = get();
    const clean = name.trim();
    if (!repo || !clean) return;
    if (current?.id === id) {
      set({ current: { ...current, name: clean } });
      await get().saveNow();
      return;
    }
    const p = await repo.load(id);
    if (!p) return;
    await repo.save({ ...p, meta: { ...p.meta, name: clean, updatedAt: Date.now() } });
    await get().refresh();
  },

  duplicate: async (id) => {
    const { repo, current } = get();
    if (!repo) return;
    if (current?.id === id) await get().saveNow();
    const p = await repo.load(id);
    if (!p) return;
    const now = Date.now();
    await repo.save({ ...p, meta: { ...p.meta, id: createId('prj'), name: `${p.meta.name} (copy)`, createdAt: now, updatedAt: now } });
    await get().refresh();
  },

  remove: async (id) => {
    const { repo, current } = get();
    if (!repo) return;
    await repo.remove(id);
    await get().refresh();
    if (current?.id === id) {
      set({ current: null });
      const next = get().projects[0];
      if (next) await get().open(next.id);
      else await get().newProject();
      set({ view: 'projects' });
    }
  },

  downloadProjectFile: async () => {
    const { current } = get();
    if (!current) return;
    await get().saveNow();
    const data = snapshot(get().current!, false);
    downloadBlob(projectToFile(data), `${safeFileName(current.name)}.modellio`, 'application/json');
  },

  importProjectFile: async (text) => {
    const { repo } = get();
    if (!repo) return;
    const p = projectFromFile(text); // throws ProjectFormatError with a readable message
    const now = Date.now();
    const imported: ProjectData = { ...p, meta: { ...p.meta, id: createId('prj'), createdAt: now, updatedAt: now } };
    await repo.save(imported);
    await get().refresh();
    await get().open(imported.meta.id);
  },
}));

function scheduleAutosave() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void useProjects.getState().saveNow(), AUTOSAVE_MS);
}

// Autosave: any document change marks the project dirty and saves shortly after.
useEditor.subscribe((s, prev) => {
  if (s.doc === prev.doc || suppressAutosave) return;
  const p = useProjects.getState();
  if (!p.current || p.status === 'loading') return;
  if (s.transaction) {
    useProjects.setState({ status: 'unsaved' });
    return; // wait for the drag to finish
  }
  useProjects.setState({ status: 'unsaved' });
  scheduleAutosave();
});
