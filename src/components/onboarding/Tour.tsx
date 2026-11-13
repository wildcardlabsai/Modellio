import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { X } from 'lucide-react';

const DONE_KEY = 'modellio:onboarded';

interface Step {
  target: string; // data-tour attribute value
  title: string;
  body: string;
}

export const TOUR_STEPS: Step[] = [
  {
    target: 'library',
    title: 'Add shapes',
    body: 'Click a shape to add it, or drag it straight onto the workplane — or onto another object to stack it.',
  },
  {
    target: 'viewport',
    title: 'Look around, move things',
    body: 'Drag empty space to orbit, right-drag to pan, scroll to zoom. Drag an object to slide it across the plate; it rests on whatever is beneath it.',
  },
  {
    target: 'tools',
    title: 'Move, rotate, resize',
    body: 'W, E and R switch tools. Resize (R) shows handles: drag a side or corner, or the top handle for height. Hold Shift to keep proportions.',
  },
  {
    target: 'inspector',
    title: 'Exact millimetres',
    body: 'Select an object to type its exact size, position and rotation. Fields accept sums like 20+5.',
  },
  {
    target: 'combine',
    title: 'Holes and Combine',
    body: 'Press H to turn a shape into a hole, select it with a solid and choose Combine → Union to cut it. Everything stays editable.',
  },
  {
    target: 'export',
    title: 'Print it',
    body: 'Export STL or 3MF for your slicer. The Print panel on the left checks for overhangs and thin walls first.',
  },
];

interface TourState {
  step: number | null;
  start: () => void;
  next: () => void;
  back: () => void;
  close: () => void;
}

const markDone = () => {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* storage unavailable */
  }
};

export const useTour = create<TourState>()((set, get) => ({
  step: null,
  start: () => set({ step: 0 }),
  next: () => {
    const s = get().step;
    if (s === null) return;
    if (s >= TOUR_STEPS.length - 1) {
      markDone();
      set({ step: null });
    } else set({ step: s + 1 });
  },
  back: () => {
    const s = get().step;
    if (s) set({ step: s - 1 });
  },
  close: () => {
    markDone();
    set({ step: null });
  },
}));

/** Start the tour automatically on a first visit. */
export function useFirstRunTour(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let seen = true;
    try {
      seen = localStorage.getItem(DONE_KEY) === '1';
    } catch {
      /* storage unavailable: don't nag */
    }
    if (seen) return;
    const t = setTimeout(() => useTour.getState().start(), 900);
    return () => clearTimeout(t);
  }, [enabled]);
}

/** Spotlight + coach mark for the current step. */
export function Tour() {
  const step = useTour((s) => s.step);
  const { next, back, close } = useTour.getState();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (step === null) return;
    const update = () => setRect(document.querySelector(`[data-tour="${TOUR_STEPS[step].target}"]`)?.getBoundingClientRect() ?? null);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [step]);

  useEffect(() => {
    if (step === null) return;
    card.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') back();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step, next, back, close]);

  if (step === null) return null;
  const s = TOUR_STEPS[step];
  const pad = 6;
  // Place the card beside the target, keeping it on screen.
  const cardW = 320;
  let left = 24;
  let top = 24;
  if (rect) {
    const roomRight = window.innerWidth - rect.right;
    if (roomRight > cardW + 32) left = rect.right + 16;
    else if (rect.left > cardW + 32) left = rect.left - cardW - 16;
    else left = Math.max(16, Math.min(window.innerWidth - cardW - 16, rect.left + rect.width / 2 - cardW / 2));
    top = Math.max(16, Math.min(window.innerHeight - 230, rect.top + (rect.height > 300 ? 40 : rect.height + 12)));
    if (roomRight <= cardW + 32 && rect.left <= cardW + 32) top = Math.min(window.innerHeight - 230, rect.bottom + 12);
  }

  return (
    <div className="fixed inset-0 z-[60]" data-testid="tour">
      {/* Spotlight: a huge shadow around the target darkens everything else. */}
      {rect && (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-brand transition-all duration-300"
          style={{
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgb(16 24 40 / 0.55)',
          }}
        />
      )}
      <div
        ref={card}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="absolute rounded-2xl bg-white p-5 shadow-float outline-none"
        style={{ left, top, width: cardW }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">
            Step {step + 1} of {TOUR_STEPS.length}
          </p>
          <button type="button" aria-label="Skip tour" onClick={close} className="-mr-1 -mt-1 rounded-lg p-1 text-muted hover:bg-canvas">
            <X size={16} />
          </button>
        </div>
        <h2 id="tour-title" className="mt-1 text-[17px] font-semibold text-ink">
          {s.title}
        </h2>
        <p id="tour-body" className="mt-1.5 text-[13px] leading-relaxed text-[#475467]">
          {s.body}
        </p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1" aria-hidden="true">
            {TOUR_STEPS.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-brand' : 'w-1.5 bg-line'}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={back}
                className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-[#344054] hover:bg-canvas"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="rounded-lg bg-brand px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-600"
            >
              {step === TOUR_STEPS.length - 1 ? 'Start designing' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
