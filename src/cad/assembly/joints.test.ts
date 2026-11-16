import * as THREE from 'three';
import { useEditor } from '@/store/editorStore';
import { createEmptyDocument } from '@/cad/document';
import { worldMatrix } from '@/cad/hierarchy';
import { collectExportBodies } from '@/cad/export/collect';
import { projectFromFile, projectToFile } from '@/cad/serialization/project';
import { explodeOffsets } from './explode';
import { jointOrder } from './joints';
import type { Joint, Vec3 } from '@/types/document';

const S = () => useEditor.getState();
const obj = (id: string) => S().doc.objects[id];
const pos = (id: string) => new THREE.Vector3().setFromMatrixPosition(worldMatrix(S().doc, id));
const close = (a: THREE.Vector3, b: number[], eps = 1e-3) => a.distanceTo(new THREE.Vector3(...b)) < eps;

beforeEach(() => S().loadDocument(createEmptyDocument()));

/** A base (box at the origin) and an arm (box 20 mm along X). */
function pair() {
  const base = S().addShape('box');
  S().setPosition(base, [0, 0, 0]);
  const arm = S().addShape('box');
  S().setPosition(arm, [20, 0, 0]);
  return { base, arm };
}

describe('joints', () => {
  it('a revolute joint turns B about the axis through the origin (exact pose)', () => {
    const { base, arm } = pair();
    const j = S().addJoint({ kind: 'revolute', a: base, b: arm, origin: [0, 0, 0], axis: 'z' })!;
    expect(close(pos(arm), [20, 0, 0])).toBe(true); // made where the parts are: nothing moves
    S().setJointValues(j, { angle: 90 });
    expect(close(pos(arm), [0, 20, 0])).toBe(true);
    expect(obj(arm).transform.rotation[2]).toBeCloseTo(90, 3);
    S().setJointValues(j, { angle: 180 });
    expect(close(pos(arm), [-20, 0, 0])).toBe(true);
    S().setJointValues(j, { angle: 30 });
    S().setPosition(arm, [70, 70, 70]); // a drag with no turn in it: the angle stays exactly where it was
    expect(S().doc.joints![j].values.angle).toBe(30);
  });

  it('limits stop the joint (typed values and drags), with a notice', () => {
    const { base, arm } = pair();
    const j = S().addJoint({ kind: 'revolute', a: base, b: arm, origin: [0, 0, 0], limits: { angle: [0, 90] } })!;
    S().setJointValues(j, { angle: 135 });
    expect(S().doc.joints![j].values.angle).toBe(90);
    expect(S().notice?.text).toMatch(/limit/);
    // Drag the arm to −45°: it stops at 0.
    S().setPosition(arm, [20 * Math.SQRT1_2, -20 * Math.SQRT1_2, 0]);
    S().setRotation(arm, [0, 0, -45]);
    expect(S().doc.joints![j].values.angle).toBeCloseTo(0, 3);
    expect(close(pos(arm), [20, 0, 0])).toBe(true);
  });

  it('a slider moves B along the axis only; a drag is projected onto it', () => {
    const { base, arm } = pair();
    const j = S().addJoint({ kind: 'slider', a: base, b: arm, axis: 'x', limits: { offset: [0, 30] } })!;
    S().setJointValues(j, { offset: 10 });
    expect(close(pos(arm), [30, 0, 0])).toBe(true);
    S().setPosition(arm, [35, 12, 7]); // sideways parts of the drag are dropped
    expect(close(pos(arm), [35, 0, 0])).toBe(true);
    expect(S().doc.joints![j].values.offset).toBeCloseTo(15, 3);
    S().setPosition(arm, [90, 0, 0]);
    expect(close(pos(arm), [50, 0, 0])).toBe(true); // the 30 mm limit
  });

  it('cylindrical (turn + slide) and planar (slide in the plane + turn) joints', () => {
    const { base, arm } = pair();
    const c = S().addJoint({ kind: 'cylindrical', a: base, b: arm, origin: [0, 0, 0], axis: 'z' })!;
    S().setJointValues(c, { angle: 90, offset: 5 });
    expect(close(pos(arm), [0, 20, 5])).toBe(true);
    S().removeJoint(c);
    const other = S().addShape('sphere');
    S().setPosition(other, [0, 0, 10]);
    const p = S().addJoint({ kind: 'planar', a: base, b: other, origin: [0, 0, 10], axis: 'z' })!;
    S().setJointValues(p, { u: 4, v: -3, angle: 30 });
    expect(close(pos(other), [4, -3, 10])).toBe(true);
    S().setPosition(other, [9, 9, 40]); // can't leave the plane
    expect(close(pos(other), [9, 9, 10])).toBe(true);
  });

  it('a rigid joint carries B with A; moving A moves B in the same undo step', () => {
    const { base, arm } = pair();
    S().addJoint({ kind: 'rigid', a: base, b: arm });
    const steps = S().history.past.length;
    S().setPosition(base, [0, 50, 0]);
    expect(close(pos(arm), [20, 50, 0])).toBe(true);
    expect(S().history.past.length).toBe(steps + 1);
    S().undo();
    expect(close(pos(arm), [20, 0, 0])).toBe(true);
    S().setPosition(arm, [99, 0, 0]); // a rigid joint has no freedom
    expect(close(pos(arm), [20, 0, 0])).toBe(true);
  });

  it('chains solve parents first (A → B → C)', () => {
    const { base, arm } = pair();
    const tip = S().addShape('box');
    S().setPosition(tip, [40, 0, 0]);
    const j1 = S().addJoint({ kind: 'revolute', a: base, b: arm, origin: [0, 0, 0] })!;
    S().addJoint({ kind: 'rigid', a: arm, b: tip });
    S().setJointValues(j1, { angle: 90 });
    expect(close(pos(tip), [0, 40, 0])).toBe(true);
  });

  it('refuses loops, a part driven twice, nested parts and grounded moving parts', () => {
    const { base, arm } = pair();
    const third = S().addShape('box');
    expect(S().addJoint({ kind: 'rigid', a: base, b: arm })).toBeTruthy();
    expect(S().addJoint({ kind: 'rigid', a: third, b: arm })).toBeNull();
    expect(S().notice?.text).toMatch(/one joint only/);
    expect(S().addJoint({ kind: 'rigid', a: arm, b: base })).toBeNull();
    expect(S().notice?.text).toMatch(/loop/);
    S().setGrounded([third], true);
    expect(S().addJoint({ kind: 'rigid', a: base, b: third })).toBeNull();
    expect(S().notice?.text).toMatch(/grounded/);
    S().setGrounded([arm], true);
    expect(obj(arm).grounded).toBeFalsy(); // it moves with a joint
    expect(jointOrder([{ id: 'x', name: 'x', kind: 'rigid', a: 'p', b: 'p', frameA: [], frameB: [], values: {} } as Joint])).toEqual({
      error: expect.stringMatching(/itself/),
    });
  });

  it('a joint is removed with its part, and survives saving', () => {
    const { base, arm } = pair();
    const j = S().addJoint({ kind: 'revolute', a: base, b: arm, origin: [0, 0, 0], limits: { angle: [-45, 45] } })!;
    S().setJointValues(j, { angle: 30 });
    const meta = { id: 'p', name: 'P', createdAt: 1, updatedAt: 2, objectCount: 2 };
    const back = projectFromFile(projectToFile({ meta, document: S().doc, assets: {} })).document;
    expect(back.joints![j]).toEqual(S().doc.joints![j]);
    S().select([arm]);
    S().deleteSelected();
    expect(S().doc.joints?.[j]).toBeUndefined();
  });
});

describe('exploded views', () => {
  it('steps add up with progress; display only (positions and export unchanged)', () => {
    const { base, arm } = pair();
    const v = S().addExplodeView();
    S().addExplodeStep(v, [arm], [0, 0, 30]);
    S().addExplodeStep(v, [arm, base], [10, 0, 0]);
    const view = S().doc.explodeViews![v];
    expect(explodeOffsets(view, 0).size).toBe(0);
    expect(explodeOffsets(view, 1).get(arm)).toEqual([0, 0, 30]);
    expect(explodeOffsets(view, 1.5).get(arm)).toEqual([5, 0, 30]);
    expect(explodeOffsets(view, 2).get(base)).toEqual([10, 0, 0]);
    const exported = JSON.stringify(collectExportBodies(S().doc).bodies.map((b) => Array.from(b.mesh.positions.slice(0, 9))));
    S().setExplode(v, 2);
    expect(close(pos(arm), [20, 0, 0])).toBe(true);
    expect(JSON.stringify(collectExportBodies(S().doc).bodies.map((b) => Array.from(b.mesh.positions.slice(0, 9))))).toBe(exported);
  });

  it('reorders, deletes, auto-explodes and drops deleted parts', () => {
    const { base, arm } = pair();
    const v = S().addExplodeView();
    const s1 = S().addExplodeStep(v, [arm], [0, 0, 30])!;
    const s2 = S().addExplodeStep(v, [base], [0, 0, -30])!;
    S().moveExplodeStep(v, s2, -1);
    expect(S().doc.explodeViews![v].steps.map((s) => s.id)).toEqual([s2, s1]);
    S().removeExplodeStep(v, s2);
    expect(S().doc.explodeViews![v].steps).toHaveLength(1);
    const auto = S().addExplodeView([base, arm]);
    const steps = S().doc.explodeViews![auto].steps;
    expect(steps).toHaveLength(2);
    // Parts move away from each other.
    const o = steps.map((s) => new THREE.Vector3(...(s.offset as Vec3)));
    expect(o[0].dot(o[1])).toBeLessThan(0);
    S().select([arm]);
    S().deleteSelected();
    expect(S().doc.explodeViews![v].steps).toHaveLength(0);
  });
});
