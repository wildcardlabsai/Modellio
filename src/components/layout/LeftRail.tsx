import { Shapes, Type, Ruler, Grid3x3, Package } from 'lucide-react';
import { useEditor } from '@/store/editorStore';

export type LeftPanel = 'shapes' | 'text' | 'workplane';

const PANELS: { id: LeftPanel; label: string; Icon: typeof Shapes }[] = [
  { id: 'shapes', label: 'Shapes', Icon: Shapes },
  { id: 'text', label: 'Text', Icon: Type },
  { id: 'workplane', label: 'Workplane', Icon: Grid3x3 },
];

const itemCls = (active: boolean, enabled = true) =>
  `relative flex w-[64px] flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] font-medium transition-colors ${
    active ? 'bg-brand-50 text-brand' : enabled ? 'text-[#475467] hover:bg-canvas' : 'text-[#475467] opacity-45'
  }`;

export function LeftRail({ panel, onChange }: { panel: LeftPanel; onChange: (p: LeftPanel) => void }) {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  return (
    <nav className="flex w-[76px] shrink-0 flex-col items-center gap-1 border-r border-line bg-white py-3" aria-label="Tools">
      {PANELS.map(({ id, label, Icon }) => {
        const active = id === panel;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={active ? 'true' : undefined}
            className={itemCls(active)}
          >
            {active && <span className="absolute -left-1.5 top-2 bottom-2 w-[3px] rounded-full bg-brand" />}
            <Icon size={22} strokeWidth={1.8} />
            {label}
          </button>
        );
      })}
      <div className="my-1 h-px w-10 bg-line" />
      <button
        type="button"
        aria-pressed={tool === 'measure'}
        title="Measure distances (M)"
        onClick={() => setTool(tool === 'measure' ? 'select' : 'measure')}
        className={itemCls(tool === 'measure')}
      >
        <Ruler size={22} strokeWidth={1.8} />
        Measure
      </button>
      <button type="button" disabled title="Assets — coming in Phase 4" className={itemCls(false, false)}>
        <Package size={22} strokeWidth={1.8} />
        Assets
      </button>
    </nav>
  );
}
