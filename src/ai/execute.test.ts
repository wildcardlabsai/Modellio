import { useEditor } from '@/store/editorStore';
import { createEmptyDocument } from '@/cad/document';
import { worldBoundsOf } from '@/cad/hierarchy';
import { executePlan, sceneSummary } from './execute';
import { validatePlan, type Plan } from './plan';

const S = () => useEditor.getState();
beforeEach(() => S().loadDocument(createEmptyDocument()));

const valid = (raw: unknown): Plan => {
  const r = validatePlan(raw, S().doc.rootIds);
  if (!r.ok) throw new Error(r.errors.join(' '));
  return r.plan;
};

describe('executePlan', () => {
  it('builds a plate with a hole as one undo step, at the exact sizes', async () => {
    const plan = valid({
      reply: 'A plate with a hole.',
      needsClarification: false,
      commands: [
        {
          op: 'add_shape',
          ref: 'plate',
          shape: 'box',
          name: 'Plate',
          size: [60, 40, 3],
          position: [0, 0, 1.5],
          rotation: null,
          color: '#2463EB',
          hole: false,
        },
        {
          op: 'add_shape',
          ref: 'h',
          shape: 'cylinder',
          name: null,
          size: [4, 4, 5],
          position: [25, 15, 1.5],
          rotation: null,
          color: null,
          hole: true,
        },
        { op: 'combine', ref: 'part', targets: ['plate', 'h'], mode: 'subtract', name: 'Drilled plate' },
      ],
    });
    const before = S().history.past.length;
    const r = await executePlan(plan, 'Assistant: 3 steps');
    expect(r.ok).toBe(true);
    expect(S().history.past.length).toBe(before + 1);
    expect(S().history.past.at(-1)?.label).toBe('Assistant: 3 steps');
    const roots = S().doc.rootIds.map((id) => S().doc.objects[id]);
    expect(roots).toHaveLength(1);
    expect(roots[0].kind).toBe('group');
    expect(roots[0].name).toBe('Drilled plate');
    const plate = Object.values(S().doc.objects).find((o) => o.name === 'Plate');
    expect(plate?.kind === 'shape' && plate.size).toEqual([60, 40, 3]);
    const b = worldBoundsOf(S().doc, [plate!.id]);
    expect([b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => +v.toFixed(3))).toEqual([-30, -20, 0, 30, 20, 3]);
    const hole = Object.values(S().doc.objects).find((o) => o.kind === 'shape' && o.shape === 'cylinder');
    expect(hole?.kind === 'shape' && hole.isHole).toBe(true);
    S().undo();
    expect(S().doc.rootIds).toHaveLength(0);
  });

  it('edits existing objects by id and summarises the scene', async () => {
    const id = S().addShape('box');
    const scene = sceneSummary();
    expect(scene[0]).toMatchObject({ id, kind: 'shape', shape: 'box' });
    const r = await executePlan(
      valid({
        reply: 'Red and taller.',
        needsClarification: false,
        commands: [
          { op: 'set_color', target: id, color: '#E0262B' },
          { op: 'set_size', target: id, size: [20, 20, 40] },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    const o = S().doc.objects[id];
    expect(o.kind === 'shape' && [o.color, o.size]).toEqual(['#E0262B', [20, 20, 40]]);
  });

  it('rolls everything back if a step fails', async () => {
    const id = S().addShape('box');
    const plan = valid({
      reply: 'x',
      needsClarification: false,
      commands: [
        {
          op: 'add_shape',
          ref: 'a',
          shape: 'sphere',
          name: null,
          size: [10, 10, 10],
          position: [50, 0, 5],
          rotation: null,
          color: null,
          hole: false,
        },
        { op: 'combine', ref: 'g', targets: ['a', id], mode: 'union', name: null },
      ],
    });
    S().setLocked(id, true);
    const before = S().doc;
    const r = await executePlan(plan);
    expect(r.ok).toBe(false);
    expect(S().doc).toBe(before);
    expect(S().doc.rootIds).toEqual([id]);
    expect(S().transaction).toBeNull();
  });
});
