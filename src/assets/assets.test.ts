import { describe, expect, it } from 'vitest';
import { initKernel } from '@/cad/kernel/kernel';
import { meshDataBounds } from '@/cad/kernel/meshData';
import { validatePart } from '@/split/geometry/split';
import { importThreeMF } from '@/split/import/importer';
import { sampleEyeBadge } from '@/split/fixtures/build3mf';
import { outlineToMesh } from './outlines';
import { threeMfParts } from './threemf';
import { assetKind } from './library';

describe('assets', () => {
  it('turns artwork outlines into a solid of the requested size, holes kept', async () => {
    const square: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
    ];
    const hole: [number, number][] = [
      [40, 15],
      [40, 35],
      [60, 35],
      [60, 15],
    ];
    const mesh = outlineToMesh(await initKernel(), { polys: [square, hole], fillRule: 'Positive', name: 'logo' }, 40, 2);
    const b = meshDataBounds(mesh);
    expect(b.max.x - b.min.x).toBeCloseTo(40, 4);
    expect(b.max.y - b.min.y).toBeCloseTo(20, 4);
    expect(b.min.z).toBeCloseTo(0, 6);
    expect(b.max.z).toBeCloseTo(2, 6);
    const r = validatePart(mesh);
    expect(r.watertight).toBe(true);
    // 40×20 minus the 8×8 hole (scaled by 0.4), 2 mm tall.
    expect(r.volume).toBeCloseTo((40 * 20 - 8 * 8) * 2, 1);
  });

  it('reads the placed objects of a 3MF as separate coloured meshes', async () => {
    const doc = await importThreeMF(sampleEyeBadge(), 'badge.3mf');
    const parts = threeMfParts(doc);
    expect(parts.length).toBe(doc.instances.length);
    expect(parts.length).toBeGreaterThan(0);
    for (const p of parts) {
      expect(p.mesh.indices.length % 3).toBe(0);
      expect(p.color).toMatch(/^#[0-9A-Fa-f]{6}/);
      expect(validatePart(p.mesh).volume).toBeGreaterThan(0);
    }
  });

  it('recognises the file types it can keep', () => {
    expect(assetKind('logo.svg')).toBe('svg');
    expect(assetKind('photo.JPG', 'image/jpeg')).toBe('image');
    expect(assetKind('part.stl')).toBe('stl');
    expect(assetKind('plate.3mf')).toBe('3mf');
    expect(assetKind('notes.txt')).toBeNull();
  });
});
