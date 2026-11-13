import { DEFAULT_VASE, type PatternKind, type ShapeKind, type VaseParams } from './geometry';

/**
 * Starting points for the Vase Maker. Every template is just a set of parameters, so
 * everything about it stays editable.
 */
export type TemplateCategory = 'Vases' | 'Planters' | 'Bowls & pots' | 'Lampshades';

export interface VaseTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  params: VaseParams;
}

type P = { t: number; r: number }[];
const prof = (...pts: [number, number][]): P => pts.map(([t, r]) => ({ t, r }));
const shape = (kind: ShapeKind, sides = 6, depth = 0.25, rounding = 0.2) => ({ kind, sides, depth, rounding });
const pattern = (kind: PatternKind, o: Partial<VaseParams['pattern']> = {}) => ({ ...DEFAULT_VASE.pattern, kind, ...o });

function t(id: string, name: string, category: TemplateCategory, description: string, p: Partial<VaseParams>): VaseTemplate {
  const base: VaseParams = {
    ...DEFAULT_VASE,
    type: category === 'Planters' ? 'pot' : category === 'Lampshades' ? 'lampshade' : 'vase',
    vaseMode: category === 'Vases',
    shape: shape('circle'),
    pattern: pattern('none'),
    twist: 0,
    saucer: category === 'Planters',
    drainage: { holes: category === 'Planters' ? 1 : 0, diameter: 8 },
  };
  return { id, name, category, description, params: { ...base, ...p } };
}

export const VASE_TEMPLATES: VaseTemplate[] = [
  // Vases
  t('bud', 'Bud vase', 'Vases', 'A slim vase for one stem, with a gentle waist.', {
    height: 140,
    profile: prof([0, 24], [0.3, 30], [0.75, 12], [1, 15]),
  }),
  t('amphora', 'Amphora', 'Vases', 'Wide shoulders and a narrow neck, the classic urn shape.', {
    height: 190,
    profile: prof([0, 26], [0.45, 52], [0.8, 18], [1, 26]),
  }),
  t('bottle', 'Bottle', 'Vases', 'A round body and a tall neck for dried flowers.', {
    height: 200,
    profile: prof([0, 34], [0.35, 42], [0.55, 16], [1, 13]),
  }),
  t('bulb', 'Bulb', 'Vases', 'A full round belly that flares at the lip.', {
    height: 150,
    profile: prof([0, 22], [0.4, 52], [0.85, 22], [1, 30]),
  }),
  t('twisted-hex', 'Twisted hexagon', 'Vases', 'A hexagon twisted 120° on its way up.', {
    height: 170,
    profile: prof([0, 38], [0.5, 46], [1, 36]),
    shape: shape('polygon', 6, 0, 0.1),
    twist: 120,
  }),
  t('spiral-star', 'Spiral star', 'Vases', 'Seven soft points spiralling around the body.', {
    height: 180,
    profile: prof([0, 34], [0.4, 48], [1, 30]),
    shape: shape('star', 7, 0.28, 0.5),
    twist: 180,
    twistStyle: 'ease',
  }),
  t('fluted', 'Fluted column', 'Vases', 'A straight column with deep vertical flutes.', {
    height: 200,
    profile: prof([0, 36], [1, 36]),
    pattern: pattern('ribs', { count: 28, amplitude: 2.2, sharpness: 0.2 }),
  }),
  t('ripple', 'Ripple', 'Vases', 'Horizontal waves like water rings.', {
    height: 160,
    profile: prof([0, 30], [0.5, 44], [1, 34]),
    pattern: pattern('waves', { rows: 14, amplitude: 2.5, sharpness: 0 }),
  }),
  t('knurl', 'Diamond knurl', 'Vases', 'A grip-like diamond texture all over.', {
    height: 160,
    profile: prof([0, 34], [1, 40]),
    pattern: pattern('diamond', { count: 24, turns: 0.5, amplitude: 1.8, sharpness: 0.4 }),
  }),
  t('bubbles', 'Bubbles', 'Vases', 'Rows of raised bubbles on a rounded body.', {
    height: 150,
    profile: prof([0, 30], [0.5, 46], [1, 30]),
    pattern: pattern('bubbles', { count: 16, amplitude: 2.4, sharpness: 0.3 }),
  }),
  t('organic', 'Organic flow', 'Vases', 'A soft, random-looking surface. Change the seed for a new one.', {
    height: 170,
    profile: prof([0, 32], [0.45, 46], [1, 28]),
    pattern: pattern('noise', { count: 6, rows: 3, amplitude: 4, seed: 7 }),
  }),
  t('tulip', 'Tulip', 'Vases', 'Five petals that open towards the top.', {
    height: 160,
    profile: prof([0, 24], [0.6, 40], [1, 52]),
    shape: shape('flower', 5, 0.3, 0.3),
    twist: 36,
    twistStyle: 'ease',
  }),
  t('square-twist', 'Square twist', 'Vases', 'A rounded square turned a quarter turn.', {
    height: 180,
    profile: prof([0, 36], [0.5, 42], [1, 36]),
    shape: shape('squircle', 4, 0, 0.35),
    twist: 90,
    twistStyle: 'ease',
  }),
  t('gear', 'Gear tower', 'Vases', 'Crisp vertical teeth on a straight body.', {
    height: 170,
    profile: prof([0, 36], [1, 34]),
    shape: shape('gear', 18, 0.12, 0.2),
  }),
  t('stepped', 'Stepped tower', 'Vases', 'Stacked rings that read like terraces.', {
    height: 180,
    profile: prof([0, 40], [1, 28]),
    pattern: pattern('steps', { rows: 9, amplitude: 3, sharpness: 0.3 }),
  }),
  t('wave-twist', 'Wave twist', 'Vases', 'A twist that turns one way and back again.', {
    height: 180,
    profile: prof([0, 32], [0.5, 44], [1, 32]),
    shape: shape('flower', 8, 0.18, 0.2),
    twist: 60,
    twistStyle: 'wave',
  }),
  // Planters
  t('pot-classic', 'Classic plant pot', 'Planters', 'A tapered pot with a drainage hole and a saucer.', {
    height: 110,
    profile: prof([0, 42], [1, 56]),
    wall: 2.2,
    base: 3,
  }),
  t('succulent', 'Succulent bowl', 'Planters', 'Low and wide with six faces, for succulents.', {
    height: 60,
    profile: prof([0, 48], [0.6, 62], [1, 64]),
    shape: shape('polygon', 6, 0, 0.05),
    base: 3,
  }),
  t('ribbed-planter', 'Ribbed planter', 'Planters', 'Fine ribs on a straight-sided pot.', {
    height: 120,
    profile: prof([0, 50], [1, 58]),
    pattern: pattern('ribs', { count: 40, amplitude: 1.4, sharpness: 0.1 }),
  }),
  t('square-planter', 'Square planter', 'Planters', 'A soft-cornered square pot that sits well on a windowsill.', {
    height: 100,
    profile: prof([0, 50], [1, 56]),
    shape: shape('squircle', 4, 0, 0.2),
  }),
  t('faceted', 'Faceted planter', 'Planters', 'Eight facets with a slight twist.', {
    height: 120,
    profile: prof([0, 46], [0.7, 60], [1, 58]),
    shape: shape('polygon', 8, 0, 0),
    twist: 22.5,
  }),
  t('wave-planter', 'Wave planter', 'Planters', 'Gentle horizontal waves around a round pot.', {
    height: 120,
    profile: prof([0, 46], [1, 56]),
    pattern: pattern('waves', { rows: 6, amplitude: 2, sharpness: 0 }),
  }),
  t('herb', 'Herb pot', 'Planters', 'Deep, with five drainage holes for herbs.', {
    height: 140,
    profile: prof([0, 48], [1, 54]),
    drainage: { holes: 5, diameter: 7 },
  }),
  t('tall-planter', 'Tall planter', 'Planters', 'A tall cylinder for snake plants and grasses.', {
    height: 200,
    profile: prof([0, 50], [1, 50]),
    pattern: pattern('ribs', { count: 12, amplitude: 2.5, sharpness: 0.6 }),
  }),
  // Bowls & pots
  t('petal-bowl', 'Petal bowl', 'Bowls & pots', 'A shallow bowl with eight rounded petals.', {
    height: 50,
    profile: prof([0, 30], [1, 80]),
    shape: shape('flower', 8, 0.18, 0.3),
    vaseMode: false,
  }),
  t('fruit-bowl', 'Fruit bowl', 'Bowls & pots', 'A ribbed bowl with a sturdy base.', {
    height: 80,
    profile: prof([0, 45], [0.6, 88], [1, 95]),
    pattern: pattern('ribs', { count: 36, amplitude: 1.6, sharpness: 0.3 }),
    vaseMode: false,
    base: 3,
  }),
  t('pen-pot', 'Pen pot', 'Bowls & pots', 'A desk pot with gear teeth.', {
    height: 100,
    profile: prof([0, 38], [1, 38]),
    shape: shape('gear', 14, 0.1, 0.3),
    vaseMode: false,
    base: 3,
  }),
  t('tealight', 'Tealight holder', 'Bowls & pots', 'Short and star-shaped. Use LED tealights only.', {
    height: 45,
    profile: prof([0, 36], [1, 32]),
    shape: shape('star', 8, 0.2, 0.5),
    vaseMode: false,
    base: 3,
  }),
  t('trinket', 'Trinket dish', 'Bowls & pots', 'A small, low dish for rings and keys.', {
    height: 25,
    profile: prof([0, 40], [1, 52]),
    shape: shape('flower', 6, 0.12, 0.4),
    vaseMode: false,
    base: 2.4,
  }),
  // Lampshades
  t('drum', 'Drum shade', 'Lampshades', 'A straight drum with fine ribs for soft light.', {
    height: 150,
    profile: prof([0, 90], [1, 90]),
    pattern: pattern('ribs', { count: 60, amplitude: 1.2, sharpness: 0.2 }),
    wall: 1.2,
    base: 2.4,
  }),
  t('bell', 'Bell shade', 'Lampshades', 'Narrow at the top, wide at the bottom.', {
    height: 150,
    profile: prof([0, 55], [0.5, 70], [1, 105]),
    wall: 1.4,
    base: 2.4,
  }),
  t('spiral-shade', 'Spiral pendant', 'Lampshades', 'A twisted star that throws spiral shadows.', {
    height: 170,
    profile: prof([0, 60], [0.5, 85], [1, 75]),
    shape: shape('star', 9, 0.18, 0.4),
    twist: 120,
    wall: 1.4,
    base: 2.4,
  }),
];

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['Vases', 'Planters', 'Bowls & pots', 'Lampshades'];

/** A random but sensible design: a profile archetype, a shape and a pattern. */
export function surprise(seed = Math.random()): VaseParams {
  let s = Math.floor(seed * 2 ** 31) || 1;
  const r = () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const h = Math.round(110 + r() * 100);
  const base = 26 + r() * 18;
  const profiles: P[] = [
    prof([0, base], [0.4, base * 1.5], [0.8, base * 0.7], [1, base * 0.9]),
    prof([0, base], [1, base * (0.8 + r() * 0.5)]),
    prof([0, base * 0.8], [0.5, base * 1.4], [1, base * 1.1]),
    prof([0, base], [0.3, base * 1.3], [0.7, base * 0.6], [1, base * 0.75]),
  ];
  const kind = pick<ShapeKind>(['circle', 'polygon', 'star', 'flower', 'gear', 'squircle']);
  const pat = pick<PatternKind>(['none', 'none', 'ribs', 'spiral', 'waves', 'diamond', 'bubbles', 'noise']);
  return {
    ...DEFAULT_VASE,
    type: 'vase',
    vaseMode: true,
    height: h,
    profile: pick(profiles).map((q) => ({ t: q.t, r: Math.round(q.r * 10) / 10 })),
    shape: { kind, sides: 3 + Math.floor(r() * 7), depth: 0.12 + r() * 0.2, rounding: r() * 0.6 },
    twist: pick([0, 0, 45, 90, 120, 180]),
    twistStyle: pick(['linear', 'ease', 'wave']),
    pattern: {
      ...DEFAULT_VASE.pattern,
      kind: pat,
      count: 8 + Math.floor(r() * 30),
      amplitude: 1 + r() * 2,
      rows: 4 + Math.floor(r() * 12),
      turns: 0.3 + r(),
      seed: Math.floor(r() * 1000),
    },
  };
}
