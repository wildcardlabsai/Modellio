import { X } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import { useFacePick } from './facePick';

/** While a face is being picked: what to do, and a way out. */
export function FacePickBanner() {
  const pick = useFacePick((s) => s.pick);
  const name = useEditor((s) => (pick ? s.doc.objects[pick.objectId]?.name : undefined));
  if (!pick) return null;
  return (
    <div
      className="fixed left-1/2 top-16 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-ink px-4 py-2 text-[13px] text-white shadow-lg"
      role="status"
      data-testid="face-pick-banner"
    >
      <span>
        {pick.purpose.kind === 'new' ? 'Click a flat face of' : 'Click the flat face to attach the sketch to, on'}{' '}
        <strong className="font-semibold">{name}</strong>
      </span>
      <button
        type="button"
        onClick={() => useFacePick.getState().cancel()}
        className="flex items-center gap-1 rounded-md px-2 py-0.5 text-white/80 hover:bg-white/10 hover:text-white"
      >
        <X size={14} /> Cancel
      </button>
    </div>
  );
}
