import type { ThreeMFDocument } from '../model/types';
import type { ImportRequest, ImportResponse } from './protocol';

export class ImportCancelledError extends Error {
  constructor() {
    super('Import cancelled');
    this.name = 'ImportCancelledError';
  }
}

export class ImportFailedError extends Error {
  constructor(
    message: string,
    readonly userError: boolean,
  ) {
    super(message);
    this.name = 'ImportFailedError';
  }
}

export interface ImportOptions {
  onProgress?: (fraction: number, stage: string) => void;
  signal?: AbortSignal;
}

/**
 * Import a 3MF file in a dedicated worker. Resolves with the document (typed arrays are
 * transferred, not copied). Aborting the signal terminates the worker immediately.
 */
export function importInWorker(file: Blob & { name?: string }, options: ImportOptions = {}): Promise<ThreeMFDocument> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new ImportCancelledError());
    const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = () => {
      settled = true;
      worker.terminate();
      options.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      finish();
      reject(new ImportCancelledError());
    };
    options.signal?.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<ImportResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') options.onProgress?.(msg.fraction, msg.stage);
      else if (msg.type === 'done') {
        finish();
        resolve(msg.doc);
      } else {
        finish();
        reject(new ImportFailedError(msg.message, msg.userError));
      }
    };
    worker.onerror = (e) => {
      if (settled) return;
      finish();
      reject(new ImportFailedError(`The import worker failed to start: ${e.message || 'unknown error'}`, false));
    };
    file
      .arrayBuffer()
      .then((buf) => {
        if (settled) return;
        const req: ImportRequest = { type: 'import', bytes: new Uint8Array(buf), fileName: file.name ?? 'model.3mf' };
        worker.postMessage(req, [buf]);
      })
      .catch((e: Error) => {
        if (settled) return;
        finish();
        reject(new ImportFailedError(`The file could not be read: ${e.message}`, true));
      });
  });
}

/** Run a Split Studio job (split / connect / export) in a dedicated worker. */
export function runStudioJob<T extends import('./jobs').StudioJobResult['type']>(
  job: Extract<import('./jobs').StudioJob, { type: T }>,
  options: ImportOptions = {},
): Promise<Extract<import('./jobs').StudioJobResult, { type: T }>> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new ImportCancelledError());
    const worker = new Worker(new URL('./studio.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = () => {
      settled = true;
      worker.terminate();
      options.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      finish();
      reject(new ImportCancelledError());
    };
    options.signal?.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<import('./jobs').StudioWorkerMessage>) => {
      const msg = e.data;
      if (msg.type === 'progress') options.onProgress?.(msg.fraction, msg.stage);
      else if (msg.type === 'done') {
        finish();
        resolve(msg.result as Extract<import('./jobs').StudioJobResult, { type: T }>);
      } else {
        finish();
        reject(new ImportFailedError(msg.message, false));
      }
    };
    worker.onerror = (e) => {
      if (settled) return;
      finish();
      reject(new ImportFailedError(`The worker failed: ${e.message || 'unknown error'}`, false));
    };
    worker.postMessage(job);
  });
}
