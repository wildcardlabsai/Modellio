import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalSpaceAround,
  type LucideIcon,
} from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import type { AlignMode, Axis } from '@/types/document';

const ROWS: { axis: Axis; name: string; cls: string; modes: [AlignMode, string, LucideIcon][] }[] = [
  {
    axis: 0,
    name: 'X',
    cls: 'text-axis-x',
    modes: [
      ['min', 'Left', AlignStartVertical],
      ['center', 'Centre', AlignCenterVertical],
      ['max', 'Right', AlignEndVertical],
    ],
  },
  {
    axis: 1,
    name: 'Y',
    cls: 'text-axis-y',
    modes: [
      ['min', 'Front', AlignStartVertical],
      ['center', 'Centre', AlignCenterVertical],
      ['max', 'Back', AlignEndVertical],
    ],
  },
  {
    axis: 2,
    name: 'Z',
    cls: 'text-axis-z',
    modes: [
      ['min', 'Bottom', AlignEndHorizontal],
      ['center', 'Middle', AlignCenterHorizontal],
      ['max', 'Top', AlignStartHorizontal],
    ],
  },
];

export function AlignMenu({ onDone }: { onDone: () => void }) {
  const count = useEditor((s) => s.selection.length);
  const { alignSelected, distributeSelected } = useEditor.getState();
  const toPlate = count === 1;

  return (
    <div className="w-[300px] max-w-full">
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
        {toPlate ? 'Align to workplane' : `Align ${count} objects`}
      </p>
      <div className="space-y-1.5">
        {ROWS.map((row) => (
          <div key={row.axis} className="grid grid-cols-[22px_1fr_1fr_1fr] items-center gap-1.5">
            <span className={`text-[12px] font-bold ${row.cls}`}>{row.name}</span>
            {row.modes.map(([mode, label, Icon]) => (
              <button
                key={mode}
                type="button"
                aria-label={`Align ${label} (${row.name})`}
                onClick={() => {
                  alignSelected(row.axis, mode);
                  onDone();
                }}
                className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line text-[12px] font-medium text-[#344054] hover:border-brand/40 hover:bg-brand-50 hover:text-brand"
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Distribute evenly</p>
        <div className="grid grid-cols-3 gap-1.5">
          {(['X', 'Y', 'Z'] as const).map((n, i) => (
            <button
              key={n}
              type="button"
              disabled={count < 3}
              title={count < 3 ? 'Select three or more objects' : undefined}
              onClick={() => {
                distributeSelected(i as Axis);
                onDone();
              }}
              className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line text-[12px] font-medium text-[#344054] hover:bg-brand-50 hover:text-brand disabled:opacity-40"
            >
              <AlignHorizontalSpaceAround size={15} className={i === 2 ? 'rotate-90' : ''} />
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MirrorMenu({ onDone }: { onDone: () => void }) {
  const { mirrorSelected } = useEditor.getState();
  return (
    <div className="w-[220px] max-w-full">
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Mirror across</p>
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            ['X', 'text-axis-x'],
            ['Y', 'text-axis-y'],
            ['Z', 'text-axis-z'],
          ] as const
        ).map(([n, cls], i) => (
          <button
            key={n}
            type="button"
            aria-label={`Mirror ${n}`}
            onClick={() => {
              mirrorSelected(i as Axis);
              onDone();
            }}
            className="flex h-10 flex-col items-center justify-center rounded-lg border border-line text-[13px] font-bold hover:border-brand/40 hover:bg-brand-50"
          >
            <span className={cls}>{n}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted">Flips the selection about its centre. Geometry is truly reflected.</p>
    </div>
  );
}
