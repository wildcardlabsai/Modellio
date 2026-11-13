/// <reference lib="webworker" />
import Module, { type ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { buildVase, DRAFT, FINE, type VaseParams, type VaseResult } from './geometry';

/** Vase builds run here so the page stays responsive while sliders move. */
let kernel: Promise<ManifoldToplevel> | null = null;
const getKernel = () =>
  (kernel ??= Module({ locateFile: () => wasmUrl }).then((k) => {
    k.setup();
    return k;
  }));

export type VaseRequest = { id: number; params: VaseParams; fine: boolean };
export type VaseResponse = { id: number; result?: VaseResult; error?: string };

self.onmessage = async (e: MessageEvent<VaseRequest>) => {
  const { id, params, fine } = e.data;
  try {
    const result = buildVase(await getKernel(), params, fine ? FINE : DRAFT);
    const transfer = result.parts.flatMap((p) => [p.mesh.positions.buffer, p.mesh.indices.buffer]) as ArrayBuffer[];
    (self as unknown as Worker).postMessage({ id, result } satisfies VaseResponse, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error)?.message ?? String(err) } satisfies VaseResponse);
  }
};
