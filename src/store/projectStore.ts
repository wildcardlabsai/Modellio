import { create } from 'zustand';
import { createEmptyDocument } from '@/cad/document';
import { addMeshAsset, getMeshAsset } from '@/cad/assets';
import type { MeshData } from '@/cad/kernel/meshData';
import {
  projectFromFile,
  projectToFile,
  referencedAssets,
  workspaceOf,
  type MakerProjectState,
  type ProjectData,
  type ProjectMeta,
} from '@/cad/serialization/project';
import { createDefaultRepository, type ProjectRepository, type VersionInfo } from '@/cad/serialization/repository';
import { createDraftStore, type DraftStore } from '@/cad/serialization/drafts';
import { resetProjectScope } from '@/platform/projectScope';
import { decodeShareFragment, encodeShareFragment, MAX_SHARE_CHARS, SHARE_PREFIX } from '@/cad/serialization/share';
import { useEditor } from './editorStore';
import { emptyHistory } from './history';
import { initKernel } from '@/cad/kernel/kernel';
import type { Template } from '@/templates/templates';
import { createId } from '@/utils/id';
import { downloadBlob, safeFileName } from '@/utils/download';
import { viewport } from '@/viewport/viewportBridge';
import { buildMeshDocument } from '@/cad/meshDocument';
import { useStudio, type StudioId } from '@/app/studio';
import { useMakerHandoff } from '@/platform/handoff';

export type SaveStatus = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error';

/** A question the project lifecycle needs answered by the user (shown by `ProjectPrompts`). */
export type ProjectPrompt =
  | {
      kind: 'guard';
      /** The design with unsaved changes. */
      name: string;
      /** What happens next, e.g. "open “Bracket”". */
      next: string;
      resolve: (choice: 'save' | 'discard' | 'cancel') => void;
    }
  | { kind: 'name'; title: string; action: string; initial: string; resolve: (name: string | null) => void };

interface ProjectState {
  repo: ProjectRepository | null;
  drafts: DraftStore | null;
  projects: ProjectMeta[];
  /** The design open in the Design Studio. It may be new and never saved (`savedAt` unset). */
  current: ProjectMeta | null;
  /** A maker project open in the Design Studio keeps its maker settings (one project, two views). */
  currentMaker: MakerProjectState | null;
  status: SaveStatus;
  error: string | null;
  view: 'editor' | 'projects' | 'templates';
  /** Unsaved work found for the open design (after a refresh or a closed tab), to restore or discard. */
  recovery: { id: string; name: string; updatedAt: number } | null;
  /** A question waiting for the user (Save/Discard/Cancel, a name). */
  prompt: ProjectPrompt | null;
  /** The New design and Open design dialogs. */
  dialog: 'new' | 'open' | null;
  setDialog: (d: 'new' | 'open' | null) => void;
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
  /**
   * Save: write the open design to its project. A design never saved before asks for a name
   * first. Returns false if the user cancelled or it failed.
   */
  save: () => Promise<boolean>;
  /** Save a copy under a new name: it becomes the open design, the original is left as it was. */
  saveAs: (name?: string) => Promise<boolean>;
  /** Save straight away under the current name (no questions). */
  saveNow: (opts?: { manual?: boolean }) => Promise<void>;
  listVersions: () => Promise<VersionInfo[]>;
  restoreVersion: (key: number) => Promise<void>;
  /**
   * If the open design has unsaved changes, ask: Save, Discard or Cancel. Resolves true when it
   * is fine to go on (saved, discarded or nothing to save).
   */
  confirmLeave: (next: string) => Promise<boolean>;
  /** A new, empty Design Studio design (asks about unsaved changes first). Not saved until Save. */
  newProject: (name?: string) => Promise<boolean>;
  open: (id: string) => Promise<void>;
  /** Open a project in the Design Studio, maker projects included (the same project: one project, two views). */
  openInDesign: (id: string) => Promise<boolean>;
  rename: (id: string, name: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Projects by last activity (opened or saved), newest first, each once. */
  recent: (n?: number) => ProjectMeta[];
  restoreRecovery: () => Promise<void>;
  dismissRecovery: () => Promise<void>;
  downloadProjectFile: () => Promise<void>;
  importProjectFile: (text: string) => Promise<void>;
  /**
   * Save a maker's design as a project: its settings (to reopen in the maker) and its
   * generated parts as mesh objects (to open in the Design Studio). Returns the project id.
   */
  saveMakerProject: (input: MakerSaveInput) => Promise<string>;
  /** Open any project in the workspace that made it (maker projects go to their maker). */
  openProject: (id: string) => Promise<void>;
  /** Copy a maker project into a new Design Studio project and open it there. */
  copyToDesign: (id: string) => Promise<void>;
  /** Ask the user for a project name (null: cancelled). */
  askName: (title: string, action: string, initial: string) => Promise<string | null>;
}

export interface MakerSaveInput {
  /** Update this project (if it still exists), else create one. */
  id?: string | null;
  name: string;
  studio: string;
  schema: number;
  state: unknown;
  parts: { name: string; mesh: MeshData; color?: string }[];
  thumbnail?: string;
}

const LAST_KEY = 'modellio:lastProject';
const OPENED_KEY = 'modellio:opened';
const DRAFT_MS = 1200;

/** Note that a project was just opened or saved (Recent designs). */
const markOpened = (id: string) => {
  try {
    const opened = JSON.parse(localStorage.getItem(OPENED_KEY) ?? '{}') as Record<string, number>;
    opened[id] = Date.now();
    localStorage.setItem(OPENED_KEY, JSON.stringify(opened));
  } catch {
    /* storage unavailable: not critical */
  }
};
/** The design open in the Design Studio (reopened after a refresh). */
const remember = (id: string) => {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* storage unavailable: not critical */
  }
  markOpened(id);
};
const recall = () => {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
};
const openedAt = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(OPENED_KEY) ?? '{}');
  } catch {
    return {};
  }
};

/** Snapshot of the editor as a storable project. */
function snapshot(meta: ProjectMeta, withThumbnail: boolean, maker: MakerProjectState | null): ProjectData {
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
    ...(maker ? { maker } : {}),
  };
}

/** Put a project into the editor (assets first, so meshes can render), starting from a clean slate. */
function loadIntoEditor(p: ProjectData, rememberIt = true) {
  for (const [id, mesh] of Object.entries(p.assets)) if (!getMeshAsset(id)) addMeshAsset(mesh, id);
  suppressDraft = true;
  resetProjectScope();
  useEditor.getState().loadDocument(p.document);
  suppressDraft = false;
  if (rememberIt) remember(p.meta.id);
  requestAnimationFrame(() => useEditor.getState().requestFrame());
}

/** "Untitled design", or "Untitled design 2", … whichever is not taken. */
function untitled(projects: ProjectMeta[], base = 'Untitled design') {
  const taken = new Set(projects.map((p) => p.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

const blank = (name: string, id = createId('prj')): ProjectData => {
  const now = Date.now();
  return { meta: { id, name, createdAt: now, updatedAt: now, objectCount: 0 }, document: createEmptyDocument(), assets: {} };
};

let initPromise: Promise<void> | null = null;

async function initOnce() {
  const { getState: get, setState: set } = useProjects;
  const [repo, drafts] = await Promise.all([createDefaultRepository(), createDraftStore()]);
  set({ repo, drafts });
  // Opened from a share link: show it view-only, without touching the user's projects.
  if (location.hash.startsWith(SHARE_PREFIX)) {
    try {
      const shared = decodeShareFragment(location.hash);
      set({ shared, projects: await repo.list(), status: 'saved', current: null });
      loadIntoEditor(shared, false);
      useEditor.getState().setReadOnly(true);
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
  // The editor reopens the design last open in it; maker projects open there too when that is
  // where they were last (one project, two views).
  const target = projects.find((p) => p.id === last) ?? projects.find((p) => workspaceOf(p) === 'design');
  if (target) await openStored(target.id);
  else {
    // Never saved: a new design, keeping the id of unsaved work so its draft can be recovered.
    const draft = last ? await drafts.load(last).catch(() => null) : null;
    const p = draft ? blank(draft.meta.name, draft.meta.id) : blank(untitled(projects));
    const early = useEditor.getState();
    if (!draft && early.history.past.length > 0 && !early.readOnly) {
      // The user started designing before storage was ready: keep their work (unsaved), don't wipe it.
      remember(p.meta.id);
      set({ current: p.meta, currentMaker: null, status: 'unsaved', view: 'editor', error: null, recovery: null });
      void flushDraft();
    } else switchTo(p, null);
  }
  if (repo.kind === 'memory')
    set({ error: 'Browser storage is unavailable (private mode?). Projects are kept only until you close this tab.' });
}

/** Make `p` the open design (resetting everything that belonged to the previous one). */
function switchTo(p: ProjectData, maker: MakerProjectState | null) {
  const { setState: set } = useProjects;
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = null;
  loadIntoEditor(p);
  set({ current: p.meta, currentMaker: maker, status: 'saved', view: 'editor', error: null, recovery: null });
  void offerRecovery(p.meta);
}

/** Is there unsaved work for this design from an earlier session? Offer it (never applied silently). */
async function offerRecovery(meta: ProjectMeta) {
  const { drafts } = useProjects.getState();
  if (!drafts) return;
  const info = (await drafts.list().catch(() => [])).find((d) => d.id === meta.id);
  if (!info || useProjects.getState().current?.id !== meta.id) return;
  // A draft older than the last save is stale.
  if (meta.savedAt && info.updatedAt <= meta.savedAt) {
    void drafts.remove(meta.id);
    return;
  }
  useProjects.setState({ recovery: { id: info.id, name: info.name, updatedAt: info.updatedAt } });
}

/** Load a stored project into the editor (a maker project keeps its maker settings). */
async function openStored(id: string) {
  const { repo } = useProjects.getState();
  if (!repo) return false;
  useProjects.setState({ status: 'loading' });
  try {
    const p = await repo.load(id);
    if (!p) throw new Error('Project not found');
    switchTo(p, p.maker ?? null);
    return true;
  } catch (e) {
    useProjects.setState({ status: 'error', error: `Could not open the project: ${e instanceof Error ? e.message : e}` });
    return false;
  }
}

let suppressDraft = false;
let draftTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;

/** Write the open design's recovery draft now. */
async function writeDraft() {
  const { drafts, current, currentMaker, status } = useProjects.getState();
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = null;
  if (!drafts || !current || status !== 'unsaved') return;
  try {
    await drafts.save(snapshot(current, false, currentMaker));
  } catch {
    /* recovery is best effort */
  }
}

export const useProjects = create<ProjectState>()((set, get) => ({
  repo: null,
  drafts: null,
  projects: [],
  current: null,
  currentMaker: null,
  status: 'loading',
  error: null,
  view: 'editor',
  recovery: null,
  prompt: null,
  dialog: null,
  setDialog: (dialog) => set({ dialog }),

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

  askName: (title, action, initial) =>
    new Promise((resolve) =>
      set({
        prompt: {
          kind: 'name',
          title,
          action,
          initial,
          resolve: (name) => {
            set({ prompt: null });
            resolve(name?.trim() ? name.trim() : null);
          },
        },
      }),
    ),

  saveNow: async (opts) => {
    const { repo, current, currentMaker } = get();
    if (!repo || !current) return;
    if (saving) await saving;
    const data = snapshot({ ...current, savedAt: Date.now() }, true, currentMaker);
    // A maker project changed here no longer matches what its maker would build.
    if (currentMaker && get().status === 'unsaved') data.meta.studioEdited = true;
    set({ status: 'saving' });
    saving = repo
      .save(data)
      .then(async () => {
        // Only mark saved if nothing changed while we were writing.
        const stillSame = useEditor.getState().doc === data.document;
        if (repo.versions && data.meta.objectCount > 0)
          await repo.versions.save(data.meta.id, data, opts?.manual ? 'Saved' : 'Saved automatically');
        if (stillSame)
          await get()
            .drafts?.remove(data.meta.id)
            .catch(() => undefined);
        set({ current: data.meta, status: stillSame ? 'saved' : 'unsaved', error: null });
        remember(data.meta.id);
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

  save: async () => {
    const { current } = get();
    if (!current || useEditor.getState().readOnly) return false;
    if (!current.savedAt) {
      const name = await get().askName('Save design', 'Save', current.name);
      if (!name) return false;
      set({ current: { ...get().current!, name } });
    }
    await get().saveNow({ manual: true });
    return get().status === 'saved' || get().status === 'unsaved';
  },

  saveAs: async (given) => {
    const { current, currentMaker } = get();
    if (!current) return false;
    const name = given ?? (await get().askName('Save as', 'Save copy', `${current.name} copy`));
    if (!name) return false;
    const now = Date.now();
    // The copy becomes the open design; the original project is left exactly as it was saved.
    const meta: ProjectMeta = { ...current, id: createId('prj'), name, createdAt: now, updatedAt: now };
    delete meta.savedAt;
    set({ current: meta, currentMaker });
    await get().saveNow({ manual: true });
    return get().status !== 'error';
  },

  confirmLeave: async (next) => {
    const { current, status } = get();
    if (!current || useEditor.getState().readOnly) return true;
    // A new design with nothing in it has nothing to lose.
    const empty = !current.savedAt && Object.keys(useEditor.getState().doc.objects).length === 0;
    if (status !== 'unsaved' || empty) return true;
    const choice = await new Promise<'save' | 'discard' | 'cancel'>((resolve) =>
      set({
        prompt: {
          kind: 'guard',
          name: current.name,
          next,
          resolve: (c) => {
            set({ prompt: null });
            resolve(c);
          },
        },
      }),
    );
    if (choice === 'cancel') return false;
    if (choice === 'discard') {
      await get()
        .drafts?.remove(current.id)
        .catch(() => undefined);
      return true;
    }
    return get().save();
  },

  newProject: async (name) => {
    if (!get().repo) return false;
    if (!(await get().confirmLeave('start a new design'))) return false;
    switchTo(blank(name ?? untitled(get().projects)), null);
    return true;
  },

  open: async (id) => {
    const { repo, current } = get();
    if (!repo || current?.id === id) {
      set({ view: 'editor' });
      return;
    }
    const meta = get().projects.find((p) => p.id === id);
    if (meta && workspaceOf(meta) !== 'design') {
      // A maker project belongs to its maker; the Design Studio keeps what it had.
      await get().openProject(id);
      return;
    }
    if (!(await get().confirmLeave(`open “${meta?.name ?? 'that design'}”`))) return;
    await openStored(id);
  },

  openInDesign: async (id) => {
    const { repo, current } = get();
    if (!repo) return false;
    useStudio.getState().setStudio('design');
    if (current?.id === id) {
      set({ view: 'editor' });
      return true;
    }
    const meta = get().projects.find((p) => p.id === id);
    if (!(await get().confirmLeave(`open “${meta?.name ?? 'that design'}”`))) return false;
    return openStored(id);
  },

  rename: async (id, name) => {
    const { repo, current } = get();
    const clean = name.trim();
    if (!repo || !clean) return;
    if (current?.id === id) set({ current: { ...current, name: clean } });
    // The stored project is renamed as it was saved (unsaved changes stay unsaved).
    const p = await repo.load(id);
    if (!p) return;
    await repo.save({ ...p, meta: { ...p.meta, name: clean, updatedAt: Date.now() } });
    await get().refresh();
  },

  duplicate: async (id) => {
    const { repo } = get();
    if (!repo) return;
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
    await get()
      .drafts?.remove(id)
      .catch(() => undefined);
    await get().refresh();
    if (current?.id === id) {
      // The open design was deleted: start a new one (nothing else is opened behind the user's back).
      switchTo(blank(untitled(get().projects)), null);
      set({ view: 'projects' });
    }
  },

  recent: (n = 8) => {
    const opened = openedAt();
    const last = (p: ProjectMeta) => Math.max(opened[p.id] ?? 0, p.savedAt ?? p.updatedAt);
    return [...get().projects].sort((a, b) => last(b) - last(a)).slice(0, n);
  },

  restoreRecovery: async () => {
    const { drafts, recovery, current } = get();
    if (!drafts || !recovery || current?.id !== recovery.id) return;
    const d = await drafts.load(recovery.id);
    set({ recovery: null });
    if (!d) return;
    for (const [aid, mesh] of Object.entries(d.assets)) if (!getMeshAsset(aid)) addMeshAsset(mesh, aid);
    suppressDraft = true;
    useEditor.getState().loadDocument(d.document);
    suppressDraft = false;
    // Restored, not saved: the project changes only when the user saves.
    set({ current: { ...current, name: d.meta.name }, currentMaker: d.maker ?? get().currentMaker, status: 'unsaved' });
    useEditor.getState().requestFrame();
  },

  dismissRecovery: async () => {
    const { drafts, recovery } = get();
    set({ recovery: null });
    if (drafts && recovery) await drafts.remove(recovery.id).catch(() => undefined);
  },

  createFromTemplate: async (template) => {
    if (!(await get().newProject(template.name))) return;
    const editor = useEditor.getState();
    suppressDraft = true;
    try {
      await initKernel();
      await template.build(editor);
    } finally {
      suppressDraft = false;
    }
    // The template is the starting point: nothing to undo back past.
    useEditor.setState({ history: emptyHistory(), selection: [] });
    useEditor.getState().requestFrame();
    set({ view: 'editor', status: 'unsaved' });
    scheduleDraft();
  },

  saveMakerProject: async (input) => {
    const { repo, projects } = get();
    if (!repo) throw new Error('Project storage is not ready yet.');
    const prev = input.id ? projects.find((p) => p.id === input.id) : undefined;
    if (prev?.studioEdited && repo.versions) {
      // The maker rebuilds the design: keep the version edited in the Design Studio.
      const old = await repo.load(prev.id);
      if (old) await repo.versions.save(prev.id, old, 'Design Studio edits (before the maker rebuilt it)');
    }
    const now = Date.now();
    const { document, assets } = buildMeshDocument(input.parts, input.name);
    const meta: ProjectMeta = {
      id: prev?.id ?? createId('prj'),
      name: input.name.trim() || 'Untitled',
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      savedAt: now,
      objectCount: Object.keys(document.objects).length,
      thumbnail: input.thumbnail ?? prev?.thumbnail,
      workspace: input.studio,
    };
    const data: ProjectData = { meta, document, assets, maker: { studio: input.studio, schema: input.schema, state: input.state } };
    await repo.save(data);
    markOpened(meta.id);
    // The same project open in the Design Studio (without unsaved changes) follows the maker.
    const cur = get().current;
    if (cur?.id === meta.id && get().status !== 'unsaved') switchTo(data, data.maker!);
    await get().refresh();
    return meta.id;
  },

  openProject: async (id) => {
    const { repo } = get();
    if (!repo) return;
    const p = await repo.load(id);
    if (!p) {
      useEditor.getState().notify('That project could not be found.');
      await get().refresh();
      return;
    }
    if (p.maker?.studio === 'split' && !(p.maker.state as { source?: unknown } | null)?.source) {
      // An older (or very large) split project holds only the split parts: they open in the Design Studio.
      await get().openInDesign(id);
      return;
    }
    if (p.maker) {
      markOpened(id);
      useMakerHandoff.getState().give({ projectId: p.meta.id, name: p.meta.name, ...p.maker });
      useStudio.getState().setStudio(p.maker.studio as StudioId);
      return;
    }
    useStudio.getState().setStudio('design');
    await get().open(id);
    set({ view: 'editor' });
  },

  copyToDesign: async (id) => {
    const { repo } = get();
    if (!repo) return;
    const p = await repo.load(id);
    if (!p) return;
    if (!(await get().confirmLeave(`open a copy of “${p.meta.name}”`))) return;
    const now = Date.now();
    const meta: ProjectMeta = {
      ...p.meta,
      id: createId('prj'),
      name: `${p.meta.name} (Design Studio)`,
      createdAt: now,
      updatedAt: now,
      savedAt: now,
      workspace: 'design',
    };
    delete meta.studioEdited;
    const copy: ProjectData = { meta, document: p.document, assets: p.assets };
    await repo.save(copy);
    useStudio.getState().setStudio('design');
    switchTo(copy, null);
    await get().refresh();
  },

  shared: null,

  listVersions: async () => {
    const { repo, current } = get();
    return repo?.versions && current ? repo.versions.list(current.id) : [];
  },

  restoreVersion: async (key) => {
    const { repo, current, currentMaker } = get();
    if (!repo?.versions || !current) return;
    const v = await repo.versions.load(key);
    if (!v) return;
    // Keep the present state as a version too, so restoring is never destructive.
    await repo.versions.save(current.id, snapshot(current, false, currentMaker), 'Before restore');
    for (const [id, mesh] of Object.entries(v.assets)) if (!getMeshAsset(id)) addMeshAsset(mesh, id);
    useEditor.getState().replaceDocument(v.document, 'Restore version');
    useEditor.getState().requestFrame();
  },

  shareLink: () => {
    const meta = get().current ?? get().shared?.meta;
    if (!meta) return { error: 'Nothing to share yet.' };
    const fragment = encodeShareFragment(snapshot(meta, false, null));
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
    if (target) await openStored(target.id);
    else switchTo(blank(untitled(get().projects)), null);
  },

  downloadProjectFile: async () => {
    const { current, shared, currentMaker } = get();
    if (!current && shared) {
      downloadBlob(projectToFile(shared), `${safeFileName(shared.meta.name)}.modellio`, 'application/json');
      return;
    }
    if (!current) return;
    // The file holds what is on screen (saved or not); the project itself is untouched.
    const data = snapshot(current, false, currentMaker);
    downloadBlob(projectToFile(data), `${safeFileName(current.name)}.modellio`, 'application/json');
  },

  importProjectFile: async (text) => {
    const { repo } = get();
    if (!repo) return;
    const p = projectFromFile(text); // throws ProjectFormatError with a readable message
    if (!(await get().confirmLeave(`open “${p.meta.name}”`))) return;
    const now = Date.now();
    const imported: ProjectData = { ...p, meta: { ...p.meta, id: createId('prj'), createdAt: now, updatedAt: now, savedAt: now } };
    await repo.save(imported);
    await get().refresh();
    switchTo(imported, imported.maker ?? null);
  },
}));

function scheduleDraft() {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => void writeDraft(), DRAFT_MS);
}

/** Write the draft at once (the page is being hidden or closed). */
export const flushDraft = () => writeDraft();

// Any change to the open design makes it unsaved and updates its recovery draft (never the project).
useEditor.subscribe((s, prev) => {
  if (s.doc === prev.doc || suppressDraft || s.readOnly) return;
  const p = useProjects.getState();
  if (!p.current || p.status === 'loading') return;
  if (p.status !== 'unsaved') useProjects.setState({ status: 'unsaved' });
  if (!s.transaction) scheduleDraft();
});
