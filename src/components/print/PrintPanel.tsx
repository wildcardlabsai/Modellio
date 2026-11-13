import { CircleAlert, CircleCheck, TriangleAlert, Loader2, Printer, RotateCcw } from 'lucide-react';
import { usePrintCheck } from './printCheck';
import { NumberField } from '@/components/ui/NumberField';
import { Toggle } from '@/components/ui/Toggle';
import { useEditor } from '@/store/editorStore';

/** Left panel: pre-print checks with 3D highlighting of problem areas. */
export function PrintPanel() {
  const { settings, report, running, stale, highlight } = usePrintCheck();
  const { setSettings, run, setHighlight } = usePrintCheck.getState();
  const setTool = useEditor((s) => s.setTool);

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-line bg-white" aria-label="Print preparation">
      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4">
        <h2 className="text-[15px] font-semibold text-ink">Prepare to print</h2>
        <p className="mt-1 text-[12px] text-muted">Find problems before you slice: overhangs, thin walls and placement.</p>

        <div className="mt-4 grid grid-cols-[1fr_96px] items-center gap-2">
          <span className="text-[13px] text-[#344054]">Max overhang</span>
          <NumberField
            ariaLabel="Maximum overhang angle"
            value={settings.overhangAngle}
            min={10}
            max={80}
            step={5}
            decimals={0}
            suffix="°"
            onCommit={(v) => setSettings({ overhangAngle: v })}
          />
          <span className="text-[13px] text-[#344054]">Min wall</span>
          <NumberField
            ariaLabel="Minimum wall thickness"
            value={settings.minWall}
            min={0.1}
            max={10}
            step={0.1}
            decimals={2}
            suffix="mm"
            onCommit={(v) => setSettings({ minWall: v })}
          />
        </div>

        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-[13px] font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {running ? <Loader2 size={16} className="animate-spin" /> : report ? <RotateCcw size={16} /> : <Printer size={16} />}
          {running ? 'Checking…' : report ? 'Check again' : 'Check printability'}
        </button>

        {report && (
          <div className="mt-4" data-testid="print-report">
            {stale && (
              <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-800">The design changed since this check.</p>
            )}
            <ul className="space-y-2">
              {report.issues.map((issue, i) => (
                <li
                  key={i}
                  className={`flex items-start gap-2 text-[12px] leading-snug ${
                    issue.level === 'error' ? 'text-red-700' : issue.level === 'warning' ? 'text-amber-700' : 'text-emerald-700'
                  }`}
                >
                  {issue.level === 'error' ? (
                    <CircleAlert size={15} className="mt-px shrink-0" />
                  ) : issue.level === 'warning' ? (
                    <TriangleAlert size={15} className="mt-px shrink-0" />
                  ) : (
                    <CircleCheck size={15} className="mt-px shrink-0" />
                  )}
                  {issue.text}
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-line pt-2">
              <Toggle label="Highlight in 3D" checked={highlight} onChange={setHighlight} />
              <p className="flex items-center gap-3 text-[11px] text-muted">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#EF4444]" /> overhang
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#F59E0B]" /> thin wall
                </span>
              </p>
            </div>
          </div>
        )}

        <div className="mt-5 rounded-xl border border-dashed border-line p-3 text-[12px] leading-relaxed text-muted">
          <span className="font-semibold text-[#344054]">Tip:</span> reduce overhangs by choosing the best face to print on.{' '}
          <button type="button" onClick={() => setTool('layflat')} className="font-semibold text-brand hover:underline">
            Lay flat (L)
          </button>{' '}
          then click a face.
        </div>
      </div>
    </aside>
  );
}
