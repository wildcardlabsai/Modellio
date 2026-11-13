import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { profileFunction, type ProfilePoint } from './geometry';
import { useVase } from './store';

const W = 260;
const PAD = 18;
const MONO = "font-['Space_Mono',ui-monospace,monospace]";

/**
 * Side-on profile editor: the vase silhouette with draggable points. Drag a point to change
 * the radius at that height (and the height, except for the base and rim points); click the
 * outline to add a point; double-click a point or press Delete to remove it. Arrow keys move
 * the focused point (Shift for bigger steps).
 */
export function ProfileEditor() {
  const params = useVase((s) => s.params);
  const setParams = useVase((s) => s.setParams);
  const beginGesture = useVase((s) => s.beginGesture);
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const points = params.profile;
  const H = params.height;
  const maxR = Math.max(60, ...points.map((p) => p.r)) * 1.15;
  const scale = (W - PAD * 2) / (2 * maxR);
  const heightPx = Math.min(360, Math.max(180, H * scale));
  const sy = (heightPx - PAD * 2) / H;
  const cx = W / 2;
  const toX = (r: number) => cx + r * scale;
  const toY = (t: number) => heightPx - PAD - t * H * sy;

  const outline = useMemo(() => {
    const f = profileFunction(points);
    const right: string[] = [];
    const left: string[] = [];
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      const r = f(t);
      right.push(`${toX(r).toFixed(1)},${toY(t).toFixed(1)}`);
      left.push(`${(cx - r * scale).toFixed(1)},${toY(t).toFixed(1)}`);
    }
    return { right: right.join(' '), shape: [...right, ...left.reverse()].join(' ') };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, H, scale, heightPx]);

  const fromPointer = (e: { clientX: number; clientY: number }) => {
    const rect = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * heightPx;
    return {
      r: Math.max(3, Math.min(250, Math.round(((x - cx) / scale) * 2) / 2)),
      t: Math.max(0, Math.min(1, (heightPx - PAD - y) / (H * sy))),
    };
  };
  const sorted = (pts: ProfilePoint[]) => [...pts].sort((a, b) => a.t - b.t);
  const move = (i: number, r: number, t: number, transient: boolean) => {
    const pts = points.map((p) => ({ ...p }));
    pts[i].r = r;
    if (i > 0 && i < pts.length - 1) pts[i].t = Math.max(pts[i - 1].t + 0.02, Math.min(pts[i + 1].t - 0.02, t));
    setParams({ profile: pts }, { transient });
  };
  const remove = (i: number) => {
    if (i === 0 || i === points.length - 1 || points.length <= 2) return;
    setParams({ profile: points.filter((_, k) => k !== i) });
    setActive(null);
  };
  const onPointDown = (i: number) => (e: PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    beginGesture();
    setActive(i);
  };
  const onMove = (e: PointerEvent) => {
    if (active === null || !(e.buttons & 1)) return;
    const { r, t } = fromPointer(e);
    move(active, r, t, true);
  };
  const onBackground = (e: PointerEvent) => {
    // Add a point where the outline is clicked (between the base and the rim).
    const { r, t } = fromPointer(e);
    if (t <= 0.02 || t >= 0.98) return;
    const pts = sorted([...points, { t, r }]);
    setParams({ profile: pts });
    setActive(pts.findIndex((p) => p.t === t));
  };
  const onKey = (i: number) => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 5 : 0.5;
    const p = points[i];
    if (e.key === 'ArrowRight') move(i, Math.min(250, p.r + step), p.t, false);
    else if (e.key === 'ArrowLeft') move(i, Math.max(3, p.r - step), p.t, false);
    else if (e.key === 'ArrowUp') move(i, p.r, p.t + step / H, false);
    else if (e.key === 'ArrowDown') move(i, p.r, p.t - step / H, false);
    else if (e.key === 'Delete' || e.key === 'Backspace') remove(i);
    else return;
    e.preventDefault();
  };
  const width = Math.max(...points.map((p) => p.r)) * 2;

  return (
    <div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${heightPx}`}
        className="w-full touch-none select-none rounded-md border border-[#E4E0D6] bg-[#FAF9F6]"
        role="group"
        aria-label="Vase profile. Drag the points to shape the vase; click the outline to add a point."
        onPointerMove={onMove}
        onPointerUp={() => setActive(null)}
        data-testid="vase-profile"
      >
        {/* Millimetre grid every 10 mm. */}
        {Array.from({ length: Math.floor(H / 10) + 1 }, (_, i) => (
          <line key={`h${i}`} x1={PAD} x2={W - PAD} y1={toY((i * 10) / H)} y2={toY((i * 10) / H)} stroke="#ECE8DF" strokeWidth={0.6} />
        ))}
        <line x1={cx} x2={cx} y1={PAD - 6} y2={heightPx - PAD + 6} stroke="#C9C4B8" strokeDasharray="3 3" />
        <polygon points={outline.shape} fill="#DCE7FD" stroke="none" />
        <polyline
          points={outline.right}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          className="cursor-copy"
          onPointerDown={onBackground}
          data-testid="vase-profile-outline"
        />
        <polyline points={outline.right} fill="none" stroke="#2463EB" strokeWidth={2} pointerEvents="none" />
        {points.map((p, i) => {
          const end = i === 0 || i === points.length - 1;
          return (
            <circle
              key={i}
              cx={toX(p.r)}
              cy={toY(p.t)}
              r={active === i ? 7 : 5.5}
              fill={active === i ? '#2463EB' : '#fff'}
              stroke="#2463EB"
              strokeWidth={2}
              tabIndex={0}
              role="slider"
              aria-label={`${end ? (i === 0 ? 'Base' : 'Rim') : `Point ${i}`}: radius ${p.r.toFixed(1)} mm at ${(p.t * H).toFixed(0)} mm`}
              aria-valuenow={p.r}
              aria-valuemin={3}
              aria-valuemax={250}
              className="cursor-grab outline-none focus:stroke-[#16191F]"
              onPointerDown={onPointDown(i)}
              onDoubleClick={() => remove(i)}
              onKeyDown={onKey(i)}
              onFocus={() => setActive(i)}
              data-testid="vase-profile-point"
            />
          );
        })}
      </svg>
      <div className={`${MONO} mt-1.5 flex justify-between text-[11px] text-[#5B6270]`}>
        <span>⌀ {width.toFixed(0)} mm max</span>
        <span>{points.length} points</span>
        <span>{H.toFixed(0)} mm tall</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-[#667085]">
        Drag points to shape it. Click the blue line to add a point; double-click a point (or press Delete) to remove it.
      </p>
    </div>
  );
}
