import { create } from 'zustand';
import { onProjectSwitch } from '@/platform/projectScope';

/** Interface state for the assembly tools (not saved with the design). */
interface AssemblyUi {
  /** The joint being edited (highlighted in the viewport). */
  activeJoint: string | null;
  setActiveJoint: (id: string | null) => void;
  showJoints: boolean;
  setShowJoints: (on: boolean) => void;
  /** The New joint dialog is open. */
  jointDialog: boolean;
  setJointDialog: (open: boolean) => void;
}

export const useAssemblyUi = create<AssemblyUi>((set) => ({
  activeJoint: null,
  setActiveJoint: (activeJoint) => set({ activeJoint }),
  showJoints: true,
  setShowJoints: (showJoints) => set({ showJoints }),
  jointDialog: false,
  setJointDialog: (jointDialog) => set({ jointDialog }),
}));

onProjectSwitch('assembly-ui', () => useAssemblyUi.setState({ activeJoint: null, jointDialog: false }));
