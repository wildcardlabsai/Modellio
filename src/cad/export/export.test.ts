import * as THREE from 'three';
import { produce } from 'immer';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { addObjectDraft, createEmptyDocument, createShape } from '../document';
import { groupDraft } from '../hierarchy';
import { initKernel } from '../kernel/kernel';
import { analyzeMesh } from '../geometry/validate';
import { collectExportBodies } from './collect';
import { writeAsciiStl, writeBinaryStl, writeObj } from './writers';
import { normalizeMesh, parseMeshFile } from '../import/importMesh';
import type { ModelDocument } from '@/types/document';

beforeAll(() => initKernel());

function scene(): { doc: ModelDocument; box: string; cyl: string } {
  let doc = createEmptyDocument();
  const box = createShape(doc, 'box', [10, 20, 15]);
  box.size = [40, 20, 30];
  box.transform.rotation = [0, 0, 90];
  const cyl = createShape(doc, 'cylinder', [-50, 0, 10]);
  const hole = createShape(doc, 'cylinder', [80, 0, 10]);
  hole.isHole = true;
  doc = produce(doc, (d) => {
    addObjectDraft(d, box);
    addObjectDraft(d, cyl);
    addObjectDraft(d, hole);
  });
  return { doc, box: box.id, cyl: cyl.id };
}

const bbox = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};

describe('export', () => {
  it('collects world-space solids, skipping loose holes', () => {
    const { doc } = scene();
    const c = collectExportBodies(doc);
    expect(c.bodies).toHaveLength(2);
    expect(c.skippedHoles).toBe(1);
    expect(c.bodies.every((b) => b.watertight)).toBe(true);
    // the rotated 40×20×30 box is 20 wide in X and 40 in Y in the world
    const box = c.bodies[0].mesh;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(box.positions, 3));
    const b = bbox(g);
    expect(b.max.x - b.min.x).toBeCloseTo(20, 4);
    expect(b.max.y - b.min.y).toBeCloseTo(40, 4);
    expect(b.min.z).toBeCloseTo(0, 4);
  });

  it('exports Boolean results, not the parts', () => {
    const { doc, box, cyl } = scene();
    const d = produce(doc, (dr) => {
      (dr.objects[cyl] as { isHole: boolean }).isHole = true;
      dr.objects[cyl].transform.position = [10, 20, 15];
      groupDraft(dr, [box, cyl], { id: 'g', name: 'Plate' });
      (dr.objects.g as { combine?: string }).combine = 'union';
    });
    const c = collectExportBodies(d, ['g']);
    expect(c.bodies).toHaveLength(1);
    expect(c.bodies[0].name).toBe('Plate');
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(c.bodies[0].mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(c.bodies[0].mesh.indices, 1));
    const r = analyzeMesh(g);
    expect(r.watertight).toBe(true);
    expect(r.volume).toBeLessThan(40 * 20 * 30);
  });

  it('binary STL round-trips through an independent parser with exact mm coordinates', () => {
    const c = collectExportBodies(scene().doc);
    const buf = writeBinaryStl(c.bodies);
    expect(buf.byteLength).toBe(84 + c.triangles * 50);
    const g = new STLLoader().parse(buf);
    expect(g.getAttribute('position').count).toBe(c.triangles * 3);
    const b = bbox(g);
    expect(b.min.toArray().map((v) => +v.toFixed(3))).toEqual(c.bounds.min.toArray().map((v) => +v.toFixed(3)));
    expect(b.max.toArray().map((v) => +v.toFixed(3))).toEqual(c.bounds.max.toArray().map((v) => +v.toFixed(3)));
    // stored facet normals agree with the right-hand winding (outward)
    const r = analyzeMesh(g);
    expect(r.watertight).toBe(true);
    expect(r.volume).toBeGreaterThan(0);
  });

  it('ASCII STL parses back to the same geometry', () => {
    const c = collectExportBodies(scene().doc);
    const text = writeAsciiStl(c.bodies);
    expect(text.startsWith('solid Box')).toBe(true);
    const g = new STLLoader().parse(new TextEncoder().encode(text).buffer as ArrayBuffer);
    expect(g.getAttribute('position').count).toBe(c.triangles * 3);
    expect(analyzeMesh(g).watertight).toBe(true);
  });

  it('OBJ keeps one named object per body and welded vertices', () => {
    const c = collectExportBodies(scene().doc);
    const { obj, mtl } = writeObj(c.bodies, 'z', 'scene.mtl');
    const root = new OBJLoader().parse(obj);
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
    expect(meshes.map((m) => m.name)).toEqual(['Box', 'Cylinder']);
    const vCount = obj.split('\n').filter((l) => l.startsWith('v ')).length;
    expect(vCount).toBe(c.bodies.reduce((n, b) => n + b.mesh.positions.length / 3, 0));
    expect(mtl).toContain('newmtl mat_2463EB');
  });

  it('Y-up output is a proper rotation that import converts back exactly', () => {
    const c = collectExportBodies(scene().doc);
    const yUp = writeBinaryStl(c.bodies, 'y');
    const parsed = parseMeshFile('part.stl', yUp);
    const back = normalizeMesh(parsed.parts[0].mesh, 'mm', 'y');
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(back.positions, 3));
    g.setIndex(new THREE.BufferAttribute(back.indices, 1));
    const b = bbox(g);
    expect(b.min.z).toBeCloseTo(c.bounds.min.z, 3);
    expect(b.max.y).toBeCloseTo(c.bounds.max.y, 3);
    expect(analyzeMesh(g).volume).toBeGreaterThan(0); // still outward-facing
  });
});

describe('import', () => {
  it('parses STL, welds vertices and suggests units', () => {
    const sc = scene();
    const c = collectExportBodies(sc.doc, [sc.box]);
    const parsed = parseMeshFile('box.stl', writeBinaryStl(c.bodies));
    expect(parsed.format).toBe('stl');
    expect(parsed.parts[0].mesh.positions.length / 3).toBe(8); // a box has 8 unique corners
    expect(parsed.suggestedUnit).toBe('mm');
    const metres = normalizeMesh(parsed.parts[0].mesh, 'm', 'z');
    expect(Math.max(...metres.positions)).toBeCloseTo(Math.max(...parsed.parts[0].mesh.positions) * 1000, 2);
  });

  it('parses multi-object OBJ files into separate parts', () => {
    const { obj } = writeObj(collectExportBodies(scene().doc).bodies);
    const parsed = parseMeshFile('scene.obj', new TextEncoder().encode(obj).buffer as ArrayBuffer);
    expect(parsed.parts.map((p) => p.name)).toEqual(['Box', 'Cylinder']);
    expect(parsed.suggestedUp).toBe('y');
  });

  it('rejects unsupported, empty and corrupt files with clear messages', () => {
    expect(() => parseMeshFile('model.step', new ArrayBuffer(10))).toThrow(/not supported/);
    expect(() => parseMeshFile('empty.obj', new TextEncoder().encode('# nothing').buffer as ArrayBuffer)).toThrow(/no triangles/);
    expect(() => parseMeshFile('bad.stl', new ArrayBuffer(3))).toThrow();
  });
});
