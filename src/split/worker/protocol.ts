import type { ThreeMFDocument } from '../model/types';

export type ImportRequest = { type: 'import'; bytes: Uint8Array; fileName: string };
export type ImportResponse =
  | { type: 'progress'; fraction: number; stage: string }
  | { type: 'done'; doc: ThreeMFDocument }
  | { type: 'error'; message: string; userError: boolean };

/** Typed-array buffers inside a document, for zero-copy transfer out of the worker. */
export function documentTransferables(doc: ThreeMFDocument): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const o of doc.objects)
    if (o.mesh) {
      for (const a of [o.mesh.vertices, o.mesh.triangles, o.mesh.perTriangleMaterialIds]) out.add(a.buffer as ArrayBuffer);
      if (o.mesh.paint) out.add(o.mesh.paint.codes.buffer as ArrayBuffer);
      if (o.mesh.preview)
        for (const a of [o.mesh.preview.positions, o.mesh.preview.normals, o.mesh.preview.groups]) out.add(a.buffer as ArrayBuffer);
    }
  return [...out];
}
