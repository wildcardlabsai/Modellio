import { useState, type ReactNode } from 'react';
import { Check, CircleHelp, Loader2, Redo2, Save, Undo2 } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { useEditor } from '@/store/editorStore';

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
  save,
}: {
  title: string;
  testId: string;
  children?: ReactNode;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  help: ReactNode;
  /** Present when the maker can save its design as a project. */
  save?: {
    /** The saved project's name, if this design is already a project. */
    project: { id: string; name: string } | null;
    suggestedName: () => string;
    run: (name: string) => Promise<void>;
  };
}) {
  return (
    <div
      className="surface-night flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-night-line bg-night-900 px-3 py-1.5 text-fog sm:px-5"
      data-testid={`${testId}-header`}
    >
      <h1 className="text-[14px] font-semibold text-white">{title}</h1>
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
          <div className="w-72 text-[13px] leading-relaxed text-[#344054]" role="dialog" aria-label={`${title} help`}>
            {help}
          </div>
        )}
      </Popover>
      {save && <SaveButton {...save} />}
    </div>
  );
}

const iconBtn =
  'flex h-9 w-9 items-center justify-center rounded-lg text-haze hover:bg-white/10 hover:text-white disabled:opacity-35 disabled:hover:bg-transparent';

function SaveButton({ project, suggestedName, run }: NonNullable<Parameters<typeof MakerHeader>[0]['save']>) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [name, setName] = useState('');
  const go = async (n: string, close?: () => void) => {
    setBusy(true);
    try {
      await run(n);
      close?.();
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch (e) {
      useEditor.getState().notify(`Could not save: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  const label = busy ? 'Saving…' : done ? 'Saved' : 'Save project';
  const icon = busy ? <Loader2 size={15} className="animate-spin" /> : done ? <Check size={15} /> : <Save size={15} />;
  const cls =
    'btn-gradient inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold text-white disabled:opacity-60';
  // Already a project: save straight over it.
  if (project)
    return (
      <button
        type="button"
        className={cls}
        disabled={busy}
        onClick={() => void go(project.name)}
        title={`Save “${project.name}”`}
        data-testid="maker-save"
      >
        {icon} {label}
      </button>
    );
  return (
    <Popover
      align="right"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          className={cls}
          aria-expanded={open}
          onClick={() => {
            if (!open) setName(suggestedName());
            toggle();
          }}
          data-testid="maker-save"
        >
          {icon} {label}
        </button>
      )}
    >
      {(close) => (
        <form
          className="w-64"
          onSubmit={(e) => {
            e.preventDefault();
            void go(name, close);
          }}
        >
          <label className="text-[12px] font-medium text-[#344054]">
            Project name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={80}
              className="mt-1 h-9 w-full rounded-md border border-line px-2 text-[14px] text-ink outline-none focus:border-brand"
            />
          </label>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Saved on this device. Reopen it from the dashboard, here or in the Design Studio.
          </p>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="mt-2 h-9 w-full rounded-lg bg-brand text-[13px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          >
            Save project
          </button>
        </form>
      )}
    </Popover>
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
