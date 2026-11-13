import { AlertTriangle, Download, RotateCcw, RefreshCw } from 'lucide-react';
import { useProjects } from '@/store/projectStore';
import { useEditor } from '@/store/editorStore';
import { projectToFile, referencedAssets } from '@/cad/serialization/project';
import { getMeshAsset } from '@/cad/assets';
import { downloadBlob, safeFileName } from '@/utils/download';
import type { MeshData } from '@/cad/kernel/meshData';

/** Download whatever is in memory right now — works even if saving or rendering is broken. */
function emergencyBackup() {
  const doc = useEditor.getState().doc;
  const meta = useProjects.getState().current ?? {
    id: 'recovered',
    name: 'Recovered design',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    objectCount: 0,
  };
  const assets: Record<string, MeshData> = {};
  for (const id of referencedAssets(doc)) {
    const a = getMeshAsset(id);
    if (a) assets[id] = a;
  }
  downloadBlob(projectToFile({ meta, document: doc, assets }), `${safeFileName(meta.name)}-backup.modellio`, 'application/json');
}

const btn = 'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold';

/** Shown in place of the 3D view if it crashes; the panels keep working. */
export function ViewportCrash({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="flex h-full items-center justify-center bg-canvas p-6">
      <div className="max-w-md rounded-2xl border border-line bg-white p-6 text-center shadow-float">
        <AlertTriangle className="mx-auto text-amber-500" size={32} />
        <h2 className="mt-3 text-[17px] font-semibold text-ink">The 3D view stopped working</h2>
        <p className="mt-1.5 text-[13px] text-muted">Your design is safe. The panels still work and changes are still saved.</p>
        <p className="mt-2 break-words font-mono text-[11px] text-muted">{error.message}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={reset} className={`${btn} bg-brand text-white hover:bg-brand-600`}>
            <RotateCcw size={15} /> Restart 3D view
          </button>
          <button type="button" onClick={emergencyBackup} className={`${btn} border border-line text-[#344054] hover:bg-canvas`}>
            <Download size={15} /> Download backup
          </button>
        </div>
      </div>
    </div>
  );
}

/** Last-resort screen for a crash anywhere in the app. */
export function AppCrash({ error }: { error: Error }) {
  return (
    <div role="alert" className="flex h-full items-center justify-center bg-canvas p-6">
      <div className="max-w-lg rounded-2xl border border-line bg-white p-8 text-center shadow-float">
        <img src="/logo-dark.png" alt="modellio" className="mx-auto h-7" />
        <h1 className="mt-5 text-[20px] font-semibold text-ink">Something went wrong</h1>
        <p className="mt-2 text-[14px] text-muted">
          MODELLIO hit an unexpected error. Your work is autosaved, so reloading brings back your last saved version. Download a backup
          first if you made changes in the last few seconds.
        </p>
        <p className="mt-3 break-words rounded-lg bg-canvas p-2 font-mono text-[11px] text-muted">{error.message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={emergencyBackup} className={`${btn} border border-line text-[#344054] hover:bg-canvas`}>
            <Download size={15} /> Download backup
          </button>
          <button type="button" onClick={() => location.reload()} className={`${btn} bg-brand text-white hover:bg-brand-600`}>
            <RefreshCw size={15} /> Reload last saved version
          </button>
        </div>
      </div>
    </div>
  );
}
