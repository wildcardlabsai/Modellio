import { useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, FileUp } from 'lucide-react';
import { Modal, Segmented, primaryBtn, secondaryBtn } from '@/components/ui/Modal';
import { useFileUi } from './fileIntake';
import { useEditor } from '@/store/editorStore';
import { isWatertight, normalizeMesh, UNIT_SCALE, type ImportUnit } from '@/cad/import/importMesh';
import { formatMm } from '@/utils/math';

const UNITS: { value: ImportUnit; label: string }[] = [
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm' },
  { value: 'in', label: 'inch' },
  { value: 'm', label: 'm' },
];

/** Confirms units / orientation for a parsed STL or OBJ before it enters the scene. */
export function ImportDialog() {
  const item = useFileUi((s) => s.queue[0]);
  const shift = useFileUi((s) => s.shift);
  if (!item) return null;
  return <ImportDialogInner key={item.parsed.fileName + item.parsed.triangles} item={item} onDone={shift} />;
}

function ImportDialogInner({ item, onDone }: { item: ReturnType<typeof useFileUi.getState>['queue'][number]; onDone: () => void }) {
  const { parsed, at } = item;
  const [unit, setUnit] = useState<ImportUnit>(parsed.suggestedUnit);
  const [up, setUp] = useState<'z' | 'y'>(parsed.suggestedUp);
  const [merge, setMerge] = useState(false);
  const watertight = useMemo(() => parsed.parts.map((p) => isWatertight(p.mesh)), [parsed]);
  const open = watertight.filter((w) => !w).length;

  const s = UNIT_SCALE[unit];
  const dims = up === 'z' ? [parsed.size.x, parsed.size.y, parsed.size.z] : [parsed.size.x, parsed.size.z, parsed.size.y];
  const mm = dims.map((d) => d * s);
  const tooBig = Math.max(...mm) > 2000;
  const tooSmall = Math.max(...mm) < 0.5;

  const doImport = () => {
    let parts = parsed.parts.map((p) => ({ name: p.name, mesh: normalizeMesh(p.mesh, unit, up) }));
    if (merge && parts.length > 1) {
      // Concatenate into one mesh (keeps every part's placement).
      let vOff = 0;
      const positions = new Float32Array(parts.reduce((n, p) => n + p.mesh.positions.length, 0));
      const indices = new Uint32Array(parts.reduce((n, p) => n + p.mesh.indices.length, 0));
      let pi = 0;
      let ii = 0;
      for (const p of parts) {
        positions.set(p.mesh.positions, pi);
        for (let k = 0; k < p.mesh.indices.length; k++) indices[ii + k] = p.mesh.indices[k] + vOff;
        pi += p.mesh.positions.length;
        ii += p.mesh.indices.length;
        vOff += p.mesh.positions.length / 3;
      }
      parts = [{ name: parsed.fileName.replace(/\.[^.]+$/, ''), mesh: { positions, indices } }];
    }
    useEditor.getState().importMeshes(parts, { at, groupName: parsed.fileName.replace(/\.[^.]+$/, '') });
    onDone();
  };

  return (
    <Modal
      title={`Import ${parsed.fileName}`}
      onClose={onDone}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onDone}>
            Cancel
          </button>
          <button type="button" className={primaryBtn} onClick={doImport}>
            <FileUp size={16} /> Import
          </button>
        </>
      }
    >
      <dl className="grid grid-cols-3 gap-3 rounded-xl bg-canvas p-4 text-center">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Format</dt>
          <dd className="mt-0.5 text-[15px] font-semibold uppercase text-ink">{parsed.format}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Parts</dt>
          <dd className="mt-0.5 text-[15px] font-semibold text-ink">{parsed.parts.length}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Triangles</dt>
          <dd className="mt-0.5 text-[15px] font-semibold tabular-nums text-ink">{parsed.triangles.toLocaleString()}</dd>
        </div>
      </dl>

      <h3 className="mb-2 mt-5 text-[13px] font-semibold text-ink">File units</h3>
      <Segmented label="File units" value={unit} options={UNITS} onChange={setUnit} />
      {parsed.suggestedUnit !== 'mm' && unit === parsed.suggestedUnit && (
        <p className="mt-1.5 text-[12px] text-muted">This model is tiny in its own units, so it was probably made in metres.</p>
      )}

      <h3 className="mb-2 mt-4 text-[13px] font-semibold text-ink">Up axis in the file</h3>
      <Segmented
        label="Up axis"
        value={up}
        options={[
          { value: 'z', label: 'Z up (CAD, slicers)' },
          { value: 'y', label: 'Y up (Blender, games)' },
        ]}
        onChange={setUp}
      />

      <div className="mt-4 rounded-xl border border-line p-4">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Size in MODELLIO</p>
        <p className="mt-1 text-[18px] font-semibold tabular-nums text-ink" data-testid="import-size">
          {mm.map(formatMm).join(' × ')} <span className="text-[13px] font-medium text-muted">mm</span>
        </p>
        {(tooBig || tooSmall) && (
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-amber-700">
            <CircleAlert size={14} />{' '}
            {tooBig ? 'That is larger than 2 m. Check the units.' : 'That is smaller than 0.5 mm. Check the units.'}
          </p>
        )}
        <p className={`mt-2 flex items-start gap-1.5 text-[12px] ${open ? 'text-amber-700' : 'text-emerald-700'}`}>
          {open ? <CircleAlert size={14} className="mt-px shrink-0" /> : <CircleCheck size={14} className="mt-px shrink-0" />}
          {open
            ? `${open} of ${parsed.parts.length} part${parsed.parts.length > 1 ? 's are' : ' is'} not watertight. It will display and export, but can't be used in Combine (Booleans).`
            : 'Watertight: ready for printing and Booleans.'}
        </p>
      </div>

      {parsed.parts.length > 1 && (
        <label className="mt-4 flex items-center gap-2 text-[13px] text-[#344054]">
          <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} className="h-4 w-4 accent-[#2463EB]" />
          Merge all parts into one object (otherwise they are imported as a group)
        </label>
      )}
    </Modal>
  );
}
