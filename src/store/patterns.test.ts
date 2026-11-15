import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { useEditor } from './editorStore';
import { createEmptyDocument } from '@/cad/document';
import { worldBoundsOf, worldMatrix } from '@/cad/hierarchy';
import type { GroupObject, ShapeObject } from '@/types/document';

const S = () => useEditor.getState();
beforeEach(() => S().loadDocument(createEmptyDocument()));

const centreOf = (id: string) => new THREE.Vector3().setFromMatrixPosition(worldMatrix(S().doc, id));

describe('mirror copies and patterns of bodies', () => {
  it('lays copies out in a row, grouped with the original, in one undo step', () => {
    const a = S().addShape('box');
    S().setPosition(a, [0, 0, 10]);
    S().select([a]);
    S().patternSelected({ kind: 'linear', count: 4, spacing: 30, axis: 0 });
    const g = S().doc.objects[S().selection[0]] as GroupObject;
    expect(g.kind).toBe('group');
    expect(g.children).toHaveLength(4);
    expect(g.children.map((id) => Math.round(centreOf(id).x)).sort((p, q) => p - q)).toEqual([0, 30, 60, 90]);
    S().undo();
    expect(Object.keys(S().doc.objects)).toEqual([a]);
  });

  it('arranges copies round a full circle about the vertical axis, turning each one', () => {
    const a = S().addShape('box');
    S().setPosition(a, [50, 0, 10]);
    S().select([a]);
    S().patternSelected({ kind: 'circular', count: 6, angle: 360, centre: 'origin' });
    const g = S().doc.objects[S().selection[0]] as GroupObject;
    const pts = g.children.map((id) => centreOf(id));
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(50, 3); // positions are stored to 4 decimals
    const angles = pts.map((p) => Math.round(((Math.atan2(p.y, p.x) * 180) / Math.PI + 360) % 360)).sort((p, q) => p - q);
    expect(angles).toEqual([0, 60, 120, 180, 240, 300]);
    // Each copy is turned with its position (so a spoke keeps pointing outwards).
    const second = g.children.find((id) => Math.round((Math.atan2(centreOf(id).y, centreOf(id).x) * 180) / Math.PI) === 60)!;
    const rz = new THREE.Euler().setFromRotationMatrix(worldMatrix(S().doc, second)).z;
    expect((rz * 180) / Math.PI).toBeCloseTo(60, 4);
  });

  it('puts a mirrored copy touching the original, mirrored', () => {
    const a = S().addShape('wedge');
    S().setPosition(a, [0, 0, 10]);
    S().select([a]);
    const before = worldBoundsOf(S().doc, [a]);
    S().mirrorCopySelected(0);
    const g = S().doc.objects[S().selection[0]] as GroupObject;
    const copy = g.children.find((id) => id !== a)!;
    const box = worldBoundsOf(S().doc, [copy]);
    expect(box.min.x).toBeCloseTo(before.max.x, 6);
    expect((S().doc.objects[copy] as ShapeObject).mirror?.[0]).toBe(-1);
  });
});
