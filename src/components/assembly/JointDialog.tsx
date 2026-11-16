import { useState } from 'react';
import * as THREE from 'three';
import { ArrowLeftRight } from 'lucide-react';
import { Modal, Segmented } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { NumberField } from '@/components/ui/NumberField';
import { Toggle } from '@/components/ui/Toggle';
import { useEditor } from '@/store/editorStore';
import { topLevel, worldBoundsOf } from '@/cad/hierarchy';
import { JOINT_DOF, jointProblem } from '@/cad/assembly/joints';
import type { Joint, JointKind, JointValue, Vec3 } from '@/types/document';
import { useAssemblyUi } from './assemblyUi';

export const JOINT_KINDS: { value: JointKind; label: string; help: string }[] = [
  { value: 'rigid', label: 'Rigid', help: 'Locks the moving part to the fixed one: they move as one.' },
  { value: 'revolute', label: 'Hinge', help: 'Turns about the axis (revolute), like a door or a lid.' },
  { value: 'slider', label: 'Slider', help: 'Slides along the axis, like a drawer.' },
  { value: 'cylindrical', label: 'Cylinder', help: 'Turns about and slides along the axis, like a piston.' },
  { value: 'planar', label: 'Planar', help: 'Slides in the plane across the axis and turns in it.' },
];
export const VALUE_LABEL: Record<JointValue, string> = { angle: 'Angle (°)', offset: 'Slide (mm)', u: 'Across (mm)', v: 'Along (mm)' };
const DEFAULT_LIMIT: Record<JointValue, [number, number]> = { angle: [0, 90], offset: [0, 30], u: [-20, 20], v: [-20, 20] };

/** New joint: connect the two selected parts (the first stays put, the second moves). */
export function JointDialog() {
  const close = () => useAssemblyUi.getState().setJointDialog(false);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const picked = topLevel(doc, selection);
  const [swap, setSwap] = useState(false);
  const [kind, setKind] = useState<JointKind>('revolute');
  const [axis, setAxis] = useState<'x' | 'y' | 'z'>('z');
  const [at, setAt] = useState<'b' | 'a' | 'between'>('between');
  const [limited, setLimited] = useState(true);
  const [limits, setLimits] = useState<Joint['limits']>({ ...DEFAULT_LIMIT });
  const [a, b] = swap ? [picked[1], picked[0]] : [picked[0], picked[1]];
  const why =
    picked.length !== 2
      ? 'Select exactly two parts: the fixed one first, then the one that moves.'
      : jointProblem(doc, { id: '', name: 'This joint', a, b });

  const create = () => {
    const ca = worldBoundsOf(doc, [a]).getCenter(new THREE.Vector3());
    const cb = worldBoundsOf(doc, [b]).getCenter(new THREE.Vector3());
    const origin = (at === 'a' ? ca : at === 'b' ? cb : ca.clone().add(cb).multiplyScalar(0.5)).toArray() as Vec3;
    const lim = limited && JOINT_DOF[kind].length ? Object.fromEntries(JOINT_DOF[kind].map((k) => [k, limits![k]!])) : undefined;
    const id = useEditor.getState().addJoint({ kind, a, b, axis, origin, limits: lim });
    if (id) {
      useAssemblyUi.getState().setActiveJoint(id);
      close();
    }
  };

  return (
    <Modal
      title="New joint"
      onClose={close}
      width={480}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!!why} onClick={create} data-testid="joint-create" data-autofocus>
            Create joint
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="joint-dialog">
        <div className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-[13px]">
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] uppercase tracking-wide text-muted">Fixed part</span>
            <span className="block truncate font-semibold text-ink" data-testid="joint-a">
              {a ? doc.objects[a]?.name : '—'}
            </span>
          </span>
          <button
            type="button"
            aria-label="Swap the fixed and moving parts"
            onClick={() => setSwap(!swap)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 hover:bg-panel hover:text-ink"
          >
            <ArrowLeftRight size={15} />
          </button>
          <span className="min-w-0 flex-1 text-right">
            <span className="block text-[11px] uppercase tracking-wide text-muted">Moving part</span>
            <span className="block truncate font-semibold text-ink" data-testid="joint-b">
              {b ? doc.objects[b]?.name : '—'}
            </span>
          </span>
        </div>
        <div>
          <p className="mb-1.5 text-[12px] font-semibold text-ink-2">Kind</p>
          <Segmented label="Joint kind" value={kind} onChange={setKind} options={JOINT_KINDS} />
          <p className="mt-1.5 text-[12px] text-muted">{JOINT_KINDS.find((k) => k.value === kind)!.help}</p>
        </div>
        {kind !== 'rigid' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1.5 text-[12px] font-semibold text-ink-2">{kind === 'planar' ? 'Plane normal' : 'Axis'}</p>
              <Segmented
                label="Joint axis"
                value={axis}
                onChange={setAxis}
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
                value={at}
                onChange={(e) => setAt(e.target.value as typeof at)}
                className="h-9 w-full rounded-lg border border-line bg-panel px-2 text-[13px] text-ink-2"
              >
                <option value="between">Between the parts</option>
                <option value="a">Centre of the fixed part</option>
                <option value="b">Centre of the moving part</option>
              </select>
            </div>
          </div>
        )}
        {JOINT_DOF[kind].length > 0 && (
          <div>
            <Toggle label="Limit the motion" checked={limited} onChange={setLimited} />
            {limited && (
              <div className="mt-2 space-y-2">
                {JOINT_DOF[kind].map((k) => (
                  <div key={k} className="grid grid-cols-[1fr_88px_88px] items-center gap-2 text-[12px] text-ink-2">
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
        <p className="text-[12px] text-muted">
          The joint is made where the parts are now, so nothing jumps. Afterwards, drag the moving part or type its value; it stays on the
          joint.
        </p>
        {why && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800" role="alert" data-testid="joint-why">
            {why}
          </p>
        )}
      </div>
    </Modal>
  );
}
