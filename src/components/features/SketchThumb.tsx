import type { Sketch } from '@/cad/sketch/types';

/** A small drawing of a sketch's lines, arcs and circles (construction geometry dashed). */
export function SketchThumb({ sketch, size = 56, label }: { sketch: Sketch; size?: number; label: string }) {
  const P = new Map(sketch.points.map((p) => [p.id, p]));
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (x: number, y: number) => {
    xs.push(x);
    ys.push(y);
  };
  for (const e of sketch.entities) {
    if (e.kind === 'circle') {
      const c = P.get(e.c);
      if (c) {
        add(c.x - e.r, c.y - e.r);
        add(c.x + e.r, c.y + e.r);
      }
      continue;
    }
    for (const id of e.kind === 'arc' ? [e.a, e.b, e.c] : e.kind === 'bezier' ? [e.a, e.b, e.c1, e.c2] : [e.a, e.b]) {
      const p = P.get(id);
      if (p) add(p.x, p.y);
    }
  }
  if (!xs.length) {
    add(-1, -1);
    add(1, 1);
  }
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0, 1e-6) * 1.2;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const w = span / 40; // ≈ 1.4 px stroke at 56 px
  return (
    <svg
      viewBox={`${cx - span / 2} ${-cy - span / 2} ${span} ${span}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className="shrink-0 rounded-md border border-line bg-[#FAF9F6]"
    >
      {sketch.entities.map((e) => {
        const style = {
          stroke: e.construction ? '#98A2B3' : '#101828',
          strokeWidth: w,
          fill: 'none',
          strokeDasharray: e.construction ? `${w * 3} ${w * 2}` : undefined,
        };
        if (e.kind === 'circle') {
          const c = P.get(e.c);
          return c ? <circle key={e.id} cx={c.x} cy={-c.y} r={e.r} {...style} /> : null;
        }
        const a = P.get(e.a);
        const b = P.get(e.b);
        if (!a || !b) return null;
        if (e.kind === 'line') return <line key={e.id} x1={a.x} y1={-a.y} x2={b.x} y2={-b.y} {...style} />;
        if (e.kind === 'bezier') {
          const [h1, h2] = [P.get(e.c1), P.get(e.c2)];
          if (!h1 || !h2) return null;
          return <path key={e.id} d={`M ${a.x} ${-a.y} C ${h1.x} ${-h1.y} ${h2.x} ${-h2.y} ${b.x} ${-b.y}`} {...style} />;
        }
        const c = P.get(e.c);
        if (!c) return null;
        const r = Math.hypot(a.x - c.x, a.y - c.y);
        let sweep = Math.atan2(b.y - c.y, b.x - c.x) - Math.atan2(a.y - c.y, a.x - c.x);
        while (sweep <= 0) sweep += 2 * Math.PI;
        return <path key={e.id} d={`M ${a.x} ${-a.y} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 0 ${b.x} ${-b.y}`} {...style} />;
      })}
    </svg>
  );
}
