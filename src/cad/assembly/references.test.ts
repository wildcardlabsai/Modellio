import { createRequire } from 'node:module';
import * as THREE from 'three';
import type * as Replicad from 'replicad';
import { buildBrep } from '../brep/build';
import type { BrepBuild, FeatureRecipe } from '../brep/types';
import type { Vec3 } from '@/types/document';
import { edgeGeometry, faceGeometry, mate, suitability, symmetricEigen, type RefGeom } from './references';

let r: typeof Replicad;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = require.resolve('replicad-opencascadejs/wasm');
  const { default: init } = await import('replicad-opencascadejs');
  const oc = await (init as unknown as (o: { locateFile: () => string }) => Promise<unknown>)({ locateFile: () => wasm });
  r = await import('replicad');
  r.setOC(oc as Parameters<typeof r.setOC>[0]);
}, 60000);

const prim = (shape: string): FeatureRecipe => ({ base: { kind: 'primitive', shape, params: {} }, ops: [] }) as FeatureRecipe;
const build = (shape: string, size: Vec3): BrepBuild => buildBrep(r, { recipe: prim(shape), size });
const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const near = (a: number[], b: number[], tol = 1e-3) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(tol));
/** Up to sign (an axis has no preferred direction). */
const sameLine = (a: number[], b: number[]) => expect(Math.abs(new THREE.Vector3(...a).dot(new THREE.Vector3(...b)))).toBeCloseTo(1, 4);

describe('joint references from real geometry', () => {
  it('a flat face gives its centre and outward normal', () => {
    const b = build('box', [20, 10, 6]);
    const top = b.faces.findIndex((f) => f.ref.kind === 'plane' && f.ref.normal[2] > 0.5);
    const g = faceGeometry(b, top, [20, 10, 6], undefined, at(100, 0, 3), 'Base');
    expect(g.kind).toBe('plane');
    if (g.kind !== 'plane') return;
    near(g.origin, [100, 0, 6]);
    near(g.axis, [0, 0, 1]);
    expect(g.label).toMatch(/flat face of Base/);
  });

  it('a cylinder’s round face gives its axis and diameter (fitted from the face itself)', () => {
    const b = build('cylinder', [8, 8, 30]);
    const side = b.faces.findIndex((f) => f.ref.kind === 'cylinder');
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(5, 5, 5); // lying along Y
    const g = faceGeometry(b, side, [8, 8, 30], undefined, rot, 'Pin');
    expect(g.kind).toBe('axis');
    if (g.kind !== 'axis') return;
    sameLine(g.axis, [0, 1, 0]);
    near(g.origin, [5, 5, 5], 0.05);
    expect(g.radius!).toBeCloseTo(4, 1);
    expect(g.label).toMatch(/Ø8\.0 mm/);
  });

  it('a circular edge gives its centre and axis; a straight edge its middle and direction', () => {
    const b = build('cylinder', [10, 10, 4]);
    const ci = b.edges.findIndex((e) => e.ref.kind === 'circle');
    const g = edgeGeometry(b, ci, [10, 10, 4], undefined, new THREE.Matrix4(), 'Disc');
    expect(g.kind).toBe('axis');
    if (g.kind === 'axis') {
      sameLine(g.axis, [0, 0, 1]);
      near(g.origin.slice(0, 2), [0, 0], 0.01);
      expect(g.radius!).toBeCloseTo(5, 2);
    }
    const box = build('box', [20, 10, 6]);
    const li = box.edges.findIndex((e) => e.ref.kind === 'line' && Math.abs(e.ref.dir[0]) > 0.9);
    const l = edgeGeometry(box, li, [20, 10, 6], undefined, new THREE.Matrix4(), 'Box');
    expect(l.kind).toBe('axis');
    if (l.kind === 'axis') sameLine(l.axis, [1, 0, 0]);
  });

  it('two flat faces mate face to face; offset leaves a gap; reverse turns the part round', () => {
    const base = build('box', [20, 20, 10]);
    const lid = build('box', [20, 20, 2]);
    const top = base.faces.findIndex((f) => f.ref.kind === 'plane' && f.ref.normal[2] > 0.5);
    const under = lid.faces.findIndex((f) => f.ref.kind === 'plane' && f.ref.normal[2] < -0.5);
    const worldA = at(0, 0, 5);
    const worldB = at(50, 40, 30); // somewhere else entirely
    const a = faceGeometry(base, top, [20, 20, 10], undefined, worldA, 'Base');
    const b = faceGeometry(lid, under, [20, 20, 2], undefined, worldB, 'Lid');
    const m = mate({ kind: 'revolute', a, b, worldA, worldB, flip: false, offset: 0, angle: 0, snap: true });
    expect('error' in m).toBe(false);
    if ('error' in m) return;
    // The lid's underside sits on the base's top: lid centre at z = 10 + 1.
    near(new THREE.Vector3().setFromMatrixPosition(m.worldB).toArray(), [0, 0, 11]);
    // Nothing turned upside down.
    near(new THREE.Vector3(0, 0, 1).transformDirection(m.worldB).toArray(), [0, 0, 1]);
    const gap = mate({ kind: 'revolute', a, b, worldA, worldB, flip: false, offset: 3, angle: 0, snap: true });
    if (!('error' in gap)) near(new THREE.Vector3().setFromMatrixPosition(gap.worldB).toArray(), [0, 0, 14]);
    const rev = mate({ kind: 'revolute', a, b, worldA, worldB, flip: true, offset: 0, angle: 0, snap: true });
    if (!('error' in rev)) near(new THREE.Vector3(0, 0, 1).transformDirection(rev.worldB).toArray(), [0, 0, -1]);
    // The joint's rest pose is that place: world(A) · frameA · frameB⁻¹ = world(B).
    const rest = worldA
      .clone()
      .multiply(new THREE.Matrix4().fromArray(m.frameA))
      .multiply(new THREE.Matrix4().fromArray(m.frameB).invert());
    near(rest.toArray(), m.worldB.toArray());
  });

  it('a pin mates coaxially into a hole edge; without snapping the part stays put', () => {
    const plate = build('cylinder', [30, 30, 4]);
    const pin = build('cylinder', [6, 6, 20]);
    const rim = plate.edges.findIndex((e) => e.ref.kind === 'circle');
    const side = pin.faces.findIndex((f) => f.ref.kind === 'cylinder');
    const worldA = at(0, 0, 2);
    const worldB = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(40, 0, 10);
    const a = edgeGeometry(plate, rim, [30, 30, 4], undefined, worldA, 'Plate');
    const b = faceGeometry(pin, side, [6, 6, 20], undefined, worldB, 'Pin');
    const m = mate({ kind: 'cylindrical', a, b, worldA, worldB, flip: false, offset: 0, angle: 0, snap: true });
    if ('error' in m) throw new Error(m.error);
    const axis = new THREE.Vector3(0, 0, 1).transformDirection(m.worldB);
    expect(Math.abs(axis.z)).toBeCloseTo(1, 4); // the pin now stands on the plate's axis
    near(new THREE.Vector3().setFromMatrixPosition(m.worldB).toArray().slice(0, 2), [0, 0], 0.05);
    const stay = mate({ kind: 'cylindrical', a, b, worldA, worldB, flip: false, offset: 0, angle: 0, snap: false });
    if (!('error' in stay)) near(stay.worldB.toArray(), worldB.toArray());
  });

  it('explains unsuitable references', () => {
    const plane: RefGeom = { kind: 'plane', origin: [0, 0, 0], axis: [0, 0, 1], x: [1, 0, 0], label: 'a flat face of A' };
    const axis: RefGeom = { kind: 'axis', origin: [0, 0, 0], axis: [0, 0, 1], label: 'a round face of B' };
    const ball: RefGeom = { kind: 'point', origin: [0, 0, 0], label: 'a spherical face of C' };
    const torus: RefGeom = { kind: 'none', label: 'a ring-shaped face of D', why: 'That face has no flat side or straight axis.' };
    expect(suitability('planar', plane, axis)).toMatch(/round face of B is not flat/);
    expect(suitability('revolute', plane, ball)).toMatch(/needs an axis/);
    expect(suitability('slider', torus, plane)).toMatch(/^A ring-shaped face of D: /);
    expect(suitability('rigid', ball, plane)).toBeNull();
    expect(suitability('revolute', axis, plane)).toBeNull();
  });

  it('the eigen solver finds the least-spread direction', () => {
    const { vectors } = symmetricEigen([
      [4, 0, 0],
      [0, 1, 0],
      [0, 0, 9],
    ]);
    sameLine(vectors[0].toArray(), [0, 1, 0]);
  });
});
