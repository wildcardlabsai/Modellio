import { create } from 'zustand';
import { createEmptyDocument } from '@/cad/document';
import { addMeshAsset, getMeshAsset } from '@/cad/assets';
import type { MeshData } from '@/cad/kernel/meshData';
import { projectFromFile, projectToFile, referencedAssets, type ProjectData, type ProjectMeta } from '@/cad/serialization/project';
import { createDefaultRepository, type ProjectRepository, type VersionInfo } from '@/cad/serialization/repository';
import { decodeShareFragment, encodeShareFragment, MAX_SHARE_CHARS, SHARE_PREFIX } from '@/cad/serialization/share';
import { useEditor } from './editorStore';
import { emptyHistory } from './history';
import { initKernel } from '@/cad/kernel/kernel';
import type { Template } from '@/templates/templates';
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
  view: 'editor' | 'projects' | 'templates';
  /** Storage protection and usage (from the StorageManager API, when available). */
  storage: { persisted: boolean; usage: number; quota: number } | null;
  refreshStorage: () => Promise<void>;

  init: () => Promise<void>;
  setView: (view: 'editor' | 'projects' | 'templates') => void;
  /** Start a new project from a template (built with real, editable operations). */
  createFromTemplate: (template: Template) => Promise<void>;
  /** A design opened from a share link (view-only until copied). */
  shared: ProjectData | null;
  /** Build a share link for the current design (null + reason if too large). */
  shareLink: () => { url: string; chars: number } | { error: string };
  copyShared: () => Promise<void>;
  closeShared: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Save immediately. `manual` (Ctrl+S) also records a version. */
  saveNow: (opts?: { manual?: boolean }) => Promise<void>;
  listVersions: () => Promise<VersionInfo[]>;
  restoreVersion: (key: number) => Promise<void>;
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
function loadIntoEditor(p: ProjectData, rememberIt = true) {
  for (const [id, mesh] of Object.entries(p.assets)) if (!getMeshAsset(id)) addMeshAsset(mesh, id);
  suppressAutosave = true;
  useEditor.getState().loadDocument(p.document);
  suppressAutosave = false;
  if (rememberIt) remember(p.meta.id);
}

let initPromise: Promise<void> | null = null;

async function initOnce() {
  const { getState: get, setState: set } = useProjects;
  const repo = await createDefaultRepository();
  set({ repo });
  // Opened from a share link: show it view-only, without touching the user's projects.
  if (location.hash.startsWith(SHARE_PREFIX)) {
    try {
      const shared = decodeShareFragment(location.hash);
      set({ shared, projects: await repo.list(), status: 'saved', current: null });
      loadIntoEditor(shared, false);
      useEditor.getState().setReadOnly(true);
      requestAnimationFrame(() => useEditor.getState().requestFrame());
      return;
    } catch (e) {
      history.replaceState(null, '', location.pathname + location.search);
      useEditor.getState().notify(e instanceof Error ? e.message : 'Could not open the share link.');
    }
  }
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
const VERSION_INTERVAL_MS = 5 * 60 * 1000;
const lastVersionAt = new Map<string, number>();
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

  saveNow: async (opts) => {
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
        // Version history: on manual saves, and at most every few minutes otherwise.
        const last = lastVersionAt.get(data.meta.id) ?? 0;
        if (repo.versions && data.meta.objectCount > 0 && (opts?.manual || Date.now() - last > VERSION_INTERVAL_MS)) {
          lastVersionAt.set(data.meta.id, Date.now());
          await repo.versions.save(data.meta.id, data, opts?.manual ? 'Saved' : 'Autosave');
        }
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

  createFromTemplate: async (template) => {
    await get().newProject(template.name);
    const editor = useEditor.getState();
    suppressAutosave = true;
    try {
      await initKernel();
      await template.build(editor);
    } finally {
      suppressAutosave = false;
    }
    // The template is the starting point: nothing to undo back past.
    useEditor.setState({ history: emptyHistory(), selection: [] });
    useEditor.getState().requestFrame();
    set({ view: 'editor', status: 'unsaved' });
    // Save once the Boolean results (and so the thumbnail) are ready.
    setTimeout(() => void get().saveNow(), 1500);
  },

  shared: null,

  listVersions: async () => {
    const { repo, current } = get();
    return repo?.versions && current ? repo.versions.list(current.id) : [];
  },

  restoreVersion: async (key) => {
    const { repo, current } = get();
    if (!repo?.versions || !current) return;
    const v = await repo.versions.load(key);
    if (!v) return;
    // Keep the present state as a version too, so restoring is never destructive.
    await repo.versions.save(current.id, snapshot(current, false), 'Before restore');
    for (const [id, mesh] of Object.entries(v.assets)) if (!getMeshAsset(id)) addMeshAsset(mesh, id);
    useEditor.getState().replaceDocument(v.document, 'Restore version');
    useEditor.getState().requestFrame();
  },

  shareLink: () => {
    const meta = get().current ?? get().shared?.meta;
    if (!meta) return { error: 'Nothing to share yet.' };
    const fragment = encodeShareFragment(snapshot(meta, false));
    if (fragment.length > MAX_SHARE_CHARS)
      return { error: 'This design is too large for a link (big imported meshes). Download the project file and send that instead.' };
    return { url: `${location.origin}${location.pathname}?studio=design${fragment}`, chars: fragment.length };
  },

  copyShared: async () => {
    const { shared } = get();
    if (!shared) return;
    useEditor.getState().setReadOnly(false);
    history.replaceState(null, '', location.pathname + location.search);
    set({ shared: null });
    await get().importProjectFile(projectToFile({ ...shared, meta: { ...shared.meta, name: `${shared.meta.name} (copy)` } }));
  },

  closeShared: async () => {
    useEditor.getState().setReadOnly(false);
    history.replaceState(null, '', location.pathname + location.search);
    set({ shared: null });
    const last = recall();
    const target = get().projects.find((p) => p.id === last) ?? get().projects[0];
    if (target) await get().open(target.id);
    else await get().newProject();
  },

  downloadProjectFile: async () => {
    const { current, shared } = get();
    if (!current && shared) {
      downloadBlob(projectToFile(shared), `${safeFileName(shared.meta.name)}.modellio`, 'application/json');
      return;
    }
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
  if (s.doc === prev.doc || suppressAutosave || s.readOnly) return;
  const p = useProjects.getState();
  if (!p.current || p.status === 'loading') return;
  if (s.transaction) {
    useProjects.setState({ status: 'unsaved' });
    return; // wait for the drag to finish
  }
  useProjects.setState({ status: 'unsaved' });
  scheduleAutosave();
});
