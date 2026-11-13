/**
 * Snapshot-based undo history.
 *
 * Documents are immutable (Immer, auto-frozen) and structurally shared, so a
 * snapshot only costs the objects that actually changed between steps. Large
 * binary data (imported meshes, Boolean results) will live in a separate
 * immutable asset store referenced by id, so it is never duplicated here.
 */
export interface HistoryEntry<T> {
  label: string;
  state: T;
}

export interface History<T> {
  past: HistoryEntry<T>[];
  future: HistoryEntry<T>[];
}

export const HISTORY_LIMIT = 200;

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] });

/** Record that `previous` was replaced by a new state via an action called `label`. */
export function pushHistory<T>(h: History<T>, previous: T, label: string): History<T> {
  const past = [...h.past, { label, state: previous }];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, future: [] };
}

export function undoHistory<T>(h: History<T>, current: T): { history: History<T>; state: T; label: string } | null {
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, { label: entry.label, state: current }] },
    state: entry.state,
    label: entry.label,
  };
}

export function redoHistory<T>(h: History<T>, current: T): { history: History<T>; state: T; label: string } | null {
  const entry = h.future[h.future.length - 1];
  if (!entry) return null;
  return {
    history: { past: [...h.past, { label: entry.label, state: current }], future: h.future.slice(0, -1) },
    state: entry.state,
    label: entry.label,
  };
}
