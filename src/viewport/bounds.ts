import type * as THREE from 'three';
import type { ModelDocument, ObjectId } from '@/types/document';
import { topLevel, worldBoundsOf } from '@/cad/hierarchy';

export function selectionBounds(doc: ModelDocument, ids: ObjectId[]): THREE.Box3 {
  return worldBoundsOf(doc, topLevel(doc, ids));
}

export function sceneBounds(doc: ModelDocument): THREE.Box3 {
  return worldBoundsOf(
    doc,
    doc.rootIds.filter((id) => doc.objects[id]?.visible),
  );
}
