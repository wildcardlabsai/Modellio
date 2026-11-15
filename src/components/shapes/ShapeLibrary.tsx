import { useMemo, useState, type ReactNode } from 'react';
import {
  Box as BoxIcon,
  ChevronDown,
  Cookie,
  ExternalLink,
  ImageUp,
  Layers3,
  LayoutTemplate,
  Package,
  PencilRuler,
  Route,
  RotateCw,
  Search,
  Shapes as ShapesIcon,
  Sparkles,
  Type,
  Wand2,
} from 'lucide-react';
import { useSketchSession } from '@/components/sketch/sketchSession';
import { useSolidBuilder } from '@/components/features/solidBuilder';
import { openMeshPicker } from '@/components/files/fileIntake';
import { Modal, primaryBtn, secondaryBtn } from '@/components/ui/Modal';
import { NumberField } from '@/components/ui/NumberField';
import { buildBoxAndLid, DEFAULT_BOX_LID, type BoxLidOptions } from '@/templates/generators';
import { initKernel } from '@/cad/kernel/kernel';
import { LIBRARY_SHAPES } from '@/cad/shapeRegistry';
import { useEditor } from '@/store/editorStore';
import { useProjects } from '@/store/projectStore';
import { useStudio } from '@/app/studio';
import { useAssets } from '@/assets/library';
import type { PrimitiveType } from '@/types/document';
import type { LeftPanel } from '@/components/layout/LeftRail';
import { renderShapeThumbnails } from './thumbnails';
import { SHAPE_DRAG_MIME } from '@/viewport/Viewport';

const BASIC: PrimitiveType[] = ['box', 'cylinder', 'sphere', 'cone', 'pyramid', 'roof', 'torus', 'tube', 'wedge'];
const ADVANCED: PrimitiveType[] = ['halfSphere', 'polygon', 'star', 'capsule', 'paraboloid'];

/** A non-shape entry in the library: an action with a real destination. */
interface ActionItem {
  id: string;
  label: string;
  hint: string;
  Icon: typeof BoxIcon;
  run: () => void;
  testId?: string;
  /** Opens another part of MODELLIO (shown with an arrow). */
  external?: boolean;
}

/**
 * Left-hand library: shapes to click or drag onto the workplane, generators, text and graphics,
 * sketch-based features, your saved assets and templates. Search covers all of them.
 */
export function ShapeLibrary({ onOpenPanel }: { onOpenPanel?: (p: LeftPanel) => void }) {
  const addShape = useEditor((s) => s.addShape);
  const thumbs = useMemo(() => renderShapeThumbnails(), []);
  const [query, setQuery] = useState('');
  const [boxLid, setBoxLid] = useState(false);
  const assetCount = useAssets((s) => s.assets.length);
  const q = query.trim().toLowerCase();
  const match = (...words: string[]) => !q || words.some((w) => w.toLowerCase().includes(q));
  const byType = new Map(LIBRARY_SHAPES.map((s) => [s.type, s]));

  const generators: ActionItem[] = [
    { id: 'box-lid', label: 'Box & Lid', hint: 'A box and a lid that fits, to your sizes', Icon: Package, run: () => setBoxLid(true) },
    {
      id: 'cookie',
      label: 'Cookie Cutter & Stamp',
      hint: 'Opens the Cookie maker',
      Icon: Cookie,
      run: () => useStudio.getState().setStudio('cookie'),
      external: true,
    },
  ];
  const graphics: ActionItem[] = [
    { id: 'text-panel', label: 'Text options', hint: 'Fonts, size, spacing and alignment', Icon: Type, run: () => onOpenPanel?.('text') },
    { id: 'artwork', label: 'Logo, SVG or picture', hint: 'Traced into a solid you can resize', Icon: ImageUp, run: openMeshPicker },
  ];
  const sketches: ActionItem[] = [
    {
      id: 'sketch',
      label: 'Sketch',
      hint: 'Draw a dimensioned outline, then extrude or revolve it',
      Icon: PencilRuler,
      run: () => useSketchSession.getState().open(null),
      testId: 'new-sketch',
    },
    {
      id: 'extrude',
      label: 'Extrude',
      hint: 'Sketch a profile and pull it up',
      Icon: BoxIcon,
      run: () => useSketchSession.getState().open(null, 'extrude'),
    },
    {
      id: 'revolve',
      label: 'Revolve',
      hint: 'Sketch a profile and spin it round',
      Icon: RotateCw,
      run: () => useSketchSession.getState().open(null, 'revolve'),
    },
    {
      id: 'loft',
      label: 'Loft',
      hint: 'Blend between sketched sections',
      Icon: Layers3,
      run: () => useSolidBuilder.getState().open('loft'),
    },
    { id: 'sweep', label: 'Sweep', hint: 'Move a profile along a path', Icon: Route, run: () => useSolidBuilder.getState().open('sweep') },
  ];
  const library: ActionItem[] = [
    {
      id: 'assets',
      label: 'My Library',
      hint: assetCount
        ? `${assetCount} saved file${assetCount === 1 ? '' : 's'}: logos, artwork and models`
        : 'Logos, artwork and models you upload',
      Icon: Sparkles,
      run: () => onOpenPanel?.('assets'),
    },
    {
      id: 'templates',
      label: 'Start from a template',
      hint: 'Ready-made designs to adapt',
      Icon: LayoutTemplate,
      run: () => useProjects.getState().setView('templates'),
    },
  ];

  const shapeTile = (type: PrimitiveType) => {
    const s = byType.get(type);
    if (!s || !match(s.label, s.type)) return null;
    return (
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
        className={TILE}
      >
        {thumbs[s.type] ? (
          <img
            src={thumbs[s.type]}
            alt=""
            draggable={false}
            className="h-11 w-11 object-contain transition-transform group-hover:scale-105"
          />
        ) : (
          <span className="h-11 w-11 rounded-lg" style={{ background: s.defaultColor }} />
        )}
        <span className="text-center text-[12px] font-medium leading-tight text-ink-2">{s.label}</span>
      </button>
    );
  };
  const textTile = match('Text', 'letters', 'words') ? (
    <button
      key="text"
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(SHAPE_DRAG_MIME, 'text:Text');
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => void useEditor.getState().addText('Text')}
      title="Add Text — click, or drag onto the workplane"
      className={TILE}
    >
      <span className="flex h-11 w-11 items-center justify-center text-[32px] font-extrabold leading-none text-brand-ink transition-transform group-hover:scale-105">
        A
      </span>
      <span className="text-center text-[12px] font-medium leading-tight text-ink-2">Text</span>
    </button>
  ) : null;
  const actionRows = (items: ActionItem[]) =>
    items
      .filter((a) => match(a.label, a.hint))
      .map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={a.run}
          className="flex w-full items-center gap-3 rounded-xl border border-line bg-canvas/40 p-2.5 text-left transition-colors hover:border-brand hover:bg-brand-50"
          data-testid={a.testId}
          title={a.hint}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-ink">
            <a.Icon size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-ink">{a.label}</span>
            <span className="block truncate text-[12px] text-muted">{a.hint}</span>
          </span>
          {a.external && <ExternalLink size={14} className="shrink-0 text-muted" aria-label="Opens another studio" />}
        </button>
      ));

  const basic = BASIC.map(shapeTile).filter(Boolean);
  const advanced = ADVANCED.map(shapeTile).filter(Boolean);
  const gearTile = shapeTile('gear');
  const gen = actionRows(generators);
  const gfx = [textTile, ...actionRows(graphics)].filter(Boolean);
  const sk = actionRows(sketches);
  const lib = actionRows(library);
  const nothing = q && !basic.length && !advanced.length && !gearTile && !gen.length && !gfx.length && !sk.length && !lib.length;

  return (
    <aside className="flex w-[272px] shrink-0 flex-col border-r border-line bg-panel" aria-label="Shape library" data-tour="library">
      <div className="px-3.5 pb-2 pt-3.5">
        <h2 className="mb-2.5 flex items-center gap-2 text-[15px] font-semibold text-ink">
          <ShapesIcon size={17} className="text-brand-ink" /> Shape Library
        </h2>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 text-muted focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shapes and tools"
            aria-label="Search shapes"
            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-muted"
          />
        </label>
      </div>
      <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto px-3.5 pb-4">
        {!!basic.length && (
          <Category title="Basic Shapes" defaultOpen forceOpen={!!q}>
            <div className="grid grid-cols-3 gap-1.5">{basic}</div>
          </Category>
        )}
        {!!advanced.length && (
          <Category title="Advanced Shapes" defaultOpen forceOpen={!!q}>
            <div className="grid grid-cols-3 gap-1.5">{advanced}</div>
          </Category>
        )}
        {(gearTile || gen.length > 0) && (
          <Category title="Generators" defaultOpen forceOpen={!!q}>
            {gearTile && <div className="mb-1.5 grid grid-cols-3 gap-1.5">{gearTile}</div>}
            <div className="space-y-1.5">{gen}</div>
          </Category>
        )}
        {gfx.length > 0 && (
          <Category title="Text & Graphics" forceOpen={!!q}>
            {textTile && <div className="mb-1.5 grid grid-cols-3 gap-1.5">{textTile}</div>}
            <div className="space-y-1.5">{actionRows(graphics)}</div>
          </Category>
        )}
        {sk.length > 0 && (
          <Category title="Sketches & Features" defaultOpen forceOpen={!!q}>
            <div className="space-y-1.5">{sk}</div>
          </Category>
        )}
        {lib.length > 0 && (
          <Category title="Saved Files & Starters" forceOpen={!!q}>
            <div className="space-y-1.5">{lib}</div>
          </Category>
        )}
        {nothing && <p className="py-6 text-center text-[13px] text-muted">Nothing matches “{query}”.</p>}
        {!q && (
          <p className="flex gap-2 rounded-xl border border-dashed border-line p-3 text-[12px] leading-relaxed text-muted">
            <Wand2 size={15} className="mt-0.5 shrink-0 text-brand-ink" />
            <span>
              Press <kbd className="rounded border border-line bg-canvas px-1 text-ink-2">H</kbd> to turn a shape into a hole, then{' '}
              <strong className="text-ink-2">Combine</strong> to cut it.
            </span>
          </p>
        )}
      </div>
      {boxLid && <BoxLidDialog onClose={() => setBoxLid(false)} />}
    </aside>
  );
}

const TILE =
  'group flex aspect-[0.95] flex-col items-center justify-center gap-1 rounded-xl border border-transparent bg-canvas p-1.5 transition-all hover:border-brand/40 hover:bg-brand-50 active:scale-[0.97]';

/** A collapsible library section. While searching, every section with matches is open. */
function Category({
  title,
  children,
  defaultOpen = false,
  forceOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = open || forceOpen;
  return (
    <section className="rounded-xl border border-line bg-canvas/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={shown}
        className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-[14px] font-semibold text-ink hover:bg-canvas"
      >
        {title}
        <ChevronDown size={16} className={`text-muted transition-transform ${shown ? '' : '-rotate-90'}`} />
      </button>
      {shown && <div className="px-2 pb-2">{children}</div>}
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
