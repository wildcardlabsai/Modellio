import { useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, Download, Info } from 'lucide-react';
import { Modal, Segmented, primaryBtn, secondaryBtn } from '@/components/ui/Modal';
import { useFileUi } from './fileIntake';
import { useEditor } from '@/store/editorStore';
import { useProjects } from '@/store/projectStore';
import { collectExportBodies } from '@/cad/export/collect';
import { writeAsciiStl, writeBinaryStl, writeObj, type UpAxis } from '@/cad/export/writers';
import { write3mf } from '@/cad/export/threemf';
import { topLevel } from '@/cad/hierarchy';
import { downloadBlob, safeFileName } from '@/utils/download';
import { formatMm } from '@/utils/math';
import { useCadReady } from '@/viewport/cadReady';

type Format = 'stl' | 'stl-ascii' | '3mf' | 'obj';

export function ExportDialog() {
  const open = useFileUi((s) => s.exportOpen);
  if (!open) return null;
  return <ExportDialogInner onClose={() => useFileUi.getState().setExportOpen(false)} />;
}

function ExportDialogInner({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const version = useCadReady((s) => s.version);
  const projectName = useProjects((s) => s.current?.name ?? 'modellio');
  const [format, setFormat] = useState<Format>('stl');
  const [scope, setScope] = useState<'all' | 'selection'>(selection.length ? 'selection' : 'all');
  const [up, setUp] = useState<UpAxis>('z');
  const [withMtl, setWithMtl] = useState(false);

  const collection = useMemo(
    () => collectExportBodies(doc, scope === 'selection' ? topLevel(doc, selection) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, selection, scope, version],
  );
  const size = collection.bounds.isEmpty() ? null : collection.bounds.getSize(collection.bounds.min.clone());
  const leaky = collection.bodies.filter((b) => !b.watertight);
  const [w, d] = doc.settings.workplane;
  const offPlate =
    !collection.bounds.isEmpty() &&
    (collection.bounds.min.x < -w / 2 - 1e-3 ||
      collection.bounds.max.x > w / 2 + 1e-3 ||
      collection.bounds.min.y < -d / 2 - 1e-3 ||
      collection.bounds.max.y > d / 2 + 1e-3);
  const belowPlate = !collection.bounds.isEmpty() && collection.bounds.min.z < -1e-3;
  const empty = collection.bodies.length === 0;

  const doExport = () => {
    const base = safeFileName(projectName);
    try {
      if (format === 'stl') downloadBlob(writeBinaryStl(collection.bodies, up), `${base}.stl`, 'model/stl');
      else if (format === 'stl-ascii') downloadBlob(writeAsciiStl(collection.bodies, up), `${base}.stl`, 'model/stl');
      else if (format === '3mf')
        downloadBlob(write3mf(collection.bodies, projectName) as Uint8Array<ArrayBuffer>, `${base}.3mf`, 'model/3mf');
      else {
        const { obj, mtl } = writeObj(collection.bodies, up, withMtl ? `${base}.mtl` : undefined);
        downloadBlob(obj, `${base}.obj`, 'model/obj');
        if (withMtl) setTimeout(() => downloadBlob(mtl, `${base}.mtl`, 'text/plain'), 300);
      }
      useEditor
        .getState()
        .notify(
          `Exported ${collection.bodies.length} object${collection.bodies.length > 1 ? 's' : ''} · ${collection.triangles.toLocaleString()} triangles`,
        );
      onClose();
    } catch (e) {
      useEditor.getState().notify(`Export failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <Modal
      title="Export for 3D printing"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={primaryBtn} disabled={empty} onClick={doExport}>
            <Download size={16} /> Download {format === 'obj' ? 'OBJ' : format === '3mf' ? '3MF' : 'STL'}
          </button>
        </>
      }
    >
      <h3 className="mb-2 text-[13px] font-semibold text-ink">Format</h3>
      <Segmented
        label="Format"
        value={format}
        onChange={setFormat}
        options={[
          { value: 'stl', label: 'STL (binary)' },
          { value: 'stl-ascii', label: 'STL (text)' },
          { value: '3mf', label: '3MF' },
          { value: 'obj', label: 'OBJ' },
        ]}
      />
      <h3 className="mb-2 mt-4 text-[13px] font-semibold text-ink">What to export</h3>
      <Segmented
        label="Export scope"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'all', label: 'Everything' },
          { value: 'selection', label: `Selection${selection.length ? ` (${selection.length})` : ''}` },
        ]}
      />
      <h3 className="mb-2 mt-4 text-[13px] font-semibold text-ink">Up axis</h3>
      <Segmented
        label="Up axis"
        value={up}
        onChange={setUp}
        options={[
          { value: 'z', label: 'Z up (slicers)' },
          { value: 'y', label: 'Y up (3D apps)' },
        ]}
      />
      {format === '3mf' && (
        <p className="mt-3 text-[12px] text-muted">
          3MF keeps millimetres, object names and colours. Preferred by PrusaSlicer, Bambu Studio, OrcaSlicer and Cura.
        </p>
      )}
      {format === 'obj' && (
        <label className="mt-3 flex items-center gap-2 text-[13px] text-[#344054]">
          <input type="checkbox" checked={withMtl} onChange={(e) => setWithMtl(e.target.checked)} className="h-4 w-4 accent-[#2463EB]" />
          Also download colours (.mtl)
        </label>
      )}

      <div className="mt-5 rounded-xl border border-line p-4" data-testid="export-summary">
        {empty ? (
          <p className="flex items-center gap-1.5 text-[13px] text-amber-700">
            <CircleAlert size={15} /> Nothing to export: {scope === 'selection' ? 'the selection has' : 'the design has'} no visible solids.
          </p>
        ) : (
          <>
            <p className="text-[13px] text-ink">
              <strong>{collection.bodies.length}</strong> object{collection.bodies.length > 1 ? 's' : ''} ·{' '}
              <strong>{collection.triangles.toLocaleString()}</strong> triangles
            </p>
            {size && (
              <p className="mt-1 text-[13px] tabular-nums text-muted">
                Overall size {formatMm(size.x)} × {formatMm(size.y)} × {formatMm(size.z)} mm
              </p>
            )}
            <p className={`mt-2 flex items-start gap-1.5 text-[12px] ${leaky.length ? 'text-amber-700' : 'text-emerald-700'}`}>
              {leaky.length ? <CircleAlert size={14} className="mt-px shrink-0" /> : <CircleCheck size={14} className="mt-px shrink-0" />}
              {leaky.length
                ? `Not watertight: ${leaky.map((b) => b.name).join(', ')}. Your slicer may need to repair it.`
                : 'All objects are watertight solids.'}
            </p>
          </>
        )}
        {collection.skippedHoles > 0 && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-muted">
            <Info size={14} className="mt-px shrink-0" /> {collection.skippedHoles} hole{collection.skippedHoles > 1 ? 's' : ''} not inside
            a combination
            {collection.skippedHoles > 1 ? ' were' : ' was'} skipped (holes only cut when combined).
          </p>
        )}
        {collection.failed.map((f) => (
          <p key={f.name} className="mt-1.5 flex items-start gap-1.5 text-[12px] text-red-700">
            <CircleAlert size={14} className="mt-px shrink-0" /> {f.name}: {f.reason}
          </p>
        ))}
        {belowPlate && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-amber-700">
            <CircleAlert size={14} className="mt-px shrink-0" /> Part of the model is below the workplane. Use “Drop to workplane” (D)
            before printing.
          </p>
        )}
        {offPlate && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-amber-700">
            <CircleAlert size={14} className="mt-px shrink-0" /> The model extends beyond the {w} × {d} mm plate.
          </p>
        )}
      </div>
      <p className="mt-3 text-[11px] text-muted">
        Units: millimetres. Positions are exported as placed; your slicer will centre the model on its bed.
      </p>
    </Modal>
  );
}
