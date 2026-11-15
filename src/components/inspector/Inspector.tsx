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
  Gem,
  Loader2,
  EyeOff,
  Printer,
} from 'lucide-react';
import { useInspectorTab, type InspectorTab } from './inspectorTab';
import { collectExportBodies } from '@/cad/export/collect';
import type { LeftPanel } from '@/components/layout/LeftRail';
import { useBrepEngine } from '@/cad/brep/client';
import { solidConversion } from '@/cad/brep/convert';
import { featureTitle, useFeatureTool } from '@/components/features/featureTool';
import { useSolidBuilder } from '@/components/features/solidBuilder';
import { computeCombined } from '@/cad/operations/combine';
import { FONTS } from '@/cad/text/fonts';
import { getMeshAsset } from '@/cad/assets';
import { meshMeasures, meshReport } from '@/cad/operations/meshTools';
import { sketchUsers } from '@/cad/sketchRecords';
import { describeOp } from '@/cad/featureTree';
import { useCadReady } from '@/viewport/cadReady';
import type { CombineMode, FontId, SurfaceFinish } from '@/types/document';
import { useEditor } from '@/store/editorStore';
import type { GroupObject, SceneObject, ShapeObject, Vec3 } from '@/types/document';
import { getShapeDefinition, getSolidBuild } from '@/cad/shapeRegistry';
import { proportionalSize } from '@/cad/document';
import { canScaleNonUniform, descendantShapes, groupLocalBounds, isEffectivelyLocked } from '@/cad/hierarchy';
import { NumberField } from '@/components/ui/NumberField';
import { useSketchSession } from '@/components/sketch/sketchSession';
import { IconButton } from '@/components/ui/IconButton';
import { Toggle } from '@/components/ui/Toggle';
import { ObjectTree } from '@/components/hierarchy/ObjectTree';
import { FeatureTree, SketchList } from '@/components/hierarchy/FeatureTree';
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

type BrowserView = 'bodies' | 'sketches' | 'features';
const BROWSER_VIEWS: { id: BrowserView; label: string }[] = [
  { id: 'bodies', label: 'Bodies' },
  { id: 'sketches', label: 'Sketches' },
  { id: 'features', label: 'Features' },
];

/** Right-hand panel: the Design Browser (every body in the design) above the Inspector for the selection. */
export function Inspector({ onOpenPanel }: { onOpenPanel?: (p: LeftPanel) => void }) {
  const selection = useEditor((s) => s.selection);
  const objects = useEditor((s) => s.doc.objects);
  const count = useEditor((s) => Object.keys(s.doc.objects).length);
  const selected = selection.map((id) => objects[id]).filter(Boolean);
  const [treeOpen, setTreeOpen] = useState(true);
  const [view, setView] = useState<BrowserView>('bodies');
  const hasSelection = selected.length > 0;

  return (
    <aside className="flex w-[312px] shrink-0 flex-col border-l border-line bg-panel" aria-label="Inspector" data-tour="inspector">
      <div
        className={`flex min-h-0 flex-col ${hasSelection ? `border-b border-line ${treeOpen ? 'h-[36%] min-h-[150px]' : ''}` : 'flex-1'}`}
        data-testid="design-browser"
      >
        <button
          type="button"
          onClick={() => setTreeOpen((v) => !v)}
          aria-expanded={treeOpen || !hasSelection}
          disabled={!hasSelection}
          className="flex items-center gap-2 px-5 py-3 text-left"
        >
          <Layers size={16} className="text-brand-ink" />
          <span className="flex-1 text-[14px] font-semibold text-ink">Design Browser</span>
          <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-medium text-muted">{count}</span>
          {hasSelection && <ChevronDown size={15} className={`text-muted transition-transform ${treeOpen ? '' : '-rotate-90'}`} />}
        </button>
        {(treeOpen || !hasSelection) && (
          <>
            <div role="radiogroup" aria-label="Browser view" className="mx-4 mb-2 grid grid-cols-3 rounded-lg bg-canvas p-1">
              {BROWSER_VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={view === v.id}
                  onClick={() => setView(v.id)}
                  className={`rounded-md py-1 text-[12px] font-medium ${view === v.id ? 'bg-panel text-brand-ink shadow-sm' : 'text-muted hover:text-ink'}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            {view === 'bodies' ? (
              <>
                {!hasSelection && count > 0 && (
                  <p className="px-5 pb-1 text-[12px] text-muted">
                    Every body in your design. Drag to reorder or move into groups. Double-click to rename.
                  </p>
                )}
                <ObjectTree />
              </>
            ) : view === 'features' ? (
              <FeatureTree />
            ) : (
              <SketchList />
            )}
          </>
        )}
      </div>
      {hasSelection && (
        <div className="flex min-h-0 flex-1 flex-col">
          {selected.length === 1 ? (
            <ObjectInspector key={selected[0].id} object={selected[0]} onOpenPanel={onOpenPanel} />
          ) : (
            <MultiInspector count={selected.length} />
          )}
        </div>
      )}
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
    'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-2 text-[12px] font-medium text-ink-2 hover:border-brand hover:text-brand-ink disabled:opacity-50';
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

function ObjectInspector({ object, onOpenPanel }: { object: SceneObject; onOpenPanel?: (p: LeftPanel) => void }) {
  const s = useEditor.getState();
  const doc = useEditor((st) => st.doc);
  const lockProportions = useEditor((st) => st.lockProportions);
  const units = useEditor((st) => st.units);
  const tab = useInspectorTab((st) => st.tab);
  const setTab = useInspectorTab((st) => st.setTab);
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
            <Combine size={22} className="shrink-0 text-brand-ink" />
          ) : (
            <FolderOpen size={22} className="shrink-0 text-brand-ink" />
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

      <InspectorTabs tab={tab} setTab={setTab} opsCount={object.kind === 'shape' ? (object.feature?.ops.length ?? 0) : 0} />

      <div
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-5"
        role="tabpanel"
        id={`inspector-panel-${tab}`}
        aria-labelledby={`inspector-tab-${tab}`}
        data-testid={`inspector-${tab}`}
      >
        {locked && tab !== 'print' && (
          <div className="mx-5 mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <Lock size={14} />{' '}
            {inheritedLock ? 'Locked by its group. Unlock the group to edit.' : 'This object is locked. Unlock it to edit.'}
          </div>
        )}
        {tab === 'properties' && (
          <>
            {parent && (
              <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg bg-canvas px-3 py-2 text-[12px] text-muted">
                <Info size={14} className="mt-px shrink-0" />
                <span>
                  Inside <strong className="font-semibold text-ink">{parent.name}</strong>. Position and rotation are relative to the group.
                </span>
              </div>
            )}
            {object.kind === 'shape' && <SolidHoleSwitch object={object} locked={locked} />}
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
        )}
        {tab === 'appearance' && <AppearanceTab object={object} color={color} locked={locked} isGroup={isGroup} />}
        {tab === 'features' && (
          <>
            {object.kind === 'group' && <CombineSection group={object} locked={locked} />}
            {object.kind === 'shape' && object.shape === 'text' && <TextSection object={object} locked={locked} />}
            {object.kind === 'shape' && object.shape === 'profile' && <ProfileSection object={object} locked={locked} />}
            {object.kind === 'shape' && <PreciseSolidSection object={object} locked={locked} />}
            {object.kind === 'shape' &&
              object.shape !== 'text' &&
              object.shape !== 'mesh' &&
              object.shape !== 'profile' &&
              object.shape !== 'solid' && <HollowSection object={object} locked={locked} />}
            {object.kind === 'shape' && object.shape === 'mesh' && <MeshSection object={object} locked={locked} />}
            {object.kind === 'group' && !object.combine && (
              <p className="mx-5 mt-4 text-[12px] leading-relaxed text-muted">
                An assembly keeps its parts separate. Choose Union or Intersect to make it one combined body.
              </p>
            )}
          </>
        )}
        {tab === 'print' && <PrintTab object={object} locked={locked} onOpenPanel={onOpenPanel} />}
      </div>
    </div>
  );
}

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'properties', label: 'Properties' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'features', label: 'Features' },
  { id: 'print', label: 'Print' },
];

function InspectorTabs({ tab, setTab, opsCount }: { tab: InspectorTab; setTab: (t: InspectorTab) => void; opsCount: number }) {
  const onKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length].id;
    setTab(t);
    requestAnimationFrame(() => document.getElementById(`inspector-tab-${t}`)?.focus());
  };
  return (
    <div className="px-4 pt-3">
      <div role="tablist" aria-label="Inspector" className="flex rounded-lg bg-canvas p-1" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`inspector-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`inspector-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={`flex flex-auto items-center justify-center gap-1 whitespace-nowrap rounded-md px-1 py-1.5 text-[12px] font-medium transition-colors ${
              tab === t.id ? 'bg-panel text-brand-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            {t.label}
            {t.id === 'features' && opsCount > 0 && (
              <span
                className="rounded-full bg-brand-50 px-1 text-[10px] font-semibold leading-4 text-brand-ink"
                aria-label={`${opsCount} operations`}
              >
                {opsCount}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

const FINISHES: { id: SurfaceFinish; label: string }[] = [
  { id: 'matte', label: 'Matte' },
  { id: 'satin', label: 'Satin' },
  { id: 'gloss', label: 'Gloss' },
];

/** Colour, plus the on-screen finish and transparency. All view-only: geometry and exports are unchanged. */
function AppearanceTab({ object, color, locked, isGroup }: { object: SceneObject; color: string; locked: boolean; isGroup: boolean }) {
  const s = useEditor.getState();
  const doc = useEditor((st) => st.doc);
  const look = object.kind === 'shape' ? object : descendantShapes(doc, [object.id])[0];
  const finish = look?.finish ?? 'satin';
  const opacity = look?.opacity ?? 1;
  const transparency = Math.round((1 - opacity) * 100);
  const [draft, setDraft] = useState(transparency);
  useEffect(() => setDraft(transparency), [transparency]);
  const commit = (pct: number) => {
    if (pct !== transparency) s.setOpacity(object.id, 1 - pct / 100);
  };
  return (
    <>
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
        <label className="mt-3 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-[13px] text-ink-2">
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
      <Section title="Finish">
        <div role="radiogroup" aria-label="Finish" className="grid grid-cols-3 rounded-lg bg-canvas p-1">
          {FINISHES.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={finish === f.id}
              disabled={locked}
              onClick={() => finish !== f.id && s.setFinish(object.id, f.id)}
              className={`rounded-md py-1.5 text-[13px] font-medium ${finish === f.id ? 'bg-panel text-brand-ink shadow-sm' : 'text-ink-2'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Transparency">
        <div className="grid grid-cols-[1fr_96px] items-center gap-3">
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={draft}
            disabled={locked}
            aria-label="Transparency"
            onChange={(e) => setDraft(Number(e.target.value))}
            onPointerUp={() => commit(draft)}
            onKeyUp={() => commit(draft)}
            onBlur={() => commit(draft)}
            className="w-full accent-brand"
          />
          <NumberField
            value={draft}
            min={0}
            max={90}
            step={5}
            decimals={0}
            suffix="%"
            ariaLabel="Transparency (%)"
            disabled={locked}
            onCommit={(v) => {
              setDraft(v);
              commit(v);
            }}
          />
        </div>
      </Section>
      <p className="mx-5 mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
        <Info size={13} className="mt-px shrink-0" />
        Appearance is for viewing only: it isn’t exported or printed. Colour is still included in 3MF and GLB files.
      </p>
    </>
  );
}

/** Print facts for the selection: size, volume, surface area and whether it is a closed solid. */
function PrintTab({ object, locked, onOpenPanel }: { object: SceneObject; locked: boolean; onOpenPanel?: (p: LeftPanel) => void }) {
  const s = useEditor.getState();
  const doc = useEditor((st) => st.doc);
  const version = useCadReady((st) => st.version);
  const u = useUnits();
  const onlyHoles = object.kind === 'shape' ? object.isHole : descendantShapes(doc, [object.id]).every((d) => d.isHole);
  // Rebuild when fonts or the precise-solid engine finish loading (version).
  const info = useMemo(() => {
    const c = collectExportBodies(doc, [object.id]);
    if (!c.bodies.length) return null;
    let volume = 0;
    let area = 0;
    let boundary = 0;
    let nonManifold = 0;
    for (const b of c.bodies) {
      const m = meshMeasures(b.mesh);
      const r = meshReport(b.mesh);
      volume += m.volume;
      area += m.area;
      boundary += r.boundaryEdges;
      nonManifold += r.nonManifoldEdges;
    }
    const exact = object.kind === 'shape' && object.shape === 'solid' ? getSolidBuild(object) : null;
    const size = c.bounds.getSize(new THREE.Vector3()).toArray() as Vec3;
    return { size, volume: exact ? exact.volume : volume, exact: !!exact, area, boundary, nonManifold, bodies: c.bodies.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, object, version]);
  const btn =
    'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-2 text-[12px] font-medium text-ink-2 hover:border-brand hover:text-brand-ink disabled:opacity-50';
  if (onlyHoles) return <p className="mx-5 mt-4 text-[12px] leading-relaxed text-muted">Holes are cutters: nothing prints from them.</p>;
  const closed = info && info.boundary === 0 && info.nonManifold === 0;
  return (
    <>
      <Section title="Print facts">
        {info ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]" data-testid="print-facts">
            <dt className="text-muted">Size (W × D × H)</dt>
            <dd className="text-right font-medium text-ink" data-testid="print-size">
              {info.size.map((v) => u.toDisplay(v).toFixed(u.decimals)).join(' × ')} {u.label}
            </dd>
            <dt className="text-muted">Volume</dt>
            <dd className="text-right font-medium text-ink" data-testid="print-volume">
              {info.exact ? '' : '≈ '}
              {(info.volume / 1000).toFixed(3)} cm³
            </dd>
            <dt className="text-muted">Surface area</dt>
            <dd className="text-right font-medium text-ink" data-testid="print-area">
              ≈ {(info.area / 100).toFixed(2)} cm²
            </dd>
            {info.bodies > 1 && (
              <>
                <dt className="text-muted">Separate bodies</dt>
                <dd className="text-right font-medium text-ink">{info.bodies}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="flex items-center gap-1.5 text-[12px] text-muted">
            <Loader2 size={14} className="animate-spin" /> Building…
          </p>
        )}
        {info && (
          <p
            className={`mt-3 flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-[12px] ${closed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
            data-testid="print-closed"
          >
            {closed ? <CircleCheck size={14} className="mt-px shrink-0" /> : <CircleAlert size={14} className="mt-px shrink-0" />}
            {closed
              ? 'Closed solid: ready to slice.'
              : `${info.boundary.toLocaleString()} open edges, ${info.nonManifold.toLocaleString()} non-manifold. Your slicer may need to repair it.`}
          </p>
        )}
      </Section>
      <Section title="Placement">
        <div className="flex gap-1.5">
          <button type="button" className={btn} disabled={locked} onClick={() => s.setTool('layflat')}>
            <BetweenHorizontalEnd size={14} /> Lay flat
          </button>
          <button type="button" className={btn} disabled={locked} onClick={() => s.dropToWorkplane([object.id])}>
            <ArrowDownToLine size={14} /> Drop down
          </button>
        </div>
      </Section>
      {onOpenPanel && (
        <Section title="Overhangs and thin walls">
          <p className="mb-2 text-[12px] leading-relaxed text-muted">The full check highlights problem areas on the whole design.</p>
          <button
            type="button"
            onClick={() => onOpenPanel('print')}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2 text-[13px] font-semibold text-white hover:bg-brand-600"
            data-testid="open-print-check"
          >
            <Printer size={15} /> Run full print check
          </button>
        </Section>
      )}
    </>
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
        <span className="text-[13px] text-ink-2">Wall thickness</span>
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
            <span className="text-[13px] text-ink-2">{p.label}</span>
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
                active ? 'border-brand bg-brand-50 text-brand-ink' : 'border-line text-ink-2 hover:bg-canvas'
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
        rows={Math.min(5, Math.max(2, draft.split('\n').length))}
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
          className="h-9 rounded-lg border border-line bg-panel px-2 text-[13px] text-ink outline-none focus:border-brand"
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
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[11px] text-muted">
          Letter spacing
          <NumberField
            ariaLabel="Letter spacing (em)"
            value={object.params.letterSpacing ?? 0}
            min={-0.3}
            max={2}
            step={0.02}
            decimals={2}
            suffix="em"
            disabled={locked}
            onCommit={(v) => void s.setText(object.id, { letterSpacing: v })}
          />
        </label>
        <label className="text-[11px] text-muted">
          Line spacing
          <NumberField
            ariaLabel="Line spacing"
            value={object.params.lineHeight ?? 1.25}
            min={0.6}
            max={4}
            step={0.05}
            decimals={2}
            suffix="×"
            disabled={locked}
            onCommit={(v) => void s.setText(object.id, { lineHeight: v })}
          />
        </label>
      </div>
      <div role="radiogroup" aria-label="Text alignment" className="mt-2 grid grid-cols-3 rounded-lg bg-canvas p-1">
        {(['Left', 'Centre', 'Right'] as const).map((label, i) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={Math.round(object.params.align ?? 0) === i}
            disabled={locked}
            onClick={() => void s.setText(object.id, { align: i })}
            className={`rounded-md py-1 text-[12px] font-medium ${Math.round(object.params.align ?? 0) === i ? 'bg-panel text-brand-ink shadow-sm' : 'text-ink-2'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-muted">Enter adds a line. Depth is the Z size. Ctrl/⌘+Enter applies text changes.</p>
    </Section>
  );
}

function MeshSection({ object, locked }: { object: ShapeObject; locked: boolean }) {
  const s = useEditor.getState();
  const asset = object.meshId ? getMeshAsset(object.meshId) : undefined;
  const report = useMemo(() => (asset ? meshReport(asset) : null), [asset]);
  const [detail, setDetail] = useState(0.2);
  const closed = report && report.boundaryEdges === 0 && report.nonManifoldEdges === 0;
  const tool =
    'flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line text-[12px] font-medium text-ink-2 hover:bg-canvas disabled:opacity-50';
  return (
    <Section title="Mesh">
      {report ? (
        <p className={`flex items-start gap-1.5 text-[12px] ${closed ? 'text-emerald-700' : 'text-amber-700'}`} data-testid="mesh-report">
          {closed ? <CircleCheck size={14} className="mt-px shrink-0" /> : <CircleAlert size={14} className="mt-px shrink-0" />}
          {report.triangles.toLocaleString()} triangles ·{' '}
          {closed
            ? 'closed solid'
            : `${report.boundaryEdges.toLocaleString()} open edges, ${report.nonManifoldEdges.toLocaleString()} non-manifold — try Repair`}
        </p>
      ) : (
        <p className="text-[12px] text-muted">Mesh data missing</p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button type="button" className={tool} disabled={locked} onClick={() => s.applyMeshTool(object.id, 'repair', 0.01)}>
          Repair
        </button>
        <button type="button" className={tool} disabled={locked} onClick={() => s.applyMeshTool(object.id, 'smooth', 2)}>
          Smooth
        </button>
        <button type="button" className={tool} disabled={locked} onClick={() => s.applyMeshTool(object.id, 'subdivide', 2)}>
          Subdivide
        </button>
        <button type="button" className={tool} disabled={locked} onClick={() => s.applyMeshTool(object.id, 'simplify', detail)}>
          Simplify
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-muted">
        <span>Simplify: remove detail under</span>
        <div className="w-[104px]">
          <NumberField
            value={detail}
            onCommit={setDetail}
            min={0.01}
            max={10}
            step={0.05}
            decimals={2}
            suffix="mm"
            ariaLabel="Simplify tolerance (mm)"
          />
        </div>
      </div>
      <button
        type="button"
        disabled={locked}
        onClick={() => s.separateSelected()}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-line py-2 text-[13px] font-medium text-ink-2 hover:bg-canvas disabled:opacity-50"
      >
        <Scissors size={15} /> Separate parts
      </button>
    </Section>
  );
}

/** A sketched solid: reopen its sketch, or switch between extrude and revolve. */
function ProfileSection({ object, locked }: { object: ShapeObject; locked: boolean }) {
  const revolve = (object.params.op ?? 0) >= 1;
  const depth = object.params.depth ?? 5;
  const angle = object.params.angle ?? 360;
  const update = (op: { kind: 'extrude' | 'revolve'; depth: number; angle: number }) => {
    if (object.sketch) void useEditor.getState().saveSketch(object.id, object.sketch, op);
  };
  const base = { kind: revolve ? ('revolve' as const) : ('extrude' as const), depth, angle };
  return (
    <Section title="Sketch">
      <div role="radiogroup" aria-label="Sketch operation" className="grid grid-cols-2 rounded-lg bg-canvas p-1">
        {(['extrude', 'revolve'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={base.kind === k}
            disabled={locked}
            onClick={() => base.kind !== k && update({ ...base, kind: k })}
            className={`rounded-md py-1.5 text-[13px] font-medium capitalize ${base.kind === k ? 'bg-panel text-brand-ink shadow-sm' : 'text-ink-2'}`}
          >
            {k}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-[1fr_120px] items-center gap-3">
        <span className="text-[13px] text-ink-2">{revolve ? 'Revolve angle' : 'Extrude depth'}</span>
        {revolve ? (
          <NumberField
            value={angle}
            min={1}
            max={360}
            step={15}
            decimals={0}
            suffix="°"
            ariaLabel="Revolve angle"
            disabled={locked}
            onCommit={(v) => update({ ...base, angle: v })}
          />
        ) : (
          <NumberField
            value={depth}
            min={0.1}
            max={1000}
            step={0.5}
            decimals={2}
            suffix="mm"
            ariaLabel="Extrude depth"
            disabled={locked}
            onCommit={(v) => update({ ...base, depth: v })}
          />
        )}
      </div>
      <button
        type="button"
        disabled={locked}
        onClick={() => useSketchSession.getState().open(object.id)}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-line py-2 text-[13px] font-medium text-ink-2 hover:bg-canvas disabled:opacity-50"
        data-testid="edit-sketch"
      >
        Edit sketch
      </button>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        Changing the sketch or these settings rebuilds the solid at its sketched size.
      </p>
      <SharedSketchNote object={object} locked={locked} />
    </Section>
  );
}

/** Which standalone sketch a sketched body uses, and whether other bodies share it. */
function SharedSketchNote({ object, locked }: { object: ShapeObject; locked: boolean }) {
  const doc = useEditor((st) => st.doc);
  const rec = object.sketchId ? doc.sketches?.[object.sketchId] : undefined;
  if (!rec) return null;
  const others = sketchUsers(doc, rec.id).filter((u) => u.id !== object.id);
  return (
    <div className="mt-2 rounded-lg bg-canvas px-3 py-2 text-[12px] text-ink-2" data-testid="sketch-link">
      Sketch: <strong className="font-semibold text-ink">{rec.name}</strong>
      {others.length > 0 ? (
        <>
          <span className="block text-muted">
            Also builds {others.map((o) => o.name).join(', ')}. Editing it updates {others.length === 1 ? 'both' : 'all of them'}.
          </span>
          <button
            type="button"
            disabled={locked}
            onClick={() => useEditor.getState().unlinkSketch(object.id)}
            className="mt-1.5 rounded-md border border-line px-2 py-1 font-medium text-ink-2 hover:border-brand hover:text-brand-ink disabled:opacity-50"
            data-testid="unlink-sketch"
          >
            Give this body its own copy
          </button>
        </>
      ) : null}
    </div>
  );
}

const BASE_LABEL: Record<string, string> = {
  box: 'Box',
  cylinder: 'Cylinder',
  cone: 'Cone',
  sphere: 'Sphere',
  torus: 'Torus',
  wedge: 'Wedge',
  tube: 'Tube',
};

/**
 * Precise solids: exact OpenCascade geometry. For shapes that can be converted, offers the
 * conversion; for solids, shows what they are built from and anything that could not be applied.
 */
function PreciseSolidSection({ object, locked }: { object: ShapeObject; locked: boolean }) {
  const engine = useBrepEngine((s) => s.status);
  const version = useCadReady((s) => s.version);
  const [busy, setBusy] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const build = useMemo(() => (object.shape === 'solid' ? getSolidBuild(object) : null), [object.feature, object.size, version]);
  if (object.shape !== 'solid') {
    const conv = solidConversion(object);
    if (!conv.ok) return null;
    const convert = async () => {
      setBusy(true);
      try {
        await useEditor.getState().convertToSolid(object.id);
      } finally {
        setBusy(false);
      }
    };
    return (
      <Section title="Precise solid">
        <p className="text-[12px] leading-relaxed text-muted">
          Make this an exact solid so you can round (fillet) or bevel (chamfer) chosen edges. It stays the same size and shape.
        </p>
        <button
          type="button"
          disabled={locked || busy}
          onClick={() => void convert()}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-line py-2 text-[13px] font-medium text-ink-2 hover:bg-canvas disabled:opacity-50"
          data-testid="make-solid"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Gem size={15} />}
          {busy ? (engine === 'loading' ? 'Loading the precise-solid engine…' : 'Building…') : 'Make precise solid'}
        </button>
      </Section>
    );
  }
  const ops = object.feature?.ops ?? [];
  const setOps = (next: typeof ops, label: string) => useEditor.getState().setFeatureOps(object.id, next, label);
  const base = object.feature?.base;
  const what =
    base?.kind === 'primitive'
      ? (BASE_LABEL[base.shape] ?? base.shape)
      : base?.kind === 'sketch'
        ? `Sketch (${base.op})`
        : base?.kind === 'brep'
          ? `Imported solid (${base.source})`
          : base?.kind === 'loft'
            ? `Loft (${base.sections.length} sections)`
            : base?.kind === 'sweep'
              ? 'Sweep'
              : 'Unknown';
  return (
    <Section title="Precise solid">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]" data-testid="solid-info">
        <dt className="text-muted">Made from</dt>
        <dd className="font-medium text-ink">{what}</dd>
        <dt className="text-muted">Volume</dt>
        <dd className="font-medium text-ink" data-testid="solid-volume">
          {build
            ? `${(build.volume / 1000).toFixed(3)} cm³`
            : engine === 'loading'
              ? 'Loading engine…'
              : engine === 'error'
                ? 'Engine failed'
                : 'Building…'}
        </dd>
      </dl>
      {(base?.kind === 'loft' || base?.kind === 'sweep') && (
        <button
          type="button"
          disabled={locked}
          onClick={() => useSolidBuilder.getState().open(base.kind as 'loft' | 'sweep', object.id)}
          className="mt-3 flex w-full items-center justify-center rounded-lg border border-line py-2 text-[13px] font-medium text-ink-2 hover:bg-canvas disabled:opacity-50"
          data-testid="solid-edit-base"
        >
          Edit {base.kind}
        </button>
      )}
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {(['fillet', 'chamfer'] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled={locked}
            onClick={() => void useFeatureTool.getState().start(object.id, k)}
            className="flex h-8 items-center justify-center rounded-lg border border-line text-[12px] font-medium capitalize text-ink-2 hover:bg-canvas disabled:opacity-50"
            data-testid={`solid-${k}`}
          >
            {k} edges
          </button>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {(['shell', 'draft', 'hole'] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled={locked}
            onClick={() => void useFeatureTool.getState().start(object.id, k)}
            className="flex h-8 items-center justify-center rounded-lg border border-line text-[12px] font-medium text-ink-2 hover:bg-canvas disabled:opacity-50"
            data-testid={`solid-${k}`}
          >
            {featureTitle(k)}
          </button>
        ))}
      </div>
      {!!ops.length && (
        <ol className="mt-3 space-y-1" aria-label="Operations" data-testid="solid-ops">
          {ops.map((op) => {
            const problem = build?.problems.find((p) => p.id === op.id);
            const d = describeOp(op);
            return (
              <li
                key={op.id}
                className={`rounded-lg border px-2 py-1.5 text-[12px] ${problem ? 'border-amber-300 bg-amber-50' : 'border-line'}`}
                data-testid="solid-op"
              >
                <div className="flex items-center gap-1.5">
                  <span className={`flex-1 font-medium ${op.suppressed ? 'text-muted line-through' : 'text-ink'}`}>
                    {d.label} {d.detail}
                  </span>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => void useFeatureTool.getState().start(object.id, op.kind, op.id)}
                    className="rounded px-1.5 py-0.5 text-brand-ink hover:bg-brand-50 disabled:opacity-40"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={locked}
                    aria-label={op.suppressed ? 'Turn this operation back on' : 'Turn this operation off (suppress)'}
                    title={op.suppressed ? 'Turn on' : 'Turn off (suppress)'}
                    onClick={() =>
                      setOps(
                        ops.map((o) => (o.id === op.id ? { ...o, suppressed: !o.suppressed } : o)),
                        op.suppressed ? 'Unsuppress' : 'Suppress',
                      )
                    }
                    className="rounded p-1 text-ink-3 hover:bg-canvas disabled:opacity-40"
                  >
                    {op.suppressed ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <button
                    type="button"
                    disabled={locked}
                    aria-label={`Delete this ${op.kind}`}
                    onClick={() =>
                      setOps(
                        ops.filter((o) => o.id !== op.id),
                        `Delete ${op.kind}`,
                      )
                    }
                    className="rounded p-1 text-ink-3 hover:text-red-600 disabled:opacity-40"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                {problem && (
                  <p className="mt-1 flex items-start gap-1 text-amber-800" data-testid="solid-problem">
                    <CircleAlert size={13} className="mt-px shrink-0" />
                    {problem.reason === 'missing-edges' || problem.reason === 'ambiguous-edges'
                      ? `Needs attention: ${problem.message} Edit it to pick the edges again.`
                      : problem.message}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
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
              className={`rounded-md py-1.5 text-[12px] font-medium ${active ? 'bg-panel text-brand-ink shadow-sm' : 'text-muted hover:text-ink'}`}
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
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-line py-2 text-[13px] font-medium text-ink-2 hover:bg-canvas disabled:opacity-50"
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
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-line py-2 text-[13px] font-medium text-ink-2 hover:bg-canvas disabled:opacity-50"
      >
        <Ungroup size={15} /> Ungroup {group.children.length} objects
      </button>
      <p className="mt-2 text-[12px] text-muted">Double-click a part in the viewport to select it inside the group.</p>
      <div className="mt-2">
        <Toggle
          label="Component (reusable part)"
          icon={<Layers size={15} className="text-muted" />}
          checked={!!group.component}
          disabled={locked}
          onChange={(v) => s.setComponent(group.id, v)}
        />
      </div>
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
            className="flex items-center justify-center gap-2 rounded-lg border border-line py-2 text-[13px] font-medium text-ink-2 hover:bg-canvas"
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
                className="flex flex-col items-center gap-1 rounded-lg border border-line py-2 text-[12px] font-medium text-ink-2 hover:border-brand/40 hover:bg-brand-50 hover:text-brand-ink"
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
