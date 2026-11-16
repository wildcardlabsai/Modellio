import { useEffect, useMemo, useState } from 'react';
import { Box, PencilRuler, Search } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useProjects } from '@/store/projectStore';
import { workspaceOf, type ProjectMeta } from '@/cad/serialization/project';
import { WORKSPACE_LABEL } from '@/platform/catalog';

const when = (ts: number) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Open design: every saved project with its preview, type (Design Studio or the maker that made
 * it) and when it was last changed. Projects open where they were made; maker projects can also
 * open in the Design Studio (the same project, not a copy).
 */
export function OpenDesignDialog() {
  const open = useProjects((s) => s.dialog === 'open');
  const projects = useProjects((s) => s.projects);
  const current = useProjects((s) => s.current);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<string>('all');
  useEffect(() => {
    if (open) void useProjects.getState().refresh();
  }, [open]);
  const kinds = useMemo(() => ['all', ...new Set(projects.map((p) => workspaceOf(p)))], [projects]);
  const shown = useMemo(
    () =>
      useProjects
        .getState()
        .recent(projects.length)
        .filter((p) => (kind === 'all' || workspaceOf(p) === kind) && p.name.toLowerCase().includes(q.trim().toLowerCase())),
    [projects, q, kind],
  );
  if (!open) return null;
  const close = () => useProjects.getState().setDialog(null);
  const go = (m: ProjectMeta, inDesign: boolean) => {
    close();
    const p = useProjects.getState();
    void (inDesign ? p.openInDesign(m.id) : p.openProject(m.id));
  };
  return (
    <Modal title="Open design" onClose={close} width={720}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-line bg-panel px-2.5">
          <Search size={15} className="text-muted" />
          <input
            data-autofocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search designs"
            aria-label="Search designs"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
          />
        </label>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Type of design"
          className="h-9 rounded-lg border border-line bg-panel px-2 text-[13px] text-ink"
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k === 'all' ? 'All designs' : (WORKSPACE_LABEL[k] ?? k)}
            </option>
          ))}
        </select>
      </div>
      {shown.length === 0 ? (
        <p className="mt-6 text-center text-[13px] text-muted">{projects.length ? 'No designs match.' : 'No saved designs yet.'}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line" aria-label="Saved designs" data-testid="open-design-list">
          {shown.map((m) => {
            const ws = workspaceOf(m);
            return (
              <li key={m.id} className="flex items-center gap-3 py-2" data-testid="open-design-row">
                <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-canvas">
                  {m.thumbnail ? (
                    <img src={m.thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Box size={20} className="text-muted" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">
                    {m.name}
                    {current?.id === m.id && <span className="ml-1.5 text-[12px] font-medium text-brand-ink">· open</span>}
                  </p>
                  <p className="text-[12px] text-muted">
                    <span className="mr-1.5 rounded bg-canvas px-1.5 py-px font-medium text-ink-2" data-testid="open-design-type">
                      {WORKSPACE_LABEL[ws] ?? ws}
                    </span>
                    {when(m.savedAt ?? m.updatedAt)} · {m.objectCount} object{m.objectCount === 1 ? '' : 's'}
                    {m.studioEdited ? ' · changed in Design Studio' : ''}
                  </p>
                </div>
                {ws !== 'design' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => go(m, true)}
                    title="Open this project in the Design Studio"
                    aria-label={`Open ${m.name} in Design Studio`}
                  >
                    <PencilRuler size={14} /> Design Studio
                  </Button>
                )}
                <Button size="sm" variant="primary" onClick={() => go(m, false)} aria-label={`Open ${m.name}`}>
                  Open
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
