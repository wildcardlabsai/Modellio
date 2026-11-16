/**
 * Grounded parts (schema 4) stay where they are: any change that would move one in the world (a
 * drag, nudge, align, typed position, or a move of the group it is in) is undone for it, and its
 * name is returned so the user can be told. Grouping, which keeps world positions, is allowed.
 */
import { produce } from 'immer';
import type { ModelDocument, ObjectId } from '@/types/document';
import { worldMatrix } from '../hierarchy';
import { sameTransform } from '../placement';
import { matrixToTransform } from '../transforms/transform';
import * as THREE from 'three';

export function guardGrounded(prev: ModelDocument, next: ModelDocument): { doc: ModelDocument; blocked: string[] } {
  const fixes: { id: ObjectId; world: THREE.Matrix4 }[] = [];
  const blocked: string[] = [];
  for (const o of Object.values(next.objects)) {
    const before = prev.objects[o.id];
    // Only parts grounded both before and after (grounding or ungrounding itself is fine).
    if (!o.grounded || !before?.grounded) continue;
    const w0 = worldMatrix(prev, o.id);
    if (sameTransform(matrixToTransform(w0), matrixToTransform(worldMatrix(next, o.id)))) continue;
    fixes.push({ id: o.id, world: w0 });
    if (before.transform !== o.transform) blocked.push(o.name);
  }
  if (!fixes.length) return { doc: next, blocked };
  const doc = produce(next, (d) => {
    for (const f of fixes) {
      const o = d.objects[f.id];
      const parent = o.parentId ? worldMatrix(d as ModelDocument, o.parentId) : null;
      o.transform = matrixToTransform(parent ? parent.clone().invert().multiply(f.world) : f.world);
    }
  });
  return { doc, blocked };
}
