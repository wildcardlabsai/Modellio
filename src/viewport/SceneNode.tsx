import { memo } from 'react';
import { useEditor } from '@/store/editorStore';
import type { ObjectId } from '@/types/document';
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
  if (!o || !o.visible) return null;
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
});
