import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import { topLevel } from '@/cad/hierarchy';
import { JOINT_DOF } from '@/cad/assembly/joints';
import { NumberField } from '@/components/ui/NumberField';
import { Button } from '@/components/ui/Button';
import type { Joint, JointValue, Vec3 } from '@/types/document';
import { useAssemblyUi } from './assemblyUi';
import { JOINT_KINDS, VALUE_LABEL } from './JointDialog';

const iconBtn =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-canvas hover:text-ink disabled:opacity-40';
const RANGE: Record<JointValue, [number, number]> = { angle: [-180, 180], offset: [-100, 100], u: [-100, 100], v: [-100, 100] };

function JointRow({ joint }: { joint: Joint }) {
  const s = useEditor.getState();
  const doc = useEditor((st) => st.doc);
  const active = useAssemblyUi((st) => st.activeJoint === joint.id);
  const kind = JOINT_KINDS.find((k) => k.value === joint.kind)!;
  return (
    <li
      className={`rounded-xl border p-2 ${active ? 'border-brand bg-brand-50' : 'border-line'} ${joint.suppressed ? 'opacity-70' : ''}`}
      data-testid="joint-item"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => {
            useAssemblyUi.getState().setActiveJoint(active ? null : joint.id);
            s.select([joint.b]);
          }}
        >
          <span className={`block truncate text-[13px] font-semibold text-ink ${joint.suppressed ? 'line-through' : ''}`}>
            {joint.name}
          </span>
          <span className="block truncate text-[11px] text-muted">
            {kind.label} · {doc.objects[joint.a]?.name} → {doc.objects[joint.b]?.name}
          </span>
          {joint.placement && (
            <span
              className="block truncate text-[11px] text-accent-2"
              title={`${joint.placement.a.label} → ${joint.placement.b.label}`}
              data-testid="joint-placed-from"
            >
              From {joint.placement.a.label} → {joint.placement.b.label}
            </span>
          )}
        </button>
        <button
          type="button"
          className={iconBtn}
          aria-label={joint.suppressed ? `Turn ${joint.name} back on` : `Suppress ${joint.name}`}
          title={joint.suppressed ? 'Turn back on' : 'Suppress (the part moves freely)'}
          onClick={() => s.updateJoint(joint.id, { suppressed: !joint.suppressed })}
        >
          {joint.suppressed ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button type="button" className={iconBtn} aria-label={`Delete ${joint.name}`} onClick={() => s.removeJoint(joint.id)}>
          <Trash2 size={14} />
        </button>
      </div>
      {JOINT_DOF[joint.kind].map((k) => {
        const [lo, hi] = joint.limits?.[k] ?? RANGE[k];
        const v = joint.values[k] ?? 0;
        return (
          <div key={k} className="mt-1.5 grid grid-cols-[1fr_76px] items-center gap-2">
            <label className="min-w-0 text-[11px] text-ink-2">
              <span className="flex justify-between">
                <span>{VALUE_LABEL[k]}</span>
                {joint.limits?.[k] && (
                  <span className="text-muted">
                    {lo} … {hi}
                  </span>
                )}
              </span>
              <input
                type="range"
                min={lo}
                max={hi}
                step={k === 'angle' ? 1 : 0.5}
                value={v}
                disabled={joint.suppressed}
                aria-label={`${joint.name} ${VALUE_LABEL[k]} slider`}
                onChange={(e) => s.setJointValues(joint.id, { [k]: Number(e.target.value) })}
                className="w-full accent-[var(--color-brand)]"
              />
            </label>
            <NumberField
              ariaLabel={`${joint.name} ${VALUE_LABEL[k]}`}
              value={Math.round(v * 100) / 100}
              disabled={joint.suppressed}
              onCommit={(x) => s.setJointValues(joint.id, { [k]: x })}
            />
          </div>
        );
      })}
    </li>
  );
}

/** Joints between parts: add, drive, limit, suppress and delete. */
export function JointsSection() {
  const joints = useEditor((s) => s.doc.joints);
  const selection = useEditor((s) => s.selection);
  const doc = useEditor((s) => s.doc);
  const show = useAssemblyUi((s) => s.showJoints);
  const list = Object.values(joints ?? {});
  return (
    <section aria-label="Joints" className="border-t border-line px-3 py-3" data-testid="joints-section">
      <div className="mb-2 flex items-center gap-1 px-1">
        <h3 className="flex-1 text-[13px] font-semibold text-ink">Joints</h3>
        {list.length > 0 && (
          <button
            type="button"
            className={iconBtn}
            aria-label={show ? 'Hide joint symbols' : 'Show joint symbols'}
            onClick={() => useAssemblyUi.getState().setShowJoints(!show)}
          >
            {show ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        )}
        <Button
          size="sm"
          title="Connect two parts: pick a face or edge on each (J)"
          onClick={() => {
            const two = topLevel(doc, selection);
            useAssemblyUi.getState().setJointDialog(true, two.length === 2 ? [two[0], two[1]] : null);
          }}
          data-testid="add-joint"
        >
          <Plus size={13} /> Joint
        </Button>
      </div>
      {list.length === 0 ? (
        <p className="px-1 text-[12px] text-muted">Connect two parts with a hinge, slider or other joint: pick a face or edge on each.</p>
      ) : (
        <ul className="space-y-1.5" aria-label="Joints in this design">
          {list.map((j) => (
            <JointRow key={j.id} joint={j} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Exploded views: display-only arrangements that pull the assembly apart step by step. */
export function ExplodeSection() {
  const s = useEditor.getState();
  const views = useEditor((st) => st.doc.explodeViews);
  const explode = useEditor((st) => st.explode);
  const selection = useEditor((st) => st.selection);
  const doc = useEditor((st) => st.doc);
  const list = Object.values(views ?? {});
  const view = explode ? views?.[explode.viewId] : list[0];
  const picked = topLevel(doc, selection);
  const allTop = doc.rootIds.filter((id) => doc.objects[id]?.visible && !doc.objects[id]?.suppressed);
  return (
    <section aria-label="Exploded views" className="border-t border-line px-3 py-3" data-testid="explode-section">
      <div className="mb-2 flex items-center gap-1 px-1">
        <h3 className="flex-1 text-[13px] font-semibold text-ink">Exploded views</h3>
        <Button
          size="sm"
          disabled={(picked.length || allTop.length) < 2}
          title="Spread the selected parts (or everything) apart automatically"
          onClick={() => s.addExplodeView(picked.length >= 2 ? picked : allTop)}
          data-testid="auto-explode"
        >
          <Sparkles size={13} /> Auto
        </Button>
        <Button size="sm" variant="ghost" onClick={() => s.addExplodeView()} aria-label="New empty exploded view">
          <Plus size={13} />
        </Button>
      </div>
      {!view ? (
        <p className="px-1 text-[12px] text-muted">Show how the parts go together. Display only: the design itself doesn’t move.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <select
              aria-label="Exploded view"
              value={view.id}
              onChange={(e) => s.setExplode(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 text-[12px] text-ink-2"
            >
              {list.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <button type="button" className={iconBtn} aria-label={`Delete ${view.name}`} onClick={() => s.removeExplodeView(view.id)}>
              <Trash2 size={14} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={Math.max(1, view.steps.length)}
              step={0.01}
              value={explode?.viewId === view.id ? explode.progress : 0}
              aria-label="Explode progress"
              onChange={(e) => s.setExplode(view.id, Number(e.target.value))}
              className="min-w-0 flex-1 accent-[var(--color-brand)]"
              data-testid="explode-progress"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => s.setExplode(null)}
              data-testid="explode-reset"
              title="Show the assembled design"
            >
              <Undo2 size={13} /> Assembled
            </Button>
          </div>
          <ol className="space-y-1.5" aria-label="Explode steps">
            {view.steps.map((st, i) => (
              <li key={st.id} className="rounded-lg border border-line p-2" data-testid="explode-step">
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
                    <strong className="font-semibold text-ink">{i + 1}.</strong>{' '}
                    {st.name ?? st.objectIds.map((id) => doc.objects[id]?.name).join(', ')}
                  </span>
                  <button
                    type="button"
                    className={iconBtn}
                    aria-label={`Move step ${i + 1} earlier`}
                    disabled={i === 0}
                    onClick={() => s.moveExplodeStep(view.id, st.id, -1)}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    className={iconBtn}
                    aria-label={`Move step ${i + 1} later`}
                    disabled={i === view.steps.length - 1}
                    onClick={() => s.moveExplodeStep(view.id, st.id, 1)}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    className={iconBtn}
                    aria-label={`Delete step ${i + 1}`}
                    onClick={() => s.removeExplodeStep(view.id, st.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1">
                  {(['X', 'Y', 'Z'] as const).map((ax, k) => (
                    <NumberField
                      key={ax}
                      label={ax}
                      ariaLabel={`Step ${i + 1} offset ${ax}`}
                      value={st.offset[k]}
                      onCommit={(v) => s.updateExplodeStep(view.id, st.id, { offset: st.offset.map((c, j) => (j === k ? v : c)) as Vec3 })}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ol>
          <Button
            size="sm"
            className="w-full"
            disabled={!picked.length}
            onClick={() => s.addExplodeStep(view.id, picked, [0, 0, 20])}
            data-testid="add-explode-step"
          >
            <Plus size={13} /> Step from selection
          </Button>
        </div>
      )}
    </section>
  );
}
