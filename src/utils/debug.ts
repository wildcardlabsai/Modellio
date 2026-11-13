import { create } from 'zustand';

/**
 * Fault injection for automated tests of the crash-recovery paths
 * (exposed as window.modellio.debug). Has no effect unless called.
 */
export const useDebug = create<{ crashViewport: boolean }>(() => ({ crashViewport: false }));

export function CrashProbe() {
  const crash = useDebug((s) => s.crashViewport);
  // Stays set until the crash screen's "Restart" clears it (React retries a failed render once).
  if (crash) throw new Error('Simulated viewport failure (test)');
  return null;
}
