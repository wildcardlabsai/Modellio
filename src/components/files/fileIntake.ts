import { create } from 'zustand';
import { parseMeshFile, ImportError, type ParsedFile } from '@/cad/import/importMesh';
import { ProjectFormatError } from '@/cad/serialization/project';
import { useEditor } from '@/store/editorStore';
import { useProjects } from '@/store/projectStore';

interface FileUiState {
  /** Parsed mesh files waiting for the user to confirm import options. */
  queue: { parsed: ParsedFile; at?: [number, number] }[];
  exportOpen: boolean;
  busy: string | null;
  setExportOpen: (v: boolean) => void;
  shift: () => void;
}

export const useFileUi = create<FileUiState>()((set, get) => ({
  queue: [],
  exportOpen: false,
  busy: null,
  setExportOpen: (exportOpen) => set({ exportOpen }),
  shift: () => set({ queue: get().queue.slice(1) }),
}));

const MAX_FILE_BYTES = 200 * 1024 * 1024;

/**
 * Accept files from the picker or drag & drop. Meshes (STL/OBJ) go to the
 * import dialog; .modellio files are opened as projects.
 */
export async function handleFiles(files: File[], at?: [number, number]) {
  const notify = useEditor.getState().notify;
  for (const file of files) {
    const name = file.name.toLowerCase();
    if (file.size > MAX_FILE_BYTES) {
      notify(`${file.name} is too large (max 200 MB).`);
      continue;
    }
    try {
      useFileUi.setState({ busy: `Reading ${file.name}…` });
      if (name.endsWith('.modellio') || name.endsWith('.json')) {
        await useProjects.getState().importProjectFile(await file.text());
        notify(`Opened project “${useProjects.getState().current?.name}”`);
        continue;
      }
      // Yield so the "Reading…" indicator paints before a large parse.
      await new Promise((r) => setTimeout(r, 30));
      const parsed = parseMeshFile(file.name, await file.arrayBuffer());
      useFileUi.setState((s) => ({ queue: [...s.queue, { parsed, at }] }));
    } catch (e) {
      notify(
        e instanceof ImportError || e instanceof ProjectFormatError
          ? e.message
          : `Could not import ${file.name}: ${e instanceof Error ? e.message : e}`,
      );
    } finally {
      useFileUi.setState({ busy: null });
    }
  }
}

let meshInput: HTMLInputElement | null = null;
let projectInput: HTMLInputElement | null = null;

function picker(accept: string, multiple: boolean): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = multiple;
  input.style.display = 'none';
  input.dataset.testid = accept.includes('.stl') ? 'mesh-file-input' : 'project-file-input';
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    void handleFiles(files);
  });
  document.body.appendChild(input);
  return input;
}

export function openMeshPicker() {
  meshInput ??= picker('.stl,.obj', true);
  meshInput.click();
}

export function openProjectPicker() {
  projectInput ??= picker('.modellio,application/json', false);
  projectInput.click();
}
