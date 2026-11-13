import { useEffect, useState } from 'react';
import { Plus, MoreHorizontal, Copy, Trash2, Pencil, FileInput, Box, CircleAlert } from 'lucide-react';
import { useProjects } from '@/store/projectStore';
import { openProjectPicker } from '@/components/files/fileIntake';
import { Popover } from '@/components/ui/Popover';
import { Modal, primaryBtn, secondaryBtn } from '@/components/ui/Modal';
import type { ProjectMeta } from '@/cad/serialization/project';

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(ts: number) {
  const s = Math.round((ts - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [u, n] of units) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return 'just now';
}

/** "My Projects": every design saved in this browser. */
export function ProjectsPage() {
  const projects = useProjects((s) => s.projects);
  const current = useProjects((s) => s.current);
  const error = useProjects((s) => s.error);
  const storage = useProjects((s) => s.storage);
  const repoKind = useProjects((s) => s.repo?.kind);
  /** One-off upload of the projects stored in this browser into the signed-in account. */
  const copyLocalToCloud = async () => {
    const { IndexedDbProjectRepository } = await import('@/cad/serialization/repository');
    const local = new IndexedDbProjectRepository();
    const repo = useProjects.getState().repo;
    if (!repo) return;
    for (const m of await local.list()) {
      const data = await local.load(m.id);
      if (data) await repo.save(data);
    }
    await useProjects.getState().refresh();
  };
  const p = useProjects.getState();
  const [renaming, setRenaming] = useState<ProjectMeta | null>(null);
  const [deleting, setDeleting] = useState<ProjectMeta | null>(null);

  useEffect(() => {
    void p.refresh();
    void p.refreshStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="absolute inset-0 z-20 overflow-y-auto bg-canvas" aria-label="My projects">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight text-ink">My projects</h1>
            <p className="mt-1 text-[14px] text-muted">
              {projects.length} design{projects.length === 1 ? '' : 's'} saved in this browser. Download a project file to back it up or
              move it to another computer.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" className={secondaryBtn} onClick={openProjectPicker}>
              <FileInput size={16} /> Open project file
            </button>
            <button type="button" className={primaryBtn} onClick={() => void p.newProject()}>
              <Plus size={16} /> New design
            </button>
          </div>
        </div>
        {repoKind === 'cloud' && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            Projects are saved to your account.
            <button type="button" onClick={() => void copyLocalToCloud()} className="font-semibold text-brand hover:underline">
              Copy projects from this browser
            </button>
          </p>
        )}
        {storage && repoKind !== 'cloud' && (
          <p className="mt-3 text-[12px] text-muted" data-testid="storage-info">
            Using {(storage.usage / 1048576).toFixed(1)} MB of browser storage
            {storage.quota ? ` (of ${(storage.quota / 1073741824).toFixed(1)} GB available)` : ''} ·{' '}
            {storage.persisted
              ? 'protected from automatic clean-up'
              : 'the browser may clear it if your disk gets full — download project files as backups'}
          </p>
        )}
        {error && (
          <p className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            <CircleAlert size={15} /> {error}
          </p>
        )}

        <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5" aria-label="Projects">
          <li>
            <button
              type="button"
              onClick={() => void p.newProject()}
              className="flex aspect-[4/3.6] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#c9d2e0] text-muted transition-colors hover:border-brand hover:bg-brand-50 hover:text-brand"
            >
              <Plus size={28} />
              <span className="text-[14px] font-semibold">New design</span>
            </button>
          </li>
          {projects.map((m) => (
            <li key={m.id} className="group relative" data-testid="project-card">
              <button
                type="button"
                onClick={() => void p.open(m.id)}
                className={`block w-full overflow-hidden rounded-2xl border bg-white text-left shadow-panel transition-shadow hover:shadow-float ${
                  current?.id === m.id ? 'border-brand ring-2 ring-brand/20' : 'border-line'
                }`}
              >
                <div className="flex aspect-[16/10] items-center justify-center overflow-hidden bg-[#eef3fb]">
                  {m.thumbnail ? (
                    <img src={m.thumbnail} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <Box size={36} className="text-[#b8c4d8]" />
                  )}
                </div>
                <div className="px-4 py-3">
                  <p className="truncate pr-6 text-[14px] font-semibold text-ink">
                    <span className="sr-only">Open </span>
                    {m.name}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {ago(m.updatedAt)} · {m.objectCount} object{m.objectCount === 1 ? '' : 's'}
                    {current?.id === m.id && <span className="ml-1 font-medium text-brand">· open</span>}
                  </p>
                </div>
              </button>
              <div className="absolute bottom-3 right-2">
                <Popover
                  align="right"
                  side="top"
                  trigger={({ toggle }) => (
                    <button
                      type="button"
                      aria-label={`Actions for ${m.name}`}
                      onClick={toggle}
                      className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink"
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  )}
                >
                  {(close) => (
                    <div className="w-44" role="menu">
                      {[
                        { label: 'Rename', Icon: Pencil, run: () => setRenaming(m) },
                        { label: 'Duplicate', Icon: Copy, run: () => void p.duplicate(m.id) },
                        { label: 'Delete', Icon: Trash2, run: () => setDeleting(m), danger: true },
                      ].map(({ label, Icon, run, danger }) => (
                        <button
                          key={label}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            run();
                            close();
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium ${
                            danger ? 'text-red-600 hover:bg-red-50' : 'text-[#344054] hover:bg-brand-50 hover:text-brand'
                          }`}
                        >
                          <Icon size={15} /> {label}
                        </button>
                      ))}
                    </div>
                  )}
                </Popover>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {renaming && <RenameDialog meta={renaming} onClose={() => setRenaming(null)} />}
      {deleting && (
        <Modal
          title="Delete design?"
          onClose={() => setDeleting(null)}
          width={420}
          footer={
            <>
              <button type="button" className={secondaryBtn} onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-red-700"
                onClick={() => {
                  void p.remove(deleting.id);
                  setDeleting(null);
                }}
              >
                <Trash2 size={15} /> Delete
              </button>
            </>
          }
        >
          <p className="text-[14px] text-[#344054]">
            “{deleting.name}” will be permanently removed from this browser. This can't be undone.
          </p>
        </Modal>
      )}
    </section>
  );
}

function RenameDialog({ meta, onClose }: { meta: ProjectMeta; onClose: () => void }) {
  const [name, setName] = useState(meta.name);
  const submit = () => {
    if (!name.trim()) return;
    void useProjects.getState().rename(meta.id, name);
    onClose();
  };
  return (
    <Modal
      title="Rename design"
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={primaryBtn} disabled={!name.trim()} onClick={submit}>
            Rename
          </button>
        </>
      }
    >
      <input
        autoFocus
        aria-label="Design name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="w-full rounded-lg border border-line px-3 py-2 text-[14px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
      />
    </Modal>
  );
}
