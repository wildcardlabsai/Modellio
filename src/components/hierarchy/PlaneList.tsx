import { Eye, EyeOff, PencilLine, Plus, Trash2 } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import { NumberField } from '@/components/ui/NumberField';
import { planeFrame } from '@/cad/placement';
import { planeUsers } from '@/cad/sketchPlacement';
import { useSketchSession } from '@/components/sketch/sketchSession';
import type { RefPlane } from '@/types/document';

const BASES: RefPlane['base'][] = ['XY', 'XZ', 'YZ'];

/**
 * Reference planes: the main planes moved along their normal and tilted, to sketch on. Editing a
 * plane moves the sketches on it, and their bodies, in the same undo step.
 */
export function PlaneList() {
  const planes = useEditor((s) => s.doc.planes);
  const doc = useEditor((s) => s.doc);
  const list = Object.values(planes ?? {});
  const s = useEditor.getState;
  return (
    <section className="border-t border-line px-3 pb-3 pt-2" aria-label="Reference planes" data-testid="plane-list">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Reference planes</h3>
        <span className="flex gap-1">
          {BASES.map((b) => (
            <button
              key={b}
              type="button"
              aria-label={`New plane parallel to ${b}`}
              title={`New plane parallel to ${b}`}
              onClick={() => s().addPlane(b)}
              className="flex h-6 items-center gap-0.5 rounded-md border border-line px-1.5 text-[11px] font-medium text-ink-2 hover:border-brand hover:text-brand-ink"
            >
              <Plus size={11} /> {b}
            </button>
          ))}
        </span>
      </div>
      {!list.length && <p className="text-[12px] text-muted">Add a plane to sketch on it: one of the main planes, moved and tilted.</p>}
      <ul className="space-y-2">
        {list.map((p) => {
          const used = planeUsers(doc, p.id);
          return (
            <li key={p.id} className="rounded-lg bg-canvas p-2" data-testid="plane-row">
              <div className="flex items-center gap-1">
                <input
                  aria-label={`Name of ${p.name}`}
                  defaultValue={p.name}
                  key={p.name}
                  onBlur={(e) => e.target.value.trim() !== p.name && s().updatePlane(p.id, { name: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-[13px] font-medium text-ink hover:border-line focus:border-brand focus:outline-none"
                />
                <span className="text-[11px] text-muted">∥ {p.base}</span>
                <button
                  type="button"
                  aria-label={p.visible ? `Hide ${p.name}` : `Show ${p.name}`}
                  onClick={() => s().updatePlane(p.id, { visible: !p.visible })}
                  className="flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-panel hover:text-brand-ink"
                >
                  {p.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <button
                  type="button"
                  aria-label={`Sketch on ${p.name}`}
                  title={`Sketch on ${p.name}`}
                  onClick={() =>
                    useSketchSession.getState().openOn({ placement: { kind: 'plane', planeId: p.id }, frame: planeFrame(p), label: p.name })
                  }
                  className="flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-panel hover:text-brand-ink"
                >
                  <PencilLine size={13} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${p.name}`}
                  title={used.length ? `Used by ${used.map((u) => u.name).join(', ')}` : `Delete ${p.name}`}
                  onClick={() => s().deletePlane(p.id)}
                  className="flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-panel hover:text-red-600"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <NumberField
                  label="↕"
                  ariaLabel={`${p.name} offset (mm)`}
                  value={p.offset}
                  min={-10000}
                  max={10000}
                  step={1}
                  decimals={2}
                  suffix="mm"
                  onCommit={(v) => s().updatePlane(p.id, { offset: v })}
                />
                <NumberField
                  label="∠"
                  ariaLabel={`${p.name} tilt (degrees)`}
                  value={p.tilt}
                  min={-89}
                  max={89}
                  step={5}
                  decimals={1}
                  suffix="°"
                  onCommit={(v) => s().updatePlane(p.id, { tilt: v })}
                />
              </div>
              {used.length > 0 && <p className="mt-1 text-[11px] text-muted">Carries {used.map((u) => u.name).join(', ')}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
