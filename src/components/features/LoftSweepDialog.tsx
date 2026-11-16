import { CircleAlert, CircleCheck, Loader2, Plus, Trash2 } from 'lucide-react';
import { NumberField } from '@/components/ui/NumberField';
import { SketchEditor, type SketchUse } from '@/components/sketch/SketchEditor';
import { sketchOutlines, sketchPath } from '@/cad/brep/build';
import type { Sketch } from '@/cad/sketch/types';
import { SketchThumb } from './SketchThumb';
import { DockedPanel } from './DockedPanel';
import { useSolidBuilder, type BuilderSession, type LoftBase, type SweepBase } from './solidBuilder';

/** One closed outline, as loft sections and sweep profiles need. */
const oneOutline = (s: Sketch) => {
  const o = sketchOutlines(s);
  const n = o.chains.length + o.circles.length;
  return n === 1
    ? null
    : n === 0
      ? 'Draw one closed outline (lines, arcs and splines that join up, or a circle).'
      : `Use a single outline (this sketch has ${n}).`;
};
const onePath = (s: Sketch) => {
  const p = sketchPath(s);
  return typeof p === 'string' ? p : null;
};

const segBtn = (on: boolean) => `rounded-md px-2.5 py-1 text-[12px] font-medium ${on ? 'bg-panel text-brand-ink shadow-sm' : 'text-ink-2'}`;

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-ink-2">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-canvas p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={segBtn(value === o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The Loft / Sweep panel over the 3D view, plus the sketch editor when a sketch is being edited. */
export function LoftSweepDialog() {
  const session = useSolidBuilder((s) => s.session);
  if (!session) return null;
  const b = useSolidBuilder.getState();
  const isLoft = session.base.kind === 'loft';
  return (
    <>
      <DockedPanel
        label={isLoft ? 'Loft' : 'Sweep'}
        testId="loft-sweep-dialog"
        title={`${session.editingId ? 'Edit ' : ''}${isLoft ? 'Loft' : 'Sweep'}`}
        description={
          isLoft
            ? 'A solid that blends from one cross-section to the next, bottom to top. Each section is a sketch with one closed outline.'
            : 'A profile (one closed outline) moved along a path (lines, arcs and splines, open or closed). The profile’s origin sits on the path.'
        }
        footer={<Footer session={session} onCancel={b.cancel} onApply={b.apply} />}
      >
        {session.base.kind === 'loft' ? <LoftFields base={session.base} /> : <SweepFields base={session.base} />}
      </DockedPanel>
      {session.sketching && <SketchFor session={session} />}
    </>
  );
}

function LoftFields({ base }: { base: LoftBase }) {
  const b = useSolidBuilder.getState();
  const set = (i: number, patch: Partial<LoftBase['sections'][number]>) =>
    b.setSections(base.sections.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  return (
    <>
      <ol className="space-y-2" aria-label="Sections, bottom to top" data-testid="loft-sections">
        {base.sections.map((sec, i) => (
          <li key={i} className="flex gap-2 rounded-lg border border-line p-2" data-testid="loft-section">
            <button
              type="button"
              onClick={() => b.startSketch({ kind: 'section', index: i })}
              title="Edit this section's sketch"
              className="hover:opacity-80"
            >
              <SketchThumb sketch={sec.sketch} label={`Section ${i + 1} sketch`} />
            </button>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-ink">Section {i + 1}</span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => b.startSketch({ kind: 'section', index: i })}
                    className="rounded px-1.5 text-[12px] text-brand-ink hover:bg-brand-50"
                  >
                    Edit sketch
                  </button>
                  {base.sections.length > 2 && (
                    <button
                      type="button"
                      aria-label={`Remove section ${i + 1}`}
                      onClick={() => b.setSections(base.sections.filter((_, k) => k !== i))}
                      className="rounded p-1 text-ink-3 hover:text-red-600"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </span>
              </div>
              <NumberField
                label="H"
                ariaLabel={`Section ${i + 1} height (mm)`}
                value={sec.height}
                onCommit={(v) => set(i, { height: v })}
                min={-1000}
                max={1000}
                step={1}
                decimals={2}
                suffix="mm"
              />
              <div className="grid grid-cols-2 gap-1.5">
                <NumberField
                  label="X"
                  ariaLabel={`Section ${i + 1} shift X (mm)`}
                  value={sec.offset[0]}
                  onCommit={(v) => set(i, { offset: [v, sec.offset[1]] })}
                  min={-1000}
                  max={1000}
                  step={1}
                  decimals={2}
                />
                <NumberField
                  label="Y"
                  ariaLabel={`Section ${i + 1} shift Y (mm)`}
                  value={sec.offset[1]}
                  onCommit={(v) => set(i, { offset: [sec.offset[0], v] })}
                  min={-1000}
                  max={1000}
                  step={1}
                  decimals={2}
                />
              </div>
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => {
          const last = base.sections[base.sections.length - 1];
          b.setSections([...base.sections, { sketch: structuredClone(last.sketch), height: last.height + 10, offset: [...last.offset] }]);
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-1.5 text-[12px] font-medium text-ink-2 hover:border-brand hover:text-brand-ink"
        data-testid="loft-add-section"
      >
        <Plus size={14} /> Add section
      </button>
      <Choice
        label="Between sections"
        value={base.ruled ? 'ruled' : 'smooth'}
        options={[
          { value: 'smooth', label: 'Smooth' },
          { value: 'ruled', label: 'Straight' },
        ]}
        onChange={(v) => b.update((x) => (x.kind === 'loft' ? { ...x, ruled: v === 'ruled' } : x))}
      />
    </>
  );
}

function SweepFields({ base }: { base: SweepBase }) {
  const b = useSolidBuilder.getState();
  const upd = (patch: Partial<SweepBase>) => b.update((x) => (x.kind === 'sweep' ? { ...x, ...patch } : x));
  const row = (title: string, sketch: Sketch, target: 'profile' | 'path', testId: string) => (
    <div className="flex items-center gap-2 rounded-lg border border-line p-2">
      <SketchThumb sketch={sketch} label={`${title} sketch`} />
      <div className="flex-1">
        <p className="text-[12px] font-semibold text-ink">{title}</p>
        <button
          type="button"
          onClick={() => b.startSketch({ kind: target })}
          className="mt-1 rounded px-1.5 text-[12px] text-brand-ink hover:bg-brand-50"
          data-testid={testId}
        >
          Edit sketch
        </button>
      </div>
    </div>
  );
  return (
    <>
      {row('Profile', base.profile, 'profile', 'sweep-edit-profile')}
      {row('Path', base.path, 'path', 'sweep-edit-path')}
      <Choice
        label="Path drawn"
        value={base.pathPlane}
        options={[
          { value: 'XZ', label: 'Upright' },
          { value: 'XY', label: 'Flat' },
        ]}
        onChange={(v) => upd({ pathPlane: v })}
      />
      <Choice
        label="Corners"
        value={base.corners}
        options={[
          { value: 'round', label: 'Round' },
          { value: 'sharp', label: 'Sharp' },
        ]}
        onChange={(v) => upd({ corners: v })}
      />
      <Choice
        label="Profile turns"
        value={base.orientation}
        options={[
          { value: 'follow', label: 'With the path' },
          { value: 'frenet', label: 'Frenet' },
        ]}
        onChange={(v) => upd({ orientation: v })}
      />
      <p className="text-[11px] leading-snug text-muted">
        “With the path” suits most shapes; Frenet keeps the profile turning with the path’s curvature (for spirals).
      </p>
    </>
  );
}

function Footer({ session, onCancel, onApply }: { session: BuilderSession; onCancel: () => void; onApply: () => void }) {
  const p = session.preview;
  return (
    <div>
      <p
        className={`flex min-h-[20px] items-start gap-1.5 text-[12px] ${p.state === 'error' ? 'text-red-700' : p.state === 'ok' ? 'text-emerald-700' : 'text-muted'}`}
        role="status"
        data-testid="loft-sweep-status"
      >
        {p.state === 'building' && (
          <>
            <Loader2 size={14} className="mt-px shrink-0 animate-spin" /> Building preview…
          </>
        )}
        {p.state === 'ok' && p.build && (
          <>
            <CircleCheck size={14} className="mt-px shrink-0" /> Preview: {p.build.size.map((v) => v.toFixed(1)).join(' × ')} mm ·{' '}
            {(p.build.volume / 1000).toFixed(3)} cm³
          </>
        )}
        {p.state === 'error' && (
          <>
            <CircleAlert size={14} className="mt-px shrink-0" /> {p.message}
          </>
        )}
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-lg border border-line px-3 text-[13px] font-medium text-ink-2 hover:bg-canvas"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={p.state !== 'ok'}
          className="h-8 rounded-lg bg-brand px-4 text-[13px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          data-testid="loft-sweep-apply"
        >
          {session.editingId ? 'Update' : 'Create'}
        </button>
      </div>
    </div>
  );
}

function SketchFor({ session }: { session: BuilderSession }) {
  const b = useSolidBuilder.getState();
  const t = session.sketching!;
  const base = session.base;
  let use: SketchUse;
  if (t.kind === 'section' && base.kind === 'loft')
    use = {
      title: `Loft section ${t.index + 1}`,
      initial: base.sections[t.index].sketch,
      hint: 'Draw one closed outline. The origin (where the red and green axes cross) lines up between sections.',
      check: oneOutline,
      onDone: b.finishSketch,
    };
  else if (t.kind === 'profile' && base.kind === 'sweep')
    use = {
      title: 'Sweep profile',
      initial: base.profile,
      hint: 'Draw one closed outline. Its origin is placed on the start of the path, square to it.',
      check: oneOutline,
      onDone: b.finishSketch,
    };
  else if (base.kind === 'sweep')
    use = {
      title: 'Sweep path',
      initial: base.path,
      hint: 'Draw one connected chain of lines, arcs and splines (open or closed), or a single circle. The sweep starts at its first end.',
      check: onePath,
      onDone: b.finishSketch,
    };
  else return null;
  return <SketchEditor key={JSON.stringify(t)} objectId={null} onClose={b.cancelSketch} use={use} />;
}
