import type { ManifoldToplevel } from 'manifold-3d';

/**
 * The solid-modelling kernel: Manifold (WASM). It provides robust Boolean
 * operations with guaranteed manifold (watertight) output, plus 2D cross-
 * sections and extrusion (used for text).
 *
 * The WASM module loads asynchronously once; everything that needs it checks
 * `getKernel()` and re-renders when `onKernelReady` fires.
 */
let kernel: ManifoldToplevel | null = null;
let pending: Promise<ManifoldToplevel> | null = null;
const listeners = new Set<() => void>();

export function initKernel(): Promise<ManifoldToplevel> {
  if (kernel) return Promise.resolve(kernel);
  if (!pending) {
    pending = (async () => {
      let config: { locateFile: () => string } | undefined;
      if (typeof window !== 'undefined' && typeof process === 'undefined') {
        const { default: wasmUrl } = await import('manifold-3d/manifold.wasm?url');
        config = { locateFile: () => wasmUrl };
      }
      // Loaded on demand so the kernel's JS glue stays out of the main bundle.
      const { default: Module } = await import('manifold-3d');
      const k = await Module(config);
      k.setup();
      kernel = k;
      listeners.forEach((l) => l());
      return k;
    })();
  }
  return pending;
}

export function getKernel(): ManifoldToplevel | null {
  return kernel;
}

/** Subscribe to the kernel becoming available. Returns an unsubscribe function. */
export function onKernelReady(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
