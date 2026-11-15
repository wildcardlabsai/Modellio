import { Shapes, Type, Ruler, Grid3x3, Package, Printer, Sparkles, PencilRuler } from 'lucide-react';
import { useSketchSession } from '@/components/sketch/sketchSession';
import { useEditor } from '@/store/editorStore';

export type LeftPanel = 'shapes' | 'text' | 'assets' | 'workplane' | 'print' | 'assistant';

const PANELS: { id: LeftPanel; label: string; Icon: typeof Shapes }[] = [
  { id: 'shapes', label: 'Shapes', Icon: Shapes },
  { id: 'text', label: 'Text', Icon: Type },
  { id: 'assets', label: 'Assets', Icon: Package },
  { id: 'workplane', label: 'Workplane', Icon: Grid3x3 },
  { id: 'print', label: 'Print', Icon: Printer },
  { id: 'assistant', label: 'Assistant', Icon: Sparkles },
];

const itemCls = (active: boolean, enabled = true) =>
  `relative flex w-[64px] flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] font-medium transition-colors ${
    active
      ? 'bg-brand text-white shadow-[0_6px_18px_-6px_rgb(124_58_237/0.8)]'
      : enabled
        ? 'text-ink-3 hover:bg-canvas hover:text-ink'
        : 'text-ink-3 opacity-45'
  }`;

export function LeftRail({ panel, onChange }: { panel: LeftPanel; onChange: (p: LeftPanel) => void }) {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  return (
    <nav className="flex w-[76px] shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-3" aria-label="Tools">
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
            <Icon size={22} strokeWidth={1.8} />
            {label}
          </button>
        );
      })}
      <div className="my-1 h-px w-10 bg-line" />
      <button
        type="button"
        title="Draw a sketch and make it solid"
        onClick={() => useSketchSession.getState().open(null)}
        className={itemCls(false)}
      >
        <PencilRuler size={22} strokeWidth={1.8} />
        Sketch
      </button>
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
    </nav>
  );
}
