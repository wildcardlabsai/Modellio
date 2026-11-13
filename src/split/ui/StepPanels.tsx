import { useMemo, useState } from 'react';
import { ArrowRight, CircleAlert, CircleCheck, Download, Eye, EyeOff, Loader2, TriangleAlert } from 'lucide-react';
import { currentLayout, currentParts, useSplit, type SplitStep } from '../store';
import { NumberField } from '@/components/ui/NumberField';
import { Toggle } from '@/components/ui/Toggle';
import { Segmented } from '@/components/ui/Modal';
import { PLATE_PRESETS } from '../geometry/layout';
import { write3mf } from '@/cad/export/threemf';
import { plateBodies, slug } from '../geometry/export';
import type { SplitPart } from '../geometry/types';
import { formatMm } from './format';

const section = 'border-b border-line p-4';
const heading = 'mb-2 text-[13px] font-semibold text-ink';

export function NextButton({ to, label }: { to: SplitStep; label: string }) {
  const canEnter = useSplit((s) => s.canEnter(to));
  const busy = useSplit((s) => !!s.job);
  return (
    <div className="p-4">
      <button
        type="button"
        disabled={!canEnter || busy}
        onClick={() => useSplit.getState().setStep(to)}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand text-[14px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
        data-testid={`split-next-${to}`}
      >
        {label} <ArrowRight size={16} />
      </button>
    </div>
  );
}

export function partStatus(p: SplitPart): 'ok' | 'warn' | 'error' {
  if (!p.report.watertight) return 'error';
  if (p.report.warnings.length || Math.abs(p.report.volume) < 1) return 'warn';
  return 'ok';
}

function StatusIcon({ status }: { status: 'ok' | 'warn' | 'error' }) {
  if (status === 'ok') return <CircleCheck size={14} className="shrink-0 text-[#067647]" aria-label="ready to print" />;
  if (status === 'warn') return <TriangleAlert size={14} className="shrink-0 text-amber-600" aria-label="check this part" />;
  return <CircleAlert size={14} className="shrink-0 text-red-600" aria-label="not printable as is" />;
}

function JobNotice() {
  const job = useSplit((s) => s.job);
  if (!job) return null;
  return (
    <p className="flex items-center gap-2 px-4 pt-3 text-[12px] text-muted" role="status">
      <Loader2 size={13} className="animate-spin" /> {job.stage}…
    </p>
  );
}

export function PartsList() {
  const split = useSplit((s) => s.split);
  const connected = useSplit((s) => s.connected);
  const step = useSplit((s) => s.step);
  const selected = useSplit((s) => s.selectedPart);
  const hidden = useSplit((s) => s.hiddenParts);
  const parts = step === 'split' ? (split?.parts ?? []) : currentParts({ split, connected });
  const { selectPart, togglePartHidden, showAllParts } = useSplit.getState();
  if (!split) return null;
  return (
    <section className="p-4" aria-labelledby="split-parts-heading">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="split-parts-heading" className="text-[13px] font-semibold text-ink">
          Parts <span className="font-normal text-muted">({parts.length})</span>
        </h2>
        {hidden.length > 0 && (
          <button type="button" onClick={showAllParts} className="text-[12px] font-medium text-brand hover:underline">
            Show all
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-1" data-testid="split-parts">
        {parts.map((p) => {
          const isSel = selected === p.partId;
          const isHidden = hidden.includes(p.partId);
          const size = p.report.bounds.max.map((v, i) => v - p.report.bounds.min[i]);
          return (
            <li
              key={p.partId}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${isSel ? 'border-brand bg-brand-50' : 'border-transparent hover:bg-[#f9fafb]'}`}
              data-testid="split-part"
              data-status={partStatus(p)}
            >
              <button
                type="button"
                onClick={() => selectPart(isSel ? null : p.partId)}
                aria-pressed={isSel}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <span
                  className={`h-5 w-5 shrink-0 rounded-md border border-black/10 ${isHidden ? 'opacity-30' : ''}`}
                  style={{ background: p.colour }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className={`flex items-center gap-1 text-[13px] font-medium ${isHidden ? 'text-muted line-through' : 'text-ink'}`}>
                    <span className="truncate">{p.name}</span>
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {size.map((v) => formatMm(v)).join(' × ')} mm · {(Math.abs(p.report.volume) / 1000).toFixed(2)} cm³
                  </span>
                </span>
                <StatusIcon status={partStatus(p)} />
              </button>
              <button
                type="button"
                onClick={() => togglePartHidden(p.partId)}
                className="rounded-md p-1 text-muted hover:bg-white hover:text-ink"
                aria-label={`${isHidden ? 'Show' : 'Hide'} ${p.name}`}
                aria-pressed={isHidden}
              >
                {isHidden ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SplitPanel() {
  const o = useSplit((s) => s.splitOptions);
  const doc = useSplit((s) => s.doc);
  const set = useSplit((s) => s.setSplitOptions);
  const hasPaint = useMemo(() => !!doc?.objects.some((x) => x.mesh?.paint), [doc]);
  return (
    <>
      <section className={section} aria-labelledby="split-settings-heading">
        <h2 id="split-settings-heading" className={heading}>
          How to split
        </h2>
        <Toggle label="Separate disconnected pieces" checked={o.separateIslands} onChange={(v) => set({ separateIslands: v })} />
        <Toggle label="Keep objects separate" checked={o.keepObjectsSeparate} onChange={(v) => set({ keepObjectsSeparate: v })} />
        {hasPaint && <Toggle label="Split fine paint exactly" checked={o.exactPaint} onChange={(v) => set({ exactPaint: v })} />}
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[13px] text-[#344054]" id="inlay-label">
            Inlay depth for thin colours
          </span>
          <div className="w-24">
            <NumberField
              ariaLabel="Inlay depth (mm)"
              value={o.inlayDepth}
              min={0}
              max={10}
              step={0.2}
              decimals={1}
              suffix="mm"
              onCommit={(v) => set({ inlayDepth: v })}
            />
          </div>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Colour on a flat or thin area gets this depth, with a matching pocket in the part behind it. 0 turns it off.
        </p>
      </section>
      <JobNotice />
      <PartsList />
      <NextButton to="connect" label="Next: connectors" />
    </>
  );
}

export function ConnectPanel() {
  const s = useSplit((x) => x.connectorSettings);
  const split = useSplit((x) => x.split);
  const connected = useSplit((x) => x.connected);
  const set = useSplit((x) => x.setConnectorSettings);
  const parts = split?.parts ?? [];
  const name = (id: string) => parts.find((p) => p.partId === id)?.name ?? id;
  return (
    <>
      <section className={section} aria-labelledby="split-connect-heading">
        <h2 id="split-connect-heading" className={heading}>
          Peg and socket connectors
        </h2>
        <Toggle label="Add connectors" checked={s.enabled} onChange={(v) => set({ enabled: v })} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(
            [
              ['Peg diameter', 'diameter', 1, 12, 0.5],
              ['Peg length', 'length', 1, 20, 0.5],
              ['Clearance', 'clearance', 0, 1, 0.05],
              ['Min. wall', 'minWall', 0.4, 5, 0.2],
            ] as const
          ).map(([label, key, min, max, step]) => (
            <label key={key} className="text-[12px] text-muted">
              {label}
              <NumberField
                ariaLabel={`${label} (mm)`}
                value={s[key]}
                min={min}
                max={max}
                step={step}
                decimals={2}
                suffix="mm"
                disabled={!s.enabled}
                onCommit={(v) => set({ [key]: v })}
              />
            </label>
          ))}
        </div>
        <div className="mt-3">
          <p className="mb-1 text-[12px] text-muted">Per joint</p>
          <Segmented
            label="Connectors per joint"
            value={String(s.perJoint) as 'auto' | '1' | '2'}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: '1', label: 'One' },
              { value: '2', label: 'Two' },
            ]}
            onChange={(v) => set({ perJoint: v === 'auto' ? 'auto' : (Number(v) as 1 | 2) })}
          />
        </div>
      </section>
      <JobNotice />
      <section className={section} aria-labelledby="split-joints-heading">
        <h2 id="split-joints-heading" className={heading}>
          Joints <span className="font-normal text-muted">({split?.joints.length ?? 0})</span>
        </h2>
        {!split?.joints.length ? (
          <p className="text-[12px] text-muted">These parts don't touch along a shared face, so there is nothing to connect.</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="split-joints">
            {split.joints.map((j) => {
              const cons = connected?.connectors.filter((c) => c.jointId === j.jointId) ?? [];
              const skip = connected?.skipped.find((x) => x.jointId === j.jointId);
              return (
                <li key={j.jointId} className="rounded-lg bg-[#f9fafb] px-2.5 py-2 text-[12px]" data-testid="split-joint">
                  <p className="font-medium text-ink">
                    {name(j.partA)} ↔ {name(j.partB)}
                  </p>
                  <p className="text-muted">
                    {j.kind === 'inlay'
                      ? 'Inlay (the plug locates it)'
                      : cons.length
                        ? `${cons.length} × Ø${cons[0].diameter} mm peg, ${cons[0].length} mm long`
                        : skip
                          ? skip.reason
                          : connected
                            ? 'No connector'
                            : 'Waiting…'}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <PartsList />
      <NextButton to="export" label="Next: plates and export" />
    </>
  );
}

function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function ExportPanel() {
  const ps = useSplit((s) => s.plateSettings);
  const split = useSplit((s) => s.split);
  const connected = useSplit((s) => s.connected);
  const doc = useSplit((s) => s.doc);
  const job = useSplit((s) => s.job);
  const set = useSplit((s) => s.setPlateSettings);
  const [plates3mf, setPlates3mf] = useState(true);
  const [partsStl, setPartsStl] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const parts = currentParts({ split, connected });
  const layout = useMemo(() => currentLayout({ split, connected, plateSettings: ps }), [split, connected, ps]);
  const invalid = parts.filter((p) => !p.report.watertight);
  const preset = PLATE_PRESETS.find((p) => p.width === ps.width && p.depth === ps.depth)?.id ?? 'custom';
  const title = (doc?.metadata.Title || doc?.fileName.replace(/\.3mf$/i, '') || 'model').trim();
  const exportAll = async () => {
    setDone(null);
    const r = await useSplit.getState().exportPackage({ plates3mf, partsStl });
    if (!r) return;
    download(r.zip, r.fileName, 'application/zip');
    setDone(`Downloaded ${r.fileName} (${r.files.length} files).`);
  };
  return (
    <>
      <section className={section} aria-labelledby="split-plates-heading">
        <h2 id="split-plates-heading" className={heading}>
          Build plates
        </h2>
        <label className="text-[12px] text-muted" htmlFor="split-plate-preset">
          Printer
        </label>
        <select
          id="split-plate-preset"
          value={preset}
          onChange={(e) => {
            const p = PLATE_PRESETS.find((x) => x.id === e.target.value);
            if (p) set({ width: p.width, depth: p.depth });
          }}
          className="mb-2 mt-1 h-9 w-full rounded-lg border border-line bg-white px-2 text-[13px] text-ink"
        >
          {PLATE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {preset === 'custom' && <option value="custom">Custom</option>}
        </select>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-[12px] text-muted">
            Width
            <NumberField
              ariaLabel="Plate width (mm)"
              value={ps.width}
              min={50}
              max={1000}
              step={1}
              decimals={0}
              suffix="mm"
              onCommit={(v) => set({ width: v })}
            />
          </label>
          <label className="text-[12px] text-muted">
            Depth
            <NumberField
              ariaLabel="Plate depth (mm)"
              value={ps.depth}
              min={50}
              max={1000}
              step={1}
              decimals={0}
              suffix="mm"
              onCommit={(v) => set({ depth: v })}
            />
          </label>
          <label className="text-[12px] text-muted">
            Gap
            <NumberField
              ariaLabel="Gap between parts (mm)"
              value={ps.spacing}
              min={1}
              max={50}
              step={1}
              decimals={0}
              suffix="mm"
              onCommit={(v) => set({ spacing: v })}
            />
          </label>
        </div>
        <Toggle label="One colour per plate" checked={ps.groupByColour} onChange={(v) => set({ groupByColour: v })} />
        <p className="mb-1 mt-2 text-[12px] text-muted">Orientation</p>
        <Segmented
          label="Part orientation"
          value={ps.orientation}
          options={[
            { value: 'flat', label: 'Flat face down' },
            { value: 'assembly', label: 'As assembled' },
          ]}
          onChange={(v) => set({ orientation: v })}
        />
      </section>
      <section className={section} aria-labelledby="split-platelist-heading">
        <h2 id="split-platelist-heading" className={heading}>
          Plates <span className="font-normal text-muted">({layout.plates.length})</span>
        </h2>
        <ul className="flex flex-col gap-1.5" data-testid="split-plates">
          {layout.plates.map((plate) => (
            <li
              key={plate.index}
              className="flex items-center gap-2 rounded-lg bg-[#f9fafb] px-2.5 py-2 text-[12px]"
              data-testid="split-plate"
            >
              <span
                className="h-4 w-4 shrink-0 rounded border border-black/10"
                style={{ background: plate.colour ?? '#e4e8ef' }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">
                  {plate.index + 1}. {plate.name}
                </span>
                <span className="text-muted">
                  {plate.partIds.length} part{plate.partIds.length === 1 ? '' : 's'}
                </span>
              </span>
              <button
                type="button"
                className="rounded-md px-2 py-1 font-medium text-brand hover:bg-brand-50"
                aria-label={`Download plate ${plate.index + 1} (${plate.name}) as 3MF`}
                onClick={() =>
                  download(
                    write3mf(plateBodies(parts, layout, plate.index), `${title} — ${plate.name}`),
                    `${slug(title)}-plate-${plate.index + 1}-${slug(plate.name)}.3mf`,
                    'model/3mf',
                  )
                }
              >
                3MF
              </button>
            </li>
          ))}
        </ul>
        {layout.warnings.map((w) => (
          <p key={w} className="mt-2 flex gap-1.5 text-[12px] text-amber-800">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" /> {w}
          </p>
        ))}
      </section>
      <section className="p-4" aria-labelledby="split-download-heading">
        <h2 id="split-download-heading" className={heading}>
          Download
        </h2>
        <Toggle label="A 3MF file per plate" checked={plates3mf} onChange={setPlates3mf} />
        <Toggle label="An STL file per part" checked={partsStl} onChange={setPartsStl} />
        {invalid.length > 0 && (
          <p className="mt-2 flex gap-1.5 rounded-lg bg-red-50 p-2 text-[12px] text-red-800" role="alert">
            <CircleAlert size={14} className="mt-0.5 shrink-0" /> {invalid.length} part(s) are not closed solids. They are included but may
            fail to slice: {invalid.map((p) => p.name).join(', ')}.
          </p>
        )}
        <button
          type="button"
          onClick={() => void exportAll()}
          disabled={!!job || (!plates3mf && !partsStl) || !parts.length}
          className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand text-[14px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          data-testid="split-download"
        >
          {job?.kind === 'export' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Download all (ZIP)
        </button>
        {done && (
          <p className="mt-2 text-[12px] text-[#067647]" role="status">
            {done}
          </p>
        )}
      </section>
    </>
  );
}
