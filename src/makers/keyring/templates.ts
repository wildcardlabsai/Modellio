import type { FontId } from '@/types/document';
import type { DesignElement } from '../canvas/model';
import type { MakerTemplate } from '../canvas/store';
import { DEFAULT_KEYRING, type KeyringParams } from './geometry';

/**
 * Keyring and name tag templates. Text elements are given a height; their width is filled in
 * from the font when the template is opened (w: 0), so lettering is never stretched.
 */
let n = 0;
const id = () => `t${n++}`;
const shape = (shape: string, role: string, x: number, y: number, w: number, h: number, rotation = 0): DesignElement =>
  ({ id: id(), kind: 'shape', shape, role, x, y, w, h, rotation, name: shape }) as DesignElement;
const text = (t: string, role: string, x: number, y: number, h: number, font: FontId = 'inter-bold'): DesignElement =>
  ({ id: id(), kind: 'text', text: t, font, role, x, y, w: 0, h, rotation: 0, name: 'Text' }) as DesignElement;
const hole = (x: number, y: number, diameter = 5, rim = 2.5) => ({ enabled: true, x, y, diameter, rim });
const noHole = { enabled: false, x: 0, y: 0, diameter: 5, rim: 2.5 };

type T = MakerTemplate<KeyringParams>;
const t = (
  id: string,
  name: string,
  category: string,
  description: string,
  elements: DesignElement[],
  params: Partial<KeyringParams>,
): T => ({
  id,
  name,
  category,
  description,
  elements,
  params: { ...DEFAULT_KEYRING, ...params },
});

export const KEYRING_CATEGORIES = ['Name tags', 'Pets', 'Bags & keys', 'Badges & gifts'];

export const KEYRING_TEMPLATES: T[] = [
  // Name tags
  t(
    'bubble',
    'Bubble name',
    'Name tags',
    'Your name with a rounded outline that follows the letters.',
    [text('ALEX', 'raised', 0, 0, 14)],
    { plateMode: 'bubble', margin: 3, hole: hole(-27, 0) },
  ),
  t(
    'script',
    'Script name',
    'Name tags',
    'A flowing script name; the outline joins the letters.',
    [text('Mia', 'raised', 0, 0, 16, 'pacifico')],
    { plateMode: 'bubble', margin: 3.5, hole: hole(-22, 2) },
  ),
  t(
    'classic',
    'Classic name tag',
    'Name tags',
    'A rounded tag with raised lettering and a border.',
    [shape('rounded', 'plate', 0, 0, 64, 24), text('JORDAN', 'raised', 3, 0, 9)],
    { plateMode: 'elements', border: { enabled: true, width: 1.2 }, hole: hole(-27, 0) },
  ),
  t(
    'flush',
    'Flush two-colour',
    'Name tags',
    'Lettering inlaid flush with the surface: smooth to the touch.',
    [shape('rounded', 'plate', 0, 0, 62, 22), text('SAM', 'inlay', 4, 0, 11)],
    { plateMode: 'elements', hole: hole(-26, 0) },
  ),
  t(
    'engraved',
    'Engraved tag',
    'Name tags',
    'One colour, with the name cut into the surface.',
    [shape('rounded', 'plate', 0, 0, 62, 22), text('CHARLIE', 'engraved', 4, 0, 8)],
    { plateMode: 'elements', twoColour: false, hole: hole(-26, 0) },
  ),
  t(
    'pill',
    'Pill tag',
    'Name tags',
    'A slim pill shape with a centred name.',
    [shape('pill', 'plate', 0, 0, 66, 18), text('RILEY', 'raised', 4, 0, 9)],
    { plateMode: 'elements', hole: hole(-27, 0, 4.5, 2.2) },
  ),
  t(
    'mono',
    'Code tag',
    'Name tags',
    'Monospaced lettering for the programmer in your life.',
    [shape('rect', 'plate', 0, 0, 68, 22), text('<dev/>', 'raised', 4, 0, 9, 'space-mono')],
    { plateMode: 'elements', border: { enabled: true, width: 1 }, hole: hole(-28, 0) },
  ),
  t(
    'slab',
    'Slab serif',
    'Name tags',
    'Bold slab lettering on a hexagon.',
    [shape('hexagon', 'plate', 0, 0, 44, 38), text('ZOE', 'raised', 0, 0, 12, 'roboto-slab')],
    { plateMode: 'elements', border: { enabled: true, width: 1.2 }, hole: hole(0, 21, 5, 2.5) },
  ),
  t('tall', 'Tall letters', 'Name tags', 'Condensed capitals that fit long names.', [text('ALEXANDRA', 'raised', 0, 0, 14, 'bebas-neue')], {
    plateMode: 'bubble',
    margin: 2.5,
    hole: hole(-34, 0),
  }),
  // Pets
  t(
    'bone',
    'Dog bone',
    'Pets',
    'A bone-shaped tag for a dog collar.',
    [shape('bone', 'plate', 0, 0, 52, 24), text('REX', 'raised', 0, 0, 9)],
    { plateMode: 'elements', hole: hole(-27, 0, 4, 2) },
  ),
  t(
    'paw',
    'Paw tag',
    'Pets',
    'A round tag with a paw print and a name.',
    [shape('circle', 'plate', 0, 0, 34, 34), shape('paw', 'raised', 0, 4, 14, 14), text('LUNA', 'raised', 0, -9, 6)],
    { plateMode: 'elements', border: { enabled: true, width: 1 }, hole: hole(0, 19, 4, 2) },
  ),
  t(
    'cat',
    'Cat tag',
    'Pets',
    'A small heart tag sized for a cat collar.',
    [shape('heart', 'plate', 0, 0, 28, 25), text('MILO', 'raised', 0, 0, 6)],
    { plateMode: 'elements', hole: hole(0, 13, 3.5, 2) },
  ),
  t(
    'pet-phone',
    'Call my owner',
    'Pets',
    'Name on the front, a phone number engraved below.',
    [shape('rounded', 'plate', 0, 0, 54, 30), text('BUSTER', 'raised', 0, 5, 8), text('07000 000000', 'engraved', 0, -7, 4.2)],
    { plateMode: 'elements', hole: hole(0, 17, 4, 2) },
  ),
  // Bags & keys
  t(
    'luggage',
    'Luggage tag',
    'Bags & keys',
    'A classic luggage tag with a name and a phone number.',
    [shape('luggage', 'plate', 0, 0, 80, 40), text('A. TRAVELLER', 'raised', 6, 6, 6), text('+44 7000 000000', 'engraved', 6, -7, 5)],
    { plateMode: 'elements', border: { enabled: true, width: 1.2 }, hole: hole(-33, 0, 6, 3) },
  ),
  t(
    'house',
    'House key fob',
    'Bags & keys',
    'A house-shaped fob with your door number.',
    [shape('house', 'plate', 0, 0, 36, 36), text('27', 'raised', 0, -4, 12)],
    { plateMode: 'elements', hole: hole(0, 18, 4.5, 2.2) },
  ),
  t(
    'locker',
    'Number tag',
    'Bags & keys',
    'A big number on a circle, for lockers and spare keys.',
    [shape('circle', 'plate', 0, 0, 34, 34), text('42', 'raised', 0, 0, 16, 'bebas-neue')],
    { plateMode: 'elements', border: { enabled: true, width: 1.2 }, hole: hole(0, 18.5, 4, 2) },
  ),
  t(
    'car',
    'Car key tag',
    'Bags & keys',
    'A pill tag for the car keys with a number plate.',
    [shape('pill', 'plate', 0, 0, 70, 20), text('AB12 CDE', 'raised', 4, 0, 8, 'bebas-neue')],
    { plateMode: 'elements', hole: hole(-29, 0) },
  ),
  t(
    'zip',
    'Zip pull',
    'Bags & keys',
    'A small pull for jackets and bags.',
    [shape('pill', 'plate', 0, 0, 40, 12), text('JO', 'raised', 3, 0, 7)],
    { plateMode: 'elements', hole: hole(-16, 0, 3.5, 1.8) },
  ),
  t(
    'home',
    'Home',
    'Bags & keys',
    'Simple raised lettering on a rounded tag.',
    [shape('rounded', 'plate', 0, 0, 60, 22), text('HOME', 'raised', 4, 0, 10)],
    { plateMode: 'elements', hole: hole(-25, 0) },
  ),
  // Badges & gifts
  t(
    'heart',
    'Heart initials',
    'Badges & gifts',
    'Two initials on a heart.',
    [shape('heart', 'plate', 0, 0, 40, 36), text('A+J', 'raised', 0, 1, 9)],
    { plateMode: 'elements', hole: hole(-10, 17.5, 4, 2) },
  ),
  t('mum', 'Mum', 'Badges & gifts', 'A heart for Mother’s Day.', [shape('heart', 'plate', 0, 0, 40, 36), text('MUM', 'inlay', 0, 2, 9)], {
    plateMode: 'elements',
    hole: hole(-10, 17.5, 4, 2),
  }),
  t(
    'star',
    'Star initial',
    'Badges & gifts',
    'A big initial on a star.',
    [shape('star', 'plate', 0, 0, 42, 40), text('E', 'raised', 0, -1, 14)],
    { plateMode: 'elements', hole: hole(0, 22, 4, 2) },
  ),
  t(
    'shield',
    'Shield crest',
    'Badges & gifts',
    'A shield with initials, like a team crest.',
    [shape('shield', 'plate', 0, 0, 34, 40), text('FC', 'raised', 0, 4, 12, 'roboto-slab')],
    { plateMode: 'elements', border: { enabled: true, width: 1.5 }, hole: hole(0, 22, 4, 2) },
  ),
  t(
    'gamer',
    'Gamer tag',
    'Badges & gifts',
    'A lightning bolt and a gamer name.',
    [shape('rect', 'plate', 0, 0, 72, 22), shape('bolt', 'raised', -18, 0, 9, 16), text('NOVA', 'raised', 8, 0, 11, 'bebas-neue')],
    { plateMode: 'elements', border: { enabled: true, width: 1 }, hole: hole(-34, 0) },
  ),
  t(
    'bolt',
    'Lightning keyring',
    'Badges & gifts',
    'A lightning bolt you can name.',
    [shape('bolt', 'plate', 0, 0, 26, 46), text('K', 'inlay', 1, 0, 8)],
    { plateMode: 'elements', hole: hole(3, 22, 4, 2) },
  ),
  t(
    'moon',
    'Moon & star',
    'Badges & gifts',
    'A crescent moon with a small star.',
    [shape('moon', 'plate', 0, 0, 38, 38), shape('star', 'raised', -8, -2, 11, 11)],
    { plateMode: 'elements', hole: hole(-4, 20, 4, 2) },
  ),
  t(
    'cloud',
    'Cloud',
    'Badges & gifts',
    'A soft cloud with a short word.',
    [shape('cloud', 'plate', 0, 0, 50, 30), text('dream', 'raised', 0, -2, 11, 'pacifico')],
    { plateMode: 'elements', hole: hole(-6, 15, 4, 2) },
  ),
  t(
    'medallion',
    'Medallion',
    'Badges & gifts',
    'A ring-shaped medallion with a centre initial.',
    [shape('circle', 'plate', 0, 0, 36, 36), shape('ring', 'inlay', 0, 0, 30, 30), text('M', 'raised', 0, 0, 14, 'roboto-slab')],
    { plateMode: 'elements', hole: hole(0, 19.5, 4, 2) },
  ),
];

/** A blank design: an empty bubble tag waiting for text. */
export const BLANK_KEYRING: { elements: DesignElement[]; params: KeyringParams } = {
  elements: [],
  params: { ...DEFAULT_KEYRING, plateMode: 'bubble', hole: { ...DEFAULT_KEYRING.hole, x: -30, y: 0 } },
};

export { noHole };
