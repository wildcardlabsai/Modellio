/// <reference lib="webworker" />
import Module, { type ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { splitDocument } from '../geometry/split';
import { applyInlays } from '../geometry/inlay';
import { addConnectors } from '../geometry/connectors';
import { buildExport } from '../geometry/export';
import { buildPreviewBuffers } from '../model/preview';
import type { SplitPart } from '../geometry/types';
import { partTransferables, type StudioJob, type StudioWorkerMessage } from './jobs';

/**
 * Split Studio job worker: splitting, inlays, connectors and export packaging run here.
 * One worker per job; cancelling terminates it.
 */
let kernel: Promise<ManifoldToplevel> | null = null;
const getKernel = () =>
  (kernel ??= Module({ locateFile: () => wasmUrl }).then((k) => {
    k.setup();
    return k;
  }));

const post = (msg: StudioWorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
const progress = (fraction: number, stage: string) => post({ type: 'progress', fraction, stage });

function withPreviews(parts: SplitPart[]): SplitPart[] {
  return parts.map((p) => ({
    ...p,
    preview: buildPreviewBuffers(p.mesh.positions, p.mesh.indices, new Uint32Array(p.mesh.indices.length / 3)),
  }));
}

self.onmessage = async (e: MessageEvent<StudioJob>) => {
  const job = e.data;
  try {
    if (job.type === 'split') {
      progress(0.02, 'Splitting colours');
      let result = splitDocument(job.doc, job.options, (f) => progress(0.02 + f * 0.6, 'Splitting colours'));
      if (job.options.inlayDepth > 0 && result.joints.length) {
        progress(0.65, 'Making inlays');
        result = applyInlays(await getKernel(), result, job.options.inlayDepth);
      }
      progress(0.9, 'Preparing preview');
      result = { ...result, parts: withPreviews(result.parts) };
      post({ type: 'done', result: { type: 'split', result } }, partTransferables(result.parts));
    } else if (job.type === 'connect') {
      progress(0.05, 'Adding connectors');
      const k = await getKernel();
      const r = addConnectors(k, job.parts, job.joints, job.settings);
      progress(0.9, 'Preparing preview');
      const parts = withPreviews(r.parts);
      post(
        { type: 'done', result: { type: 'connect', parts, connectors: r.connectors, issues: r.issues, skipped: r.skipped } },
        partTransferables(parts),
      );
    } else {
      progress(0.1, 'Writing files');
      const pkg = buildExport(job.parts, job.layout, job.connectors, {
        title: job.title,
        plates3mf: job.plates3mf,
        partsStl: job.partsStl,
      });
      post({ type: 'done', result: { type: 'export', ...pkg } }, [pkg.zip.buffer as ArrayBuffer]);
    }
  } catch (err) {
    post({ type: 'error', message: (err as Error)?.message ?? String(err) });
  }
};
