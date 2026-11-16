import { create } from 'zustand';
import { onProjectSwitch } from '@/platform/projectScope';
import type { RefGeom } from '@/cad/assembly/references';
import type { JointKind, JointRefData, ObjectId } from '@/types/document';

/** A face or edge picked for a joint: what it is, where it is, and the joint part it belongs to. */
export interface PickedRef {
  /** The joint part (the fixed part for A, the moving part for B). */
  part: ObjectId;
  ref: JointRefData;
  geom: RefGeom;
}

/** The New joint panel's working state (not saved with the design). */
export interface JointDraft {
  kind: JointKind;
  /** "faces": placed from picked faces or edges; "quick": an X/Y/Z axis preset. */
  mode: 'faces' | 'quick';
  /** Which reference the next click in the 3D view picks (null: not picking). */
  target: 'a' | 'b' | null;
  /** The two parts, when chosen beforehand (selection); otherwise each pick decides its part. */
  partA: ObjectId | null;
  partB: ObjectId | null;
  a: PickedRef | null;
  b: PickedRef | null;
  flip: boolean;
  offset: number;
  angle: number;
  /** Move the moving part onto the fixed part's reference (otherwise it stays where it is). */
  snap: boolean;
}

const freshDraft = (partA: ObjectId | null = null, partB: ObjectId | null = null): JointDraft => ({
  kind: 'revolute',
  mode: 'faces',
  target: 'a',
  partA,
  partB,
  a: null,
  b: null,
  flip: false,
  offset: 0,
  angle: 0,
  snap: true,
});

/** Interface state for the assembly tools (not saved with the design). */
interface AssemblyUi {
  /** The joint being edited (highlighted in the viewport). */
  activeJoint: string | null;
  setActiveJoint: (id: string | null) => void;
  showJoints: boolean;
  setShowJoints: (on: boolean) => void;
  /** The New joint panel is open. */
  jointDialog: boolean;
  /** Open (with the two selected parts, if any) or close the New joint panel. */
  setJointDialog: (open: boolean, parts?: [ObjectId, ObjectId] | null) => void;
  draft: JointDraft;
  patchDraft: (patch: Partial<JointDraft>) => void;
  /** Record a pick for the current target and move on to the next one. */
  choose: (picked: PickedRef) => void;
}

export const useAssemblyUi = create<AssemblyUi>((set, get) => ({
  activeJoint: null,
  setActiveJoint: (activeJoint) => set({ activeJoint }),
  showJoints: true,
  setShowJoints: (showJoints) => set({ showJoints }),
  jointDialog: false,
  setJointDialog: (open, parts) => set({ jointDialog: open, draft: freshDraft(parts?.[0] ?? null, parts?.[1] ?? null) }),
  draft: freshDraft(),
  patchDraft: (patch) => set({ draft: { ...get().draft, ...patch } }),
  choose: (picked) => {
    const d = get().draft;
    if (d.target === 'a') set({ draft: { ...d, a: picked, target: d.b ? null : 'b' } });
    else if (d.target === 'b') set({ draft: { ...d, b: picked, target: d.a ? null : 'a' } });
  },
}));

onProjectSwitch('assembly-ui', () => useAssemblyUi.setState({ activeJoint: null, jointDialog: false, draft: freshDraft() }));
