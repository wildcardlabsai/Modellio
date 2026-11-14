import type { FontId } from '@/types/document';
import type { DesignElement } from '../canvas/model';
import type { MakerTemplate } from '../canvas/store';
import { DEFAULT_SIGN, type SignParams } from './geometry';

/** Sign layouts, in millimetres. Text widths fill in from the font. */
let n = 0;
const id = () => `s${n++}`;
const shape = (shape: string, role: string, x: number, y: number, w: number, h: number): DesignElement =>
  ({ id: id(), kind: 'shape', shape, role, x, y, w, h, rotation: 0, name: shape }) as DesignElement;
const line = (t: string, y: number, h: number, font: FontId = 'inter-bold', role = 'raised', x = 0): DesignElement =>
  ({ id: id(), kind: 'text', text: t, font, role, x, y, w: 0, h, rotation: 0, name: 'Line' }) as DesignElement;

type T = MakerTemplate<SignParams>;
const t = (
  tid: string,
  name: string,
  category: string,
  description: string,
  elements: DesignElement[],
  params: Partial<SignParams> = {},
): T => ({
  id: tid,
  name,
  category,
  description,
  elements,
  params: { ...DEFAULT_SIGN, ...params },
});

export const SIGN_CATEGORIES = ['Home', 'Office', 'Workshop'];

export const SIGN_TEMPLATES: T[] = [
  t(
    'house-number',
    'House number',
    'Home',
    'A big number with the street name, screwed to the wall.',
    [shape('rounded', 'plate', 0, 0, 150, 90), line('27', 10, 42, 'bebas-neue'), line('ORCHARD LANE', -30, 9)],
    { mount: { kind: 'screw', count: 2, diameter: 4.5, inset: 12 } },
  ),
  t(
    'arch-welcome',
    'Welcome arch',
    'Home',
    'An arched welcome sign in script.',
    [shape('arch', 'plate', 0, 0, 140, 110), line('Welcome', 8, 26, 'pacifico'), line('THE PARKERS', -26, 9)],
    { mount: { kind: 'keyhole', count: 2, diameter: 4, inset: 14 }, baseColour: '#F4F4F2', topColour: '#2463EB' },
  ),
  t(
    'family',
    'Family name',
    'Home',
    'A plaque with a family name and the year.',
    [shape('plaque', 'plate', 0, 0, 160, 70), line('THE BAKERS', 6, 16, 'roboto-slab'), line('EST. 2024', -16, 8)],
    { mount: { kind: 'screw', count: 2, diameter: 4, inset: 14 } },
  ),
  t(
    'desk',
    'Desk name sign',
    'Office',
    'A nameplate with a title, on a stand.',
    [shape('rect', 'plate', 0, 0, 180, 50), line('ALEX MORGAN', 7, 14), line('Design Lead', -11, 8, 'inter-bold', 'engraved')],
    { mount: { kind: 'none', count: 2, diameter: 4, inset: 10 }, stand: { enabled: true, angle: 12 } },
  ),
  t(
    'meeting',
    'Meeting room',
    'Office',
    'A door sign for a room name.',
    [shape('rounded', 'plate', 0, 0, 170, 60), line('MEETING ROOM', 6, 13), line('Please knock', -13, 7, 'inter-bold', 'engraved')],
    { mount: { kind: 'screw', count: 2, diameter: 3.5, inset: 10 } },
  ),
  t(
    'office-door',
    'Office door',
    'Office',
    'Flush lettering that cleans easily.',
    [shape('rect', 'plate', 0, 0, 160, 50), line('OFFICE', 0, 18, 'inter-bold', 'inlay')],
    { mount: { kind: 'screw', count: 2, diameter: 3.5, inset: 10 } },
  ),
  t(
    'workshop',
    'Workshop',
    'Workshop',
    'A bold sign for the shed or garage.',
    [shape('rect', 'plate', 0, 0, 200, 60), line('WORKSHOP', 0, 30, 'bebas-neue')],
    { mount: { kind: 'screw', count: 4, diameter: 4.5, inset: 9 }, baseColour: '#F5B700', topColour: '#1D1D1F' },
  ),
  t(
    'caution',
    'Mind the step',
    'Workshop',
    'A warning sign with a raised border.',
    [shape('rect', 'plate', 0, 0, 150, 60), line('MIND', 12, 18, 'bebas-neue'), line('THE STEP', -12, 18, 'bebas-neue')],
    {
      mount: { kind: 'screw', count: 4, diameter: 4, inset: 8 },
      baseColour: '#F5B700',
      topColour: '#1D1D1F',
      border: { enabled: true, width: 3 },
    },
  ),
];

export const BLANK_SIGN = {
  elements: [shape('rounded', 'plate', 0, 0, 150, 70)] as DesignElement[],
  params: DEFAULT_SIGN,
};
