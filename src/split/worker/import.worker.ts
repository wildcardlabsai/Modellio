/// <reference lib="webworker" />
import { importThreeMF } from '../import/importer';
import { buildPreviewBuffers } from '../model/preview';
import { ThreeMFImportError } from '../import/xml';
import { documentTransferables, type ImportRequest, type ImportResponse } from './protocol';

/**
 * 3MF import worker: unzip, lib3mf parse, vendor metadata and material resolution all run
 * here, so a large file never blocks the UI. One worker per import; cancelling terminates it.
 */
const post = (msg: ImportResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<ImportRequest>) => {
  const { bytes, fileName } = e.data;
  let last = 0;
  try {
    const doc = await importThreeMF(bytes, fileName, (fraction, stage) => {
      const now = performance.now();
      if (fraction < 1 && now - last < 60) return;
      last = now;
      post({ type: 'progress', fraction, stage });
    });
    post({ type: 'progress', fraction: 0.96, stage: 'Preparing preview' });
    for (const o of doc.objects)
      if (o.mesh && o.mesh.triangles.length)
        o.mesh.preview = buildPreviewBuffers(o.mesh.vertices, o.mesh.triangles, o.mesh.perTriangleMaterialIds);
    post({ type: 'done', doc }, documentTransferables(doc));
  } catch (err) {
    const userError = err instanceof ThreeMFImportError;
    post({
      type: 'error',
      userError,
      message: userError ? (err as Error).message : `Unexpected import failure: ${(err as Error)?.message ?? err}`,
    });
  }
};
