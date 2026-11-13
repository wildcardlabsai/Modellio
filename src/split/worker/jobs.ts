import type { ThreeMFDocument } from '../model/types';
import type { Joint, SplitOptions, SplitPart, SplitResult } from '../geometry/types';
import type { Connector, ConnectorSettings } from '../geometry/connectors';
import type { Layout } from '../geometry/layout';
import type { ImportIssue } from '../model/types';

export type StudioJob =
  | { type: 'split'; doc: ThreeMFDocument; options: SplitOptions }
  | { type: 'connect'; parts: SplitPart[]; joints: Joint[]; settings: ConnectorSettings }
  | { type: 'export'; parts: SplitPart[]; layout: Layout; connectors: Connector[]; title: string; plates3mf: boolean; partsStl: boolean };

export type StudioJobResult =
  | { type: 'split'; result: SplitResult }
  | { type: 'connect'; parts: SplitPart[]; connectors: Connector[]; issues: ImportIssue[]; skipped: { jointId: string; reason: string }[] }
  | { type: 'export'; zip: Uint8Array; files: string[]; invalidParts: string[] };

export type StudioWorkerMessage =
  { type: 'progress'; fraction: number; stage: string } | { type: 'done'; result: StudioJobResult } | { type: 'error'; message: string };

/** Typed-array buffers inside parts (for zero-copy transfer). */
export function partTransferables(parts: SplitPart[]): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const p of parts) {
    out.add(p.mesh.positions.buffer as ArrayBuffer);
    out.add(p.mesh.indices.buffer as ArrayBuffer);
    for (const c of p.caps) out.add(c.outline.buffer as ArrayBuffer);
    if (p.preview) for (const a of [p.preview.positions, p.preview.normals, p.preview.groups]) out.add(a.buffer as ArrayBuffer);
  }
  return [...out];
}

/** A document without its preview buffers (they are not needed by jobs and are large). */
export function jobDocument(doc: ThreeMFDocument): ThreeMFDocument {
  return { ...doc, objects: doc.objects.map((o) => (o.mesh ? { ...o, mesh: { ...o.mesh, preview: undefined } } : o)) };
}

/** Parts without preview buffers (sent into jobs). */
export function jobParts(parts: SplitPart[]): SplitPart[] {
  return parts.map((p) => ({ ...p, preview: undefined }));
}
