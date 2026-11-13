import { strToU8, zipSync } from 'fflate';
import { write3mf } from '@/cad/export/threemf';
import { writeBinaryStl } from '@/cad/export/writers';
import type { ExportBody } from '@/cad/export/collect';
import { transformPositions } from '../model/mat4';
import type { Layout } from './layout';
import type { Connector } from './connectors';
import type { SplitPart } from './types';

/**
 * Export package: one 3MF per plate (parts in their print orientation and plate position),
 * one STL per part, and a README with colours, sizes and every warning. Geometry comes from
 * the plate layout only; the explode view is display-only and never exported.
 */
export interface ExportOptions {
  title: string;
  plates3mf: boolean;
  partsStl: boolean;
}

export interface ExportPackage {
  zip: Uint8Array;
  files: string[];
  /** Parts that are not closed solids (included, and flagged in the README). */
  invalidParts: string[];
}

export const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60) || 'part';

const pad = (n: number) => String(n).padStart(2, '0');

/** Bodies for one plate, in plate coordinates. */
export function plateBodies(parts: SplitPart[], layout: Layout, plate: number): ExportBody[] {
  return layout.plates[plate].partIds.map((id) => {
    const p = parts.find((x) => x.partId === id)!;
    const t = layout.placements[id].transform;
    return {
      id,
      name: p.name,
      color: p.colour,
      mesh: { positions: transformPositions(t, p.mesh.positions), indices: p.mesh.indices },
      watertight: p.report.watertight,
    };
  });
}

export function buildExport(parts: SplitPart[], layout: Layout, connectors: Connector[], o: ExportOptions): ExportPackage {
  const root = slug(o.title);
  const files: Record<string, Uint8Array> = {};
  const invalid = parts.filter((p) => !p.report.watertight).map((p) => p.name);
  if (o.plates3mf)
    layout.plates.forEach((plate, i) => {
      files[`${root}/plates/plate-${pad(i + 1)}-${slug(plate.name)}.3mf`] = write3mf(
        plateBodies(parts, layout, i),
        `${o.title} — ${plate.name}`,
      );
    });
  if (o.partsStl)
    layout.plates.forEach((_, i) =>
      plateBodies(parts, layout, i).forEach((b, k) => {
        files[`${root}/parts/${pad(i + 1)}-${pad(k + 1)}-${slug(b.name)}.stl`] = new Uint8Array(writeBinaryStl([b]));
      }),
    );
  files[`${root}/README.txt`] = strToU8(readme(parts, layout, connectors, o, invalid));
  return { zip: zipSync(files, { level: 6 }), files: Object.keys(files), invalidParts: invalid };
}

function readme(parts: SplitPart[], layout: Layout, connectors: Connector[], o: ExportOptions, invalid: string[]): string {
  const lines: string[] = [];
  lines.push(
    `${o.title} — split for single-colour printing`,
    '='.repeat(60),
    '',
    'Made with MODELLIO Split Studio. All dimensions are in millimetres.',
    '',
  );
  layout.plates.forEach((plate, i) => {
    lines.push(`Plate ${i + 1}: ${plate.name}${plate.colour ? ` (${plate.colour})` : ''}`);
    for (const id of plate.partIds) {
      const p = parts.find((x) => x.partId === id)!;
      const s = layout.placements[id].size;
      lines.push(
        `  - ${p.name}: ${s.map((v) => v.toFixed(1)).join(' × ')} mm, ${(Math.abs(p.report.volume) / 1000).toFixed(2)} cm³${p.report.watertight ? '' : '  [NOT A CLOSED SOLID — check before printing]'}${layout.placements[id].oversize ? '  [LARGER THAN THE PLATE]' : ''}`,
      );
    }
    lines.push('');
  });
  if (connectors.length) {
    const c = connectors[0];
    lines.push(
      `Connectors: ${connectors.length} round peg(s), Ø${c.diameter} mm, sockets Ø${c.socketDiameter.toFixed(2)} mm (${((c.socketDiameter - c.diameter) / 2).toFixed(2)} mm clearance per side).`,
      'Print pegs upright where possible. If pegs are tight, sand lightly or reprint with more clearance.',
      '',
    );
  }
  if (invalid.length)
    lines.push('WARNING — these parts are not closed solids and may fail to slice:', ...invalid.map((n) => `  - ${n}`), '');
  if (layout.warnings.length) lines.push('Layout notes:', ...layout.warnings.map((w) => `  - ${w}`), '');
  lines.push('Assembly: the parts fit together in the positions of the original model. Glue or press-fit as needed.');
  return lines.join('\n');
}
