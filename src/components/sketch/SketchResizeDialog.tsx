import { useEditor } from '@/store/editorStore';
import { ConfirmChoice } from '@/components/ui/ConfirmChoice';
import { useSketchSession } from './sketchSession';

/**
 * Shown when a resize was refused because it would stretch a body away from the sketch that
 * controls its outline: explains why, and offers to edit the sketch or make the body independent.
 */
export function SketchResizeDialog() {
  const blocked = useEditor((s) => s.blockedResize);
  const doc = useEditor((s) => s.doc);
  if (!blocked) return null;
  const close = () => useEditor.getState().clearBlockedResize();
  const target = doc.objects[blocked.objectId];
  const names = blocked.bodies.map((id) => doc.objects[id]?.name).filter(Boolean);
  const body = blocked.size && target?.kind === 'shape' ? target : null;
  const sketchName = body?.sketchId ? doc.sketches?.[body.sketchId]?.name : undefined;
  if (body && blocked.size) {
    const size = blocked.size;
    const revolve = (body.params.op ?? 0) >= 1;
    return (
      <ConfirmChoice
        title="This body follows its sketch"
        onCancel={close}
        testId="sketch-resize-dialog"
        choices={[
          {
            label: 'Edit sketch',
            testId: 'sketch-resize-edit',
            onChoose: () => {
              close();
              useSketchSession.getState().open(body.id);
            },
          },
          {
            label: 'Make independent and resize',
            testId: 'sketch-resize-independent',
            onChoose: () => {
              close();
              void useEditor.getState().resizeIndependent(body.id, size);
            },
          },
        ]}
      >
        <p>
          The outline of <strong className="font-semibold text-ink">{body.name}</strong> comes from the sketch{' '}
          <strong className="font-semibold text-ink">{sketchName ?? 'it was made from'}</strong>. Stretching the body would make it stop
          matching that sketch, so it was not resized.
        </p>
        <p className="mt-2">
          {revolve
            ? 'Change its size by editing the sketch, or give it its own resized copy of the sketch.'
            : 'Its height is the extrude depth and can be changed freely. To change its outline, edit the sketch, or give it its own resized copy of the sketch.'}
        </p>
      </ConfirmChoice>
    );
  }
  return (
    <ConfirmChoice title="Some bodies follow their sketches" onCancel={close} cancelLabel="OK" choices={[]} testId="sketch-resize-dialog">
      <p>
        Scaling <strong className="font-semibold text-ink">{target?.name ?? 'this'}</strong> would stretch {names.join(', ')} away from the
        sketches that control {names.length === 1 ? 'its outline' : 'their outlines'}, so nothing was changed.
      </p>
      <p className="mt-2">Resize them by editing their sketches, or select one and resize it to make it independent.</p>
    </ConfirmChoice>
  );
}
