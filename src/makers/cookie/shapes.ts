/**
 * Built-in cookie shapes as polygon outlines (any scale, Y up, counter-clockwise).
 * Polygons are combined with the "positive" fill rule: overlapping pieces union and a
 * clockwise polygon cuts a hole. Everything is generated; nothing is a bitmap.
 */
export type Poly = [number, number][];

export interface ShapeDef {
  id: string;
  label: string;
  polygons: () => Poly[];
}

const TAU = Math.PI * 2;

export function circle(cx: number, cy: number, r: number, n = 96, cw = false): Poly {
  const p: Poly = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU * (cw ? -1 : 1);
    p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return p;
}

/** A segment with round ends (stadium). */
export function capsule(ax: number, ay: number, bx: number, by: number, r: number, n = 24): Poly {
  const ang = Math.atan2(by - ay, bx - ax);
  const p: Poly = [];
  for (let i = 0; i <= n; i++) {
    const a = ang - Math.PI / 2 + (i / n) * Math.PI;
    p.push([bx + r * Math.cos(a), by + r * Math.sin(a)]);
  }
  for (let i = 0; i <= n; i++) {
    const a = ang + Math.PI / 2 + (i / n) * Math.PI;
    p.push([ax + r * Math.cos(a), ay + r * Math.sin(a)]);
  }
  return p;
}

const polar = (n: number, f: (t: number) => number): Poly => {
  const p: Poly = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const r = f(t);
    p.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return p;
};

const rect = (x0: number, y0: number, x1: number, y1: number): Poly => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

export const SHAPES: ShapeDef[] = [
  {
    id: 'heart',
    label: 'Heart',
    polygons: () => {
      const p: Poly = [];
      for (let i = 0; i < 160; i++) {
        const t = (i / 160) * TAU;
        p.push([16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]);
      }
      return [p.reverse()]; // the parametric heart runs clockwise
    },
  },
  {
    id: 'star',
    label: 'Star',
    polygons: () => {
      const p: Poly = [];
      for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 + (i / 10) * TAU;
        const r = i % 2 ? 0.45 : 1;
        p.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return [p];
    },
  },
  { id: 'circle', label: 'Circle', polygons: () => [circle(0, 0, 1, 128)] },
  { id: 'fluted', label: 'Fluted circle', polygons: () => [polar(240, (t) => 1 + 0.07 * Math.cos(12 * t))] },
  {
    id: 'gingerbread',
    label: 'Gingerbread',
    polygons: () => [
      circle(0, 3.15, 1.05),
      capsule(0, 1.7, 0, -0.5, 1.05),
      capsule(-1.95, 1.25, 1.95, 1.25, 0.52),
      capsule(-0.25, -0.4, -1.15, -2.85, 0.6),
      capsule(0.25, -0.4, 1.15, -2.85, 0.6),
    ],
  },
  {
    id: 'cloud',
    label: 'Cloud',
    polygons: () => [
      circle(-1.25, 0, 0.8),
      circle(-0.35, 0.55, 1.05),
      circle(0.75, 0.35, 0.95),
      circle(1.5, -0.1, 0.65),
      capsule(-1.25, -0.35, 1.5, -0.35, 0.45),
    ],
  },
  {
    id: 'tree',
    label: 'Tree',
    polygons: () => [
      [
        [-2, -1.2],
        [2, -1.2],
        [0, 1.2],
      ],
      [
        [-1.6, 0.2],
        [1.6, 0.2],
        [0, 2.3],
      ],
      [
        [-1.15, 1.4],
        [1.15, 1.4],
        [0, 3.2],
      ],
      rect(-0.38, -2.1, 0.38, -1.1),
    ],
  },
  {
    id: 'egg',
    label: 'Egg',
    polygons: () => {
      const p: Poly = [];
      for (let i = 0; i < 128; i++) {
        const t = (i / 128) * TAU;
        p.push([0.78 * Math.cos(t) * (1 - 0.12 * Math.sin(t)), Math.sin(t)]);
      }
      return [p];
    },
  },
  {
    id: 'bone',
    label: 'Bone',
    polygons: () => [
      rect(-1.6, -0.32, 1.6, 0.32),
      circle(-1.7, 0.36, 0.48),
      circle(-1.7, -0.36, 0.48),
      circle(1.7, 0.36, 0.48),
      circle(1.7, -0.36, 0.48),
    ],
  },
  {
    id: 'house',
    label: 'House',
    polygons: () => [
      rect(-1.2, -1.2, 1.2, 0.6),
      [
        [-1.6, 0.5],
        [1.6, 0.5],
        [0, 1.9],
      ],
      rect(0.55, 0.9, 0.95, 1.9),
    ],
  },
  {
    id: 'bunny',
    label: 'Bunny',
    polygons: () => {
      const ear = (cx: number, tilt: number): Poly => {
        const p: Poly = [];
        for (let i = 0; i < 64; i++) {
          const t = (i / 64) * TAU;
          const x = 0.38 * Math.cos(t);
          const y = 1.05 * Math.sin(t);
          p.push([cx + x * Math.cos(tilt) - y * Math.sin(tilt), 1.55 + x * Math.sin(tilt) + y * Math.cos(tilt)]);
        }
        return p;
      };
      return [circle(0, 0, 1.05), ear(-0.45, 0.18), ear(0.45, -0.18)];
    },
  },
  {
    id: 'moon',
    label: 'Moon',
    // A clockwise circle subtracts under the positive fill rule.
    polygons: () => [circle(0, 0, 1, 128), circle(0.45, 0.25, 0.85, 128, true)],
  },
];

export const shapeById = (id: string) => SHAPES.find((s) => s.id === id) ?? SHAPES[0];
