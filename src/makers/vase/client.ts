import type { VaseParams, VaseResult } from './geometry';
import type { VaseRequest, VaseResponse } from './vase.worker';

/**
 * One persistent worker. Preview requests are coalesced: while a build runs, only the newest
 * waiting request is kept, so dragging a control never queues up stale work.
 */
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: VaseResult) => void; reject: (e: Error) => void }>();
let busy = false;
let queued: { req: VaseRequest; resolve: (r: VaseResult) => void; reject: (e: Error) => void } | null = null;

function ensure(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./vase.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<VaseResponse>) => {
    const p = pending.get(e.data.id);
    pending.delete(e.data.id);
    busy = false;
    if (p) {
      if (e.data.result) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error ?? 'The vase could not be built.'));
    }
    if (queued) {
      const q = queued;
      queued = null;
      send(q.req, q.resolve, q.reject);
    }
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'The vase builder stopped.'));
    pending.clear();
    worker?.terminate();
    worker = null;
    busy = false;
  };
  return worker;
}

function send(req: VaseRequest, resolve: (r: VaseResult) => void, reject: (e: Error) => void) {
  busy = true;
  pending.set(req.id, { resolve, reject });
  ensure().postMessage(req);
}

/** Build a vase. Superseded preview requests reject with "superseded". */
export function buildInWorker(params: VaseParams, fine = false): Promise<VaseResult> {
  return new Promise((resolve, reject) => {
    const req: VaseRequest = { id: nextId++, params, fine };
    if (!busy) return send(req, resolve, reject);
    if (queued) queued.reject(new Error('superseded'));
    queued = { req, resolve, reject };
  });
}
