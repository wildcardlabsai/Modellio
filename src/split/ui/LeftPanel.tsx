import { Eye, EyeOff, FileBox, FolderOpen, X, Focus, TriangleAlert } from 'lucide-react';
import { useSplit } from '../store';
import { formatBytes, formatCount, KIND_LABEL, UNIT_LABEL } from './format';
import { openSplitPicker } from './intake';
import { ConnectPanel, ExportPanel, NextButton, SplitPanel } from './StepPanels';

export function LeftPanel() {
  const doc = useSplit((s) => s.doc);
  const step = useSplit((s) => s.step);
  return (
    <aside
      className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-r border-line bg-white xl:w-[300px]"
      aria-label={step === 'import' ? 'Model and colours' : 'Step settings'}
      data-testid="split-left"
    >
      {!doc ? (
        <div className="p-4 text-[13px] leading-relaxed text-muted">
          <h2 className="mb-1 text-[14px] font-semibold text-ink">Start with a 3MF file</h2>
          Import a multi-colour 3MF from Bambu Studio, OrcaSlicer, PrusaSlicer or any CAD tool. Split Studio reads its objects and colours
          so you can print each colour as a separate part.
        </div>
      ) : step === 'split' ? (
        <SplitPanel />
      ) : step === 'connect' ? (
        <ConnectPanel />
      ) : step === 'export' ? (
        <ExportPanel />
      ) : (
        <>
          <FileInfo />
          <ColourList />
          <NextButton to="split" label="Next: split by colour" />
        </>
      )}
    </aside>
  );
}

function FileInfo() {
  const doc = useSplit((s) => s.doc)!;
  const close = useSplit((s) => s.closeDocument);
  const rows: [string, string][] = [
    ['Size', formatBytes(doc.fileSize)],
    ['Units', `${UNIT_LABEL[doc.units] ?? doc.units}${doc.units !== 'millimeter' ? ' → converted to mm' : ''}`],
    ['Created with', doc.application ?? 'Unknown'],
    [
      'Objects',
      `${formatCount(doc.stats.meshObjects)} mesh${doc.stats.meshObjects === 1 ? '' : 'es'}, ${formatCount(doc.stats.instances)} placed`,
    ],
    ['Triangles', formatCount(doc.stats.placedTriangles)],
  ];
  if (doc.extensions.length) rows.push(['Extensions', doc.extensions.join(', ')]);
  return (
    <section className="border-b border-line p-4" aria-labelledby="split-file-heading" data-testid="split-file-info">
      <div className="mb-3 flex items-start gap-2">
        <FileBox size={18} className="mt-0.5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <h2 id="split-file-heading" className="truncate text-[14px] font-semibold text-ink" title={doc.fileName}>
            {doc.metadata.Title || doc.fileName}
          </h2>
          {doc.metadata.Title && <p className="truncate text-[12px] text-muted">{doc.fileName}</p>}
        </div>
        <button
          type="button"
          onClick={close}
          className="rounded-md p-1 text-muted hover:bg-[#f2f4f7] hover:text-ink"
          aria-label="Close file"
          title="Close file"
        >
          <X size={16} />
        </button>
      </div>
      <dl className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-1 text-[12px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 break-words font-medium text-[#344054]">{v}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={openSplitPicker}
        className="mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-line text-[13px] font-medium text-[#344054] hover:bg-[#f9fafb]"
      >
        <FolderOpen size={15} /> Open another 3MF
      </button>
    </section>
  );
}

function ColourList() {
  const components = useSplit((s) => s.components);
  const hidden = useSplit((s) => s.hidden);
  const selected = useSplit((s) => s.selectedMaterial);
  const { select, toggleHidden, showAll, isolate } = useSplit.getState();
  const total = components.filter((c) => c.materialType !== 'nonprinting').reduce((s, c) => s + c.area, 0) || 1;
  return (
    <section className="p-4" aria-labelledby="split-colours-heading">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="split-colours-heading" className="text-[13px] font-semibold text-ink">
          Colours <span className="font-normal text-muted">({components.length})</span>
        </h2>
        {hidden.length > 0 && (
          <button type="button" onClick={showAll} className="text-[12px] font-medium text-brand hover:underline">
            Show all
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-1" data-testid="split-colour-list">
        {components.map((c) => {
          const isHidden = hidden.includes(c.materialId);
          const isSelected = selected === c.materialId;
          const share = c.materialType === 'nonprinting' ? null : (c.area / total) * 100;
          return (
            <li
              key={c.materialId}
              className={`group flex items-center gap-2 rounded-lg border px-2 py-1.5 ${isSelected ? 'border-brand bg-brand-50' : 'border-transparent hover:bg-[#f9fafb]'}`}
              data-testid="split-colour"
              data-material-id={c.materialId}
            >
              <button
                type="button"
                onClick={() => select(isSelected ? null : c.materialId)}
                aria-pressed={isSelected}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <span
                  className={`h-5 w-5 shrink-0 rounded-md border border-black/10 ${isHidden ? 'opacity-30' : ''}`}
                  style={{ background: c.colour }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`flex items-center gap-1 truncate text-[13px] font-medium ${isHidden ? 'text-muted line-through' : 'text-ink'}`}
                  >
                    <span className="truncate">{c.name}</span>
                    {c.approximate && <TriangleAlert size={12} className="shrink-0 text-amber-600" aria-label="approximate colour" />}
                  </span>
                  <span
                    className="block truncate text-[11px] text-muted"
                    title={`${KIND_LABEL[c.materialType]}${share !== null ? ' · share of the printed surface area' : ''}`}
                  >
                    {share !== null ? `${share < 0.1 ? '<0.1' : share.toFixed(1)}% · ` : 'Not printed · '}
                    {formatCount(c.triangleCount)} triangles
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => isolate(c.materialId)}
                className="rounded-md p-1 text-muted opacity-0 hover:bg-white hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={`Show only ${c.name}`}
                title="Show only this colour"
              >
                <Focus size={15} />
              </button>
              <button
                type="button"
                onClick={() => toggleHidden(c.materialId)}
                className="rounded-md p-1 text-muted hover:bg-white hover:text-ink"
                aria-label={`${isHidden ? 'Show' : 'Hide'} ${c.name}`}
                aria-pressed={isHidden}
                title={isHidden ? 'Show' : 'Hide'}
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
