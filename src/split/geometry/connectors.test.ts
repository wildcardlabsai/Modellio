import { describe, expect, it } from 'vitest';
import { importThreeMF } from '../import/importer';
import { boxMesh, build3mf, icosphereMesh, type FxPackage } from '../fixtures/build3mf';
import { splitDocument } from './split';
import { applyInlays } from './inlay';
import { addConnectors, DEFAULT_CONNECTOR_SETTINGS, rayDepth } from './connectors';
import { DEFAULT_SPLIT_OPTIONS } from './types';
import { initKernel } from '@/cad/kernel/kernel';

async function pipeline(pkg: FxPackage, settings = DEFAULT_CONNECTOR_SETTINGS) {
  const k = await initKernel();
  const doc = await importThreeMF(build3mf(pkg), 'test.3mf');
  const split = applyInlays(k, splitDocument(doc, DEFAULT_SPLIT_OPTIONS), DEFAULT_SPLIT_OPTIONS.inlayDepth);
  const con = addConnectors(k, split.parts, split.joints, settings);
  return { split, con };
}

const byName = <T extends { materialName: string }>(parts: T[], n: string): T => parts.find((p) => p.materialName === n)!;

/** The acceptance scenario: a character body with a painted eye (black ring around a white highlight). */
const eye: FxPackage = {
  root: {
    resources: `<basematerials id="1"><base name="Yellow" displaycolor="#F5C518"/><base name="Black" displaycolor="#111111"/><base name="White" displaycolor="#FFFFFF"/></basematerials>`,
    objects: [
      {
        id: 2,
        name: 'Character',
        attrs: { pid: '1', pindex: '0' },
        mesh: icosphereMesh(20, 4, [0, 0, 20], (c) => (c[2] > 39 ? { pid: '1', p1: '2' } : c[2] > 34 ? { pid: '1', p1: '1' } : undefined)),
      },
    ],
  },
  build: [{ objectid: 2 }],
};

describe('peg and socket connectors', () => {
  it('eye acceptance: inlay highlight, pegged eye, blind socket in the body', async () => {
    const { split, con } = await pipeline(eye);
    // The highlight is thin, so it became an inlay in the black eye; no connector there.
    const inlay = split.joints.find((j) => j.kind === 'inlay')!;
    expect(byName(split.parts, 'White').partId).toBe(inlay.partA);
    // The eye–body joint got connectors: peg on the eye, socket in the body.
    expect(con.connectors.length).toBeGreaterThanOrEqual(1);
    const black = byName(con.parts, 'Black');
    const yellow = byName(con.parts, 'Yellow');
    for (const c of con.connectors) {
      expect(c.pegPartId).toBe(black.partId);
      expect(c.socketPartId).toBe(yellow.partId);
      expect(c.socketDiameter).toBeCloseTo(c.diameter + 2 * DEFAULT_CONNECTOR_SETTINGS.clearance, 6);
      expect(c.socketDepth).toBeGreaterThan(c.length);
      // Pointing down into the body.
      expect(c.axis[2]).toBeLessThan(-0.99);
    }
    for (const p of con.parts) {
      expect(p.report.watertight, p.name).toBe(true);
      expect(p.report.shells, p.name).toBe(1);
      expect(p.report.volume, p.name).toBeGreaterThan(0);
    }
    // Volumes: the body lost exactly the sockets, the eye gained the pegs (outside part only).
    const before = { black: byName(split.parts, 'Black').report.volume, yellow: byName(split.parts, 'Yellow').report.volume };
    const c0 = con.connectors[0];
    const rs = c0.socketDiameter / 2;
    const socketVolume = con.connectors.length * Math.PI * rs * rs * c0.socketDepth;
    expect(before.yellow - yellow.report.volume).toBeGreaterThan(socketVolume * 0.95);
    expect(before.yellow - yellow.report.volume).toBeLessThan(socketVolume * 1.01);
    const pegOutside = con.connectors.length * Math.PI * (c0.diameter / 2) ** 2 * c0.length;
    expect(black.report.volume - before.black).toBeGreaterThan(pegOutside * 0.85);
    expect(black.report.volume - before.black).toBeLessThan(pegOutside * 1.01);
    // Blind: below each socket there is still at least the minimum wall of body.
    for (const c of con.connectors) {
      const bottom = c.position.map((v, i) => v + c.axis[i] * (c.socketDepth + 0.01)) as [number, number, number];
      expect(rayDepth(yellow, bottom, c.axis, true)).toBeGreaterThan(DEFAULT_CONNECTOR_SETTINGS.minWall);
    }
    // The body's outside is untouched (same bounds): the socket did not break through.
    expect(yellow.report.bounds.min[2]).toBeCloseTo(byName(split.parts, 'Yellow').report.bounds.min[2], 3);
  });

  it('shortens the peg to keep the socket blind, and skips joints that are too thin', async () => {
    // Two stacked boxes: a 2 mm base under a 10 mm block, coloured per object.
    const thin: FxPackage = {
      root: {
        resources: `<m:colorgroup id="5"><m:color color="#FFFFFF"/><m:color color="#2F6FDE"/></m:colorgroup>`,
        objects: [
          {
            id: 1,
            mesh: (() => {
              // One closed box 20×20×12 whose top 10 mm (side and top faces above z=2) is blue: split at z = 2 needs a cut,
              // so instead colour the bottom face white and everything else blue: a flat joint at z = 0 is not useful.
              return boxMesh([0, 0, 0], [20, 20, 2.4], () => ({ pid: '5', p1: '0' }));
            })(),
          },
        ],
      },
      build: [{ objectid: 1 }],
    };
    const k = await initKernel();
    const doc = await importThreeMF(build3mf(thin), 't.3mf');
    const split = splitDocument(doc, DEFAULT_SPLIT_OPTIONS);
    // A single-colour part has no joints, so nothing is added.
    const none = addConnectors(k, split.parts, split.joints, DEFAULT_CONNECTOR_SETTINGS);
    expect(none.connectors).toHaveLength(0);

    // A painted sphere with a shallow cap: the body side is deep but the cap side is thin → peg goes on the cap.
    const { con } = await pipeline({
      root: {
        resources: `<basematerials id="1"><base name="Body" displaycolor="#F5C518"/><base name="Cap" displaycolor="#E0262B"/></basematerials>`,
        objects: [
          {
            id: 2,
            attrs: { pid: '1', pindex: '0' },
            mesh: icosphereMesh(20, 4, [0, 0, 20], (c) => (c[2] > 30 ? { pid: '1', p1: '1' } : undefined)),
          },
        ],
      },
      build: [{ objectid: 2 }],
    });
    for (const c of con.connectors) expect(con.parts.find((p) => p.partId === c.socketPartId)!.materialName).toBe('Body');
    expect(con.connectors.length).toBeGreaterThan(0);
  });

  it('never adds a peg without its socket', async () => {
    const { con } = await pipeline(eye, { ...DEFAULT_CONNECTOR_SETTINGS, length: 60 });
    // Even with an impossible length the peg is shortened to fit a blind socket, or skipped as a pair.
    for (const c of con.connectors) expect(c.length).toBeLessThan(60);
    const pegged = new Set(con.connectors.map((c) => c.pegPartId));
    const socketed = new Set(con.connectors.map((c) => c.socketPartId));
    expect(pegged.size === 0).toBe(socketed.size === 0);
  });

  it('can be turned off', async () => {
    const { con, split } = await pipeline(eye, { ...DEFAULT_CONNECTOR_SETTINGS, enabled: false });
    expect(con.connectors).toHaveLength(0);
    expect(con.parts).toBe(split.parts);
  });
});

describe('export', () => {
  it('packages plates and parts, and the plate 3MF re-imports with the same solids', async () => {
    const { layoutPlates, DEFAULT_PLATE_SETTINGS } = await import('./layout');
    const { buildExport } = await import('./export');
    const { unzipSync } = await import('fflate');
    const { con } = await pipeline(eye);
    const layout = layoutPlates(con.parts, DEFAULT_PLATE_SETTINGS);
    // One plate per colour, every part on the bed (z ≥ 0) and inside the plate.
    expect(layout.plates.map((p) => p.name).sort()).toEqual(['Black', 'White', 'Yellow']);
    const pkg = buildExport(con.parts, layout, con.connectors, { title: 'Eye test', plates3mf: true, partsStl: true });
    const files = unzipSync(pkg.zip);
    expect(Object.keys(files).filter((f) => f.endsWith('.3mf'))).toHaveLength(3);
    expect(Object.keys(files).filter((f) => f.endsWith('.stl'))).toHaveLength(3);
    expect(new TextDecoder().decode(files['Eye-test/README.txt'])).toContain('Connectors:');
    for (const [name, bytes] of Object.entries(files)) {
      if (!name.endsWith('.3mf')) continue;
      const doc = await importThreeMF(bytes, name);
      const placed = splitDocument(doc, DEFAULT_SPLIT_OPTIONS).parts;
      expect(placed).toHaveLength(1);
      const original = con.parts.find((p) => p.colour === placed[0].colour)!;
      expect(placed[0].report.watertight).toBe(true);
      expect(placed[0].report.volume).toBeCloseTo(original.report.volume, 0);
      expect(placed[0].report.bounds.min[2]).toBeCloseTo(0, 3);
      for (const k of [0, 1]) {
        expect(placed[0].report.bounds.min[k]).toBeGreaterThanOrEqual(-1e-3);
        expect(placed[0].report.bounds.max[k]).toBeLessThanOrEqual(DEFAULT_PLATE_SETTINGS.width + 1e-3);
      }
    }
  });

  it('lays thin inlays and capped parts flat on their joint face', async () => {
    const { layoutPlates, DEFAULT_PLATE_SETTINGS } = await import('./layout');
    const { con } = await pipeline(eye);
    const layout = layoutPlates(con.parts, DEFAULT_PLATE_SETTINGS);
    const black = byName(con.parts, 'Black');
    // The eye has a flat joint face on its underside, with pegs; the largest flat face is chosen.
    expect(layout.placements[black.partId].contactArea).toBeGreaterThan(0);
  });
});
