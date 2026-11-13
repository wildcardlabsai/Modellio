import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  CircleAlert,
  CircleCheck,
  Dice5,
  Download,
  Info,
  Loader2,
  Maximize,
  PencilRuler,
  Plus,
  Redo2,
  Shuffle,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { useVase, buildFine } from './store';
import { VASE_TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from './templates';
import { shapeFunction, type BodyType, type PatternKind, type ShapeKind, type VaseParams, type VasePart } from './geometry';
import { ProfileEditor } from './ProfileEditor';
import { meshDataToGeometry } from '@/cad/kernel/meshData';
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
const PART_COLOURS: Record<VasePart['id'], string> = { body: '#2F6FDE', saucer: '#9AA1AD' };
const TYPE_LABEL: Record<BodyType, string> = { vase: 'Vase', pot: 'Plant pot', lampshade: 'Lampshade' };

/**
 * Vase Maker: vases, plant pots, bowls and lampshades from a profile curve, a cross-section
 * shape, a twist and a surface pattern. Start from one of the templates or from blank.
 */
export default function VaseStudio() {
  useEffect(() => {
    (window as unknown as { modellioVase: unknown }).modellioVase = { store: useVase };
    useVase.getState().rebuild();
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        useVase.getState().undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        useVase.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="vase-studio">
      <Header />
      <div className="relative flex min-h-0 flex-1">
        <LeftPanel />
        <main className="relative min-w-0 flex-1" aria-label="Preview">
          <Preview />
        </main>
        <RightPanel />
      </div>
    </div>
  );
}

function Header() {
  const type = useVase((s) => s.params.type);
  const setParams = useVase((s) => s.setParams);
  const canUndo = useVase((s) => s.past.length > 0);
  const canRedo = useVase((s) => s.future.length > 0);
  const { undo, redo, surpriseMe } = useVase.getState();
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-white px-3 sm:px-5">
      <h1 className="text-[14px] font-semibold text-ink">Vase Maker</h1>
      <div className="w-[300px]">
        <Segmented<BodyType>
          label="What to make"
          value={type}
          options={[
            { value: 'vase', label: 'Vase' },
            { value: 'pot', label: 'Plant pot' },
            { value: 'lampshade', label: 'Lampshade' },
          ]}
          onChange={(v) => setParams({ type: v })}
        />
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={surpriseMe}
        className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-[#344054] hover:bg-[#f2f4f7]"
        data-testid="vase-surprise"
      >
        <Dice5 size={16} /> Surprise me
      </button>
      <IconButton label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={undo}>
        <Undo2 size={17} />
      </IconButton>
      <IconButton label="Redo" shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}>
        <Redo2 size={17} />
      </IconButton>
    </div>
  );
}

function LeftPanel() {
  const tab = useVase((s) => s.tab);
  const setTab = useVase((s) => s.setTab);
  return (
    <aside
      className="flex w-[300px] shrink-0 flex-col border-r border-line bg-white xl:w-[330px]"
      aria-label="Vase design"
      data-testid="vase-left"
    >
      <div className="border-b border-line p-3">
        <Segmented<'templates' | 'design'>
          label="Templates or design"
          value={tab}
          options={[
            { value: 'templates', label: `Templates (${VASE_TEMPLATES.length})` },
            { value: 'design', label: 'Design' },
          ]}
          onChange={setTab}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{tab === 'templates' ? <Gallery /> : <DesignPanel />}</div>
    </aside>
  );
}

function Gallery() {
  const [cat, setCat] = useState<TemplateCategory | 'All'>('All');
  const templateId = useVase((s) => s.templateId);
  const { applyTemplate, startBlank } = useVase.getState();
  const list = VASE_TEMPLATES.filter((t) => cat === 'All' || t.category === cat);
  return (
    <div className="p-3">
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Template category">
        {(['All', ...TEMPLATE_CATEGORIES] as const).map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={cat === c}
            onClick={() => setCat(c)}
            className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${cat === c ? 'border-brand bg-brand-50 text-brand' : 'border-line text-[#344054] hover:bg-[#f9fafb]'}`}
          >
            {c}
          </button>
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-2" data-testid="vase-templates">
        <li>
          <button
            type="button"
            onClick={startBlank}
            className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#c9d1de] text-center text-[13px] font-semibold text-[#344054] hover:border-brand hover:text-brand"
            data-testid="vase-blank"
          >
            <Plus size={22} />
            Start blank
            <span className="px-3 text-[11px] font-normal text-muted">Shape your own from a plain cylinder</span>
          </button>
        </li>
        {list.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => applyTemplate(t.id)}
              aria-pressed={templateId === t.id}
              title={t.description}
              className={`block w-full overflow-hidden rounded-lg border text-left ${templateId === t.id ? 'border-brand ring-2 ring-brand/30' : 'border-line hover:border-[#98a2b3]'}`}
              data-testid="vase-template"
              data-template={t.id}
            >
              <img
                src={`/vase/${t.id}.jpg`}
                alt=""
                width={200}
                height={200}
                loading="lazy"
                className="aspect-square w-full bg-[#f5f7fb] object-cover"
              />
              <span className="block px-2 py-1.5">
                <span className="block truncate text-[12px] font-semibold text-ink">{t.name}</span>
                <span className="block truncate text-[11px] text-muted">{t.category}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="text-[12px] text-muted">
      {label}
      {children}
    </label>
  );
}

function ShapeIcon({ kind, sides, depth, rounding }: { kind: ShapeKind; sides: number; depth: number; rounding: number }) {
  const d = useMemo(() => {
    const S = shapeFunction({ kind, sides, depth, rounding });
    const pts: string[] = [];
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * 2 * Math.PI;
      const r = 14 * S(a);
      pts.push(`${(16 + r * Math.cos(a)).toFixed(1)},${(16 - r * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  }, [kind, sides, depth, rounding]);
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
      <polygon points={d} fill="currentColor" />
    </svg>
  );
}

const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: 'circle', label: 'Round' },
  { kind: 'polygon', label: 'Polygon' },
  { kind: 'star', label: 'Star' },
  { kind: 'flower', label: 'Flower' },
  { kind: 'gear', label: 'Gear' },
  { kind: 'squircle', label: 'Squircle' },
];
const PATTERNS: { kind: PatternKind; label: string }[] = [
  { kind: 'none', label: 'Smooth' },
  { kind: 'ribs', label: 'Ribs' },
  { kind: 'spiral', label: 'Spiral' },
  { kind: 'waves', label: 'Waves' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'bubbles', label: 'Bubbles' },
  { kind: 'noise', label: 'Organic' },
  { kind: 'steps', label: 'Steps' },
];

function DesignPanel() {
  const p = useVase((s) => s.params);
  const set = useVase((s) => s.setParams);
  const shape = (patch: Partial<VaseParams['shape']>) => set({ shape: { ...p.shape, ...patch } });
  const pattern = (patch: Partial<VaseParams['pattern']>) => set({ pattern: { ...p.pattern, ...patch } });
  const pk = p.pattern.kind;
  const scaleProfile = (f: number) => set({ profile: p.profile.map((q) => ({ ...q, r: Math.max(3, Math.round(q.r * f * 10) / 10) })) });
  return (
    <>
      <section className={section} aria-labelledby="vase-profile-heading">
        <h2 id="vase-profile-heading" className={heading}>
          Profile
        </h2>
        <ProfileEditor />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Field label="Height">
            <NumberField
              ariaLabel="Height (mm)"
              value={p.height}
              min={10}
              max={400}
              step={5}
              decimals={0}
              suffix="mm"
              onCommit={(v) => set({ height: v })}
            />
          </Field>
          <div className="flex items-end gap-1">
            <button
              type="button"
              className="h-9 flex-1 rounded-md border border-line text-[12px] font-medium hover:bg-[#f9fafb]"
              onClick={() => scaleProfile(0.9)}
              aria-label="Make narrower"
            >
              Narrower
            </button>
            <button
              type="button"
              className="h-9 flex-1 rounded-md border border-line text-[12px] font-medium hover:bg-[#f9fafb]"
              onClick={() => scaleProfile(1.1)}
              aria-label="Make wider"
            >
              Wider
            </button>
          </div>
        </div>
      </section>

      <section className={section} aria-labelledby="vase-shape-heading">
        <h2 id="vase-shape-heading" className={heading}>
          Cross-section
        </h2>
        <div className="grid grid-cols-6 gap-1" role="group" aria-label="Cross-section shape">
          {SHAPES.map((s) => (
            <button
              key={s.kind}
              type="button"
              title={s.label}
              aria-label={s.label}
              aria-pressed={p.shape.kind === s.kind}
              onClick={() => shape({ kind: s.kind })}
              className={`flex aspect-square items-center justify-center rounded-md border ${p.shape.kind === s.kind ? 'border-brand bg-brand-50 text-brand' : 'border-line text-[#344054] hover:bg-[#f9fafb]'}`}
            >
              <ShapeIcon
                kind={s.kind}
                sides={s.kind === 'squircle' ? 4 : p.shape.sides}
                depth={Math.max(0.2, p.shape.depth)}
                rounding={p.shape.rounding}
              />
            </button>
          ))}
        </div>
        {p.shape.kind !== 'circle' && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            {p.shape.kind !== 'squircle' && (
              <Field label="Sides">
                <NumberField
                  ariaLabel="Sides"
                  integer
                  value={p.shape.sides}
                  min={3}
                  max={40}
                  step={1}
                  decimals={0}
                  onCommit={(v) => shape({ sides: v })}
                />
              </Field>
            )}
            {['star', 'flower', 'gear'].includes(p.shape.kind) && (
              <Field label="Depth">
                <NumberField
                  ariaLabel="Shape depth (%)"
                  value={Math.round(p.shape.depth * 100)}
                  min={2}
                  max={60}
                  step={2}
                  decimals={0}
                  suffix="%"
                  onCommit={(v) => shape({ depth: v / 100 })}
                />
              </Field>
            )}
            <Field label="Rounding">
              <NumberField
                ariaLabel="Rounding (%)"
                value={Math.round(p.shape.rounding * 100)}
                min={0}
                max={100}
                step={5}
                decimals={0}
                suffix="%"
                onCommit={(v) => shape({ rounding: v / 100 })}
              />
            </Field>
          </div>
        )}
      </section>

      <section className={section} aria-labelledby="vase-twist-heading">
        <h2 id="vase-twist-heading" className={heading}>
          Twist
        </h2>
        <div className="grid grid-cols-[96px_1fr] items-end gap-2">
          <Field label="Angle">
            <NumberField
              ariaLabel="Twist (degrees)"
              value={p.twist}
              min={-720}
              max={720}
              step={15}
              decimals={0}
              suffix="°"
              onCommit={(v) => set({ twist: v })}
            />
          </Field>
          <Segmented
            label="Twist style"
            value={p.twistStyle}
            options={[
              { value: 'linear', label: 'Even' },
              { value: 'ease', label: 'Eased' },
              { value: 'wave', label: 'There & back' },
            ]}
            onChange={(v) => set({ twistStyle: v })}
          />
        </div>
      </section>

      <section className={section} aria-labelledby="vase-pattern-heading">
        <h2 id="vase-pattern-heading" className={heading}>
          Surface pattern
        </h2>
        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Surface pattern">
          {PATTERNS.map((x) => (
            <button
              key={x.kind}
              type="button"
              aria-pressed={pk === x.kind}
              onClick={() => pattern({ kind: x.kind })}
              className={`rounded-md border px-1 py-1.5 text-[12px] font-medium ${pk === x.kind ? 'border-brand bg-brand-50 text-brand' : 'border-line text-[#344054] hover:bg-[#f9fafb]'}`}
            >
              {x.label}
            </button>
          ))}
        </div>
        {pk !== 'none' && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Field label="Depth">
              <NumberField
                ariaLabel="Pattern depth (mm)"
                value={p.pattern.amplitude}
                min={-4}
                max={8}
                step={0.2}
                decimals={1}
                suffix="mm"
                onCommit={(v) => pattern({ amplitude: v })}
              />
            </Field>
            {['ribs', 'spiral', 'diamond', 'bubbles', 'noise'].includes(pk) && (
              <Field label="Count">
                <NumberField
                  ariaLabel="Pattern count"
                  integer
                  value={p.pattern.count}
                  min={2}
                  max={120}
                  step={1}
                  decimals={0}
                  onCommit={(v) => pattern({ count: v })}
                />
              </Field>
            )}
            {['waves', 'steps', 'noise'].includes(pk) && (
              <Field label="Rows">
                <NumberField
                  ariaLabel="Pattern rows"
                  value={p.pattern.rows}
                  min={1}
                  max={60}
                  step={1}
                  decimals={0}
                  onCommit={(v) => pattern({ rows: v })}
                />
              </Field>
            )}
            {['spiral', 'diamond'].includes(pk) && (
              <Field label="Turns">
                <NumberField
                  ariaLabel="Pattern turns"
                  value={p.pattern.turns}
                  min={0.1}
                  max={5}
                  step={0.1}
                  decimals={1}
                  onCommit={(v) => pattern({ turns: v })}
                />
              </Field>
            )}
            {pk !== 'noise' && (
              <Field label="Sharpness">
                <NumberField
                  ariaLabel="Pattern sharpness (%)"
                  value={Math.round(p.pattern.sharpness * 100)}
                  min={0}
                  max={100}
                  step={5}
                  decimals={0}
                  suffix="%"
                  onCommit={(v) => pattern({ sharpness: v / 100 })}
                />
              </Field>
            )}
            {pk === 'noise' && (
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => pattern({ seed: Math.floor(Math.random() * 10000) })}
                  className="flex h-9 w-full items-center justify-center gap-1 rounded-md border border-line text-[12px] font-medium hover:bg-[#f9fafb]"
                >
                  <Shuffle size={13} /> New
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className={section} aria-labelledby="vase-walls-heading">
        <h2 id="vase-walls-heading" className={heading}>
          Walls and base
        </h2>
        {p.type === 'vase' && <Toggle label="Vase mode (one spiral wall)" checked={p.vaseMode} onChange={(v) => set({ vaseMode: v })} />}
        {(p.type !== 'vase' || !p.vaseMode) && (
          <div className="mt-1 grid grid-cols-2 gap-2">
            <Field label="Wall">
              <NumberField
                ariaLabel="Wall thickness (mm)"
                value={p.wall}
                min={0.6}
                max={8}
                step={0.2}
                decimals={1}
                suffix="mm"
                onCommit={(v) => set({ wall: v })}
              />
            </Field>
            <Field label={p.type === 'lampshade' ? 'Top' : 'Base'}>
              <NumberField
                ariaLabel="Base thickness (mm)"
                value={p.base}
                min={0.8}
                max={15}
                step={0.2}
                decimals={1}
                suffix="mm"
                onCommit={(v) => set({ base: v })}
              />
            </Field>
          </div>
        )}
        {p.type === 'vase' && p.vaseMode && (
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Exports a solid; your slicer prints a single spiral wall. Turn off for real walls you can print normally.
          </p>
        )}
      </section>

      {p.type === 'pot' && (
        <section className={section} aria-labelledby="vase-pot-heading">
          <h2 id="vase-pot-heading" className={heading}>
            Planter
          </h2>
          <p className="mb-1 text-[12px] text-muted">Drainage holes</p>
          <Segmented
            label="Drainage holes"
            value={String(p.drainage.holes) as '0' | '1' | '5'}
            options={[
              { value: '0', label: 'None' },
              { value: '1', label: 'One' },
              { value: '5', label: 'Five' },
            ]}
            onChange={(v) => set({ drainage: { ...p.drainage, holes: Number(v) as 0 | 1 | 5 } })}
          />
          {p.drainage.holes > 0 && (
            <div className="mt-2 w-1/2">
              <Field label="Hole size">
                <NumberField
                  ariaLabel="Drainage hole diameter (mm)"
                  value={p.drainage.diameter}
                  min={3}
                  max={30}
                  step={1}
                  decimals={0}
                  suffix="mm"
                  onCommit={(v) => set({ drainage: { ...p.drainage, diameter: v } })}
                />
              </Field>
            </div>
          )}
          <Toggle label="Matching saucer" checked={p.saucer} onChange={(v) => set({ saucer: v })} />
        </section>
      )}
      {p.type === 'lampshade' && (
        <section className={section} aria-labelledby="vase-lamp-heading">
          <h2 id="vase-lamp-heading" className={heading}>
            Lampshade
          </h2>
          <Field label="Lamp-holder hole">
            <NumberField
              ariaLabel="Lamp-holder hole (mm)"
              value={p.bulbHole}
              min={10}
              max={80}
              step={1}
              decimals={0}
              suffix="mm"
              onCommit={(v) => set({ bulbHole: v })}
            />
          </Field>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">E27 holders need about 40–42 mm, E14 about 28–29 mm. Measure yours.</p>
        </section>
      )}
    </>
  );
}

function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function RightPanel() {
  const result = useVase((s) => s.result);
  const error = useVase((s) => s.error);
  const building = useVase((s) => s.building);
  const type = useVase((s) => s.params.type);
  const templateId = useVase((s) => s.templateId);
  const vaseMode = useVase((s) => s.params.type === 'vase' && s.params.vaseMode);
  const [exporting, setExporting] = useState(false);
  const name = VASE_TEMPLATES.find((t) => t.id === templateId)?.name ?? `My ${TYPE_LABEL[type].toLowerCase()}`;
  const slug = name
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const body = (p: VasePart) => ({ id: p.id, name: p.name, color: PART_COLOURS[p.id], mesh: p.mesh, watertight: p.watertight });
  const exportFine = async (what: '3mf' | VasePart['id']) => {
    setExporting(true);
    try {
      const fine = await buildFine();
      if (what === '3mf') download(write3mf(fine.parts.map(body), name), `${slug}.3mf`, 'model/3mf');
      else {
        const part = fine.parts.find((p) => p.id === what);
        if (part) download(new Uint8Array(writeBinaryStl([body(part)])), `${slug}-${what}.stl`, 'model/stl');
      }
    } finally {
      setExporting(false);
    }
  };
  const customise = () => {
    if (!result) return;
    useEditor.getState().importMeshes(
      result.parts.map((p) => ({ name: p.name, mesh: p.mesh })),
      { groupName: name },
    );
    useStudio.getState().setStudio('design');
  };
  const overhangTone = !result
    ? ''
    : result.maxOverhang > 60
      ? 'text-red-700'
      : result.maxOverhang > 45
        ? 'text-amber-700'
        : 'text-[#067647]';
  return (
    <aside
      className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-l border-line bg-white xl:w-[300px]"
      aria-label="Result"
      data-testid="vase-right"
    >
      <section className={section} aria-labelledby="vase-result-heading">
        <h2 id="vase-result-heading" className={`${heading} flex items-center gap-2`}>
          {name} {building && <Loader2 size={14} className="animate-spin text-brand" aria-label="updating" />}
        </h2>
        {error && (
          <p role="alert" className="flex gap-2 rounded-lg bg-red-50 p-2 text-[12px] text-red-800" data-testid="vase-error">
            <CircleAlert size={14} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}
        {result && (
          <>
            <dl className="grid grid-cols-[92px_1fr] gap-x-2 gap-y-1 text-[12px]" data-testid="vase-stats">
              <dt className="text-muted">Size</dt>
              <dd className={`${MONO} text-ink`}>
                ⌀{result.width.toFixed(0)} × {result.height.toFixed(0)} mm
              </dd>
              {type !== 'lampshade' && (
                <>
                  <dt className="text-muted">Holds</dt>
                  <dd className={`${MONO} text-ink`} data-testid="vase-capacity">
                    {vaseMode ? '≈ ' : ''}
                    {result.capacity >= 1000 ? `${(result.capacity / 1000).toFixed(2)} L` : `${Math.round(result.capacity)} ml`}
                  </dd>
                </>
              )}
              <dt className="text-muted">Steepest lean</dt>
              <dd className={`${MONO} ${overhangTone}`}>{Math.round(result.maxOverhang)}°</dd>
            </dl>
            <ul className="mt-3 flex flex-col gap-1.5" data-testid="vase-parts">
              {result.parts.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg bg-[#f9fafb] px-2.5 py-2 text-[12px]"
                  data-testid="vase-part"
                  data-part={p.id}
                >
                  <span className="h-3.5 w-3.5 shrink-0 rounded" style={{ background: PART_COLOURS[p.id] }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{p.name}</span>
                    <span className="text-muted">{p.size.map((v) => v.toFixed(0)).join(' × ')} mm</span>
                  </span>
                  {p.watertight ? (
                    <CircleCheck size={14} className="shrink-0 text-[#067647]" aria-label="closed solid" />
                  ) : (
                    <CircleAlert size={14} className="text-red-600" aria-label="not a closed solid" />
                  )}
                  <button
                    type="button"
                    disabled={exporting}
                    className="rounded-md px-1.5 py-1 font-medium text-brand hover:bg-brand-50 disabled:opacity-50"
                    aria-label={`Download ${p.name} as STL`}
                    onClick={() => void exportFine(p.id)}
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
                data-testid="vase-warning"
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
      </section>
      {result && (
        <section className="flex flex-col gap-2 p-4">
          <button
            type="button"
            data-testid="vase-download"
            disabled={exporting}
            onClick={() => void exportFine('3mf')}
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-brand text-[14px] font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Download (3MF)
          </button>
          <button
            type="button"
            onClick={customise}
            className="flex h-10 items-center justify-center gap-2 rounded-lg border border-line text-[13px] font-medium text-[#344054] hover:bg-[#f9fafb]"
          >
            <PencilRuler size={16} /> Customise in Design Studio
          </button>
          <p className="text-[11px] leading-relaxed text-muted">
            Downloads use a finer mesh than the preview. Vases for flowers: seal the inside or use a glass insert, as printed walls can
            weep.
          </p>
        </section>
      )}
    </aside>
  );
}

function Preview() {
  const result = useVase((s) => s.result);
  const group = useRef<THREE.Group>(null);
  const fit = useRef<() => void>(() => {});
  return (
    <div className="relative h-full w-full" data-testid="vase-viewport" role="region" aria-label="3D preview of the vase">
      <Canvas
        camera={{ position: [180, -260, 200], fov: 35, near: 0.5, far: 10000, up: [0, 0, 1] }}
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => gl.setClearColor('#f5f7fb')}
      >
        <hemisphereLight args={['#ffffff', '#b9c2d0', 1.5]} />
        <directionalLight position={[120, -160, 260]} intensity={1.7} />
        <directionalLight position={[-160, 120, 80]} intensity={0.5} />
        <gridHelper args={[600, 60, '#c9d1de', '#e3e8f0']} rotation={[Math.PI / 2, 0, 0]} />
        <group ref={group}>
          {result?.parts.map((p) => (
            <PartMesh key={`${p.id}-${p.mesh.indices.length}-${p.volume}`} part={p} />
          ))}
        </group>
        <FitControls
          target={group}
          fitRef={fit}
          contentKey={result ? `${result.parts.length}-${result.width.toFixed(0)}-${result.height.toFixed(0)}` : ''}
        />
      </Canvas>
      <div className="absolute right-3 top-3 rounded-xl bg-white/95 p-1 shadow-panel">
        <IconButton label="Fit in view" tooltipSide="left" onClick={() => fit.current()}>
          <Maximize size={17} />
        </IconButton>
      </div>
    </div>
  );
}

function PartMesh({ part }: { part: VasePart }) {
  const geometry = useMemo(() => meshDataToGeometry(part.mesh, (35 * Math.PI) / 180), [part.mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} name={part.id}>
      <meshStandardMaterial color={PART_COLOURS[part.id]} roughness={0.5} metalness={0.02} side={THREE.DoubleSide} />
    </mesh>
  );
}

function FitControls({
  target,
  fitRef,
  contentKey,
}: {
  target: React.RefObject<THREE.Group | null>;
  fitRef: React.MutableRefObject<() => void>;
  contentKey: string;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useEffect(() => {
    fitRef.current = () => {
      const c = controls.current;
      const g = target.current;
      if (!c || !g) return;
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const dist = (Math.max(sphere.radius, 1) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.08;
      c.target.copy(sphere.center);
      camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(0.45, -0.85, 0.42).normalize(), dist);
      camera.near = Math.max(0.05, dist / 1000);
      camera.far = dist * 50;
      camera.updateProjectionMatrix();
      c.update();
    };
    const id = requestAnimationFrame(() => fitRef.current());
    return () => cancelAnimationFrame(id);
  }, [contentKey, camera, target, fitRef]);
  return <OrbitControls ref={controls} makeDefault enableDamping={false} />;
}
