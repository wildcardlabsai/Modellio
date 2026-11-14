import { useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Plus, Rows3 } from 'lucide-react';
import type { PanelConfig } from '../canvas/DesignPanels';
import { fitNatural, type DesignElement } from '../canvas/model';
import { KEYRING_PANEL } from '../keyring/KeyringStudio';
import { PlaqueContext, type PlaqueConfig, type PlaqueStore } from '../plaque/config';
import { PlaqueStudio } from '../plaque/PlaqueStudio';
import { NumberField } from '@/components/ui/NumberField';
import { Toggle } from '@/components/ui/Toggle';
import { Segmented } from '@/components/ui/Modal';
import { useSign, openSignTemplate, startBlankSign } from './store';
import { SIGN_TEMPLATES, SIGN_CATEGORIES } from './templates';
import { signBounds, type SignParams } from './geometry';

const PANEL: PanelConfig = {
  ...KEYRING_PANEL,
  pickRole: () => (useSign.getState().side === 'back' ? 'engraved' : 'raised'),
  newShapeSize: 30,
  newTextHeight: 12,
  defaultText: 'SIGN',
};

const section = 'border-b border-line p-4';
const heading = 'mb-2 text-[13px] font-semibold text-ink';
const tool =
  'flex h-8 items-center justify-center gap-1.5 rounded-md border border-line px-2 text-[12px] font-medium text-[#344054] hover:bg-[#f9fafb]';

/** Front text items, top line first. */
const lines = (els: DesignElement[]) => els.filter((e) => e.kind === 'text' && (e.side ?? 'front') === 'front').sort((a, b) => b.y - a.y);

/** Lines of text: add a line, align them, and space them evenly. */
function LineTools() {
  const [gap, setGap] = useState(6);
  const count = useSign((s) => lines(s.elements).length);
  const apply = (fn: (texts: DesignElement[], b: NonNullable<ReturnType<typeof signBounds>>) => Map<string, Partial<DesignElement>>) => {
    const st = useSign.getState();
    // New lines get their natural width first, so they line up with the rest.
    const els = fitNatural(st.elements);
    const b = signBounds(els, st.params);
    if (!b) return;
    const changes = fn(lines(els), b);
    if (!changes.size) return;
    st.beginGesture();
    useSign.setState({ elements: els.map((e) => (changes.has(e.id) ? ({ ...e, ...changes.get(e.id) } as DesignElement) : e)) });
    st.rebuild();
  };
  const align = (where: 'left' | 'centre' | 'right') =>
    apply((texts, b) => {
      const st = useSign.getState();
      const pad =
        (st.params.border.enabled ? st.params.border.width : 0) + 6 + (st.params.mount.kind !== 'none' ? st.params.mount.diameter * 2 : 0);
      return new Map(
        texts.map((t) => [
          t.id,
          { x: where === 'centre' ? (b.minX + b.maxX) / 2 : where === 'left' ? b.minX + pad + t.w / 2 : b.maxX - pad - t.w / 2 },
        ]),
      );
    });
  const spread = () =>
    apply((texts, b) => {
      const total = texts.reduce((s, t) => s + t.h, 0) + gap * (texts.length - 1);
      let y = (b.minY + b.maxY) / 2 + total / 2;
      const m = new Map<string, Partial<DesignElement>>();
      for (const t of texts) {
        m.set(t.id, { y: Math.round((y - t.h / 2) * 10) / 10 });
        y -= t.h + gap;
      }
      return m;
    });
  const addLine = () => {
    const st = useSign.getState();
    const texts = lines(st.elements);
    const last = texts[texts.length - 1];
    const h = last ? Math.min(last.h, 10) : 12;
    st.add({
      kind: 'text',
      text: 'New line',
      font: last && last.kind === 'text' ? last.font : 'inter-bold',
      role: 'raised',
      x: last ? last.x : 0,
      y: last ? last.y - last.h / 2 - gap - h / 2 : 0,
      w: 0,
      h,
      rotation: 0,
      name: 'Line',
    } as DesignElement);
  };
  return (
    <section className={section} aria-labelledby="sign-lines" data-testid="sign-lines">
      <h2 id="sign-lines" className={heading}>
        Lines of text ({count})
      </h2>
      <div className="grid grid-cols-4 gap-1.5">
        <button type="button" className={tool} onClick={() => align('left')} aria-label="Align lines left" title="Align lines left">
          <AlignLeft size={15} />
        </button>
        <button type="button" className={tool} onClick={() => align('centre')} aria-label="Centre lines" title="Centre lines">
          <AlignCenter size={15} />
        </button>
        <button type="button" className={tool} onClick={() => align('right')} aria-label="Align lines right" title="Align lines right">
          <AlignRight size={15} />
        </button>
        <button type="button" className={tool} onClick={spread} aria-label="Space lines evenly" title="Space lines evenly">
          <Rows3 size={15} />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[13px] text-[#344054]">
        <span>Line gap</span>
        <div className="w-[110px]">
          <NumberField value={gap} onCommit={setGap} min={0} max={60} step={1} decimals={1} suffix="mm" ariaLabel="Line gap (mm)" />
        </div>
      </div>
      <button type="button" className={`${tool} mt-2 w-full`} onClick={addLine}>
        <Plus size={15} /> Add a line
      </button>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        Each line has its own font and size: select it on the canvas to change it.
      </p>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-[13px] text-[#344054]">
      <span>{label}</span>
      <div className="w-[110px]">{children}</div>
    </div>
  );
}

/** Wall mounting and the desk stand. */
function MountSettings() {
  const p = useSign((s) => s.params);
  const set = (patch: Partial<SignParams>) => useSign.getState().setParams(patch);
  const m = p.mount;
  return (
    <>
      <LineTools />
      <section className={section} aria-labelledby="sign-mount" data-testid="sign-mounting">
        <h2 id="sign-mount" className={heading}>
          Mounting
        </h2>
        <Segmented<SignParams['mount']['kind']>
          label="Mounting"
          value={m.kind}
          options={[
            { value: 'screw', label: 'Screws' },
            { value: 'keyhole', label: 'Keyholes' },
            { value: 'none', label: 'None' },
          ]}
          onChange={(v) => set({ mount: { ...m, kind: v } })}
        />
        {m.kind === 'screw' && (
          <div className="mt-2">
            <Segmented<'2' | '4'>
              label="Number of screw holes"
              value={String(m.count) as '2' | '4'}
              options={[
                { value: '2', label: '2 holes' },
                { value: '4', label: '4 corners' },
              ]}
              onChange={(v) => set({ mount: { ...m, count: Number(v) as 2 | 4 } })}
            />
          </div>
        )}
        {m.kind !== 'none' && (
          <>
            <Row label="Screw size">
              <NumberField
                value={m.diameter}
                onCommit={(v) => set({ mount: { ...m, diameter: v } })}
                min={2}
                max={8}
                step={0.5}
                decimals={1}
                suffix="mm"
                ariaLabel="Screw size (mm)"
              />
            </Row>
            <Row label="From the edge">
              <NumberField
                value={m.inset}
                onCommit={(v) => set({ mount: { ...m, inset: v } })}
                min={4}
                max={60}
                step={1}
                decimals={0}
                suffix="mm"
                ariaLabel="Hole distance from the edge (mm)"
              />
            </Row>
          </>
        )}
        <div className="mt-2">
          <Toggle label="Desk stand" checked={p.stand.enabled} onChange={(v) => set({ stand: { ...p.stand, enabled: v } })} />
          {p.stand.enabled && (
            <Row label="Lean back">
              <NumberField
                value={p.stand.angle}
                onCommit={(v) => set({ stand: { ...p.stand, angle: v } })}
                min={0}
                max={30}
                step={1}
                decimals={0}
                suffix="°"
                ariaLabel="Stand lean (degrees)"
              />
            </Row>
          )}
        </div>
      </section>
    </>
  );
}

const CONFIG: PlaqueConfig = {
  id: 'sign',
  studio: 'sign',
  title: 'Sign Maker',
  label: 'Sign Maker',
  noun: 'sign',
  store: useSign as unknown as PlaqueStore,
  templates: SIGN_TEMPLATES,
  categories: SIGN_CATEGORIES,
  thumbDir: 'sign',
  blankHint: 'A plain plate: add lines of text and shapes',
  openTemplate: openSignTemplate,
  startBlank: startBlankSign,
  panel: PANEL,
  artboard: { w: 200, h: 120, label: 'Sign area 200 × 120 mm' },
  doubleSided: false,
  ring: false,
  settingsTitle: 'Sign',
  windowKey: 'modellioSign',
  ExtraSettings: MountSettings,
  help: (
    <>
      <p className="font-semibold text-ink">Make a sign</p>
      <ol className="mt-1.5 list-decimal space-y-1 pl-4">
        <li>Pick a template, or Start blank for a plain plate.</li>
        <li>Select a line to change its words, font and size; Add a line for more.</li>
        <li>Align and space the lines, then choose raised, engraved or flush.</li>
        <li>Choose screws, keyholes or a desk stand, then Download.</li>
      </ol>
    </>
  ),
};

/** Sign Maker: house numbers, door, desk and workshop signs with mounting built in. */
export default function SignStudio() {
  return (
    <PlaqueContext.Provider value={CONFIG}>
      <PlaqueStudio />
    </PlaqueContext.Provider>
  );
}
