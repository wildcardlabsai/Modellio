import { Cloud, CloudOff, Loader2, CircleDot, Eye } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import { useProjects } from '@/store/projectStore';

/** "Saved" indicator. Projects autosave locally shortly after every change. */
export function SaveStatus() {
  const status = useProjects((s) => s.status);
  const error = useProjects((s) => s.error);
  const local = useProjects((s) => s.repo?.kind === 'indexeddb');
  const map = {
    loading: { Icon: Loader2, text: 'Loading…', cls: 'text-muted', spin: true },
    saving: { Icon: Loader2, text: 'Saving…', cls: 'text-muted', spin: true },
    saved: { Icon: Cloud, text: 'Saved', cls: 'text-muted', spin: false },
    unsaved: { Icon: CircleDot, text: 'Unsaved changes', cls: 'text-amber-700', spin: false },
    error: { Icon: CloudOff, text: 'Not saved', cls: 'text-red-600', spin: false },
  }[status];
  const readOnly = useEditor((s) => s.readOnly);
  if (readOnly)
    return (
      <span role="status" data-testid="save-status" className="flex items-center gap-1.5 text-[13px] font-medium text-brand">
        <Eye size={16} /> <span className="hidden lg:inline">View only</span>
      </span>
    );
  const { Icon } = map;
  return (
    <span
      role="status"
      data-testid="save-status"
      title={error ?? (local ? 'Saved in this browser' : 'Temporary storage only')}
      className={`flex items-center gap-1.5 text-[13px] font-medium ${map.cls}`}
    >
      <Icon size={16} className={map.spin ? 'animate-spin' : ''} />
      <span className="hidden lg:inline">{map.text}</span>
    </span>
  );
}
