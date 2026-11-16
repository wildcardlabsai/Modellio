import { useEffect, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Crosshair, Loader2 } from 'lucide-react';
import { NumberField } from '@/components/ui/NumberField';
import { Toggle } from '@/components/ui/Toggle';
import { featureTitle, pickMode, useFeatureTool, type FeatureKind, type FeatureSession } from './featureTool';
import { DockedPanel } from './DockedPanel';
import type { HolePattern, HoleSpec } from '@/cad/brep/types';
import type { Vec3 } from '@/types/document';

const COPY: Record<
  FeatureKind,
  { hint: string; field?: { label: string; aria: string; min: number; max: number; step: number; suffix: string } }
> = {
  fillet: {
    hint: 'Rounds the chosen edges with an exact radius.',
    field: { label: 'Radius', aria: 'Radius (mm)', min: 0.05, max: 1000, step: 0.5, suffix: 'mm' },
  },
  chamfer: {
    hint: 'Bevels the chosen edges with a flat cut.',
    field: { label: 'Distance', aria: 'Distance (mm)', min: 0.05, max: 1000, step: 0.5, suffix: 'mm' },
  },
  shell: {
    hint: 'Hollows the part, leaving walls of an even thickness. Click the faces to leave open (at least one), e.g. the top of a box.',
    field: { label: 'Walls', aria: 'Shell wall (mm)', min: 0.1, max: 1000, step: 0.2, suffix: 'mm' },
  },
  draft: {
    hint: 'Tapers the chosen faces so they lean inwards going up from the bottom of the part, e.g. so a cast or moulded part releases. Click the side faces to taper.',
    field: { label: 'Angle', aria: 'Draft angle (°)', min: 0.1, max: 44, step: 0.5, suffix: '°' },
  },
  hole: { hint: 'Drills an exact hole into a flat face. Click where it should go, then set its size.' },
};

const seg = (on: boolean) => `rounded-md px-2 py-1 text-[12px] font-medium ${on ? 'bg-panel text-brand-ink shadow-sm' : 'text-ink-2'}`;

function Radio<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-canvas p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={`${seg(value === o.value)} flex-1 disabled:opacity-40`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[1fr_130px] items-center gap-2">
    <span className="text-[12px] text-ink-2">{label}</span>
    {children}
  </div>
);

/** The feature panel docked over the 3D view while a feature tool is active. */
export function FeatureDialog() {
  const session = useFeatureTool((s) => s.session);
  const t = useFeatureTool.getState();

  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea')) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        useFeatureTool.getState().cancel();
      } else if (e.key === 'Enter') useFeatureTool.getState().apply();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [session]);

  if (!session) return null;
  const title = featureTitle(session.kind);
  const c = COPY[session.kind];
  const p = session.preview;
  const mode = pickMode(session.kind);
  const edgesOrFaces = mode === 'edges';
  const n = edgesOrFaces ? session.edges.length : session.faces.length;
  const idle =
    mode === 'point'
      ? session.hole.at
        ? 'Set the size to preview.'
        : 'Click a flat face to place the hole.'
      : n
        ? 'Set the size to preview.'
        : mode === 'edges'
          ? 'Pick at least one edge.'
          : session.kind === 'shell'
            ? 'Pick at least one face to leave open.'
            : 'Pick at least one face.';
  return (
    <DockedPanel
      label={mode === 'edges' ? `${title} edges` : title}
      testId="feature-dialog"
      title={session.editingOpId ? `Edit ${title.toLowerCase()}` : title}
      action={
        mode === 'edges' ? (
          <div role="radiogroup" aria-label="Operation" className="flex rounded-lg bg-canvas p-0.5">
            {(['fillet', 'chamfer'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={session.kind === k}
                onClick={() => t.setKind(k)}
                className={`rounded-md px-2 py-1 text-[12px] font-medium ${session.kind === k ? 'bg-panel text-brand-ink shadow-sm' : 'text-ink-2'}`}
              >
                {featureTitle(k)}
              </button>
            ))}
          </div>
        ) : undefined
      }
      description={
        mode === 'edges' ? (
          <>
            {c.hint} Click edges on the part to choose them (amber: under the cursor, red: chosen). Edges that continue smoothly from a
            chosen edge are included too.
          </>
        ) : (
          c.hint
        )
      }
      footer={
        <>
          <p
            className={`flex min-h-[20px] items-start gap-1.5 text-[12px] ${p.state === 'error' ? 'text-red-700' : p.state === 'ok' ? 'text-emerald-700' : 'text-muted'}`}
            role="status"
            data-testid="feature-status"
          >
            {p.state === 'building' && (
              <>
                <Loader2 size={14} className="mt-px shrink-0 animate-spin" /> Building preview…
              </>
            )}
            {p.state === 'ok' && (
              <>
                <CircleCheck size={14} className="mt-px shrink-0" /> Preview ready · volume {(p.build!.volume / 1000).toFixed(3)} cm³
              </>
            )}
            {p.state === 'error' && (
              <>
                <CircleAlert size={14} className="mt-px shrink-0" /> {p.message}
              </>
            )}
            {p.state === 'idle' && idle}
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={t.cancel}
              className="h-8 rounded-lg border border-line px-3 text-[13px] font-medium text-ink-2 hover:bg-canvas"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={t.apply}
              disabled={p.state !== 'ok'}
              className="h-8 rounded-lg bg-brand px-4 text-[13px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
              data-testid="feature-apply"
            >
              Apply
            </button>
          </div>
        </>
      }
    >
      {mode === 'point' ? (
        <HoleFields session={session} />
      ) : (
        <div className="grid grid-cols-[1fr_130px] items-center gap-2">
          <span className="text-[13px] font-medium text-ink-2" data-testid={mode === 'edges' ? 'feature-edge-count' : 'feature-face-count'}>
            {mode === 'edges'
              ? n
                ? `${n} edge${n === 1 ? '' : 's'} selected`
                : 'No edges selected'
              : n
                ? `${n} face${n === 1 ? '' : 's'} ${session.kind === 'shell' ? 'open' : 'selected'}`
                : 'No faces selected'}
          </span>
          <NumberField
            ariaLabel={c.field!.aria}
            value={session.value}
            onCommit={t.setValue}
            min={c.field!.min}
            max={c.field!.max}
            step={c.field!.step}
            decimals={2}
            suffix={c.field!.suffix}
          />
        </div>
      )}
    </DockedPanel>
  );
}

/** The real-space normal of the hole's face (its reference is stored in normalised space). */
function faceNormal(s: FeatureSession): Vec3 | null {
  const f = s.hole.face;
  const half = s.before?.half;
  if (!f || !half) return null;
  const v = [f.normal[0] / half[0], f.normal[1] / half[1], f.normal[2] / half[2]];
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l) as Vec3;
}

const AXES: { value: 'x' | 'y' | 'z'; label: string; dir: Vec3 }[] = [
  { value: 'x', label: 'X', dir: [1, 0, 0] },
  { value: 'y', label: 'Y', dir: [0, 1, 0] },
  { value: 'z', label: 'Z', dir: [0, 0, 1] },
];

function HoleFields({ session }: { session: FeatureSession }) {
  const t = useFeatureTool.getState();
  const h = session.hole.spec;
  const set = (patch: Partial<HoleSpec>) => t.setHole(patch);
  const pattern = session.hole.pattern;
  const normal = faceNormal(session);
  const half = session.before?.half;
  const at = session.hole.at;
  const mm = at && half ? at.map((v, i) => v * half[i]) : null;
  const along = (d: Vec3) => (normal ? Math.abs(d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2]) > 0.9 : false);
  const axisOf = (p: HolePattern | undefined) =>
    p?.kind === 'linear' ? (AXES.find((a) => a.dir.every((v, i) => v === p.dir[i]))?.value ?? 'x') : 'x';
  const firstAxis = AXES.find((a) => !along(a.dir)) ?? AXES[0];
  const num = (
    aria: string,
    value: number,
    onCommit: (v: number) => void,
    min: number,
    max: number,
    step: number,
    suffix: string,
    decimals = 2,
  ) => (
    <NumberField ariaLabel={aria} value={value} onCommit={onCommit} min={min} max={max} step={step} decimals={decimals} suffix={suffix} />
  );
  return (
    <>
      <p className="flex items-start gap-1.5 rounded-lg bg-canvas px-2.5 py-2 text-[12px] text-ink-2" data-testid="hole-position">
        <Crosshair size={14} className="mt-px shrink-0 text-brand-ink" />
        {mm
          ? `At ${mm.map((v) => v.toFixed(2)).join(', ')} mm from the part's centre. Click elsewhere on a flat face to move it.`
          : 'Click a flat face on the part to place the hole.'}
      </p>
      {session.hole.face && (
        <button
          type="button"
          onClick={() => t.placeHole(session.hole.face!, session.hole.face!.centre)}
          className="w-full rounded-lg border border-line py-1.5 text-[12px] font-medium text-ink-2 hover:border-brand hover:text-brand-ink"
        >
          Centre on the face
        </button>
      )}
      <Radio
        label="Hole style"
        value={h.style}
        options={[
          { value: 'simple', label: 'Simple' },
          { value: 'counterbore', label: 'Counterbore' },
          { value: 'countersink', label: 'Countersink' },
        ]}
        onChange={(style) => set({ style })}
      />
      <Row label="Diameter">{num('Hole diameter (mm)', h.diameter, (diameter) => set({ diameter }), 0.1, 500, 0.5, 'mm')}</Row>
      <Toggle label="Through all" checked={h.depth === 0} onChange={(v) => set({ depth: v ? 0 : 5 })} />
      {h.depth > 0 && <Row label="Depth">{num('Hole depth (mm)', h.depth, (depth) => set({ depth }), 0.1, 1000, 0.5, 'mm')}</Row>}
      {h.style === 'counterbore' && (
        <>
          <Row label="Counterbore Ø">
            {num('Counterbore diameter (mm)', h.cbDiameter ?? h.diameter * 2, (cbDiameter) => set({ cbDiameter }), 0.1, 500, 0.5, 'mm')}
          </Row>
          <Row label="Counterbore depth">
            {num('Counterbore depth (mm)', h.cbDepth ?? 2, (cbDepth) => set({ cbDepth }), 0.1, 500, 0.5, 'mm')}
          </Row>
        </>
      )}
      {h.style === 'countersink' && (
        <>
          <Row label="Countersink Ø">
            {num('Countersink diameter (mm)', h.csDiameter ?? h.diameter * 2, (csDiameter) => set({ csDiameter }), 0.1, 500, 0.5, 'mm')}
          </Row>
          <Row label="Countersink angle">
            {num('Countersink angle (°)', h.csAngle ?? 90, (csAngle) => set({ csAngle }), 1, 179, 1, '°', 0)}
          </Row>
        </>
      )}
      <Radio
        label="Hole pattern"
        value={pattern?.kind ?? 'none'}
        options={[
          { value: 'none', label: 'One' },
          { value: 'linear', label: 'Row' },
          { value: 'circular', label: 'Circle' },
        ]}
        onChange={(k) =>
          t.setPattern(
            k === 'none'
              ? undefined
              : k === 'linear'
                ? { kind: 'linear', count: 3, spacing: Math.max(h.diameter * 2, 5), dir: firstAxis.dir }
                : { kind: 'circular', count: 6, angle: 360, centre: session.hole.face?.centre ?? [0, 0, 0] },
          )
        }
      />
      {pattern && (
        <Row label="Copies">
          {num('Number of holes', pattern.count, (v) => t.setPattern({ ...pattern, count: Math.max(1, Math.round(v)) }), 1, 100, 1, '', 0)}
        </Row>
      )}
      {pattern?.kind === 'linear' && (
        <>
          <Row label="Spacing">
            {num('Hole spacing (mm)', pattern.spacing, (spacing) => t.setPattern({ ...pattern, spacing }), -1000, 1000, 1, 'mm')}
          </Row>
          <Row label="Direction">
            <Radio
              label="Row direction"
              value={axisOf(pattern)}
              options={AXES.map((a) => ({ value: a.value, label: a.label, disabled: along(a.dir) }))}
              onChange={(v) => t.setPattern({ ...pattern, dir: AXES.find((a) => a.value === v)!.dir })}
            />
          </Row>
        </>
      )}
      {pattern?.kind === 'circular' && (
        <>
          <Row label="Over">
            {num('Pattern angle (°)', pattern.angle, (angle) => t.setPattern({ ...pattern, angle }), 1, 360, 15, '°', 0)}
          </Row>
          <p className="text-[11px] leading-snug text-muted">The holes go round the centre of the face the first one is on.</p>
        </>
      )}
    </>
  );
}
