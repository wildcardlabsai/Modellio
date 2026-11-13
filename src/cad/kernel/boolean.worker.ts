/// <reference lib="webworker" />
import Module, { type ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { runBoolean, type BooleanJob } from './booleanCore';

/**
 * Boolean worker: keeps heavy Manifold operations off the UI thread so the
 * editor stays responsive while complex combinations (text, imported meshes)
 * are evaluated.
 */
let kernel: Promise<ManifoldToplevel> | null = null;
const getKernel = () =>
  (kernel ??= Module({ locateFile: () => wasmUrl }).then((k) => {
    k.setup();
    return k;
  }));

self.onmessage = async (e: MessageEvent<{ key: string; job: BooleanJob }>) => {
  const { key, job } = e.data;
  const outcome = runBoolean(await getKernel(), job);
  const transfer = outcome.mesh ? [outcome.mesh.positions.buffer, outcome.mesh.indices.buffer] : [];
  (self as unknown as Worker).postMessage({ key, outcome }, transfer);
};
