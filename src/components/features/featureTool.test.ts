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
    expect(recipe.ops[0].edges).toHaveLength(2);
  });
  it('compares edge references by value', () => {
    expect(sameRef(edge, { ...edge, mid: [0, -1, 1] })).toBe(true);
    expect(sameRef(edge, other)).toBe(false);
  });
});
