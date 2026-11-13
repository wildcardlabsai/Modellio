import { Move, Rotate3d, Scaling, Focus, Home, Magnet, ChevronDown, Box } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import { IconButton } from '@/components/ui/IconButton';
import { VIEW_DIRECTIONS, viewport, type ViewName } from './viewportBridge';
import type { TransformMode } from '@/types/document';
import { useEffect, useState } from 'react';

const TOOLS: { mode: TransformMode; label: string; key: string; Icon: typeof Move }[] = [
  { mode: 'translate', label: 'Move', key: 'W', Icon: Move },
  { mode: 'rotate', label: 'Rotate', key: 'E', Icon: Rotate3d },
  { mode: 'scale', label: 'Resize', key: 'R', Icon: Scaling },
];

const VIEWS: { view: ViewName; label: string }[] = [
  { view: 'top', label: 'Top' },
  { view: 'front', label: 'Front' },
  { view: 'right', label: 'Right' },
  { view: 'left', label: 'Left' },
  { view: 'back', label: 'Back' },
  { view: 'bottom', label: 'Bottom' },
];

const SNAP_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10];

/** DOM controls floating over the 3D canvas. */
export function ViewportOverlay() {
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const snap = useEditor((s) => s.snap);
  const setSnap = useEditor((s) => s.setSnap);
  const requestFrame = useEditor((s) => s.requestFrame);
  const selection = useEditor((s) => s.selection);
  const lastAction = useEditor((s) => s.lastAction);
  const actionSeq = useEditor((s) => s.actionSeq);
  const isEmpty = useEditor((s) => s.doc.rootIds.length === 0);
  const [viewsOpen, setViewsOpen] = useState(false);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const measureCount = useEditor((s) => s.measurePoints.length);
  const toast = useToast(lastAction, actionSeq);
  const notice = useNotice();

  return (
    <>
      {/* Transform tools */}
      <div className="absolute left-3 top-3 flex flex-col gap-1 rounded-xl border border-line bg-white/95 p-1 shadow-float backdrop-blur">
        {TOOLS.map(({ mode: m, label, key, Icon }) => (
          <IconButton
            key={m}
            label={label}
            shortcut={key}
            variant="floating"
            tooltipSide="right"
            active={mode === m}
            onClick={() => setMode(m)}
          >
            <Icon size={18} strokeWidth={2} />
          </IconButton>
        ))}
        <div className="mx-1.5 my-0.5 h-px bg-line" />
        <IconButton label="Fit to view" shortcut="F" variant="floating" tooltipSide="right" onClick={requestFrame}>
          <Focus size={18} />
        </IconButton>
      </div>

      {tool === 'measure' && (
        <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-navy/95 py-1.5 pl-3 pr-1.5 text-xs font-medium text-white shadow-float">
          <span>{measureCount === 1 ? 'Click the second point' : 'Measure: click two points on any surface (snaps to corners)'}</span>
          <button type="button" onClick={() => setTool('select')} className="rounded-md bg-white/15 px-2 py-1 hover:bg-white/25">
            Done <kbd className="ml-1 text-white/70">Esc</kbd>
          </button>
        </div>
      )}

      {/* Hint when scale is not possible */}
      {mode === 'scale' && selection.length > 1 && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-lg bg-navy/90 px-3 py-1.5 text-xs font-medium text-white shadow-float">
          Resize works on one object at a time. Group objects to resize them together.
        </div>
      )}

      {/* Units + snapping */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2">
        <div
          className="flex h-9 items-center gap-1 rounded-lg border border-line bg-white px-3 text-[13px] font-semibold text-ink shadow-panel"
          title="Units: millimetres"
        >
          mm
        </div>
        <div className="flex h-9 items-center gap-1 rounded-lg border border-line bg-white pl-1 pr-2 text-[13px] text-ink shadow-panel">
          <IconButton
            label={snap.enabled ? 'Snapping on' : 'Snapping off'}
            tooltipSide="top"
            active={snap.enabled}
            className="h-7 min-w-7"
            onClick={() => setSnap({ enabled: !snap.enabled })}
          >
            <Magnet size={15} />
          </IconButton>
          <span className="text-muted">Snap:</span>
          <select
            aria-label="Snap increment"
            value={snap.translate}
            disabled={!snap.enabled}
            onChange={(e) => setSnap({ translate: Number(e.target.value) })}
            className="bg-transparent font-medium tabular-nums outline-none disabled:opacity-40"
          >
            {[...new Set([...SNAP_STEPS, snap.translate])]
              .sort((a, b) => a - b)
              .map((s) => (
                <option key={s} value={s}>
                  {s} mm
                </option>
              ))}
          </select>
          <span className="ml-1 text-muted">·</span>
          <select
            aria-label="Rotation snap increment"
            value={snap.rotate}
            disabled={!snap.enabled}
            onChange={(e) => setSnap({ rotate: Number(e.target.value) })}
            className="bg-transparent font-medium tabular-nums outline-none disabled:opacity-40"
          >
            {[...new Set([1, 5, 15, 22.5, 45, 90, snap.rotate])]
              .sort((a, b) => a - b)
              .map((s) => (
                <option key={s} value={s}>
                  {s}°
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* Camera */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-xl border border-line bg-white p-1 shadow-panel">
        <IconButton label="Home view" tooltipSide="top" onClick={() => viewport.setView(VIEW_DIRECTIONS.home)}>
          <Home size={17} />
        </IconButton>
        <div className="relative">
          <IconButton label="Standard views" tooltipSide="top" onClick={() => setViewsOpen((v) => !v)} aria-expanded={viewsOpen}>
            <Box size={17} />
            <ChevronDown size={13} />
          </IconButton>
          {viewsOpen && (
            <div className="absolute bottom-full right-0 mb-2 grid w-40 grid-cols-2 gap-1 rounded-xl border border-line bg-white p-1.5 shadow-float">
              {VIEWS.map(({ view, label }) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => {
                    viewport.setView(VIEW_DIRECTIONS[view]);
                    setViewsOpen(false);
                  }}
                  className="rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-[#344054] hover:bg-brand-50 hover:text-brand"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <IconButton label="Fit all" shortcut="F" tooltipSide="top" onClick={requestFrame}>
          <Focus size={17} />
        </IconButton>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="pointer-events-none absolute inset-x-0 top-[18%] flex justify-center">
          <div className="rounded-2xl border border-line bg-white/90 px-6 py-4 text-center shadow-float backdrop-blur">
            <p className="text-[15px] font-semibold text-ink">Start shaping</p>
            <p className="mt-1 text-[13px] text-muted">Click a shape on the left, or drag it onto the workplane.</p>
          </div>
        </div>
      )}

      {/* Action toast (undo/redo feedback) and notices */}
      {(notice || toast) && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white shadow-float"
        >
          {notice ?? toast}
        </div>
      )}
    </>
  );
}

/** Show undo/redo feedback briefly. */
function useToast(lastAction: string | null, version: number) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!lastAction || !/^(Undo|Redo) /.test(lastAction)) return;
    setMsg(lastAction);
    const t = setTimeout(() => setMsg(null), 1400);
    return () => clearTimeout(t);
  }, [lastAction, version]);
  return msg;
}

/** Show store notices (e.g. "Select two or more objects to group") briefly. */
function useNotice() {
  const notice = useEditor((s) => s.notice);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    setMsg(notice.text);
    const t = setTimeout(() => setMsg(null), 2200);
    return () => clearTimeout(t);
  }, [notice]);
  return msg;
}
