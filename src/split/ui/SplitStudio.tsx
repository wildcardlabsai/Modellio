import { useEffect, useState, type DragEvent } from 'react';
import { Check, FileUp, Loader2, Lock, Sparkles, X, CircleAlert, Undo2, Redo2 } from 'lucide-react';
import { STEPS, useSplit } from '../store';
import { IconButton } from '@/components/ui/IconButton';
import { isTypingTarget } from '@/hooks/useKeyboardShortcuts';
import { LeftPanel } from './LeftPanel';
import { RightPanel } from './RightPanel';
import { SplitViewport, splitView } from './SplitViewport';
import { openSample, openSplitPicker } from './intake';

/**
 * Split Studio shell: guided stepper (Import → Split → Connect → Export), step panel,
 * 3D preview and details panel. Steps unlock as their inputs exist.
 */
export default function SplitStudio() {
  const doc = useSplit((s) => s.doc);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    (window as unknown as { modellioSplit: unknown }).modellioSplit = { store: useSplit, view: splitView };
    // Studio shortcuts: undo / redo settings.
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        useSplit.getState().undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        useSplit.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void useSplit.getState().importFile(file);
  };

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-testid="split-studio"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <Stepper />
      <ErrorBanner />
      <div className="relative flex min-h-0 flex-1">
        <LeftPanel />
        <main className="relative min-w-0 flex-1" aria-label="Preview">
          <SplitViewport />
          {!doc && <EmptyState />}
          <JobProgress />
        </main>
        <RightPanel />
      </div>
      <ImportProgress />
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand bg-brand-50/80 text-[15px] font-semibold text-brand">
          Drop the 3MF file to import it
        </div>
      )}
    </div>
  );
}

function Stepper() {
  const step = useSplit((s) => s.step);
  const doc = useSplit((s) => s.doc);
  const split = useSplit((s) => s.split);
  const connected = useSplit((s) => s.connected);
  const canUndo = useSplit((s) => s.past.length > 0);
  const canRedo = useSplit((s) => s.future.length > 0);
  // Subscribe to what canEnter depends on.
  useSplit((s) => !!s.split);
  const { setStep, canEnter, undo, redo } = useSplit.getState();
  const done: Record<string, boolean> = { import: !!doc, split: !!split?.parts.length, connect: !!connected, export: false };
  return (
    <nav className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-white px-3 sm:px-5" aria-label="Split Studio steps">
      <span className="mr-3 hidden text-[14px] font-semibold text-ink md:block">Split Studio</span>
      <ol className="flex items-center gap-1">
        {STEPS.map((s, i) => {
          const available = canEnter(s.id);
          const active = step === s.id;
          const isDone = done[s.id];
          return (
            <li key={s.id} className="flex items-center">
              {i > 0 && <span className="mx-1 h-px w-3 bg-line sm:w-5" aria-hidden />}
              <button
                type="button"
                disabled={!available}
                onClick={() => setStep(s.id)}
                aria-current={active ? 'step' : undefined}
                title={available ? undefined : s.id === 'split' ? 'Import a 3MF file first' : 'Split the model first'}
                className={`flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-medium ${
                  active ? 'bg-brand-50 text-brand' : available ? 'text-[#344054] hover:bg-[#f2f4f7]' : 'text-[#98a2b3]'
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                    isDone ? 'bg-brand text-white' : active ? 'border border-brand' : 'border border-[#d0d5dd]'
                  }`}
                  aria-hidden
                >
                  {isDone ? <Check size={12} /> : available ? i + 1 : <Lock size={10} />}
                </span>
                {s.label}
                {!available && <span className="sr-only"> (not available yet)</span>}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex-1" />
      {doc && (
        <span className="mr-2 hidden max-w-[30%] truncate text-[13px] text-muted xl:block" data-testid="split-title">
          {doc.metadata.Title || doc.fileName}
        </span>
      )}
      <IconButton label="Undo settings change" shortcut="Ctrl+Z" disabled={!canUndo} onClick={undo}>
        <Undo2 size={17} />
      </IconButton>
      <IconButton label="Redo settings change" shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}>
        <Redo2 size={17} />
      </IconButton>
    </nav>
  );
}

function JobProgress() {
  const job = useSplit((s) => s.job);
  if (!job) return null;
  const pct = Math.round(job.fraction * 100);
  return (
    <div
      className="absolute left-1/2 top-4 z-20 flex w-[min(92%,360px)] -translate-x-1/2 items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-float"
      role="status"
      data-testid="split-job"
    >
      <Loader2 size={16} className="shrink-0 animate-spin text-brand" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">
          {job.stage} · {pct}%
        </p>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#eef1f6]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={job.stage}
        >
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <button
        type="button"
        onClick={() => useSplit.getState().cancelJob()}
        className="rounded-md px-2 py-1 text-[12px] font-medium text-[#344054] hover:bg-[#f2f4f7]"
      >
        Cancel
      </button>
    </div>
  );
}

function ErrorBanner() {
  const error = useSplit((s) => s.error);
  const dismiss = useSplit((s) => s.dismissError);
  if (!error) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2.5 text-[13px] text-red-800"
      data-testid="split-error"
    >
      <CircleAlert size={16} className="mt-0.5 shrink-0" />
      <p className="flex-1">{error}</p>
      <button type="button" onClick={dismiss} className="rounded p-0.5 hover:bg-red-100" aria-label="Dismiss error">
        <X size={15} />
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div
        className="w-full max-w-md rounded-2xl border-2 border-dashed border-[#c9d1de] bg-white/90 p-8 text-center shadow-panel"
        data-testid="split-empty"
      >
        <FileUp size={32} className="mx-auto mb-3 text-brand" />
        <h2 className="mb-1 text-[16px] font-semibold text-ink">Import a multi-colour 3MF</h2>
        <p className="mb-5 text-[13px] leading-relaxed text-muted">
          Drop a .3mf file here, or choose one. Files stay on this device — nothing is uploaded.
        </p>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <button
            type="button"
            onClick={openSplitPicker}
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-[14px] font-semibold text-white hover:bg-brand-600"
          >
            <FileUp size={16} /> Choose 3MF file
          </button>
          <button
            type="button"
            onClick={openSample}
            className="flex h-10 items-center justify-center gap-2 rounded-lg border border-line px-4 text-[14px] font-medium text-[#344054] hover:bg-[#f9fafb]"
          >
            <Sparkles size={16} /> Try a sample
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportProgress() {
  const importing = useSplit((s) => s.importing);
  const cancel = useSplit((s) => s.cancelImport);
  if (!importing) return null;
  const pct = Math.round(importing.fraction * 100);
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-navy/30" data-testid="split-progress">
      <div role="status" aria-live="polite" className="w-[min(92vw,380px)] rounded-2xl bg-white p-5 shadow-float">
        <div className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-ink">
          <Loader2 size={16} className="animate-spin text-brand" /> Importing {importing.fileName}
        </div>
        <p className="mb-3 text-[12px] text-muted">
          {importing.stage} · {pct}%
        </p>
        <div
          className="mb-4 h-2 overflow-hidden rounded-full bg-[#eef1f6]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Import progress"
        >
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <button
          type="button"
          onClick={cancel}
          className="h-9 w-full rounded-lg border border-line text-[13px] font-medium text-[#344054] hover:bg-[#f9fafb]"
        >
          Cancel import
        </button>
      </div>
    </div>
  );
}
