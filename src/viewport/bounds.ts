import * as THREE from 'three';
import type { ModelDocument, ObjectId } from '@/types/document';
import { collectSubtree } from '@/cad/document';
import { worldBounds } from '@/cad/transforms/transform';

export function selectionBounds(doc: ModelDocument, ids: ObjectId[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const id of collectSubtree(doc, ids)) {
    const o = doc.objects[id];
    if (o?.kind === 'shape') box.union(worldBounds(o));
  }
  return box;
}

export function sceneBounds(doc: ModelDocument): THREE.Box3 {
  return selectionBounds(
    doc,
    doc.rootIds.filter((id) => doc.objects[id]?.visible),
  );
}
