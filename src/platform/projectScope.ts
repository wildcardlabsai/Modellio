/**
 * Project-scoped state. Every store that holds something belonging to the open design (a tool in
 * progress, a selection, a preview, a sketch being edited…) registers a reset here, and switching
 * project (new, open, Save As, restore) calls them all. Application-wide preferences (units,
 * snapping, layout, clipboard) are not registered and survive.
 */
type Reset = () => void;
const resets = new Map<string, Reset>();

/** Register (or replace) the reset for a named part of the app. */
export function onProjectSwitch(name: string, reset: Reset) {
  resets.set(name, reset);
}

/** Reset every registered part. Errors in one never stop the others. */
export function resetProjectScope() {
  for (const [name, reset] of resets)
    try {
      reset();
    } catch (e) {
      console.warn(`Could not reset ${name} on project switch`, e);
    }
}

/** The registered names (for tests). */
export const projectScopeNames = () => [...resets.keys()];
