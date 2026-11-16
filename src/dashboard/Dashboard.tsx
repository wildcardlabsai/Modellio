import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Box,
  Copy,
  FileUp,
  FolderOpen,
  LayoutTemplate,
  PencilRuler,
  Plus,
  Trash2,
  Wand2,
  Wrench,
  AlertCircle,
  History,
} from 'lucide-react';
import { useStudio } from '@/app/studio';
import { useProjects } from '@/store/projectStore';
import { workspaceOf, type ProjectMeta } from '@/cad/serialization/project';
import { MAKER_ENTRIES, TOOL_ENTRIES, WORKSPACE_LABEL } from '@/platform/catalog';
import { ConfirmDialog, EmptyState, Spinner, StudioLink, buttonClass } from '@/components/ui/platform';
import { openMeshPicker } from '@/components/files/fileIntake';
import { TEMPLATES } from '@/templates/templates';

const fmtDate = (t: number) => {
  const d = Date.now() - t;
  if (d < 60_000) return 'Just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** A project worth listing: anything with content (an empty "Untitled design" is just a blank start). */
const hasContent = (p: ProjectMeta) => p.objectCount > 0 || workspaceOf(p) !== 'design';

/**
 * The MODELLIO dashboard: start something new, choose a maker, or carry on with saved work.
 * Projects come from the same storage the Design Studio and makers save to.
 */
export default function Dashboard() {
  const projects = useProjects((s) => s.projects);
  const repo = useProjects((s) => s.repo);
  const error = useProjects((s) => s.error);
  // By last activity (opened or saved), each project once.
  const recent = useMemo(() => useProjects.getState().recent(projects.length).filter(hasContent), [projects]);
  const goDesign = (fn?: () => void) => {
    fn?.();
    useStudio.getState().setStudio('design');
  };
  return (
    <div className="bg-aurora dark-scroll surface-night h-full min-h-0 flex-1 overflow-y-auto" data-testid="dashboard">
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-10 sm:px-6 lg:pt-14">
        <section aria-labelledby="welcome-title" className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 id="welcome-title" className="text-[34px] font-bold leading-tight tracking-tight text-white sm:text-[42px]">
              Welcome to <span className="text-gradient">MODELLIO</span>
            </h1>
            <p className="mt-2 text-[16px] text-haze sm:text-[17px]">
              Choose a maker, open the Design Studio or continue a recent project.
            </p>
          </div>
          <button
            type="button"
            className={buttonClass('primary', 'lg')}
            onClick={() => goDesign(() => void useProjects.getState().newProject())}
            data-testid="start-creating"
          >
            <Plus size={18} /> Start creating
          </button>
        </section>

        <section aria-label="Get started" className="mt-10 grid gap-4 md:grid-cols-3">
          <StudioLink to="design" className="card-night card-night-hover group flex flex-col p-6" testId="entry-design">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet/30 to-electric/30 text-violet-300">
              <Box size={24} aria-hidden />
            </span>
            <h2 className="mt-4 text-[19px] font-semibold text-white">Open Design Studio</h2>
            <p className="mt-1 flex-1 text-[14px] leading-relaxed text-haze">
              Model anything from shapes, text and imports, with Booleans and print checks.
            </p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-violet-300 group-hover:text-white">
              Open <ArrowRight size={15} />
            </span>
          </StudioLink>
          <a href="#makers" className="card-night card-night-hover group flex flex-col p-6" data-testid="entry-makers">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet/30 to-electric/30 text-violet-300">
              <Wand2 size={24} aria-hidden />
            </span>
            <h2 className="mt-4 text-[19px] font-semibold text-white">Browse Makers</h2>
            <p className="mt-1 flex-1 text-[14px] leading-relaxed text-haze">
              Keyrings, key tags, signs, vases and more, ready to print in minutes.
            </p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-violet-300 group-hover:text-white">
              Browse <ArrowRight size={15} />
            </span>
          </a>
          <a href="#tools" className="card-night card-night-hover group flex flex-col p-6" data-testid="entry-tools">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet/30 to-electric/30 text-violet-300">
              <Wrench size={24} aria-hidden />
            </span>
            <h2 className="mt-4 text-[19px] font-semibold text-white">Explore Design Tools</h2>
            <p className="mt-1 flex-1 text-[14px] leading-relaxed text-haze">
              Gears, boxes with lids, SVG extrusion, double-sided engraving and print checks.
            </p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-violet-300 group-hover:text-white">
              Explore <ArrowRight size={15} />
            </span>
          </a>
        </section>

        <section aria-label="Quick actions" className="mt-6 flex flex-wrap gap-2" data-testid="quick-actions">
          <button
            type="button"
            className={buttonClass('secondary', 'sm')}
            onClick={() => useProjects.getState().setDialog('new')}
            data-testid="dashboard-new-design"
          >
            <Plus size={15} /> New Design
          </button>
          <button
            type="button"
            className={buttonClass('secondary', 'sm')}
            onClick={() => {
              goDesign();
              // The picker opens once the Design Studio is on screen.
              setTimeout(openMeshPicker, 50);
            }}
          >
            <FileUp size={15} /> Import 3D Model
          </button>
          <button
            type="button"
            className={buttonClass('secondary', 'sm')}
            disabled={!recent.length}
            onClick={() => recent[0] && void useProjects.getState().openProject(recent[0].id)}
            title={recent[0] ? `Open ${recent[0].name}` : 'No saved projects yet'}
          >
            <History size={15} /> Open Recent Project
          </button>
          <StudioLink to="design" className={buttonClass('secondary', 'sm')} before={() => useProjects.getState().setView('templates')}>
            <LayoutTemplate size={15} /> Browse Templates ({TEMPLATES.length})
          </StudioLink>
        </section>

        <section id="recent" aria-labelledby="recent-title" className="mt-14 scroll-mt-6">
          <div className="flex items-end justify-between gap-4">
            <h2 id="recent-title" className="text-[22px] font-semibold text-white">
              Recent projects
            </h2>
            {recent.length > 0 && <p className="text-[13px] text-mist">Saved on this {repo?.kind === 'cloud' ? 'account' : 'device'}</p>}
          </div>
          {error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-[14px] text-amber-100"
            >
              <AlertCircle size={17} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
          <div className="mt-5">
            {!repo ? (
              <Spinner label="Loading your projects" />
            ) : recent.length ? (
              <ProjectGrid projects={recent} />
            ) : (
              <EmptyState
                icon={<FolderOpen size={22} />}
                title="No projects yet"
                actions={
                  <>
                    <StudioLink to="keyring" className={buttonClass('primary', 'sm')}>
                      Make a keyring
                    </StudioLink>
                    <StudioLink to="design" className={buttonClass('secondary', 'sm')}>
                      Open the Design Studio
                    </StudioLink>
                  </>
                }
              >
                Your designs appear here as you save them. A maker is the quickest start: a personalised keyring takes about a minute.
              </EmptyState>
            )}
          </div>
        </section>

        <section id="makers" aria-labelledby="makers-title" className="mt-16 scroll-mt-6">
          <h2 id="makers-title" className="text-[22px] font-semibold text-white">
            Specialist Makers
          </h2>
          <p className="mt-1 text-[14px] text-haze">Create ready-to-print models in minutes.</p>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MAKER_ENTRIES.map((m) => (
              <li key={m.id}>
                <StudioLink
                  to={m.studio}
                  className="card-night card-night-hover group flex h-full items-center gap-4 p-4"
                  testId={`maker-${m.id}`}
                  label={`Open ${m.name}`}
                >
                  <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-night-950/60">
                    <img src={m.image} alt="" className="max-h-[72px] w-auto object-contain" draggable={false} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[16px] font-semibold text-white">{m.name}</span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-haze">{m.line}</span>
                  </span>
                </StudioLink>
              </li>
            ))}
          </ul>
        </section>

        <section id="tools" aria-labelledby="tools-title" className="mt-16 scroll-mt-6">
          <h2 id="tools-title" className="text-[22px] font-semibold text-white">
            Design Tools
          </h2>
          <p className="mt-1 text-[14px] text-haze">Focused tools inside the Design Studio.</p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TOOL_ENTRIES.map((t) => (
              <li key={t.id}>
                {t.studio ? (
                  <StudioLink to={t.studio} className="card-night card-night-hover flex h-full flex-col p-4">
                    <span className="text-[15px] font-semibold text-white">{t.name}</span>
                    <span className="mt-1 flex-1 text-[13px] leading-snug text-haze">{t.line}</span>
                    <span className="mt-3 text-[12px] font-medium text-electric-300">{t.where}</span>
                  </StudioLink>
                ) : (
                  <div className="card-night flex h-full flex-col p-4 opacity-70">
                    <span className="text-[15px] font-semibold text-white">{t.name}</span>
                    <span className="mt-1 flex-1 text-[13px] leading-snug text-haze">{t.line}</span>
                    <span className="mt-3 text-[12px] font-medium text-mist">Coming soon</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function ProjectGrid({ projects }: { projects: ProjectMeta[] }) {
  const [confirm, setConfirm] = useState<ProjectMeta | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="recent-projects">
        {projects.slice(0, 12).map((p) => {
          const ws = workspaceOf(p);
          return (
            <li key={p.id} className="card-night flex flex-col overflow-hidden" data-testid="project-card" data-project={p.id}>
              <button
                type="button"
                className="block aspect-[4/3] w-full overflow-hidden bg-night-950/60"
                onClick={() => void run(p.id, () => useProjects.getState().openProject(p.id))}
                aria-label={`Open ${p.name}`}
              >
                {p.thumbnail ? (
                  <img src={p.thumbnail} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-mist">
                    <Box size={34} aria-hidden />
                  </span>
                )}
              </button>
              <div className="flex flex-1 flex-col p-3.5">
                <p className="truncate text-[15px] font-semibold text-white" title={p.name}>
                  {p.name}
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-[12px] text-mist">
                  <span className="rounded-md bg-violet/15 px-1.5 py-0.5 font-medium text-violet-300" data-testid="project-workspace">
                    {WORKSPACE_LABEL[ws] ?? ws}
                  </span>
                  {fmtDate(p.updatedAt)}
                </p>
                <div className="mt-3 flex items-center gap-1">
                  <button
                    type="button"
                    className={buttonClass('secondary', 'sm', 'flex-1')}
                    disabled={busy === p.id}
                    onClick={() => void run(p.id, () => useProjects.getState().openProject(p.id))}
                  >
                    Open
                  </button>
                  {ws !== 'design' && (
                    <button
                      type="button"
                      className="rounded-lg p-2 text-haze hover:bg-white/10 hover:text-white"
                      aria-label={`Open a copy of ${p.name} in the Design Studio`}
                      title="Open a copy in the Design Studio"
                      onClick={() => void run(p.id, () => useProjects.getState().copyToDesign(p.id))}
                    >
                      <PencilRuler size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-lg p-2 text-haze hover:bg-white/10 hover:text-white"
                    aria-label={`Duplicate ${p.name}`}
                    title="Duplicate"
                    onClick={() => void run(p.id, () => useProjects.getState().duplicate(p.id))}
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    type="button"
                    className="rounded-lg p-2 text-haze hover:bg-red-500/15 hover:text-red-300"
                    aria-label={`Delete ${p.name}`}
                    title="Delete"
                    onClick={() => setConfirm(p)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {confirm && (
        <ConfirmDialog
          title={`Delete “${confirm.name}”?`}
          confirmLabel="Delete project"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const id = confirm.id;
            setConfirm(null);
            void run(id, () => useProjects.getState().remove(id));
          }}
        >
          The project and its version history are removed from this device. This can’t be undone.
        </ConfirmDialog>
      )}
    </>
  );
}
