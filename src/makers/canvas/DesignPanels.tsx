import { useEffect, useMemo, useState } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FlipHorizontal2,
  Package,
  Repeat2,
  Pencil,
  Shapes,
  Trash2,
  Type,
  Upload,
  MousePointer2,
} from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { NumberField } from '@/components/ui/NumberField';
import { FONTS, loadFont, DEFAULT_FONT } from '@/cad/text/fonts';
import type { FontId } from '@/types/document';
import { CANVAS_SHAPES } from './shapes';
import { naturalAspect, normalise, type DesignElement } from './model';
import type { MakerState } from './store';
import { outlineFromFile } from '@/assets/outlines';
import { assetFile, isOutlineAsset, useAssets, type AssetRecord } from '@/assets/library';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMakerStore = UseBoundStore<StoreApi<MakerState<any, any>>>;

export interface RoleOption {
  value: string;
  label: string;
  colour: string;
}

export interface PanelConfig {
  roles: RoleOption[];
  /** Role given to new items of each kind. */
  defaults: { shape: string; text: string; upload: string; draw: string };
  /** Optional: choose a new item's role from what is already in the design. */
  pickRole?: (kind: 'shape' | 'text' | 'upload', elements: DesignElement[]) => string;
  /** Size of a new shape (longest side, mm) and new text (height, mm). */
  newShapeSize: number;
  newTextHeight: number;
  defaultText: string;
  /** Double-sided makers: the roles allowed for items on the back. */
  backRoles?: string[];
}

const btn = 'flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] font-medium text-[#344054] hover:bg-[#f9fafb]';

function ShapeThumb({ id }: { id: string }) {
  const d = useMemo(() => {
    const { polys } = normalise(CANVAS_SHAPES.find((s) => s.id === id)!.polygons());
    return polys.map((p) => 'M' + p.map(([x, y]) => `${(16 + x * 26).toFixed(1)} ${(16 - y * 26).toFixed(1)}`).join('L') + 'Z').join('');
  }, [id]);
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
      <path d={d} fill="currentColor" />
    </svg>
  );
}

/** Trace an SVG or a picture into an outline element (centred, longest side `size` mm). */
export async function fileToElement(file: File, size: number, role: string): Promise<DesignElement> {
  const { polys, fillRule, name } = await outlineFromFile(file);
  const { aspect } = normalise(polys);
  const [w, h] = aspect >= 1 ? [size, size / aspect] : [size * aspect, size];
  return { id: '', kind: 'outline', polygons: polys, fillRule, role, x: 0, y: 0, w, h, rotation: 0, name } as DesignElement;
}

/** Add shapes, text, uploaded artwork, or draw freehand. */
export function AddBar({
  useStore,
  config,
  onError,
}: {
  useStore: AnyMakerStore;
  config: PanelConfig;
  onError: (m: string | null) => void;
}) {
  const tool = useStore((s) => s.tool);
  const { add, setTool } = useStore.getState();
  const roleFor = (kind: 'shape' | 'text' | 'upload') =>
    config.pickRole ? config.pickRole(kind, useStore.getState().elements as DesignElement[]) : config.defaults[kind];
  const addShape = (shape: string) => {
    const probe = { kind: 'shape', shape, id: 'probe', x: 0, y: 0, w: 1, h: 1, rotation: 0, role: roleFor('shape') } as DesignElement;
    const a = naturalAspect(probe) ?? 1;
    const s = config.newShapeSize;
    const [w, h] = a >= 1 ? [s, s / a] : [s * a, s];
    add({
      kind: 'shape',
      shape,
      role: roleFor('shape'),
      x: 0,
      y: 0,
      w,
      h,
      rotation: 0,
      name: CANVAS_SHAPES.find((x) => x.id === shape)?.label,
    } as DesignElement);
  };
  const addText = async () => {
    await loadFont(DEFAULT_FONT);
    const probe = {
      kind: 'text',
      text: config.defaultText,
      font: DEFAULT_FONT,
      id: 'p',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      rotation: 0,
      role: 'x',
    } as DesignElement;
    const a = naturalAspect(probe) ?? 3;
    const h = config.newTextHeight;
    add({
      kind: 'text',
      text: config.defaultText,
      font: DEFAULT_FONT,
      role: roleFor('text'),
      x: 0,
      y: 0,
      w: h * a,
      h,
      rotation: 0,
      name: 'Text',
    } as DesignElement);
  };
  const addAsset = async (a: AssetRecord) => {
    try {
      add(await fileToElement(assetFile(a), config.newShapeSize, roleFor('upload')));
      onError(null);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const upload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.svg,image/svg+xml,image/png,image/jpeg,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        add(await fileToElement(file, config.newShapeSize, roleFor('upload')));
        // Keep it in the asset library so it can be reused in other makers and the Design Studio.
        void useAssets.getState().add([file]);
        onError(null);
      } catch (e) {
        onError((e as Error).message);
      }
    };
    input.click();
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Add to the design">
      <button
        type="button"
        className={`${btn} ${tool === 'select' ? 'border-brand bg-brand-50 text-brand' : ''}`}
        aria-pressed={tool === 'select'}
        onClick={() => setTool('select')}
      >
        <MousePointer2 size={14} /> Select
      </button>
      <Popover
        trigger={({ open, toggle }) => (
          <button type="button" className={btn} onClick={toggle} aria-expanded={open} aria-haspopup="menu">
            <Shapes size={14} /> Shape
          </button>
        )}
      >
        {(close) => (
          <div className="grid w-64 grid-cols-5 gap-1" role="menu" aria-label="Shapes">
            {CANVAS_SHAPES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                title={s.label}
                aria-label={s.label}
                onClick={() => {
                  close();
                  addShape(s.id);
                }}
                className="flex aspect-square items-center justify-center rounded-md text-[#344054] hover:bg-brand-50 hover:text-brand"
              >
                <ShapeThumb id={s.id} />
              </button>
            ))}
          </div>
        )}
      </Popover>
      <button type="button" className={btn} onClick={() => void addText()}>
        <Type size={14} /> Text
      </button>
      <button type="button" className={btn} onClick={upload}>
        <Upload size={14} /> Upload
      </button>
      <Popover
        trigger={({ open, toggle }) => (
          <button type="button" className={btn} onClick={toggle} aria-expanded={open} aria-haspopup="menu">
            <Package size={14} /> Assets
          </button>
        )}
      >
        {(close) => <AssetPicker onPick={(a) => (close(), void addAsset(a))} onUpload={() => (close(), upload())} />}
      </Popover>
      <button
        type="button"
        className={`${btn} ${tool === 'draw' ? 'border-brand bg-brand-50 text-brand' : ''}`}
        aria-pressed={tool === 'draw'}
        onClick={() => setTool(tool === 'draw' ? 'select' : 'draw')}
      >
        <Pencil size={14} /> Draw
      </button>
    </div>
  );
}

/** Saved logos and artwork (SVGs and pictures) from the asset library. */
function AssetPicker({ onPick, onUpload }: { onPick: (a: AssetRecord) => void; onUpload: () => void }) {
  const all = useAssets((s) => s.assets);
  const loaded = useAssets((s) => s.loaded);
  useEffect(() => void useAssets.getState().load(), []);
  const assets = all.filter(isOutlineAsset);
  return (
    <div className="w-64" role="menu" aria-label="Assets" data-testid="maker-assets">
      <p className="px-1 pb-2 text-[12px] leading-relaxed text-muted">Your saved logos and artwork, shared with the Design Studio.</p>
      {loaded && !assets.length && <p className="px-1 pb-2 text-[12px] text-[#475467]">No SVGs or pictures saved yet.</p>}
      <div className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto">
        {assets.map((a) => (
          <button
            key={a.id}
            type="button"
            role="menuitem"
            title={a.name}
            aria-label={a.name}
            onClick={() => onPick(a)}
            className="overflow-hidden rounded-md border border-line hover:border-brand"
            data-testid="maker-asset"
          >
            <img src={a.thumb} alt="" className="aspect-square w-full bg-[#f5f7fb] object-contain" />
          </button>
        ))}
      </div>
      <button type="button" role="menuitem" onClick={onUpload} className={`${btn} mt-2 w-full justify-center`}>
        <Upload size={14} /> Upload new…
      </button>
    </div>
  );
}

/** The elements, top first, with their role. */
export function LayersPanel({ useStore, config }: { useStore: AnyMakerStore; config: PanelConfig }) {
  const elements = useStore((s) => s.elements) as DesignElement[];
  const selected = useStore((s) => s.selected);
  const { select } = useStore.getState();
  const roleOf = (r: string) => config.roles.find((x) => x.value === r);
  return (
    <ul className="flex flex-col gap-1" data-testid="layers" aria-label="Layers">
      {[...elements].reverse().map((el) => {
        const role = roleOf(el.role);
        return (
          <li key={el.id}>
            <button
              type="button"
              onClick={() => select(el.id)}
              aria-pressed={selected === el.id}
              className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[12px] ${selected === el.id ? 'border-brand bg-brand-50' : 'border-transparent hover:bg-[#f9fafb]'}`}
              data-testid="layer"
            >
              <span
                className="h-3 w-3 shrink-0 rounded-sm border border-black/10"
                style={{ background: role?.colour ?? '#ccc' }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate font-medium text-ink">
                {el.kind === 'text' ? `“${el.text}”` : (el.name ?? el.kind)}
              </span>
              <span className="shrink-0 text-[11px] text-[#475467]">
                {el.side === 'back' ? 'Back · ' : ''}
                {role?.label ?? el.role}
              </span>
            </button>
          </li>
        );
      })}
      {!elements.length && <li className="text-[12px] text-muted">Nothing yet: add a shape or some text.</li>}
    </ul>
  );
}

/** Exact settings for the selected element. */
export function Inspector({ useStore, config }: { useStore: AnyMakerStore; config: PanelConfig }) {
  const el = useStore((s) => s.elements.find((e: DesignElement) => e.id === s.selected) ?? null) as DesignElement | null;
  const { update, remove, duplicate, reorder } = useStore.getState();
  const [draft, setDraft] = useState(el?.kind === 'text' ? el.text : '');
  useEffect(() => {
    if (el?.kind === 'text') setDraft(el.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el?.id]);
  useEffect(() => {
    if (!el || el.kind !== 'text' || draft === el.text) return;
    const t = setTimeout(() => {
      // Keep the text's height; let its width follow the new content.
      const probe = { ...el, text: draft || ' ' } as DesignElement;
      const a = naturalAspect(probe);
      update(el.id, { text: draft, ...(a ? { w: Math.round(el.h * a * 10) / 10 } : {}) } as Partial<DesignElement>);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  if (!el)
    return (
      <p className="text-[12px] leading-relaxed text-muted">
        Select something on the canvas (or in Layers) to edit it. Drag to move; use the handles to resize and rotate.
      </p>
    );
  const num = (label: string, key: 'x' | 'y' | 'w' | 'h' | 'rotation', min: number, max: number, suffix = 'mm') => (
    <label className="text-[12px] text-muted">
      {label}
      <NumberField
        ariaLabel={`${label}${suffix === '°' ? ' (degrees)' : ' (mm)'}`}
        value={el[key]}
        min={min}
        max={max}
        step={key === 'rotation' ? 5 : 0.5}
        decimals={1}
        suffix={suffix}
        onCommit={(v) => update(el.id, { [key]: v })}
      />
    </label>
  );
  return (
    <div className="flex flex-col gap-2.5" data-testid="inspector">
      {el.kind === 'text' && (
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <label className="text-[12px] text-muted">
            Text
            <input
              value={draft}
              maxLength={40}
              onChange={(e) => setDraft(e.target.value)}
              className="mt-0.5 h-9 w-full rounded-md border border-line px-2 text-[14px] text-ink outline-none focus:border-brand"
            />
          </label>
          <label className="text-[12px] text-muted">
            Font
            <select
              value={el.font}
              onChange={async (e) => {
                const font = e.target.value as FontId;
                await loadFont(font);
                const a = naturalAspect({ ...el, font } as DesignElement);
                update(el.id, { font, ...(a ? { w: Math.round(el.h * a * 10) / 10 } : {}) } as Partial<DesignElement>);
              }}
              className="mt-0.5 h-9 w-full rounded-md border border-line bg-white px-1.5 text-[13px] text-ink"
            >
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div>
        <p className="mb-1 text-[12px] text-muted">Role</p>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Role">
          {config.roles
            .filter((r) => el.side !== 'back' || !config.backRoles || config.backRoles.includes(r.value))
            .map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={el.role === r.value}
                onClick={() => update(el.id, { role: r.value })}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-medium ${el.role === r.value ? 'border-brand bg-brand-50 text-brand' : 'border-line text-[#344054] hover:bg-[#f9fafb]'}`}
              >
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.colour }} aria-hidden />
                {r.label}
              </button>
            ))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {num('X', 'x', -500, 500)}
        {num('Y', 'y', -500, 500)}
        {num('Angle', 'rotation', -360, 360, '°')}
        {num('Width', 'w', 1, 500)}
        {num('Height', 'h', 1, 500)}
        {el.kind === 'draw' && (
          <label className="text-[12px] text-muted">
            Line
            <NumberField
              ariaLabel="Line width (mm)"
              value={el.width}
              min={0.6}
              max={20}
              step={0.2}
              decimals={1}
              suffix="mm"
              onCommit={(v) => update(el.id, { width: v } as Partial<DesignElement>)}
            />
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {config.backRoles && (
          <button
            type="button"
            className={btn}
            onClick={() => {
              // Same place on the tag, seen from the other face (x mirrors); roles the back can't print become engraved.
              const toBack = el.side !== 'back';
              const role = toBack && !config.backRoles!.includes(el.role) ? config.backRoles![0] : el.role;
              update(el.id, { side: toBack ? 'back' : 'front', x: -el.x, role } as Partial<DesignElement>);
              useStore.getState().setSide(toBack ? 'back' : 'front');
              useStore.getState().select(el.id);
            }}
          >
            <Repeat2 size={14} /> Move to {el.side === 'back' ? 'front' : 'back'}
          </button>
        )}
        <button type="button" className={btn} onClick={() => update(el.id, { flipX: !el.flipX })} aria-pressed={!!el.flipX}>
          <FlipHorizontal2 size={14} /> Flip
        </button>
        <button type="button" className={btn} onClick={() => duplicate(el.id)}>
          <Copy size={14} /> Duplicate
        </button>
        <button type="button" className={btn} onClick={() => reorder(el.id, 1)} aria-label="Bring forward">
          <ArrowUp size={14} />
        </button>
        <button type="button" className={btn} onClick={() => reorder(el.id, -1)} aria-label="Send backward">
          <ArrowDown size={14} />
        </button>
        <button type="button" className={`${btn} text-red-700`} onClick={() => remove(el.id)}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </div>
  );
}
