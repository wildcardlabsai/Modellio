import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import {
  Copy,
  Trash2,
  Lock,
  Eye,
  ArrowDownToLine,
  Link2,
  Link2Off,
  Layers,
  FolderOpen,
  Ungroup,
  Group,
  ChevronDown,
  Info,
  Combine,
  CircleCheck,
  CircleAlert,
  Layers2,
  Scissors,
  SquaresUnite,
  SquaresSubtract,
  SquaresIntersect,
  BetweenHorizontalEnd,
  FlipVertical2,
} from 'lucide-react';
import { computeCombined } from '@/cad/operations/combine';
import { FONTS } from '@/cad/text/fonts';
import { getMeshAsset } from '@/cad/assets';
import { useCadReady } from '@/viewport/cadReady';
import type { CombineMode, FontId } from '@/types/document';
import { useEditor } from '@/store/editorStore';
import type { GroupObject, SceneObject, ShapeObject, Vec3 } from '@/types/document';
import { getShapeDefinition } from '@/cad/shapeRegistry';
import { proportionalSize } from '@/cad/document';
import { canScaleNonUniform, descendantShapes, groupLocalBounds, isEffectivelyLocked } from '@/cad/hierarchy';
import { NumberField } from '@/components/ui/NumberField';
import { IconButton } from '@/components/ui/IconButton';
import { Toggle } from '@/components/ui/Toggle';
import { ObjectTree } from '@/components/hierarchy/ObjectTree';
import { AlignMenu, MirrorMenu } from '@/components/toolbar/AlignMenu';
import { MOD } from '@/utils/platform';
import { roundTo } from '@/utils/math';
import { useUnits } from '@/utils/units';

const AXES = [
  { label: 'X', cls: 'text-axis-x' },
  { label: 'Y', cls: 'text-axis-y' },
  { label: 'Z', cls: 'text-axis-z' },
] as const;

const PALETTE = [
  '#2463EB',
  '#0EA5E9',
  '#10B981',
  '#84CC16',
  '#F59E0B',
  '#F97316',
  '#EF4444',
  '#EC4899',
  '#8B5CF6',
  '#6366F1',
  '#101828',
  '#98A2B3',
  '#E4E7EC',
  '#FFFFFF',
];

/** Right-hand panel: the inspector for the selection, above the object tree. */
export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const objects = useEditor((s) => s.doc.objects);
  const count = useEditor((s) => Object.keys(s.doc.objects).length);
  const selected = selection.map((id) => objects[id]).filter(Boolean);
  const [treeOpen, setTreeOpen] = useState(true);
  const hasSelection = selected.length > 0;

  return (
    <aside className="flex w-[312px] shrink-0 flex-col border-l border-line bg-white" aria-label="Inspector" data-tour="inspector">
      {hasSelection && (
        <div className="flex min-h-0 flex-1 flex-col">
          {selected.length === 1 ? (
            <ObjectInspector key={selected[0].id} object={selected[0]} />
          ) : (
            <MultiInspector count={selected.length} />
          )}
        </div>
      )}
      <div className={`flex min-h-0 flex-col border-t border-line ${hasSelection ? (treeOpen ? 'h-[34%] min-h-[180px]' : '') : 'flex-1'}`}>
        <button
          type="button"
          onClick={() => setTreeOpen((v) => !v)}
          aria-expanded={treeOpen || !hasSelection}
          disabled={!hasSelection}
          className="flex items-center gap-2 px-5 py-3 text-left"
        >
          <Layers size={16} className="text-brand" />
          <span className="flex-1 text-[14px] font-semibold text-ink">Objects</span>
          <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-medium text-muted">{count}</span>
          {hasSelection && <ChevronDown size={15} className={`text-muted transition-transform ${treeOpen ? '' : '-rotate-90'}`} />}
        </button>
        {(treeOpen || !hasSelection) && (
          <>
            {!hasSelection && count > 0 && (
              <p className="px-5 pb-1 text-[12px] text-muted">Drag to reorder or move into groups. Double-click to rename.</p>
            )}
            <ObjectTree />
          </>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="px-5 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Send the selection face down into the bottom of the part below it (double-sided prints). */
function UndersideSection({ locked }: { locked: boolean }) {
  const [depth, setDepth] = useState(0.6);
  const place = useEditor((st) => st.placeOnUnderside);
  const btn =
    'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-2 text-[12px] font-medium text-[#344054] hover:border-brand hover:text-brand disabled:opacity-50';
  return (
    <Section title="Underside">
      <p className="mb-2 text-[12px] leading-relaxed text-muted">
        Printing both sides? Put this face down into the bottom of the part it sits on, reading the right way when the print is turned over.
      </p>
      <div className="flex gap-1.5">
        <button type="button" className={btn} disabled={locked} onClick={() => place('engrave', depth)}>
          <FlipVertical2 size={14} /> Engrave
        </button>
        <button type="button" className={btn} disabled={locked} onClick={() => place('inlay', depth)}>
          <FlipVertical2 size={14} /> Flush colour
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-muted">
        <span>Depth</span>
        <div className="w-[120px]">
          <NumberField
            value={depth}
            onCommit={setDepth}
            min={0.2}
            max={5}
            step={0.2}
            decimals={1}
            suffix="mm"
            ariaLabel="Underside depth (mm)"
          />
        </div>
      </div>
    </Section>
  );
}

function Vec3Fields({
  value,
  onCommit,
  step,
  decimals = 2,
  min,
  disabled,
  name,
  length,
}: {
  value: Vec3;
  onCommit: (axis: 0 | 1 | 2, v: number) => void;
  step: number;
  decimals?: number;
  min?: number;
  disabled?: boolean;
  name: string;
  /** A length in mm: shown and typed in the current display unit. */
  length?: boolean;
}) {
  const u = useUnits();
  const conv = length ? u : null;
  return (
    <div className="grid grid-cols-3 gap-2">
      {AXES.map((a, i) => (
        <NumberField
          key={a.label}
          label={a.label}
          labelClass={a.cls}
          ariaLabel={`${name} ${a.label}`}
          value={conv ? conv.toDisplay(value[i]) : value[i]}
          step={conv ? conv.step : step}
          min={min !== undefined && conv ? conv.toDisplay(min) : min}
          decimals={conv ? conv.decimals : decimals}
          disabled={disabled}
          onCommit={(v) => onCommit(i as 0 | 1 | 2, conv ? conv.fromDisplay(v) : v)}
        />
      ))}
    </div>
  );
}

function ObjectInspector({ object }: { object: SceneObject }) {
  const s = useEditor.getState();
  const doc = useEditor((st) => st.doc);
  const lockProportions = useEditor((st) => st.lockProportions);
  const units = useEditor((st) => st.units);
  const [tab, setTab] = useState<'properties' | 'appearance'>('properties');
  const locked = isEffectivelyLocked(doc, object.id);
  const inheritedLock = locked && !object.locked;
  const parent = object.parentId ? doc.objects[object.parentId] : null;
  const isGroup = object.kind === 'group';

  // Displayed size: a shape's own size, or a group's bounds in its own frame.
  const size: Vec3 = useMemo(
    () => (object.kind === 'shape' ? object.size : (groupLocalBounds(doc, object.id).getSize(new THREE.Vector3()).toArray() as Vec3)),
    [doc, object],
  );
  const groupUniformOnly = isGroup && !canScaleNonUniform(doc, object.id);
  const proportional = lockProportions || groupUniformOnly;

  const setSizeAxis = (axis: 0 | 1 | 2, v: number) => {
    const next: Vec3 = proportional ? proportionalSize(size, axis, v) : (size.map((c, i) => (i === axis ? v : c)) as Vec3);
    if (isGroup) s.setGroupSize(object.id, next);
    else s.setSize(object.id, next);
  };

  const color = object.kind === 'shape' ? object.color : (descendantShapes(doc, [object.id])[0]?.color ?? '#98A2B3');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        {isGroup ? (
          object.combine ? (
            <Combine size={22} className="shrink-0 text-brand" />
          ) : (
            <FolderOpen size={22} className="shrink-0 text-brand" />
          )
        ) : (
          <span
            className="h-6 w-6 shrink-0 rounded-md shadow-inner"
            style={
              object.kind === 'shape' && object.isHole
                ? { background: 'repeating-linear-gradient(45deg,#c3cad6 0 3px,#eef1f5 3px 6px)' }
                : { background: color }
            }
          />
        )}
        <NameField id={object.id} name={object.name} />
        <IconButton label="Duplicate" shortcut={`${MOD}+D`} onClick={() => s.duplicateSelected()}>
          <Copy size={17} />
        </IconButton>
        <IconButton label="Delete" shortcut="Del" disabled={locked} onClick={() => s.deleteSelected()}>
          <Trash2 size={17} />
        </IconButton>
      </header>

      <div className="px-5 pt-3">
        <div role="tablist" className="grid grid-cols-2 rounded-lg bg-canvas p-1">
          {(['properties', 'appearance'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-md py-1.5 text-[13px] font-medium capitalize transition-colors ${
                tab === t ? 'bg-white text-brand shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-5">
        {tab === 'properties' ? (
          <>
            {locked && (
              <div className="mx-5 mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                <Lock size={14} />{' '}
                {inheritedLock ? 'Locked by its group. Unlock the group to edit.' : 'This object is locked. Unlock it to edit.'}
              </div>
            )}
            {parent && (
              <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg bg-canvas px-3 py-2 text-[12px] text-muted">
                <Info size={14} className="mt-px shrink-0" />
                <span>
                  Inside <strong className="font-semibold text-ink">{parent.name}</strong>. Position and rotation are relative to the group.
                </span>
              </div>
            )}
            {object.kind === 'shape' && <SolidHoleSwitch object={object} locked={locked} />}
            {object.kind === 'group' && <CombineSection group={object} locked={locked} />}
            {object.kind === 'shape' && object.shape === 'text' && <TextSection object={object} locked={locked} />}
            <Section
              title={isGroup ? `Group size (${units})` : `Size (${units})`}
              action={
                <IconButton
                  label={
                    groupUniformOnly
                      ? 'Scales uniformly (contains angled parts)'
                      : lockProportions
                        ? 'Proportions locked'
                        : 'Lock proportions'
                  }
                  active={proportional}
                  disabled={groupUniformOnly}
                  tooltipSide="left"
                  className="h-7 min-w-7"
                  onClick={() => s.setLockProportions(!lockProportions)}
                >
                  {proportional ? <Link2 size={15} /> : <Link2Off size={15} />}
                </IconButton>
              }
            >
              <Vec3Fields name="Size" length value={size} step={1} min={0.01} disabled={locked} onCommit={setSizeAxis} />
            </Section>
            <Section
              title={`Position (${units})`}
              action={
                <span className="flex gap-0.5">
                  <IconButton
                    label="Lay flat on a face"
                    shortcut="L"
                    tooltipSide="left"
                    className="h-7 min-w-7"
                    disabled={locked}
                    onClick={() => s.setTool('layflat')}
                  >
                    <BetweenHorizontalEnd size={15} />
                  </IconButton>
                  <IconButton
                    label="Drop to workplane"
                    shortcut="D"
                    tooltipSide="left"
                    className="h-7 min-w-7"
                    disabled={locked}
                    onClick={() => s.dropToWorkplane([object.id])}
                  >
                    <ArrowDownToLine size={15} />
                  </IconButton>
                </span>
              }
            >
              <Vec3Fields
                name="Position"
                length
                value={object.transform.position}
                step={1}
                disabled={locked}
                onCommit={(axis, v) => s.setPosition(object.id, object.transform.position.map((c, i) => (i === axis ? v : c)) as Vec3)}
              />
            </Section>
            {!object.parentId && <UndersideSection locked={locked} />}
            <Section title="Rotation (°)">
              <Vec3Fields
                name="Rotation"
                value={object.transform.rotation}
                step={15}
                decimals={1}
                disabled={locked}
                onCommit={(axis, v) => s.setRotation(object.id, object.transform.rotation.map((c, i) => (i === axis ? v : c)) as Vec3)}
              />
            </Section>
            {object.kind === 'shape' && <ShapeParams object={object} locked={locked} />}
            {object.kind === 'shape' && object.shape !== 'text' && object.shape !== 'mesh' && (
              <HollowSection object={object} locked={locked} />
            )}
            {object.kind === 'shape' && object.shape === 'mesh' && <MeshSection object={object} locked={locked} />}
            {object.kind === 'group' && <GroupActions group={object} locked={locked} />}
            <Section title="Options">
              <Toggle
                label="Lock proportions"
                icon={<Link2 size={15} className="text-muted" />}
                checked={lockProportions}
                onChange={s.setLockProportions}
              />
              <Toggle
                label="Visible"
                icon={<Eye size={15} className="text-muted" />}
                checked={object.visible}
                onChange={(v) => s.setVisible(object.id, v)}
              />
              <Toggle
                label="Locked"
                icon={<Lock size={15} className="text-muted" />}
                checked={object.locked}
                onChange={(v) => s.setLocked(object.id, v)}
              />
            </Section>
          </>
        ) : (
          <Section title={isGroup ? 'Colour (all shapes in group)' : 'Colour'}>
            <div className="grid grid-cols-7 gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  disabled={locked}
                  onClick={() => s.setColor(object.id, c)}
                  className={`aspect-square rounded-lg border transition-transform hover:scale-110 ${
                    color.toLowerCase() === c.toLowerCase() ? 'border-brand ring-2 ring-brand/30' : 'border-black/10'
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
            <label className="mt-3 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-[13px] text-[#344054]">
              Custom colour
              <span className="flex items-center gap-2 font-mono text-[12px] uppercase text-muted">
                {color}
                <input
                  type="color"
                  aria-label="Custom colour"
                  disabled={locked}
                  value={color}
                  onChange={(e) => s.setColor(object.id, e.target.value.toUpperCase())}
                  className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </span>
            </label>
          </Section>
        )}
      </div>
    </div>
  );
}

/** Hollow (shell): a wall thickness turns the solid into a container; optionally open at the top. */
function HollowSection({ object, locked }: { object: ShapeObject; locked: boolean }) {
  const s = useEditor.getState();
  const wall = object.params.shell ?? 0;
  const u = useUnits();
  return (
    <Section title="Hollow">
      <div className="grid grid-cols-[1fr_120px] items-center gap-3">
        <span className="text-[13px] text-[#344054]">Wall thickness</span>
        <NumberField
          ariaLabel="Wall thickness"
          value={u.toDisplay(wall)}
          min={0}
          max={u.toDisplay(500)}
          step={u.unit === 'in' ? 0.01 : 0.4}
          decimals={u.decimals}
          suffix={u.label}
          disabled={locked}
          onCommit={(v) => s.setParam(object.id, 'shell', roundTo(u.fromDisplay(v), 3))}
        />
      </div>
      <Toggle
        label="Open top"
        checked={(object.params.openTop ?? 0) > 0}
        disabled={locked || wall <= 0}
        onChange={(v) => s.setParam(object.id, 'openTop', v ? 1 : 0)}
      />
      <p className="text-[11px] text-muted">
        {wall > 0 ? 'Exact on flat sides; approximate on curved or sloped shapes.' : '0 = solid. Try 1.2–2 mm for printable containers.'}
      </p>
    </Section>
  );
}

function ShapeParams({ object, locked }: { object: ShapeObject; locked: boolean }) {
  const def = getShapeDefinition(object.shape);
  const s = useEditor.getState();
  const u = useUnits();
  if (!def.params.length) return null;
  return (
    <Section title={`${def.label} settings`}>
      <div className="space-y-2">
        {def.params.map((p) => (
          <div key={p.key} className="grid grid-cols-[1fr_120px] items-center gap-3">
            <span className="text-[13px] text-[#344054]">{p.label}</span>
            {p.unit === 'mm' ? (
              <NumberField
                ariaLabel={p.label}
                value={u.toDisplay(object.params[p.key] ?? def.defaultParams[p.key] ?? p.min)}
                min={u.toDisplay(p.min)}
                max={u.toDisplay(p.max)}
                step={u.unit === 'in' ? 0.01 : p.step}
                decimals={u.decimals}
                suffix={u.label}
                disabled={locked}
                onCommit={(v) => s.setParam(object.id, p.key, roundTo(u.fromDisplay(v), 4))}
              />
            ) : (
              <NumberField
                ariaLabel={p.label}
                value={object.params[p.key] ?? def.defaultParams[p.key] ?? p.min}
                min={p.min}
                max={p.max}
                step={p.step}
                integer={p.integer}
                decimals={p.step < 0.1 ? 2 : 1}
                suffix={p.unit}
                disabled={locked}
                onCommit={(v) => s.setParam(object.id, p.key, roundTo(v, 4))}
              />
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function SolidHoleSwitch({ object, locked }: { object: ShapeObject; locked: boolean }) {
  const s = useEditor.getState();
  return (
    <section className="px-5 pt-4">
      <div role="radiogroup" aria-label="Solid or hole" className="grid grid-cols-2 gap-2">
        {[
          { hole: false, label: 'Solid', swatch: { background: object.color } },
          { hole: true, label: 'Hole', swatch: { background: 'repeating-linear-gradient(45deg,#c3cad6 0 3px,#eef1f5 3px 6px)' } },
        ].map((o) => {
          const active = object.isHole === o.hole;
          return (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={locked}
              onClick={() => !active && s.setHole([object.id], o.hole)}
              className={`flex items-center justify-center gap-2 rounded-lg border py-2 text-[13px] font-semibold ${
                active ? 'border-brand bg-brand-50 text-brand' : 'border-line text-[#344054] hover:bg-canvas'
              } disabled:opacity-50`}
            >
              <span className="h-4 w-4 rounded" style={o.swatch} />
              {o.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function TextSection({ object, locked }: { object: ShapeObject; locked: boolean }) {
  const s = useEditor.getState();
  const [draft, setDraft] = useState(object.text?.content ?? '');
  useEffect(() => setDraft(object.text?.content ?? ''), [object.text?.content]);
  const commit = () => {
    if (draft !== object.text?.content) void s.setText(object.id, { content: draft });
  };
  return (
    <Section title="Text">
      <textarea
        aria-label="Text content"
        value={draft}
        disabled={locked}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
          if (e.key === 'Escape') setDraft(object.text?.content ?? '');
        }}
        className="w-full resize-none rounded-lg border border-line px-3 py-2 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
      />
      <div className="mt-2 grid grid-cols-[1fr_110px] items-center gap-2">
        <select
          aria-label="Font"
          value={object.text?.font}
          disabled={locked}
          onChange={(e) => void s.setText(object.id, { font: e.target.value as FontId })}
          className="h-9 rounded-lg border border-line bg-white px-2 text-[13px] text-ink outline-none focus:border-brand"
        >
          {FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <NumberField
          ariaLabel="Font size"
          value={object.params.fontSize ?? 14}
          min={1}
          max={500}
          step={1}
          decimals={1}
          suffix="pt"
          disabled={locked}
          onCommit={(v) => void s.setText(object.id, { fontSize: v })}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-muted">Depth is the Z size. Ctrl/⌘+Enter applies text changes.</p>
    </Section>
  );
}

function MeshSection({ object, locked }: { object: ShapeObject; locked: boolean }) {
  const s = useEditor.getState();
  const asset = object.meshId ? getMeshAsset(object.meshId) : undefined;
  return (
    <Section title="Mesh">
      <p className="text-[12px] text-muted">
        {asset ? `${(asset.indices.length / 3).toLocaleString()} triangles · watertight` : 'Mesh data missing'}
      </p>
      <button
        type="button"
        disabled={locked}
        onClick={() => s.separateSelected()}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-line py-2 text-[13px] font-medium text-[#344054] hover:bg-canvas disabled:opacity-50"
      >
        <Scissors size={15} /> Separate parts
      </button>
    </Section>
  );
}

const COMBINE_MODES: { mode: CombineMode | null; label: string }[] = [
  { mode: null, label: 'Assembly' },
  { mode: 'union', label: 'Union' },
  { mode: 'intersect', label: 'Intersect' },
];

function CombineSection({ group, locked }: { group: GroupObject; locked: boolean }) {
  const s = useEditor.getState();
  const doc = useEditor((st) => st.doc);
  const version = useCadReady((st) => st.version);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => (group.combine ? computeCombined(doc, group.id) : null), [doc, group, version]);
  return (
    <Section title="Combine">
      <div role="radiogroup" aria-label="Combine mode" className="grid grid-cols-3 rounded-lg bg-canvas p-1">
        {COMBINE_MODES.map(({ mode, label }) => {
          const active = (group.combine ?? null) === mode;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={locked}
              onClick={() => !active && s.setCombineMode(group.id, mode)}
              className={`rounded-md py-1.5 text-[12px] font-medium ${active ? 'bg-white text-brand shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {group.combine ? (
        result && !result.stale ? (
          result.error ? (
            <p role="alert" className="mt-2 flex items-start gap-1.5 text-[12px] text-red-700">
              <CircleAlert size={14} className="mt-px shrink-0" /> {result.error}
            </p>
          ) : (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-emerald-700">
              <CircleCheck size={14} /> Watertight solid · {result.triangles.toLocaleString()} triangles
            </p>
          )
        ) : (
          <p className="mt-2 text-[12px] text-muted">Computing…</p>
        )
      ) : (
        <p className="mt-2 text-[12px] text-muted">Parts are kept separate. Choose Union to merge them and cut holes.</p>
      )}
      {group.combine && (
        <button
          type="button"
          disabled={locked || !result?.mesh}
          onClick={() => {
            s.select([group.id]);
            s.bakeSelected();
          }}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-line py-2 text-[13px] font-medium text-[#344054] hover:bg-canvas disabled:opacity-50"
        >
          <Layers2 size={15} /> Flatten to mesh
        </button>
      )}
    </Section>
  );
}

function GroupActions({ group, locked }: { group: GroupObject; locked: boolean }) {
  const s = useEditor.getState();
  return (
    <Section title="Group">
      <button
        type="button"
        disabled={locked}
        onClick={() => {
          s.select([group.id]);
          s.ungroupSelected();
        }}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-line py-2 text-[13px] font-medium text-[#344054] hover:bg-canvas disabled:opacity-50"
      >
        <Ungroup size={15} /> Ungroup {group.children.length} objects
      </button>
      <p className="mt-2 text-[12px] text-muted">Double-click a part in the viewport to select it inside the group.</p>
    </Section>
  );
}

function NameField({ id, name }: { id: string; name: string }) {
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  return (
    <input
      aria-label="Object name"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => (text.trim() ? useEditor.getState().rename(id, text) : setText(name))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(name);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="min-w-0 flex-1 rounded-md border border-transparent px-1.5 py-1 text-[16px] font-semibold text-ink outline-none hover:border-line focus:border-brand"
    />
  );
}

function MultiInspector({ count }: { count: number }) {
  const s = useEditor.getState();
  const selection = useEditor((st) => st.selection);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <h2 className="flex-1 text-[16px] font-semibold text-ink">{count} objects</h2>
        <IconButton label="Duplicate" shortcut={`${MOD}+D`} onClick={() => s.duplicateSelected()}>
          <Copy size={17} />
        </IconButton>
        <IconButton label="Delete" shortcut="Del" onClick={() => s.deleteSelected()}>
          <Trash2 size={17} />
        </IconButton>
      </header>
      <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => s.groupSelected()}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand py-2 text-[13px] font-medium text-white hover:bg-brand-600"
          >
            <Group size={15} /> Group
          </button>
          <button
            type="button"
            onClick={() => s.dropToWorkplane(selection)}
            className="flex items-center justify-center gap-2 rounded-lg border border-line py-2 text-[13px] font-medium text-[#344054] hover:bg-canvas"
          >
            <ArrowDownToLine size={15} /> Drop all
          </button>
        </div>
        <div>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Combine</p>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ['union', 'Union', SquaresUnite],
                ['subtract', 'Subtract', SquaresSubtract],
                ['intersect', 'Intersect', SquaresIntersect],
              ] as const
            ).map(([op, label, Icon]) => (
              <button
                key={op}
                type="button"
                onClick={() => s.combineSelected(op)}
                className="flex flex-col items-center gap-1 rounded-lg border border-line py-2 text-[12px] font-medium text-[#344054] hover:border-brand/40 hover:bg-brand-50 hover:text-brand"
              >
                <Icon size={17} />
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted">Subtract keeps the first object you selected.</p>
        </div>
        <AlignMenu onDone={() => {}} />
        <div className="border-t border-line pt-3">
          <MirrorMenu onDone={() => {}} />
        </div>
      </div>
    </div>
  );
}
