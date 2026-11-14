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

let worker: Worker | null = null;
let seq = 0;
const inflight = new Map<number, { key: string; req: BrepRequest }>();
/** One-off jobs (STEP export / import): run in order with the builds. */
const jobs = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const jobQueue: { id: number; message: object; transfer: Transferable[] }[] = [];
/** Not yet sent: at most one per recipe (a newer size replaces an older one). */
const queued = new Map<string, { key: string; req: BrepRequest }>();
let busy = false;

const recipeKey = (req: BrepRequest) => featureKey(req.recipe);

export function onBrepResult(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  worker = new Worker(new URL('./brep.worker.ts', import.meta.url), { type: 'module' });
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

function pump() {
  if (busy) return;
  const oneOff = jobQueue.shift();
  if (oneOff) {
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
  const next = queued.entries().next();
  if (next.done) return;
  const [rk, job] = next.value;
  queued.delete(rk);
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

function enqueue(key: string, req: BrepRequest) {
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
  queued.set(rk, { key, req });
  pump();
}

/**
 * The build for a request, starting it if needed. While it is pending, `fallback` is the last
 * build of the same recipe at another size (or null).
 */
export function getBrep(req: BrepRequest): { entry: Entry; fallback: BrepBuild | null } {
  const key = requestKey(req);
  let entry = cache.get(key);
  if (!entry) {
    enqueue(key, req);
    entry = cache.get(key)!;
  }
  return { entry, fallback: entry.state === 'ready' ? null : (lastByRecipe.get(recipeKey(req)) ?? null) };
}

/** Build a request and wait for it (for previews, conversions and checks). */
export function buildBrepAsync(req: BrepRequest): Promise<BrepBuild> {
  const key = requestKey(req);
  const hit = cache.get(key);
  if (hit?.state === 'ready') return Promise.resolve(hit.build);
  if (hit?.state === 'error') cache.delete(key);
  return new Promise((resolve, reject) => {
    if (!waiters.has(key)) waiters.set(key, []);
    waiters.get(key)!.push({ resolve, reject });
    if (cache.get(key)?.state !== 'pending') enqueue(key, req);
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
