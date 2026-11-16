import { Cloud, CloudOff, Loader2, CircleDot, Eye } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import { useProjects } from '@/store/projectStore';

/** Saved / unsaved indicator, with the last-saved time. Unsaved work is kept as a recovery draft until Save. */
export function SaveStatus() {
  const status = useProjects((s) => s.status);
  const savedAt = useProjects((s) => s.current?.savedAt);
  const error = useProjects((s) => s.error);
  const local = useProjects((s) => s.repo?.kind === 'indexeddb');
  const map = {
    loading: { Icon: Loader2, text: 'Loading…', cls: 'text-muted', spin: true },
    saving: { Icon: Loader2, text: 'Saving…', cls: 'text-muted', spin: true },
    saved: { Icon: Cloud, text: savedAt ? 'Saved' : 'Not saved yet', cls: 'text-muted', spin: false },
    unsaved: { Icon: CircleDot, text: 'Unsaved changes', cls: 'text-amber-700', spin: false },
    error: { Icon: CloudOff, text: 'Not saved', cls: 'text-red-600', spin: false },
  }[status];
  const readOnly = useEditor((s) => s.readOnly);
  if (readOnly)
    return (
      <span role="status" data-testid="save-status" className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-brand-ink">
        <Eye size={16} /> <span className="sr-only whitespace-nowrap xl:not-sr-only">View only</span>
      </span>
    );
  const { Icon } = map;
  return (
    <span
      role="status"
      data-testid="save-status"
      title={
        error ??
        (savedAt
          ? `Last saved ${new Date(savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}${local ? ' in this browser' : ''}`
          : 'This design has not been saved yet. Save it to keep it in My projects.')
      }
      className={`flex shrink-0 items-center gap-1.5 text-[13px] font-medium ${map.cls}`}
    >
      <Icon size={16} className={map.spin ? 'animate-spin' : ''} />
      <span className="sr-only whitespace-nowrap xl:not-sr-only">{map.text}</span>
      {status === 'saved' && savedAt && (
        <span className="sr-only whitespace-nowrap text-[12px] font-normal 2xl:not-sr-only" data-testid="last-saved">
          · {new Date(savedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </span>
  );
}
