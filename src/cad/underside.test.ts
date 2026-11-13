import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { addObjectDraft, createEmptyDocument, createShape } from './document';
import { worldBoundsOf, worldMatrix } from './hierarchy';
import { placeOnUndersideDraft } from './underside';
import type { ModelDocument, ShapeObject } from '@/types/document';

/** A 60×20×3 tag on the plate, and a 30×8×1 "logo" lying on top of it. */
function scene() {
  const doc: ModelDocument = createEmptyDocument();
  const tag = createShape(doc, 'box', [0, 0, 1.5]);
  tag.size = [60, 20, 3];
  tag.name = 'Tag';
  addObjectDraft(doc, tag);
  const logo = createShape(doc, 'box', [5, 2, 3.5]);
  logo.size = [30, 8, 1];
  logo.color = '#E0262B';
  logo.name = 'Logo';
  addObjectDraft(doc, logo);
  return { doc, tag: tag.id, logo: logo.id };
}

const down = (doc: ModelDocument, id: string) => new THREE.Vector3(0, 0, 1).transformDirection(worldMatrix(doc, id)).z;

describe('put on the underside', () => {
  it('engraves: face down, a hole cut 0.6 mm into the bottom, joined to the part', () => {
    const { doc, tag, logo } = scene();
    const r = placeOnUndersideDraft(doc, [logo], 'engrave', 0.6);
    expect(r.message).toBeUndefined();
    const o = doc.objects[logo] as ShapeObject;
    expect(o.isHole).toBe(true);
    expect(down(doc, logo)).toBeCloseTo(-1);
    const b = worldBoundsOf(doc, [logo]);
    expect(b.min.z).toBeCloseTo(-0.02, 3);
    expect(b.max.z).toBeCloseTo(0.6, 3);
    // Same footprint as before (centred where it was).
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(5);
    expect((b.min.y + b.max.y) / 2).toBeCloseTo(2);
    const g = doc.objects[r.selection[0]];
    expect(g.kind === 'group' && g.combine).toBe('union');
    expect(g.kind === 'group' && g.children.sort()).toEqual([tag, logo].sort());
  });

  it('inlays: a flush solid in the first 0.6 mm plus a matching pocket cut into the part', () => {
    const { doc, tag, logo } = scene();
    const r = placeOnUndersideDraft(doc, [logo], 'inlay', 0.6);
    expect(r.selection).toEqual([logo]);
    const o = doc.objects[logo] as ShapeObject;
    expect(o.isHole).toBe(false);
    expect(o.parentId).toBeNull();
    const b = worldBoundsOf(doc, [logo]);
    expect(b.min.z).toBeCloseTo(0, 3);
    expect(b.max.z).toBeCloseTo(0.6, 3);
    const group = doc.objects[doc.objects[tag].parentId!];
    expect(group.kind === 'group' && group.combine).toBe('union');
    const pocket = (group.kind === 'group' ? group.children : []).find((c) => c !== tag)!;
    expect((doc.objects[pocket] as ShapeObject).isHole).toBe(true);
    const pb = worldBoundsOf(doc, [pocket]);
    expect(pb.min.z).toBeLessThan(0);
    expect(pb.max.z).toBeCloseTo(0.6, 3);
  });

  it('a second engrave goes into the same union; repeating keeps items face down', () => {
    const { doc, logo } = scene();
    const second = createShape(doc, 'box', [-20, 0, 3.5]);
    second.size = [8, 8, 1];
    addObjectDraft(doc, second);
    const r1 = placeOnUndersideDraft(doc, [logo], 'engrave', 0.6);
    const r2 = placeOnUndersideDraft(doc, [second.id], 'engrave', 0.6);
    expect(r2.selection[0]).toBe(r1.selection[0]);
    expect(down(doc, second.id)).toBeCloseTo(-1);
  });

  it('limits the depth to leave the part standing, and explains when nothing is below', () => {
    const { doc, logo } = scene();
    placeOnUndersideDraft(doc, [logo], 'engrave', 10);
    expect(worldBoundsOf(doc, [logo]).max.z).toBeCloseTo(2.6, 3);
    const lone = createShape(doc, 'box', [200, 200, 5]);
    addObjectDraft(doc, lone);
    const r = placeOnUndersideDraft(doc, [lone.id], 'engrave', 0.6);
    expect(r.message).toMatch(/put it over the part/);
  });
});

describe('inlay colour', () => {
  it('gives a same-coloured inlay a contrasting colour', () => {
    const { doc, tag, logo } = scene();
    (doc.objects[logo] as ShapeObject).color = (doc.objects[tag] as ShapeObject).color;
    placeOnUndersideDraft(doc, [logo], 'inlay', 0.6);
    expect((doc.objects[logo] as ShapeObject).color).not.toBe((doc.objects[tag] as ShapeObject).color);
  });
});
