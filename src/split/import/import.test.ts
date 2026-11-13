import { describe, expect, it } from 'vitest';
import { importThreeMF } from './importer';
import { boxMesh, build3mf, cylinderMesh, sampleEyeBadge, type FxMesh, type FxPackage } from '../fixtures/build3mf';
import { computeColourComponents } from '../model/components';
import { decodePaint, encodeWholeState } from './paint';
import { write3mf } from '@/cad/export/threemf';
import type { ThreeMFDocument } from '../model/types';

import { loadLib3mf } from './lib3mf';

/**
 * Every import runs through both readers: MODELLIO's fast reader (what the app uses) and the
 * official lib3mf library. The documents must agree on geometry, instances and the material of
 * every triangle, so lib3mf acts as the reference implementation for the fast reader.
 */
async function run(pkg: FxPackage | Uint8Array, name = 'test.3mf'): Promise<ThreeMFDocument> {
  const bytes = pkg instanceof Uint8Array ? pkg : build3mf(pkg);
  const fast = await importThreeMF(bytes, name).catch((e: Error) => e);
  const ref = await importThreeMF(bytes, name, undefined, { reader: 'lib3mf', lib: await loadLib3mf() }).catch((e: Error) => e);
  if (fast instanceof Error || ref instanceof Error) {
    // Both must reject (messages may differ in detail), or the fast reader must reject what lib3mf only warned about.
    if (fast instanceof Error && ref instanceof Error) throw fast;
    if (fast instanceof Error) throw new Error(`fast reader rejected a file lib3mf accepts: ${fast.message}`);
    throw new Error(`fast reader accepted a file lib3mf rejects: ${(ref as Error).message}`);
  }
  expectSameDocument(fast, ref);
  return fast;
}

function summary(doc: ThreeMFDocument) {
  const key = (o: { path: string; objectId: number }) => `${o.path.toLowerCase()}#${o.objectId}`;
  const objects = [...doc.objects]
    .sort((a, b) => key(a).localeCompare(key(b)))
    .map((o) => ({
      key: key(o),
      name: o.name,
      type: o.type,
      vertices: o.mesh ? Array.from(o.mesh.vertices).map((v) => +v.toFixed(4)) : null,
      triangles: o.mesh ? Array.from(o.mesh.triangles) : null,
      materials: o.mesh
        ? Array.from(o.mesh.perTriangleMaterialIds).map((m) => {
            const mat = doc.materials[m];
            return `${mat.key}|${mat.name}|${mat.colour}|${mat.alpha.toFixed(3)}`;
          })
        : null,
      components: o.componentReferences.map((c) => [c.path.toLowerCase(), c.objectId, c.transform.map((v) => +v.toFixed(5))]),
    }));
  const instances = doc.instances.map((i) => ({
    id: i.instanceId,
    name: i.name,
    object: key(doc.objects[i.objectIndex]),
    transform: i.transform.map((v) => +v.toFixed(5)),
  }));
  const issues = doc.issues
    .filter((i) => !['lib3mf-warning', 'vendor-attributes'].includes(i.code))
    .map((i) => `${i.code}:${i.count ?? ''}`)
    .sort();
  return { units: doc.units, metadata: doc.metadata, objects, instances, issues, stats: doc.stats };
}

function expectSameDocument(fast: ThreeMFDocument, ref: ThreeMFDocument) {
  expect(summary(fast)).toEqual(summary(ref));
}
const comps = (doc: ThreeMFDocument) => computeColourComponents(doc);
const issue = (doc: ThreeMFDocument, code: string) => doc.issues.find((i) => i.code === code);
const T = (x: number, y: number, z: number) => `1 0 0 0 1 0 0 0 1 ${x} ${y} ${z}`;

describe('paint decoder', () => {
  it('decodes whole-triangle states exactly', () => {
    expect(decodePaint('4')).toMatchObject({ state: 1, split: false });
    expect(decodePaint('8')).toMatchObject({ state: 2, split: false });
    expect(decodePaint('0C')).toMatchObject({ state: 3, split: false });
    expect(decodePaint('1C')).toMatchObject({ state: 4, split: false });
    expect(decodePaint('')).toMatchObject({ state: 0 });
    for (let s = 0; s < 16; s++) expect(decodePaint(encodeWholeState(s)).state).toBe(s);
  });
  it('detects subdivided triangles and estimates area per state', () => {
    // Nibbles (first → last): split 1 side, leaf state 1, leaf state 2; written reversed.
    const info = decodePaint('841');
    expect(info.split).toBe(true);
    expect(info.state).toBeNull();
    expect(info.areas.get(1)).toBeCloseTo(0.5);
    expect(info.areas.get(2)).toBeCloseTo(0.5);
    expect(info.majority).toBe(1);
    // 3-side split: three quarters state 2, one quarter state 0.
    expect(decodePaint('8880' + '3').majority).toBe(2);
  });
  it('rejects truncated data', () => {
    expect(() => decodePaint('1')).toThrow();
    expect(() => decodePaint('Z')).toThrow();
  });
});

describe('3MF import — core and materials', () => {
  it('reads separate objects with base materials', async () => {
    const doc = await run({
      metadata: { Title: 'Three' },
      root: {
        resources: `<basematerials id="1"><base name="Red" displaycolor="#FF0000"/><base name="Green" displaycolor="#00FF00FF"/><base name="Blue" displaycolor="#0000FF"/></basematerials>`,
        objects: [0, 1, 2].map((i) => ({
          id: 10 + i,
          name: `Obj${i}`,
          attrs: { pid: '1', pindex: String(i) },
          mesh: boxMesh([i * 20, 0, 0], [i * 20 + 10, 10, 10]),
        })),
      },
      build: [{ objectid: 10 }, { objectid: 11 }, { objectid: 12 }],
    });
    expect(doc.units).toBe('millimeter');
    expect(doc.metadata.Title).toBe('Three');
    expect(doc.stats).toMatchObject({ triangles: 36, meshObjects: 3, instances: 3, placedTriangles: 36 });
    expect(doc.materials.map((m) => [m.name, m.colour, m.materialType])).toEqual([
      ['Red', '#FF0000', 'base'],
      ['Green', '#00FF00', 'base'],
      ['Blue', '#0000FF', 'base'],
    ]);
    const c = comps(doc);
    expect(c.map((x) => x.triangleCount)).toEqual([12, 12, 12]);
    expect(c[0].area).toBeCloseTo(600, 3);
    expect(c[1].objectIds).toEqual([11]);
    expect(doc.objects[0].mesh!.bounds).toEqual({ min: [0, 0, 0], max: [10, 10, 10] });
  });

  it('reads per-triangle colour groups and keeps unassigned triangles visible', async () => {
    const doc = await run({
      root: {
        resources: `<m:colorgroup id="5"><m:color color="#FF0000"/><m:color color="#0000FF"/></m:colorgroup>`,
        objects: [{ id: 1, mesh: boxMesh([0, 0, 0], [10, 10, 10], (i) => (i < 2 ? undefined : { pid: '5', p1: i < 4 ? '0' : '1' })) }],
      },
      build: [{ objectid: 1 }],
    });
    const c = comps(doc);
    expect(c.map((x) => [x.name, x.triangleCount])).toEqual([
      ['No colour assigned', 2],
      ['Colour #FF0000', 2],
      ['Colour #0000FF', 8],
    ]);
    expect(issue(doc, 'unassigned')?.count).toBe(2);
  });

  it('flags gradient triangles (different colour per corner)', async () => {
    const doc = await run({
      root: {
        resources: `<m:colorgroup id="5"><m:color color="#FF0000"/><m:color color="#0000FF"/></m:colorgroup>`,
        objects: [
          {
            id: 1,
            attrs: { pid: '5', pindex: '0' },
            mesh: boxMesh([0, 0, 0], [1, 1, 1], (i) => (i === 0 ? { pid: '5', p1: '0', p2: '1', p3: '1' } : undefined)),
          },
        ],
      },
      build: [{ objectid: 1 }],
    });
    expect(issue(doc, 'gradient')?.count).toBe(1);
    expect(comps(doc)).toHaveLength(1);
  });

  it('composes nested component and build transforms', async () => {
    const doc = await run({
      root: {
        objects: [
          { id: 1, name: 'Leaf', mesh: boxMesh([0, 0, 0], [1, 1, 1]) },
          { id: 2, name: 'Mid', components: [{ objectid: 1, transform: T(10, 0, 0) }] },
          { id: 3, name: 'Top', components: [{ objectid: 2, transform: T(0, 0, 7) }, { objectid: 1 }] },
        ],
      },
      build: [{ objectid: 3, transform: T(0, 5, 0) }],
    });
    expect(doc.instances.map((i) => i.instanceId)).toEqual(['b0/c0/c0', 'b0/c1']);
    expect(doc.instances[0].transform.slice(12, 15)).toEqual([10, 5, 7]);
    expect(doc.instances[1].transform.slice(12, 15)).toEqual([0, 5, 0]);
    expect(doc.instances[0].name).toBe('Top › Leaf');
    expect(doc.stats.meshObjects).toBe(1);
  });

  it('keeps multiple instances of one object distinct', async () => {
    const doc = await run({
      root: {
        resources: `<basematerials id="1"><base name="Red" displaycolor="#FF0000"/></basematerials>`,
        objects: [{ id: 2, attrs: { pid: '1', pindex: '0' }, mesh: boxMesh([0, 0, 0], [10, 10, 10]) }],
      },
      build: [{ objectid: 2 }, { objectid: 2, transform: `2 0 0 0 2 0 0 0 2 30 0 0` }],
    });
    expect(doc.stats).toMatchObject({ meshObjects: 1, instances: 2, placedTriangles: 24 });
    const [c] = comps(doc);
    expect(c.instanceIds).toEqual(['b0', 'b1']);
    expect(c.triangleCount).toBe(24);
    expect(c.area).toBeCloseTo(600 + 2400, 3);
  });

  it('converts units to millimetres', async () => {
    const doc = await run({
      unit: 'inch',
      root: { objects: [{ id: 1, mesh: boxMesh([0, 0, 0], [1, 1, 1]) }] },
      build: [{ objectid: 1, transform: T(1, 0, 0) }],
    });
    expect(doc.units).toBe('inch');
    expect(doc.objects[0].mesh!.bounds.max[0]).toBeCloseTo(25.4, 4);
    expect(doc.instances[0].transform[12]).toBeCloseTo(25.4, 4);
  });

  it('reports textures, composites and multi-properties as approximations', async () => {
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
      (c) => c.charCodeAt(0),
    );
    const doc = await run({
      root: {
        resources:
          `<basematerials id="1"><base name="Red" displaycolor="#FF0000"/><base name="Blue" displaycolor="#0000FF"/></basematerials>` +
          `<m:colorgroup id="2"><m:color color="#00FF00"/></m:colorgroup>` +
          `<m:texture2d id="3" path="/3D/Textures/skin.png" contenttype="image/png"/>` +
          `<m:texture2dgroup id="4" texid="3"><m:tex2coord u="0" v="0"/><m:tex2coord u="1" v="0"/><m:tex2coord u="0" v="1"/></m:texture2dgroup>` +
          `<m:compositematerials id="5" matid="1" matindices="0 1"><m:composite values="0.5 0.5"/></m:compositematerials>` +
          `<m:multiproperties id="6" pids="1 2"><m:multi pindices="1 0"/></m:multiproperties>`,
        objects: [
          {
            id: 7,
            attrs: { pid: '1', pindex: '0' },
            mesh: boxMesh([0, 0, 0], [1, 1, 1], (i): Record<string, string> | undefined =>
              i < 2 ? { pid: '4', p1: '0', p2: '1', p3: '2' } : i < 4 ? { pid: '5', p1: '0' } : i < 6 ? { pid: '6', p1: '0' } : undefined,
            ),
          },
        ],
      },
      build: [{ objectid: 7 }],
      modelRels: [{ target: '/3D/Textures/skin.png', type: 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dtexture' }],
      files: { '3D/Textures/skin.png': png },
    });
    const byType = Object.fromEntries(doc.materials.map((m) => [m.materialType, m]));
    expect(byType.texture).toMatchObject({ approximate: true, name: 'Texture skin.png' });
    expect(byType.composite).toMatchObject({ colour: '#800080', approximate: true });
    expect(byType.multi).toMatchObject({ colour: '#00FF00', approximate: true });
    expect(byType.base).toMatchObject({ name: 'Red' });
    expect(issue(doc, 'texture')?.count).toBe(2);
    expect(issue(doc, 'composite')?.count).toBe(2);
    expect(issue(doc, 'multi')?.count).toBe(2);
    expect(issue(doc, 'gradient')).toBeUndefined();
    expect(doc.extensions).toContain('Materials and Properties');
  });

  it('reads objects from production-extension model parts', async () => {
    const doc = await run({
      requiredextensions: 'p',
      root: {
        objects: [{ id: 1, name: 'Assembly', components: [{ objectid: 1, path: '/3D/Objects/object_1.model', transform: T(5, 0, 0) }] }],
      },
      subModels: { '/3D/Objects/object_1.model': { objects: [{ id: 1, name: 'Part', mesh: boxMesh([0, 0, 0], [2, 2, 2]) }] } },
      build: [{ objectid: 1 }],
    });
    expect(doc.instances).toHaveLength(1);
    const leaf = doc.objects[doc.instances[0].objectIndex];
    expect(leaf.path).toBe('/3D/Objects/object_1.model');
    expect(doc.instances[0].transform[12]).toBe(5);
    expect(doc.extensions).toContain('Production');
    // Repeated reader warnings are collapsed into one issue with a count.
    const uuid = doc.issues.filter((i) => /UUID/.test(i.message));
    expect(uuid.length).toBeLessThanOrEqual(1);
  });

  it('round-trips the existing MODELLIO 3MF writer', async () => {
    const box = boxMesh([0, 0, 0], [4, 5, 6]);
    const mesh = { positions: new Float32Array(box.vertices.flat()), indices: new Uint32Array(box.triangles.flatMap((t) => t.v)) };
    const bytes = write3mf(
      [
        { name: 'A', color: '#ff8800', mesh },
        { name: 'B', color: '#0066cc', mesh },
      ] as Parameters<typeof write3mf>[0],
      'Round trip',
    );
    const doc = await run(bytes);
    expect(doc.application).toBe('MODELLIO');
    expect(doc.materials.map((m) => m.colour)).toEqual(['#FF8800', '#0066CC']);
    expect(doc.objects.map((o) => o.name)).toEqual(['A', 'B']);
    expect(doc.objects[0].mesh!.bounds.max).toEqual([4, 5, 6]);
    expect(Array.from(doc.objects[0].mesh!.triangles)).toEqual(Array.from(mesh.indices));
  });

  it('builds the sample with eight colours', async () => {
    const doc = await run(sampleEyeBadge());
    expect(comps(doc).map((c) => c.name)).toEqual([
      'White PLA',
      'Blue PLA',
      'Black PLA',
      'Colour #F5C518',
      'Colour #E0262B',
      'Yellow PLA',
      'Colour #26262B',
      'Colour #FFFFFF',
    ]);
  });
});

describe('3MF import — slicer projects', () => {
  const bambuSettings = (objects: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<config>${objects}<plate><metadata key="plater_id" value="1"/></plate></config>`;

  it('reads Bambu/Orca parts, extruders, filament colours, paint and modifiers', async () => {
    const doc = await run({
      metadata: { Application: 'BambuStudio-01.10.00.00' },
      namespaces: { BambuStudio: 'http://schemas.bambulab.com/package/2021' },
      requiredextensions: 'p',
      root: {
        objects: [
          {
            id: 4,
            name: 'Badge',
            components: [
              { objectid: 1, path: '/3D/Objects/object_1.model' },
              { objectid: 2, path: '/3D/Objects/object_1.model' },
              { objectid: 3, path: '/3D/Objects/object_1.model' },
            ],
          },
        ],
      },
      subModels: {
        '/3D/Objects/object_1.model': {
          objects: [
            // Part 1: filament 1, two triangles painted with filament 2, one with fine (split) paint.
            {
              id: 1,
              mesh: boxMesh([0, 0, 0], [10, 10, 2], (i) => (i < 2 ? { paint_color: '8' } : i === 2 ? { paint_color: '08883' } : undefined)),
            },
            { id: 2, mesh: boxMesh([2, 2, 2], [8, 8, 4]) },
            { id: 3, mesh: boxMesh([0, 0, 0], [3, 3, 3]) },
          ],
        },
      },
      build: [{ objectid: 4 }],
      files: {
        'Metadata/model_settings.config': bambuSettings(
          `<object id="4"><metadata key="name" value="Badge"/><metadata key="extruder" value="1"/>` +
            `<part id="1" subtype="normal_part"><metadata key="name" value="Base"/></part>` +
            `<part id="2" subtype="normal_part"><metadata key="name" value="Top"/><metadata key="extruder" value="3"/></part>` +
            `<part id="3" subtype="modifier_part"><metadata key="name" value="Infill modifier"/></part></object>`,
        ),
        'Metadata/project_settings.config': JSON.stringify({
          filament_colour: ['#FFFFFF', '#FF0000', '#00AA00'],
          filament_type: ['PLA', 'PLA', 'PETG'],
        }),
      },
    });
    expect(doc.application).toBe('BambuStudio-01.10.00.00');
    const c = comps(doc);
    expect(c.map((x) => [x.name, x.colour, x.triangleCount])).toEqual([
      ['Filament 2 · PLA', '#FF0000', 3],
      ['Filament 1 · PLA', '#FFFFFF', 9],
      ['Filament 3 · PETG', '#00AA00', 12],
      ['Modifier volume (not printed)', '#9AA1AD', 12],
    ]);
    expect(issue(doc, 'paint')?.count).toBe(3);
    expect(issue(doc, 'paint-split')?.count).toBe(1);
    expect(issue(doc, 'vendor')).toBeDefined();
    expect(doc.instances.map((i) => i.name)).toEqual(['Badge › Part 1', 'Badge › Part 2', 'Badge › Part 3']);
  });

  it('reads PrusaSlicer volumes, extruder colours and MMU painting', async () => {
    const a = boxMesh([0, 0, 0], [10, 10, 10]);
    const b = boxMesh([0, 0, 10], [10, 10, 12]);
    const merged: FxMesh = {
      vertices: [...a.vertices, ...b.vertices],
      triangles: [...a.triangles, ...b.triangles.map((t) => ({ v: t.v.map((x) => x + 8) as [number, number, number] }))],
    };
    merged.triangles[0] = { ...merged.triangles[0], attrs: { 'slic3rpe:mmu_segmentation': '0C' } };
    const doc = await run({
      metadata: { Application: 'PrusaSlicer-2.8.0' },
      namespaces: { slic3rpe: 'http://schemas.slic3r.org/3mf/2017/06' },
      root: { objects: [{ id: 1, name: 'Two part', mesh: merged }] },
      build: [{ objectid: 1 }],
      files: {
        'Metadata/Slic3r_PE_model.config':
          `<?xml version="1.0" encoding="UTF-8"?>\n<config><object id="1" instances_count="1"><metadata type="object" key="name" value="Two part"/><metadata type="object" key="extruder" value="1"/>` +
          `<volume firstid="0" lastid="11"><metadata type="volume" key="name" value="Body"/><metadata type="volume" key="volume_type" value="ModelPart"/></volume>` +
          `<volume firstid="12" lastid="23"><metadata type="volume" key="name" value="Cap"/><metadata type="volume" key="extruder" value="2"/></volume></object></config>`,
        'Metadata/Slic3r_PE.config': `; generated by PrusaSlicer\n; extruder_colour = "#FF8000;#DB5182"\n; filament_colour = "#FF8000;#DB5182"\n`,
      },
    });
    const c = comps(doc);
    expect(c.map((x) => [x.name, x.colour, x.triangleCount, x.approximate])).toEqual([
      ['Filament 1', '#FF8000', 11, false],
      ['Filament 3', expect.any(String), 1, true],
      ['Filament 2', '#DB5182', 12, false],
    ]);
    expect(issue(doc, 'filament-colour-unknown')?.count).toBe(1);
  });
});

describe('3MF import — invalid files', () => {
  it('rejects non-ZIP data', async () => {
    await expect(run(new TextEncoder().encode('solid cube\nendsolid'))).rejects.toThrow(/not a 3MF package/);
  });
  it('rejects a package without a start relationship', async () => {
    await expect(
      run({ omitStartRel: true, root: { objects: [{ id: 1, mesh: boxMesh([0, 0, 0], [1, 1, 1]) }] }, build: [{ objectid: 1 }] }),
    ).rejects.toThrow(/does not declare its 3D model/);
  });
  it('rejects a file with nothing placed', async () => {
    await expect(run({ root: { objects: [{ id: 1, mesh: boxMesh([0, 0, 0], [1, 1, 1]) }] }, build: [] })).rejects.toThrow(
      /none of them are placed/,
    );
  });
  it('rejects broken model XML with a readable message', async () => {
    const bytes = build3mf({ root: { objects: [{ id: 1, mesh: cylinderMesh(0, 0, 1, 0, 1, 8) }] }, build: [{ objectid: 1 }] });
    const { unzipSync, zipSync, strToU8, strFromU8 } = await import('fflate');
    const files = unzipSync(bytes);
    files['3D/3dmodel.model'] = strToU8(strFromU8(files['3D/3dmodel.model']).replace('</resources>', '<resources>'));
    await expect(run(zipSync(files))).rejects.toThrow(/could not be read/);
  });
  it('reports mirrored instances', async () => {
    const doc = await run({
      root: {
        resources: `<basematerials id="1"><base name="Red" displaycolor="#FF0000"/></basematerials>`,
        objects: [{ id: 2, attrs: { pid: '1', pindex: '0' }, mesh: boxMesh([0, 0, 0], [1, 1, 1]) }],
      },
      build: [{ objectid: 2, transform: '-1 0 0 0 1 0 0 0 1 0 0 0' }],
    });
    expect(issue(doc, 'mirrored')?.count).toBe(1);
  });
  it('reports, never hides, an out-of-range material index', async () => {
    const bytes = build3mf({
      root: {
        resources: `<basematerials id="1"><base name="Red" displaycolor="#FF0000"/></basematerials>`,
        objects: [
          {
            id: 2,
            attrs: { pid: '1', pindex: '0' },
            mesh: boxMesh([0, 0, 0], [1, 1, 1], (i) => (i === 0 ? { pid: '1', p1: '7' } : undefined)),
          },
        ],
      },
      build: [{ objectid: 2 }],
    });
    // The fast reader names the exact triangle; lib3mf drops the property with a generic warning.
    const fast = await importThreeMF(bytes, 'x.3mf');
    expect(issue(fast, 'missing-material')?.count).toBe(1);
    const ref = await importThreeMF(bytes, 'x.3mf', undefined, { reader: 'lib3mf', lib: await loadLib3mf() });
    expect(ref.issues.some((i) => i.code === 'missing-material' || /mesh information/.test(i.message))).toBe(true);
  });
});
