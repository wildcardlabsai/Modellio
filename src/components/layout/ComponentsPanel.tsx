import { useState } from 'react';
import { Anchor, ChevronDown, ChevronRight, Component, CopyPlus, Copy, Layers, Link2Off } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import { collectSubtree } from '@/cad/document';
import type { GroupObject } from '@/types/document';

/**
 * Components: reusable parts of this design. A component can be placed many times; the copies
 * are *linked* instances, so editing any one of them changes them all, while each keeps its own
 * position. "Insert independent copy" makes a copy that is no longer linked; "Make independent"
 * unlinks an existing instance.
 */
export function ComponentsPanel() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const instances = Object.values(doc.objects).filter((o): o is GroupObject => o.kind === 'group' && !!o.component);
  const byComponent = new Map<string, GroupObject[]>();
  for (const g of instances) {
    const key = g.componentId ?? g.id;
    byComponent.set(key, [...(byComponent.get(key) ?? []), g]);
  }
  const s = useEditor.getState();
  const canMake = selection.length > 0 && !(selection.length === 1 && instances.some((c) => c.id === selection[0]));
  return (
    <aside
      className="flex w-[264px] shrink-0 flex-col border-r border-line bg-panel"
      aria-label="Components"
      data-testid="components-panel"
    >
      <div className="px-4 py-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Component size={17} className="text-brand-ink" /> Components
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Reusable parts. Inserted copies are linked: edit one and they all change, each keeping its own position.
        </p>
        <button
          type="button"
          disabled={!canMake}
          onClick={() => s.makeComponent()}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2 text-[13px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          data-testid="make-component"
        >
          <Component size={15} /> Make component from selection
        </button>
      </div>
      <ul className="scrollbar-thin flex-1 space-y-1.5 overflow-y-auto px-3 pb-4" aria-label="Components in this design">
        {byComponent.size === 0 && <li className="px-1 text-[12px] text-muted">No components yet.</li>}
        {[...byComponent].map(([cid, list]) => {
          const first = list[0];
          const name = doc.components?.[cid]?.name ?? first.name;
          const parts = collectSubtree(doc, [first.id]).length - 1;
          const selected = list.some((g) => selection.includes(g.id));
          const expanded = open[cid] ?? false;
          return (
            <li
              key={cid}
              className={`rounded-xl border p-2 ${selected ? 'border-brand bg-brand-50' : 'border-line'}`}
              data-testid="component-item"
              data-instances={list.length}
            >
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={expanded ? `Hide copies of ${name}` : `Show copies of ${name}`}
                  aria-expanded={expanded}
                  onClick={() => setOpen((o) => ({ ...o, [cid]: !expanded }))}
                  className="flex h-8 w-5 shrink-0 items-center justify-center text-ink-3 hover:text-ink"
                >
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => s.select(list.map((g) => g.id))}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title="Select every copy"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-ink">
                    <Layers size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-ink">{name}</span>
                    <span className="block text-[11px] text-muted" data-testid="component-count">
                      {parts} part{parts === 1 ? '' : 's'} · {list.length} {list.length === 1 ? 'copy' : 'linked copies'}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Insert another ${name} (linked)`}
                  title={`Insert another ${name} (linked)`}
                  onClick={() => s.insertComponent(first.id, true)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-canvas hover:text-brand-ink"
                >
                  <CopyPlus size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Insert independent copy of ${name}`}
                  title={`Insert an independent copy of ${name} (not linked)`}
                  onClick={() => s.insertComponent(first.id, false)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-canvas hover:text-brand-ink"
                >
                  <Copy size={15} />
                </button>
              </div>
              {expanded && (
                <ul className="mt-1.5 space-y-0.5 border-t border-line pt-1.5" aria-label={`Copies of ${name}`}>
                  {list.map((g) => (
                    <li key={g.id} className="flex items-center gap-1.5 pl-6" data-testid="component-instance">
                      <button
                        type="button"
                        onClick={() => s.select([g.id])}
                        className={`min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-[12px] ${
                          selection.includes(g.id) ? 'font-semibold text-ink' : 'text-ink-2'
                        } ${g.suppressed ? 'line-through opacity-70' : ''}`}
                      >
                        {g.name}
                      </button>
                      {g.grounded && <Anchor size={12} className="text-ink-3" aria-label="Grounded" />}
                      {list.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Make ${g.name} independent`}
                          title="Make independent (stop following the other copies)"
                          onClick={() => s.breakLink(g.id)}
                          className="flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-canvas hover:text-ink"
                        >
                          <Link2Off size={13} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
