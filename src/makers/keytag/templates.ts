import type { FontId } from '@/types/document';
import type { DesignElement } from '../canvas/model';
import type { MakerTemplate } from '../canvas/store';
import { DEFAULT_KEYRING } from '../keyring/geometry';
import type { KeyTagParams } from './store';

/** Key tag layouts. `{#}` marks where each tag's number goes; text widths fill in from the font. */
let n = 0;
const id = () => `k${n++}`;
const shape = (shape: string, role: string, x: number, y: number, w: number, h: number): DesignElement =>
  ({ id: id(), kind: 'shape', shape, role, x, y, w, h, rotation: 0, name: shape }) as DesignElement;
const text = (t: string, role: string, x: number, y: number, h: number, font: FontId = 'inter-bold'): DesignElement =>
  ({
    id: id(),
    kind: 'text',
    text: t,
    font,
    role,
    x,
    y,
    w: 0,
    h,
    rotation: 0,
    name: t.includes('{#}') ? 'Number' : 'Label',
  }) as DesignElement;
const hole = (x: number, y: number, diameter = 4.5, rim = 2.2) => ({ enabled: true, x, y, diameter, rim });

export const DEFAULT_NUMBERING = { start: 1, count: 10, step: 1, pad: 2 };

type T = MakerTemplate<KeyTagParams>;
const t = (
  tid: string,
  name: string,
  category: string,
  description: string,
  elements: DesignElement[],
  params: Partial<KeyTagParams>,
): T => ({
  id: tid,
  name,
  category,
  description,
  elements,
  params: { ...DEFAULT_KEYRING, plateMode: 'elements', numbering: DEFAULT_NUMBERING, preview: 0, ...params },
});

export const KEYTAG_CATEGORIES = ['Numbered', 'ID tags', 'Labels'];

export const KEYTAG_TEMPLATES: T[] = [
  t(
    'locker',
    'Locker tag',
    'Numbered',
    'A rounded tag with LOCKER and a big number.',
    [shape('rounded', 'plate', 0, 0, 56, 26), text('LOCKER', 'raised', 4, 6, 5), text('{#}', 'raised', 4, -4, 10, 'bebas-neue')],
    { hole: hole(-23, 0), border: { enabled: true, width: 1 } },
  ),
  t(
    'room',
    'Room key',
    'Numbered',
    'A pill fob with a room number.',
    [shape('pill', 'plate', 0, 0, 60, 20), text('ROOM {#}', 'raised', 4, 0, 8)],
    { hole: hole(-25, 0), numbering: { start: 101, count: 12, step: 1, pad: 3 } },
  ),
  t(
    'fob',
    'Number fob',
    'Numbered',
    'A round fob with one large number, for spare keys.',
    [shape('circle', 'plate', 0, 0, 32, 32), text('{#}', 'raised', 0, -1, 15, 'bebas-neue')],
    { hole: hole(0, 17.5, 4, 2), border: { enabled: true, width: 1.2 } },
  ),
  t(
    'locker-flush',
    'Flush number tag',
    'Numbered',
    'Smooth flush numbers that won’t wear off.',
    [shape('rect', 'plate', 0, 0, 50, 24), text('No.', 'inlay', -12, 0, 6), text('{#}', 'inlay', 6, 0, 11, 'bebas-neue')],
    { hole: hole(-21, 0), numbering: { start: 1, count: 20, step: 1, pad: 3 } },
  ),
  t(
    'asset',
    'Asset tag',
    'ID tags',
    'PROPERTY OF and an asset number, engraved for one colour.',
    [
      shape('rect', 'plate', 0, 0, 62, 26),
      text('PROPERTY OF', 'engraved', 4, 6, 4.5),
      text('ASSET-{#}', 'engraved', 4, -4, 7, 'space-mono'),
    ],
    { hole: hole(-27, 0), twoColour: false, numbering: { start: 1, count: 25, step: 1, pad: 4 } },
  ),
  t(
    'pet-id',
    'Pet ID',
    'ID tags',
    'A bone with a name and a number on the back for a phone.',
    [shape('bone', 'plate', 0, 0, 50, 22), text('REX', 'raised', 0, 0, 8), text('ID {#}', 'engraved', 0, 0, 5)].map((e, i) =>
      i === 2 ? ({ ...e, side: 'back' } as DesignElement) : e,
    ),
    { hole: hole(-26, 0, 4, 2), numbering: { start: 1, count: 1, step: 1, pad: 3 } },
  ),
  t(
    'luggage-id',
    'Luggage ID',
    'ID tags',
    'A luggage tag with a name and a booking number.',
    [shape('luggage', 'plate', 0, 0, 76, 36), text('NAME', 'raised', 6, 6, 7), text('REF {#}', 'engraved', 6, -7, 5, 'space-mono')],
    { hole: hole(-31, 0, 6, 3), border: { enabled: true, width: 1.2 }, numbering: { start: 1001, count: 4, step: 1, pad: 4 } },
  ),
  t(
    'tool',
    'Tool tag',
    'ID tags',
    'A small engraved tag for tools and kit.',
    [shape('pill', 'plate', 0, 0, 44, 14), text('KIT {#}', 'engraved', 3, 0, 6, 'space-mono')],
    { hole: hole(-18, 0, 3.5, 1.8), twoColour: false },
  ),
  t(
    'bin',
    'Bin label',
    'Labels',
    'A clip-on label for storage bins: a letter and a number.',
    [shape('rect', 'plate', 0, 0, 40, 20), text('A{#}', 'raised', 0, 0, 11, 'bebas-neue')],
    { hole: hole(0, 12, 4, 2), numbering: { start: 1, count: 12, step: 1, pad: 2 } },
  ),
  t(
    'cable',
    'Cable tag',
    'Labels',
    'A slim tag to loop on a cable.',
    [shape('pill', 'plate', 0, 0, 40, 10), text('C{#}', 'raised', 2, 0, 6)],
    { hole: hole(-16, 0, 3, 1.5), numbering: { start: 1, count: 16, step: 1, pad: 2 } },
  ),
];

export const BLANK_KEYTAG = {
  elements: [] as DesignElement[],
  params: { ...DEFAULT_KEYRING, plateMode: 'bubble' as const, numbering: DEFAULT_NUMBERING, preview: 0 },
};
