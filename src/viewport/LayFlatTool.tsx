import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useEditor } from '@/store/editorStore';
import { rootAncestor } from '@/cad/hierarchy';
import { pickSurface } from './viewportBridge';
import type { Vec3 } from '@/types/document';

/**
 * Lay flat (L): click any face of an object and it is rotated so that face
 * rests on the build plate — the quickest way to get the best printing
 * orientation. Works on shapes, groups and Boolean results.
 */
export function LayFlatTool() {
  const tool = useEditor((s) => s.tool);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (tool !== 'layflat') return;
    const el = gl.domElement;
    el.style.cursor = 'copy';
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const hit = pickSurface(e.clientX, e.clientY);
      if (!hit?.objectName) return;
      const s = useEditor.getState();
      const name = hit.objectName.replace(/:result$/, '');
      if (!s.doc.objects[name]) return;
      // A part selected inside a group is laid flat on its own; otherwise the whole outer group turns.
      const target = s.selection.includes(name) ? name : rootAncestor(s.doc, name);
      s.layFlat(target, hit.normal.toArray() as Vec3);
      s.select([target]);
      s.setTool('select');
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.style.cursor = '';
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [tool, gl]);
  return null;
}
