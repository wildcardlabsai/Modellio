import { useEffect, useState, type ReactNode } from 'react';
import { useProjects } from '@/store/projectStore';
import { FileMenu } from './FileMenu';
import { SaveStatus } from './SaveStatus';
import { openMeshPicker, useFileUi } from '@/components/files/fileIntake';
import {
  Undo2,
  Redo2,
  Copy,
  Trash2,
  Group,
  Ungroup,
  AlignHorizontalJustifyCenter,
  FlipHorizontal2,
  Combine,
  Upload,
  Download,
  Pencil,
  ChevronDown,
  Menu,
} from 'lucide-react';
import {
  Share2,
  PanelRight,
  Spline,
  PencilRuler,
  Box as BoxIcon,
  RotateCw,
  Layers3,
  Route,
  SquareDashedBottom,
  Sparkles,
} from 'lucide-react';
import { useSketchSession } from '@/components/sketch/sketchSession';
import { useSolidBuilder } from '@/components/features/solidBuilder';
import { useFeatureTool } from '@/components/features/featureTool';
import { solidConversion } from '@/cad/brep/convert';
import { useShallow } from 'zustand/react/shallow';
import { useLayout } from '@/hooks/useLayout';
import { ShareDialog } from '@/components/files/ShareDialog';
import { VersionsDialog } from '@/components/projects/VersionsDialog';
import { Popover } from '@/components/ui/Popover';
import { AlignMenu, MirrorMenu } from './AlignMenu';
import { CombineMenu } from './CombineMenu';
import { FeaturesMenu } from './FeaturesMenu';
import { useEditor } from '@/store/editorStore';
import { IconButton } from '@/components/ui/IconButton';
import { MOD } from '@/utils/platform';

const Divider = () => <div className="mx-0.5 h-6 w-px shrink-0 bg-line" aria-hidden />;

/** A labelled cluster of related tools (announced to screen readers as a group). */
function ToolGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 items-center gap-0.5">
      {children}
    </div>
  );
}

/** Fillet and chamfer need one shape that is, or can become, a precise solid. */
function useEdgeTarget(): { ok: boolean; id: string | null; why: string } {
  return useEditor(
    useShallow((s) => {
      if (s.selection.length !== 1) return { ok: false, id: null, why: 'select one shape first' };
      const o = s.doc.objects[s.selection[0]];
      if (o?.kind !== 'shape') return { ok: false, id: null, why: 'select a single shape (not a group)' };
      const c = solidConversion(o);
      return c.ok ? { ok: true, id: o.id, why: '' } : { ok: false, id: null, why: c.reason };
    }),
  );
}

export function Toolbar() {
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const undoLabel = useEditor((s) => s.history.past[s.history.past.length - 1]?.label);
  const redoLabel = useEditor((s) => s.history.future[s.history.future.length - 1]?.label);
  const hasSelection = useEditor((s) => s.selection.length > 0);
  const selectionCount = useEditor((s) => s.selection.length);
  const hasGroup = useEditor((s) => s.selection.some((id) => s.doc.objects[id]?.kind === 'group'));
  const objectCount = useEditor((s) => Object.keys(s.doc.objects).length);
  const edgeTarget = useEdgeTarget();
  const { undo, redo, duplicateSelected, deleteSelected, groupSelected, ungroupSelected } = useEditor.getState();
  const projectName = useProjects((s) => s.current?.name ?? s.shared?.meta.name ?? 'Untitled design');
  const [shareOpen, setShareOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const compact = useLayout((st) => st.compact);
  const inspectorOpen = useLayout((st) => st.inspectorOpen);
  const [name, setName] = useState(projectName);
  useEffect(() => setName(projectName), [projectName]);
  const commitName = () => {
    const p = useProjects.getState();
    if (!name.trim()) setName(projectName);
    else if (name.trim() !== projectName && p.current) void p.rename(p.current.id, name);
  };

  return (
    <div className="scrollbar-thin flex h-[52px] shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-line bg-panel px-3">
      <Popover
        trigger={({ open, toggle }) => (
          <IconButton label="File menu" active={open} onClick={toggle}>
            <Menu size={19} />
          </IconButton>
        )}
      >
        {(close) => <FileMenu onDone={close} onVersions={() => setVersionsOpen(true)} />}
      </Popover>
      <label className="group flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-canvas">
        <input
          aria-label="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          size={Math.min(18, Math.max(8, name.length))}
          className="bg-transparent text-[15px] font-semibold text-ink outline-none"
        />
        <Pencil size={14} className="text-muted" />
      </label>
      <SaveStatus />
      <span className="ml-2 hidden whitespace-nowrap text-[12px] text-muted 2xl:inline">
        {objectCount} object{objectCount === 1 ? '' : 's'}
      </span>
      <Divider />
      <ToolGroup label="History">
        <IconButton label={canUndo ? `Undo ${undoLabel}` : 'Undo'} shortcut={`${MOD}+Z`} disabled={!canUndo} onClick={undo}>
          <Undo2 size={18} />
        </IconButton>
        <IconButton label={canRedo ? `Redo ${redoLabel}` : 'Redo'} shortcut={`${MOD}+⇧+Z`} disabled={!canRedo} onClick={redo}>
          <Redo2 size={18} />
        </IconButton>
      </ToolGroup>
      <Divider />
      <ToolGroup label="Create">
        <IconButton label="New sketch: draw a profile and make it solid" onClick={() => useSketchSession.getState().open(null)}>
          <PencilRuler size={17} />
          <span className="hidden 2xl:inline">Sketch</span>
        </IconButton>
        <IconButton label="Extrude: sketch a profile and pull it up" onClick={() => useSketchSession.getState().open(null, 'extrude')}>
          <BoxIcon size={17} />
          <span className="hidden 2xl:inline">Extrude</span>
        </IconButton>
        <IconButton
          label="Revolve: sketch a profile and spin it around an axis"
          onClick={() => useSketchSession.getState().open(null, 'revolve')}
        >
          <RotateCw size={17} />
          <span className="hidden 2xl:inline">Revolve</span>
        </IconButton>
        <IconButton label="Loft: blend between sketched sections" onClick={() => useSolidBuilder.getState().open('loft')}>
          <Layers3 size={17} />
          <span className="hidden 2xl:inline">Loft</span>
        </IconButton>
        <IconButton label="Sweep: move a profile along a path" onClick={() => useSolidBuilder.getState().open('sweep')}>
          <Route size={17} />
          <span className="hidden 2xl:inline">Sweep</span>
        </IconButton>
      </ToolGroup>
      <Divider />
      <ToolGroup label="Modify">
        <IconButton
          label={edgeTarget.ok ? 'Fillet: round chosen edges' : `Fillet: ${edgeTarget.why}`}
          disabled={!edgeTarget.ok}
          onClick={() => edgeTarget.id && void useFeatureTool.getState().start(edgeTarget.id, 'fillet')}
        >
          <Spline size={17} />
          <span className="hidden 2xl:inline">Fillet</span>
        </IconButton>
        <IconButton
          label={edgeTarget.ok ? 'Chamfer: bevel chosen edges' : `Chamfer: ${edgeTarget.why}`}
          disabled={!edgeTarget.ok}
          onClick={() => edgeTarget.id && void useFeatureTool.getState().start(edgeTarget.id, 'chamfer')}
        >
          <SquareDashedBottom size={17} />
          <span className="hidden 2xl:inline">Chamfer</span>
        </IconButton>
        <Popover
          trigger={({ open, toggle }) => (
            <IconButton label="Features: fillet, chamfer, loft and sweep" active={open} onClick={toggle} data-testid="features-menu">
              <Sparkles size={17} />
              <span className="hidden 2xl:inline">Features</span>
              <ChevronDown size={13} />
            </IconButton>
          )}
        >
          {(close) => <FeaturesMenu onDone={close} />}
        </Popover>
      </ToolGroup>
      <Divider />
      <ToolGroup label="Arrange">
        <IconButton label="Duplicate" shortcut={`${MOD}+D`} disabled={!hasSelection} onClick={duplicateSelected}>
          <Copy size={17} />
        </IconButton>
        <IconButton label="Delete" shortcut="Del" disabled={!hasSelection} onClick={deleteSelected}>
          <Trash2 size={17} />
        </IconButton>
        <IconButton label="Group" shortcut={`${MOD}+G`} disabled={selectionCount < 2} onClick={groupSelected}>
          <Group size={17} />
        </IconButton>
        <IconButton label="Ungroup" shortcut={`${MOD}+⇧+G`} disabled={!hasGroup} onClick={ungroupSelected}>
          <Ungroup size={17} />
        </IconButton>
        <Popover
          trigger={({ open, toggle }) => (
            <IconButton label="Align" active={open} disabled={!hasSelection} onClick={toggle}>
              <AlignHorizontalJustifyCenter size={17} />
            </IconButton>
          )}
        >
          {(close) => <AlignMenu onDone={close} />}
        </Popover>
        <Popover
          trigger={({ open, toggle }) => (
            <IconButton label="Mirror" active={open} disabled={!hasSelection} onClick={toggle}>
              <FlipHorizontal2 size={17} />
            </IconButton>
          )}
        >
          {(close) => <MirrorMenu onDone={close} />}
        </Popover>
        <Popover
          trigger={({ open, toggle }) => (
            <IconButton label="Combine (Boolean)" active={open} disabled={!hasSelection} onClick={toggle} data-tour="combine">
              <Combine size={17} />
              <span className="hidden 2xl:inline">Combine</span>
              <ChevronDown size={13} />
            </IconButton>
          )}
        >
          {(close) => <CombineMenu onDone={close} />}
        </Popover>
      </ToolGroup>
      <div className="flex-1" />
      <IconButton label="Import STL, OBJ, 3MF, STEP, SVG or picture" onClick={openMeshPicker}>
        <Upload size={17} />
        <span className="hidden xl:inline">Import</span>
      </IconButton>
      {compact && (
        <IconButton label="Properties panel" active={inspectorOpen} onClick={() => useLayout.getState().setInspectorOpen(!inspectorOpen)}>
          <PanelRight size={18} />
        </IconButton>
      )}
      <button
        type="button"
        onClick={() => setShareOpen(true)}
        className="ml-1 inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[13px] font-semibold text-ink-2 hover:bg-canvas"
      >
        <Share2 size={16} /> <span className="hidden xl:inline">Share</span>
      </button>
      {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
      {versionsOpen && <VersionsDialog onClose={() => setVersionsOpen(false)} />}
      <button
        type="button"
        onClick={() => useFileUi.getState().setExportOpen(true)}
        data-tour="export"
        className="ml-1 inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3.5 text-[13px] font-semibold text-white shadow-sm hover:bg-brand-600"
      >
        <Download size={17} /> Export
      </button>
    </div>
  );
}
