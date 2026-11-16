import { describe, expect, it } from 'vitest';
import { chainPolygon, polygonsCross, sketchOutlines } from './outline';
import type { Sketch } from './types';

/** A sketch from points and edges given as [kind, a, b, centre?]. */
function sketch(points: [string, number, number][], edges: (['line', string, string] | ['arc', string, string, string])[]): Sketch {
  return {
    points: points.map(([id, x, y]) => ({ id, x, y })),
    entities: edges.map((e, i) =>
      e[0] === 'line' ? { id: `e${i}`, kind: 'line', a: e[1], b: e[2] } : { id: `e${i}`, kind: 'arc', a: e[1], b: e[2], c: e[3] },
    ),
    constraints: [],
  } as Sketch;
}

const square = (o = 0, s = 10): [string, number, number][] => [
  [`a${o}`, o, 0],
  [`b${o}`, o + s, 0],
  [`c${o}`, o + s, s],
  [`d${o}`, o, s],
];
const squareEdges = (o = 0): ['line', string, string][] => [
  ['line', `a${o}`, `b${o}`],
  ['line', `b${o}`, `c${o}`],
  ['line', `c${o}`, `d${o}`],
  ['line', `d${o}`, `a${o}`],
];

describe('sketch outlines (shared by both geometry engines)', () => {
  it('finds a closed chain and reports nothing wrong', () => {
    const o = sketchOutlines(sketch(square(), squareEdges()));
    expect(o.chains).toHaveLength(1);
    expect(o).toMatchObject({ open: 0, branches: 0, crossing: false });
  });

  it('counts open chains, and points where more than two curves meet', () => {
    const pts = [...square(), ['e', 20, 0] as [string, number, number]];
    const o = sketchOutlines(sketch(pts, [...squareEdges(), ['line', 'b0', 'e']]));
    expect(o.branches).toBe(1);
    expect(sketchOutlines(sketch(square(), squareEdges().slice(0, 3))).open).toBe(1);
  });

  it('spots outlines that cross', () => {
    // A second square shifted diagonally, so the edges truly cross.
    const shifted = square(5).map(([id, x, y]) => [id, x, y + 5] as [string, number, number]);
    const two = sketch([...square(0), ...shifted], [...squareEdges(0), ...squareEdges(5)]);
    expect(sketchOutlines(two).crossing).toBe(true);
    const apart = sketch([...square(0), ...square(20)], [...squareEdges(0), ...squareEdges(20)]);
    expect(sketchOutlines(apart).crossing).toBe(false);
    // A bow-tie crosses itself.
    expect(
      polygonsCross([
        [
          [0, 0],
          [10, 10],
          [10, 0],
          [0, 10],
        ],
      ]),
    ).toBe(true);
  });

  it('walks an arc either way round with the same samples', () => {
    // A "D": a line from (0,-5) to (0,5) closed by a counter-clockwise arc around the origin.
    const fwd = sketchOutlines(
      sketch(
        [
          ['p', 0, -5],
          ['q', 0, 5],
          ['o', 0, 0],
        ],
        [
          ['arc', 'p', 'q', 'o'],
          ['line', 'q', 'p'],
        ],
      ),
    );
    const back = sketchOutlines(
      sketch(
        [
          ['p', 0, -5],
          ['q', 0, 5],
          ['o', 0, 0],
        ],
        [
          ['line', 'p', 'q'],
          ['arc', 'p', 'q', 'o'],
        ],
      ),
    );
    const ring = (o: typeof fwd) => chainPolygon(o.chains[0]).map((p) => p.map((v) => Math.round(v * 1e6) / 1e6).join());
    expect(new Set(ring(fwd))).toEqual(new Set(ring(back)));
    // The arc bulges to +x (counter-clockwise from (0,−5) to (0,5)).
    expect(Math.max(...chainPolygon(fwd.chains[0]).map((p) => p[0]))).toBeCloseTo(5, 6);
  });
});
