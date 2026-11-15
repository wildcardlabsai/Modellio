import { describe, expect, it } from 'vitest';
import { initKernel } from '../kernel/kernel';
import { geometryToMeshData } from '../kernel/meshData';
import { buildShapeGeometry } from '../shapeRegistry';
import { validatePart } from '@/split/geometry/split';
import { applyMeshTool, meshMeasures, meshReport, weldMesh } from './meshTools';

const sphere = () => geometryToMeshData(buildShapeGeometry('sphere', [20, 20, 20], { segments: 48 }));
const cube = () => geometryToMeshData(buildShapeGeometry('box', [20, 20, 20], { radius: 0 }));

describe('mesh measures', () => {
  it('a 20 mm cube is 8000 mm³ with 2400 mm² of surface', () => {
    const m = meshMeasures(cube());
    expect(m.volume).toBeCloseTo(8000, 3);
    expect(m.area).toBeCloseTo(2400, 3);
  });

  it('a sphere is within 1% of the ideal volume and area', () => {
    const m = meshMeasures(sphere());
    expect(Math.abs(m.volume - (4 / 3) * Math.PI * 1000) / ((4 / 3) * Math.PI * 1000)).toBeLessThan(0.01);
    expect(Math.abs(m.area - 4 * Math.PI * 100) / (4 * Math.PI * 100)).toBeLessThan(0.01);
  });

  it('gives a positive volume for an inside-out (flipped) mesh', () => {
    const m = cube();
    const flipped = new Uint32Array(m.indices);
    for (let t = 0; t < flipped.length; t += 3) [flipped[t + 1], flipped[t + 2]] = [flipped[t + 2], flipped[t + 1]];
    expect(meshMeasures({ positions: m.positions, indices: flipped }).volume).toBeCloseTo(8000, 3);
  });
});

describe('mesh tools', () => {
  it('reports a closed solid, and an open one after removing a triangle', () => {
    const m = cube();
    expect(meshReport(m)).toMatchObject({ boundaryEdges: 0, nonManifoldEdges: 0 });
    const open = { positions: m.positions, indices: m.indices.slice(3) };
    expect(meshReport(open).boundaryEdges).toBe(3);
  });

  it('simplify removes triangles and keeps a closed solid of about the same volume', async () => {
    const k = await initKernel();
    const src = sphere();
    const out = applyMeshTool(k, src, 'simplify', 0.3);
    expect(out.indices.length).toBeLessThan(src.indices.length);
    const a = validatePart(src);
    const b = validatePart(out);
    expect(b.watertight).toBe(true);
    expect(Math.abs(b.volume - a.volume) / a.volume).toBeLessThan(0.05);
  });

  it('subdivide multiplies the triangles without changing the shape', async () => {
    const k = await initKernel();
    const src = cube();
    const out = applyMeshTool(k, src, 'subdivide', 2);
    expect(out.indices.length / 3).toBe((src.indices.length / 3) * 4);
    expect(validatePart(out).volume).toBeCloseTo(8000, 0);
  });

  it('smooth rounds a cube: more triangles, less volume, still closed', async () => {
    const k = await initKernel();
    const out = applyMeshTool(k, cube(), 'smooth', 3);
    const r = validatePart(out);
    expect(r.watertight).toBe(true);
    expect(r.volume).toBeLessThan(8000);
    expect(r.volume).toBeGreaterThan(8000 * 0.5);
  });

  it('repair welds split vertices back into a closed solid; reshaping an open mesh explains why not', async () => {
    const k = await initKernel();
    const m = cube();
    // Unweld: every triangle gets its own vertices (as raw STL has).
    const P: number[] = [];
    for (const i of m.indices) P.push(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]);
    const raw = { positions: new Float32Array(P), indices: new Uint32Array(P.length / 3).map((_, i) => i) };
    expect(meshReport(raw).boundaryEdges).toBeGreaterThan(0);
    const fixed = applyMeshTool(k, raw, 'repair', 0.01);
    expect(meshReport(fixed)).toMatchObject({ boundaryEdges: 0, nonManifoldEdges: 0 });
    expect(meshReport(weldMesh(raw)).boundaryEdges).toBe(0);
    const open = { positions: m.positions, indices: m.indices.slice(3) };
    expect(() => applyMeshTool(k, open, 'smooth', 2)).toThrow(/not a closed solid/);
  });
});
