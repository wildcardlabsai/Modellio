/// <reference lib="webworker" />
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import type * as Replicad from 'replicad';
import { buildBrep, BrepError } from './build';
import type { BrepRequest } from './types';
import { exportStep, importStep, type StepExportItem } from './step';

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

type Message =
  | { id: number; type: 'build'; req: BrepRequest }
  | { id: number; type: 'export-step'; items: StepExportItem[] }
  | { id: number; type: 'import-step'; bytes: Uint8Array; name: string };

const failure = (err: unknown, fallback: string) => (err instanceof BrepError ? err.message : fallback);

self.onmessage = async (e: MessageEvent<Message>) => {
  const m = e.data;
  let r: typeof Replicad;
  try {
    r = await (engine ??= load());
  } catch (err) {
    engine = null;
    postMessage({ type: 'status', status: 'error' });
    postMessage({
      type: 'result',
      id: m.id,
      error: `The precise-solid engine could not load: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }
  try {
    if (m.type === 'build') {
      const res = buildBrep(r, m.req);
      postMessage({ type: 'result', id: m.id, res }, { transfer: [res.positions.buffer, res.indices.buffer] });
    } else if (m.type === 'export-step') {
      const res = await exportStep(r, m.items);
      postMessage({ type: 'result', id: m.id, res }, { transfer: [res.bytes.buffer] });
    } else {
      const res = await importStep(r, m.bytes, m.name);
      postMessage({ type: 'result', id: m.id, res }, { transfer: res.flatMap((s) => [s.build.positions.buffer, s.build.indices.buffer]) });
    }
  } catch (err) {
    postMessage({
      type: 'result',
      id: m.id,
      error: failure(
        err,
        m.type === 'build' ? 'The precise-solid engine could not build this shape.' : 'The STEP file could not be processed.',
      ),
    });
  }
};
