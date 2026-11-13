import { describe, expect, it } from 'vitest';
import { importThreeMF } from '../import/importer';
import { boxMesh, build3mf, icosphereMesh, sampleEyeBadge, type FxPackage } from '../fixtures/build3mf';
import { splitDocument } from './split';
import { DEFAULT_SPLIT_OPTIONS, type SplitOptions } from './types';
import { encodePaintTree } from '../import/paint';
import { applyInlays } from './inlay';
import { initKernel } from '@/cad/kernel/kernel';

const load = (pkg: FxPackage | Uint8Array) => importThreeMF(pkg instanceof Uint8Array ? pkg : build3mf(pkg), 'test.3mf');
const split = async (pkg: FxPackage | Uint8Array, options: Partial<SplitOptions> = {}) =>
  splitDocument(await load(pkg), { ...DEFAULT_SPLIT_OPTIONS, ...options });

/** A sphere (r = 20) with a painted eye: a black ring (z > 14) around a white highlight (z > 18). */
function eyeSphere(): FxPackage {
  return {
    root: {
      resources: `<basematerials id="1"><base name="Yellow" displaycolor="#F5C518"/><base name="Black" displaycolor="#111111"/><base name="White" displaycolor="#FFFFFF"/></basematerials>`,
      objects: [
        {
          id: 2,
          name: 'Body',
          attrs: { pid: '1', pindex: '0' },
          mesh: icosphereMesh(20, 4, [0, 0, 20], (c) =>
            c[2] > 38 ? { pid: '1', p1: '2' } : c[2] > 34 ? { pid: '1', p1: '1' } : undefined,
          ),
        },
      ],
    },
    build: [{ objectid: 2 }],
  };
}

describe('colour splitting', () => {
  it('keeps separate single-colour objects as they are', async () => {
    const r = await split(sampleEyeBadge());
    const whole = r.parts.filter((p) => p.caps.length === 0).map((p) => p.materialName);
    expect(whole).toEqual(expect.arrayContaining(['White PLA', 'Blue PLA', 'Black PLA']));
    for (const p of r.parts) expect(p.report.watertight).toBe(true);
  });

  it('splits a painted sphere into closed parts that rebuild the original volume', async () => {
    const doc = await load(eyeSphere());
    const r = splitDocument(doc, DEFAULT_SPLIT_OPTIONS);
    expect(r.parts.map((p) => p.materialName).sort()).toEqual(['Black', 'White', 'Yellow']);
    for (const p of r.parts) {
      expect(p.report.watertight, p.name).toBe(true);
      expect(p.report.volume, p.name).toBeGreaterThan(0);
      expect(p.report.shells).toBe(1);
    }
    // Shared caps: the parts' volumes add up exactly to the original sphere's.
    const original = r.parts.reduce((s, p) => s + p.report.volume, 0);
    const mesh = doc.objects[0].mesh!;
    let v = 0;
    const P = mesh.vertices;
    const T = mesh.triangles;
    for (let t = 0; t < T.length; t += 3) {
      const [a, b, c] = [T[t] * 3, T[t + 1] * 3, T[t + 2] * 3];
      v +=
        (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
          P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
          P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) /
        6;
    }
    expect(original).toBeCloseTo(v, 1);
    // Two exact joints: body–ring and ring–highlight.
    expect(r.joints).toHaveLength(2);
    const names = (j: (typeof r.joints)[number]) =>
      [j.partA, j.partB].map((id) => r.parts.find((p) => p.partId === id)!.materialName).sort();
    expect(r.joints.map(names).sort()).toEqual([
      ['Black', 'White'],
      ['Black', 'Yellow'],
    ]);
    // Joint normals point out of part A.
    for (const j of r.joints) {
      const a = r.parts.find((p) => p.partId === j.partA)!;
      const b = r.parts.find((p) => p.partId === j.partB)!;
      const dir = a.materialName === 'Yellow' ? 1 : b.materialName === 'Yellow' ? -1 : a.materialName === 'Black' ? 1 : -1;
      expect(Math.sign(j.normal[2]) * dir).toBe(1);
    }
  });

  it('separates disconnected pieces of one colour, or keeps them together', async () => {
    const pkg: FxPackage = {
      root: {
        resources: `<m:colorgroup id="5"><m:color color="#FF0000"/><m:color color="#0000FF"/></m:colorgroup>`,
        objects: [{ id: 1, mesh: boxMesh([0, 0, 0], [10, 10, 10], (i) => ({ pid: '5', p1: i < 4 ? '1' : '0' })) }],
      },
      build: [{ objectid: 1 }],
    };
    const islands = await split(pkg);
    expect(islands.parts.filter((p) => p.colour === '#0000FF')).toHaveLength(2); // top and bottom faces
    const together = await split(pkg, { separateIslands: false });
    expect(together.parts.filter((p) => p.colour === '#0000FF')).toHaveLength(1);
    expect(together.parts.find((p) => p.colour === '#0000FF')!.report.shells).toBe(2);
    // The red band closes into a solid box (capped top and bottom).
    const red = islands.parts.find((p) => p.colour === '#FF0000')!;
    expect(red.report.watertight).toBe(true);
    expect(red.report.volume).toBeCloseTo(1000, 3);
    // Flat faces become zero-thickness parts, which are reported.
    expect(islands.issues.some((i) => i.code === 'tiny-parts')).toBe(true);
  });

  it('keeps instances separate or merges them by colour', async () => {
    const pkg: FxPackage = {
      root: {
        resources: `<basematerials id="1"><base name="Red" displaycolor="#FF0000"/></basematerials>`,
        objects: [{ id: 2, attrs: { pid: '1', pindex: '0' }, mesh: boxMesh([0, 0, 0], [5, 5, 5]) }],
      },
      build: [{ objectid: 2 }, { objectid: 2, transform: '-1 0 0 0 1 0 0 0 1 20 0 0' }],
    };
    const sep = await split(pkg);
    expect(sep.parts).toHaveLength(2);
    // The mirrored instance is re-oriented: still a positive-volume solid.
    for (const p of sep.parts) expect(p.report.volume).toBeCloseTo(125, 3);
    const merged = await split(pkg, { keepObjectsSeparate: false });
    expect(merged.parts).toHaveLength(1);
    expect(merged.parts[0].report.volume).toBeCloseTo(250, 3);
    expect(merged.parts[0].report.shells).toBe(2);
  });

  it('splits fine slicer paint exactly into sub-triangles', async () => {
    // A box whose top face triangles are painted half filament 2 / half filament 1 (one split each).
    const half = encodePaintTree({ sides: 1, special: 0, children: [{ state: 2 }, { state: 1 }] });
    const pkg: FxPackage = {
      metadata: { Application: 'BambuStudio-01.10' },
      root: {
        objects: [
          { id: 1, name: 'Box', mesh: boxMesh([0, 0, 0], [10, 10, 10], (i) => (i === 2 || i === 3 ? { paint_color: half } : undefined)) },
        ],
      },
      build: [{ objectid: 1 }],
      files: {
        'Metadata/model_settings.config': `<?xml version="1.0"?><config><object id="1"><metadata key="extruder" value="1"/></object></config>`,
        'Metadata/project_settings.config': JSON.stringify({ filament_colour: ['#FFFFFF', '#FF0000'] }),
      },
    };
    const doc = await load(pkg);
    expect(doc.filamentMaterials[2]).toBeDefined();
    const exact = splitDocument(doc, DEFAULT_SPLIT_OPTIONS);
    expect(exact.stats.paintedSubTriangles).toBe(4);
    const red = exact.parts.filter((p) => p.colour === '#FF0000');
    expect(red.length).toBeGreaterThan(0);
    // Sub-triangle areas are exact: two half-triangles of the 10×10 top face.
    expect(red.reduce((s, p) => s + p.report.surfaceArea, 0)).toBeCloseTo(50, 6);
    for (const p of exact.parts) expect(p.report.watertight, p.name).toBe(true);
    // Without exact paint, split triangles keep their majority colour (filament 1 on ties).
    const approx = splitDocument(doc, { ...DEFAULT_SPLIT_OPTIONS, exactPaint: false });
    expect(approx.stats.paintedSubTriangles).toBe(0);
  });

  it('expands nested paint and keeps the mesh conforming (no T-junctions)', async () => {
    // Triangle 2 is split 3 ways and one child split again; neighbours must be re-triangulated.
    const tree = encodePaintTree({
      sides: 3,
      special: 0,
      children: [{ state: 2 }, { sides: 1, special: 1, children: [{ state: 2 }, { state: 0 }] }, { state: 0 }, { state: 2 }],
    });
    const pkg: FxPackage = {
      metadata: { Application: 'BambuStudio-01.10' },
      root: { objects: [{ id: 1, mesh: boxMesh([0, 0, 0], [8, 8, 8], (i) => (i === 2 ? { paint_color: tree } : undefined)) }] },
      build: [{ objectid: 1 }],
      files: {
        'Metadata/model_settings.config': `<?xml version="1.0"?><config><object id="1"><metadata key="extruder" value="1"/></object></config>`,
        'Metadata/project_settings.config': JSON.stringify({ filament_colour: ['#FFFFFF', '#00AA00'] }),
      },
    };
    const r = await split(pkg);
    // The body around the painted triangle is a conforming, closed mesh.
    expect(r.parts.find((p) => p.colour === '#FFFFFF')!.report.watertight).toBe(true);
    const green = r.parts.filter((p) => p.colour === '#00AA00').reduce((s, p) => s + p.report.surfaceArea, 0);
    // Areas: children 0 and 3 (¼ each) + half of child 1 (⅛) of a 32 mm² triangle.
    expect(green).toBeCloseTo(32 * (0.25 + 0.25 + 0.125), 6);
    const total = r.parts.reduce((s, p) => s + p.report.volume, 0);
    expect(total).toBeCloseTo(512, 3);
  });

  it('turns paint on a flat face into an inlay with a matching pocket', async () => {
    const k = await initKernel();
    // Top face of a 10 mm cube painted with a centred square (via per-triangle colours on a finer mesh is
    // not needed: one painted triangle pair is a flat region of zero thickness).
    const pkg: FxPackage = {
      root: {
        resources: `<m:colorgroup id="5"><m:color color="#FFFFFF"/><m:color color="#E0262B"/></m:colorgroup>`,
        objects: [{ id: 1, mesh: boxMesh([0, 0, 0], [10, 10, 10], (i) => ({ pid: '5', p1: i === 2 || i === 3 ? '1' : '0' })) }],
      },
      build: [{ objectid: 1 }],
    };
    const raw = await split(pkg);
    const flat = raw.parts.find((p) => p.colour === '#E0262B')!;
    expect(Math.abs(flat.report.volume)).toBeLessThan(1e-6);
    const r = applyInlays(k, raw, 1);
    const red = r.parts.find((p) => p.colour === '#E0262B')!;
    const white = r.parts.find((p) => p.colour === '#FFFFFF')!;
    expect(red.report.watertight).toBe(true);
    expect(white.report.watertight).toBe(true);
    expect(red.report.volume).toBeCloseTo(100, 3); // 10 × 10 × 1 mm inlay
    expect(white.report.volume).toBeCloseTo(900, 3); // the cube minus the pocket
    expect(red.report.bounds.min[2]).toBeCloseTo(9, 4);
    expect(r.joints[0].kind).toBe('inlay');
    expect(r.joints[0].partA).toBe(red.partId);
    expect(r.issues.some((i) => i.code === 'inlays')).toBe(true);
    expect(r.issues.some((i) => i.code === 'tiny-parts')).toBe(false);
  });

  it('gives a thin lens-shaped region a plug so it is thick enough to print', async () => {
    const k = await initKernel();
    // A shallow cap of a large sphere: the highlight (z > 39.4) is a thin lens.
    const pkg: FxPackage = {
      root: {
        resources: `<basematerials id="1"><base name="Yellow" displaycolor="#F5C518"/><base name="White" displaycolor="#FFFFFF"/></basematerials>`,
        objects: [
          {
            id: 2,
            attrs: { pid: '1', pindex: '0' },
            mesh: icosphereMesh(20, 4, [0, 0, 20], (c) => (c[2] > 39.4 ? { pid: '1', p1: '1' } : undefined)),
          },
        ],
      },
      build: [{ objectid: 2 }],
    };
    const raw = await split(pkg);
    const before = raw.parts.reduce((s, p) => s + p.report.volume, 0);
    const lensBefore = raw.parts.find((p) => p.materialName === 'White')!.report.volume;
    const r = applyInlays(k, raw, 1);
    const lens = r.parts.find((p) => p.materialName === 'White')!;
    expect(lens.report.watertight).toBe(true);
    expect(lens.report.volume).toBeGreaterThan(lensBefore);
    // Volume is conserved: the plug moved from the body to the lens.
    expect(r.parts.reduce((s, p) => s + p.report.volume, 0)).toBeCloseTo(before, 1);
  });
});
