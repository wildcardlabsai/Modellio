import { FilePlus2, FolderOpen, Save, CopyPlus, FileDown, FileInput, Upload, Download, type LucideIcon } from 'lucide-react';
import { useProjects } from '@/store/projectStore';
import { useFileUi, openMeshPicker, openProjectPicker } from '@/components/files/fileIntake';
import { MOD } from '@/utils/platform';

interface Item {
  label: string;
  Icon: LucideIcon;
  run: () => void;
  shortcut?: string;
}

export function FileMenu({ onDone }: { onDone: () => void }) {
  const p = useProjects.getState();
  const sections: Item[][] = [
    [
      { label: 'New design', Icon: FilePlus2, run: () => void p.newProject() },
      { label: 'My projects…', Icon: FolderOpen, run: () => p.setView('projects') },
      { label: 'Save now', Icon: Save, run: () => void p.saveNow(), shortcut: `${MOD}+S` },
      { label: 'Duplicate design', Icon: CopyPlus, run: () => p.current && void p.duplicate(p.current.id) },
    ],
    [
      { label: 'Import STL / OBJ…', Icon: Upload, run: openMeshPicker },
      { label: 'Export STL / OBJ…', Icon: Download, run: () => useFileUi.getState().setExportOpen(true), shortcut: `${MOD}+E` },
    ],
    [
      { label: 'Download project file (.modellio)', Icon: FileDown, run: () => void p.downloadProjectFile() },
      { label: 'Open project file…', Icon: FileInput, run: openProjectPicker },
    ],
  ];
  return (
    <div className="w-[260px]" role="menu" aria-label="File">
      {sections.map((items, i) => (
        <div key={i} className={i ? 'mt-1.5 border-t border-line pt-1.5' : ''}>
          {items.map(({ label, Icon, run, shortcut }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                run();
                onDone();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-[#344054] hover:bg-brand-50 hover:text-brand"
            >
              <Icon size={16} className="shrink-0" />
              <span className="flex-1">{label}</span>
              {shortcut && <kbd className="font-sans text-[11px] text-muted">{shortcut}</kbd>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
