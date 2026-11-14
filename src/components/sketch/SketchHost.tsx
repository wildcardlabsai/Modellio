import { lazy, Suspense } from 'react';
import { useSketchSession } from './sketchSession';

const SketchEditor = lazy(() => import('./SketchEditor').then((m) => ({ default: m.SketchEditor })));

/** Mounts the sketch editor while a sketch is being drawn or edited (loaded on first use). */
export function SketchHost() {
  const editing = useSketchSession((s) => s.editing);
  const close = useSketchSession((s) => s.close);
  if (!editing) return null;
  return (
    <Suspense fallback={null}>
      <SketchEditor key={editing.id ?? 'new'} objectId={editing.id} onClose={close} />
    </Suspense>
  );
}
