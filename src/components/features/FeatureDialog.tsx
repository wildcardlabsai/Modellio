import { useEffect } from 'react';
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import { NumberField } from '@/components/ui/NumberField';
import { useFeatureTool, type FeatureKind } from './featureTool';

const COPY: Record<FeatureKind, { title: string; hint: string; field: string }> = {
  fillet: { title: 'Fillet', hint: 'Rounds the chosen edges with an exact radius.', field: 'Radius' },
  chamfer: { title: 'Chamfer', hint: 'Bevels the chosen edges with a flat cut.', field: 'Distance' },
};

/** The Fillet / Chamfer panel shown over the 3D view while the tool is active. */
export function FeatureDialog() {
  const session = useFeatureTool((s) => s.session);
  const t = useFeatureTool.getState();

  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea')) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        useFeatureTool.getState().cancel();
      } else if (e.key === 'Enter') useFeatureTool.getState().apply();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [session]);

  if (!session) return null;
  const c = COPY[session.kind];
  const p = session.preview;
  const n = session.edges.length;
  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-3 z-20 w-[340px] -translate-x-1/2 rounded-xl border border-line bg-white p-3 shadow-float"
      role="dialog"
      aria-label={`${c.title} edges`}
      data-testid="feature-dialog"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-ink">{session.editingOpId ? `Edit ${c.title.toLowerCase()}` : c.title}</h2>
        <div role="radiogroup" aria-label="Operation" className="flex rounded-lg bg-canvas p-0.5">
          {(['fillet', 'chamfer'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={session.kind === k}
              onClick={() => t.setKind(k)}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${session.kind === k ? 'bg-white text-brand shadow-sm' : 'text-[#344054]'}`}
            >
              {COPY[k].title}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[12px] leading-snug text-muted">
        {c.hint} Click edges on the part to choose them (amber: under the cursor, red: chosen). Edges that continue smoothly from a chosen
        edge are included too.
      </p>
      <div className="mt-2 grid grid-cols-[1fr_130px] items-center gap-2">
        <span className="text-[13px] font-medium text-[#344054]" data-testid="feature-edge-count">
          {n ? `${n} edge${n === 1 ? '' : 's'} selected` : 'No edges selected'}
        </span>
        <NumberField
          ariaLabel={`${c.field} (mm)`}
          value={session.value}
          onCommit={t.setValue}
          min={0.05}
          max={1000}
          step={0.5}
          decimals={2}
          suffix="mm"
        />
      </div>
      <p
        className={`mt-2 flex min-h-[20px] items-start gap-1.5 text-[12px] ${p.state === 'error' ? 'text-red-700' : p.state === 'ok' ? 'text-emerald-700' : 'text-muted'}`}
        role="status"
        data-testid="feature-status"
      >
        {p.state === 'building' && (
          <>
            <Loader2 size={14} className="mt-px shrink-0 animate-spin" /> Building preview…
          </>
        )}
        {p.state === 'ok' && (
          <>
            <CircleCheck size={14} className="mt-px shrink-0" /> Preview ready · volume {(p.build!.volume / 1000).toFixed(3)} cm³
          </>
        )}
        {p.state === 'error' && (
          <>
            <CircleAlert size={14} className="mt-px shrink-0" /> {p.message}
          </>
        )}
        {p.state === 'idle' && (n ? 'Set the size to preview.' : 'Pick at least one edge.')}
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={t.cancel}
          className="h-8 rounded-lg border border-line px-3 text-[13px] font-medium text-[#344054] hover:bg-canvas"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={t.apply}
          disabled={p.state !== 'ok'}
          className="h-8 rounded-lg bg-brand px-4 text-[13px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          data-testid="feature-apply"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
