import fs from 'node:fs';
import * as THREE from 'three';
import { produce } from 'immer';
import type { ModelDocument, ObjectId, ShapeObject, Vec3 } from '@/types/document';
import { addObjectDraft, createEmptyDocument, createShape } from '../document';
import { groupDraft, worldBoundsOf } from '../hierarchy';
import { initKernel } from '../kernel/kernel';
import { meshDataToGeometry } from '../kernel/meshData';
import { analyzeMesh } from '../geometry/validate';
import { bakeGroupDraft, computeCombined, separateDraft } from './combine';
import { buildGeometryForShape } from '../shapeRegistry';
import { parseFont, registerFont } from '../text/fonts';
import { buildTextMesh } from '../text/textGeometry';
import { getKernel } from '../kernel/kernel';

beforeAll(async () => {
  await initKernel();
  const buf = fs.readFileSync('node_modules/@fontsource/inter/files/inter-latin-700-normal.woff');
  registerFont('inter-bold', await parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  const pac = fs.readFileSync('node_modules/@fontsource/pacifico/files/pacifico-latin-400-normal.woff');
  registerFont('pacifico', await parseFont(pac.buffer.slice(pac.byteOffset, pac.byteOffset + pac.byteLength)));
});

function build(specs: { type?: ShapeObject['shape']; pos: Vec3; size?: Vec3; hole?: boolean; rot?: Vec3 }[]) {
  let doc = createEmptyDocument();
  const ids: ObjectId[] = [];
  for (const s of specs) {
    const o = createShape(doc, s.type ?? 'box', s.pos);
    if (s.size) o.size = s.size;
    if (s.rot) o.transform.rotation = s.rot;
    o.isHole = !!s.hole;
    ids.push(o.id);
    doc = produce(doc, (d) => addObjectDraft(d, o));
  }
  return { doc, ids };
}

const combined = (doc: ModelDocument, ids: ObjectId[], mode: 'union' | 'intersect' = 'union') =>
  produce(doc, (d) => {
    groupDraft(d, ids, { id: 'g', name: 'G' });
    (d.objects.g as { combine?: string }).combine = mode;
  });

const resultVolume = (doc: ModelDocument) => {
  const r = computeCombined(doc, 'g')!;
  expect(r.error).toBeNull();
  const report = analyzeMesh(meshDataToGeometry(r.mesh!));
  expect(report.watertight).toBe(true);
  return report.volume;
};

describe('Boolean combine', () => {
  it('union of two overlapping boxes has the exact volume', () => {
    const { doc, ids } = build([{ pos: [0, 0, 10] }, { pos: [10, 0, 10] }]); // overlap 10×20×20
    expect(resultVolume(combined(doc, ids))).toBeCloseTo(8000 + 8000 - 4000, 1);
  });

  it('subtracts holes: box with a cylindrical hole through it', () => {
    const { doc, ids } = build([
      { pos: [0, 0, 10], size: [40, 40, 20] },
      { type: 'cylinder', pos: [0, 0, 10], size: [10, 10, 30], hole: true },
    ]);
    const v = resultVolume(combined(doc, ids));
    // cylinder (64 segments) area ≈ πr² within 0.2%
    expect(v).toBeCloseTo(32000 - Math.PI * 25 * 20, -1);
  });

  it('handles exactly coplanar faces (hole flush with the top face)', () => {
    const { doc, ids } = build([
      { pos: [0, 0, 10], size: [20, 20, 20] },
      { pos: [0, 0, 15], size: [10, 10, 10], hole: true }, // pocket: top faces coincide at z=20
    ]);
    expect(resultVolume(combined(doc, ids))).toBeCloseTo(8000 - 1000, 1);
  });

  it('intersection keeps only the common volume', () => {
    const { doc, ids } = build([{ pos: [0, 0, 10] }, { pos: [10, 10, 10] }]);
    expect(resultVolume(combined(doc, ids, 'intersect'))).toBeCloseTo(10 * 10 * 20, 1);
  });

  it('respects rotated parts and nested combined groups', () => {
    const { doc, ids } = build([
      { pos: [0, 0, 10], size: [30, 30, 20] },
      { pos: [0, 0, 10], size: [10, 50, 50], hole: true, rot: [0, 0, 45] },
      { type: 'sphere', pos: [40, 0, 10] },
    ]);
    let d = produce(doc, (dr) => {
      groupDraft(dr, [ids[0], ids[1]], { id: 'inner', name: 'Inner' });
      (dr.objects.inner as { combine?: string }).combine = 'union';
    });
    d = produce(d, (dr) => {
      groupDraft(dr, ['inner', ids[2]], { id: 'g', name: 'Outer' });
      (dr.objects.g as { combine?: string }).combine = 'union';
    });
    const v = resultVolume(d);
    expect(v).toBeGreaterThan(0);
    const inner = computeCombined(d, 'inner')!;
    expect(inner.error).toBeNull();
    // the slot (10 mm wide, diagonal) removes more than a straight 10×30 slot
    expect(analyzeMesh(meshDataToGeometry(inner.mesh!)).volume).toBeLessThan(18000 - 10 * 30 * 20 + 1);
  });

  it('reports an empty result instead of crashing', () => {
    const { doc, ids } = build([{ pos: [0, 0, 10] }, { pos: [100, 0, 10] }]);
    const r = computeCombined(combined(doc, ids, 'intersect'), 'g')!;
    expect(r.mesh).toBeNull();
    expect(r.error).toMatch(/empty/);
  });

  it('bounds of a combined group come from the real result', () => {
    const { doc, ids } = build([{ pos: [0, 0, 10] }, { pos: [10, 0, 10] }]);
    const d = combined(doc, ids, 'intersect');
    const b = worldBoundsOf(d, ['g']);
    expect(b.max.x - b.min.x).toBeCloseTo(10, 3);
  });

  it('caches results and invalidates on geometry changes only', () => {
    const { doc, ids } = build([{ pos: [0, 0, 10] }, { pos: [10, 0, 10] }]);
    const d = combined(doc, ids);
    const a = computeCombined(d, 'g');
    const recoloured = produce(d, (dr) => void ((dr.objects[ids[0]] as ShapeObject).color = '#FF0000'));
    const b = computeCombined(recoloured, 'g');
    expect(b!.mesh).toBe(a!.mesh);
    expect(b!.color).toBe('#FF0000');
    const moved = produce(d, (dr) => void (dr.objects[ids[1]].transform.position[0] = 15));
    expect(computeCombined(moved, 'g')!.mesh).not.toBe(a!.mesh);
  });

  it('bakes to a single mesh shape in the same place, then separates into parts', () => {
    const { doc, ids } = build([{ pos: [0, 0, 10] }, { pos: [50, 0, 10] }]);
    const d = combined(doc, ids);
    const before = worldBoundsOf(d, ['g']);
    let bakedId: string | null = null;
    const baked = produce(d, (dr) => void (bakedId = bakeGroupDraft(dr, 'g', 'Baked')));
    expect(baked.objects.g).toBeUndefined();
    const shape = baked.objects[bakedId!] as ShapeObject;
    expect(shape.shape).toBe('mesh');
    const after = worldBoundsOf(baked, [bakedId!]);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-3);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-3);
    const geo = buildGeometryForShape(shape)!;
    expect(analyzeMesh(geo).volume).toBeCloseTo(16000, 0);

    let parts: string[] = [];
    const split = produce(baked, (dr) => void (parts = separateDraft(dr, bakedId!)));
    expect(parts).toHaveLength(2);
    expect(split.objects[bakedId!]).toBeUndefined();
    const xs = parts.map((id) => worldBoundsOf(split, [id]).getCenter(new THREE.Vector3()).x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0, 3);
    expect(xs[1]).toBeCloseTo(50, 3);
  });
});

describe('3D text', () => {
  it('builds watertight text with holes in letters (O, A, B, 8)', async () => {
    const { getLoadedFont } = await import('../text/fonts');
    const mesh = buildTextMesh(getKernel()!, getLoadedFont('inter-bold')!, { content: 'OAB8 Hi!', fontSize: 10, depth: 3 })!;
    const r = analyzeMesh(meshDataToGeometry(mesh));
    expect(r.watertight).toBe(true);
    expect(r.volume).toBeGreaterThan(0);
  });

  it('handles a script font with overlapping glyph contours', async () => {
    const { getLoadedFont } = await import('../text/fonts');
    const mesh = buildTextMesh(getKernel()!, getLoadedFont('pacifico')!, { content: 'Maker', fontSize: 12, depth: 2 })!;
    expect(analyzeMesh(meshDataToGeometry(mesh)).watertight).toBe(true);
  });

  it('text shapes are fitted to their size and usable as holes', () => {
    const { doc, ids } = build([{ pos: [0, 0, 5], size: [60, 20, 10] }]);
    const text = createShape(doc, 'text', [0, 0, 9]);
    text.text = { content: 'MODELLIO', font: 'inter-bold' };
    text.params = { fontSize: 10, segments: 6 };
    text.size = [50, 8, 2];
    text.isHole = true;
    const d = produce(doc, (dr) => addObjectDraft(dr, text));
    const geo = buildGeometryForShape(text)!;
    geo.computeBoundingBox();
    const ext = geo.boundingBox!.getSize(new THREE.Vector3());
    expect([ext.x, ext.y, ext.z].map((v) => +v.toFixed(3))).toEqual([50, 8, 2]);
    const engraved = combined(d, [ids[0], text.id]);
    const v = resultVolume(engraved);
    expect(v).toBeLessThan(12000);
    expect(v).toBeGreaterThan(12000 - 50 * 8 * 1);
  });
});
