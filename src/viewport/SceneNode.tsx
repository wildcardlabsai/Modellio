import { memo } from 'react';
import { useEditor } from '@/store/editorStore';
import * as THREE from 'three';
import type { ObjectId, SceneObject, Vec3 } from '@/types/document';
import { explodeOffsets } from '@/cad/assembly/explode';
import { worldMatrix } from '@/cad/hierarchy';
import { ShapeMesh } from './ShapeMesh';
import { CombinedMesh } from './CombinedMesh';
import { DEG2RAD } from '@/utils/math';

interface Props {
  id: ObjectId;
  highlighted?: boolean;
  /** Inside a combined group: parts are drawn only as ghosts while selected. */
  ghost?: boolean;
}

/**
 * Recursively renders the scene graph. Each node subscribes only to its own
 * object, so editing one object does not re-render the whole scene. Hidden
 * subtrees are not mounted at all (so they can't be picked either).
 */
export const SceneNode = memo(function SceneNode({ id, highlighted = false, ghost = false }: Props) {
  const o = useEditor((s) => s.doc.objects[id]);
  const selected = useEditor((s) => s.selection.includes(id));
  // An exploded view moves the part only on screen (as a string so unrelated changes don't re-render).
  const offsetKey = useEditor((s) => explodeOffsetKey(s, id));
  // Hidden and suppressed parts are not drawn (or picked).
  if (!o || !o.visible || o.suppressed) return null;
  const node = drawNode(o, selected, highlighted, ghost);
  if (!offsetKey) return node;
  return <group position={JSON.parse(offsetKey) as Vec3}>{node}</group>;
});

/** The offset an exploded view gives this object, in its parent's frame (JSON), or ''. */
function explodeOffsetKey(s: ReturnType<typeof useEditor.getState>, id: ObjectId): string {
  const ex = s.explode;
  const view = ex && s.doc.explodeViews?.[ex.viewId];
  if (!view || ex.progress <= 0) return '';
  const w = explodeOffsets(view, ex.progress).get(id);
  if (!w) return '';
  const o = s.doc.objects[id];
  const v = new THREE.Vector3(...w);
  if (o?.parentId) v.applyMatrix3(new THREE.Matrix3().setFromMatrix4(worldMatrix(s.doc, o.parentId).invert()));
  return JSON.stringify(v.toArray().map((n) => Math.round(n * 1000) / 1000));
}

function drawNode(o: SceneObject, selected: boolean, highlighted: boolean, ghost: boolean) {
  if (o.kind === 'shape') return <ShapeMesh object={o} selected={selected} highlighted={highlighted} ghost={ghost} />;
  const r = o.transform.rotation;
  return (
    <group name={o.id} position={o.transform.position} rotation={[r[0] * DEG2RAD, r[1] * DEG2RAD, r[2] * DEG2RAD]}>
      {o.combine && !ghost && <CombinedMesh id={o.id} selected={selected} highlighted={highlighted} />}
      {o.children.map((c) => (
        <SceneNode key={c} id={c} highlighted={o.combine ? false : highlighted || selected} ghost={ghost || !!o.combine} />
      ))}
    </group>
  );
}
