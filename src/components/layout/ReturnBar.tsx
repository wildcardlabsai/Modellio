import { ArrowLeft } from 'lucide-react';
import { useStudio } from '@/app/studio';
import { useProjects } from '@/store/projectStore';
import { WORKSPACE_LABEL } from '@/platform/catalog';

/**
 * Shown in the Design Studio when the open design was made in a maker (one project, two views):
 * says so, and opens the same project back in its maker in one click.
 */
export function ReturnBar() {
  const studio = useStudio((s) => s.studio);
  const maker = useProjects((s) => s.currentMaker);
  const current = useProjects((s) => s.current);
  if (!maker || !current || studio !== 'design') return null;
  const label = WORKSPACE_LABEL[maker.studio] ?? 'its maker';
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-3 border-b border-brand/20 bg-brand-50 px-3 text-[13px] text-ink sm:px-5"
      role="region"
      aria-label="Return to maker"
      data-testid="return-bar"
    >
      {maker.studio !== 'split' && (
        <button
          type="button"
          onClick={() => void useProjects.getState().openProject(current.id)}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-brand px-2.5 text-[12px] font-semibold text-white hover:bg-brand-600"
        >
          <ArrowLeft size={14} /> Back to {label}
        </button>
      )}
      <span className="hidden min-w-0 truncate text-muted sm:inline">
        “{current.name}” was made in the {label}. Changes saved here stay with this project; saving it again in the {label} rebuilds it from
        the maker’s settings (this version is kept in its history).
      </span>
    </div>
  );
}
