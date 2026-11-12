import { useState } from 'react';
import { Undo2, Redo2, Copy, Trash2, Group, Ungroup, AlignHorizontalJustifyCenter, FlipHorizontal2, Combine, Upload, Download, Pencil } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import { IconButton } from '@/components/ui/IconButton';
import { MOD } from '@/utils/platform';

const Divider = () => <div className="mx-1.5 h-6 w-px bg-line" />;

export function Toolbar() {
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const undoLabel = useEditor((s) => s.history.past[s.history.past.length - 1]?.label);
  const redoLabel = useEditor((s) => s.history.future[s.history.future.length - 1]?.label);
  const hasSelection = useEditor((s) => s.selection.length > 0);
  const objectCount = useEditor((s) => Object.keys(s.doc.objects).length);
  const { undo, redo, duplicateSelected, deleteSelected } = useEditor.getState();
  const [name, setName] = useState('Untitled design');

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-1 border-b border-line bg-white px-3">
      <label className="group flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-canvas">
        <input
          aria-label="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => !name.trim() && setName('Untitled design')}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          size={Math.max(8, name.length)}
          className="bg-transparent text-[15px] font-semibold text-ink outline-none"
        />
        <Pencil size={14} className="text-muted" />
      </label>
      <span className="ml-1 text-[12px] text-muted">
        {objectCount} object{objectCount === 1 ? '' : 's'}
      </span>
      <Divider />
      <IconButton label={canUndo ? `Undo ${undoLabel}` : 'Undo'} shortcut={`${MOD}+Z`} disabled={!canUndo} onClick={undo}>
        <Undo2 size={18} />
      </IconButton>
      <IconButton label={canRedo ? `Redo ${redoLabel}` : 'Redo'} shortcut={`${MOD}+⇧+Z`} disabled={!canRedo} onClick={redo}>
        <Redo2 size={18} />
      </IconButton>
      <Divider />
      <IconButton label="Duplicate" shortcut={`${MOD}+D`} disabled={!hasSelection} onClick={duplicateSelected}>
        <Copy size={17} />
        <span className="hidden xl:inline">Duplicate</span>
      </IconButton>
      <IconButton label="Delete" shortcut="Del" disabled={!hasSelection} onClick={deleteSelected}>
        <Trash2 size={17} />
        <span className="hidden xl:inline">Delete</span>
      </IconButton>
      <Divider />
      {/* Phase 2–3 operations, shown disabled so the roadmap is visible. */}
      <IconButton label="Group — Phase 2" shortcut={`${MOD}+G`} disabled>
        <Group size={17} />
        <span className="hidden xl:inline">Group</span>
      </IconButton>
      <IconButton label="Ungroup — Phase 2" disabled>
        <Ungroup size={17} />
      </IconButton>
      <IconButton label="Align — Phase 2" disabled>
        <AlignHorizontalJustifyCenter size={17} />
        <span className="hidden xl:inline">Align</span>
      </IconButton>
      <IconButton label="Mirror — Phase 2" disabled>
        <FlipHorizontal2 size={17} />
        <span className="hidden xl:inline">Mirror</span>
      </IconButton>
      <IconButton label="Combine (Boolean) — Phase 3" disabled>
        <Combine size={17} />
        <span className="hidden xl:inline">Combine</span>
      </IconButton>
      <div className="flex-1" />
      <IconButton label="Import STL/OBJ — Phase 4" disabled>
        <Upload size={17} />
        <span className="hidden lg:inline">Import</span>
      </IconButton>
      <IconButton label="Export STL/OBJ — Phase 4" disabled>
        <Download size={17} />
        <span className="hidden lg:inline">Export</span>
      </IconButton>
    </div>
  );
}
