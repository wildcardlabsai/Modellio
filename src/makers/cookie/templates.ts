import type { FontId } from '@/types/document';
import type { DesignElement } from '../canvas/model';
import type { MakerTemplate } from '../canvas/store';
import { DEFAULT_COOKIE_PARAMS, type CookieParams, type CookieRole } from './geometry';

/**
 * Cookie templates, laid out in millimetres as seen on the cookie. Widths of 0 are filled in
 * from each item's natural proportions when the template opens, so nothing is stretched.
 */
let n = 0;
const id = () => `c${n++}`;
const shape = (shape: string, role: CookieRole, x: number, y: number, h: number, rotation = 0): DesignElement =>
  ({ id: id(), kind: 'shape', shape, role, x, y, w: 0, h, rotation, name: shape }) as DesignElement;
const text = (t: string, role: CookieRole, x: number, y: number, h: number, font: FontId = 'inter-bold'): DesignElement =>
  ({ id: id(), kind: 'text', text: t, font, role, x, y, w: 0, h, rotation: 0, name: 'Text' }) as DesignElement;

type T = MakerTemplate<CookieParams>;
const t = (
  id: string,
  name: string,
  category: string,
  description: string,
  elements: DesignElement[],
  params: Partial<CookieParams> = {},
): T => ({
  id,
  name,
  category,
  description,
  elements,
  params: { ...DEFAULT_COOKIE_PARAMS, ...params },
});

export const COOKIE_CATEGORIES = ['Shapes', 'Names & words', 'Seasonal', 'Celebrations'];

export const COOKIE_TEMPLATES: T[] = [
  // Shapes
  t('heart', 'Heart', 'Shapes', 'A classic heart cutter with an outline stamp.', [shape('heart', 'shape', 0, 0, 64)]),
  t('star', 'Star', 'Shapes', 'A five-point star.', [shape('star', 'shape', 0, 0, 70)]),
  t('fluted', 'Fluted circle', 'Shapes', 'The scalloped round every baker owns.', [shape('fluted', 'shape', 0, 0, 65)]),
  t('cloud', 'Cloud', 'Shapes', 'A soft cloud.', [shape('cloud', 'shape', 0, 0, 50)]),
  t('bone', 'Dog bone', 'Shapes', 'For dog biscuits.', [shape('bone', 'shape', 0, 0, 28)]),
  t('house', 'House', 'Shapes', 'A little house: housewarming biscuits.', [shape('house', 'shape', 0, 0, 66)]),
  t('moon', 'Crescent moon', 'Shapes', 'A crescent moon.', [shape('moon', 'shape', 0, 0, 66)]),
  t('paw', 'Paw print', 'Shapes', 'A paw print with pads pressed in.', [
    shape('circle', 'outline', 0, 0, 66),
    shape('paw', 'detail', 0, 0, 42),
  ]),
  t('hexagon', 'Honeycomb', 'Shapes', 'A hexagon with a smaller hexagon pressed inside.', [
    shape('hexagon', 'shape', 0, 0, 62),
    shape('hexagon', 'shape', 0, 0, 40),
  ]),
  t('bolt', 'Lightning bolt', 'Shapes', 'A lightning bolt.', [shape('bolt', 'shape', 0, 0, 80)], { outline: 2 }),
  // Names & words
  t('name', 'Name cookie', 'Names & words', 'A name in script, joined into one cookie.', [text('Ava', 'shape', 0, 0, 34, 'pacifico')], {
    outline: 4,
  }),
  t('bold-name', 'Bold name', 'Names & words', 'Chunky capitals with a rounded outline.', [text('LEO', 'shape', 0, 0, 30)], { outline: 4 }),
  t('plaque', 'Message plaque', 'Names & words', 'A rounded plaque with a message pressed in.', [
    shape('rounded', 'outline', 0, 0, 36),
    text('THANK', 'detail', 0, 8, 11),
    text('YOU', 'detail', 0, -9, 11),
  ]),
  t('love', 'Love heart', 'Names & words', 'A heart with LOVE pressed into it.', [
    shape('heart', 'shape', 0, 0, 66),
    text('LOVE', 'detail', 0, 4, 13),
  ]),
  t('initial', 'Initial', 'Names & words', 'A fluted round with a big initial.', [
    shape('fluted', 'shape', 0, 0, 66),
    text('S', 'detail', 0, 0, 34, 'roboto-slab'),
  ]),
  t('number', 'Big number', 'Names & words', 'A number for a birthday tray.', [text('5', 'shape', 0, 0, 72, 'inter-bold')], { outline: 3 }),
  // Seasonal
  t('gingerbread', 'Gingerbread person', 'Seasonal', 'The classic, with an outline stamp.', [shape('gingerbread', 'shape', 0, 0, 80)]),
  t('tree', 'Christmas tree', 'Seasonal', 'A tree with a star pressed at the top.', [
    shape('tree', 'shape', 0, 0, 78),
    shape('star', 'detail', 0, 18, 14),
  ]),
  t('bunny', 'Easter bunny', 'Seasonal', 'A bunny for Easter.', [shape('bunny', 'shape', 0, 0, 76)]),
  t('egg', 'Easter egg', 'Seasonal', 'An egg with stripes pressed in.', [
    shape('egg', 'shape', 0, 0, 72),
    shape('pill', 'detail', 0, 10, 6),
    shape('pill', 'detail', 0, -8, 6),
  ]),
  t('snow', 'Snow day', 'Seasonal', 'A round with a big star pressed in.', [
    shape('circle', 'outline', 0, 0, 64),
    shape('star', 'detail', 0, 0, 40),
  ]),
  // Celebrations
  t('birthday', 'Happy birthday', 'Celebrations', 'A round cookie with a birthday message.', [
    shape('circle', 'outline', 0, 0, 70),
    text('HAPPY', 'detail', 0, 9, 11),
    text('BIRTHDAY', 'detail', 0, -8, 7.5),
  ]),
  t('wedding', 'Wedding hearts', 'Celebrations', 'A heart with initials.', [
    shape('heart', 'outline', 0, 0, 66),
    text('A & J', 'detail', 0, 4, 12, 'pacifico'),
  ]),
  t('baby', 'New baby', 'Celebrations', 'A drop-shaped rattle cookie.', [
    shape('egg', 'outline', 0, 0, 70),
    text('BABY', 'detail', 0, 0, 12),
  ]),
  t('shield', 'Team badge', 'Celebrations', 'A shield with team initials.', [
    shape('shield', 'shape', 0, 0, 72),
    text('FC', 'detail', 0, 4, 22, 'roboto-slab'),
  ]),
];

export const BLANK_COOKIE: { elements: DesignElement[]; params: CookieParams } = {
  elements: [],
  params: { ...DEFAULT_COOKIE_PARAMS },
};
