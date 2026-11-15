import { recipeWithSession, sameRef, type FeatureSession } from './featureTool';
import type { EdgeRef, FeatureRecipe } from '@/cad/brep/types';

const edge: EdgeRef = { kind: 'line', mid: [0, -1, 1], dir: [1, 0, 0], radius: 0 };
const other: EdgeRef = { kind: 'line', mid: [1, 0, 1], dir: [0, 1, 0], radius: 0 };
const feature: FeatureRecipe = {
  base: { kind: 'primitive', shape: 'box', params: {} },
  ops: [
    { id: 'a', kind: 'fillet', edges: [edge], radius: 2 },
    { id: 'b', kind: 'chamfer', edges: [other], distance: 1 },
  ],
};
const session = (extra: Partial<FeatureSession>): FeatureSession => ({
  objectId: 'x',
  kind: 'fillet',
  edges: [edge],
  faces: [],
  hole: { face: null, at: null, spec: { style: 'simple', diameter: 3, depth: 0 } },
  value: 3,
  editingOpId: null,
  before: null,
  preview: { state: 'idle' },
  ...extra,
});

describe('feature tool recipes', () => {
  it('a new operation goes after the existing ones', () => {
    const { recipe, opId } = recipeWithSession(feature, session({ kind: 'chamfer', value: 0.5 }));
    expect(recipe.ops.map((o) => o.id)).toEqual(['a', 'b', opId]);
    expect(recipe.ops[2]).toMatchObject({ kind: 'chamfer', distance: 0.5, edges: [edge] });
    expect(feature.ops).toHaveLength(2); // the original is not modified
  });
  it('editing replaces the operation in place, keeping its position', () => {
    const { recipe, opId } = recipeWithSession(feature, session({ editingOpId: 'a', value: 4, edges: [edge, other] }));
    expect(opId).toBe('a');
    expect(recipe.ops.map((o) => o.id)).toEqual(['a', 'b']);
    expect(recipe.ops[0]).toMatchObject({ kind: 'fillet', radius: 4 });
    expect((recipe.ops[0] as { edges: EdgeRef[] }).edges).toHaveLength(2);
  });
  it('describes shell, draft and hole operations, and nothing until they are complete', () => {
    const face = {
      kind: 'plane' as const,
      centre: [0, 0, 1] as [number, number, number],
      normal: [0, 0, 1] as [number, number, number],
      area: 4,
    };
    expect(recipeWithSession(feature, session({ kind: 'shell', faces: [] })).recipe).toBe(feature);
    expect(recipeWithSession(feature, session({ kind: 'shell', faces: [face], value: 1.5 })).recipe.ops[2]).toMatchObject({
      kind: 'shell',
      thickness: 1.5,
      faces: [face],
    });
    expect(recipeWithSession(feature, session({ kind: 'draft', faces: [face], value: 4 })).recipe.ops[2]).toMatchObject({
      kind: 'draft',
      angle: 4,
    });
    const hole = recipeWithSession(
      feature,
      session({ kind: 'hole', hole: { face, at: [0, 0, 1], spec: { style: 'simple', diameter: 5, depth: 0 }, pattern: undefined } }),
    ).recipe.ops[2];
    expect(hole).toMatchObject({ kind: 'hole', at: [0, 0, 1], hole: { diameter: 5 } });
    expect(hole).not.toHaveProperty('pattern');
  });
  it('compares edge references by value', () => {
    expect(sameRef(edge, { ...edge, mid: [0, -1, 1] })).toBe(true);
    expect(sameRef(edge, other)).toBe(false);
  });
});
