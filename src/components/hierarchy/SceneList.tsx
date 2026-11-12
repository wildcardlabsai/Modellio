import { Eye, EyeOff, Lock, Unlock } from 'lucide-react';
import { useEditor } from '@/store/editorStore';

/** Flat list of scene objects (Phase 1). Becomes the full hierarchy tree in Phase 2. */
export function SceneList() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const { select, setVisible, setLocked } = useEditor.getState();
  const ids = [...doc.rootIds].reverse();

  if (!ids.length) {
    return <p className="px-5 py-6 text-[13px] text-muted">No objects yet. Add a shape from the library.</p>;
  }

  return (
    <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-2" aria-label="Scene objects">
      {ids.map((id) => {
        const o = doc.objects[id];
        if (!o) return null;
        const active = selection.includes(id);
        return (
          <li key={id}>
            <div
              role="button"
              tabIndex={0}
              aria-pressed={active}
              onClick={(e) => select([id], { toggle: e.shiftKey || e.ctrlKey || e.metaKey })}
              onKeyDown={(e) => e.key === 'Enter' && select([id])}
              className={`group flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-[13px] ${
                active ? 'bg-brand-50 font-medium text-brand' : 'text-[#344054] hover:bg-canvas'
              } ${o.visible ? '' : 'opacity-50'}`}
            >
              <span className="h-3.5 w-3.5 shrink-0 rounded" style={{ background: o.kind === 'shape' ? o.color : '#98A2B3' }} />
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              <button
                type="button"
                aria-label={o.locked ? `Unlock ${o.name}` : `Lock ${o.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setLocked(id, !o.locked);
                }}
                className={`rounded p-1 hover:bg-white ${o.locked ? 'text-amber-600' : 'text-muted opacity-0 group-hover:opacity-100'}`}
              >
                {o.locked ? <Lock size={14} /> : <Unlock size={14} />}
              </button>
              <button
                type="button"
                aria-label={o.visible ? `Hide ${o.name}` : `Show ${o.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setVisible(id, !o.visible);
                }}
                className={`rounded p-1 hover:bg-white ${o.visible ? 'text-muted opacity-0 group-hover:opacity-100' : 'text-muted'}`}
              >
                {o.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
