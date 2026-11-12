import { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { SHAPES } from '@/cad/shapeRegistry';
import { useEditor } from '@/store/editorStore';
import { renderShapeThumbnails } from './thumbnails';
import { SHAPE_DRAG_MIME } from '@/viewport/Viewport';

/** Left-hand shape library: click to add, or drag onto the workplane. */
export function ShapeLibrary() {
  const addShape = useEditor((s) => s.addShape);
  const thumbs = useMemo(() => renderShapeThumbnails(), []);
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const shapes = SHAPES.filter((s) => s.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-line bg-white" aria-label="Shape library">
      <div className="px-4 pb-2 pt-4">
        <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 text-muted focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shapes"
            aria-label="Search shapes"
            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-muted"
          />
        </label>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 pb-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between py-2.5 text-[15px] font-semibold text-ink"
        >
          Basic Shapes
          <ChevronDown size={17} className={`text-muted transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        {open && (
          <div className="grid grid-cols-3 gap-2">
            {shapes.map((s) => (
              <button
                key={s.type}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(SHAPE_DRAG_MIME, s.type);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => addShape(s.type)}
                title={`Add ${s.label} — click, or drag onto the workplane`}
                className="group flex aspect-[0.92] flex-col items-center justify-center gap-1 rounded-xl border border-transparent bg-canvas p-1.5 transition-all hover:border-brand/30 hover:bg-brand-50 hover:shadow-sm active:scale-[0.97]"
              >
                {thumbs[s.type] ? (
                  <img src={thumbs[s.type]} alt="" draggable={false} className="h-12 w-12 object-contain transition-transform group-hover:scale-105" />
                ) : (
                  <span className="h-12 w-12 rounded-lg" style={{ background: s.defaultColor }} />
                )}
                <span className="text-center text-[12px] font-medium leading-tight text-[#344054]">{s.label}</span>
              </button>
            ))}
            {!shapes.length && <p className="col-span-3 py-6 text-center text-[13px] text-muted">No shapes match “{query}”.</p>}
          </div>
        )}
        <div className="mt-4 rounded-xl border border-dashed border-line p-3 text-[12px] leading-relaxed text-muted">
          <span className="font-semibold text-[#344054]">Coming next:</span> 3D text, holes &amp; Boolean combine, imported STL/OBJ parts.
        </div>
      </div>
    </aside>
  );
}
