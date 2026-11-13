import { describe, expect, it } from 'vitest';
import { buildPreviewBuffers } from './preview';
import { boxMesh } from '../fixtures/build3mf';
import { unzip } from '../import/unzip';
import { strToU8, unzipSync, zipSync } from 'fflate';

describe('preview buffers', () => {
  it('orders triangles by material and keeps box edges sharp', () => {
    const box = boxMesh([0, 0, 0], [2, 2, 2]);
    const vertices = new Float32Array(box.vertices.flat());
    const triangles = new Uint32Array(box.triangles.flatMap((t) => t.v));
    const ids = new Uint32Array([2, 0, 2, 0, 1, 1, 2, 2, 0, 0, 1, 1]);
    const p = buildPreviewBuffers(vertices, triangles, ids);
    expect(Array.from(p.groups)).toEqual([0, 4, 0, 4, 4, 1, 8, 4, 2]);
    expect(p.positions.length).toBe(12 * 9);
    // Every normal is unit length and equals its face normal (90° edges are creased).
    for (let i = 0; i < p.normals.length; i += 3) {
      expect(Math.hypot(p.normals[i], p.normals[i + 1], p.normals[i + 2])).toBeCloseTo(1, 5);
      expect(Math.max(Math.abs(p.normals[i]), Math.abs(p.normals[i + 1]), Math.abs(p.normals[i + 2]))).toBeCloseTo(1, 5);
    }
  });
});

describe('native unzip', () => {
  it('matches fflate for stored and deflated entries and honours the filter', async () => {
    const files = {
      'a.model': strToU8('x'.repeat(5000) + 'model'),
      'b/c.rels': strToU8('<rels/>'),
      'thumb.png': new Uint8Array([1, 2, 3]),
    };
    for (const level of [0, 6] as const) {
      const zip = zipSync(files, { level });
      const ours = await unzip(zip, (n) => !n.endsWith('.png'));
      const ref = unzipSync(zip);
      expect(Object.keys(ours).sort()).toEqual(['a.model', 'b/c.rels']);
      for (const k of Object.keys(ours)) expect(Array.from(ours[k])).toEqual(Array.from(ref[k]));
    }
  });
});
