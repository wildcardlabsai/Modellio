import { useEffect } from 'react';
import { useEditor } from '@/store/editorStore';
import type { Vec3 } from '@/types/document';
import { roundTo } from '@/utils/math';

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Global editor shortcuts. Ignored while typing in inputs so that, e.g.,
 * Backspace in a dimension field never deletes the selected object.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        s.duplicateSelected();
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        s.selectAll();
        return;
      }
      if (mod) return;

      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          s.deleteSelected();
          return;
        case 'Escape':
          if (s.transaction) s.cancelTransaction();
          else s.clearSelection();
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown':
          if (!s.selection.length) return;
          e.preventDefault();
          nudge(e);
          return;
        case 'PageUp':
        case 'PageDown':
          if (!s.selection.length) return;
          e.preventDefault();
          nudge(e);
          return;
      }

      switch (key) {
        case 'w':
          s.setMode('translate');
          break;
        case 'e':
          s.setMode('rotate');
          break;
        case 'r':
          s.setMode('scale');
          break;
        case 'f':
          s.requestFrame();
          break;
        case 'd':
          if (s.selection.length) s.dropToWorkplane(s.selection);
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Arrow keys move the selection on X/Y; PageUp/PageDown on Z. Shift = ×10. */
function nudge(e: KeyboardEvent) {
  const s = useEditor.getState();
  const step = (s.snap.enabled ? s.snap.translate : 1) * (e.shiftKey ? 10 : 1);
  const d: Vec3 = [0, 0, 0];
  if (e.key === 'ArrowLeft') d[0] = -step;
  if (e.key === 'ArrowRight') d[0] = step;
  if (e.key === 'ArrowUp') d[1] = step;
  if (e.key === 'ArrowDown') d[1] = -step;
  if (e.key === 'PageUp') d[2] = step;
  if (e.key === 'PageDown') d[2] = -step;
  s.apply('Nudge', (doc) => {
    for (const id of s.selection) {
      const o = doc.objects[id];
      if (!o || o.locked) continue;
      o.transform.position = o.transform.position.map((v, i) => roundTo(v + d[i])) as Vec3;
    }
  });
}
