import { create } from 'zustand';
import { featureKey, requestKey, type BrepBuild, type BrepRequest } from './types';
import type { StepExportItem, StepExportResult, StepSolid } from './step';

/**
 * Main-thread side of the precise-solid engine. Builds are cached by request; while a new build
 * is on its way the previous build of the same recipe is shown (so resizing never flickers).
 */
export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';
export const useBrepEngine = create<{ status: EngineStatus }>(() => ({ status: 'idle' }));

type Entry = { state: 'pending' } | { state: 'ready'; build: BrepBuild } | { state: 'error'; message: string };

const cache = new Map<string, Entry>();
const CACHE_LIMIT = 64;
/** Latest finished build per recipe (any size): shown while a resized version is built. */
const lastByRecipe = new Map<string, BrepBuild>();
const listeners = new Set<() => void>();
const waiters = new Map<string, { resolve: (b: BrepBuild) => void; reject: (e: Error) => void }[]>();

/**
 * What waits in the queue goes in this order: tool previews the user is watching, then builds for
 * the 3D view, then one-off jobs (STEP export / import), which can take long and are awaited
 * behind a progress message anyway. A job that has started always runs to the end (stopping the
 * engine mid-build would mean reloading it).
 */
export type BrepPriority = 'interactive' | 'scene';

/** Thrown to callers whose queued request was replaced by a newer one in the same lane. */
export class SupersededError extends Error {
  constructor() {
    super('Replaced by a newer request.');
    this.name = 'SupersededError';
  }
}

type Queued = { key: string; req: BrepRequest; priority: BrepPriority };

let worker: Worker | null = null;
let seq = 0;
const inflight = new Map<number, Queued>();
/** One-off jobs (STEP export / import): run after the builds that are waiting. */
const jobs = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const jobQueue: { id: number; message: object; transfer: Transferable[] }[] = [];
/** Not yet sent: at most one per recipe (a newer size replaces an older one). */
const queued = new Map<string, Queued>();
/** Lanes: the latest not-yet-started request key per lane (e.g. the fillet preview). */
const lanes = new Map<string, string>();
let busy = false;

let makeWorker: () => Worker | null = () =>
  typeof Worker === 'undefined' ? null : new Worker(new URL('./brep.worker.ts', import.meta.url), { type: 'module' });

/** Tests only: run the client against a stand-in worker, starting from an empty queue and cache. */
export function __setWorkerFactory(factory: () => Worker | null) {
  makeWorker = factory;
  worker = null;
  busy = false;
  for (const m of [cache, lastByRecipe, waiters, inflight, jobs, queued, lanes]) m.clear();
  jobQueue.length = 0;
}

const recipeKey = (req: BrepRequest) => featureKey(req.recipe);

export function onBrepResult(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getWorker(): Worker | null {
  if (worker) return worker;
  worker = makeWorker();
  if (!worker) return null;
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data as { type: 'status'; status: EngineStatus } | { type: 'result'; id: number; res?: BrepBuild; error?: string };
    if (m.type === 'status') {
      useBrepEngine.setState({ status: m.status });
      return;
    }
    busy = false;
    const oneOff = jobs.get(m.id);
    if (oneOff) {
      jobs.delete(m.id);
      if (m.error) oneOff.reject(new Error(m.error));
      else oneOff.resolve(m.res);
      pump();
      return;
    }
    const job = inflight.get(m.id);
    inflight.delete(m.id);
    if (job) settle(job.key, job.req, m.res ? { state: 'ready', build: m.res } : { state: 'error', message: m.error ?? 'Build failed.' });
    pump();
  };
  worker.onerror = () => {
    // The worker died (e.g. out of memory): fail what was running and start a fresh one next time.
    useBrepEngine.setState({ status: 'error' });
    for (const job of inflight.values())
      settle(job.key, job.req, { state: 'error', message: 'The precise-solid engine stopped (out of memory?). Try again.' });
    inflight.clear();
    worker?.terminate();
    worker = null;
    busy = false;
    pump();
  };
  return worker;
}

function settle(key: string, req: BrepRequest, entry: Entry) {
  cache.set(key, entry);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  if (entry.state === 'ready') lastByRecipe.set(recipeKey(req), entry.build);
  if (lastByRecipe.size > CACHE_LIMIT) lastByRecipe.delete(lastByRecipe.keys().next().value!);
  for (const w of waiters.get(key) ?? []) {
    if (entry.state === 'ready') w.resolve(entry.build);
    else if (entry.state === 'error') w.reject(new Error(entry.message));
  }
  waiters.delete(key);
  listeners.forEach((cb) => cb());
}

/** The next waiting build: the oldest interactive one, else the oldest scene one. */
function nextBuild(): [string, Queued] | null {
  let scene: [string, Queued] | null = null;
  for (const entry of queued) {
    if (entry[1].priority === 'interactive') return entry;
    scene ??= entry;
  }
  return scene;
}

function pump() {
  if (busy) return;
  const next = nextBuild();
  if (!next) {
    const oneOff = jobQueue.shift();
    if (!oneOff) return;
    const w = getWorker();
    if (!w) {
      jobs.get(oneOff.id)?.reject(new Error('This browser cannot run the precise-solid engine.'));
      jobs.delete(oneOff.id);
      return;
    }
    busy = true;
    w.postMessage({ id: oneOff.id, ...oneOff.message }, oneOff.transfer);
    return;
  }
  const [rk, job] = next;
  queued.delete(rk);
  for (const [lane, key] of lanes) if (key === job.key) lanes.delete(lane);
  const w = getWorker();
  if (!w) {
    settle(job.key, job.req, { state: 'error', message: 'This browser cannot run the precise-solid engine.' });
    return;
  }
  const id = ++seq;
  inflight.set(id, job);
  busy = true;
  w.postMessage({ id, type: 'build', req: job.req });
}

function enqueue(key: string, req: BrepRequest, priority: BrepPriority = 'scene') {
  const rk = recipeKey(req);
  const older = queued.get(rk);
  if (older && older.key !== key) {
    // Superseded before it started: forget it so it is requested again if it is ever needed.
    cache.delete(older.key);
    const moved = waiters.get(older.key) ?? [];
    if (moved.length) waiters.set(key, [...(waiters.get(key) ?? []), ...moved]);
    waiters.delete(older.key);
  }
  cache.set(key, { state: 'pending' });
  // The same recipe asked for by a tool and by the 3D view keeps the higher priority.
  const raised = older?.priority === 'interactive' ? 'interactive' : priority;
  queued.set(rk, { key, req, priority: raised });
  pump();
}

/** Drop a request that has not started: its waiters get a SupersededError. */
function cancelQueued(key: string) {
  for (const [rk, q] of queued)
    if (q.key === key) {
      queued.delete(rk);
      cache.delete(key);
      for (const w of waiters.get(key) ?? []) w.reject(new SupersededError());
      waiters.delete(key);
      return;
    }
}

/**
 * The build for a request, starting it if needed. While it is pending, `fallback` is the last
 * build of the same recipe at another size (or null).
 */
export function getBrep(req: BrepRequest, opts: { lane?: string } = {}): { entry: Entry; fallback: BrepBuild | null } {
  const key = requestKey(req);
  let entry = cache.get(key);
  if (!entry) {
    // A newer request in the same lane (e.g. a combination whose part is being dragged) replaces
    // an older one that has not started, so only the latest is built.
    if (opts.lane) {
      const previous = lanes.get(opts.lane);
      if (previous && previous !== key) cancelQueued(previous);
      lanes.set(opts.lane, key);
    }
    enqueue(key, req);
    entry = cache.get(key)!;
  }
  return { entry, fallback: entry.state === 'ready' ? null : (lastByRecipe.get(recipeKey(req)) ?? null) };
}

/**
 * Build a request and wait for it (for previews, conversions and checks). These are interactive:
 * they go ahead of builds for the 3D view. With a `lane`, a newer request in the same lane cancels
 * this one if it has not started yet (it rejects with a SupersededError), so dragging a value
 * builds only the latest preview instead of every step on the way.
 */
export function buildBrepAsync(req: BrepRequest, opts: { lane?: string } = {}): Promise<BrepBuild> {
  const key = requestKey(req);
  const hit = cache.get(key);
  if (hit?.state === 'ready') return Promise.resolve(hit.build);
  if (hit?.state === 'error') cache.delete(key);
  if (opts.lane) {
    const previous = lanes.get(opts.lane);
    if (previous && previous !== key) cancelQueued(previous);
    lanes.set(opts.lane, key);
  }
  return new Promise((resolve, reject) => {
    if (!waiters.has(key)) waiters.set(key, []);
    waiters.get(key)!.push({ resolve, reject });
    if (cache.get(key)?.state !== 'pending') enqueue(key, req, 'interactive');
    else {
      // Already waiting for the 3D view: move it up.
      for (const q of queued.values()) if (q.key === key) q.priority = 'interactive';
    }
  });
}

function runJob<T>(message: object, transfer: Transferable[] = []): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    jobs.set(id, { resolve: resolve as (v: unknown) => void, reject });
    jobQueue.push({ id, message, transfer });
    pump();
  });
}

/** Write a STEP file in the engine worker. */
export function exportStepInWorker(items: StepExportItem[]): Promise<StepExportResult> {
  const transfer = items.flatMap((i) => (i.kind === 'mesh' ? [i.positions.buffer, i.indices.buffer] : []));
  return runJob({ type: 'export-step', items }, transfer);
}

/** Read the solids of a STEP file in the engine worker. */
export function importStepInWorker(bytes: Uint8Array, name: string): Promise<StepSolid[]> {
  return runJob({ type: 'import-step', bytes, name }, [bytes.buffer]);
}

/** Store a build that was made elsewhere (e.g. while importing a STEP file) so it is not rebuilt. */
export function primeBrep(req: BrepRequest, build: BrepBuild) {
  settle(requestKey(req), req, { state: 'ready', build });
}
