import { Shapes, Type, Wrench, Ruler, Grid3x3, Package } from 'lucide-react';

export type LeftPanel = 'shapes' | 'workplane';

const ITEMS: { id?: LeftPanel; label: string; Icon: typeof Shapes; note?: string }[] = [
  { id: 'shapes', label: 'Shapes', Icon: Shapes },
  { id: 'workplane', label: 'Workplane', Icon: Grid3x3 },
  { label: 'Text', Icon: Type, note: 'Phase 3' },
  { label: 'Tools', Icon: Wrench, note: 'Phase 3' },
  { label: 'Measure', Icon: Ruler, note: 'Phase 3' },
  { label: 'Assets', Icon: Package, note: 'Phase 4' },
];

export function LeftRail({ panel, onChange }: { panel: LeftPanel; onChange: (p: LeftPanel) => void }) {
  return (
    <nav className="flex w-[76px] shrink-0 flex-col items-center gap-1 border-r border-line bg-white py-3" aria-label="Tools">
      {ITEMS.map(({ id, label, Icon, note }) => {
        const active = id === panel;
        return (
          <button
            key={label}
            type="button"
            disabled={!id}
            onClick={() => id && onChange(id)}
            title={note ? `${label} — coming in ${note}` : label}
            aria-current={active ? 'true' : undefined}
            className={`relative flex w-[64px] flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] font-medium transition-colors ${
              active ? 'bg-brand-50 text-brand' : id ? 'text-[#475467] hover:bg-canvas' : 'text-[#475467] opacity-45'
            }`}
          >
            {active && <span className="absolute -left-1.5 top-2 bottom-2 w-[3px] rounded-full bg-brand" />}
            <Icon size={22} strokeWidth={1.8} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
