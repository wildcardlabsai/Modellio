import { useState, type ReactNode } from 'react';
import {
  Copy,
  FilePlus2,
  FolderOpen,
  History,
  LayoutDashboard,
  Menu as MenuIcon,
  Pencil,
  PencilRuler,
  Save,
  SaveAll,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { ConfirmChoice } from '@/components/ui/ConfirmChoice';
import { useProjects } from '@/store/projectStore';
import { useStudio } from '@/app/studio';
import { workspaceOf } from '@/cad/serialization/project';
import { WORKSPACE_LABEL } from '@/platform/catalog';
import { MOD } from '@/utils/platform';

export interface MenuItem {
  label: string;
  Icon: LucideIcon;
  run: () => void;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
}

/** What the open workspace does for the project-specific items. */
export interface ProjectActions {
  /** The open design's name (for the delete confirmation). */
  name: string;
  save: () => void;
  saveAs: () => void;
  rename?: () => void;
  duplicate?: () => void;
  remove?: () => void;
  versions?: () => void;
  openInDesign?: () => void;
}

/**
 * The project menu, the same in every workspace: New design, Open, Recent designs, Save, Save as,
 * Rename, Duplicate, Delete, Version history and Return to dashboard. Workspaces add their own
 * items (the Design Studio's import and export) in `extra`.
 */
export function ProjectMenu({
  actions,
  extra = [],
  trigger,
}: {
  actions: ProjectActions;
  extra?: MenuItem[][];
  /** A different trigger button (default: the menu icon). */
  trigger?: (p: { open: boolean; toggle: () => void }) => ReactNode;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Re-render when the project list changes (Recent).
  useProjects((s) => s.projects);
  const current = useProjects((s) => s.current);
  const recent = useProjects
    .getState()
    .recent(6)
    .filter((p) => p.id !== current?.id)
    .slice(0, 5);
  const p = useProjects.getState();
  const sections: MenuItem[][] = [
    [
      { label: 'New design…', Icon: FilePlus2, run: () => p.setDialog('new') },
      { label: 'Open…', Icon: FolderOpen, run: () => p.setDialog('open') },
    ],
    [
      { label: 'Save', Icon: Save, run: actions.save, shortcut: `${MOD}+S` },
      { label: 'Save as…', Icon: SaveAll, run: actions.saveAs },
      ...(actions.rename ? [{ label: 'Rename…', Icon: Pencil, run: actions.rename }] : []),
      ...(actions.duplicate ? [{ label: 'Duplicate', Icon: Copy, run: actions.duplicate }] : []),
      ...(actions.versions ? [{ label: 'Version history…', Icon: History, run: actions.versions }] : []),
      ...(actions.openInDesign ? [{ label: 'Open in Design Studio', Icon: PencilRuler, run: actions.openInDesign }] : []),
      ...(actions.remove ? [{ label: 'Delete…', Icon: Trash2, run: () => setConfirmDelete(true), danger: true }] : []),
    ],
    ...extra,
    [{ label: 'Return to dashboard', Icon: LayoutDashboard, run: () => useStudio.getState().setStudio('dashboard') }],
  ];
  return (
    <>
      <Popover
        trigger={
          trigger ??
          (({ open, toggle }) => (
            <button
              type="button"
              aria-label="File menu"
              aria-expanded={open}
              onClick={toggle}
              title="Project: new, open, save…"
              className={`flex h-9 w-9 items-center justify-center rounded-lg ${open ? 'bg-brand-50 text-brand-ink' : 'text-ink-2 hover:bg-canvas'}`}
            >
              <MenuIcon size={19} />
            </button>
          ))
        }
      >
        {(close) => (
          <div className="w-[280px]" role="menu" aria-label="Project">
            {sections.map((items, i) => (
              <div key={i} className={i ? 'mt-1.5 border-t border-line pt-1.5' : ''}>
                {items.map((it) => (
                  <Item key={it.label} item={it} close={close} />
                ))}
                {i === 0 && recent.length > 0 && (
                  <div className="mt-1" aria-label="Recent designs" role="group">
                    <p className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Recent</p>
                    {recent.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close();
                          void useProjects.getState().openProject(m.id);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:bg-brand-50 hover:text-brand-ink"
                        data-testid="recent-design"
                      >
                        <span className="min-w-0 flex-1 truncate">{m.name}</span>
                        <span className="shrink-0 text-[11px] text-muted">{WORKSPACE_LABEL[workspaceOf(m)] ?? workspaceOf(m)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Popover>
      {confirmDelete && actions.remove && (
        <ConfirmChoice
          title="Delete design?"
          onCancel={() => setConfirmDelete(false)}
          choices={[
            {
              label: 'Delete',
              variant: 'danger',
              testId: 'confirm-delete-design',
              onChoose: () => {
                setConfirmDelete(false);
                actions.remove!();
              },
            },
          ]}
        >
          “{actions.name}” and its version history will be permanently removed from this device. This can’t be undone.
        </ConfirmChoice>
      )}
    </>
  );
}

function Item({ item, close }: { item: MenuItem; close: () => void }) {
  const { label, Icon, run, shortcut, danger, disabled } = item;
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        close();
        run();
      }}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium disabled:opacity-40 ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-ink-2 hover:bg-brand-50 hover:text-brand-ink'
      }`}
    >
      <Icon size={16} className="shrink-0" />
      <span className="flex-1">{label}</span>
      {shortcut && <kbd className="font-sans text-[11px] text-muted">{shortcut}</kbd>}
    </button>
  );
}
