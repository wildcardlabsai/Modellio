import { useEffect, useState } from 'react';
import { useProjects } from '@/store/projectStore';
import { FileMenu } from './FileMenu';
import { SaveStatus } from './SaveStatus';
import { openMeshPicker, useFileUi } from '@/components/files/fileIntake';
import { Undo2, Redo2, Copy, Trash2, Group, Ungroup, AlignHorizontalJustifyCenter, FlipHorizontal2, Combine, Upload, Download, Pencil, ChevronDown, Menu } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { AlignMenu, MirrorMenu } from './AlignMenu';
import { CombineMenu } from './CombineMenu';
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
  const selectionCount = useEditor((s) => s.selection.length);
  const hasGroup = useEditor((s) => s.selection.some((id) => s.doc.objects[id]?.kind === 'group'));
  const objectCount = useEditor((s) => Object.keys(s.doc.objects).length);
  const { undo, redo, duplicateSelected, deleteSelected, groupSelected, ungroupSelected } = useEditor.getState();
  const projectName = useProjects((s) => s.current?.name ?? 'Untitled design');
  const [name, setName] = useState(projectName);
  useEffect(() => setName(projectName), [projectName]);
  const commitName = () => {
    const p = useProjects.getState();
    if (!name.trim()) setName(projectName);
    else if (name.trim() !== projectName && p.current) void p.rename(p.current.id, name);
  };

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-1 border-b border-line bg-white px-3">
      <Popover
        trigger={({ open, toggle }) => (
          <IconButton label="File menu" active={open} onClick={toggle}>
            <Menu size={19} />
          </IconButton>
        )}
      >
        {(close) => <FileMenu onDone={close} />}
      </Popover>
      <label className="group flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-canvas">
        <input
          aria-label="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          size={Math.max(8, name.length)}
          className="bg-transparent text-[15px] font-semibold text-ink outline-none"
        />
        <Pencil size={14} className="text-muted" />
      </label>
      <SaveStatus />
      <span className="ml-2 hidden text-[12px] text-muted md:inline">
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
      <IconButton label="Group" shortcut={`${MOD}+G`} disabled={selectionCount < 2} onClick={groupSelected}>
        <Group size={17} />
        <span className="hidden xl:inline">Group</span>
      </IconButton>
      <IconButton label="Ungroup" shortcut={`${MOD}+⇧+G`} disabled={!hasGroup} onClick={ungroupSelected}>
        <Ungroup size={17} />
      </IconButton>
      <Popover
        trigger={({ open, toggle }) => (
          <IconButton label="Align" active={open} disabled={!hasSelection} onClick={toggle}>
            <AlignHorizontalJustifyCenter size={17} />
            <span className="hidden xl:inline">Align</span>
            <ChevronDown size={13} />
          </IconButton>
        )}
      >
        {(close) => <AlignMenu onDone={close} />}
      </Popover>
      <Popover
        trigger={({ open, toggle }) => (
          <IconButton label="Mirror" active={open} disabled={!hasSelection} onClick={toggle}>
            <FlipHorizontal2 size={17} />
            <span className="hidden xl:inline">Mirror</span>
            <ChevronDown size={13} />
          </IconButton>
        )}
      >
        {(close) => <MirrorMenu onDone={close} />}
      </Popover>
      <Popover
        trigger={({ open, toggle }) => (
          <IconButton label="Combine (Boolean)" active={open} disabled={!hasSelection} onClick={toggle}>
            <Combine size={17} />
            <span className="hidden xl:inline">Combine</span>
            <ChevronDown size={13} />
          </IconButton>
        )}
      >
        {(close) => <CombineMenu onDone={close} />}
      </Popover>
      <div className="flex-1" />
      <IconButton label="Import STL / OBJ" onClick={openMeshPicker}>
        <Upload size={17} />
        <span className="hidden lg:inline">Import</span>
      </IconButton>
      <button
        type="button"
        onClick={() => useFileUi.getState().setExportOpen(true)}
        className="ml-1 inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3.5 text-[13px] font-semibold text-white shadow-sm hover:bg-brand-600"
      >
        <Download size={17} /> Export
      </button>
    </div>
  );
}
