import { useState, type ReactNode } from 'react';
import { ChevronDown, Wrench } from 'lucide-react';

/**
 * The one panel design shared by the feature tools (Fillet, Chamfer, Loft, Sweep): docked at the
 * left of the 3D view, beside the transform tools. The body can be folded away to see more of the
 * model; the status line and Apply / Cancel always stay visible.
 */
export function DockedPanel({
  label,
  testId,
  title,
  description,
  action,
  children,
  footer,
}: {
  /** Accessible name of the dialog. */
  label: string;
  testId: string;
  title: ReactNode;
  description: ReactNode;
  /** Optional control at the right of the title (e.g. a Fillet / Chamfer switch). */
  action?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div
      className="pointer-events-none absolute bottom-3 left-[60px] top-3 z-20 flex w-[324px] flex-col justify-start"
      role="dialog"
      aria-label={label}
      data-testid={testId}
    >
      <div className="pointer-events-auto flex max-h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-float">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-ink">
            <Wrench size={15} />
          </span>
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{title}</h2>
          {action}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Fold panel' : 'Unfold panel'}
            title={open ? 'Fold the settings away' : 'Show the settings'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-canvas hover:text-ink"
          >
            <ChevronDown size={16} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
          </button>
        </div>
        {open && (
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            <p className="px-3 pt-2.5 text-[12px] leading-snug text-muted">{description}</p>
            <div className="space-y-3 p-3">{children}</div>
          </div>
        )}
        <div className="border-t border-line p-3">{footer}</div>
      </div>
    </div>
  );
}
