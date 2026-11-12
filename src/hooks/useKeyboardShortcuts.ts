import { useEffect } from 'react';
import { useEditor } from '@/store/editorStore';
import type { Vec3 } from '@/types/document';
import * as THREE from 'three';
import { isEffectivelyLocked, topLevel, translateWorldDraft } from '@/cad/hierarchy';

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
      if (mod && key === 'g') {
        e.preventDefault();
        if (e.shiftKey) s.ungroupSelected();
        else s.groupSelected();
        return;
      }
      if (mod && key === 'c') {
        e.preventDefault();
        s.copySelected();
        return;
      }
      if (mod && key === 'x') {
        e.preventDefault();
        s.cutSelected();
        return;
      }
      if (mod && key === 'v') {
        e.preventDefault();
        s.paste();
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
          else if (s.tool === 'measure') s.setTool('select');
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
        case 'h': {
          // Toggle hole/solid for the selection (all holes → solid, otherwise → hole).
          const shapes = s.selection.map((id) => s.doc.objects[id]);
          if (!shapes.length) break;
          const allHoles = shapes.every((o) => o?.kind === 'shape' && o.isHole);
          s.setHole(s.selection, !allHoles);
          break;
        }
        case 'm':
          s.setTool(s.tool === 'measure' ? 'select' : 'measure');
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
  const ids = topLevel(s.doc, s.selection).filter((id) => !isEffectivelyLocked(s.doc, id));
  // Nudges are in world axes, so they behave the same inside rotated groups.
  s.apply('Nudge', (doc) => {
    for (const id of ids) translateWorldDraft(doc, id, new THREE.Vector3(...d));
  });
}
