import { Component, CopyPlus, Layers } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import { collectSubtree } from '@/cad/document';
import type { GroupObject } from '@/types/document';

/**
 * Components: named, reusable parts of this design. Any group can be made a component; from
 * here you can find it and insert more copies. Copies are independent (editing one does not
 * change the others).
 */
export function ComponentsPanel() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const components = Object.values(doc.objects).filter((o): o is GroupObject => o.kind === 'group' && !!o.component);
  const s = useEditor.getState();
  const canMake = selection.length > 0 && !(selection.length === 1 && components.some((c) => c.id === selection[0]));
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
          Reusable parts of this design. Make one from a group or from several parts, then insert as many copies as you need.
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
        {components.length === 0 && <li className="px-1 text-[12px] text-muted">No components yet.</li>}
        {components.map((c) => {
          const parts = collectSubtree(doc, [c.id]).length - 1;
          const selected = selection.includes(c.id);
          return (
            <li
              key={c.id}
              className={`flex items-center gap-2 rounded-xl border p-2 ${selected ? 'border-brand bg-brand-50' : 'border-line'}`}
              data-testid="component-item"
            >
              <button type="button" onClick={() => s.select([c.id])} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-ink">
                  <Layers size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink">{c.name}</span>
                  <span className="block text-[11px] text-muted">
                    {parts} part{parts === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-label={`Insert another ${c.name}`}
                title={`Insert another ${c.name}`}
                onClick={() => s.insertComponent(c.id)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-canvas hover:text-brand-ink"
              >
                <CopyPlus size={16} />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
