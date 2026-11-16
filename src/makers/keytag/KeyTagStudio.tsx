import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';
import type { PanelConfig } from '../canvas/DesignPanels';
import type { KeyringResult } from '../keyring/geometry';
import { KEYRING_PANEL } from '../keyring/KeyringStudio';
import { PlaqueContext, type PlaqueConfig, type PlaqueStore } from '../plaque/config';
import { PlaqueStudio } from '../plaque/PlaqueStudio';
import { downloadBytes, slugify } from '../canvas/MakerPreview';
import { NumberField } from '@/components/ui/NumberField';
import { write3mf } from '@/cad/export/threemf';
import type { MeshData } from '@/cad/kernel/meshData';
import { useKeyTag, openKeyTagTemplate, startBlankKeyTag, placeKeyTagHole, buildAllTags } from './store';
import { KEYTAG_TEMPLATES, KEYTAG_CATEGORIES } from './templates';
import { MAX_TAGS, NUMBER_TOKEN, tagCount, tagNumber, usesNumber } from './numbering';

const PANEL: PanelConfig = {
  ...KEYRING_PANEL,
  pickRole: () => (useKeyTag.getState().side === 'back' ? 'engraved' : 'raised'),
  newTextHeight: 8,
  defaultText: 'TAG {#}',
};

const section = 'border-b border-line p-4';
const heading = 'mb-2 text-[13px] font-semibold text-ink';

/** Numbering: start, how many, step and padding; which tag the preview shows. */
function NumberingSettings() {
  const n = useKeyTag((s) => s.params.numbering);
  const preview = useKeyTag((s) => s.params.preview);
  const hasToken = useKeyTag((s) => usesNumber(s.elements));
  const set = (patch: Partial<typeof n>) => useKeyTag.getState().setParams({ numbering: { ...n, ...patch }, preview: 0 });
  const count = tagCount(n);
  const index = Math.min(preview, count - 1);
  const field = (label: string, key: keyof typeof n, min: number, max: number) => (
    <label className="text-[12px] text-muted">
      {label}
      <NumberField value={n[key]} onCommit={(v) => set({ [key]: v })} min={min} max={max} step={1} integer ariaLabel={label} />
    </label>
  );
  return (
    <section className={section} aria-labelledby="keytag-numbering" data-testid="keytag-numbering">
      <h2 id="keytag-numbering" className={heading}>
        Numbering
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {field('First number', 'start', -9999, 999999)}
        {field('How many tags', 'count', 1, MAX_TAGS)}
        {field('Step', 'step', -1000, 1000)}
        {field('Digits', 'pad', 1, 8)}
      </div>
      {hasToken ? (
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          Numbers {tagNumber(n, 0)} to {tagNumber(n, count - 1)} replace <code className="rounded bg-canvas px-1">{NUMBER_TOKEN}</code> in
          your text.
        </p>
      ) : (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[12px] leading-relaxed text-amber-900">
          Put <code className="rounded bg-panel px-1">{NUMBER_TOKEN}</code> in a text item where the number should go.
        </p>
      )}
      <div className="mt-2 flex items-center justify-between rounded-lg bg-canvas px-2 py-1.5 text-[12px]">
        <button
          type="button"
          aria-label="Previous tag"
          disabled={index <= 0}
          onClick={() => useKeyTag.getState().setParams({ preview: index - 1 }, { transient: true })}
          className="rounded p-1 hover:bg-canvas disabled:opacity-30"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="font-medium text-ink" data-testid="keytag-preview-index">
          Showing tag {index + 1} of {count} · {tagNumber(n, index)}
        </span>
        <button
          type="button"
          aria-label="Next tag"
          disabled={index >= count - 1}
          onClick={() => useKeyTag.getState().setParams({ preview: index + 1 }, { transient: true })}
          className="rounded p-1 hover:bg-canvas disabled:opacity-30"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </section>
  );
}

/** Translate a mesh (copy). */
function moved(m: MeshData, dx: number, dy: number): MeshData {
  const positions = new Float32Array(m.positions);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += dx;
    positions[i + 1] += dy;
  }
  return { positions, indices: m.indices };
}

/** Every tag of the run, laid out in a grid as separate objects in one 3MF. */
function BatchDownload() {
  const n = useKeyTag((s) => s.params.numbering);
  const [progress, setProgress] = useState<string | null>(null);
  const count = tagCount(n);
  const run = async () => {
    setProgress(`Building 0 of ${count}…`);
    try {
      const results: KeyringResult[] = await buildAllTags((d, t) => setProgress(`Building ${d} of ${t}…`));
      const cols = Math.ceil(Math.sqrt(count));
      const w = Math.max(...results.map((r) => r.width)) + 6;
      const h = Math.max(...results.map((r) => r.height)) + 6;
      const bodies = results.flatMap((r, i) => {
        const dx = (i % cols) * w;
        const dy = -Math.floor(i / cols) * h;
        const num = tagNumber(n, i);
        return r.parts.map((p) => ({
          id: `${num}-${p.id}`,
          name: `Tag ${num} ${p.name}`,
          color: p.colour,
          mesh: moved(p.mesh, dx, dy),
          watertight: p.watertight,
        }));
      });
      const name = `Key tags ${tagNumber(n, 0)}-${tagNumber(n, count - 1)}`;
      downloadBytes(write3mf(bodies, name), `${slugify(name)}.3mf`, 'model/3mf');
    } finally {
      setProgress(null);
    }
  };
  return (
    <section className="border-b border-line p-4" aria-label="Download all tags">
      <button
        type="button"
        onClick={() => void run()}
        disabled={!!progress}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-brand text-[13px] font-semibold text-brand-ink hover:bg-brand-50 disabled:opacity-60"
        data-testid="keytag-download-all"
      >
        {progress ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        {progress ?? `Download all ${count} tags (3MF)`}
      </button>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        One 3MF with every tag laid out on the plate; each tag is its own object.
      </p>
    </section>
  );
}

const CONFIG: PlaqueConfig = {
  id: 'keytag',
  studio: 'keytag',
  title: 'Key Tag Maker',
  label: 'Key Tag Maker',
  noun: 'tag',
  store: useKeyTag as unknown as PlaqueStore,
  templates: KEYTAG_TEMPLATES,
  categories: KEYTAG_CATEGORIES,
  thumbDir: 'keytag',
  blankHint: 'An empty tag: add text with {#} for the number',
  openTemplate: openKeyTagTemplate,
  startBlank: startBlankKeyTag,
  placeHoleAtEdge: placeKeyTagHole,
  panel: PANEL,
  artboard: { w: 80, h: 50, label: 'Tag area 80 × 50 mm' },
  doubleSided: true,
  ring: true,
  settingsTitle: 'Tag',
  windowKey: 'modellioKeyTag',
  ExtraSettings: NumberingSettings,
  ExtraResult: BatchDownload,
  help: (
    <>
      <p className="font-semibold text-ink">Numbered tags in one go</p>
      <ol className="mt-1.5 list-decimal space-y-1 pl-4">
        <li>Pick a layout (Locker, Room, Asset…) or Start blank.</li>
        <li>
          Type <code>{'{#}'}</code> in any text where the number goes, e.g. <code>ROOM {'{#}'}</code>.
        </li>
        <li>Set the first number, how many, step and digits under Numbering.</li>
        <li>Download all tags as one 3MF, or the tag shown as 3MF/STL.</li>
      </ol>
    </>
  ),
};

/** Key Tag Maker: ID and number tags, from one design to a numbered run. */
export default function KeyTagStudio() {
  return (
    <PlaqueContext.Provider value={CONFIG}>
      <PlaqueStudio />
    </PlaqueContext.Provider>
  );
}
