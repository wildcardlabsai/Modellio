import { useMemo } from 'react';
import * as THREE from 'three';
import { CircleAlert, Info, TriangleAlert, Focus, CircleCheck as CheckCircle } from 'lucide-react';
import { currentParts, useSplit } from '../store';
import type { ImportIssue } from '../model/types';
import { placedBounds } from './previewGeometry';
import { formatArea, formatCount, formatMm, KIND_LABEL } from './format';

export function RightPanel() {
  const doc = useSplit((s) => s.doc);
  const step = useSplit((s) => s.step);
  const split = useSplit((s) => s.split);
  const connected = useSplit((s) => s.connected);
  if (!doc) return null;
  const partsMode = step !== 'import' && !!split;
  const issues = !partsMode ? doc.issues : step === 'split' ? split!.issues : [...split!.issues, ...(connected?.issues ?? [])];
  return (
    <aside
      className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-l border-line bg-white xl:w-[300px]"
      aria-label="Details"
      data-testid="split-right"
    >
      {partsMode ? <PartInspector /> : <Selection />}
      <Report issues={issues} title={partsMode ? (step === 'split' ? 'Split report' : 'Report') : 'Import report'} />
    </aside>
  );
}

function Dimensions({ box }: { box: THREE.Box3 }) {
  const size = box.getSize(new THREE.Vector3());
  return (
    <div className="grid grid-cols-3 gap-1.5" data-testid="split-dimensions">
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <div key={axis} className="rounded-lg bg-[#f5f7fb] px-2 py-1.5 text-center">
          <div className={`text-[11px] font-semibold ${['text-axis-x', 'text-axis-y', 'text-axis-z'][i]}`}>{axis}</div>
          <div className="text-[13px] font-medium tabular-nums text-ink">{formatMm(size.getComponent(i))}</div>
        </div>
      ))}
    </div>
  );
}

function Selection() {
  const doc = useSplit((s) => s.doc)!;
  const components = useSplit((s) => s.components);
  const selected = useSplit((s) => s.selectedMaterial);
  const component = components.find((c) => c.materialId === selected) ?? null;
  const box = useMemo(() => placedBounds(doc, component?.materialId), [doc, component]);
  if (!component) {
    return (
      <section className="border-b border-line p-4" aria-labelledby="split-sel-heading">
        <h2 id="split-sel-heading" className="mb-2 text-[13px] font-semibold text-ink">
          Whole model
        </h2>
        <p className="mb-1.5 text-[12px] text-muted">Overall size (mm)</p>
        <Dimensions box={box} />
        <p className="mt-3 text-[12px] leading-relaxed text-muted">Select a colour in the list or click the model to inspect it.</p>
      </section>
    );
  }
  const material = doc.materials[component.materialId];
  const names = component.instanceIds.map((id) => doc.instances.find((i) => i.instanceId === id)?.name ?? id);
  return (
    <section className="border-b border-line p-4" aria-labelledby="split-sel-heading" data-testid="split-selection">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="h-8 w-8 shrink-0 rounded-lg border border-black/10" style={{ background: component.colour }} aria-hidden />
        <div className="min-w-0">
          <h2 id="split-sel-heading" className="truncate text-[14px] font-semibold text-ink">
            {component.name}
          </h2>
          <p className="text-[12px] text-muted">
            {KIND_LABEL[component.materialType]} · {component.colour}
            {material.alpha < 1 ? ` · ${Math.round(material.alpha * 100)}% opaque` : ''}
          </p>
        </div>
      </div>
      <p className="mb-1.5 text-[12px] text-muted">Size of this colour region (mm)</p>
      <Dimensions box={box} />
      <dl className="mt-3 grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 text-[12px]">
        <dt className="text-muted">Triangles</dt>
        <dd className="font-medium text-[#344054]">{formatCount(component.triangleCount)}</dd>
        <dt className="text-muted">Surface</dt>
        <dd className="font-medium text-[#344054]">{formatArea(component.area)}</dd>
        <dt className="text-muted">Defined by</dt>
        <dd className="break-words font-medium text-[#344054]">{material.sourceDefinition}</dd>
        <dt className="text-muted">Found in</dt>
        <dd className="font-medium text-[#344054]">
          <ul>
            {names.slice(0, 6).map((n, i) => (
              <li key={i} className="truncate" title={n}>
                {n}
              </li>
            ))}
            {names.length > 6 && <li className="text-muted">and {names.length - 6} more</li>}
          </ul>
        </dd>
      </dl>
      {component.approximate && (
        <p className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-2 text-[12px] leading-relaxed text-amber-900">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          This colour is approximated from richer data (see the import report).
        </p>
      )}
      <button
        type="button"
        onClick={() => useSplit.getState().isolate(component.materialId)}
        className="mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-line text-[13px] font-medium text-[#344054] hover:bg-[#f9fafb]"
      >
        <Focus size={15} /> Show only this colour
      </button>
    </section>
  );
}

const ICON = { error: CircleAlert, warning: TriangleAlert, info: Info };
const TONE = { error: 'text-red-600', warning: 'text-amber-600', info: 'text-brand' };

function Report({ issues, title }: { issues: ImportIssue[]; title: string }) {
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...issues].sort((a, b) => order[a.level] - order[b.level]);
  const problems = issues.filter((i) => i.level !== 'info').length;
  return (
    <section className="p-4" aria-labelledby="split-report-heading" data-testid="split-report">
      <h2 id="split-report-heading" className="mb-2 text-[13px] font-semibold text-ink">
        {title} <span className="font-normal text-muted">{problems ? `(${problems} to review)` : '(no problems)'}</span>
      </h2>
      {sorted.length === 0 ? (
        <p className="text-[12px] text-muted">Everything in the file was read.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((issue, i) => {
            const Icon = ICON[issue.level];
            return (
              <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-[#344054]" data-level={issue.level} data-code={issue.code}>
                <Icon size={14} className={`mt-0.5 shrink-0 ${TONE[issue.level]}`} aria-label={issue.level} />
                <span>{issue.message}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PartInspector() {
  const split = useSplit((s) => s.split)!;
  const connected = useSplit((s) => s.connected);
  const step = useSplit((s) => s.step);
  const selected = useSplit((s) => s.selectedPart);
  const parts = step === 'split' ? split.parts : currentParts({ split, connected });
  const part = parts.find((p) => p.partId === selected) ?? null;
  const colours = new Set(parts.map((p) => p.materialId)).size;
  if (!part) {
    const all = new THREE.Box3();
    for (const p of parts) all.union(new THREE.Box3(new THREE.Vector3(...p.report.bounds.min), new THREE.Vector3(...p.report.bounds.max)));
    const bad = parts.filter((p) => !p.report.watertight).length;
    return (
      <section className="border-b border-line p-4" aria-labelledby="split-sel-heading" data-testid="split-summary">
        <h2 id="split-sel-heading" className="mb-2 text-[13px] font-semibold text-ink">
          {parts.length} part{parts.length === 1 ? '' : 's'} in {colours} colour{colours === 1 ? '' : 's'}
        </h2>
        <p className="mb-1.5 text-[12px] text-muted">Assembled size (mm)</p>
        <Dimensions box={all} />
        <p className={`mt-3 flex items-center gap-1.5 text-[12px] ${bad ? 'text-red-700' : 'text-[#067647]'}`}>
          {bad ? <CircleAlert size={14} /> : <CheckCircle size={14} />}
          {bad ? `${bad} part(s) are not closed solids` : 'Every part is a closed solid'}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">Select a part in the list or click it to inspect it.</p>
      </section>
    );
  }
  const box = new THREE.Box3(new THREE.Vector3(...part.report.bounds.min), new THREE.Vector3(...part.report.bounds.max));
  const joints = split.joints.filter((j) => j.partA === part.partId || j.partB === part.partId);
  const name = (id: string) => parts.find((p) => p.partId === id)?.name ?? id;
  const cons = connected?.connectors ?? [];
  const pegs = cons.filter((c) => c.pegPartId === part.partId).length;
  const sockets = cons.filter((c) => c.socketPartId === part.partId).length;
  return (
    <section className="border-b border-line p-4" aria-labelledby="split-sel-heading" data-testid="split-part-details">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="h-8 w-8 shrink-0 rounded-lg border border-black/10" style={{ background: part.colour }} aria-hidden />
        <div className="min-w-0">
          <h2 id="split-sel-heading" className="truncate text-[14px] font-semibold text-ink" title={part.name}>
            {part.name}
          </h2>
          <p className="text-[12px] text-muted">
            {part.materialName} · {part.colour}
          </p>
        </div>
      </div>
      <p className="mb-1.5 text-[12px] text-muted">Size (mm)</p>
      <Dimensions box={box} />
      <dl className="mt-3 grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 text-[12px]">
        <dt className="text-muted">Volume</dt>
        <dd className="font-medium text-[#344054]">{(Math.abs(part.report.volume) / 1000).toFixed(2)} cm³</dd>
        <dt className="text-muted">Triangles</dt>
        <dd className="font-medium text-[#344054]">{formatCount(part.mesh.indices.length / 3)}</dd>
        <dt className="text-muted">Solid</dt>
        <dd className={`font-medium ${part.report.watertight ? 'text-[#067647]' : 'text-red-700'}`}>
          {part.report.watertight
            ? 'Closed and manifold'
            : `${part.report.boundaryEdges} open, ${part.report.nonManifoldEdges} non-manifold edges`}
        </dd>
        <dt className="text-muted">Pieces</dt>
        <dd className="font-medium text-[#344054]">{part.report.shells}</dd>
        {(pegs > 0 || sockets > 0) && (
          <>
            <dt className="text-muted">Connectors</dt>
            <dd className="font-medium text-[#344054]">
              {[pegs ? `${pegs} peg${pegs > 1 ? 's' : ''}` : '', sockets ? `${sockets} socket${sockets > 1 ? 's' : ''}` : '']
                .filter(Boolean)
                .join(', ')}
            </dd>
          </>
        )}
        {joints.length > 0 && (
          <>
            <dt className="text-muted">Touches</dt>
            <dd className="font-medium text-[#344054]">
              <ul>
                {joints.map((j) => (
                  <li key={j.jointId} className="truncate">
                    {name(j.partA === part.partId ? j.partB : j.partA)}
                    {j.kind === 'inlay' ? ' (inlay)' : ''}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
      {part.report.warnings.map((w) => (
        <p key={w} className="mt-2 flex gap-2 rounded-lg bg-amber-50 p-2 text-[12px] leading-relaxed text-amber-900">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" /> {w}
        </p>
      ))}
    </section>
  );
}
