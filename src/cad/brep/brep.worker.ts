/// <reference lib="webworker" />
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import type * as Replicad from 'replicad';
import { buildBrep, BrepError } from './build';
import type { BrepRequest } from './types';

/**
 * The precise-solid engine: OpenCascade (via replicad), loaded the first time a request arrives.
 * Kept in its own worker so its 23 MB WebAssembly module never blocks or bloats the page.
 */
let engine: Promise<typeof Replicad> | null = null;

async function load(): Promise<typeof Replicad> {
  postMessage({ type: 'status', status: 'loading' });
  const { default: init } = await import('replicad-opencascadejs');
  const oc = await (init as unknown as (o: { locateFile: () => string }) => Promise<unknown>)({ locateFile: () => wasmUrl });
  const r = await import('replicad');
  r.setOC(oc as Parameters<typeof r.setOC>[0]);
  postMessage({ type: 'status', status: 'ready' });
  return r;
}

self.onmessage = async (e: MessageEvent<{ id: number; req: BrepRequest }>) => {
  const { id, req } = e.data;
  let r: typeof Replicad;
  try {
    r = await (engine ??= load());
  } catch (err) {
    engine = null;
    postMessage({ type: 'status', status: 'error' });
    postMessage({
      type: 'result',
      id,
      error: `The precise-solid engine could not load: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }
  try {
    const res = buildBrep(r, req);
    postMessage({ type: 'result', id, res }, { transfer: [res.positions.buffer, res.indices.buffer] });
  } catch (err) {
    postMessage({
      type: 'result',
      id,
      error: err instanceof BrepError ? err.message : 'The precise-solid engine could not build this shape.',
    });
  }
};
