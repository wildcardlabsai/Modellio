import { useState, type ReactNode } from 'react';
import { Check, CircleDot, CircleHelp, Loader2, Menu as MenuIcon, Redo2, Save, Undo2 } from 'lucide-react';
import { ProjectMenu, type ProjectActions } from '@/components/projects/ProjectMenu';
import { Popover } from '@/components/ui/Popover';

/**
 * The shared header for makers: name, the maker's own view controls, undo/redo, help and
 * Save project. Navy, so every maker reads as part of the same platform while keeping its
 * own workspace below.
 */
export function MakerHeader({
  title,
  testId,
  children,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  help,
  project,
}: {
  title: string;
  testId: string;
  children?: ReactNode;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  help: ReactNode;
  /** The maker's project controls (from `useMakerProject`). */
  project?: {
    /** The saved project's name, or null for a design not saved yet. */
    name: string | null;
    dirty: boolean;
    busy: boolean;
    actions: ProjectActions;
    save: () => Promise<boolean>;
  };
}) {
  return (
    <div
      className="surface-night flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-night-line bg-night-900 px-3 py-1.5 text-fog sm:px-5"
      data-testid={`${testId}-header`}
    >
      {project && (
        <ProjectMenu
          actions={project.actions}
          trigger={({ open, toggle }) => (
            <button
              type="button"
              aria-label="File menu"
              aria-expanded={open}
              onClick={toggle}
              title="Project: new, open, save…"
              className={iconBtn}
            >
              <MenuIcon size={18} />
            </button>
          )}
        />
      )}
      <h1 className="text-[14px] font-semibold text-white">{title}</h1>
      {project && (
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-haze" data-testid="maker-project">
          <span className="max-w-[180px] truncate">{project.name ?? 'Not saved yet'}</span>
          {project.dirty && (
            <span className="flex items-center gap-1 text-amber-300" title="Unsaved changes" data-testid="maker-unsaved">
              <CircleDot size={13} />
              <span className="sr-only">Unsaved changes</span>
            </span>
          )}
        </span>
      )}
      {children}
      <div className="flex-1" />
      {onUndo && (
        <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)" className={iconBtn}>
          <Undo2 size={17} />
        </button>
      )}
      {onRedo && (
        <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" className={iconBtn}>
          <Redo2 size={17} />
        </button>
      )}
      <Popover
        align="right"
        trigger={({ open, toggle }) => (
          <button type="button" onClick={toggle} aria-expanded={open} aria-label={`${title} help`} title="Help" className={iconBtn}>
            <CircleHelp size={17} />
          </button>
        )}
      >
        {() => (
          <div className="w-72 text-[13px] leading-relaxed text-ink-2" role="dialog" aria-label={`${title} help`}>
            {help}
          </div>
        )}
      </Popover>
      {project && <SaveButton project={project} />}
    </div>
  );
}

const iconBtn =
  'flex h-9 w-9 items-center justify-center rounded-lg text-haze hover:bg-white/10 hover:text-white disabled:opacity-35 disabled:hover:bg-transparent';

function SaveButton({ project }: { project: NonNullable<Parameters<typeof MakerHeader>[0]['project']> }) {
  const [done, setDone] = useState(false);
  const label = project.busy ? 'Saving…' : done ? 'Saved' : 'Save';
  const icon = project.busy ? <Loader2 size={15} className="animate-spin" /> : done ? <Check size={15} /> : <Save size={15} />;
  return (
    <button
      type="button"
      className="btn-gradient inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold text-white disabled:opacity-60"
      disabled={project.busy}
      title={project.name ? `Save “${project.name}” (Ctrl+S)` : 'Save this design (Ctrl+S)'}
      onClick={async () => {
        if (await project.save()) {
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        }
      }}
      data-testid="maker-save"
    >
      {icon} {label}
    </button>
  );
}

/** A segmented control for the navy header (radio buttons). */
export function HeaderTabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-night-950/70 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`whitespace-nowrap rounded-lg px-3 py-1 text-[13px] font-medium transition-colors ${
            value === o.value ? 'bg-gradient-to-r from-violet-600 to-electric text-white shadow' : 'text-haze hover:text-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
