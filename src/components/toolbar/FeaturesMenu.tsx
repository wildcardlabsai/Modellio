import { Spline, SquareDashedBottom } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import { solidConversion, CONVERTIBLE_LABEL } from '@/cad/brep/convert';
import { useFeatureTool, type FeatureKind } from '@/components/features/featureTool';

/** Precise-solid features. Each needs one shape that is (or can become) a precise solid. */
export function FeaturesMenu({ onDone }: { onDone: () => void }) {
  const target = useEditor((s) => {
    if (s.selection.length !== 1) return null;
    const o = s.doc.objects[s.selection[0]];
    return o?.kind === 'shape' ? o : null;
  });
  const conv = target ? solidConversion(target) : null;
  const why = !target
    ? 'Select one shape first.'
    : conv && !conv.ok
      ? conv.reason
      : target.shape === 'solid'
        ? null
        : 'It becomes a precise solid first (same size and shape).';
  const items: { kind: FeatureKind; label: string; hint: string; Icon: typeof Spline }[] = [
    { kind: 'fillet', label: 'Fillet', hint: 'Round chosen edges with an exact radius.', Icon: Spline },
    { kind: 'chamfer', label: 'Chamfer', hint: 'Bevel chosen edges with a flat cut.', Icon: SquareDashedBottom },
  ];
  const ok = !!target && !!conv?.ok;
  return (
    <div className="w-[290px]">
      <p className="px-2.5 pb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Features</p>
      {items.map(({ kind, label, hint, Icon }) => (
        <button
          key={kind}
          type="button"
          disabled={!ok}
          onClick={() => {
            onDone();
            if (target) void useFeatureTool.getState().start(target.id, kind);
          }}
          className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-brand-50 disabled:pointer-events-none disabled:opacity-40"
          data-testid={`feature-${kind}`}
        >
          <Icon size={18} className="mt-0.5 shrink-0 text-brand" />
          <span>
            <span className="block text-[13px] font-semibold text-ink">{label}</span>
            <span className="block text-[12px] leading-snug text-muted">{hint}</span>
          </span>
        </button>
      ))}
      {why && <p className="px-2.5 pt-1.5 text-[12px] leading-snug text-muted">{why}</p>}
      {!target && <p className="px-2.5 pt-1 text-[11px] leading-snug text-muted">Works on {CONVERTIBLE_LABEL}.</p>}
    </div>
  );
}
