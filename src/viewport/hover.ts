import { create } from 'zustand';
import { collectSubtree } from '@/cad/document';
import { useEditor } from '@/store/editorStore';
import type { ObjectId } from '@/types/document';

/**
 * Objects pointed at outside the 3D view (a Design Browser row, a history step). The view
 * highlights them so you can see what a row or step refers to. Not saved, not undoable.
 */
export const useHover = create<{ ids: ObjectId[]; set: (ids: ObjectId[]) => void }>((set, get) => ({
  ids: [],
  set: (ids) => {
    // A group stands for everything in it.
    const doc = useEditor.getState().doc;
    const all = ids.length
      ? collectSubtree(
          doc,
          ids.filter((id) => doc.objects[id]),
        )
      : [];
    const cur = get().ids;
    if (cur.length === all.length && cur.every((id, i) => id === all[i])) return;
    set({ ids: all });
  },
}));
