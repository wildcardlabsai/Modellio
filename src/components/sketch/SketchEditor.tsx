import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Circle, Hexagon, MousePointer2, Redo2, Slash, Spline, Square, Trash2, Undo2, X } from 'lucide-react';
import { NumberField } from '@/components/ui/NumberField';
import { useEditor } from '@/store/editorStore';
import { sketchUsers } from '@/cad/sketchRecords';
import { entityPoints, solveSketch, tryConstraint } from '@/cad/sketch/solver';
import { constraintRefs, describeConstraint, nameConstraints } from '@/cad/sketch/describe';
import { mergePoints } from '@/cad/sketch/edit';
import { sketchLoops, type ProfileOp } from '@/cad/sketch/profile';
import { emptySketch, type Constraint, type Sketch, type SketchEntity, type SketchStatus } from '@/cad/sketch/types';

type Tool = 'select' | 'line' | 'rect' | 'circle' | 'arc' | 'polygon';
const TOOLS: { id: Tool; label: string; Icon: typeof Slash; hint: string }[] = [
  { id: 'select', label: 'Select', Icon: MousePointer2, hint: 'Click to select, Shift-click for more; drag points to move them.' },
  { id: 'line', label: 'Line', Icon: Slash, hint: 'Click points to draw connected lines. Click the first point to close; Esc to stop.' },
  { id: 'rect', label: 'Rectangle', Icon: Square, hint: 'Click two opposite corners.' },
  { id: 'circle', label: 'Circle', Icon: Circle, hint: 'Click the centre, then a point on the circle.' },
  { id: 'arc', label: 'Arc', Icon: Spline, hint: 'Click the centre, the start, then the end (anticlockwise).' },
  { id: 'polygon', label: 'Polygon', Icon: Hexagon, hint: 'Click the centre, then a corner.' },
];

let seq = 0;
const nid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const snapGrid = (v: number) => Math.round(v * 2) / 2;

const statusText = (s: SketchStatus, sketch: Sketch) =>
  s.kind === 'fully'
    ? 'Fully constrained'
    : s.kind === 'under'
      ? `Under-constrained · ${s.dof} degree${s.dof === 1 ? '' : 's'} of freedom`
      : s.kind === 'over'
        ? `Over-constrained · ${s.redundant} repeated constraint${s.redundant === 1 ? '' : 's'}${
            s.culprits?.length ? ` (${nameConstraints(sketch, s.culprits)})` : ''
          }`
        : s.kind === 'conflicting'
          ? s.culprits?.length
            ? `Conflicting constraints: ${nameConstraints(sketch, s.culprits)} can't all be met. Remove one.`
            : 'Conflicting constraints. Remove one.'
          : 'Empty sketch';
const statusTone = (s: SketchStatus) =>
  s.kind === 'fully'
    ? 'bg-emerald-50 text-emerald-800'
    : s.kind === 'under' || s.kind === 'empty'
      ? 'bg-amber-50 text-amber-900'
      : 'bg-red-50 text-red-800';

/**
 * The sketch environment: draw lines, rectangles, circles, arcs and polygons; select and drag;
 * type exact dimensions; add constraints the solver keeps true; then Extrude or Revolve into a
 * solid. Editing an existing sketched solid reopens its sketch.
 */
/**
 * Sketching for another tool (a loft section, a sweep profile or path): edit `initial` and hand
 * the result back, instead of making a solid from it.
 */
export interface SketchUse {
  title: string;
  initial: Sketch;
  /** What the sketch should be, shown in the panel. */
  hint: string;
  /** Why the sketch cannot be used yet, or null. */
  check: (s: Sketch) => string | null;
  onDone: (s: Sketch) => void;
  /** The button's words (default "Use this sketch"). */
  action?: string;
}

export function SketchEditor({
  objectId,
  onClose,
  use,
  initialOp,
}: {
  objectId: string | null;
  onClose: () => void;
  use?: SketchUse;
  /** For a new sketch: extrude or revolve to start with. */
  initialOp?: 'extrude' | 'revolve';
}) {
  const existing = useEditor((s) => (objectId ? s.doc.objects[objectId] : undefined));
  const start = use ? use.initial : existing?.kind === 'shape' && existing.sketch ? existing.sketch : emptySketch();
  const [sketch, setSketchRaw] = useState<Sketch>(start);
  const [past, setPast] = useState<Sketch[]>([]);
  const [future, setFuture] = useState<Sketch[]>([]);
  const [tool, setTool] = useState<Tool>(start.points.length ? 'select' : 'line');
  const [construction, setConstruction] = useState(false);
  const [sides, setSides] = useState(6);
  const [sel, setSel] = useState<string[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [op, setOp] = useState<ProfileOp>(() => {
    const p = existing?.kind === 'shape' ? existing.params : {};
    const kind = existing ? ((p.op ?? 0) >= 1 ? 'revolve' : 'extrude') : (initialOp ?? 'extrude');
    return { kind, depth: p.depth ?? 5, angle: p.angle ?? 360 };
  });
  const [view, setView] = useState(() => fitView(start));
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  const status = useMemo(() => {
    const st = solveSketch(sketch).status;
    // Name the constraints behind a problem (a few extra solves, only when there is one).
    return st.kind === 'conflicting' || st.kind === 'over' ? solveSketch(sketch, [], { diagnose: true }).status : st;
  }, [sketch]);
  /** Constraints behind a conflict or repeat, and what they act on: highlighted in red. */
  const culprits = useMemo(() => new Set(status.kind === 'conflicting' || status.kind === 'over' ? (status.culprits ?? []) : []), [status]);
  const culpritRefs = useMemo(
    () => new Set(sketch.constraints.filter((c) => culprits.has(c.id)).flatMap(constraintRefs)),
    [sketch, culprits],
  );
  /** Why the last constraint or dimension was refused (nothing changed). */
  const [notice, setNotice] = useState<string | null>(null);
  const loops = useMemo(() => sketchLoops(sketch), [sketch]);
  // Revolves use only the part right of the Y axis (in both geometry engines).
  const leftOfAxis = useMemo(() => loops.loops.some((l) => l.some((p) => p[0] < -1e-6)), [loops]);
  const useProblem = useMemo(() => (use ? use.check(sketch) : null), [use, sketch]);
  // How many bodies share this body's standalone sketch.
  const shared = useEditor((st) => {
    const o = objectId ? st.doc.objects[objectId] : undefined;
    return o?.kind === 'shape' && o.sketchId ? sketchUsers(st.doc, o.sketchId).length : 0;
  });

  /** Commit a change: solve it, and record it for undo (unless it is part of a drag). */
  const commit = (next: Sketch, opts: { pinned?: string[]; transient?: boolean } = {}) => {
    const solved = solveSketch(next, opts.pinned).sketch;
    setNotice(null);
    if (!opts.transient) {
      setPast((p) => [...p.slice(-99), sketch]);
      setFuture([]);
    }
    setSketchRaw(solved);
  };
  /**
   * Add a constraint (or change one, same id) only if the sketch can still be solved and it adds
   * something: a conflict or a repeat is refused with the constraints it clashes with named, and
   * the sketch is left exactly as it was.
   */
  const addConstraint = (c: Constraint) => {
    const changing = sketch.constraints.some((x) => x.id === c.id);
    const verb = changing ? 'changed' : 'added';
    const r = tryConstraint(sketch, c);
    if (!r.ok && status.kind !== 'conflicting') {
      setNotice(`${describeConstraint(c)} was not ${verb}: it conflicts with ${nameConstraints(sketch, r.culprits)}. Nothing was changed.`);
      return;
    }
    if (r.ok && r.result.status.kind === 'over' && status.kind !== 'over' && !changing) {
      const others = (r.result.status.culprits ?? []).filter((id) => id !== c.id);
      setNotice(
        `${describeConstraint(c)} was not added: ${nameConstraints(sketch, others)} already ${others.length === 1 ? 'does' : 'do'} that.`,
      );
      return;
    }
    const constraints = changing ? sketch.constraints.map((x) => (x.id === c.id ? c : x)) : [...sketch.constraints, c];
    commit({ ...sketch, constraints });
  };
  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast(past.slice(0, -1));
    setFuture([sketch, ...future]);
    setSketchRaw(prev);
    setSel([]);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, sketch]);
    setSketchRaw(next);
  };

  // Keep the view's shape matched to the canvas so the grid fills it and 1 px is exact.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const fit = () => {
      const k = el.clientHeight / Math.max(1, el.clientWidth);
      setView((v) => {
        const h = v.w * k;
        return Math.abs(h - v.h) < 1e-6 ? v : { ...v, minY: v.minY + (v.h - h) / 2, h };
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const px = view.w / Math.max(1, svg.current?.clientWidth ?? 800);
  const toWorld = (e: { clientX: number; clientY: number }): [number, number] => {
    const s = svg.current!;
    const pt = s.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(s.getScreenCTM()!.inverse());
    return [p.x, -p.y];
  };
  /** A point under the cursor (within 8 px), for snapping onto and selecting. */
  const pointAt = (x: number, y: number, except?: string) =>
    sketch.points.find((p) => p.id !== except && Math.hypot(p.x - x, p.y - y) < 8 * px)?.id ?? null;
  const pos = (id: string) => sketch.points.find((p) => p.id === id)!;

  /** A point at (x, y): an existing one under the cursor, or a new one on the 0.5 mm grid. */
  const pointOrNew = (s: Sketch, x: number, y: number): [Sketch, string] => {
    const hit = pointAt(x, y);
    if (hit) return [s, hit];
    const id = nid('p');
    return [{ ...s, points: [...s.points, { id, x: snapGrid(x), y: snapGrid(y) }] }, id];
  };

  const addEntities = (s: Sketch, entities: SketchEntity[], constraints: Constraint[] = []): Sketch => ({
    ...s,
    entities: [...s.entities, ...entities.map((e) => ({ ...e, construction: construction || undefined }) as SketchEntity)],
    constraints: [...s.constraints, ...constraints],
  });

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button === 2) {
      setPending([]);
      return;
    }
    if (e.button !== 0) return;
    const [x, y] = toWorld(e);
    if (tool === 'select') {
      setNotice(null);
      const p = pointAt(x, y);
      const ent = p ? null : entityAt(sketch, x, y, 6 * px);
      const id = p ?? ent;
      if (!id) {
        setSel([]);
        return;
      }
      setSel((cur) => (e.shiftKey ? (cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]) : [id]));
      if (p) {
        drag.current = { id: p, moved: false };
        svg.current!.setPointerCapture(e.pointerId);
      }
      return;
    }
    const [s0, id] = pointOrNew(sketch, x, y);
    let s = s0;
    const pts = [...pending, id];
    if (tool === 'line') {
      if (pending.length) {
        const a = pending[pending.length - 1];
        if (a !== id) s = addEntities(s, [{ id: nid('l'), kind: 'line', a, b: id }]);
        const closed = id === pending[0] && pending.length > 1;
        setPending(closed ? [] : [id]);
      } else setPending([id]);
      commit(s);
      return;
    }
    if (tool === 'rect' && pts.length === 2) {
      const [a, b] = [pos2(s, pts[0]), pos2(s, pts[1])];
      let c1: string;
      let c2: string;
      [s, c1] = pointOrNew(s, b[0], a[1]);
      [s, c2] = pointOrNew(s, a[0], b[1]);
      const l = [nid('l'), nid('l'), nid('l'), nid('l')];
      s = addEntities(
        s,
        [
          { id: l[0], kind: 'line', a: pts[0], b: c1 },
          { id: l[1], kind: 'line', a: c1, b: pts[1] },
          { id: l[2], kind: 'line', a: pts[1], b: c2 },
          { id: l[3], kind: 'line', a: c2, b: pts[0] },
        ],
        [
          { id: nid('c'), kind: 'horizontal', line: l[0] },
          { id: nid('c'), kind: 'vertical', line: l[1] },
          { id: nid('c'), kind: 'horizontal', line: l[2] },
          { id: nid('c'), kind: 'vertical', line: l[3] },
        ],
      );
      setPending([]);
      commit(s);
      return;
    }
    if (tool === 'circle' && pts.length === 2) {
      const [c, r] = [pos2(s, pts[0]), pos2(s, pts[1])];
      const radius = Math.max(0.5, snapGrid(Math.hypot(r[0] - c[0], r[1] - c[1])));
      // The rim click only sets the radius.
      s = { ...s, points: s.points.filter((p) => p.id !== pts[1] || sketch.points.some((q) => q.id === pts[1])) };
      s = addEntities(s, [{ id: nid('o'), kind: 'circle', c: pts[0], r: radius }]);
      setPending([]);
      commit(s);
      return;
    }
    if (tool === 'arc' && pts.length === 3) {
      const [c, a, b] = pts.map((p) => pos2(s, p));
      const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
      // Put the end on the circle through the start.
      const ang = Math.atan2(b[1] - c[1], b[0] - c[0]);
      s = { ...s, points: s.points.map((p) => (p.id === pts[2] ? { ...p, x: c[0] + r * Math.cos(ang), y: c[1] + r * Math.sin(ang) } : p)) };
      s = addEntities(s, [{ id: nid('a'), kind: 'arc', c: pts[0], a: pts[1], b: pts[2] }]);
      setPending([]);
      commit(s);
      return;
    }
    if (tool === 'polygon' && pts.length === 2) {
      const [c, v] = [pos2(s, pts[0]), pos2(s, pts[1])];
      const r = Math.hypot(v[0] - c[0], v[1] - c[1]);
      const a0 = Math.atan2(v[1] - c[1], v[0] - c[0]);
      const n = Math.max(3, Math.min(64, Math.round(sides)));
      const ids: string[] = [];
      const newPts = [];
      for (let i = 0; i < n; i++) {
        const id2 = nid('p');
        ids.push(id2);
        newPts.push({ id: id2, x: c[0] + r * Math.cos(a0 + (i * 2 * Math.PI) / n), y: c[1] + r * Math.sin(a0 + (i * 2 * Math.PI) / n) });
      }
      // Centre and rim clicks were only guides.
      const keep = new Set(sketch.points.map((p) => p.id));
      s = { ...s, points: [...s.points.filter((p) => keep.has(p.id)), ...newPts] };
      const lines = ids.map((id2, i) => ({ id: nid('l'), kind: 'line' as const, a: id2, b: ids[(i + 1) % n] }));
      s = addEntities(
        s,
        lines,
        lines.slice(1).map((l) => ({ id: nid('c'), kind: 'equal' as const, l1: lines[0].id, l2: l.id })),
      );
      setPending([]);
      commit(s);
      return;
    }
    // More clicks needed: keep the new point as a pending guide.
    setPending(pts);
    setSketchRaw(s);
  };

  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const [x, y] = toWorld(e);
    setHover([x, y]);
    const d = drag.current;
    if (!d) return;
    const [sx, sy] = pointAt(x, y, d.id)
      ? (() => {
          const p = pos(pointAt(x, y, d.id)!);
          return [p.x, p.y];
        })()
      : [snapGrid(x), snapGrid(y)];
    if (!d.moved) setPast((p) => [...p.slice(-99), sketch]);
    d.moved = true;
    commit(
      { ...sketch, points: sketch.points.map((p) => (p.id === d.id ? { ...p, x: sx, y: sy } : p)) },
      { pinned: [d.id], transient: true },
    );
  };
  const onUp = () => {
    drag.current = null;
  };

  const removeSelected = () => {
    if (!sel.length) return;
    const ids = new Set(sel);
    const s: Sketch = { ...sketch, constraints: sketch.constraints.filter((c) => !ids.has(c.id)) };
    // Removing a point removes what is drawn on it.
    s.entities = s.entities.filter((e) => !ids.has(e.id) && !entityPoints(e).some((p) => ids.has(p)));
    const used = new Set(s.entities.flatMap(entityPoints));
    s.points = s.points.filter((p) => used.has(p.id));
    const alive = new Set([...s.entities.map((e) => e.id), ...s.points.map((p) => p.id)]);
    s.constraints = s.constraints.filter((c) => constraintRefs(c).every((r) => alive.has(r)));
    setSel([]);
    commit(s);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if (e.key === 'Escape') {
        if (pending.length) setPending([]);
        else if (sel.length) setSel([]);
        else onClose();
      } else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const finish = async () => {
    const id = await useEditor.getState().saveSketch(objectId, sketch, op);
    if (id) {
      useEditor.getState().requestFrame();
      onClose();
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const [x, y] = toWorld(e);
    const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    setView((v) => ({ minX: x - (x - v.minX) * k, minY: y - (y - v.minY) * k, w: v.w * k, h: v.h * k }));
  };

  const selected = sel.map((id) => sketch.entities.find((e) => e.id === id) ?? sketch.points.find((p) => p.id === id)).filter(Boolean);
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Sketch"
      data-testid="sketch-editor"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <h2 className="mr-2 text-[14px] font-semibold text-ink">{use?.title ?? 'Sketch'}</h2>
        <div role="toolbar" aria-label="Sketch tools" className="flex items-center gap-1">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tool === t.id}
              title={t.hint}
              onClick={() => {
                setTool(t.id);
                setPending([]);
              }}
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium ${tool === t.id ? 'bg-brand-50 text-brand-ink' : 'text-ink-2 hover:bg-canvas'}`}
            >
              <t.Icon size={15} /> {t.label}
            </button>
          ))}
          {tool === 'polygon' && (
            <div className="w-[90px]">
              <NumberField value={sides} onCommit={setSides} min={3} max={64} step={1} integer ariaLabel="Polygon sides" suffix="sides" />
            </div>
          )}
          <label className="ml-2 flex items-center gap-1.5 text-[13px] text-ink-2">
            <input
              type="checkbox"
              checked={construction}
              onChange={(e) => setConstruction(e.target.checked)}
              className="h-4 w-4 accent-brand"
            />
            Construction
          </label>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Undo"
          onClick={undo}
          disabled={!past.length}
          className="rounded-lg p-2 text-ink-2 hover:bg-canvas disabled:opacity-30"
        >
          <Undo2 size={17} />
        </button>
        <button
          type="button"
          aria-label="Redo"
          onClick={redo}
          disabled={!future.length}
          className="rounded-lg p-2 text-ink-2 hover:bg-canvas disabled:opacity-30"
        >
          <Redo2 size={17} />
        </button>
        <button
          type="button"
          aria-label="Close sketch without saving"
          onClick={onClose}
          className="rounded-lg p-2 text-ink-2 hover:bg-canvas"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 bg-[#FAF9F6]">
          <svg
            ref={svg}
            viewBox={`${view.minX} ${-(view.minY + view.h)} ${view.w} ${view.h}`}
            className={`h-full w-full touch-none select-none ${tool === 'select' ? '' : 'cursor-crosshair'}`}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
            data-testid="sketch-canvas"
          >
            <Grid view={view} px={px} />
            {/* Axes: the Y axis is the revolve axis. */}
            <line x1={view.minX} x2={view.minX + view.w} y1={0} y2={0} stroke="#E0262B" strokeOpacity={0.5} strokeWidth={px} />
            <line
              x1={0}
              x2={0}
              y1={-(view.minY + view.h)}
              y2={-view.minY}
              stroke="#16A34A"
              strokeOpacity={op.kind === 'revolve' ? 0.9 : 0.5}
              strokeWidth={(op.kind === 'revolve' ? 2 : 1) * px}
            />
            {loops.loops.map((l, i) => (
              <path key={i} d={'M' + l.map(([x, y]) => `${x} ${-y}`).join('L') + 'Z'} fill="#2463EB" fillOpacity={0.08} stroke="none" />
            ))}
            {sketch.entities.map((e) => (
              <EntityShape key={e.id} e={e} sketch={sketch} px={px} selected={sel.includes(e.id)} problem={culpritRefs.has(e.id)} />
            ))}
            <ConstraintMarks sketch={sketch} px={px} />
            {sketch.points.map((p) => (
              <circle
                key={p.id}
                cx={p.x}
                cy={-p.y}
                r={(sel.includes(p.id) ? 4 : 3) * px}
                fill={p.fixed ? '#101828' : sel.includes(p.id) ? '#2463EB' : '#fff'}
                stroke="#2463EB"
                strokeWidth={1.4 * px}
                data-testid="sketch-point"
              />
            ))}
            {pending.length > 0 && hover && <Preview tool={tool} sketch={sketch} pending={pending} hover={hover} px={px} sides={sides} />}
          </svg>
          <p className="pointer-events-none absolute bottom-2 left-3 font-mono text-[11px] text-ink-3">
            {TOOLS.find((t) => t.id === tool)!.hint} · Scroll to zoom
            {hover ? ` · ${hover[0].toFixed(1)}, ${hover[1].toFixed(1)} mm` : ''}
          </p>
        </div>
        <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line" aria-label="Sketch properties">
          <section className="border-b border-line p-4">
            <p className={`rounded-lg px-3 py-2 text-[13px] font-medium ${statusTone(status)}`} data-testid="sketch-status">
              {statusText(status, sketch)}
            </p>
            {notice && (
              <p
                className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] leading-snug text-red-800"
                role="alert"
                data-testid="sketch-notice"
              >
                <span className="flex-1">{notice}</span>
                <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="text-red-700">
                  <X size={13} />
                </button>
              </p>
            )}
            <p className="mt-2 text-[12px] text-muted">
              {loops.loops.length} closed outline{loops.loops.length === 1 ? '' : 's'}
              {loops.open ? ` · ${loops.open} open chain${loops.open === 1 ? '' : 's'} (not part of the solid)` : ''}
            </p>
            {(loops.branches > 0 || loops.crossing || (!use && op.kind === 'revolve' && leftOfAxis)) && (
              <ul className="mt-2 space-y-1 text-[12px] leading-snug text-amber-800" data-testid="sketch-warnings">
                {loops.branches > 0 && (
                  <li>
                    {loops.branches} point{loops.branches === 1 ? ' joins' : 's join'} more than two curves, so the outline there is
                    ambiguous. Trim or join the extra curves.
                  </li>
                )}
                {loops.crossing && <li>Outlines cross each other or themselves; the solid may not be what you expect.</li>}
                {!use && op.kind === 'revolve' && leftOfAxis && (
                  <li>Part of the outline is left of the green Y axis. A revolve only uses the part to its right.</li>
                )}
              </ul>
            )}
          </section>
          <SelectionPanel sketch={sketch} selected={selected} commit={commit} addConstraint={addConstraint} onDelete={removeSelected} />
          <section className="border-b border-line p-4">
            <h3 className="mb-2 text-[13px] font-semibold text-ink">Constraints ({sketch.constraints.length})</h3>
            {sketch.constraints.length ? (
              <ul className="space-y-1" data-testid="sketch-constraints">
                {sketch.constraints.map((c) => (
                  <li
                    key={c.id}
                    className={`flex items-center justify-between rounded-md px-2 py-1 text-[12px] ${culprits.has(c.id) ? 'bg-red-50 text-red-800' : 'bg-canvas'}`}
                    data-culprit={culprits.has(c.id) || undefined}
                  >
                    <span>{describeConstraint(c)}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${describeConstraint(c)}`}
                      onClick={() => commit({ ...sketch, constraints: sketch.constraints.filter((x) => x.id !== c.id) })}
                      className="rounded p-0.5 text-muted hover:text-red-600"
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-muted">Select lines, points or circles to add dimensions and constraints.</p>
            )}
          </section>
          {use ? (
            <section className="p-4">
              <p className="text-[12px] leading-relaxed text-muted">{use.hint}</p>
              {useProblem && (
                <p className="mt-2 text-[12px] text-amber-800" data-testid="sketch-use-problem">
                  {useProblem}
                </p>
              )}
              <button
                type="button"
                onClick={() => use.onDone(sketch)}
                disabled={!!useProblem}
                className="mt-3 h-10 w-full rounded-lg bg-brand text-[14px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                data-testid="sketch-use"
              >
                {use.action ?? 'Use this sketch'}
              </button>
            </section>
          ) : (
            <section className="p-4">
              <h3 className="mb-2 text-[13px] font-semibold text-ink">Make it solid</h3>
              <div role="radiogroup" aria-label="Operation" className="grid grid-cols-2 rounded-lg bg-canvas p-1">
                {(['extrude', 'revolve'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={op.kind === k}
                    onClick={() => setOp({ ...op, kind: k })}
                    className={`rounded-md py-1.5 text-[13px] font-medium capitalize ${op.kind === k ? 'bg-panel text-brand-ink shadow-sm' : 'text-ink-2'}`}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <div className="mt-2">
                {op.kind === 'extrude' ? (
                  <NumberField
                    value={op.depth}
                    onCommit={(v) => setOp({ ...op, depth: v })}
                    min={0.1}
                    max={1000}
                    step={0.5}
                    decimals={2}
                    suffix="mm"
                    ariaLabel="Extrude depth (mm)"
                    label="D"
                  />
                ) : (
                  <NumberField
                    value={op.angle}
                    onCommit={(v) => setOp({ ...op, angle: v })}
                    min={1}
                    max={360}
                    step={15}
                    decimals={0}
                    suffix="°"
                    ariaLabel="Revolve angle (degrees)"
                    label="∠"
                  />
                )}
              </div>
              {op.kind === 'revolve' && (
                <p className="mt-1.5 text-[11px] text-muted">Revolves around the green Y axis; draw the profile to its right.</p>
              )}
              <button
                type="button"
                onClick={() => void finish()}
                disabled={!loops.loops.length}
                className="mt-3 h-10 w-full rounded-lg bg-brand text-[14px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                data-testid="sketch-finish"
              >
                {objectId ? 'Update solid' : 'Create solid'}
              </button>
              {!objectId && (
                <button
                  type="button"
                  onClick={() => {
                    if (useEditor.getState().saveSketchOnly(sketch)) onClose();
                  }}
                  disabled={!sketch.entities.length}
                  className="mt-2 h-9 w-full rounded-lg border border-line text-[13px] font-medium text-ink-2 hover:bg-canvas disabled:opacity-50"
                  data-testid="sketch-save-only"
                >
                  Save sketch only
                </button>
              )}
              {shared > 1 && (
                <p className="mt-2 text-[11px] leading-relaxed text-muted" data-testid="sketch-shared-note">
                  This sketch builds {shared} bodies: updating it updates all of them.
                </p>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

type Line = Extract<SketchEntity, { kind: 'line' }>;
type Round = Extract<SketchEntity, { kind: 'circle' | 'arc' }>;
type Pt = Sketch['points'][number];
/** A constraint without its id (distributed over the kinds). */
type NewConstraint = Constraint extends infer C ? (C extends Constraint ? Omit<C, 'id'> : never) : never;

function SelectionPanel({
  sketch,
  selected,
  commit,
  addConstraint,
  onDelete,
}: {
  sketch: Sketch;
  selected: (SketchEntity | Pt | undefined)[];
  commit: (s: Sketch) => void;
  addConstraint: (c: Constraint) => void;
  onDelete: () => void;
}) {
  if (!selected.length) return null;
  const n = selected.length;
  const lines = selected.filter((e): e is Line => !!e && 'kind' in e && e.kind === 'line');
  const rounds = selected.filter((e): e is Round => !!e && 'kind' in e && (e.kind === 'circle' || e.kind === 'arc'));
  const points = selected.filter((e): e is Pt => !!e && !('kind' in e));
  const P = (id: string) => sketch.points.find((p) => p.id === id)!;
  const add = (c: NewConstraint) => addConstraint({ ...c, id: nid('c') } as Constraint);
  /** Set a dimension: change the matching constraint's value, or add one. */
  const setValue = (match: (c: Constraint) => boolean, make: () => Constraint) => {
    const has = sketch.constraints.find(match);
    addConstraint(has ? { ...make(), id: has.id } : make());
  };
  const radiusOf = (r: Round) => (r.kind === 'circle' ? r.r : Math.hypot(P(r.a).x - P(r.c).x, P(r.a).y - P(r.c).y));
  const centreOf = (r: Round) => P(r.c);
  const dir = (l: Line): [number, number] => [P(l.b).x - P(l.a).x, P(l.b).y - P(l.a).y];
  const btn = 'h-8 rounded-md border border-line px-2 text-[12px] font-medium text-ink-2 hover:border-brand hover:text-brand-ink';
  const only = (l: number, r: number, p: number) => lines.length === l && rounds.length === r && points.length === p && n === l + r + p;
  return (
    <section className="border-b border-line p-4" aria-label="Selection" data-testid="sketch-selection">
      <h3 className="mb-2 text-[13px] font-semibold text-ink">
        Selected: {n} item{n === 1 ? '' : 's'}
      </h3>
      <div className="space-y-2">
        {lines.length === 1 && (
          <>
            <NumberField
              label="L"
              ariaLabel="Line length (mm)"
              value={Math.hypot(...dir(lines[0]))}
              min={0.01}
              max={10000}
              step={1}
              decimals={2}
              suffix="mm"
              onCommit={(v) =>
                setValue(
                  (c) => c.kind === 'distance' && c.line === lines[0].id,
                  () => ({ id: nid('c'), kind: 'distance', line: lines[0].id, value: v }),
                )
              }
            />
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" className={btn} onClick={() => add({ kind: 'horizontal', line: lines[0].id })}>
                Horizontal
              </button>
              <button type="button" className={btn} onClick={() => add({ kind: 'vertical', line: lines[0].id })}>
                Vertical
              </button>
            </div>
          </>
        )}
        {rounds.length === 1 && (
          <NumberField
            label="⌀"
            ariaLabel="Diameter (mm)"
            value={2 * radiusOf(rounds[0])}
            min={0.02}
            max={20000}
            step={1}
            decimals={2}
            suffix="mm"
            onCommit={(v) =>
              setValue(
                (c) => c.kind === 'radius' && c.entity === rounds[0].id,
                () => ({ id: nid('c'), kind: 'radius', entity: rounds[0].id, value: v / 2 }),
              )
            }
          />
        )}
        {only(2, 0, 0) && (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              <button type="button" className={btn} onClick={() => add({ kind: 'parallel', l1: lines[0].id, l2: lines[1].id })}>
                Parallel
              </button>
              <button type="button" className={btn} onClick={() => add({ kind: 'perpendicular', l1: lines[0].id, l2: lines[1].id })}>
                Perpendicular
              </button>
              <button type="button" className={btn} onClick={() => add({ kind: 'equal', l1: lines[0].id, l2: lines[1].id })}>
                Equal
              </button>
            </div>
            <NumberField
              label="∠"
              ariaLabel="Angle between lines (degrees)"
              value={(() => {
                const [u, w] = [dir(lines[0]), dir(lines[1])];
                return (Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1]) * 180) / Math.PI;
              })()}
              min={-180}
              max={180}
              step={5}
              decimals={1}
              suffix="°"
              onCommit={(v) =>
                setValue(
                  (c) => c.kind === 'angle' && c.l1 === lines[0].id && c.l2 === lines[1].id,
                  () => ({ id: nid('c'), kind: 'angle', l1: lines[0].id, l2: lines[1].id, value: v }),
                )
              }
            />
          </>
        )}
        {only(1, 1, 0) && (
          <button type="button" className={btn} onClick={() => add({ kind: 'tangent', e1: lines[0].id, e2: rounds[0].id })}>
            Tangent
          </button>
        )}
        {only(0, 2, 0) && (
          <div className="grid grid-cols-3 gap-1.5">
            <button type="button" className={btn} onClick={() => add({ kind: 'equal', l1: rounds[0].id, l2: rounds[1].id })}>
              Equal radius
            </button>
            <button type="button" className={btn} onClick={() => add({ kind: 'concentric', e1: rounds[0].id, e2: rounds[1].id })}>
              Concentric
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => {
                // Touching inside when one is already (mostly) within the other.
                const [a, b] = [centreOf(rounds[0]), centreOf(rounds[1])];
                const inside = Math.hypot(a.x - b.x, a.y - b.y) < Math.max(radiusOf(rounds[0]), radiusOf(rounds[1]));
                add({ kind: 'tangent', e1: rounds[0].id, e2: rounds[1].id, ...(inside ? { inside: true } : {}) });
              }}
            >
              Tangent
            </button>
          </div>
        )}
        {only(1, 0, 1) && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" className={btn} onClick={() => add({ kind: 'midpoint', point: points[0].id, line: lines[0].id })}>
                Midpoint
              </button>
              <button type="button" className={btn} onClick={() => add({ kind: 'pointOnLine', point: points[0].id, line: lines[0].id })}>
                On line
              </button>
            </div>
            <NumberField
              label="↦"
              ariaLabel="Distance from point to line (mm)"
              value={(() => {
                const [d, a, p] = [dir(lines[0]), P(lines[0].a), points[0]];
                return Math.abs(d[0] * (p.y - a.y) - d[1] * (p.x - a.x)) / (Math.hypot(...d) || 1);
              })()}
              min={0}
              max={10000}
              step={1}
              decimals={2}
              suffix="mm"
              onCommit={(v) =>
                setValue(
                  (c) => c.kind === 'pointLineDistance' && c.point === points[0].id && c.line === lines[0].id,
                  () => ({ id: nid('c'), kind: 'pointLineDistance', point: points[0].id, line: lines[0].id, value: v }),
                )
              }
            />
          </>
        )}
        {only(0, 1, 1) && (
          <button type="button" className={btn} onClick={() => add({ kind: 'pointOnCurve', point: points[0].id, entity: rounds[0].id })}>
            On curve
          </button>
        )}
        {only(1, 0, 2) && (
          <button
            type="button"
            className={btn}
            onClick={() => add({ kind: 'symmetric', a: points[0].id, b: points[1].id, line: lines[0].id })}
          >
            Symmetric about line
          </button>
        )}
        {points.length === 1 && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <NumberField
                label="X"
                ariaLabel="Point X (mm)"
                value={points[0].x}
                min={-10000}
                max={10000}
                step={1}
                decimals={2}
                onCommit={(v) =>
                  setValue(
                    (c) => c.kind === 'pointX' && c.point === points[0].id,
                    () => ({ id: nid('c'), kind: 'pointX', point: points[0].id, value: v }),
                  )
                }
              />
              <NumberField
                label="Y"
                ariaLabel="Point Y (mm)"
                value={points[0].y}
                min={-10000}
                max={10000}
                step={1}
                decimals={2}
                onCommit={(v) =>
                  setValue(
                    (c) => c.kind === 'pointY' && c.point === points[0].id,
                    () => ({ id: nid('c'), kind: 'pointY', point: points[0].id, value: v }),
                  )
                }
              />
            </div>
            <button
              type="button"
              className={btn}
              onClick={() =>
                commit({ ...sketch, points: sketch.points.map((p) => (p.id === points[0].id ? { ...p, fixed: !p.fixed } : p)) })
              }
            >
              {points[0].fixed ? 'Unfix point' : 'Fix point'}
            </button>
          </>
        )}
        {only(0, 0, 2) && (
          <>
            <NumberField
              label="↔"
              ariaLabel="Distance between points (mm)"
              value={Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)}
              min={0.01}
              max={10000}
              step={1}
              decimals={2}
              suffix="mm"
              onCommit={(v) =>
                setValue(
                  (c) =>
                    c.kind === 'pointDistance' &&
                    ((c.a === points[0].id && c.b === points[1].id) || (c.a === points[1].id && c.b === points[0].id)),
                  () => ({ id: nid('c'), kind: 'pointDistance', a: points[0].id, b: points[1].id, value: v }),
                )
              }
            />
            <button type="button" className={btn} onClick={() => commit(mergePoints(sketch, points[0].id, points[1].id))}>
              Coincident (join points)
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="mt-3 flex items-center gap-1.5 text-[12px] font-medium text-red-600 hover:underline"
      >
        <Trash2 size={13} /> Delete
      </button>
    </section>
  );
}

function fitView(s: Sketch) {
  if (!s.points.length) return { minX: -60, minY: -40, w: 120, h: 80 };
  const xs = s.points.map((p) => p.x);
  const ys = s.points.map((p) => p.y);
  for (const e of s.entities)
    if (e.kind === 'circle') {
      const c = s.points.find((p) => p.id === e.c);
      if (c) {
        xs.push(c.x - e.r, c.x + e.r);
        ys.push(c.y - e.r, c.y + e.r);
      }
    }
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const m = Math.max(x1 - x0, y1 - y0, 20) * 0.35;
  const w = Math.max(x1 - x0 + 2 * m, ((y1 - y0 + 2 * m) * 3) / 2);
  const h = (w * 2) / 3;
  return { minX: (x0 + x1) / 2 - w / 2, minY: (y0 + y1) / 2 - h / 2, w, h };
}

const pos2 = (s: Sketch, id: string): [number, number] => {
  const p = s.points.find((q) => q.id === id)!;
  return [p.x, p.y];
};
/** The entity nearest (x, y) within `tol`. */
function entityAt(s: Sketch, x: number, y: number, tol: number): string | null {
  const P = (id: string) => s.points.find((p) => p.id === id)!;
  let best: string | null = null;
  let bestD = tol;
  for (const e of s.entities) {
    let d: number;
    if (e.kind === 'line') {
      const a = P(e.a);
      const b = P(e.b);
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy || 1)));
      d = Math.hypot(a.x + t * vx - x, a.y + t * vy - y);
    } else if (e.kind === 'circle') {
      const c = P(e.c);
      d = Math.abs(Math.hypot(x - c.x, y - c.y) - e.r);
    } else if (e.kind === 'bezier') {
      const pts = [P(e.a), P(e.c1), P(e.c2), P(e.b)].map((p) => [p.x, p.y] as [number, number]);
      d = Infinity;
      for (let i = 0; i <= 32; i++) {
        const q = bezierAt(pts, i / 32);
        d = Math.min(d, Math.hypot(q[0] - x, q[1] - y));
      }
    } else {
      const c = P(e.c);
      const a = P(e.a);
      d = Math.abs(Math.hypot(x - c.x, y - c.y) - Math.hypot(a.x - c.x, a.y - c.y));
    }
    if (d < bestD) [best, bestD] = [e.id, d];
  }
  return best;
}

/** A point on a cubic Bézier (anchor, handle, handle, anchor) at t. */
function bezierAt(p: [number, number][], t: number): [number, number] {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [w.reduce((s, k, i) => s + k * p[i][0], 0), w.reduce((s, k, i) => s + k * p[i][1], 0)];
}

function EntityShape({
  e,
  sketch,
  px,
  selected,
  problem,
}: {
  e: SketchEntity;
  sketch: Sketch;
  px: number;
  selected: boolean;
  /** Part of a conflict: drawn red. */
  problem?: boolean;
}) {
  const P = (id: string) => sketch.points.find((p) => p.id === id)!;
  const stroke = selected ? '#2463EB' : problem ? '#DC2626' : e.construction ? '#98A2B3' : '#101828';
  const common = {
    stroke,
    strokeWidth: (selected ? 2.2 : 1.5) * px,
    fill: 'none',
    strokeDasharray: e.construction ? `${4 * px} ${3 * px}` : undefined,
  };
  if (e.kind === 'line') {
    const a = P(e.a);
    const b = P(e.b);
    return <line x1={a.x} y1={-a.y} x2={b.x} y2={-b.y} {...common} data-testid="sketch-line" />;
  }
  if (e.kind === 'circle') {
    const c = P(e.c);
    return <circle cx={c.x} cy={-c.y} r={e.r} {...common} data-testid="sketch-circle" />;
  }
  if (e.kind === 'bezier') {
    const [a, h1, h2, b] = [P(e.a), P(e.c1), P(e.c2), P(e.b)];
    return <path d={`M ${a.x} ${-a.y} C ${h1.x} ${-h1.y} ${h2.x} ${-h2.y} ${b.x} ${-b.y}`} {...common} data-testid="sketch-spline" />;
  }
  const c = P(e.c);
  const a = P(e.a);
  const b = P(e.b);
  const r = Math.hypot(a.x - c.x, a.y - c.y);
  let sweep = Math.atan2(b.y - c.y, b.x - c.x) - Math.atan2(a.y - c.y, a.x - c.x);
  while (sweep <= 0) sweep += 2 * Math.PI;
  // SVG y is flipped, so a counter-clockwise arc in sketch space is sweep-flag 0.
  return <path d={`M ${a.x} ${-a.y} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 0 ${b.x} ${-b.y}`} {...common} data-testid="sketch-arc" />;
}

/** Dimension and constraint labels, one label per line or circle (e.g. "V · 20.0"). */
function ConstraintMarks({ sketch, px }: { sketch: Sketch; px: number }) {
  const P = (id: string) => sketch.points.find((p) => p.id === id);
  const labels = new Map<string, string[]>();
  const push = (id: string, t: string) => labels.set(id, [...(labels.get(id) ?? []), t]);
  for (const c of sketch.constraints) {
    if (c.kind === 'horizontal') push(c.line, 'H');
    else if (c.kind === 'vertical') push(c.line, 'V');
    else if (c.kind === 'distance') push(c.line, c.value.toFixed(1));
    else if (c.kind === 'radius') push(c.entity, `⌀${(c.value * 2).toFixed(1)}`);
    else if (c.kind === 'angle') push(c.l2, `∠${c.value.toFixed(1)}°`);
    else if (c.kind === 'tangent') push(c.e2, 'T');
    else if (c.kind === 'concentric') push(c.e2, '◎');
    else if (c.kind === 'parallel') push(c.l2, '∥');
    else if (c.kind === 'perpendicular') push(c.l2, '⊥');
  }
  return (
    <g pointerEvents="none">
      {[...labels].map(([id, texts]) => {
        const e = sketch.entities.find((x) => x.id === id);
        let at: [number, number] | null = null;
        if (e?.kind === 'line') {
          const a = P(e.a);
          const b = P(e.b);
          if (a && b) at = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        } else if (e?.kind === 'bezier') {
          const a = P(e.a);
          const b = P(e.b);
          if (a && b) at = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        } else if (e) {
          const c = P(e.c);
          if (c) at = [c.x, c.y];
        }
        if (!at) return null;
        return (
          <text key={id} x={at[0] + 4 * px} y={-at[1] - 5 * px} fontSize={11 * px} fill="#7C3AED" fontWeight={600}>
            {texts.join(' · ')}
          </text>
        );
      })}
    </g>
  );
}

function Grid({ view, px }: { view: { minX: number; minY: number; w: number; h: number }; px: number }) {
  const step = view.w > 400 ? 50 : view.w > 150 ? 10 : 5;
  const lines = [];
  for (let x = Math.ceil(view.minX / step) * step; x <= view.minX + view.w; x += step)
    lines.push(<line key={`x${x}`} x1={x} x2={x} y1={-(view.minY + view.h)} y2={-view.minY} stroke="#E6E2D8" strokeWidth={px} />);
  for (let y = Math.ceil(view.minY / step) * step; y <= view.minY + view.h; y += step)
    lines.push(<line key={`y${y}`} y1={-y} y2={-y} x1={view.minX} x2={view.minX + view.w} stroke="#E6E2D8" strokeWidth={px} />);
  return <g pointerEvents="none">{lines}</g>;
}

function Preview({
  tool,
  sketch,
  pending,
  hover,
  px,
  sides,
}: {
  tool: Tool;
  sketch: Sketch;
  pending: string[];
  hover: [number, number];
  px: number;
  sides: number;
}) {
  const p0 = sketch.points.find((p) => p.id === pending[0]);
  if (!p0) return null;
  const last = sketch.points.find((p) => p.id === pending[pending.length - 1])!;
  const s = { stroke: '#2463EB', strokeWidth: 1.2 * px, fill: 'none', strokeDasharray: `${3 * px} ${2 * px}` };
  const [hx, hy] = [snapGrid(hover[0]), snapGrid(hover[1])];
  if (tool === 'line') return <line x1={last.x} y1={-last.y} x2={hx} y2={-hy} {...s} />;
  if (tool === 'rect')
    return <rect x={Math.min(p0.x, hx)} y={-Math.max(p0.y, hy)} width={Math.abs(hx - p0.x)} height={Math.abs(hy - p0.y)} {...s} />;
  if (tool === 'circle') return <circle cx={p0.x} cy={-p0.y} r={Math.hypot(hx - p0.x, hy - p0.y)} {...s} />;
  if (tool === 'polygon') {
    const r = Math.hypot(hx - p0.x, hy - p0.y);
    const a0 = Math.atan2(hy - p0.y, hx - p0.x);
    const n = Math.max(3, Math.round(sides));
    const pts = Array.from(
      { length: n },
      (_, i) => `${p0.x + r * Math.cos(a0 + (i * 2 * Math.PI) / n)},${-(p0.y + r * Math.sin(a0 + (i * 2 * Math.PI) / n))}`,
    );
    return <polygon points={pts.join(' ')} {...s} />;
  }
  if (tool === 'arc')
    return <circle cx={p0.x} cy={-p0.y} r={Math.hypot((pending[1] ? last.x : hx) - p0.x, (pending[1] ? last.y : hy) - p0.y)} {...s} />;
  return null;
}
