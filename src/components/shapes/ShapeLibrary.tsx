import { useMemo, useState } from 'react';
import { Package, PencilRuler } from 'lucide-react';
import { useSketchSession } from '@/components/sketch/sketchSession';
import { Modal, primaryBtn, secondaryBtn } from '@/components/ui/Modal';
import { NumberField } from '@/components/ui/NumberField';
import { buildBoxAndLid, DEFAULT_BOX_LID, type BoxLidOptions } from '@/templates/generators';
import { initKernel } from '@/cad/kernel/kernel';
import { ChevronDown, Search } from 'lucide-react';
import { LIBRARY_SHAPES } from '@/cad/shapeRegistry';
import { useEditor } from '@/store/editorStore';
import { renderShapeThumbnails } from './thumbnails';
import { SHAPE_DRAG_MIME } from '@/viewport/Viewport';

/** Left-hand shape library: click to add, or drag onto the workplane. */
export function ShapeLibrary() {
  const addShape = useEditor((s) => s.addShape);
  const thumbs = useMemo(() => renderShapeThumbnails(), []);
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const shapes = LIBRARY_SHAPES.filter((s) => s.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-line bg-white" aria-label="Shape library" data-tour="library">
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
                  <img
                    src={thumbs[s.type]}
                    alt=""
                    draggable={false}
                    className="h-12 w-12 object-contain transition-transform group-hover:scale-105"
                  />
                ) : (
                  <span className="h-12 w-12 rounded-lg" style={{ background: s.defaultColor }} />
                )}
                <span className="text-center text-[12px] font-medium leading-tight text-[#344054]">{s.label}</span>
              </button>
            ))}
            {'text'.includes(query.trim().toLowerCase()) && (
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(SHAPE_DRAG_MIME, 'text:Text');
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => void useEditor.getState().addText('Text')}
                title="Add Text — click, or drag onto the workplane"
                className="group flex aspect-[0.92] flex-col items-center justify-center gap-1 rounded-xl border border-transparent bg-canvas p-1.5 transition-all hover:border-brand/30 hover:bg-brand-50 hover:shadow-sm active:scale-[0.97]"
              >
                <span className="flex h-12 w-12 items-center justify-center text-[34px] font-extrabold leading-none text-brand drop-shadow-[0_2px_0_#1d4ed8] transition-transform group-hover:scale-105">
                  A
                </span>
                <span className="text-center text-[12px] font-medium leading-tight text-[#344054]">Text</span>
              </button>
            )}
            {!shapes.length && <p className="col-span-3 py-6 text-center text-[13px] text-muted">No shapes match “{query}”.</p>}
          </div>
        )}
        <Generators />
        <div className="mt-4 rounded-xl border border-dashed border-line p-3 text-[12px] leading-relaxed text-muted">
          <span className="font-semibold text-[#344054]">Tip:</span> press <kbd className="rounded border border-line bg-white px-1">H</kbd>{' '}
          to turn a shape into a hole, then use <strong>Combine</strong> to cut it.
        </div>
      </div>
    </aside>
  );
}

/** Generators: parts built for you from a few sizes, as ordinary editable shapes. */
function Generators() {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-5" aria-labelledby="generators-heading">
      <h3 id="generators-heading" className="mb-2 text-[13px] font-semibold text-ink">
        Generators
      </h3>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-line p-3 text-left hover:border-brand hover:bg-brand-50"
      >
        <Package size={22} className="shrink-0 text-brand" />
        <span>
          <span className="block text-[13px] font-semibold text-ink">Box &amp; Lid</span>
          <span className="block text-[12px] text-muted">A box and a lid that fits, to your sizes</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => useSketchSession.getState().open(null)}
        className="mt-2 flex w-full items-center gap-3 rounded-xl border border-line p-3 text-left hover:border-brand hover:bg-brand-50"
        data-testid="new-sketch"
      >
        <PencilRuler size={22} className="shrink-0 text-brand" />
        <span>
          <span className="block text-[13px] font-semibold text-ink">Sketch</span>
          <span className="block text-[12px] text-muted">Draw a dimensioned outline, then extrude or revolve it</span>
        </span>
      </button>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        The Gear is in the shapes above: set its teeth and bore in the inspector.
      </p>
      {open && <BoxLidDialog onClose={() => setOpen(false)} />}
    </section>
  );
}

function BoxLidDialog({ onClose }: { onClose: () => void }) {
  const [o, setO] = useState<BoxLidOptions>(DEFAULT_BOX_LID);
  const [busy, setBusy] = useState(false);
  const field = (label: string, key: keyof BoxLidOptions, min: number, max: number, step: number, decimals = 1) => (
    <label className="text-[12px] text-muted">
      {label}
      <NumberField
        value={o[key]}
        onCommit={(v) => setO({ ...o, [key]: v })}
        min={min}
        max={max}
        step={step}
        decimals={decimals}
        suffix="mm"
        ariaLabel={`${label} (mm)`}
      />
    </label>
  );
  const make = async () => {
    setBusy(true);
    try {
      await initKernel();
      await buildBoxAndLid(useEditor.getState(), o);
      useEditor.getState().requestFrame();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Box & Lid"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={primaryBtn} onClick={() => void make()} disabled={busy}>
            Add box and lid
          </button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-muted">
        Sizes are the inside of the box. The lid’s lip sits inside with the clearance you set on each side.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {field('Inside width', 'width', 5, 400, 1, 1)}
        {field('Inside depth', 'depth', 5, 400, 1, 1)}
        {field('Inside height', 'height', 3, 400, 1, 1)}
        {field('Wall', 'wall', 0.8, 10, 0.2, 1)}
        {field('Lip depth', 'lip', 1, 50, 0.5, 1)}
        {field('Clearance', 'clearance', 0, 2, 0.05, 2)}
        {field('Corner radius', 'radius', 0, 50, 0.5, 1)}
      </div>
      <p className="mt-3 text-[12px] text-muted">Clearance depends on your printer: try 0.2 mm for a snug fit, 0.4 mm for an easy one.</p>
    </Modal>
  );
}
