import { create } from 'zustand';
import * as THREE from 'three';
import type { ParsedFile } from '@/cad/import/importMesh';
import { meshDataBounds } from '@/cad/kernel/meshData';
import { initKernel } from '@/cad/kernel/kernel';
import { ASSET_ACCEPT, assetKind, meshPartsFromFile, useAssets } from '@/assets/library';
import { isOutlineFile, outlineFromFile, outlineToMesh } from '@/assets/outlines';
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
 * Accept files from the picker, drag & drop or the asset library:
 *  - .modellio projects open as projects;
 *  - SVGs and pictures become a solid (traced, 40 mm wide, 2 mm tall) at once;
 *  - STL, OBJ and 3MF go to the import dialog (units, up axis; 3MF keeps its colours).
 * Unless `save` is false, artwork and models are also kept in the asset library.
 */
export async function handleFiles(files: File[], at?: [number, number], opts: { save?: boolean } = {}) {
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
      if (opts.save !== false && assetKind(file.name, file.type)) void useAssets.getState().add([file]);
      if (isOutlineFile(file.name, file.type)) {
        await addArtwork(file, at);
        continue;
      }
      // Parsers (STL/OBJ loaders, the 3MF reader) are loaded on first import.
      let parsed: ParsedFile;
      if (name.endsWith('.3mf')) {
        const { parts } = await meshPartsFromFile(file);
        const bounds = new THREE.Box3();
        for (const p of parts) bounds.union(meshDataBounds(p.mesh));
        parsed = {
          fileName: file.name,
          format: '3mf',
          parts,
          triangles: parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0),
          size: bounds.getSize(new THREE.Vector3()),
          suggestedUnit: 'mm',
          suggestedUp: 'z',
        };
      } else {
        const { parseMeshFile } = await import('@/cad/import/importMesh');
        parsed = parseMeshFile(file.name, await file.arrayBuffer());
      }
      useFileUi.setState((s) => ({ queue: [...s.queue, { parsed, at }] }));
    } catch (e) {
      // ImportError lives in the lazily loaded parser module, so match it by name.
      const readable =
        e instanceof ProjectFormatError || (e instanceof Error && (e.name === 'ImportError' || e.name === 'ImportFailedError'));
      notify(readable ? (e as Error).message : `Could not import ${file.name}: ${e instanceof Error ? e.message : e}`);
    } finally {
      useFileUi.setState({ busy: null });
    }
  }
}

/** An SVG or picture as a solid: traced outline, 40 mm on its longest side, 2 mm tall. */
async function addArtwork(file: File, at?: [number, number]) {
  const outline = await outlineFromFile(file);
  const mesh = outlineToMesh(await initKernel(), outline, 40, 2);
  useEditor.getState().importMeshes([{ name: outline.name, mesh, color: '#2463EB' }], { at, groupName: outline.name });
  useEditor.getState().notify(`Added “${outline.name}”, 40 mm wide and 2 mm tall. Resize it like any shape.`);
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
  meshInput ??= picker(ASSET_ACCEPT, true);
  meshInput.click();
}

export function openProjectPicker() {
  projectInput ??= picker('.modellio,application/json', false);
  projectInput.click();
}
