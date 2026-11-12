import { Grid3x3, Magnet } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import { NumberField } from '@/components/ui/NumberField';
import { Toggle } from '@/components/ui/Toggle';

/** Common build-plate sizes (mm). */
const PRESETS: { label: string; size: [number, number] }[] = [
  { label: 'Default', size: [200, 200] },
  { label: '180 × 180', size: [180, 180] },
  { label: '220 × 220', size: [220, 220] },
  { label: '250 × 210', size: [250, 210] },
  { label: '256 × 256', size: [256, 256] },
  { label: '300 × 300', size: [300, 300] },
];

export function WorkplanePanel() {
  const size = useEditor((s) => s.doc.settings.workplane);
  const showGrid = useEditor((s) => s.showGrid);
  const snap = useEditor((s) => s.snap);
  const { setWorkplaneSize, setShowGrid, setSnap } = useEditor.getState();

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-line bg-white" aria-label="Workplane settings">
      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4">
        <h2 className="text-[15px] font-semibold text-ink">Workplane</h2>
        <p className="mt-1 text-[12px] text-muted">Match the plate to your printer's build area.</p>

        <h3 className="mb-2 mt-5 text-[13px] font-semibold text-ink">Plate size (mm)</h3>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="W" labelClass="text-axis-x" ariaLabel="Workplane width" value={size[0]} min={20} max={2000} step={10} onCommit={(v) => setWorkplaneSize([v, size[1]])} />
          <NumberField label="D" labelClass="text-axis-y" ariaLabel="Workplane depth" value={size[1]} min={20} max={2000} step={10} onCommit={(v) => setWorkplaneSize([size[0], v])} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => {
            const active = p.size[0] === size[0] && p.size[1] === size[1];
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => setWorkplaneSize(p.size)}
                className={`rounded-lg border px-2 py-1.5 text-[12px] font-medium ${
                  active ? 'border-brand bg-brand-50 text-brand' : 'border-line text-[#344054] hover:bg-canvas'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <h3 className="mb-1 mt-5 text-[13px] font-semibold text-ink">Display</h3>
        <Toggle label="Show grid" icon={<Grid3x3 size={15} className="text-muted" />} checked={showGrid} onChange={setShowGrid} />

        <h3 className="mb-1 mt-4 text-[13px] font-semibold text-ink">Snapping</h3>
        <Toggle label="Snap to grid" icon={<Magnet size={15} className="text-muted" />} checked={snap.enabled} onChange={(v) => setSnap({ enabled: v })} />
        <div className="mt-2 grid grid-cols-[1fr_110px] items-center gap-2">
          <span className="text-[13px] text-[#344054]">Move step</span>
          <NumberField ariaLabel="Move snap step" value={snap.translate} min={0.01} max={100} step={0.5} suffix="mm" disabled={!snap.enabled} onCommit={(v) => setSnap({ translate: v })} />
          <span className="text-[13px] text-[#344054]">Rotate step</span>
          <NumberField ariaLabel="Rotate snap step" value={snap.rotate} min={0.1} max={180} step={5} decimals={1} suffix="°" disabled={!snap.enabled} onCommit={(v) => setSnap({ rotate: v })} />
        </div>
      </div>
    </aside>
  );
}
