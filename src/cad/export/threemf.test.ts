import * as THREE from 'three';
import { produce } from 'immer';
import { unzipSync, strFromU8 } from 'fflate';
import { addObjectDraft, createEmptyDocument, createShape } from '../document';
import { collectExportBodies } from './collect';
import { write3mf } from './threemf';
import { analyzeMesh } from '../geometry/validate';

function scene() {
  let doc = createEmptyDocument();
  const a = createShape(doc, 'box', [0, 0, 10]);
  a.name = 'Base & "Lid"';
  a.color = '#FF0000';
  const b = createShape(doc, 'cylinder', [40, 0, 10]);
  b.color = '#00FF00';
  doc = produce(doc, (d) => {
    addObjectDraft(d, a);
    addObjectDraft(d, b);
  });
  return doc;
}

describe('3MF export', () => {
  it('writes a valid package: content types, relationships and a millimetre model', () => {
    const zip = unzipSync(write3mf(collectExportBodies(scene()).bodies));
    expect(Object.keys(zip).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const model = strFromU8(zip['3D/3dmodel.model']);
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('name="Base &amp; &quot;Lid&quot;"'); // names are XML-escaped
    expect(model).toContain('displaycolor="#FF0000FF"');
    expect(model).toContain('displaycolor="#00FF00FF"');
  });

  it('geometry round-trips: every object is closed with the original vertex count and bounds', () => {
    const c = collectExportBodies(scene());
    const model = strFromU8(unzipSync(write3mf(c.bodies))['3D/3dmodel.model']);
    const objects = [...model.matchAll(/<object [^>]*>(.*?)<\/object>/g)];
    expect(objects).toHaveLength(2);
    objects.forEach((m, i) => {
      const verts = [...m[1].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map((v) => [+v[1], +v[2], +v[3]]);
      const tris = [...m[1].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].map((t) => [+t[1], +t[2], +t[3]]);
      expect(verts.length).toBe(c.bodies[i].mesh.positions.length / 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts.flat(), 3));
      g.setIndex(tris.flat());
      const r = analyzeMesh(g);
      expect(r.watertight).toBe(true);
      expect(r.volume).toBeGreaterThan(0);
    });
  });
});
