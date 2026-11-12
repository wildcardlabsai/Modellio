import { useEffect, useState } from 'react';
import { Copy, Trash2, Lock, Eye, ArrowDownToLine, Link2, Link2Off, Layers } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import type { ShapeObject, Vec3 } from '@/types/document';
import { getShapeDefinition } from '@/cad/shapeRegistry';
import { proportionalSize } from '@/cad/document';
import { NumberField } from '@/components/ui/NumberField';
import { IconButton } from '@/components/ui/IconButton';
import { Toggle } from '@/components/ui/Toggle';
import { SceneList } from '@/components/hierarchy/SceneList';
import { MOD } from '@/utils/platform';
import { roundTo } from '@/utils/math';

const AXES = [
  { label: 'X', cls: 'text-axis-x' },
  { label: 'Y', cls: 'text-axis-y' },
  { label: 'Z', cls: 'text-axis-z' },
] as const;

const PALETTE = ['#2463EB', '#0EA5E9', '#10B981', '#84CC16', '#F59E0B', '#F97316', '#EF4444', '#EC4899', '#8B5CF6', '#6366F1', '#101828', '#98A2B3', '#E4E7EC', '#FFFFFF'];

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const objects = useEditor((s) => s.doc.objects);
  const selected = selection.map((id) => objects[id]).filter(Boolean);

  return (
    <aside className="flex w-[312px] shrink-0 flex-col border-l border-line bg-white" aria-label="Inspector">
      {selected.length === 1 && selected[0].kind === 'shape' ? (
        <ShapeInspector key={selected[0].id} object={selected[0]} />
      ) : selected.length > 1 ? (
        <MultiInspector count={selected.length} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-line px-5 py-4">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <Layers size={17} className="text-brand" /> Scene
            </h2>
            <p className="mt-1 text-[12px] text-muted">Select an object to edit its exact size, position and rotation.</p>
          </div>
          <SceneList />
        </div>
      )}
    </aside>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
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

function Vec3Fields({
  value,
  onCommit,
  step,
  decimals = 2,
  min,
  disabled,
  name,
}: {
  value: Vec3;
  onCommit: (axis: 0 | 1 | 2, v: number) => void;
  step: number;
  decimals?: number;
  min?: number;
  disabled?: boolean;
  name: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {AXES.map((a, i) => (
        <NumberField
          key={a.label}
          label={a.label}
          labelClass={a.cls}
          ariaLabel={`${name} ${a.label}`}
          value={value[i]}
          step={step}
          min={min}
          decimals={decimals}
          disabled={disabled}
          onCommit={(v) => onCommit(i as 0 | 1 | 2, v)}
        />
      ))}
    </div>
  );
}

function ShapeInspector({ object }: { object: ShapeObject }) {
  const s = useEditor.getState();
  const lockProportions = useEditor((st) => st.lockProportions);
  const [tab, setTab] = useState<'properties' | 'appearance'>('properties');
  const def = getShapeDefinition(object.shape);
  const locked = object.locked;

  const setSizeAxis = (axis: 0 | 1 | 2, v: number) => {
    const size: Vec3 = lockProportions ? proportionalSize(object.size, axis, v) : (object.size.map((c, i) => (i === axis ? v : c)) as Vec3);
    s.setSize(object.id, size);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <span className="h-6 w-6 shrink-0 rounded-md shadow-inner" style={{ background: object.color }} />
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
                <Lock size={14} /> This object is locked. Unlock it to edit.
              </div>
            )}
            <Section
              title="Size (mm)"
              action={
                <IconButton
                  label={lockProportions ? 'Proportions locked' : 'Lock proportions'}
                  active={lockProportions}
                  tooltipSide="left"
                  className="h-7 min-w-7"
                  onClick={() => s.setLockProportions(!lockProportions)}
                >
                  {lockProportions ? <Link2 size={15} /> : <Link2Off size={15} />}
                </IconButton>
              }
            >
              <Vec3Fields name="Size" value={object.size} step={1} min={0.01} disabled={locked} onCommit={setSizeAxis} />
            </Section>
            <Section
              title="Position (mm)"
              action={
                <IconButton label="Drop to workplane" tooltipSide="left" className="h-7 min-w-7" disabled={locked} onClick={() => s.dropToWorkplane([object.id])}>
                  <ArrowDownToLine size={15} />
                </IconButton>
              }
            >
              <Vec3Fields
                name="Position"
                value={object.transform.position}
                step={1}
                disabled={locked}
                onCommit={(axis, v) => s.setPosition(object.id, object.transform.position.map((c, i) => (i === axis ? v : c)) as Vec3)}
              />
            </Section>
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
            {def.params.length > 0 && (
              <Section title={`${def.label} settings`}>
                <div className="space-y-2">
                  {def.params.map((p) => (
                    <div key={p.key} className="grid grid-cols-[1fr_120px] items-center gap-3">
                      <span className="text-[13px] text-[#344054]">{p.label}</span>
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
                    </div>
                  ))}
                </div>
              </Section>
            )}
            <Section title="Options">
              <Toggle label="Lock proportions" icon={<Link2 size={15} className="text-muted" />} checked={lockProportions} onChange={s.setLockProportions} />
              <Toggle
                label="Visible"
                icon={<Eye size={15} className="text-muted" />}
                checked={object.visible}
                onChange={(v) => s.setVisible(object.id, v)}
              />
              <Toggle label="Locked" icon={<Lock size={15} className="text-muted" />} checked={object.locked} onChange={(v) => s.setLocked(object.id, v)} />
            </Section>
          </>
        ) : (
          <Section title="Colour">
            <div className="grid grid-cols-7 gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  disabled={locked}
                  onClick={() => s.setColor(object.id, c)}
                  className={`aspect-square rounded-lg border transition-transform hover:scale-110 ${
                    object.color.toLowerCase() === c.toLowerCase() ? 'border-brand ring-2 ring-brand/30' : 'border-black/10'
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
            <label className="mt-3 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-[13px] text-[#344054]">
              Custom colour
              <span className="flex items-center gap-2 font-mono text-[12px] uppercase text-muted">
                {object.color}
                <input
                  type="color"
                  aria-label="Custom colour"
                  disabled={locked}
                  value={object.color}
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
      <div className="space-y-2 px-5 pt-4">
        <button
          type="button"
          onClick={() => s.dropToWorkplane(selection)}
          className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-[#344054] hover:bg-canvas"
        >
          <ArrowDownToLine size={15} /> Drop all to workplane
        </button>
        <p className="text-[12px] text-muted">Move and rotate them together with the gizmo. Grouping and alignment arrive in Phase 2.</p>
      </div>
      <div className="mt-3 min-h-0 flex-1 border-t border-line">
        <SceneList />
      </div>
    </div>
  );
}

