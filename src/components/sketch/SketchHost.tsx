import { lazy, Suspense } from 'react';
import { useSketchSession } from './sketchSession';
import { useEditor } from '@/store/editorStore';
import { sketchUsers } from '@/cad/sketchRecords';

const SketchEditor = lazy(() => import('./SketchEditor').then((m) => ({ default: m.SketchEditor })));

/** Mounts the sketch editor while a sketch is being drawn or edited (loaded on first use). */
export function SketchHost() {
  const editing = useSketchSession((s) => s.editing);
  const close = useSketchSession((s) => s.close);
  if (!editing) return null;
  if (editing.record) {
    const doc = useEditor.getState().doc;
    const rec = doc.sketches?.[editing.record];
    if (!rec) return null;
    const users = sketchUsers(doc, rec.id);
    const sketchId = rec.id;
    return (
      <Suspense fallback={null}>
        <SketchEditor
          key={`record-${sketchId}`}
          objectId={null}
          onClose={close}
          use={{
            title: rec.name,
            initial: rec.sketch,
            hint: users.length
              ? `Saving updates every body built from this sketch: ${users.map((u) => u.name).join(', ')}.`
              : 'This sketch is on its own. Save it here, then make a body from it in the Sketches list.',
            check: () => null,
            action: 'Save sketch',
            onDone: (sketch) => {
              void useEditor
                .getState()
                .updateSketchRecord(sketchId, sketch)
                .then((ok) => {
                  if (ok) {
                    useEditor.getState().requestFrame();
                    close();
                  }
                });
            },
          }}
        />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={null}>
      <SketchEditor
        key={editing.id ?? `new-${editing.op ?? ''}-${editing.place ? JSON.stringify(editing.place.frame) : ''}`}
        objectId={editing.id}
        initialOp={editing.op}
        place={editing.place}
        onClose={close}
      />
    </Suspense>
  );
}
