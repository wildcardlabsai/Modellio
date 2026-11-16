import { History } from 'lucide-react';
import { useProjects } from '@/store/projectStore';
import { Button } from '@/components/ui/Button';

/** Unsaved work found from an earlier session (a refresh, a closed tab): restore it or discard it. */
export function RecoveryBanner() {
  const recovery = useProjects((s) => s.recovery);
  if (!recovery) return null;
  const when = new Date(recovery.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-[13px] text-amber-900"
      role="status"
      data-testid="recovery-banner"
    >
      <History size={16} className="shrink-0" />
      <span className="min-w-0 flex-1">
        Unsaved changes to <strong className="font-semibold">{recovery.name}</strong> from {when} were found. Restore them, or keep the
        design as it was last saved?
      </span>
      <Button size="sm" variant="ghost" onClick={() => void useProjects.getState().dismissRecovery()} data-testid="recovery-discard">
        Discard
      </Button>
      <Button size="sm" variant="primary" onClick={() => void useProjects.getState().restoreRecovery()} data-testid="recovery-restore">
        Restore changes
      </Button>
    </div>
  );
}
