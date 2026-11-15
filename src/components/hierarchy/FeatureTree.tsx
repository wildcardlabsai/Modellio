import { Fragment, useMemo, useState } from 'react';
import {
  Box,
  ChevronRight,
  Combine,
  Eye,
  EyeOff,
  FolderOpen,
  Gem,
  Layers3,
  PencilLine,
  PencilRuler,
  RotateCw,
  Route,
  Scissors,
  Settings2,
  Spline,
  Trash2,
  Undo2,
  Redo2,
  CircleAlert,
  Link2Off,
  Crosshair,
} from 'lucide-react';
import { PlaneList } from './PlaneList';
import { placementLabel } from '@/cad/sketchPlacement';
import { useFacePick } from '@/components/sketch/facePick';
import { useEditor } from '@/store/editorStore';
import { isEffectivelyLocked } from '@/cad/hierarchy';
import {
  changedObjectIds,
  deriveFeatureTree,
  deriveSketches,
  type FeatureEdit,
  type FeatureNode,
  type SketchNode,
} from '@/cad/featureTree';
import { useSketchSession } from '@/components/sketch/sketchSession';
import { useSolidBuilder } from '@/components/features/solidBuilder';
import { useFeatureTool } from '@/components/features/featureTool';
import { SketchThumb } from '@/components/features/SketchThumb';
import { useInspectorTab } from '@/components/inspector/inspectorTab';
import { useHover } from '@/viewport/hover';
import { useCadReady } from '@/viewport/cadReady';
import { getSolidBuild } from '@/cad/shapeRegistry';
import type { ObjectId } from '@/types/document';

/** Open the real editor for a feature. */
export function runEdit(edit: FeatureEdit) {
  const editor = useEditor.getState();
  editor.select([edit.objectId]);
  if (edit.kind === 'sketch') useSketchSession.getState().open(edit.objectId);
  else if (edit.kind === 'loft' || edit.kind === 'sweep') useSolidBuilder.getState().open(edit.kind, edit.objectId);
  else if (edit.kind === 'op') void useFeatureTool.getState().start(edit.objectId, edit.op, edit.opId);
  else useInspectorTab.getState().setTab('properties');
}

/** Open a sketch in the sketch editor, wherever it lives. */
export function openSketch(n: SketchNode) {
  const editor = useEditor.getState();
  if (n.objectId) editor.select([n.objectId]);
  const s = n.source;
  // A standalone sketch building exactly one body opens with that body's extrude / revolve settings.
  if (s.kind === 'record') {
    if (n.users.length === 1) useSketchSession.getState().open(n.users[0]);
    else useSketchSession.getState().openRecord(s.sketchId);
  } else if (s.kind === 'profile') useSketchSession.getState().open(s.objectId);
  else if (s.kind === 'section') {
    useSolidBuilder.getState().open('loft', s.objectId);
    useSolidBuilder.getState().startSketch({ kind: 'section', index: s.index });
  } else if (s.kind === 'sweep-profile' || s.kind === 'sweep-path') {
    useSolidBuilder.getState().open('sweep', s.objectId);
    useSolidBuilder.getState().startSketch({ kind: s.kind === 'sweep-profile' ? 'profile' : 'path' });
  }
}

const ICON = {
  component: FolderOpen,
  boolean: Combine,
  body: Box,
  cutter: Scissors,
  op: Spline,
  rollback: Undo2,
} as const;

function baseIcon(n: FeatureNode) {
  if (n.edit?.kind === 'sketch') return PencilRuler;
  if (n.edit?.kind === 'loft') return Layers3;
  if (n.edit?.kind === 'sweep') return Route;
  if (n.label === 'Imported solid' || n.label.startsWith('Imported')) return Gem;
  return Settings2;
}

/** The objects changed by the most recent step, for the "last change" marker. */
function useLastChanged(): Set<ObjectId> {
  const doc = useEditor((s) => s.doc);
  const last = useEditor((s) => s.history.past[s.history.past.length - 1]);
  return useMemo(() => new Set(last ? changedObjectIds(last.state, doc) : []), [last, doc]);
}

/**
 * The Design Browser's Features view: each body with what it is built from (base feature, then
 * fillets and chamfers in order), Booleans with their bodies and cutters, and assemblies.
 */
export function FeatureTree() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const tree = useMemo(() => deriveFeatureTree(doc), [doc]);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const lastChanged = useLastChanged();
  // Re-render when a build finishes, so problems on operations show up.
  useCadReady((st) => st.version);
  const setHover = useHover((s) => s.set);

  if (!tree.length) return <p className="px-5 py-3 text-[12px] text-muted">Nothing here yet. Add a shape or make a sketch.</p>;

  const rows: { node: FeatureNode; depth: number }[] = [];
  const walk = (n: FeatureNode, depth: number) => {
    rows.push({ node: n, depth });
    if (!closed.has(n.key)) n.children.forEach((c) => walk(c, depth + 1));
  };
  tree.forEach((n) => walk(n, 1));

  const toggle = (key: string) =>
    setClosed((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <ul role="tree" aria-label="Features" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-testid="feature-tree">
      {rows.map(({ node: n, depth }) => {
        const locked = isEffectivelyLocked(doc, n.objectId);
        const isSelected = selection.includes(n.objectId) && n.kind !== 'op' && n.kind !== 'base';
        const Icon = n.kind === 'base' ? baseIcon(n) : ICON[n.kind];
        const object = doc.objects[n.objectId];
        const ops = object?.kind === 'shape' ? (object.feature?.ops ?? []) : [];
        const setOps = (next: typeof ops, label: string) => useEditor.getState().setFeatureOps(n.objectId, next, label);
        // Why the latest build skipped this operation (an earlier change broke it), if it did.
        const problem =
          n.kind === 'op' && object?.kind === 'shape' && object.shape === 'solid'
            ? getSolidBuild(object)?.problems.find((p) => p.id === n.opId)
            : undefined;
        return (
          <li
            key={n.key}
            role="treeitem"
            aria-level={depth}
            aria-selected={isSelected}
            aria-expanded={n.children.length ? !closed.has(n.key) : undefined}
            data-testid="feature-node"
            data-kind={n.kind}
            onMouseEnter={() => setHover([n.objectId])}
            onMouseLeave={() => setHover([])}
          >
            <div
              className={`group flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-lg pr-1 text-[13px] ${
                isSelected ? 'bg-brand-50 text-brand-ink' : 'text-ink-2 hover:bg-canvas'
              }`}
              style={{ paddingLeft: 4 + (depth - 1) * 16 }}
              onClick={() => useEditor.getState().select([n.objectId])}
              onDoubleClick={() => n.edit && !locked && runEdit(n.edit)}
            >
              {n.children.length ? (
                <button
                  type="button"
                  aria-label={closed.has(n.key) ? `Expand ${n.label}` : `Collapse ${n.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(n.key);
                  }}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:text-ink"
                >
                  <ChevronRight size={14} className={`transition-transform ${closed.has(n.key) ? '' : 'rotate-90'}`} />
                </button>
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <Icon size={14} className={`shrink-0 ${n.kind === 'cutter' ? 'text-muted' : 'text-brand-ink'}`} aria-hidden />
              <span className="min-w-0 flex-1 leading-tight">
                <span
                  className={`block truncate font-medium ${n.suppressed ? 'text-muted line-through' : n.rolledBack ? 'text-muted' : n.kind === 'rollback' ? 'text-brand-ink' : ''}`}
                >
                  {n.label}
                </span>
                {n.detail && <span className="block truncate text-[11px] text-muted">{n.detail}</span>}
                {problem && (
                  <span className="mt-0.5 flex items-start gap-1 text-[11px] leading-snug text-amber-800" data-testid="op-problem">
                    <CircleAlert size={12} className="mt-px shrink-0" />
                    {problem.message}
                    {problem.reason !== 'failed' ? ' Edit it to pick again.' : ''}
                  </span>
                )}
              </span>
              {lastChanged.has(n.objectId) && n.kind !== 'op' && n.kind !== 'base' && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                  title="Changed by the last step"
                  data-testid="last-changed"
                />
              )}
              <span className="flex shrink-0 items-center opacity-70 group-hover:opacity-100">
                {n.edit && (
                  <RowButton label={`Edit ${n.label.toLowerCase()}`} disabled={locked} onClick={() => runEdit(n.edit!)}>
                    <PencilLine size={13} />
                  </RowButton>
                )}
                {n.kind === 'base' && ops.length > 0 && object?.kind === 'shape' && object.feature?.rollback !== 0 && (
                  <RowButton
                    label="Roll back to the start"
                    disabled={locked}
                    onClick={() => useEditor.getState().setRollback(n.objectId, 0)}
                  >
                    <Undo2 size={13} />
                  </RowButton>
                )}
                {n.kind === 'rollback' && (
                  <RowButton
                    label="Roll forward to the end"
                    disabled={locked}
                    onClick={() => useEditor.getState().setRollback(n.objectId, null)}
                  >
                    <Redo2 size={13} />
                  </RowButton>
                )}
                {n.kind === 'op' && !n.rolledBack && (
                  <RowButton
                    label={`Roll back to after this ${n.label.toLowerCase()}`}
                    disabled={locked}
                    onClick={() => useEditor.getState().setRollback(n.objectId, n.index! + 1)}
                  >
                    <Undo2 size={13} />
                  </RowButton>
                )}
                {n.kind === 'op' && (
                  <>
                    <RowButton
                      label={n.suppressed ? `Turn ${n.label.toLowerCase()} back on` : `Turn ${n.label.toLowerCase()} off (suppress)`}
                      disabled={locked}
                      onClick={() =>
                        setOps(
                          ops.map((o) => (o.id === n.opId ? { ...o, suppressed: !o.suppressed } : o)),
                          n.suppressed ? 'Unsuppress' : 'Suppress',
                        )
                      }
                    >
                      {n.suppressed ? <EyeOff size={13} /> : <Eye size={13} />}
                    </RowButton>
                    <RowButton
                      label={`Delete ${n.label.toLowerCase()}`}
                      disabled={locked}
                      onClick={() =>
                        setOps(
                          ops.filter((o) => o.id !== n.opId),
                          `Delete ${n.label.toLowerCase()}`,
                        )
                      }
                    >
                      <Trash2 size={13} />
                    </RowButton>
                  </>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-panel hover:text-brand-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** The Design Browser's Sketches view: every sketch in the design, opened in the real sketch editor. */
export function SketchList() {
  const doc = useEditor((s) => s.doc);
  const sketches = useMemo(() => deriveSketches(doc), [doc]);
  const setHover = useHover((s) => s.set);
  const [renaming, setRenaming] = useState<string | null>(null);
  const newSketch = (
    <button
      type="button"
      onClick={() => useSketchSession.getState().open(null)}
      className="mt-2 rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 hover:border-brand hover:text-brand-ink"
    >
      New sketch
    </button>
  );
  if (!sketches.length)
    return (
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 py-3 text-[12px] leading-relaxed text-muted">
          <p>No sketches yet. Sketches drive extrudes, revolves, lofts and sweeps, and can be kept on their own.</p>
          {newSketch}
        </div>
        <PlaneList />
      </div>
    );
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <ul className="space-y-1 px-2 pb-3" aria-label="Sketches" data-testid="sketch-list">
        {sketches.map((n) => {
          const locked = n.users.some((id) => isEffectivelyLocked(doc, id)) || (!!n.objectId && isEffectivelyLocked(doc, n.objectId));
          const record = n.source.kind === 'record' ? n.source.sketchId : null;
          const rec = record ? doc.sketches?.[record] : undefined;
          const drives = n.owners.length
            ? `Drives ${n.owners.slice(0, 2).join(', ')}${n.owners.length > 2 ? ` +${n.owners.length - 2}` : ''}`
            : 'On its own';
          return (
            <Fragment key={n.key}>
              <li
                className="group flex items-center gap-1 rounded-lg hover:bg-canvas"
                onMouseEnter={() => setHover(n.users.length ? n.users : n.objectId ? [n.objectId] : [])}
                onMouseLeave={() => setHover([])}
                data-testid="sketch-row"
              >
                {renaming === record && record ? (
                  <input
                    autoFocus
                    aria-label="Rename sketch"
                    defaultValue={n.label}
                    onBlur={(e) => {
                      useEditor.getState().renameSketchRecord(record, e.target.value);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    className="m-1.5 h-8 flex-1 rounded-md border border-brand bg-panel px-2 text-[13px] text-ink outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    disabled={!n.editable || locked}
                    onClick={() => openSketch(n)}
                    onDoubleClick={() => record && setRenaming(record)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left disabled:cursor-default"
                    data-testid="sketch-item"
                    title={
                      n.editable
                        ? `Edit ${n.label}${record ? ' (double-click to rename)' : ''}`
                        : 'Made precise: this sketch is kept but no longer editable'
                    }
                  >
                    <SketchThumb sketch={n.sketch} size={40} label={`${n.label} preview`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{n.label}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {drives} · {n.entities} {n.entities === 1 ? 'curve' : 'curves'}
                        {n.editable ? '' : ' · fixed'}
                      </span>
                      {rec && placementLabel(doc, rec) && (
                        <span
                          className={`block truncate text-[11px] ${rec.broken ? 'text-amber-700' : 'text-brand-ink'}`}
                          data-testid="sketch-placement"
                        >
                          {placementLabel(doc, rec)}
                          {rec.broken ? ' · attachment broken' : ''}
                        </span>
                      )}
                    </span>
                  </button>
                )}
                {record && (
                  <span className="flex shrink-0 items-center pr-1 opacity-70 group-hover:opacity-100">
                    <RowButton
                      label={`Extrude ${n.label}`}
                      onClick={() => void useEditor.getState().bodyFromSketch(record, { kind: 'extrude', depth: 5, angle: 360 })}
                    >
                      <Box size={13} />
                    </RowButton>
                    <RowButton
                      label={`Revolve ${n.label}`}
                      onClick={() => void useEditor.getState().bodyFromSketch(record, { kind: 'revolve', depth: 5, angle: 360 })}
                    >
                      <RotateCw size={13} />
                    </RowButton>
                    {rec?.placement && (
                      <RowButton label={`Detach ${n.label}`} onClick={() => useEditor.getState().detachSketch(record)}>
                        <Link2Off size={13} />
                      </RowButton>
                    )}
                    {n.users.length === 0 && (
                      <RowButton label={`Delete ${n.label}`} onClick={() => useEditor.getState().deleteSketchRecord(record)}>
                        <Trash2 size={13} />
                      </RowButton>
                    )}
                  </span>
                )}
              </li>
              {rec?.broken && record && (
                <li
                  className="mx-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[12px] leading-snug text-amber-900"
                  data-testid="sketch-broken"
                >
                  <p className="flex gap-1.5">
                    <CircleAlert size={14} className="mt-px shrink-0" />
                    <span>{rec.broken} Its bodies stay where they were until you re-attach or detach it.</span>
                  </p>
                  <span className="mt-1.5 flex gap-1.5">
                    {rec.placement?.kind === 'face' && (
                      <button
                        type="button"
                        onClick={() => reattach(record)}
                        className="flex items-center gap-1 rounded-md border border-amber-300 px-2 py-0.5 font-medium hover:bg-amber-100"
                      >
                        <Crosshair size={12} /> Re-attach
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => useEditor.getState().detachSketch(record)}
                      className="flex items-center gap-1 rounded-md border border-amber-300 px-2 py-0.5 font-medium hover:bg-amber-100"
                    >
                      <Link2Off size={12} /> Detach
                    </button>
                  </span>
                </li>
              )}
            </Fragment>
          );
        })}
        <li className="px-1.5">{newSketch}</li>
      </ul>
      <PlaneList />
    </div>
  );
}

/** Re-attach a sketch: pick a face on the body it was on (or the selected body when that one is gone). */
function reattach(sketchId: string) {
  const { doc, selection, notify } = useEditor.getState();
  const p = doc.sketches?.[sketchId]?.placement;
  const target = p?.kind === 'face' && doc.objects[p.objectId] ? p.objectId : selection[0];
  if (!target) {
    notify('Select the body to attach the sketch to, then choose Re-attach.');
    return;
  }
  void useFacePick.getState().start(target, { kind: 'reattach', sketchId });
}
