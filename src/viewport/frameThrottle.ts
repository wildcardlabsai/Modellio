/**
 * Run a pointer-move handler at most once per animation frame, with the latest event.
 * Mice and pens report moves faster than the screen refreshes; each move updates the
 * document and re-renders, so extra moves only queue up work and make dragging lag.
 */
export function frameThrottle<E>(fn: (e: E) => void) {
  let pending: E | null = null;
  let frame = 0;
  const run = () => {
    frame = 0;
    const e = pending;
    pending = null;
    if (e) fn(e);
  };
  return {
    call(e: E) {
      pending = e;
      if (!frame) frame = requestAnimationFrame(run);
    },
    /** Apply the last move now (before committing on pointer up). */
    flush() {
      if (frame) cancelAnimationFrame(frame);
      run();
    },
  };
}
