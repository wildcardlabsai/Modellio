import { Shapes, Type, Wrench, Ruler, Grid3x3, Package } from 'lucide-react';

const ITEMS = [
  { label: 'Shapes', Icon: Shapes, active: true },
  { label: 'Text', Icon: Type, note: 'Phase 3' },
  { label: 'Tools', Icon: Wrench, note: 'Phase 3' },
  { label: 'Measure', Icon: Ruler, note: 'Phase 3' },
  { label: 'Workplane', Icon: Grid3x3, note: 'Phase 2' },
  { label: 'Assets', Icon: Package, note: 'Phase 4' },
];

export function LeftRail() {
  return (
    <nav className="flex w-[76px] shrink-0 flex-col items-center gap-1 border-r border-line bg-white py-3" aria-label="Tools">
      {ITEMS.map(({ label, Icon, active, note }) => (
        <button
          key={label}
          type="button"
          disabled={!active}
          title={note ? `${label} — coming in ${note}` : label}
          aria-current={active ? 'true' : undefined}
          className={`relative flex w-[64px] flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] font-medium transition-colors ${
            active ? 'bg-brand-50 text-brand' : 'text-[#475467] opacity-45'
          }`}
        >
          {active && <span className="absolute -left-1.5 top-2 bottom-2 w-[3px] rounded-full bg-brand" />}
          <Icon size={22} strokeWidth={1.8} />
          {label}
        </button>
      ))}
    </nav>
  );
}
