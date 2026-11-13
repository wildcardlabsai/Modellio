import { SHAPES as COOKIE_SHAPES, capsule, circle, type Poly, type ShapeDef } from '../cookie/shapes';

/** Rounded rectangle centred on the origin. */
export function roundedRect(w: number, h: number, r: number, n = 12): Poly {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr <= 0)
    return [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ];
  const p: Poly = [];
  const corners: [number, number, number][] = [
    [w / 2 - rr, -h / 2 + rr, -Math.PI / 2],
    [w / 2 - rr, h / 2 - rr, 0],
    [-w / 2 + rr, h / 2 - rr, Math.PI / 2],
    [-w / 2 + rr, -h / 2 + rr, Math.PI],
  ];
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      p.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  return p;
}

/** Extra plate shapes for tags and badges. */
const EXTRA: ShapeDef[] = [
  { id: 'rect', label: 'Rectangle', polygons: () => [roundedRect(2, 1, 0)] },
  { id: 'rounded', label: 'Rounded rectangle', polygons: () => [roundedRect(2.4, 1, 0.22)] },
  { id: 'pill', label: 'Pill', polygons: () => [capsule(-0.8, 0, 0.8, 0, 0.5)] },
  {
    id: 'luggage',
    label: 'Luggage tag',
    polygons: () => [
      [
        [-1.2, -0.6],
        [0.85, -0.6],
        [1.2, -0.25],
        [1.2, 0.25],
        [0.85, 0.6],
        [-1.2, 0.6],
      ],
    ],
  },
  {
    id: 'shield',
    label: 'Shield',
    polygons: () => {
      // Counter-clockwise from the bottom point: right curve up, flat top, left curve down.
      const q = (a: [number, number], c: [number, number], b: [number, number], t: number): [number, number] => [
        (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
        (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
      ];
      const p: Poly = [];
      for (let i = 0; i <= 20; i++) p.push(q([0, -1], [1, -0.55], [1, 0.25], i / 20));
      p.push([1, 1], [-1, 1]);
      for (let i = 0; i < 20; i++) p.push(q([-1, 0.25], [-1, -0.55], [0, -1], i / 20));
      return [p];
    },
  },
  {
    id: 'hexagon',
    label: 'Hexagon',
    polygons: () => [Array.from({ length: 6 }, (_, i) => [Math.cos((i * Math.PI) / 3), Math.sin((i * Math.PI) / 3)] as [number, number])],
  },
  {
    id: 'paw',
    label: 'Paw print',
    polygons: () => [
      circle(0, -0.35, 0.62, 64),
      circle(-0.78, 0.35, 0.27, 48),
      circle(-0.3, 0.78, 0.27, 48),
      circle(0.3, 0.78, 0.27, 48),
      circle(0.78, 0.35, 0.27, 48),
    ],
  },
  {
    id: 'bolt',
    label: 'Lightning',
    polygons: () => [
      [
        [0.15, 1],
        [-0.55, -0.1],
        [-0.05, -0.1],
        [-0.25, -1],
        [0.55, 0.15],
        [0.05, 0.15],
      ],
    ],
  },
  {
    id: 'drop',
    label: 'Drop',
    polygons: () => {
      // Teardrop with its point at the top (the parametric curve runs clockwise, so reverse it).
      const p: Poly = [];
      for (let i = 0; i < 96; i++) {
        const t = (i / 96) * 2 * Math.PI;
        p.push([0.75 * Math.sin(t) * Math.sin(t / 2), Math.cos(t)]);
      }
      return [p.reverse()];
    },
  },
  { id: 'ring', label: 'Ring', polygons: () => [circle(0, 0, 1, 96), circle(0, 0, 0.6, 96, true)] },
];

export const CANVAS_SHAPES: ShapeDef[] = [
  ...EXTRA,
  ...COOKIE_SHAPES.filter((s) => s.id !== 'circle'),
  ...COOKIE_SHAPES.filter((s) => s.id === 'circle'),
];
export const canvasShape = (id: string) => CANVAS_SHAPES.find((s) => s.id === id) ?? CANVAS_SHAPES[0];
export type { Poly };
