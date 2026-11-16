import { useState } from 'react';
import { Download, FileDown, FileInput, Upload } from 'lucide-react';
import { useProjects } from '@/store/projectStore';
import { useFileUi, openMeshPicker, openProjectPicker } from '@/components/files/fileIntake';
import { ProjectMenu } from '@/components/projects/ProjectMenu';
import { RenameDialog } from '@/components/projects/ProjectsPage';
import { MOD } from '@/utils/platform';

/** The Design Studio's project menu: the shared project items, plus import, export and project files. */
export function FileMenu({ onVersions }: { onVersions: () => void }) {
  const current = useProjects((s) => s.current);
  const [renaming, setRenaming] = useState(false);
  const p = useProjects.getState();
  const saved = !!current?.savedAt;
  return (
    <>
      <ProjectMenu
        actions={{
          name: current?.name ?? 'This design',
          save: () => void p.save(),
          saveAs: () => void p.saveAs(),
          rename: () => setRenaming(true),
          ...(saved && current
            ? {
                duplicate: () => void p.duplicate(current.id),
                remove: () => void p.remove(current.id),
                versions: onVersions,
              }
            : {}),
        }}
        extra={[
          [
            { label: 'Import STL, OBJ, 3MF, STEP, SVG or picture…', Icon: Upload, run: openMeshPicker },
            { label: 'Export STL / OBJ…', Icon: Download, run: () => useFileUi.getState().setExportOpen(true), shortcut: `${MOD}+E` },
          ],
          [
            { label: 'Download project file (.modellio)', Icon: FileDown, run: () => void p.downloadProjectFile() },
            { label: 'Open project file…', Icon: FileInput, run: openProjectPicker },
          ],
        ]}
      />
      {renaming && current && <RenameDialog meta={current} onClose={() => setRenaming(false)} />}
    </>
  );
}
