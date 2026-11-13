import { useMemo, useRef, useState, type DragEvent } from 'react';
import { ChevronRight, Eye, EyeOff, Lock, Unlock, Trash2, FolderClosed, FolderOpen, Combine } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import type { ModelDocument, ObjectId } from '@/types/document';
import { isEffectivelyLocked, siblingsOf } from '@/cad/hierarchy';

const TREE_MIME = 'application/x-modellio-tree';

interface Row {
  id: ObjectId;
  depth: number;
}

/** Depth-first list of the rows currently visible (collapsed groups hide their children). */
function flatten(doc: ModelDocument, collapsed: Record<ObjectId, boolean>): Row[] {
  const rows: Row[] = [];
  const visit = (id: ObjectId, depth: number) => {
    const o = doc.objects[id];
    if (!o) return;
    rows.push({ id, depth });
    if (o.kind === 'group' && !collapsed[id]) o.children.forEach((c) => visit(c, depth + 1));
  };
  doc.rootIds.forEach((id) => visit(id, 0));
  return rows;
}

type DropZone = 'before' | 'after' | 'into';

/**
 * The scene hierarchy. Synchronised with the viewport through the store:
 * selecting here selects in 3D and vice versa.
 */
export function ObjectTree() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const collapsed = useEditor((s) => s.collapsed);
  const rows = useMemo(() => flatten(doc, collapsed), [doc, collapsed]);
  const anchor = useRef<ObjectId | null>(null);
  const [renaming, setRenaming] = useState<ObjectId | null>(null);
  const [drop, setDrop] = useState<{ id: ObjectId | null; zone: DropZone } | null>(null);
  const s = useEditor.getState();
  const treeRef = useRef<HTMLUListElement>(null);
  const [focusId, setFocusId] = useState<ObjectId | null>(null);
  const rowIds = rows.map((r) => r.id);
  // Roving tab stop: the focused row, else the selected one, else the first.
  const currentFocus = focusId && rowIds.includes(focusId) ? focusId : (selection.find((id) => rowIds.includes(id)) ?? rowIds[0]);

  const focusRow = (id: ObjectId) => {
    setFocusId(id);
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-row-id="${id}"]`)?.focus());
  };

  /** Keyboard navigation (WAI-ARIA tree pattern). */
  const onTreeKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || !currentFocus) return;
    const i = rowIds.indexOf(currentFocus);
    const o = doc.objects[currentFocus];
    const go = (j: number, extend: boolean) => {
      const id = rowIds[Math.max(0, Math.min(rowIds.length - 1, j))];
      s.select([id], { additive: extend });
      focusRow(id);
    };
    switch (e.key) {
      case 'ArrowDown':
        go(i + 1, e.shiftKey);
        break;
      case 'ArrowUp':
        go(i - 1, e.shiftKey);
        break;
      case 'Home':
        go(0, false);
        break;
      case 'End':
        go(rowIds.length - 1, false);
        break;
      case 'ArrowRight':
        if (o?.kind === 'group') {
          if (collapsed[currentFocus]) s.toggleCollapsed(currentFocus);
          else if (o.children[0]) go(rowIds.indexOf(o.children[0]), false);
        }
        break;
      case 'ArrowLeft':
        if (o?.kind === 'group' && !collapsed[currentFocus]) s.toggleCollapsed(currentFocus);
        else if (o?.parentId) go(rowIds.indexOf(o.parentId), false);
        break;
      case 'Enter':
      case 'F2':
        setRenaming(currentFocus);
        break;
      case ' ':
        s.select([currentFocus], { toggle: true });
        break;
      case 'Delete':
      case 'Backspace':
        if (!selection.includes(currentFocus)) s.select([currentFocus]);
        s.deleteSelected();
        requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>('[role=treeitem]')?.focus());
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation(); // arrow keys here navigate the list rather than nudging objects
  };

  if (!rows.length) {
    return <p className="px-5 py-6 text-[13px] text-muted">No objects yet. Add a shape from the library.</p>;
  }

  const onRowClick = (id: ObjectId, e: React.MouseEvent) => {
    if (e.shiftKey && anchor.current) {
      const ids = rows.map((r) => r.id);
      const a = ids.indexOf(anchor.current);
      const b = ids.indexOf(id);
      if (a !== -1 && b !== -1) {
        s.select(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) s.select([id], { toggle: true });
    else s.select([id]);
    anchor.current = id;
  };

  const zoneFor = (e: DragEvent, isGroup: boolean): DropZone => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = (e.clientY - r.top) / r.height;
    if (isGroup) return t < 0.25 ? 'before' : t > 0.75 ? 'after' : 'into';
    return t < 0.5 ? 'before' : 'after';
  };

  const onDrop = (e: DragEvent, targetId: ObjectId | null, zone: DropZone) => {
    e.preventDefault();
    setDrop(null);
    const raw = e.dataTransfer.getData(TREE_MIME);
    if (!raw) return;
    const ids: ObjectId[] = JSON.parse(raw);
    if (!targetId) {
      s.moveInTree(ids, null, doc.rootIds.length);
      return;
    }
    const target = doc.objects[targetId];
    if (zone === 'into' && target.kind === 'group') {
      s.moveInTree(ids, targetId, target.children.length);
      return;
    }
    const list = siblingsOf(doc, target.parentId);
    const idx = list.indexOf(targetId) + (zone === 'after' ? 1 : 0);
    s.moveInTree(ids, target.parentId, idx);
  };

  return (
    <ul
      className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-2"
      aria-label="Object tree"
      role="tree"
      ref={treeRef}
      onKeyDown={onTreeKey}
      aria-multiselectable="true"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(TREE_MIME)) e.preventDefault();
      }}
      onDrop={(e) => onDrop(e, null, 'after')}
    >
      {rows.map(({ id, depth }) => {
        const o = doc.objects[id];
        const active = selection.includes(id);
        const isGroup = o.kind === 'group';
        const inheritedLock = !o.locked && isEffectivelyLocked(doc, id);
        const dropHere = drop?.id === id ? drop.zone : null;
        return (
          <li
            key={id}
            role="treeitem"
            aria-selected={active}
            aria-expanded={isGroup ? !collapsed[id] : undefined}
            aria-level={depth + 1}
            aria-label={`${o.name}${isGroup ? (o.combine ? ', combination' : ', group') : o.isHole ? ', hole' : ''}${o.visible ? '' : ', hidden'}${o.locked ? ', locked' : ''}`}
            data-row-id={id}
            tabIndex={currentFocus === id ? 0 : -1}
            onFocus={(e) => e.target === e.currentTarget && setFocusId(id)}
            className="relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {dropHere === 'before' && <div className="absolute inset-x-2 top-0 h-0.5 rounded bg-brand" />}
            {dropHere === 'after' && <div className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-brand" />}
            <div
              draggable={renaming !== id}
              onDragStart={(e) => {
                const ids = selection.includes(id) ? selection : [id];
                e.dataTransfer.setData(TREE_MIME, JSON.stringify(ids));
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(TREE_MIME)) return;
                e.preventDefault();
                e.stopPropagation();
                const zone = zoneFor(e, isGroup);
                if (drop?.id !== id || drop.zone !== zone) setDrop({ id, zone });
              }}
              onDragLeave={() => setDrop(null)}
              onDrop={(e) => {
                e.stopPropagation();
                onDrop(e, id, zoneFor(e, isGroup));
              }}
              onClick={(e) => onRowClick(id, e)}
              onDoubleClick={() => setRenaming(id)}
              className={`group flex h-9 cursor-pointer items-center gap-1.5 rounded-lg pr-1.5 text-[13px] ${
                active ? 'bg-brand-50 font-medium text-brand' : 'text-[#344054] hover:bg-canvas'
              } ${dropHere === 'into' ? 'ring-2 ring-brand/50' : ''} ${o.visible ? '' : 'opacity-50'}`}
              style={{ paddingLeft: 6 + depth * 16 }}
            >
              {isGroup ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={collapsed[id] ? `Expand ${o.name}` : `Collapse ${o.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    s.toggleCollapsed(id);
                  }}
                  className="rounded p-0.5 text-muted hover:bg-white"
                >
                  <ChevronRight size={14} className={`transition-transform ${collapsed[id] ? '' : 'rotate-90'}`} />
                </button>
              ) : (
                <span className="w-[18px]" />
              )}
              {isGroup ? (
                o.combine ? (
                  <Combine size={15} className="shrink-0 text-brand" />
                ) : collapsed[id] ? (
                  <FolderClosed size={15} className="shrink-0 text-muted" />
                ) : (
                  <FolderOpen size={15} className="shrink-0 text-muted" />
                )
              ) : (
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded"
                  title={o.isHole ? 'Hole' : undefined}
                  style={
                    o.isHole
                      ? { background: 'repeating-linear-gradient(45deg,#aab3c2 0 2px,#eef1f5 2px 4px)', outline: '1px dashed #8c97ab' }
                      : { background: o.color }
                  }
                />
              )}
              {renaming === id ? (
                <input
                  autoFocus
                  aria-label="Rename object"
                  defaultValue={o.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    s.rename(id, e.target.value);
                    setRenaming(null);
                    focusRow(id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-brand bg-white px-1 py-0.5 text-[13px] text-ink outline-none"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate" title="Double-click to rename">
                  {o.name}
                  {isGroup && <span className="ml-1 text-[11px] font-normal text-muted">({o.children.length})</span>}
                </span>
              )}
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Delete ${o.name}`}
                disabled={isEffectivelyLocked(doc, id)}
                onClick={(e) => {
                  e.stopPropagation();
                  s.select([id]);
                  s.deleteSelected();
                }}
                className="rounded p-1 text-muted opacity-0 hover:bg-white hover:text-red-600 group-hover:opacity-100 disabled:hidden"
              >
                <Trash2 size={14} />
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label={o.locked ? `Unlock ${o.name}` : `Lock ${o.name}`}
                title={inheritedLock ? 'Locked by its group' : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  s.setLocked(id, !o.locked);
                }}
                className={`rounded p-1 hover:bg-white ${
                  o.locked ? 'text-amber-600' : inheritedLock ? 'text-amber-600/40' : 'text-muted opacity-0 group-hover:opacity-100'
                }`}
              >
                {o.locked || inheritedLock ? <Lock size={14} /> : <Unlock size={14} />}
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label={o.visible ? `Hide ${o.name}` : `Show ${o.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  s.setVisible(id, !o.visible);
                }}
                className={`rounded p-1 hover:bg-white ${o.visible ? 'text-muted opacity-0 group-hover:opacity-100' : 'text-muted'}`}
              >
                {o.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </div>
          </li>
        );
      })}
      {drop?.id === null && <li className="mx-2 h-0.5 rounded bg-brand" />}
    </ul>
  );
}
