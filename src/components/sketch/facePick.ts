import { create } from 'zustand';
import { useEditor } from '@/store/editorStore';
import { buildBrepAsync } from '@/cad/brep/client';
import { solidConversion } from '@/cad/brep/convert';
import type { BrepBuild } from '@/cad/brep/types';
import { worldMatrix } from '@/cad/hierarchy';
import { faceFrame } from '@/cad/placement';
import { solidRequest } from '@/cad/shapeRegistry';
import type { ObjectId, SketchId } from '@/types/document';
import { useSketchSession } from './sketchSession';

/** Why a face is being picked: to start a new sketch on it, or to re-attach an existing sketch. */
export type FacePickPurpose = { kind: 'new' } | { kind: 'reattach'; sketchId: SketchId };

interface FacePick {
  objectId: ObjectId;
  /** The body's exact build: its faces are what can be picked. */
  build: BrepBuild;
  purpose: FacePickPurpose;
}

/**
 * Picking a flat face of a body in the 3D view to sketch on. The body is built exactly (a box or
 * cylinder is built from its conversion recipe; the body itself is not changed), its faces are
 * highlighted under the cursor, and a click on a flat one opens the sketch editor on it.
 */
export const useFacePick = create<{
  pick: FacePick | null;
  start: (objectId: ObjectId, purpose: FacePickPurpose) => Promise<boolean>;
  /** Choose face `index` of the build. */
  choose: (index: number) => void;
  cancel: () => void;
}>((set, get) => ({
  pick: null,
  start: async (objectId, purpose) => {
    const editor = useEditor.getState();
    const o = editor.doc.objects[objectId];
    if (o?.kind !== 'shape') {
      editor.notify('Select a body to sketch on one of its faces.');
      return false;
    }
    const conv = solidConversion(o);
    if (!conv.ok) {
      editor.notify(`Sketching on a face needs a body with exact faces. ${conv.reason}`);
      return false;
    }
    try {
      const build = await buildBrepAsync(solidRequest({ feature: conv.recipe, size: o.size })!);
      set({ pick: { objectId, build, purpose } });
      // Clicks pick faces now, not objects (the same mode the solid-feature tools use).
      editor.select([objectId]);
      editor.setTool('edges');
      return true;
    } catch (e) {
      editor.notify(e instanceof Error ? e.message : String(e));
      return false;
    }
  },
  choose: (index) => {
    const p = get().pick;
    const editor = useEditor.getState();
    const o = p && editor.doc.objects[p.objectId];
    if (!p || o?.kind !== 'shape') return;
    const face = p.build.faces[index];
    const frame = face && faceFrame(p.build, index, o.size, o.mirror, worldMatrix(editor.doc, o.id));
    if (!face || !frame) {
      editor.notify('Sketches go on flat faces. Click a flat face.');
      return;
    }
    const placement = { kind: 'face' as const, objectId: o.id, face: face.ref };
    get().cancel();
    if (p.purpose.kind === 'new') useSketchSession.getState().openOn({ placement, frame, label: `a face of ${o.name}` });
    else editor.reattachSketch(p.purpose.sketchId, placement, frame);
  },
  cancel: () => {
    set({ pick: null });
    if (useEditor.getState().tool === 'edges') useEditor.getState().setTool('select');
  },
}));
