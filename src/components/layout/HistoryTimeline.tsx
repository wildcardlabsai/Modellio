import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, History } from 'lucide-react';
import { useEditor } from '@/store/editorStore';

const KEY = 'modellio:timeline';

/**
 * The design's history as a timeline under the 3D view: every recorded operation in order.
 * Click a step to go back to just after it (or forward again); new edits from an earlier step
 * replace the steps after it, exactly like undo.
 */
export function HistoryTimeline() {
  const past = useEditor((s) => s.history.past);
  const future = useEditor((s) => s.history.future);
  const jump = useEditor((s) => s.jumpHistory);
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== 'closed';
    } catch {
      return true;
    }
  });
  const strip = useRef<HTMLOListElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, open ? 'open' : 'closed');
    } catch {
      /* not critical */
    }
  }, [open]);
  // Keep the current step in view.
  useEffect(() => {
    strip.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [past.length, future.length]);
  // `future` is stored newest-undone last; show it in the order it would be redone.
  const ahead = [...future].reverse();
  const steps = past.length + ahead.length;
  return (
    <section className="shrink-0 border-t border-line bg-panel" aria-label="History" data-testid="history-timeline">
      <div className="flex h-9 items-center gap-2 px-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-canvas"
        >
          <History size={14} /> History
          <span className="font-normal text-muted">({steps})</span>
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        {open && (
          <ol ref={strip} className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
            <li>
              <Step label="Start" state={past.length === 0 ? 'current' : 'done'} onClick={() => jump(-past.length)} />
            </li>
            {past.map((e, i) => (
              <li key={`p${i}`} className="flex items-center gap-1">
                <span className="h-px w-2 bg-line" aria-hidden />
                <Step label={e.label} state={i === past.length - 1 ? 'current' : 'done'} onClick={() => jump(i + 1 - past.length)} />
              </li>
            ))}
            {ahead.map((e, i) => (
              <li key={`f${i}`} className="flex items-center gap-1">
                <span className="h-px w-2 bg-line" aria-hidden />
                <Step label={e.label} state="undone" onClick={() => jump(i + 1)} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Step({ label, state, onClick }: { label: string; state: 'done' | 'current' | 'undone'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={state === 'current' ? 'step' : undefined}
      title={
        state === 'undone' ? `Redo up to “${label}”` : state === 'current' ? `Now: after “${label}”` : `Go back to just after “${label}”`
      }
      className={`max-w-[160px] shrink-0 truncate rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${
        state === 'current'
          ? 'border-brand bg-brand text-white'
          : state === 'done'
            ? 'border-line bg-panel text-ink-2 hover:border-brand hover:text-brand-ink'
            : 'border-dashed border-line bg-canvas text-muted hover:text-ink'
      }`}
      data-testid="history-step"
    >
      {label}
    </button>
  );
}
