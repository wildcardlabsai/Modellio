import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Download, Info, Loader2, PencilRuler, Redo2, TriangleAlert, Undo2 } from 'lucide-react';
import { useCookie, openCookieTemplate, startBlankCookie, resizeDesign } from './store';
import { COOKIE_TEMPLATES, COOKIE_CATEGORIES } from './templates';
import type { CookieParams, CookiePart, CookieRole } from './geometry';
import { DesignCanvas, type RoleStyle } from '../canvas/DesignCanvas';
import { AddBar, Inspector, LayersPanel, fileToElement, type PanelConfig } from '../canvas/DesignPanels';
import { MakerPreview, downloadBytes, slugify } from '../canvas/MakerPreview';
import { TemplateGallery } from '../canvas/TemplateGallery';
import { useAssets } from '@/assets/library';
import { designBounds, type DesignElement } from '../canvas/model';
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
const PART_COLOURS: Record<CookiePart['id'], string> = { cutter: '#2463EB', stamp: '#EC4899', handle: '#F59E0B' };
const section = 'border-b border-line p-4';
const heading = 'mb-2 text-[13px] font-semibold text-ink';

export const COOKIE_PANEL: PanelConfig = {
  roles: [
    { value: 'shape', label: 'Cookie shape', colour: '#C98A4B' },
    { value: 'outline', label: 'Outline only', colour: '#E8C9A0' },
    { value: 'detail', label: 'Stamp detail', colour: '#EC4899' },
  ] satisfies { value: CookieRole; label: string; colour: string }[],
  defaults: { shape: 'shape', text: 'detail', upload: 'shape', draw: 'detail' },
  // The first thing on an empty canvas makes the cookie; later text and drawings press into it.
  pickRole: (kind, elements) => {
    const hasShape = elements.some((e) => e.role === 'shape' || e.role === 'outline');
    if (!hasShape) return 'shape';
    return kind === 'text' ? 'detail' : 'shape';
  },
  newShapeSize: 50,
  newTextHeight: 14,
  defaultText: 'Hello',
};

const ROLE_STYLE: Record<CookieRole, RoleStyle> = {
  shape: { fill: '#D9A066', stroke: '#8A5A2B' },
  outline: { fill: '#EED3AE', stroke: '#B07A45', dashed: true },
  detail: { fill: '#EC4899', stroke: '#9D174D', opacity: 0.85 },
};
const roleStyle = (role: string) => ROLE_STYLE[role as CookieRole] ?? ROLE_STYLE.shape;

/**
 * Cookie Cutter & Stamp Maker: lay out the cookie on a canvas (shapes, names, pictures,
 * drawings), choose what makes the outline and what the stamp presses in, and get a cutter,
 * a matching stamp and a handle, built live in 3D.
 */
export default function CookieStudio() {
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState<'templates' | 'design'>('design');
  const [view, setView] = useState<'design' | '3d'>('design');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (window as unknown as { modellioCookie: unknown }).modellioCookie = { store: useCookie, openCookieTemplate, startBlankCookie };
    useCookie.getState().rebuild();
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        useCookie.getState().undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        useCookie.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    try {
      const role = COOKIE_PANEL.pickRole!('upload', useCookie.getState().elements);
      useCookie.getState().add(await fileToElement(f, 60, role));
      void useAssets.getState().add([f]);
      setTab('design');
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-testid="cookie-studio"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => void onDrop(e)}
    >
      <Header view={view} setView={setView} />
      <div className="relative flex min-h-0 flex-1">
        <aside
          className="flex w-[290px] shrink-0 flex-col border-r border-line bg-white xl:w-[320px]"
          aria-label="Cookie design"
          data-testid="cookie-left"
        >
          <div className="border-b border-line p-3">
            <Segmented<'templates' | 'design'>
              label="Templates or design"
              value={tab}
              options={[
                { value: 'templates', label: `Templates (${COOKIE_TEMPLATES.length})` },
                { value: 'design', label: 'Design' },
              ]}
              onChange={setTab}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'templates' ? <Gallery onOpen={() => setTab('design')} /> : <DesignTab error={error} setError={setError} />}
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
              data-testid="cookie-mini-preview"
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
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand bg-brand-50/80 text-[15px] font-semibold text-brand">
          Drop an SVG or picture to add it to the cookie
        </div>
      )}
    </div>
  );
}

function Header({ view, setView }: { view: 'design' | '3d'; setView: (v: 'design' | '3d') => void }) {
  const make = useCookie((s) => s.params.make);
  const canUndo = useCookie((s) => s.past.length > 0);
  const canRedo = useCookie((s) => s.future.length > 0);
  const { undo, redo, setParams } = useCookie.getState();
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-white px-3 sm:px-5">
      <h1 className="text-[14px] font-semibold text-ink">Cookie Cutter & Stamp Maker</h1>
      <div className="w-[390px] shrink-0">
        <Segmented
          label="What to make"
          value={make}
          options={[
            { value: 'both', label: 'Cutter + stamp' },
            { value: 'cutter', label: 'Cutter' },
            { value: 'stamp', label: 'Stamp' },
          ]}
          onChange={(v) => setParams({ make: v })}
        />
      </div>
      <div className="w-[150px] shrink-0">
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
  const templateId = useCookie((s) => s.templateId);
  return (
    <TemplateGallery
      templates={COOKIE_TEMPLATES}
      categories={COOKIE_CATEGORIES}
      selected={templateId}
      thumbDir="cookie"
      testPrefix="cookie"
      blankHint="An empty canvas: add a shape, a name or a picture"
      onOpen={(id) => {
        void openCookieTemplate(id);
        onOpen();
      }}
      onBlank={() => {
        startBlankCookie();
        onOpen();
      }}
    />
  );
}

function DesignTab({ error, setError }: { error: string | null; setError: (m: string | null) => void }) {
  const count = useCookie((s) => s.elements.length);
  return (
    <>
      <div className={section}>
        <h2 className={heading}>Add</h2>
        <AddBar useStore={useCookie} config={COOKIE_PANEL} onError={setError} />
        {error && (
          <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-[12px] text-red-800">
            {error}
          </p>
        )}
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          {count === 0
            ? 'Start with a shape, a name or a picture: it becomes the cookie. Then add text or drawings to press into it.'
            : '“Cookie shape” cuts and is stamped. “Outline only” cuts. “Stamp detail” only presses into the dough.'}
        </p>
      </div>
      <div className={section}>
        <Inspector useStore={useCookie} config={COOKIE_PANEL} />
      </div>
      <div className={section}>
        <h2 className={heading}>Layers</h2>
        <LayersPanel useStore={useCookie} config={COOKIE_PANEL} />
      </div>
    </>
  );
}

function Canvas2D() {
  const outline = useCookie((s) => s.result?.outline);
  const empty = useCookie((s) => s.elements.length === 0);
  const d = outline?.map((p) => 'M' + p.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join('L') + 'Z').join('') ?? '';
  return (
    <DesignCanvas
      useStore={useCookie}
      artboard={{ w: 100, h: 100, label: 'Cookie area 100 × 100 mm' }}
      roleStyle={roleStyle}
      drawRole="detail"
      drawWidth={2}
      underlay={(px) =>
        d ? <path d={d} fill="#F3E2C7" fillRule="evenodd" stroke="#2463EB" strokeWidth={1.6 * px} data-testid="cookie-outline" /> : null
      }
    >
      {empty && (
        <div className="pointer-events-none absolute inset-x-0 top-6 text-center text-[13px] text-muted">
          Add a shape, some text or a picture from the panel on the left, or pick a template.
        </div>
      )}
    </DesignCanvas>
  );
}

function Preview3D({ large = false }: { large?: boolean }) {
  const result = useCookie((s) => s.result);
  const parts = useMemo(() => (result?.parts ?? []).map((p) => ({ id: p.id, colour: PART_COLOURS[p.id], mesh: p.mesh })), [result]);
  return (
    <MakerPreview
      parts={parts}
      compact={!large}
      contentKey={result ? `${result.parts.length}-${result.cookie.width.toFixed(0)}-${result.cookie.height.toFixed(0)}` : ''}
      label="3D preview of the cutter and stamp"
      testId={large ? 'cookie-viewport' : undefined}
    />
  );
}

function Num({
  label,
  k,
  min,
  max,
  step,
  decimals = 1,
}: {
  label: string;
  k: keyof CookieParams;
  min: number;
  max: number;
  step: number;
  decimals?: number;
}) {
  const v = useCookie((s) => s.params[k]) as number;
  return (
    <label className="text-[12px] text-muted">
      {label}
      <NumberField
        ariaLabel={`${label} (mm)`}
        value={v}
        min={min}
        max={max}
        step={step}
        decimals={decimals}
        suffix="mm"
        onCommit={(x) => useCookie.getState().setParams({ [k]: x })}
      />
    </label>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

/** Longest side of the parts that make the cookie's outline. */
function cutSize(elements: DesignElement[]) {
  const b = designBounds(elements.filter((e) => e.role !== 'detail'));
  return b ? Math.max(b.maxX - b.minX, b.maxY - b.minY) : 0;
}

function Settings() {
  const p = useCookie((s) => s.params);
  const elements = useCookie((s) => s.elements);
  const size = cutSize(elements);
  const set = (patch: Partial<CookieParams>) => useCookie.getState().setParams(patch);
  return (
    <>
      <section className={section} aria-labelledby="cookie-size-heading" data-testid="cookie-settings">
        <h2 id="cookie-size-heading" className={heading}>
          Size and outline
        </h2>
        <Grid>
          <label className="text-[12px] text-muted">
            Design size
            <NumberField
              ariaLabel="Design size (mm)"
              value={Math.round(size * 10) / 10}
              min={15}
              max={220}
              step={5}
              decimals={0}
              suffix="mm"
              disabled={!size}
              onCommit={(v) => {
                const st = useCookie.getState();
                st.beginGesture();
                useCookie.setState({ elements: resizeDesign(st.elements, v, cutSize(st.elements)) });
                st.rebuild();
              }}
            />
          </label>
          <Num label="Outline margin" k="outline" min={0} max={20} step={0.5} />
          <Num label="Smoothing" k="smoothing" min={0} max={5} step={0.1} />
        </Grid>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Size scales everything on the canvas. A margin draws a rounded outline around the design and joins separate letters.
        </p>
        <Toggle label="Mirror for printing (recommended)" checked={p.mirror} onChange={(v) => set({ mirror: v })} />
      </section>
      {p.make !== 'stamp' && (
        <section className={section} aria-labelledby="cookie-cutter-heading">
          <h2 id="cookie-cutter-heading" className={heading}>
            Cutter
          </h2>
          <Grid>
            <Num label="Height" k="cutterHeight" min={6} max={40} step={1} decimals={0} />
            <Num label="Blade" k="blade" min={0.4} max={3} step={0.1} />
            <Num label="Flange width" k="rimWidth" min={0} max={10} step={0.5} />
            <Num label="Flange height" k="rimHeight" min={0.6} max={6} step={0.2} />
          </Grid>
        </section>
      )}
      {p.make !== 'cutter' && (
        <section className={section} aria-labelledby="cookie-stamp-heading">
          <h2 id="cookie-stamp-heading" className={heading}>
            Stamp
          </h2>
          <Segmented
            label="Stamp pattern"
            value={p.stampStyle}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'outline', label: 'Lines' },
              { value: 'filled', label: 'Filled' },
            ]}
            onChange={(v) => set({ stampStyle: v })}
          />
          <div className="mt-2">
            <Grid>
              <Num label="Relief" k="reliefHeight" min={0.6} max={6} step={0.2} />
              <Num label="Line width" k="lineWidth" min={0.6} max={5} step={0.1} />
              <Num label="Plate" k="plateThickness" min={2} max={10} step={0.5} />
              <Num label="Gap to cutter" k="gap" min={0} max={3} step={0.1} decimals={2} />
            </Grid>
          </div>
          <Toggle label="Separate handle" checked={p.handle} onChange={(v) => set({ handle: v })} />
        </section>
      )}
    </>
  );
}

function designName() {
  const { templateId, elements } = useCookie.getState();
  const text = elements.find((e) => e.kind === 'text');
  if (text && text.kind === 'text' && text.text.trim()) return `${text.text.trim()} cookie`;
  return `${COOKIE_TEMPLATES.find((t) => t.id === templateId)?.name ?? 'My'} cookie`;
}

function RightPanel() {
  const result = useCookie((s) => s.result);
  const error = useCookie((s) => s.error);
  const building = useCookie((s) => s.building);
  const body = (p: CookiePart) => ({ id: p.id, name: p.name, color: PART_COLOURS[p.id], mesh: p.mesh, watertight: p.watertight });
  const customise = () => {
    if (!result) return;
    useEditor.getState().importMeshes(
      result.parts.map((p) => ({ name: p.name, mesh: p.mesh })),
      { groupName: designName() },
    );
    useStudio.getState().openInDesign({ studio: 'cookie', label: 'Cookie Maker' });
  };
  return (
    <aside
      className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-l border-line bg-white xl:w-[300px]"
      aria-label="Cookie settings and result"
      data-testid="cookie-right"
    >
      <section className={section} aria-labelledby="cookie-result-heading">
        <h2 id="cookie-result-heading" className={`${heading} flex items-center gap-2`}>
          Your cookie {building && <Loader2 size={14} className="animate-spin text-brand" aria-label="updating" />}
        </h2>
        {error && (
          <p role="alert" className="flex gap-2 rounded-lg bg-red-50 p-2 text-[12px] text-red-800" data-testid="cookie-error">
            <CircleAlert size={14} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}
        {result && !error && (
          <>
            <p className={`${MONO} text-[12px] text-ink`} data-testid="cookie-size">
              {result.cookie.width.toFixed(1)} × {result.cookie.height.toFixed(1)} mm
            </p>
            <ul className="mt-3 flex flex-col gap-1.5" data-testid="cookie-parts">
              {result.parts.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg bg-[#f9fafb] px-2.5 py-2 text-[12px]"
                  data-testid="cookie-part"
                  data-part={p.id}
                >
                  <span className="h-3.5 w-3.5 shrink-0 rounded" style={{ background: PART_COLOURS[p.id] }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{p.name}</span>
                    <span className="text-muted">{p.size.map((v) => v.toFixed(1)).join(' × ')} mm</span>
                  </span>
                  {p.watertight ? (
                    <CircleCheck size={14} className="shrink-0 text-[#067647]" aria-label="closed solid" />
                  ) : (
                    <CircleAlert size={14} className="text-red-600" aria-label="not a closed solid" />
                  )}
                  <button
                    type="button"
                    className="rounded-md px-1.5 py-1 font-medium text-brand hover:bg-brand-50"
                    aria-label={`Download ${p.name} as STL`}
                    onClick={() =>
                      downloadBytes(new Uint8Array(writeBinaryStl([body(p)])), `${slugify(designName())}-${p.id}.stl`, 'model/stl')
                    }
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
                data-testid="cookie-warning"
              >
                <TriangleAlert size={14} className="mt-0.5 shrink-0" /> {w}
              </p>
            ))}
            {result.notes.map((n) => (
              <p key={n} className="mt-2 flex gap-2 text-[12px] leading-relaxed text-muted">
                <Info size={14} className="mt-0.5 shrink-0 text-brand" /> {n}
              </p>
            ))}
          </>
        )}
        {result && !error && (
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              data-testid="cookie-download"
              onClick={() => downloadBytes(write3mf(result.parts.map(body), designName()), `${slugify(designName())}.3mf`, 'model/3mf')}
              className="flex h-10 items-center justify-center gap-2 rounded-lg bg-brand text-[14px] font-semibold text-white hover:bg-brand-600"
            >
              <Download size={16} /> Download all parts (3MF)
            </button>
            <button
              type="button"
              onClick={customise}
              className="flex h-10 items-center justify-center gap-2 rounded-lg border border-line text-[13px] font-medium text-[#344054] hover:bg-[#f9fafb]"
            >
              <PencilRuler size={16} /> Open a copy in Design Studio
            </button>
            <p className="text-[11px] leading-relaxed text-muted">
              Print the cutter flange-down and the stamp face-up; no supports needed. Printed layers can trap dough: use a filament rated
              for food contact, hand-wash, and dust the cutter with flour.
            </p>
          </div>
        )}
      </section>
      <Settings />
    </aside>
  );
}
