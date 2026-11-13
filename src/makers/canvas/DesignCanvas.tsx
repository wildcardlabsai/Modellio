import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';
import { boxCorners, designBounds, fillRuleOf, onUnitsChanged, worldPolygons, type DesignElement } from './model';
import type { MakerState } from './store';

export interface RoleStyle {
  fill: string;
  stroke: string;
  /** Dashed outline (e.g. holes). */
  dashed?: boolean;
  opacity?: number;
}

/** A draggable point on the canvas that isn't an element (e.g. a keyring hole). */
export interface CanvasPin {
  id: string;
  x: number;
  y: number;
  /** Radius drawn (mm). */
  r: number;
  inner?: number;
  label: string;
  onMove: (x: number, y: number, phase: 'start' | 'move' | 'end') => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMakerStore = UseBoundStore<StoreApi<MakerState<any, any>>>;

const MONO = "font-['Space_Mono',ui-monospace,monospace]";
const toPath = (polys: [number, number][][]) =>
  polys.map((p) => 'M' + p.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join('L') + 'Z').join('');

type Drag =
  | { mode: 'move'; id: string; sx: number; sy: number; x0: number; y0: number }
  | { mode: 'resize'; id: string; hx: number; hy: number; ax: number; ay: number; w0: number; h0: number; rot: number; keep: boolean }
  | { mode: 'rotate'; id: string; cx: number; cy: number; a0: number; r0: number }
  | { mode: 'draw'; points: [number, number][] }
  | { mode: 'pin'; pin: CanvasPin };

/**
 * The maker design canvas: an artboard in millimetres with a grid, where elements are moved
 * (drag), resized (corner handles keep proportions, edge handles stretch; Shift on a corner
 * stretches too), rotated (top handle; Shift snaps to 15°) and drawn (draw tool). Positions snap
 * to 0.5 mm and to the centre lines. Keyboard: arrows nudge (Shift ×10), Delete removes,
 * Ctrl+D duplicates, Escape deselects.
 */
export function DesignCanvas({
  useStore,
  artboard,
  roleStyle,
  pins = [],
  drawWidth = 2,
  drawRole,
  underlay,
  children,
}: {
  useStore: AnyMakerStore;
  artboard: { w: number; h: number; label?: string };
  roleStyle: (role: string) => RoleStyle;
  pins?: CanvasPin[];
  drawWidth?: number;
  drawRole: string;
  /** SVG drawn under the elements (world mm, y up is handled: draw with y negated). Given the size of one screen pixel. */
  underlay?: (px: number) => ReactNode;
  children?: ReactNode;
}) {
  const elements = useStore((s) => s.elements) as DesignElement[];
  const selected = useStore((s) => s.selected);
  const tool = useStore((s) => s.tool);
  const { select, update, beginGesture, add, remove, duplicate } = useStore.getState();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [drawing, setDrawing] = useState<[number, number][] | null>(null);
  const [guides, setGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onUnitsChanged(rerender), []);

  // View: the artboard plus everything on it, with a margin. Frozen while dragging so it doesn't jump.
  const frozen = useRef<{ minX: number; minY: number; w: number; h: number } | null>(null);
  const live = useMemo(() => {
    const b = designBounds(elements);
    let minX = -artboard.w / 2;
    let maxX = artboard.w / 2;
    let minY = -artboard.h / 2;
    let maxY = artboard.h / 2;
    if (b) {
      minX = Math.min(minX, b.minX);
      maxX = Math.max(maxX, b.maxX);
      minY = Math.min(minY, b.minY);
      maxY = Math.max(maxY, b.maxY);
    }
    for (const p of pins) {
      minX = Math.min(minX, p.x - p.r);
      maxX = Math.max(maxX, p.x + p.r);
      minY = Math.min(minY, p.y - p.r);
      maxY = Math.max(maxY, p.y + p.r);
    }
    const m = Math.max(maxX - minX, maxY - minY) * 0.08 + 4;
    return { minX: minX - m, minY: minY - m, w: maxX - minX + 2 * m, h: maxY - minY + 2 * m };
  }, [elements, artboard.w, artboard.h, pins]);
  const view = frozen.current ?? live;
  const px = view.w / Math.max(1, svg.current?.clientWidth ?? 600); // mm per screen pixel

  const toWorld = (e: { clientX: number; clientY: number }): [number, number] => {
    const s = svg.current!;
    const pt = s.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(s.getScreenCTM()!.inverse());
    return [p.x, -p.y];
  };
  const snap = (v: number) => Math.round(v * 2) / 2;

  const startDrag = (e: PointerEvent, d: Drag) => {
    e.stopPropagation();
    svg.current!.setPointerCapture(e.pointerId);
    frozen.current = view;
    drag.current = d;
    if (d.mode !== 'draw' && d.mode !== 'pin') beginGesture();
    if (d.mode === 'pin') d.pin.onMove(d.pin.x, d.pin.y, 'start');
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [wx, wy] = toWorld(e);
    if (d.mode === 'move') {
      let x = snap(d.x0 + wx - d.sx);
      let y = snap(d.y0 + wy - d.sy);
      const gx = Math.abs(x) < 1.5;
      const gy = Math.abs(y) < 1.5;
      if (gx) x = 0;
      if (gy) y = 0;
      setGuides({ x: gx, y: gy });
      update(d.id, { x, y }, { transient: true });
    } else if (d.mode === 'resize') {
      const rad = (d.rot * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const dx = wx - d.ax;
      const dy = wy - d.ay;
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;
      let w = d.hx ? Math.max(1, Math.abs(lx)) : d.w0;
      let h = d.hy ? Math.max(1, Math.abs(ly)) : d.h0;
      if (d.hx && d.hy && d.keep && !e.shiftKey) {
        const k = Math.max(w / d.w0, h / d.h0);
        w = d.w0 * k;
        h = d.h0 * k;
      }
      w = Math.round(w * 10) / 10;
      h = Math.round(h * 10) / 10;
      const ox = (d.hx * w) / 2;
      const oy = (d.hy * h) / 2;
      update(d.id, { w, h, x: d.ax + ox * c - oy * s, y: d.ay + ox * s + oy * c }, { transient: true });
    } else if (d.mode === 'rotate') {
      let r = d.r0 + ((Math.atan2(wy - d.cy, wx - d.cx) - d.a0) * 180) / Math.PI;
      r = e.shiftKey ? Math.round(r / 15) * 15 : Math.round(r);
      r = ((r % 360) + 360) % 360;
      update(d.id, { rotation: r > 180 ? r - 360 : r }, { transient: true });
    } else if (d.mode === 'draw') {
      const last = d.points[d.points.length - 1];
      if (Math.hypot(wx - last[0], wy - last[1]) > 0.6) {
        d.points.push([wx, wy]);
        setDrawing([...d.points]);
      }
    } else if (d.mode === 'pin') {
      d.pin.onMove(snap(wx), snap(wy), 'move');
    }
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    frozen.current = null;
    setGuides({ x: false, y: false });
    if (d?.mode === 'draw') {
      setDrawing(null);
      const pts = d.points;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of pts) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      const w = Math.max(maxX - minX, 0.5);
      const h = Math.max(maxY - minY, 0.5);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      add({
        kind: 'draw',
        role: drawRole,
        x: cx,
        y: cy,
        w,
        h,
        rotation: 0,
        width: drawWidth,
        name: 'Drawing',
        points: pts.map(([x, y]) => [(x - cx) / w, (y - cy) / h]),
      } as DesignElement);
    } else if (d?.mode === 'pin') d.pin.onMove(d.pin.x, d.pin.y, 'end');
    else rerender();
  };
  const onBackgroundDown = (e: PointerEvent) => {
    if (tool === 'draw') {
      const p = toWorld(e);
      startDrag(e, { mode: 'draw', points: [p] });
      setDrawing([p]);
    } else select(null);
  };
  const onKey = (e: KeyboardEvent) => {
    const el = elements.find((x) => x.id === selected);
    if (!el) return;
    const step = e.shiftKey ? 5 : 0.5;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (moves[e.key]) update(el.id, { x: el.x + moves[e.key][0], y: el.y + moves[e.key][1] });
    else if (e.key === 'Delete' || e.key === 'Backspace') remove(el.id);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') duplicate(el.id);
    else if (e.key === 'Escape') select(null);
    else return;
    e.preventDefault();
  };

  const sel = elements.find((x) => x.id === selected) ?? null;
  const handle = 7 * px;
  const gridLines = useMemo(() => {
    const lines: ReactNode[] = [];
    const step = view.w > 300 ? 10 : 5;
    for (let x = Math.ceil(view.minX / step) * step; x <= view.minX + view.w; x += step)
      lines.push(
        <line
          key={`x${x}`}
          x1={x}
          x2={x}
          y1={-(view.minY + view.h)}
          y2={-view.minY}
          stroke={x % (step * 2) === 0 ? '#E3DFD5' : '#EFEBE3'}
          strokeWidth={px}
        />,
      );
    for (let y = Math.ceil(view.minY / step) * step; y <= view.minY + view.h; y += step)
      lines.push(
        <line
          key={`y${y}`}
          y1={-y}
          y2={-y}
          x1={view.minX}
          x2={view.minX + view.w}
          stroke={y % (step * 2) === 0 ? '#E3DFD5' : '#EFEBE3'}
          strokeWidth={px}
        />,
      );
    return lines;
  }, [view.minX, view.minY, view.w, view.h, px]);

  return (
    <div className="relative h-full w-full bg-[#FAF9F6]" data-testid="design-canvas">
      <svg
        ref={svg}
        viewBox={`${view.minX} ${-(view.minY + view.h)} ${view.w} ${view.h}`}
        className={`h-full w-full touch-none select-none outline-none ${tool === 'draw' ? 'cursor-crosshair' : ''}`}
        tabIndex={0}
        role="application"
        aria-label="Design canvas. Drag to move, use the handles to resize and rotate. Arrow keys nudge the selected item."
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKey}
      >
        <rect x={view.minX} y={-(view.minY + view.h)} width={view.w} height={view.h} fill="transparent" onPointerDown={onBackgroundDown} />
        <g pointerEvents="none">{gridLines}</g>
        <rect
          x={-artboard.w / 2}
          y={-artboard.h / 2}
          width={artboard.w}
          height={artboard.h}
          fill="none"
          stroke="#B9B3A6"
          strokeDasharray={`${4 * px} ${3 * px}`}
          strokeWidth={px}
          pointerEvents="none"
        />
        {underlay && <g pointerEvents="none">{underlay(px)}</g>}
        {guides.x && (
          <line x1={0} x2={0} y1={-(view.minY + view.h)} y2={-view.minY} stroke="#E0262B" strokeWidth={px} pointerEvents="none" />
        )}
        {guides.y && <line y1={0} y2={0} x1={view.minX} x2={view.minX + view.w} stroke="#E0262B" strokeWidth={px} pointerEvents="none" />}
        {elements.map((el) => {
          const polys = worldPolygons(el);
          const st = roleStyle(el.role);
          const d = polys ? toPath(polys) : '';
          const corners = boxCorners(el);
          return (
            <g key={el.id}>
              {polys ? (
                <path
                  d={d}
                  fill={st.fill}
                  fillRule={fillRuleOf(el) === 'EvenOdd' ? 'evenodd' : 'nonzero'}
                  fillOpacity={st.opacity ?? 1}
                  stroke={st.stroke}
                  strokeWidth={1.2 * px}
                  strokeDasharray={st.dashed ? `${3 * px} ${2 * px}` : undefined}
                  className={tool === 'draw' ? '' : 'cursor-move'}
                  // Text is picked up anywhere in its box, not only on the strokes of the letters.
                  pointerEvents={el.kind === 'text' ? 'bounding-box' : undefined}
                  role="button"
                  aria-label={`${el.name ?? el.kind}, ${el.role}`}
                  aria-pressed={selected === el.id}
                  data-testid="canvas-element"
                  data-id={el.id}
                  onPointerDown={(e) => {
                    if (tool === 'draw') return onBackgroundDown(e);
                    select(el.id);
                    const [sx, sy] = toWorld(e);
                    startDrag(e, { mode: 'move', id: el.id, sx, sy, x0: el.x, y0: el.y });
                  }}
                />
              ) : (
                <polygon points={corners.map(([x, y]) => `${x},${-y}`).join(' ')} fill="#EEE" stroke="#ccc" strokeWidth={px} />
              )}
            </g>
          );
        })}
        {drawing && drawing.length > 1 && (
          <polyline
            points={drawing.map(([x, y]) => `${x},${-y}`).join(' ')}
            fill="none"
            stroke={roleStyle(drawRole).fill}
            strokeWidth={drawWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        )}
        {pins.map((pin) => (
          <g
            key={pin.id}
            className="cursor-move"
            onPointerDown={(e) => startDrag(e, { mode: 'pin', pin })}
            role="button"
            aria-label={pin.label}
            data-testid={`pin-${pin.id}`}
          >
            <circle cx={pin.x} cy={-pin.y} r={pin.r} fill="#2463EB" fillOpacity={0.12} stroke="#2463EB" strokeWidth={1.4 * px} />
            {pin.inner ? (
              <circle
                cx={pin.x}
                cy={-pin.y}
                r={pin.inner}
                fill="#FAF9F6"
                stroke="#2463EB"
                strokeWidth={px}
                strokeDasharray={`${2 * px} ${2 * px}`}
              />
            ) : null}
          </g>
        ))}
        {sel && tool === 'select' && <Selection el={sel} px={px} handle={handle} toWorld={toWorld} startDrag={startDrag} />}
      </svg>
      <div className={`${MONO} pointer-events-none absolute bottom-2 left-3 text-[11px] text-[#5B6270]`}>
        {artboard.label ?? `${artboard.w} × ${artboard.h} mm`}
        {sel ? ` · ${sel.name ?? sel.kind}: ${sel.w.toFixed(1)} × ${sel.h.toFixed(1)} mm` : ''}
      </div>
      {children}
    </div>
  );
}

function Selection({
  el,
  px,
  handle,
  toWorld,
  startDrag,
}: {
  el: DesignElement;
  px: number;
  handle: number;
  toWorld: (e: { clientX: number; clientY: number }) => [number, number];
  startDrag: (e: PointerEvent, d: Drag) => void;
}) {
  const rad = (el.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const local = (u: number, v: number): [number, number] => [el.x + u * c - v * s, el.y + u * s + v * c];
  const corners = boxCorners(el);
  const keep = el.kind !== 'draw';
  const handles: [number, number][] = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
  ];
  const rotPos = local(0, el.h / 2 + 14 * px);
  const topMid = local(0, el.h / 2);
  return (
    <g>
      <polygon
        points={corners.map(([x, y]) => `${x},${-y}`).join(' ')}
        fill="none"
        stroke="#2463EB"
        strokeWidth={1.2 * px}
        pointerEvents="none"
      />
      <line x1={topMid[0]} y1={-topMid[1]} x2={rotPos[0]} y2={-rotPos[1]} stroke="#2463EB" strokeWidth={px} pointerEvents="none" />
      <circle
        cx={rotPos[0]}
        cy={-rotPos[1]}
        r={handle * 0.75}
        fill="#fff"
        stroke="#2463EB"
        strokeWidth={1.2 * px}
        className="cursor-grab"
        data-testid="handle-rotate"
        onPointerDown={(e) => {
          const [wx, wy] = toWorld(e);
          startDrag(e, { mode: 'rotate', id: el.id, cx: el.x, cy: el.y, a0: Math.atan2(wy - el.y, wx - el.x), r0: el.rotation });
        }}
      />
      {handles.map(([hx, hy]) => {
        const [x, y] = local((hx * el.w) / 2, (hy * el.h) / 2);
        const [ax, ay] = local((-hx * el.w) / 2, (-hy * el.h) / 2);
        return (
          <rect
            key={`${hx},${hy}`}
            x={x - handle / 2}
            y={-y - handle / 2}
            width={handle}
            height={handle}
            fill="#fff"
            stroke="#2463EB"
            strokeWidth={1.2 * px}
            className={hx && hy ? 'cursor-nwse-resize' : hx ? 'cursor-ew-resize' : 'cursor-ns-resize'}
            data-testid={`handle-${hx}${hy}`}
            onPointerDown={(e) => startDrag(e, { mode: 'resize', id: el.id, hx, hy, ax, ay, w0: el.w, h0: el.h, rot: el.rotation, keep })}
          />
        );
      })}
    </g>
  );
}
