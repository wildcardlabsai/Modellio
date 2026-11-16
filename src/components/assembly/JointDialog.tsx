import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { ArrowLeftRight, Crosshair } from 'lucide-react';
import { Segmented } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { NumberField } from '@/components/ui/NumberField';
import { Toggle } from '@/components/ui/Toggle';
import { DockedPanel } from '@/components/features/DockedPanel';
import { useEditor } from '@/store/editorStore';
import { topLevel, worldBoundsOf } from '@/cad/hierarchy';
import { JOINT_DOF, jointProblem } from '@/cad/assembly/joints';
import type { Joint, JointKind, JointValue, Vec3 } from '@/types/document';
import { useAssemblyUi, type PickedRef } from './assemblyUi';
import { draftResult } from './jointDraft';

export const JOINT_KINDS: { value: JointKind; label: string; help: string }[] = [
  { value: 'rigid', label: 'Rigid', help: 'Locks the moving part to the fixed one: they move as one.' },
  { value: 'revolute', label: 'Hinge', help: 'Turns about the axis (revolute), like a door or a lid.' },
  { value: 'slider', label: 'Slider', help: 'Slides along the axis, like a drawer.' },
  { value: 'cylindrical', label: 'Cylinder', help: 'Turns about and slides along the axis, like a piston.' },
  { value: 'planar', label: 'Planar', help: 'Slides in the plane across the axis and turns in it.' },
];
export const VALUE_LABEL: Record<JointValue, string> = { angle: 'Angle (°)', offset: 'Slide (mm)', u: 'Across (mm)', v: 'Along (mm)' };
const DEFAULT_LIMIT: Record<JointValue, [number, number]> = { angle: [0, 90], offset: [0, 30], u: [-20, 20], v: [-20, 20] };

/**
 * New joint (docked beside the 3D view, so faces can be clicked). "From faces": click a face or
 * edge on the fixed part, then one on the moving part; the moving part is mated onto the fixed
 * one (flat faces meet, axes line up), with reverse, gap and turn, previewed before it is made.
 * "Quick axis": an X/Y/Z axis through a part's centre.
 */
export function JointDialog() {
  const close = () => useAssemblyUi.getState().setJointDialog(false);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const draft = useAssemblyUi((s) => s.draft);
  const patch = useAssemblyUi((s) => s.patchDraft);
  const [limited, setLimited] = useState(true);
  const [limits, setLimits] = useState<Joint['limits']>({ ...DEFAULT_LIMIT });
  // Quick axis.
  const [swap, setSwap] = useState(false);
  const [axis, setAxis] = useState<'x' | 'y' | 'z'>('z');
  const [at, setAt] = useState<'b' | 'a' | 'between'>('between');
  const kind = draft.kind;
  // Esc stops picking, then closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const ui = useAssemblyUi.getState();
      if (ui.draft.target) ui.patchDraft({ target: null });
      else ui.setJointDialog(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const lim = limited && JOINT_DOF[kind].length ? Object.fromEntries(JOINT_DOF[kind].map((k) => [k, limits![k]!])) : undefined;

  // Faces.
  const result = draftResult(doc, draft, kind);
  // Quick axis: the chosen parts, or the two selected ones.
  const picked = draft.partA && draft.partB ? [draft.partA, draft.partB] : topLevel(doc, selection);
  const [qa, qb] = swap ? [picked[1], picked[0]] : [picked[0], picked[1]];
  const quickWhy =
    picked.length !== 2
      ? 'Select exactly two parts: the fixed one first, then the one that moves.'
      : jointProblem(doc, { id: '', name: 'This joint', a: qa, b: qb });

  const create = () => {
    const s = useEditor.getState();
    let id: string | null;
    if (draft.mode === 'faces') {
      if (result.state !== 'ok' || !draft.a || !draft.b) return;
      id = s.addJoint({
        kind,
        a: result.partA,
        b: result.partB,
        limits: lim,
        frames: { frameA: result.frameA, frameB: result.frameB, ...(result.moved ? { worldB: result.worldB.toArray() as number[] } : {}) },
        placement: { a: draft.a.ref, b: draft.b.ref, flip: draft.flip, offset: draft.offset, angle: draft.angle },
      });
    } else {
      const ca = worldBoundsOf(doc, [qa]).getCenter(new THREE.Vector3());
      const cb = worldBoundsOf(doc, [qb]).getCenter(new THREE.Vector3());
      const origin = (at === 'a' ? ca : at === 'b' ? cb : ca.clone().add(cb).multiplyScalar(0.5)).toArray() as Vec3;
      id = s.addJoint({ kind, a: qa, b: qb, axis, origin, limits: lim });
    }
    if (id) {
      useAssemblyUi.getState().setActiveJoint(id);
      close();
    }
  };
  const ready = draft.mode === 'faces' ? result.state === 'ok' : !quickWhy;

  return (
    <DockedPanel
      label="New joint"
      testId="joint-dialog"
      title="New joint"
      description={JOINT_KINDS.find((k) => k.value === kind)!.help}
      footer={
        <div>
          <p
            className={`mb-2 min-h-[18px] text-[12px] ${
              (draft.mode === 'faces' ? result.state === 'error' : !!quickWhy)
                ? 'text-amber-700'
                : result.state === 'ok'
                  ? 'text-emerald-700'
                  : 'text-muted'
            }`}
            role="status"
            data-testid="joint-why"
          >
            {draft.mode === 'faces' ? (result.state === 'ok' ? okText(doc, result) : result.message) : (quickWhy ?? 'Ready.')}
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={!ready} onClick={create} data-testid="joint-create">
              Create joint
            </Button>
          </div>
        </div>
      }
    >
      <Segmented label="Joint kind" value={kind} onChange={(k) => patch({ kind: k })} options={JOINT_KINDS} />
      <Segmented
        label="Place the joint"
        value={draft.mode}
        onChange={(m) => patch({ mode: m, target: m === 'faces' ? (draft.a ? (draft.b ? null : 'b') : 'a') : null })}
        options={[
          { value: 'faces', label: 'From faces' },
          { value: 'quick', label: 'Quick axis' },
        ]}
      />
      {draft.mode === 'faces' ? (
        <>
          <RefRow which="a" title="Fixed part" picked={draft.a} active={draft.target === 'a'} />
          <div className="-my-1 flex justify-center">
            <button
              type="button"
              aria-label="Swap the fixed and moving parts"
              title="Swap: the other part stays put"
              onClick={() => patch({ a: draft.b, b: draft.a, partA: draft.partB, partB: draft.partA })}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-canvas hover:text-ink"
            >
              <ArrowLeftRight size={14} className="rotate-90" />
            </button>
          </div>
          <RefRow which="b" title="Moving part" picked={draft.b} active={draft.target === 'b'} />
          <div className="space-y-1">
            <Toggle label="Move the moving part onto the fixed part" checked={draft.snap} onChange={(v) => patch({ snap: v })} />
            <Toggle label="Reverse direction" checked={draft.flip} onChange={(v) => patch({ flip: v })} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px] text-ink-2">
            <label className="space-y-1">
              <span>Gap along the axis</span>
              <NumberField
                ariaLabel="Joint gap"
                value={draft.offset}
                suffix="mm"
                onCommit={(v) => patch({ offset: v })}
                disabled={!draft.snap}
              />
            </label>
            <label className="space-y-1">
              <span>Turn about the axis</span>
              <NumberField
                ariaLabel="Joint turn"
                value={draft.angle}
                suffix="°"
                step={15}
                onCommit={(v) => patch({ angle: v })}
                disabled={!draft.snap}
              />
            </label>
          </div>
        </>
      ) : (
        <QuickAxis
          a={qa}
          b={qb}
          swap={() => setSwap(!swap)}
          axis={axis}
          setAxis={setAxis}
          at={at}
          setAt={setAt}
          planar={kind === 'planar'}
          rigid={kind === 'rigid'}
        />
      )}
      {JOINT_DOF[kind].length > 0 && (
        <div>
          <Toggle label="Limit the motion" checked={limited} onChange={setLimited} />
          {limited && (
            <div className="mt-2 space-y-2">
              {JOINT_DOF[kind].map((k) => (
                <div key={k} className="grid grid-cols-[1fr_76px_76px] items-center gap-2 text-[12px] text-ink-2">
                  <span>{VALUE_LABEL[k]}</span>
                  <NumberField
                    ariaLabel={`${VALUE_LABEL[k]} minimum`}
                    value={limits![k]![0]}
                    onCommit={(v) => setLimits({ ...limits, [k]: [Math.min(v, limits![k]![1]), limits![k]![1]] })}
                  />
                  <NumberField
                    ariaLabel={`${VALUE_LABEL[k]} maximum`}
                    value={limits![k]![1]}
                    onCommit={(v) => setLimits({ ...limits, [k]: [limits![k]![0], Math.max(v, limits![k]![0])] })}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </DockedPanel>
  );
}

function okText(doc: ReturnType<typeof useEditor.getState>['doc'], r: Extract<ReturnType<typeof draftResult>, { state: 'ok' }>) {
  const a = doc.objects[r.partA]?.name;
  const b = doc.objects[r.partB]?.name;
  return r.moved ? `Ready: ${b} moves onto ${a} (shown see-through).` : `Ready: ${b} stays where it is, jointed to ${a}.`;
}

/** One picked reference, with a button to pick it (again). */
function RefRow({ which, title, picked, active }: { which: 'a' | 'b'; title: string; picked: PickedRef | null; active: boolean }) {
  const doc = useEditor((s) => s.doc);
  const patch = useAssemblyUi((s) => s.patchDraft);
  const unsuitable = picked?.geom.kind === 'none';
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${active ? 'border-brand bg-brand-50' : 'border-line'}`}
      data-testid={`joint-ref-${which}`}
      data-picked={picked ? 'true' : 'false'}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${which === 'a' ? 'bg-cyan-400' : 'bg-pink-400'}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] uppercase tracking-wide text-muted">
            {title}
            {picked ? ` · ${doc.objects[picked.part]?.name}` : ''}
          </span>
          <span
            className={`block truncate text-[12px] ${unsuitable ? 'text-amber-700' : 'text-ink'}`}
            data-testid={`joint-ref-${which}-label`}
          >
            {picked ? picked.geom.label : active ? 'Click a face or edge in the 3D view…' : 'Not picked yet'}
          </span>
        </span>
        <Button
          size="sm"
          variant={active ? 'primary' : 'secondary'}
          aria-label={`Pick the ${title.toLowerCase()}'s face or edge`}
          onClick={() => patch({ target: active ? null : which })}
        >
          <Crosshair size={13} /> {active ? 'Picking' : picked ? 'Change' : 'Pick'}
        </Button>
      </div>
      {unsuitable && picked.geom.kind === 'none' && <p className="mt-1 text-[11px] text-amber-700">{picked.geom.why}</p>}
    </div>
  );
}

function QuickAxis(p: {
  a: string | undefined;
  b: string | undefined;
  swap: () => void;
  axis: 'x' | 'y' | 'z';
  setAxis: (a: 'x' | 'y' | 'z') => void;
  at: 'b' | 'a' | 'between';
  setAt: (a: 'b' | 'a' | 'between') => void;
  planar: boolean;
  rigid: boolean;
}) {
  const doc = useEditor((s) => s.doc);
  return (
    <>
      <div className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-[13px]">
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] uppercase tracking-wide text-muted">Fixed part</span>
          <span className="block truncate font-semibold text-ink" data-testid="joint-a">
            {p.a ? doc.objects[p.a]?.name : '—'}
          </span>
        </span>
        <button
          type="button"
          aria-label="Swap the fixed and moving parts"
          onClick={p.swap}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 hover:bg-panel hover:text-ink"
        >
          <ArrowLeftRight size={15} />
        </button>
        <span className="min-w-0 flex-1 text-right">
          <span className="block text-[11px] uppercase tracking-wide text-muted">Moving part</span>
          <span className="block truncate font-semibold text-ink" data-testid="joint-b">
            {p.b ? doc.objects[p.b]?.name : '—'}
          </span>
        </span>
      </div>
      {!p.rigid && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-ink-2">{p.planar ? 'Plane normal' : 'Axis'}</p>
            <Segmented
              label="Joint axis"
              value={p.axis}
              onChange={p.setAxis}
              options={[
                { value: 'x', label: 'X' },
                { value: 'y', label: 'Y' },
                { value: 'z', label: 'Z' },
              ]}
            />
          </div>
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-ink-2">Through</p>
            <select
              aria-label="Joint origin"
              value={p.at}
              onChange={(e) => p.setAt(e.target.value as typeof p.at)}
              className="h-9 w-full rounded-lg border border-line bg-panel px-2 text-[12px] text-ink-2"
            >
              <option value="between">Between the parts</option>
              <option value="a">Centre of the fixed part</option>
              <option value="b">Centre of the moving part</option>
            </select>
          </div>
        </div>
      )}
    </>
  );
}
