import { ArrowLeft, X } from 'lucide-react';
import { useStudio } from '@/app/studio';

/**
 * Shown in the Design Studio when a maker sent a copy of its design here, so getting back to the
 * maker is one click rather than the browser's Back button.
 */
export function ReturnBar() {
  const returnTo = useStudio((s) => s.returnTo);
  const studio = useStudio((s) => s.studio);
  if (!returnTo || studio !== 'design') return null;
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-3 border-b border-brand/20 bg-brand-50 px-3 text-[13px] text-[#1d2939] sm:px-5"
      role="region"
      aria-label="Return to maker"
      data-testid="return-bar"
    >
      <button
        type="button"
        onClick={() => useStudio.getState().setStudio(returnTo.studio)}
        className="flex h-7 items-center gap-1.5 rounded-md bg-brand px-2.5 text-[12px] font-semibold text-white hover:bg-brand-600"
      >
        <ArrowLeft size={14} /> Back to {returnTo.label}
      </button>
      <span className="hidden min-w-0 truncate text-muted sm:inline">
        You’re editing a copy. Your design in the {returnTo.label} is unchanged.
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => useStudio.getState().clearReturn()}
        className="rounded-md p-1 text-muted hover:bg-white hover:text-ink"
        aria-label="Hide this bar"
      >
        <X size={15} />
      </button>
    </div>
  );
}
