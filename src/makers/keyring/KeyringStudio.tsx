import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Box, CircleAlert, CircleCheck, Download, Info, Loader2, PencilRuler, Redo2, Shapes, TriangleAlert, Undo2 } from 'lucide-react';
import { useKeyring, openKeyringTemplate, startBlankKeyring, placeHoleAtEdge } from './store';
import { KEYRING_TEMPLATES, KEYRING_CATEGORIES } from './templates';
import type { KeyringParams, KeyringPart, KeyringRole } from './geometry';
import { DesignCanvas, type RoleStyle } from '../canvas/DesignCanvas';
import { AddBar, Inspector, LayersPanel, type PanelConfig } from '../canvas/DesignPanels';
import { MakerPreview, downloadBytes, slugify } from '../canvas/MakerPreview';
import { TemplateGallery } from '../canvas/TemplateGallery';
import { NumberField } from '@/components/ui/NumberField';
import { Toggle } from '@/components/ui/Toggle';
import { Segmented } from '@/components/ui/Modal';
import { IconButton } from '@/components/ui/IconButton';
import { write3mf } from '@/cad/export/threemf';
import { writeBinaryStl } from '@/cad/export/writers';
import { useEditor } from '@/store/editorStore';
import { useStudio } from '@/app/studio';
import { isTypingTarget } from '@/hooks/useKeyboardShortcuts';

const MONO = "font-['Space_Mono',ui-monospace,monospace]";
const section = 'border-b border-line p-4';
const heading = 'mb-2 text-[13px] font-semibold text-ink';

export const KEYRING_PANEL: PanelConfig = {
  roles: [
    { value: 'raised', label: 'Raised', colour: '#2463EB' },
    { value: 'engraved', label: 'Engraved', colour: '#475467' },
    { value: 'inlay', label: 'Flush', colour: '#7FA6F5' },
    { value: 'plate', label: 'Plate', colour: '#D0D5DD' },
    { value: 'cut', label: 'Hole', colour: '#E0262B' },
  ] satisfies { value: KeyringRole; label: string; colour: string }[],
  defaults: { shape: 'raised', text: 'raised', upload: 'raised', draw: 'raised' },
  // On the back, new items are engraved (nothing can stand proud of the bottom face).
  pickRole: () => (useKeyring.getState().side === 'back' ? 'engraved' : 'raised'),
  backRoles: ['engraved', 'inlay', 'cut'],
  newShapeSize: 14,
  newTextHeight: 9,
  defaultText: 'NAME',
};

const FILAMENT = ['#F4F4F2', '#1D1D1F', '#2463EB', '#E0262B', '#F5B700', '#16A34A', '#F472B6', '#7C3AED', '#F97316', '#9AA1AD'];

/**
 * Keyring & Name Tag Maker: lay out text, shapes, uploads and drawings on a canvas; choose
 * whether each is raised, engraved, flush or a hole; the tag is built live in 3D.
 */
export default function KeyringStudio() {
  useEffect(() => {
    (window as unknown as { modellioKeyring: unknown }).modellioKeyring = { store: useKeyring, openKeyringTemplate, startBlankKeyring };
    useKeyring.getState().rebuild();
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        useKeyring.getState().undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        useKeyring.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [tab, setTab] = useState<'templates' | 'design'>('design');
  const [view, setView] = useState<'design' | '3d'>('design');
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="keyring-studio">
      <Header view={view} setView={setView} />
      <div className="relative flex min-h-0 flex-1">
        <aside
          className="flex w-[290px] shrink-0 flex-col border-r border-line bg-white xl:w-[320px]"
          aria-label="Keyring design"
          data-testid="keyring-left"
        >
          <div className="border-b border-line p-3">
            <Segmented<'templates' | 'design'>
              label="Templates or design"
              value={tab}
              options={[
                { value: 'templates', label: `Templates (${KEYRING_TEMPLATES.length})` },
                { value: 'design', label: 'Design' },
              ]}
              onChange={setTab}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'templates' ? <Gallery onOpen={() => setTab('design')} /> : <DesignTab />}
          </div>
        </aside>
        <main className="relative min-w-0 flex-1" aria-label="Design">
          {view === 'design' ? <Canvas2D /> : <Preview3D large />}
          {view === 'design' && (
            <button
              type="button"
              onClick={() => setView('3d')}
              className="absolute bottom-3 right-3 h-[180px] w-[240px] overflow-hidden rounded-xl border border-line bg-white shadow-panel"
              aria-label="Show the 3D preview larger"
              data-testid="keyring-mini-preview"
            >
              <span className="pointer-events-none absolute left-2 top-1.5 z-10 text-[11px] font-semibold text-[#344054]">3D preview</span>
              <span className="pointer-events-none block h-full w-full">
                <Preview3D />
              </span>
            </button>
          )}
        </main>
        <RightPanel />
      </div>
    </div>
  );
}

function Header({ view, setView }: { view: 'design' | '3d'; setView: (v: 'design' | '3d') => void }) {
  const canUndo = useKeyring((s) => s.past.length > 0);
  const canRedo = useKeyring((s) => s.future.length > 0);
  const { undo, redo } = useKeyring.getState();
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-white px-3 sm:px-5">
      <h1 className="text-[14px] font-semibold text-ink">Keyring & Name Tag Maker</h1>
      <div className="w-[200px]">
        <Segmented<'design' | '3d'>
          label="View"
          value={view}
          options={[
            { value: 'design', label: 'Design' },
            { value: '3d', label: '3D' },
          ]}
          onChange={setView}
        />
      </div>
      <div className="flex-1" />
      <IconButton label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={undo}>
        <Undo2 size={17} />
      </IconButton>
      <IconButton label="Redo" shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}>
        <Redo2 size={17} />
      </IconButton>
    </div>
  );
}

function Gallery({ onOpen }: { onOpen: () => void }) {
  const templateId = useKeyring((s) => s.templateId);
  return (
    <TemplateGallery
      templates={KEYRING_TEMPLATES}
      categories={KEYRING_CATEGORIES}
      selected={templateId}
      thumbDir="keyring"
      testPrefix="keyring"
      blankHint="An empty canvas: add text, shapes or your own artwork"
      onOpen={(id) => {
        void openKeyringTemplate(id);
        onOpen();
      }}
      onBlank={() => {
        startBlankKeyring();
        onOpen();
      }}
    />
  );
}

function DesignTab() {
  const [error, setError] = useState<string | null>(null);
  const count = useKeyring((s) => s.elements.length);
  return (
    <>
      <div className={section}>
        <h2 className={heading}>Add</h2>
        <AddBar useStore={useKeyring} config={KEYRING_PANEL} onError={setError} />
        {error && (
          <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-[12px] text-red-800">
            {error}
          </p>
        )}
        {count === 0 && (
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Start with some text: the tag grows around it. Or add a shape and set it to “Plate” to choose the tag’s outline.
          </p>
        )}
      </div>
      <div className={section}>
        <Inspector useStore={useKeyring} config={KEYRING_PANEL} />
      </div>
      <div className={section}>
        <h2 className={heading}>Layers</h2>
        <LayersPanel useStore={useKeyring} config={KEYRING_PANEL} />
      </div>
    </>
  );
}

function useRoleStyle() {
  const base = useKeyring((s) => s.params.baseColour);
  const top = useKeyring((s) => s.params.topColour);
  const two = useKeyring((s) => s.params.twoColour);
  return useMemo(() => {
    const raised = two ? top : shade(base);
    return (role: string): RoleStyle => {
      switch (role as KeyringRole) {
        case 'plate':
          return { fill: base, stroke: '#7D8594', opacity: 0.9 };
        case 'engraved':
          return { fill: '#3B3F47', stroke: '#3B3F47', opacity: 0.45, dashed: true };
        case 'inlay':
          return { fill: raised, stroke: raised, opacity: 0.7 };
        case 'cut':
          return { fill: '#FFFFFF', stroke: '#E0262B', dashed: true };
        default:
          return { fill: raised, stroke: '#1D2939' };
      }
    };
  }, [base, top, two]);
}

/** A darker version of a light colour so single-colour raised parts still show on the canvas. */
function shade(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * 0.7);
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

/** Front / Back: which face of the tag is being edited. */
function SideSwitch() {
  const side = useKeyring((s) => s.side);
  const backCount = useKeyring((s) => s.elements.filter((e) => e.side === 'back').length);
  return (
    <div className="absolute left-3 top-3 flex items-center gap-2" data-testid="keyring-sides">
      <div className="w-[180px] rounded-lg bg-white shadow-sm">
        <Segmented<'front' | 'back'>
          label="Side of the tag"
          value={side}
          options={[
            { value: 'front', label: 'Front' },
            { value: 'back', label: backCount ? `Back (${backCount})` : 'Back' },
          ]}
          onChange={(v) => useKeyring.getState().setSide(v)}
        />
      </div>
      {side === 'back' && (
        <span className="rounded-md bg-white/90 px-2 py-1 text-[11px] text-[#475467] shadow-sm">
          Seen from behind · engraved or flush only
        </span>
      )}
    </div>
  );
}

function Canvas2D() {
  const back = useKeyring((s) => s.side === 'back');
  const roleStyle = useRoleStyle();
  const hole = useKeyring((s) => s.params.hole);
  const plateMode = useKeyring((s) => s.params.plateMode);
  const base = useKeyring((s) => s.params.baseColour);
  const outline = useKeyring((s) => s.result?.outline);
  const empty = useKeyring((s) => s.elements.length === 0);
  const pins = hole.enabled
    ? [
        {
          id: 'ring',
          x: hole.x,
          y: hole.y,
          r: hole.diameter / 2 + hole.rim,
          inner: hole.diameter / 2,
          label: 'Key ring hole. Drag to move it.',
          onMove: (x: number, y: number, phase: 'start' | 'move' | 'end') => {
            const s = useKeyring.getState();
            if (phase === 'start') s.beginGesture();
            else if (phase === 'move') s.setParams({ hole: { ...s.params.hole, x, y } }, { transient: true });
          },
        },
      ]
    : [];
  const d = outline?.map((p) => 'M' + p.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join('L') + 'Z').join('') ?? '';
  return (
    <DesignCanvas
      useStore={useKeyring}
      artboard={{ w: 80, h: 50, label: 'Tag area 80 × 50 mm' }}
      roleStyle={roleStyle}
      pins={pins}
      drawRole={back ? 'engraved' : 'raised'}
      underlay={(px) =>
        d ? (
          <path
            d={d}
            fill={plateMode === 'bubble' ? base : 'none'}
            fillRule="evenodd"
            stroke="#7D8594"
            strokeWidth={1.2 * px}
            strokeDasharray={plateMode === 'bubble' ? undefined : `${3 * px} ${2 * px}`}
            data-testid="keyring-outline"
          />
        ) : null
      }
    >
      <SideSwitch />
      {empty && (
        <div className="pointer-events-none absolute inset-x-0 top-14 text-center text-[13px] text-muted">
          Add text or a shape from the panel on the left, or draw with the pen.
        </div>
      )}
    </DesignCanvas>
  );
}

function Preview3D({ large = false }: { large?: boolean }) {
  const result = useKeyring((s) => s.result);
  const parts = useMemo(() => (result?.parts ?? []).map((p) => ({ id: p.id, colour: p.colour, mesh: p.mesh })), [result]);
  return (
    <MakerPreview
      parts={parts}
      compact={!large}
      contentKey={result ? `${result.width.toFixed(0)}-${result.height.toFixed(0)}` : ''}
      label="3D preview of the tag"
      testId={large ? 'keyring-viewport' : undefined}
    />
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-[13px] text-[#344054]">
      <span>{label}</span>
      <div className="w-[110px]">{children}</div>
    </div>
  );
}

function Swatches({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div className="mt-1" role="radiogroup" aria-label={label}>
      <div className="mb-1 text-[12px] text-muted">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {FILAMENT.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value.toLowerCase() === c.toLowerCase()}
            aria-label={c}
            onClick={() => onChange(c)}
            className={`h-6 w-6 rounded-full border ${value.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-brand ring-offset-1' : 'border-[#c9d1de]'}`}
            style={{ background: c }}
          />
        ))}
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label}: custom colour`}
          className="h-6 w-8 cursor-pointer rounded border border-line bg-white p-0"
        />
      </div>
    </div>
  );
}

function TagSettings() {
  const p = useKeyring((s) => s.params);
  const set = (patch: Partial<KeyringParams>) => useKeyring.getState().setParams(patch);
  return (
    <section className={section} aria-labelledby="keyring-tag-heading" data-testid="keyring-settings">
      <h2 id="keyring-tag-heading" className={heading}>
        Tag
      </h2>
      <Segmented<KeyringParams['plateMode']>
        label="Tag shape"
        value={p.plateMode}
        options={[
          { value: 'bubble', label: 'Around the content' },
          { value: 'elements', label: 'From plate shapes' },
        ]}
        onChange={(v) => set({ plateMode: v })}
      />
      {p.plateMode === 'bubble' && (
        <Row label="Margin">
          <NumberField
            value={p.margin}
            onCommit={(v) => set({ margin: v })}
            min={0.5}
            max={15}
            step={0.5}
            decimals={1}
            suffix="mm"
            ariaLabel="Margin (mm)"
          />
        </Row>
      )}
      <Row label="Thickness">
        <NumberField
          value={p.thickness}
          onCommit={(v) => set({ thickness: v })}
          min={1}
          max={10}
          step={0.2}
          decimals={1}
          suffix="mm"
          ariaLabel="Thickness (mm)"
        />
      </Row>
      <Row label="Raised height">
        <NumberField
          value={p.raisedHeight}
          onCommit={(v) => set({ raisedHeight: v })}
          min={0.2}
          max={5}
          step={0.2}
          decimals={1}
          suffix="mm"
          ariaLabel="Raised height (mm)"
        />
      </Row>
      <Row label="Engrave depth">
        <NumberField
          value={p.engraveDepth}
          onCommit={(v) => set({ engraveDepth: v })}
          min={0.2}
          max={5}
          step={0.2}
          decimals={1}
          suffix="mm"
          ariaLabel="Engrave depth (mm)"
        />
      </Row>
      <Toggle label="Border" checked={p.border.enabled} onChange={(v) => set({ border: { ...p.border, enabled: v } })} />
      {p.border.enabled && (
        <Row label="Border width">
          <NumberField
            value={p.border.width}
            onCommit={(v) => set({ border: { ...p.border, width: v } })}
            min={0.6}
            max={5}
            step={0.2}
            decimals={1}
            suffix="mm"
            ariaLabel="Border width (mm)"
          />
        </Row>
      )}
      <Toggle label="Key ring hole" checked={p.hole.enabled} onChange={(v) => set({ hole: { ...p.hole, enabled: v } })} />
      {p.hole.enabled && (
        <>
          <Row label="Hole size">
            <NumberField
              value={p.hole.diameter}
              onCommit={(v) => set({ hole: { ...p.hole, diameter: v } })}
              min={2}
              max={15}
              step={0.5}
              decimals={1}
              suffix="mm"
              ariaLabel="Hole diameter (mm)"
            />
          </Row>
          <Row label="Ring wall">
            <NumberField
              value={p.hole.rim}
              onCommit={(v) => set({ hole: { ...p.hole, rim: v } })}
              min={0.8}
              max={8}
              step={0.5}
              decimals={1}
              suffix="mm"
              ariaLabel="Ring wall (mm)"
            />
          </Row>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted">Drag the blue ring on the canvas to move the hole.</p>
            <button
              type="button"
              onClick={placeHoleAtEdge}
              className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-[#344054] hover:bg-[#f9fafb]"
            >
              Put on edge
            </button>
          </div>
        </>
      )}
      <div className="mt-2">
        <Toggle label="Two colours" checked={p.twoColour} onChange={(v) => set({ twoColour: v })} />
        <Swatches label={p.twoColour ? 'Base colour' : 'Colour'} value={p.baseColour} onChange={(c) => set({ baseColour: c })} />
        {p.twoColour && <Swatches label="Top colour" value={p.topColour} onChange={(c) => set({ topColour: c })} />}
      </div>
    </section>
  );
}

function designName() {
  const { templateId, elements } = useKeyring.getState();
  const text = elements.find((e) => e.kind === 'text');
  if (text && text.kind === 'text' && text.text.trim()) return `${text.text.trim()} keyring`;
  return KEYRING_TEMPLATES.find((t) => t.id === templateId)?.name ?? 'My keyring';
}

function RightPanel() {
  const result = useKeyring((s) => s.result);
  const error = useKeyring((s) => s.error);
  const building = useKeyring((s) => s.building);
  const body = (p: KeyringPart) => ({ id: p.id, name: p.name, color: p.colour, mesh: p.mesh, watertight: p.watertight });
  const download3mf = () => {
    if (!result) return;
    const name = designName();
    downloadBytes(write3mf(result.parts.map(body), name), `${slugify(name)}.3mf`, 'model/3mf');
  };
  const downloadStl = (p: KeyringPart) =>
    downloadBytes(new Uint8Array(writeBinaryStl([body(p)])), `${slugify(designName())}-${p.id}.stl`, 'model/stl');
  const customise = () => {
    if (!result) return;
    useEditor.getState().importMeshes(
      result.parts.map((p) => ({ name: p.name, mesh: p.mesh })),
      { groupName: designName() },
    );
    useStudio.getState().openInDesign({ studio: 'keyring', label: 'Keyring Maker' });
  };
  return (
    <aside
      className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-l border-line bg-white xl:w-[300px]"
      aria-label="Tag settings and result"
      data-testid="keyring-right"
    >
      <TagSettings />
      <section className={section} aria-labelledby="keyring-result-heading">
        <h2 id="keyring-result-heading" className={`${heading} flex items-center gap-2`}>
          Result {building && <Loader2 size={14} className="animate-spin text-brand" aria-label="updating" />}
        </h2>
        {error && (
          <p role="alert" className="flex gap-2 rounded-lg bg-red-50 p-2 text-[12px] text-red-800" data-testid="keyring-error">
            <CircleAlert size={14} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}
        {result && !error && (
          <>
            <p className={`${MONO} text-[12px] text-ink`} data-testid="keyring-size">
              {result.width.toFixed(1)} × {result.height.toFixed(1)} × {result.thickness.toFixed(1)} mm
            </p>
            <ul className="mt-3 flex flex-col gap-1.5" data-testid="keyring-parts">
              {result.parts.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg bg-[#f9fafb] px-2.5 py-2 text-[12px]"
                  data-testid="keyring-part"
                  data-part={p.id}
                >
                  <span className="h-3.5 w-3.5 shrink-0 rounded border border-black/10" style={{ background: p.colour }} aria-hidden />
                  <span className="min-w-0 flex-1 font-medium text-ink">{p.name}</span>
                  {p.watertight ? (
                    <CircleCheck size={14} className="shrink-0 text-[#067647]" aria-label="closed solid" />
                  ) : (
                    <CircleAlert size={14} className="text-red-600" aria-label="not a closed solid" />
                  )}
                  <button
                    type="button"
                    className="rounded-md px-1.5 py-1 font-medium text-brand hover:bg-brand-50"
                    aria-label={`Download ${p.name} as STL`}
                    onClick={() => downloadStl(p)}
                  >
                    STL
                  </button>
                </li>
              ))}
            </ul>
            {result.warnings.map((w) => (
              <p
                key={w}
                className="mt-2 flex gap-2 rounded-lg bg-amber-50 p-2 text-[12px] leading-relaxed text-amber-900"
                data-testid="keyring-warning"
              >
                <TriangleAlert size={14} className="mt-0.5 shrink-0" /> {w}
              </p>
            ))}
            {result.notes.map((n) => (
              <p key={n} className="mt-2 flex gap-2 text-[12px] leading-relaxed text-muted" data-testid="keyring-note">
                <Info size={14} className="mt-0.5 shrink-0 text-brand" /> {n}
              </p>
            ))}
          </>
        )}
      </section>
      {result && !error && (
        <section className="flex flex-col gap-2 p-4">
          <button
            type="button"
            data-testid="keyring-download"
            onClick={download3mf}
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-brand text-[14px] font-semibold text-white hover:bg-brand-600"
          >
            <Download size={16} /> Download (3MF)
          </button>
          <button
            type="button"
            onClick={customise}
            className="flex h-10 items-center justify-center gap-2 rounded-lg border border-line text-[13px] font-medium text-[#344054] hover:bg-[#f9fafb]"
          >
            <PencilRuler size={16} /> Open a copy in Design Studio
          </button>
          <p className="flex gap-1.5 text-[11px] leading-relaxed text-muted">
            <Shapes size={13} className="mt-0.5 shrink-0" />
            Keep editing here; the Design Studio gets a copy for changes this maker can’t do, with a button to come back.
          </p>
        </section>
      )}
      {!result && !error && (
        <p className="flex items-center gap-2 p-4 text-[12px] text-muted">
          <Box size={14} /> Building…
        </p>
      )}
    </aside>
  );
}
