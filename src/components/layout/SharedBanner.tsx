import { Eye, CopyPlus, X } from 'lucide-react';
import { useProjects } from '@/store/projectStore';

/** Shown while viewing a design opened from a share link. */
export function SharedBanner() {
  const shared = useProjects((s) => s.shared);
  if (!shared) return null;
  const { copyShared, closeShared } = useProjects.getState();
  return (
    <div
      role="region"
      aria-label="Shared design"
      className="flex shrink-0 items-center gap-3 border-b border-brand/20 bg-brand-50 px-4 py-2 text-[13px] text-ink"
    >
      <Eye size={16} className="shrink-0 text-brand" />
      <span className="flex-1">
        Viewing <strong className="font-semibold">“{shared.meta.name}”</strong>, shared with you. It is view-only — make a copy to edit it.
      </span>
      <button
        type="button"
        onClick={() => void copyShared()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-600"
      >
        <CopyPlus size={15} /> Make a copy
      </button>
      <button
        type="button"
        onClick={() => void closeShared()}
        aria-label="Close shared design"
        className="rounded-lg p-1.5 text-muted hover:bg-white"
      >
        <X size={16} />
      </button>
    </div>
  );
}
