import { createRequire } from 'node:module';
import * as THREE from 'three';
import type * as Replicad from 'replicad';
import { buildBrep } from './build';
import { exportStep, importStep, type StepExportItem } from './step';
import type { FeatureRecipe } from './types';

let r: typeof Replicad;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = require.resolve('replicad-opencascadejs/wasm');
  const { default: init } = await import('replicad-opencascadejs');
  const oc = await (init as unknown as (o: { locateFile: () => string }) => Promise<unknown>)({ locateFile: () => wasm });
  r = await import('replicad');
  r.setOC(oc as Parameters<typeof r.setOC>[0]);
}, 60000);

const near = (a: number, b: number, tol = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));
const box: FeatureRecipe = { base: { kind: 'primitive', shape: 'box', params: {} }, ops: [] };
const matrix = (pos: [number, number, number], rotDeg: [number, number, number] = [0, 0, 0]) =>
  new THREE.Matrix4()
    .compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotDeg.map((d) => (d * Math.PI) / 180) as [number, number, number]))),
      new THREE.Vector3(1, 1, 1),
    )
    .toArray();

describe('STEP export and import', () => {
  it('round-trips an exact filleted solid, rotated and moved, with its volume and position', async () => {
    const plain = buildBrep(r, { recipe: box, size: [30, 20, 10] });
    const edge = plain.edges.find(
      (e) => e.ref.kind === 'line' && Math.abs(e.ref.mid[1] + 1) < 1e-6 && Math.abs(e.ref.mid[2] - 1) < 1e-6,
    )!.ref;
    const recipe: FeatureRecipe = { ...box, ops: [{ id: 'f', kind: 'fillet', edges: [edge], radius: 3 }] };
    const item: StepExportItem = {
      kind: 'exact',
      name: 'Bracket',
      color: '#2463EB',
      req: { recipe, size: [30, 20, 10] },
      size: [30, 20, 10],
      matrix: matrix([50, -10, 5], [0, 0, 90]),
    };
    const out = await exportStep(r, [item]);
    expect(out.exact).toEqual(['Bracket']);
    expect(new TextDecoder().decode(out.bytes.subarray(0, 13))).toBe('ISO-10303-21;');
    const solids = await importStep(r, out.bytes, 'bracket.step');
    expect(solids).toHaveLength(1);
    const back = solids[0].build;
    near(back.volume, 6000 - (9 - (9 * Math.PI) / 4) * 30, 1e-6);
    // Rotated 90° about Z: 20 wide in X, 30 deep in Y; centred at (50, −10, 5).
    expect(back.size.map((v) => +v.toFixed(4))).toEqual([20, 30, 10]);
    expect(back.centre.map((v) => +v.toFixed(4))).toEqual([50, -10, 5]);
    expect(solids[0].name).toBe('bracket');
  });

  it('writes meshes as faceted solids and keeps several bodies apart', async () => {
    // A 10 mm tetrahedron (closed mesh) and an exact cylinder.
    const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]);
    const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
    const out = await exportStep(r, [
      { kind: 'mesh', name: 'Tetra', color: '#E0262B', positions, indices },
      {
        kind: 'exact',
        name: 'Peg',
        color: '#16A34A',
        req: { recipe: { base: { kind: 'primitive', shape: 'cylinder', params: {} }, ops: [] }, size: [10, 10, 20] },
        size: [10, 10, 20],
        matrix: matrix([40, 0, 10]),
      },
    ]);
    expect(out.faceted).toEqual(['Tetra']);
    expect(out.exact).toEqual(['Peg']);
    const solids = await importStep(r, out.bytes, 'parts.stp');
    expect(solids).toHaveLength(2);
    const vols = solids.map((s) => s.build.volume).sort((a, b) => a - b);
    near(vols[0], 1000 / 6, 1e-6);
    near(vols[1], Math.PI * 25 * 20, 1e-6);
    expect(solids.map((s) => s.name)).toEqual(['parts 1', 'parts 2']);
  });

  it('keeps uniform scaling exact and refuses uneven stretching of non-primitive solids', async () => {
    const sketchRecipe: FeatureRecipe = {
      base: {
        kind: 'sketch',
        sketch: {
          points: [{ id: 'o', x: 0, y: 0 }],
          entities: [{ id: 'c', kind: 'circle', c: 'o', r: 5 }],
          constraints: [],
        },
        op: 'extrude',
        depth: 10,
        angle: 360,
      },
      ops: [],
    };
    const doubled = await exportStep(r, [
      {
        kind: 'exact',
        name: 'D',
        color: '#000000',
        req: { recipe: sketchRecipe, size: [0, 0, 0] },
        size: [20, 20, 20],
        matrix: matrix([0, 0, 0]),
      },
    ]);
    near((await importStep(r, doubled.bytes, 'd.step'))[0].build.volume, Math.PI * 100 * 20, 1e-6);
    await expect(
      exportStep(r, [
        {
          kind: 'exact',
          name: 'Squashed',
          color: '#000000',
          req: { recipe: sketchRecipe, size: [0, 0, 0] },
          size: [10, 20, 10],
          matrix: matrix([0, 0, 0]),
        },
      ]),
    ).rejects.toThrow(/stretched unevenly/);
  });

  it('explains files that are not STEP or have no solids', async () => {
    await expect(importStep(r, new TextEncoder().encode('solid cube\nendsolid'), 'x.step')).rejects.toThrow(/not a STEP file/);
    await expect(
      importStep(r, new TextEncoder().encode('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n'), 'empty.step'),
    ).rejects.toThrow(/no closed solids|could not be read/);
  });

  it('imported solids can be filleted', async () => {
    const out = await exportStep(r, [
      {
        kind: 'exact',
        name: 'B',
        color: '#000000',
        req: { recipe: box, size: [20, 20, 10] },
        size: [20, 20, 10],
        matrix: matrix([0, 0, 0]),
      },
    ]);
    const [solid] = await importStep(r, out.bytes, 'b.step');
    const edge = solid.build.edges.find(
      (e) => e.ref.kind === 'line' && Math.abs(e.ref.mid[1] + 1) < 1e-6 && Math.abs(e.ref.mid[2] - 1) < 1e-6,
    )!.ref;
    const filleted = buildBrep(r, {
      recipe: { base: { kind: 'brep', data: solid.data, source: 'b.step' }, ops: [{ id: 'f', kind: 'fillet', edges: [edge], radius: 2 }] },
      size: [0, 0, 0],
    });
    near(filleted.volume, 4000 - (4 - Math.PI) * 20, 1e-6);
  });
});
